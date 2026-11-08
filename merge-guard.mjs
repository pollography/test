// Trusted controller code only. Never check out or execute a proposed PR here.
import {mergeEligibility} from './ai-workshop/index.js';
const SHA=/^[a-f0-9]{40}$/;
const fail=reason=>{throw Error(reason);};
const integer=n=>Number.isSafeInteger(n)&&n>0;
const time=value=>{const n=Date.parse(value);return Number.isSafeInteger(n)&&n>=0?n:fail('invalid_timestamp');};

async function pages(api,path,key=null,max=500) {
  const all=[];
  for(let page=1;page<=Math.ceil(max/100)+1;page++) {
    const data=await api('GET',`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);
    const rows=key?data[key]:data;
    if(!Array.isArray(rows)||rows.length>100)fail('invalid_page');
    all.push(...rows);
    if(all.length>max)fail('page_limit');
    if(rows.length<100){if(key&&data.total_count!==all.length)fail('incomplete_pages');return all;}
  }
  fail('page_limit');
}

export async function collect(api,policy,prNumber,expectedSha,receiptId) {
  if(policy.repository!=='pollography/test'||!integer(prNumber)||!SHA.test(expectedSha)||!integer(receiptId))fail('invalid_scope');
  const pr=await api('GET',`/pulls/${prNumber}`);
  if(pr.number!==prNumber||pr.head?.sha!==expectedSha||pr.base?.repo?.full_name!==policy.repository||pr.base?.ref!=='main')fail('head_or_base_changed');
  const files=await pages(api,`/pulls/${prNumber}/files`,null,200);
  if(files.length!==pr.changed_files||new Set(files.map(f=>f.filename)).size!==files.length)fail('incomplete_files');
  const reviews=await pages(api,`/pulls/${prNumber}/reviews`);
  // A dismissed review is emitted as DISMISSED by GitHub. A request remains a veto
  // until explicitly dismissed; a later comment/approval never silently erases it.
  const changeRequested=reviews.some(r=>r.state==='CHANGES_REQUESTED');
  const comments=await pages(api,`/issues/${prNumber}/comments`);
  const timeline=await pages(api,`/issues/${prNumber}/timeline`);
  const receipt=comments.find(c=>c.id===receiptId);
  if(!receipt||receipt.user?.login!==policy.receiptActor||receipt.created_at!==receipt.updated_at)fail('untrusted_or_edited_receipt');
  let body;try{body=JSON.parse(receipt.body);}catch{fail('invalid_receipt');}
  if(body?.type!=='ai-notification-confirmed-v1'||body.pr!==prNumber||body.headSha!==expectedSha||typeof body.receiptHash!=='string'||!/^[a-f0-9]{64}$/.test(body.receiptHash))fail('stale_receipt');
  // This is an owner's attestation AFTER independently confirmed Slack delivery,
  // not a Slack adapter. Never put private Slack IDs/links in this public repo.
  const veto=comments.some(c=>c.user?.login===policy.receiptActor&&/^!ai-(?:veto|request-changes)(?:\s|$)/.test((c.body??'').trimStart()));
  const checks=await pages(api,`/commits/${expectedSha}/check-runs?filter=latest`,'check_runs');
  const selected=checks.filter(c=>policy.requiredChecks.includes(c.name));
  if(selected.length!==policy.requiredChecks.length)fail('missing_or_duplicate_checks');
  for(const c of selected) {
    if(c.app?.id!==policy.checkAppId||c.head_sha!==expectedSha)fail('untrusted_check');
    const match=/^https:\/\/github\.com\/pollography\/test\/actions\/runs\/([1-9][0-9]*)\/job\/[1-9][0-9]*$/.exec(c.details_url??'');
    if(!match)fail('untrusted_check_url');
    const wr=await api('GET',`/actions/runs/${match[1]}`);
    if(wr.head_sha!==expectedSha||wr.head_repository?.full_name!==policy.repository||wr.path!==policy.workflowPath||wr.event!=='pull_request'||wr.status!=='completed'||wr.conclusion!=='success')fail('untrusted_or_pending_workflow');
  }
  return {
    repository:policy.repository,headRepository:pr.head?.repo?.full_name,pullRequestNumber:prNumber,
    state:pr.state,draft:pr.draft,conflicts:pr.mergeable===true?false:true,veto,changeRequested,
    headSha:expectedSha,testedHeadSha:expectedSha,headUpdatedAtMs:Math.max(time(pr.created_at),...timeline.filter(e=>e.event==='head_ref_force_pushed').map(e=>time(e.created_at))),
    filesComplete:true,changedFiles:files.map(f=>({status:f.status,path:f.filename,...(f.status==='renamed'?{previousPath:f.previous_filename}:{})})),
    checks:selected.map(c=>({name:c.name,status:c.status==='completed'&&c.conclusion==='success'?'success':'unknown',headSha:c.head_sha,completedAtMs:time(c.completed_at)})),
    notification:{status:'success',headSha:body.headSha,pullRequestNumber:body.pr,receiptId:body.receiptHash,sentAtMs:time(receipt.created_at)},
  };
}

export const decide=(snapshot,policy,now)=>mergeEligibility(snapshot,policy,now);

export async function run(api,policy,{pr,sha,receipt,now,apply=false,gateApi=null}) {
  const snapshot=await collect(api,policy,pr,sha,receipt);
  const decision=decide(snapshot,policy,now);
  if(!apply||!decision.eligible)return {...decision,applied:false};
  if(!integer(policy.gateAppId)||policy.gateAppId===policy.checkAppId||!gateApi)fail('independent_gate_identity_required');
  // The controller is not safe to activate before server-side integration exists.
  const protection=await gateApi('GET','/branches/main/protection');
  const required=protection.required_status_checks;
  if(protection.enforce_admins?.enabled!==true||required?.strict!==true||!policy.requiredChecks.every(name=>required.checks?.some(c=>c.context===name&&c.app_id===policy.checkAppId))||!required.checks?.some(c=>c.context==='AI one-hour gate'&&c.app_id===policy.gateAppId))fail('server_protection_missing');
  const rulesets=await pages(gateApi,'/rulesets',null,100);
  const matches=rulesets.filter(r=>r.name==='AI merge controller only'&&r.enforcement==='active');
  if(matches.length!==1||!integer(matches[0].id))fail('exclusive_controller_rule_missing');
  const rule=await gateApi('GET',`/rulesets/${matches[0].id}`);
  const refs=rule.conditions?.ref_name;
  if(rule.target!=='branch'||rule.enforcement!=='active'||refs?.include?.length!==1||refs.include[0]!=='refs/heads/main'||refs.exclude?.length!==0||rule.bypass_actors?.length!==1||rule.bypass_actors[0].actor_type!=='Integration'||rule.bypass_actors[0].actor_id!==policy.gateAppId||rule.bypass_actors[0].bypass_mode!=='pull_request'||!rule.rules?.some(r=>r.type==='update'&&r.parameters?.update_allows_fetch_and_merge===false))fail('exclusive_controller_rule_changed');
  const env=await gateApi('GET','/environments/ai-merge-1h');
  const branches=await gateApi('GET','/environments/ai-merge-1h/deployment-branch-policies');
  if(env.can_admins_bypass!==false||!env.protection_rules?.some(r=>r.type==='wait_timer'&&r.wait_timer===60)||env.deployment_branch_policy?.custom_branch_policies!==true||branches.total_count!==1||branches.branch_policies?.length!==1||branches.branch_policies[0].name!=='main'||branches.branch_policies[0].type!=='branch')fail('native_wait_configuration_changed');
  const fresh=decide(await collect(api,policy,pr,sha,receipt),policy,now);
  if(!fresh.eligible)fail(`pre_merge_drift:${fresh.reason}`);
  const gate=await gateApi('POST','/check-runs',{name:'AI one-hour gate',head_sha:sha,status:'completed',conclusion:'success',completed_at:new Date(now).toISOString(),output:{title:'One-hour controller checks passed',summary:'Exact head, approved paths, trusted checks, confirmed notification age, current reviews and veto state checked.'}});
  if(gate.app?.id!==policy.gateAppId||gate.head_sha!==sha||gate.name!=='AI one-hour gate'||gate.conclusion!=='success')fail('gate_publication_not_verified');
  // One attempt only. A timeout has an uncertain outcome, not retry permission.
  let result,error;
  try{result=await gateApi('PUT',`/pulls/${pr}/merge`,{sha,merge_method:'squash'});}catch(e){error=e;}
  const observed=await api('GET',`/pulls/${pr}`);
  if(observed.merged===true&&observed.head?.sha===sha&&observed.base?.repo?.full_name===policy.repository&&observed.base?.ref==='main'&&observed.state==='closed'&&SHA.test(observed.merge_commit_sha??'')&&(!result?.sha||observed.merge_commit_sha===result.sha))return {...decision,applied:result?.merged===true?true:null,merged:true,outcome:result?.merged===true?'merged_and_reconciled':'observed_merged_writer_unknown',mergeSha:observed.merge_commit_sha};
  if(error)fail('merge_outcome_unknown_do_not_retry');
  fail(result?.merged===true?'merge_not_reconciled':'merge_rejected');
}

export function githubApi(token) {
  if(!token)fail('configured_token_missing');
  return async(method,endpoint,body)=>{
    if(!['GET','PUT','POST'].includes(method)||!/^\/[A-Za-z0-9_/?=&.\-]+$/.test(endpoint))fail('invalid_request');
    if(!new URL(`https://api.github.com/repos/pollography/test${endpoint}`).pathname.startsWith('/repos/pollography/test/'))fail('request_scope_escape');
    const response=await fetch(`https://api.github.com/repos/pollography/test${endpoint}`,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)fail(`github_http_${response.status}`);
    const text=await response.text();if(text.length>4_000_000)fail('response_too_large');
    return JSON.parse(text);
  };
}
