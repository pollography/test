---
name: verify-ai-workshop
description: Verify the dependency-free AI workshop decision library in this repository.
---

# Verify AI workshop

Run from this repository's own checkout; never use another local project's files.
Read ai-workshop/package.json before choosing the existing test command.
1. Confirm the exact commit with git rev-parse HEAD and record it.
2. From ai-workshop, run node --check index.js and node --check test.js.
3. Run npm test. Require exit0; report actual test counts and failures.
4. For a bug fix, reproduce the reported behavior on the declared baseline,
   then verify the fix at the exact proposed SHA; do not invert success codes.
5. Include applicable malformed-input, permission, timeout and retry cases.

This is a CLI/library harness; GUI N/A. Passing it proves library behavior,
not Slack delivery, Linear creation, cloud-worker launch, phone push, a timer,
or an enforced merge. Those require their own current provider evidence.
Never merge/deploy or post outside the immutable source thread from a child.
