import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSlackEvent, mergeEligibility, MERGE_DELAY_MS, MAX_SLACK_TEXT_BYTES } from './index.js';

// Synthetic clocks, IDs, SHA and file names only; no account or home data.
const NOW = 1_700_000_000_000;
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const POLICY = {
  teamId: 'TDEMO0001', channelIds: ['CDEMO0001'], actorIds: ['UDEMO0001'],
  repository: 'pollography/test', allowedRepositories: ['pollography/test'],
  allowedPaths: ['src/counter.js', 'src/new.js', 'src/old.js'],
  requiredChecks: ['test', 'lint'],
};
const event = () => ({ type: 'event_callback', team_id: 'TDEMO0001', event_id: 'EvDemo', event: {
  type: 'message', channel: 'CDEMO0001', user: 'UDEMO0001', ts: '1699999999.123456',
  text: '!ai-fix Fix the demo counter.',
} });
const snapshot = () => ({
  repository: 'pollography/test', headRepository: 'pollography/test', pullRequestNumber: 7,
  state: 'open', draft: false, conflicts: false, veto: false, changeRequested: false,
  headSha: SHA, testedHeadSha: SHA, headUpdatedAtMs: NOW - 4 * MERGE_DELAY_MS,
  filesComplete: true, changedFiles: [{ status: 'modified', path: 'src/counter.js' }],
  checks: [
    { name: 'test', status: 'success', headSha: SHA, completedAtMs: NOW - 2 * MERGE_DELAY_MS - 1 },
    { name: 'lint', status: 'success', headSha: SHA, completedAtMs: NOW - 2 * MERGE_DELAY_MS },
  ],
  notification: {
    status: 'success', headSha: SHA, pullRequestNumber: 7,
    receiptId: 'synthetic-receipt', sentAtMs: NOW - MERGE_DELAY_MS,
  },
});

test('normal Slack event yields only the normalized contract', () => {
  const input = event();
  input.untrustedExtra = 'not forwarded';
  const result = normalizeSlackEvent(input, POLICY, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.event.instruction, 'Fix the demo counter.');
  assert.equal(result.event.repository, 'pollography/test');
  assert.equal(result.event.messageTs, '1699999999.123456');
  assert.equal(result.event.threadTs, input.event.ts);
  assert.match(result.event.idempotencyKey, /^slack:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(result.event, 'untrustedExtra'), false);
});

test('retry key is deterministic and depends on workspace/channel/message, not envelope event ID or text', () => {
  const first = event();
  const retry = event();
  retry.event_id = 'EvRetry';
  retry.event.text = '!ai-fix A changed retry body cannot create a second ticket.';
  const key = normalizeSlackEvent(first, POLICY, NOW).event.idempotencyKey;
  assert.equal(normalizeSlackEvent(retry, POLICY, NOW).event.idempotencyKey, key);
  const alternatePolicy = { ...POLICY, teamId: 'TDEMO0002', channelIds: ['CDEMO0001', 'CDEMO0002'] };
  first.team_id = 'TDEMO0002';
  assert.notEqual(normalizeSlackEvent(first, alternatePolicy, NOW).event.idempotencyKey, key);
  first.team_id = 'TDEMO0001';
  first.event.channel = 'CDEMO0002';
  assert.notEqual(normalizeSlackEvent(first, { ...POLICY, channelIds: alternatePolicy.channelIds }, NOW).event.idempotencyKey, key);
});

test('thread replies have separate jobs and reply to the original thread; roots may self-reference', () => {
  const root = event();
  const rootKey = normalizeSlackEvent(root, POLICY, NOW).event.idempotencyKey;
  root.event.thread_ts = root.event.ts;
  assert.equal(normalizeSlackEvent(root, POLICY, NOW).event.idempotencyKey, rootKey);
  const reply = event();
  reply.event.thread_ts = root.event.ts;
  reply.event.ts = '1699999999.123457';
  const result = normalizeSlackEvent(reply, POLICY, NOW);
  assert.equal(result.ok, true);
  assert.notEqual(result.event.idempotencyKey, rootKey);
  assert.equal(result.event.threadTs, root.event.ts);
});

for (const [label, mutate, reason] of [
  ['wrong team', input => { input.team_id = 'TOTHER001'; }, 'workspace_not_allowed'],
  ['contradictory nested team', input => { input.event.team = 'TOTHER001'; }, 'workspace_not_allowed'],
  ['wrong channel', input => { input.event.channel = 'COTHER001'; }, 'channel_not_allowed'],
  ['direct message', input => { input.event.channel = 'DDEMO0001'; }, 'channel_not_allowed'],
  ['wrong actor', input => { input.event.user = 'UOTHER001'; }, 'actor_not_allowed'],
  ['missing actor', input => { delete input.event.user; }, 'actor_not_allowed'],
  ['bot', input => { input.event.bot_id = ''; }, 'unsupported_event'],
  ['bot profile', input => { input.event.bot_profile = {}; }, 'unsupported_event'],
  ['subtype edit', input => { input.event.subtype = 'message_changed'; }, 'unsupported_event'],
  ['hidden', input => { input.event.hidden = true; }, 'unsupported_event'],
  ['unsupported event', input => { input.event.type = 'app_mention'; }, 'unsupported_event'],
  ['URL verification', input => { input.type = 'url_verification'; }, 'unsupported_envelope'],
  ['missing timestamp', input => { delete input.event.ts; }, 'invalid_message_ts'],
  ['numeric timestamp', input => { input.event.ts = 1_699_999_999; }, 'invalid_message_ts'],
  ['noncanonical timestamp', input => { input.event.ts = '01699999999.123456'; }, 'invalid_message_ts'],
  ['timestamp with trailing newline', input => { input.event.ts += '\n'; }, 'invalid_message_ts'],
  ['future message', input => { input.event.ts = '1700000000.000001'; }, 'future_message_ts'],
  ['future thread root', input => { input.event.thread_ts = '1700000000.000000'; }, 'invalid_thread_ts'],
  ['broken thread root', input => { input.event.thread_ts = {}; }, 'invalid_thread_ts'],
  ['nonstring text', input => { input.event.text = {}; }, 'invalid_text'],
  ['control in text', input => { input.event.text = '!ai-fix bad\u0000'; }, 'invalid_text'],
  ['broken Unicode', input => { input.event.text = '!ai-fix bad\ud800'; }, 'invalid_text'],
]) {
  test(`Slack rejects ${label}`, () => {
    const input = event(); mutate(input);
    assert.deepEqual(normalizeSlackEvent(input, POLICY, NOW), { ok: false, reason });
  });
}

test('exact command delimiter and nonempty body are required', () => {
  for (const command of ['', '!ai-fix', ' !ai-fix fix', '!AI-fix fix', '!ai-fix-all fix', '!ai-fixx fix', '!ai-fix\nfix', '<@UDEMO0001> !ai-fix fix']) {
    const input = event(); input.event.text = command;
    assert.equal(normalizeSlackEvent(input, POLICY, NOW).reason, 'command_not_matched', command);
  }
  const input = event(); input.event.text = '!ai-fix \n\t ';
  assert.equal(normalizeSlackEvent(input, POLICY, NOW).reason, 'empty_instruction');
});

test('Slack size is bounded in UTF-8 bytes, including the prefix', () => {
  const input = event(); input.event.text = '!ai-fix ' + 'x'.repeat(MAX_SLACK_TEXT_BYTES - 8);
  assert.equal(normalizeSlackEvent(input, POLICY, NOW).ok, true);
  input.event.text += 'x';
  assert.equal(normalizeSlackEvent(input, POLICY, NOW).reason, 'invalid_text');
  input.event.text = '!ai-fix ' + 'ü'.repeat(2_000);
  assert.equal(normalizeSlackEvent(input, POLICY, NOW).reason, 'invalid_text');
});

test('task text cannot override the repository or become executable code', () => {
  const input = event(); input.event.text = '!ai-fix repo=evil/repo; $(curl example.invalid) ../../secrets';
  const result = normalizeSlackEvent(input, POLICY, NOW);
  assert.equal(result.event.repository, 'pollography/test');
  assert.equal(result.event.instruction, input.event.text.slice(8));
});

test('missing/broken source and policy inputs fail closed without throwing', () => {
  for (const input of [undefined, null, [], '', 0, true, {}, { type: 'event_callback', event: [] }]) {
    assert.equal(normalizeSlackEvent(input, POLICY, NOW).ok, false);
  }
  for (const policy of [undefined, null, {}, { ...POLICY, allowedRepositories: [] },
    { ...POLICY, repository: 'evil/repo' }, { ...POLICY, repository: '../test' },
    { ...POLICY, actorIds: [] }, { ...POLICY, actorIds: ['UDEMO0001', 'UDEMO0001'] },
    { ...POLICY, actorIds: Array(1) }, { ...POLICY, channelIds: ['DDEMO0001'] },
    { ...POLICY, teamId: 'TDEMO0001\n' },
    { ...POLICY, repository: 'pollography/test\n', allowedRepositories: ['pollography/test\n'] }]) {
    assert.equal(normalizeSlackEvent(event(), policy, NOW).ok, false);
  }
});

test('merge passes at exactly 3600 seconds, never one millisecond early', () => {
  const input = snapshot();
  assert.deepEqual(mergeEligibility(input, POLICY, NOW), { eligible: true, eligibleAtMs: NOW });
  assert.deepEqual(mergeEligibility(input, POLICY, NOW - 1), {
    eligible: false, reason: 'waiting_one_hour', eligibleAtMs: NOW,
  });
  assert.equal(mergeEligibility(input, POLICY, NOW + 1).eligible, true);
});

test('latest green and notification both reset the one-hour clock', () => {
  const input = snapshot();
  input.checks[1].completedAtMs = NOW - 60_000;
  input.notification.sentAtMs = NOW - 30_000;
  assert.deepEqual(mergeEligibility(input, POLICY, NOW), {
    eligible: false, reason: 'waiting_one_hour', eligibleAtMs: NOW - 30_000 + MERGE_DELAY_MS,
  });
  input.notification.sentAtMs = NOW - 120_000;
  assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'invalid_notification_time');
});

for (const [label, mutate, reason] of [
  ['other repository', input => { input.repository = 'evil/repo'; }, 'repository_not_allowed'],
  ['case variant repository', input => { input.repository = 'Pollography/test'; }, 'repository_not_allowed'],
  ['malicious repository URL', input => { input.repository = 'https://github.com/pollography/test'; }, 'repository_not_allowed'],
  ['fork source', input => { input.headRepository = 'evil/test'; }, 'repository_not_allowed'],
  ['closed PR', input => { input.state = 'closed'; }, 'pr_not_open'],
  ['invalid PR number', input => { input.pullRequestNumber = 0; }, 'pr_not_open'],
  ['draft', input => { input.draft = true; }, 'pr_state_blocks'],
  ['conflict', input => { input.conflicts = true; }, 'pr_state_blocks'],
  ['veto', input => { input.veto = true; }, 'pr_state_blocks'],
  ['change requested', input => { input.changeRequested = true; }, 'pr_state_blocks'],
  ['missing explicit veto state', input => { delete input.veto; }, 'pr_state_blocks'],
  ['string false', input => { input.draft = 'false'; }, 'pr_state_blocks'],
  ['new untested head', input => { input.headSha = OTHER_SHA; }, 'untested_head'],
  ['missing tested SHA', input => { delete input.testedHeadSha; }, 'untested_head'],
  ['invalid SHA', input => { input.headSha = 'main'; input.testedHeadSha = 'main'; }, 'untested_head'],
  ['SHA with trailing newline', input => { input.headSha += '\n'; input.testedHeadSha = input.headSha; }, 'untested_head'],
  ['stale check head', input => { input.checks[0].headSha = OTHER_SHA; }, 'stale_check_head'],
  ['missing check', input => { input.checks.pop(); }, 'missing_or_unknown_checks'],
  ['unknown extra check', input => { input.checks.push({ ...input.checks[0], name: 'unknown' }); }, 'missing_or_unknown_checks'],
  ['unknown replacement check', input => { input.checks[0].name = 'unknown'; }, 'missing_or_unknown_checks'],
  ['duplicate check', input => { input.checks[1] = { ...input.checks[0] }; }, 'missing_or_unknown_checks'],
  ['pending check', input => { input.checks[0].status = 'pending'; }, 'check_not_successful'],
  ['unknown check result', input => { input.checks[0].status = 'unknown'; }, 'check_not_successful'],
  ['failed check', input => { input.checks[0].status = 'failure'; }, 'check_not_successful'],
  ['skipped check', input => { input.checks[0].status = 'skipped'; }, 'check_not_successful'],
  ['missing notification', input => { delete input.notification; }, 'missing_or_stale_notification'],
  ['failed notification', input => { input.notification.status = 'failure'; }, 'missing_or_stale_notification'],
  ['unconfirmed notification', input => { input.notification.status = 'pending'; }, 'missing_or_stale_notification'],
  ['stale notification SHA', input => { input.notification.headSha = OTHER_SHA; }, 'missing_or_stale_notification'],
  ['wrong notification PR', input => { input.notification.pullRequestNumber = 8; }, 'missing_or_stale_notification'],
  ['missing notification receipt', input => { input.notification.receiptId = ''; }, 'missing_or_stale_notification'],
  ['incomplete pagination', input => { input.filesComplete = false; }, 'incomplete_files'],
  ['no changed files', input => { input.changedFiles = []; }, 'incomplete_files'],
  ['too many changed files', input => { input.changedFiles = Array.from({ length: 201 }, (_, i) => ({ status: 'modified', path: `src/file-${i}.js` })); }, 'incomplete_files'],
  ['unknown file state', input => { input.changedFiles[0].status = 'unknown'; }, 'invalid_file'],
  ['duplicate changed file', input => { input.changedFiles.push({ ...input.changedFiles[0] }); }, 'invalid_file'],
  ['rename without old path', input => { input.changedFiles[0].status = 'renamed'; }, 'invalid_file'],
  ['hidden old path on modification', input => { input.changedFiles[0].previousPath = 'src/old.js'; }, 'invalid_file'],
]) {
  test(`merge blocks ${label}`, () => {
    const input = snapshot(); mutate(input);
    assert.deepEqual(mergeEligibility(input, POLICY, NOW), { eligible: false, reason });
  });
}

test('rebase requires fresh tests, fresh notification and a full new hour', () => {
  const input = snapshot();
  input.headSha = OTHER_SHA;
  input.testedHeadSha = OTHER_SHA;
  input.headUpdatedAtMs = NOW - 10_000;
  assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'stale_check_head');
  for (const check of input.checks) check.headSha = OTHER_SHA;
  assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'invalid_check_time');
  for (const check of input.checks) check.completedAtMs = NOW - 5_000;
  assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'missing_or_stale_notification');
  input.notification.headSha = OTHER_SHA;
  input.notification.sentAtMs = NOW;
  assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'waiting_one_hour');
  assert.equal(mergeEligibility(input, POLICY, NOW + MERGE_DELAY_MS - 1).eligible, false);
  assert.equal(mergeEligibility(input, POLICY, NOW + MERGE_DELAY_MS).eligible, true);
});

test('time values are finite safe integer milliseconds, with no future evidence', () => {
  for (const invalid of [undefined, null, '1700000000000', NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeSlackEvent(event(), POLICY, invalid).reason, 'invalid_now_ms');
    assert.equal(mergeEligibility(snapshot(), POLICY, invalid).reason, 'invalid_now_ms');
    for (const field of ['head', 'check', 'notification']) {
      const input = snapshot();
      if (field === 'head') input.headUpdatedAtMs = invalid;
      if (field === 'check') input.checks[0].completedAtMs = invalid;
      if (field === 'notification') input.notification.sentAtMs = invalid;
      assert.equal(mergeEligibility(input, POLICY, NOW).eligible, false, `${field}: ${invalid}`);
    }
  }
  for (const field of ['head', 'check', 'notification']) {
    const input = snapshot();
    if (field === 'head') input.headUpdatedAtMs = NOW + 1;
    if (field === 'check') input.checks[0].completedAtMs = NOW + 1;
    if (field === 'notification') input.notification.sentAtMs = NOW + 1;
    assert.equal(mergeEligibility(input, POLICY, NOW).eligible, false, field);
  }
  const input = snapshot();
  input.headUpdatedAtMs = Number.MAX_SAFE_INTEGER - 100;
  for (const check of input.checks) check.completedAtMs = input.headUpdatedAtMs;
  input.notification.sentAtMs = input.headUpdatedAtMs;
  assert.equal(mergeEligibility(input, POLICY, Number.MAX_SAFE_INTEGER).reason, 'invalid_deadline');
});

test('security, workflow, dependency and deployment files cannot auto-merge, including rename sources', () => {
  const excluded = [
    '.github/workflows/test.yml', '.github/CODEOWNERS', 'SECURITY.md', 'src/auth.js',
    'src/security/guard.js', 'src/credentials.json', '.env.production', 'keys/service.pem',
    '.circleci/config.yml', 'azure-pipelines.yml', 'package.json', 'nested/package-lock.json',
    'pnpm-lock.yaml', 'requirements-dev.txt', 'pyproject.toml', 'Cargo.lock', 'go.mod',
    'project/App.csproj', 'deploy/release.sh', 'infra/main.tf', 'Dockerfile', 'vercel.json',
    'wrangler.jsonc', 'k8s/app.yaml', 'serverless.yml', 'src/SECURITY/guard.js',
    'scripts/deploy.sh', 'migrations/001.sql', '.claude/settings.json', '.cursor/mcp.json',
    '.codex/config.toml', '.agents/skills/x.md', 'orca.yaml', 'configuration.yaml',
    'hooks/pre-commit', 'AGENTS.md', 'opencode.json', 'automations.yaml',
  ];
  for (const path of excluded) {
    const input = snapshot(); input.changedFiles = [{ status: 'modified', path }];
    assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'excluded_path', path);
    input.changedFiles = [{ status: 'renamed', path: 'src/ordinary.js', previousPath: path }];
    assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'excluded_path', `renamed ${path}`);
    const mistakenPolicy = { ...POLICY, allowedPaths: [...POLICY.allowedPaths, path, 'src/ordinary.js'] };
    assert.equal(mergeEligibility(input, mistakenPolicy, NOW).reason, 'excluded_path', `explicitly listed source ${path}`);
    input.changedFiles = [{ status: 'modified', path }];
    assert.equal(mergeEligibility(input, mistakenPolicy, NOW).reason, 'excluded_path', `explicitly listed target ${path}`);
  }
});

test('only exact allowed paths pass, including both sides of a rename', () => {
  const input = snapshot();
  for (const path of ['src/unreviewed.js', 'Src/counter.js', 'src/counter.js/child']) {
    input.changedFiles = [{ status: 'modified', path }];
    assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'path_not_allowed', path);
  }
  input.changedFiles = [{ status: 'renamed', path: 'src/new.js', previousPath: 'src/unreviewed.js' }];
  assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'path_not_allowed');
  input.changedFiles = [{ status: 'renamed', path: 'src/unreviewed.js', previousPath: 'src/old.js' }];
  assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'path_not_allowed');
  input.changedFiles = [{ status: 'renamed', path: 'src/new.js', previousPath: 'src/old.js' }];
  assert.equal(mergeEligibility(input, POLICY, NOW).eligible, true);
});

test('allowedPaths is mandatory, bounded, unique and exact, without globs or unsafe paths', () => {
  for (const paths of [undefined, null, [], {}, 'src/counter.js', Array(1),
    ['src/counter.js', 'src/counter.js'], ['../src/counter.js'], ['src\\counter.js'],
    ['src/*'], ['src/**'], ['src/?.js'], ['src/[ab].js'], ['src/{a,b}.js'], ['!src/counter.js'],
    Array.from({ length: 201 }, (_, i) => `src/file-${i}.js`)]) {
    const policy = { ...POLICY, allowedPaths: paths };
    assert.equal(mergeEligibility(snapshot(), policy, NOW).reason, 'invalid_policy');
    assert.equal(normalizeSlackEvent(event(), policy, NOW).reason, 'invalid_policy');
  }
});

test('unsafe and ambiguous file paths fail closed', () => {
  for (const path of [undefined, null, [], '', '../secret', 'src/../secret', '/etc/passwd',
    'C:/secret', 'src\\file.js', 'src//file.js', 'src/./file.js', 'src/file.js/',
    'src/%2e%2e/secret', 'src/file.js\u0000', 'src/file.js\n', 'src/ name.js', 'src/file.js.',
    'x'.repeat(513), 'src/\ud800.js']) {
    const input = snapshot(); input.changedFiles = [{ status: 'modified', path }];
    assert.equal(mergeEligibility(input, POLICY, NOW).reason, 'invalid_file', String(path));
  }
  const input = snapshot();
  input.changedFiles = [{ status: 'renamed', path: 'src/new.js', previousPath: 'src/old.js' }];
  assert.equal(mergeEligibility(input, POLICY, NOW).eligible, true);
});

test('broken merge input and policy never imply eligibility', () => {
  for (const input of [undefined, null, [], '', 0, true, {}, { checks: null }]) {
    assert.equal(mergeEligibility(input, POLICY, NOW).eligible, false);
  }
  for (const policy of [undefined, null, {}, { ...POLICY, requiredChecks: [] },
    { ...POLICY, requiredChecks: ['test', 'test'] }, { ...POLICY, requiredChecks: [''] },
    { ...POLICY, requiredChecks: [' '] }, { ...POLICY, requiredChecks: Array(1) },
    { ...POLICY, allowedRepositories: [] }, { ...POLICY, allowedRepositories: ['../repo'] }]) {
    assert.equal(mergeEligibility(snapshot(), policy, NOW).eligible, false);
  }
});

test('both functions leave caller data unchanged and do not consult wall-clock state', () => {
  const inputEvent = event();
  const inputSnapshot = snapshot();
  const originals = structuredClone([inputEvent, inputSnapshot, POLICY]);
  const first = [normalizeSlackEvent(inputEvent, POLICY, NOW), mergeEligibility(inputSnapshot, POLICY, NOW)];
  const second = [normalizeSlackEvent(inputEvent, POLICY, NOW), mergeEligibility(inputSnapshot, POLICY, NOW)];
  assert.deepEqual(first, second);
  assert.deepEqual([inputEvent, inputSnapshot, POLICY], originals);
});
