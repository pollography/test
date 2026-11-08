import {appendFile} from 'node:fs/promises';
import {githubApi,run} from './merge-guard.mjs';

// Fixed sandbox policy, reviewed alongside controller code. Proposed PRs cannot
// select a repository, workflow, check app, actor or broader file permission.
const policy={repository:'pollography/test',allowedRepositories:['pollography/test'],allowedPaths:['src/counter.js'],requiredChecks:['Pilot tests'],checkAppId:15368,workflowPath:'.github/workflows/ai-workshop.yml',receiptActor:'pollography',gateAppId:Number(process.env.MERGE_GATE_APP_ID)};
const phase=process.argv[2];
if(!['preflight','merge'].includes(phase))throw Error('invalid_phase');
if(process.env.GITHUB_REPOSITORY!==policy.repository||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('trusted_main_workflow_required');
const pr=Number(process.env.PR_NUMBER),sha=process.env.EXPECTED_SHA??'',receipt=Number(process.env.RECEIPT_COMMENT_ID);
const api=githubApi(process.env.GITHUB_TOKEN);
const gateApi=phase==='merge'?githubApi(process.env.MERGE_GATE_APP_TOKEN):null;
const result=await run(api,policy,{pr,sha,receipt,now:Date.now(),apply:phase==='merge',gateApi});
console.log(JSON.stringify(result));
if(!result.eligible&&!(phase==='preflight'&&result.reason==='waiting_one_hour'))throw Error(`merge_blocked:${result.reason}`);
if(phase==='preflight'){
  if(!process.env.GITHUB_OUTPUT)throw Error('workflow_output_missing');
  await appendFile(process.env.GITHUB_OUTPUT,`validated_sha=${sha}\nvalidated_pr=${pr}\nvalidated_receipt=${receipt}\n`);
}
