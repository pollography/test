import { createHash } from 'node:crypto';

export const MERGE_DELAY_MS = 3_600_000;
export const MAX_SLACK_TEXT_BYTES = 4_000;
const MAX_FILES = 200;
const SHA = /^[a-f0-9]{40}$/;
const SLACK_TS = /^(?:0|[1-9][0-9]{0,12})\.[0-9]{6}$/;
const TEAM = /^T[A-Z0-9]{2,63}$/;
const CHANNEL = /^[CG][A-Z0-9]{2,63}$/;
const ACTOR = /^[UW][A-Z0-9]{2,63}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const BRANCH = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
// A JS `$` anchor can match before a final newline. Compare the entire match as well.
const matches = (value, pattern) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const text = (value, maxBytes = 200) => typeof value === 'string' && value.trim().length > 0 &&
  value.isWellFormed() && Buffer.byteLength(value, 'utf8') <= maxBytes &&
  !/[\x00-\x1f\x7f]/.test(value);
const list = (value, valid, limit = 100) => Array.isArray(value) && value.length > 0 &&
  value.length <= limit && [...value].every(valid) && new Set(value).size === value.length;
const repository = value => matches(value, REPOSITORY) &&
  !value.split('/').some(part => part === '.' || part === '..' || part.endsWith('.git'));
const baseBranchName = value => text(value, 255) && matches(value, BRANCH) && !value.includes('..') &&
  value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
const repositories = policy => object(policy) && list(policy.allowedRepositories, repository);
const allowedPaths = policy => object(policy) && list(policy.allowedPaths,
  value => safePath(value) && !/[!*?\[\]{}]/.test(value), MAX_FILES);
const reject = reason => ({ ok: false, reason });
const blocked = reason => ({ eligible: false, reason });
const micros = value => BigInt(value.replace('.', ''));

/** Validate an already authenticated Slack Events API event_callback envelope. No I/O. */
export function normalizeSlackEvent(payload, policy, nowMs) {
  if (!timestamp(nowMs)) return reject('invalid_now_ms');
  if (!repositories(policy) || !allowedPaths(policy) || !matches(policy.teamId, TEAM) ||
      !list(policy.channelIds, value => matches(value, CHANNEL)) ||
      !list(policy.actorIds, value => matches(value, ACTOR)) ||
      !repository(policy.repository) || !policy.allowedRepositories.includes(policy.repository)) {
    return reject('invalid_policy');
  }
  if (!object(payload) || payload.type !== 'event_callback' || !object(payload.event)) {
    return reject('unsupported_envelope');
  }
  const event = payload.event;
  if (event.type !== 'message' || ['subtype', 'bot_id', 'bot_profile', 'app_id'].some(key => Object.hasOwn(event, key)) ||
      (Object.hasOwn(event, 'hidden') && event.hidden !== false)) {
    return reject('unsupported_event');
  }
  if (payload.team_id !== policy.teamId ||
      (Object.hasOwn(event, 'team') && event.team !== payload.team_id)) return reject('workspace_not_allowed');
  if (!policy.channelIds.includes(event.channel)) return reject('channel_not_allowed');
  if (!policy.actorIds.includes(event.user)) return reject('actor_not_allowed');
  if (!matches(event.ts, SLACK_TS)) return reject('invalid_message_ts');
  if (micros(event.ts) > BigInt(nowMs) * 1_000n) return reject('future_message_ts');
  if (Object.hasOwn(event, 'thread_ts') && (!matches(event.thread_ts, SLACK_TS) ||
      micros(event.thread_ts) > micros(event.ts))) {
    return reject('invalid_thread_ts');
  }
  if (typeof event.text !== 'string' || !event.text.isWellFormed() ||
      Buffer.byteLength(event.text, 'utf8') > MAX_SLACK_TEXT_BYTES ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(event.text)) return reject('invalid_text');
  // One ASCII space is the command delimiter; leading space, suffixes and mentions do not match.
  if (!event.text.startsWith('!ai-fix ')) return reject('command_not_matched');
  const instruction = event.text.slice(8).trim();
  if (!instruction) return reject('empty_instruction');
  const idempotencyKey = `slack:${createHash('sha256')
    .update(JSON.stringify([payload.team_id, event.channel, event.ts])).digest('hex')}`;
  return {
    ok: true,
    event: {
      source: 'slack', idempotencyKey, teamId: payload.team_id, channelId: event.channel,
      actorId: event.user, messageTs: event.ts, threadTs: event.thread_ts ?? event.ts,
      repository: policy.repository, instruction,
    },
  };
}

function safePath(value) {
  return text(value, 1_024) && value.length <= 512 && !/[\\:%]/.test(value) &&
    !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..' &&
      part.trim() === part && !part.endsWith('.'));
}

function excludedPath(value) {
  const parts = value.toLowerCase().split('/');
  const name = parts.at(-1);
  if (parts.some(part => /^(?:\.git|\.github|\.gitlab|\.circleci|\.buildkite|\.husky|\.devcontainer|\.claude|\.cursor|\.codex|\.agents|\.agent|\.opencode|\.windsurf|\.githooks|\.hooks|hooks|agents|skills|orchestration|security|auth|authentication|authorization|permissions|credentials|secrets|deploy|deployment|deployments|migration|migrations|infra|infrastructure|terraform|helm|k8s|kubernetes|ansible|docker|\.storage|homeassistant|home-assistant|custom_components|blueprints)$/.test(part))) return true;
  return /^(?:security|auth|authentication|authorization|permissions|credentials|secrets|tokens?|sessions?|login|deploy|deployment|deployments|release|migrate|migration|migrations|hooks?|orchestration)(?:[._-]|$)/.test(name) ||
    /^(?:agents\.md|claude\.md|codex\.md|\.cursorrules|orca\.(?:ya?ml|jsonc?|toml)|opencode\.(?:jsonc?|ya?ml|toml)|mcp\.json|configuration\.ya?ml|automations\.ya?ml|scripts\.ya?ml|scenes\.ya?ml|groups\.ya?ml|customize\.ya?ml)$/.test(name) ||
    /^(?:\.env(?:[.-].*)?|\.npmrc|\.pypirc|\.yarnrc.*|\.pnp\..*|.*\.(?:pem|key)|codeowners|\.gitlab-ci\.yml|jenkinsfile|azure-pipelines.*|bitbucket-pipelines\.yml)$/.test(name) ||
    /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml|bun\.lockb?|requirements.*\.txt|pipfile(?:\.lock)?|pyproject\.toml|poetry\.lock|uv\.lock|cargo\.(?:toml|lock)|go\.(?:mod|sum)|gemfile(?:\.lock)?|composer\.(?:json|lock)|.*\.(?:csproj|fsproj|vbproj)|directory\.(?:packages|build)\.props|packages\.lock\.json)$/.test(name) ||
    /^(?:dockerfile.*|docker-compose.*|compose\.ya?ml|vercel\.json|netlify\.toml|firebase\.json|cloudbuild.*|.*\.(?:tf|tfvars|hcl)|wrangler\.(?:toml|json|jsonc)|serverless\.ya?ml|fly\.toml|procfile|render\.ya?ml|railway\.(?:json|toml))$/.test(name);
}

/** Evaluate caller-supplied fresh evidence. Does not merge, authenticate or enforce permissions. */
export function mergeEligibility(snapshot, policy, nowMs) {
  if (!timestamp(nowMs)) return blocked('invalid_now_ms');
  if (!repositories(policy) || !allowedPaths(policy) || !list(policy.requiredChecks, value => text(value, 100), 50) ||
      !baseBranchName(policy.baseBranch)) {
    return blocked('invalid_policy');
  }
  if (!object(snapshot)) return blocked('invalid_snapshot');
  if (!Object.hasOwn(snapshot, 'baseBranch')) return blocked('missing_base_branch');
  if (!baseBranchName(snapshot.baseBranch)) return blocked('invalid_base_branch');
  if (snapshot.baseBranch !== policy.baseBranch) return blocked('base_branch_mismatch');
  if (!repository(snapshot.repository) || !policy.allowedRepositories.includes(snapshot.repository) ||
      snapshot.headRepository !== snapshot.repository) return blocked('repository_not_allowed');
  if (!Number.isSafeInteger(snapshot.pullRequestNumber) || snapshot.pullRequestNumber <= 0 ||
      snapshot.state !== 'open') return blocked('pr_not_open');
  if (snapshot.draft !== false || snapshot.conflicts !== false || snapshot.veto !== false ||
      snapshot.changeRequested !== false) return blocked('pr_state_blocks');
  if (!matches(snapshot.headSha, SHA) ||
      snapshot.testedHeadSha !== snapshot.headSha) return blocked('untested_head');
  if (!timestamp(snapshot.headUpdatedAtMs) || snapshot.headUpdatedAtMs > nowMs) return blocked('invalid_head_time');
  if (snapshot.filesComplete !== true || !Array.isArray(snapshot.changedFiles) ||
      snapshot.changedFiles.length === 0 || snapshot.changedFiles.length > MAX_FILES) return blocked('incomplete_files');
  const paths = new Set();
  for (const file of snapshot.changedFiles) {
    if (!object(file) || !['added', 'modified', 'removed', 'renamed'].includes(file.status) ||
        !safePath(file.path) || paths.has(file.path) ||
        (file.status === 'renamed' ? !safePath(file.previousPath) || file.previousPath === file.path : Object.hasOwn(file, 'previousPath'))) {
      return blocked('invalid_file');
    }
    paths.add(file.path);
    if (excludedPath(file.path) || (file.status === 'renamed' && excludedPath(file.previousPath))) {
      return blocked('excluded_path');
    }
    if (!policy.allowedPaths.includes(file.path) ||
        (file.status === 'renamed' && !policy.allowedPaths.includes(file.previousPath))) {
      return blocked('path_not_allowed');
    }
  }
  // Require the exact configured check set. New/duplicate/unknown checks need explicit policy review.
  if (!Array.isArray(snapshot.checks) || snapshot.checks.length !== policy.requiredChecks.length) {
    return blocked('missing_or_unknown_checks');
  }
  const seen = new Set();
  let latestGreenMs = snapshot.headUpdatedAtMs;
  for (const check of snapshot.checks) {
    if (!object(check) || !policy.requiredChecks.includes(check.name) || seen.has(check.name)) {
      return blocked('missing_or_unknown_checks');
    }
    seen.add(check.name);
    if (check.status !== 'success') return blocked('check_not_successful');
    if (check.headSha !== snapshot.headSha) return blocked('stale_check_head');
    if (!timestamp(check.completedAtMs) || check.completedAtMs > nowMs ||
        check.completedAtMs < snapshot.headUpdatedAtMs) return blocked('invalid_check_time');
    latestGreenMs = Math.max(latestGreenMs, check.completedAtMs);
  }
  const notification = snapshot.notification;
  if (!object(notification) || notification.status !== 'success' || !text(notification.receiptId) ||
      notification.headSha !== snapshot.headSha || notification.pullRequestNumber !== snapshot.pullRequestNumber) {
    return blocked('missing_or_stale_notification');
  }
  if (!timestamp(notification.sentAtMs) || notification.sentAtMs > nowMs ||
      notification.sentAtMs < latestGreenMs) return blocked('invalid_notification_time');
  const eligibleAtMs = Math.max(latestGreenMs, notification.sentAtMs) + MERGE_DELAY_MS;
  if (!Number.isSafeInteger(eligibleAtMs)) return blocked('invalid_deadline');
  return nowMs < eligibleAtMs
    ? { eligible: false, reason: 'waiting_one_hour', eligibleAtMs }
    : { eligible: true, eligibleAtMs };
}

