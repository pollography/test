# One-hour merge controller: awaiting authorization and live acceptance

This setup is limited to public `pollography/test`. No private Slack IDs, house
data, credentials, paid services, background daemon or new schedule are included.

The CI job runs dependency-free tests with a read-only token and no environment
secret. Proposed code is never checked out by the privileged merge workflow.
The workflow reads trusted controller code at the dispatch's immutable main SHA.

The owner confirms a notification only **after** separately verified Slack delivery
by posting a JSON-only PR comment with these fields:

```
{"type":"ai-notification-confirmed-v1","pr":7,"headSha":"FULL_TESTED_SHA","receiptHash":"SHA256_OF_PRIVATE_DELIVERY_RECEIPT"}
```

Do not paste private Slack URLs, channel IDs or message text into this public
repository. This comment is an explicit trusted-owner attestation, not an
implemented Slack adapter. Its author, PR, exact head, age and visible edit
timestamp are checked. Same-second edits cannot be reliably detected with REST
timestamps alone; the owner must be trusted. Automatic native Grok attestation
and actual mobile push remain separate acceptance items.

Dispatch `Guarded one-hour merge` on **main** with PR number, exact tested SHA and
comment ID. Preflight must pass before the job enters `ai-merge-1h`. The native
60-minute environment wait releases the dedicated App key only to a main job.
Current GitHub checks must originate from Actions App15368, the named workflow,
the exact head and a completed successful PR run. Only `src/counter.js` is an
automatic-change path; tests and controller/workflow files are excluded.

Immediately before writing, the controller reads comments, reviews, receipt,
files, checks and base/head again. All configured conditions must pass. Veto
command in an owner PR comment: `!ai-veto` or `!ai-request-changes`. Any outstanding
CHANGES_REQUESTED review blocks. Releasing an owner comment veto currently needs
its explicit deletion; no text command silently overrides it.

Actual mutation requires a distinct private GitHub App, not the shared Actions
identity. A main update ruleset must allow only that App in pull-request mode,
and separate enforced branch checks must require `Pilot tests` and the App's
`AI one-hour gate`. App administration is read-only; it cannot rewrite these rules.
App installation is only for this sandbox. No App or rule has been activated by
the local packaging/test step.
Reuse an existing suitably scoped dedicated App after verifying its real
installation and permissions; this package does not require creating a duplicate.
The installation token requests only checks/contents write and
administration/pull-requests read. Receipt/comments and Actions provenance stay
on the ordinary read-only workflow token; the App token needs neither issues
nor Actions access for this controller.

Setup and first real use are **not accepted yet**: App access approval/install,
main bootstrap review, rule/token verification under the real identity, direct
worker bypass rejection, a real eligible one-hour run and confirmed Slack
backflow are required. Existing DraftPR3 changes workflow/security setup and is
not an automatically eligible feature PR. A controller test success is not
permission to merge that setup PR.

The package includes 114 controller/policy tests and three separate behavior
tests importing `src/counter.js`. The bounded counter is explicitly a synthetic
fixture for the public sandbox's one-hour acceptance run, not a real product
fix or substitute for the Candler cloud-workflow acceptance. Its behavior tests
cover increment/decrement, both clamps and invalid values/changes. The fixture
tests are excluded from automatic-change permissions and need the reviewed
manual bootstrap. CI also rejects syntax-broken counter code or a missing test
file. Local passes do not prove the protected baseline is installed on main;
that installation and live feature CI still need verification before activation.

The merge API uses an expected head SHA and exactly one mutation attempt.
Up to three read-only queries reconcile the result, with one-second pauses only
while the same target still appears open. A denied read or conflicting/terminal
state stops reconciliation. An observed merge with no successful write response
has unknown attribution. The merge mutation is never blindly retried.
After publishing the gate, at most six read-only PR queries (one-second pauses)
wait for GitHub's aggregate mergeability to include the completed required check.
Changed base/head/state or continued blocking aborts without a merge request.
The full receipt/check/review/veto snapshot is collected again after this wait.
Metadata and comment checks are not transactionally atomic with GitHub's merge
API; a concurrent-edit race remains and must be represented in acceptance limits.

Packaging reuses the already tested `ai-workshop/index.js` decision core unchanged.
No runtime packages are installed. Local controller source differs only in its
relative import path (`cloud-loop-pilot` locally, `ai-workshop` in this release).
