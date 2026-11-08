import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collect, decide, run, githubApi} from './merge-guard.mjs';
const SHA='a'.repeat(40), NOW=1_800_000_000_000;
const policy={repository:'pollography/test',allowedRepositories:['pollography/test'],allowedPaths:['src/counter.js'],requiredChecks:['Pilot tests'],checkAppId:15368,workflowPath:'.github/workflows/ai-workshop.yml',receiptActor:'pollography',gateAppId:90001};
function fixture() {
  const old=new Date(NOW-7_200_000).toISOString();
  const pr={number:7,state:'open',draft:false,mergeable:true,mergeable_state:'clean',changed_files:1,created_at:old,head:{sha:SHA,repo:{full_name:policy.repository}},base:{ref:'main',repo:{full_name:policy.repository}}};
  const receipt={id:90,user:{login:'pollography'},created_at:new Date(NOW-3_600_000).toISOString(),updated_at:new Date(NOW-3_600_000).toISOString(),body:JSON.stringify({type:'ai-notification-confirmed-v1',pr:7,headSha:SHA,receiptHash:'c'.repeat(64)})};
  const data={
    '/pulls/7':pr,
    '/pulls/7/files?per_page=100&page=1':[{filename:'src/counter.js',status:'modified'}],
    '/pulls/7/reviews?per_page=100&page=1':[],
    '/issues/7/timeline?per_page=100&page=1':[],
    '/issues/7/comments?per_page=100&page=1':[receipt],
    [`/commits/${SHA}/check-runs?filter=latest&per_page=100&page=1`]:{total_count:1,check_runs:[{name:'Pilot tests',head_sha:SHA,status:'completed',conclusion:'success',completed_at:old,app:{id:15368},details_url:'https://github.com/pollography/test/actions/runs/12/job/34'}]},
    '/actions/runs/12':{head_sha:SHA,head_repository:{full_name:policy.repository},path:policy.workflowPath,event:'pull_request',status:'completed',conclusion:'success'},
    '/branches/main/protection':{enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:[{context:'Pilot tests',app_id:15368},{context:'AI one-hour gate',app_id:90001}]}},
    '/rulesets?per_page=100&page=1':[{id:1,name:'AI merge controller only',enforcement:'active'}],
    '/rulesets/1':{target:'branch',enforcement:'active',conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},bypass_actors:[{actor_type:'Integration',actor_id:90001,bypass_mode:'pull_request'}],rules:[{type:'update',parameters:{update_allows_fetch_and_merge:false}}]},
    '/environments/ai-merge-1h':{can_admins_bypass:false,protection_rules:[{type:'wait_timer',wait_timer:60}],deployment_branch_policy:{custom_branch_policies:true}},
    '/environments/ai-merge-1h/deployment-branch-policies':{total_count:1,branch_policies:[{type:'branch',name:'main'}]},
  };
  const calls=[];
  const gateApi=async(method,path,body)=>{if(method!=='POST')return api(method,path,body);calls.push({method,path,body});return {...body,app:{id:90001}};};
  const api=async(method,path,body)=>{calls.push({method,path,body});if(method==='PUT') {data['/pulls/7']={...pr,state:'closed',merged:true,merge_commit_sha:'b'.repeat(40)};return {merged:true,sha:'b'.repeat(40)};}assert.ok(path in data,`unexpected request ${path}`);return structuredClone(data[path]);};
  return {data,calls,api,gateApi};
}
test('real API shape supplies an eligible exact-head snapshot',async()=>{const f=fixture();const snapshot=await collect(f.api,policy,7,SHA,90);assert.equal(decide(snapshot,policy,NOW).eligible,true);assert.equal(f.calls.some(c=>c.method!=='GET'),false);});
test('one millisecond early cannot merge',async()=>{const f=fixture();const result=await run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW-1,apply:true,gateApi:f.gateApi});assert.equal(result.eligible,false);assert.equal(f.calls.some(c=>c.method==='PUT'),false);});
test('dry run never writes even when eligible',async()=>{const f=fixture();const result=await run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW,apply:false});assert.equal(result.eligible,true);assert.equal(f.calls.some(c=>c.method==='PUT'),false);});
test('merge uses expected SHA and reconciles state',async()=>{const f=fixture();const result=await run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW,apply:true,gateApi:f.gateApi});assert.equal(result.merged,true);assert.deepEqual(f.calls.find(c=>c.method==='PUT').body,{sha:SHA,merge_method:'squash'});});
for(const [name,mutate] of [
 ['new head',f=>f.data['/pulls/7'].head.sha='d'.repeat(40)],
 ['fork',f=>f.data['/pulls/7'].head.repo.full_name='evil/test'],
 ['unknown mergeability',f=>f.data['/pulls/7'].mergeable=null],
 ['truncated files',f=>f.data['/pulls/7'].changed_files=2],
 ['spoofed check app',f=>f.data[`/commits/${SHA}/check-runs?filter=latest&per_page=100&page=1`].check_runs[0].app.id=1],
 ['different workflow',f=>f.data['/actions/runs/12'].path='evil.yml'],
 ['edited receipt',f=>f.data['/issues/7/comments?per_page=100&page=1'][0].updated_at=new Date(NOW).toISOString()],
 ['other receipt author',f=>f.data['/issues/7/comments?per_page=100&page=1'][0].user.login='evil'],
 ['veto',f=>f.data['/issues/7/comments?per_page=100&page=1'].push({id:91,user:{login:'pollography'},body:'!ai-veto',created_at:new Date(NOW).toISOString()})],
 ['change requested',f=>f.data['/pulls/7/reviews?per_page=100&page=1'].push({user:{login:'reviewer'},state:'CHANGES_REQUESTED'})],
 ['force push after checks',f=>f.data['/issues/7/timeline?per_page=100&page=1'].push({event:'head_ref_force_pushed',created_at:new Date(NOW-60_000).toISOString()})],
 ['missing branch enforcement',f=>f.data['/branches/main/protection'].enforce_admins.enabled=false],
 ['environment bypass enabled',f=>f.data['/environments/ai-merge-1h'].can_admins_bypass=true],
 ['extra environment branch',f=>{f.data['/environments/ai-merge-1h/deployment-branch-policies'].total_count=2;}],
]) test(`${name} fails closed without merge`,async()=>{const f=fixture();mutate(f);let result,error;try{result=await run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW,apply:true,gateApi:f.gateApi});}catch(e){error=e;}const expected={ 'new head':'head_or_base_changed',fork:'repository_not_allowed','unknown mergeability':'pr_state_blocks','truncated files':'incomplete_files','spoofed check app':'untrusted_check','different workflow':'untrusted_or_pending_workflow','edited receipt':'untrusted_or_edited_receipt','other receipt author':'untrusted_or_edited_receipt',veto:'pr_state_blocks','change requested':'pr_state_blocks','force push after checks':'invalid_check_time','missing branch enforcement':'server_protection_missing','environment bypass enabled':'native_wait_configuration_changed','extra environment branch':'native_wait_configuration_changed'};assert.equal(error?.message??result?.reason,expected[name]);assert.equal(f.calls.some(c=>c.method==='PUT'||c.method==='POST'),false);});
test('merge timeout is reconciled once and never retried',async()=>{const f=fixture();let writes=0;const gateApi=async(method,path,body)=>{if(method==='PUT'){writes++;throw Error('timeout');}return f.gateApi(method,path,body);};await assert.rejects(run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW,apply:true,gateApi}),/outcome_unknown/);assert.equal(writes,1);});
test('lost merge response is reported as observed with unknown writer',async()=>{const f=fixture();let writes=0;const gateApi=async(method,path,body)=>{if(method==='PUT'){writes++;await f.gateApi(method,path,body);throw Error('timeout');}return f.gateApi(method,path,body);};const result=await run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW,apply:true,gateApi});assert.equal(result.merged,true);assert.equal(result.applied,null);assert.equal(result.outcome,'observed_merged_writer_unknown');assert.equal(writes,1);});
test('transport rejects repository traversal before any network request',async()=>{await assert.rejects(githubApi('synthetic-token')('GET','/../../evil'));});
test('a full hundred-file page is completed by a second API page',async()=>{const f=fixture();f.data['/pulls/7'].changed_files=100;f.data['/pulls/7/files?per_page=100&page=1']=Array.from({length:100},(_,i)=>({filename:`src/file${i}.js`,status:'modified'}));f.data['/pulls/7/files?per_page=100&page=2']=[];const snapshot=await collect(f.api,policy,7,SHA,90);assert.equal(snapshot.changedFiles.length,100);assert.equal(decide(snapshot,policy,NOW).eligible,false);assert.ok(f.calls.some(c=>c.path.endsWith('files?per_page=100&page=2')));});

for(const [name,mutate,reason] of [
  ['late veto',f=>f.data['/issues/7/comments?per_page=100&page=1'].push({user:{login:'pollography'},body:'  !ai-veto'}),/pre_merge_drift:pr_state_blocks/],
  ['late review request',f=>f.data['/pulls/7/reviews?per_page=100&page=1'].push({state:'CHANGES_REQUESTED'}),/pre_merge_drift:pr_state_blocks/],
  ['receipt deletion',f=>f.data['/issues/7/comments?per_page=100&page=1']=[],/untrusted_or_edited_receipt/],
  ['base retarget',f=>f.data['/pulls/7'].base.ref='other',/head_or_base_changed/],
]) test(`${name} after initial collect is rechecked before publication`,async()=>{
  const f=fixture();let changed=false;
  const gateApi=async(method,path,body)=>{if(path==='/environments/ai-merge-1h'&&!changed){changed=true;mutate(f);}return f.gateApi(method,path,body);};
  await assert.rejects(run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW,apply:true,gateApi}),reason);
  assert.equal(f.calls.some(c=>c.method==='PUT'||c.method==='POST'),false);
});
test('unknown or shared gate identity cannot publish or merge',async()=>{for(const gateAppId of [undefined,15368]){const f=fixture();await assert.rejects(run(f.api,{...policy,gateAppId},{pr:7,sha:SHA,receipt:90,now:NOW,apply:true,gateApi:f.gateApi}),/independent_gate_identity_required/);assert.equal(f.calls.some(c=>c.method!=='GET'),false);}});
test('main update rule must name only the dedicated app',async()=>{const f=fixture();f.data['/rulesets/1'].bypass_actors.push({actor_type:'RepositoryRole',actor_id:5,bypass_mode:'always'});await assert.rejects(run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW,apply:true,gateApi:f.gateApi}),/exclusive_controller_rule_changed/);assert.equal(f.calls.some(c=>c.method!=='GET'),false);});
test('deleted head repository is not accepted',async()=>{const f=fixture();f.data['/pulls/7'].head.repo=null;const result=await run(f.api,policy,{pr:7,sha:SHA,receipt:90,now:NOW,apply:true,gateApi:f.gateApi});assert.equal(result.reason,'repository_not_allowed');assert.equal(f.calls.some(c=>c.method!=='GET'),false);});
test('201-file PR is rejected at the explicit pagination ceiling',async()=>{const f=fixture();f.data['/pulls/7'].changed_files=201;for(let page=1;page<=3;page++)f.data[`/pulls/7/files?per_page=100&page=${page}`]=Array.from({length:page===3?1:100},(_,i)=>({filename:`src/f${page}-${i}.js`,status:'modified'}));await assert.rejects(collect(f.api,policy,7,SHA,90),/page_limit/);assert.equal(f.calls.some(c=>c.method!=='GET'),false);});
