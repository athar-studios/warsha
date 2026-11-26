import json, pathlib, urllib.request, time, sys
base=pathlib.Path('/tmp/warsha-clean1-live')
# Read only this run's generated local RPC token; never print it.
import tomllib
config=tomllib.loads((base/'config.toml').read_text())
def rpc(method, **params):
    body=json.dumps(dict(jsonrpc='2.0',id=1,method=method,params=params)).encode()
    req=urllib.request.Request('http://127.0.0.1:39766/',data=body,headers={'Content-Type':'application/json','Authorization':'Bearer '+config['auth_token']})
    with urllib.request.urlopen(req,timeout=1200) as r: result=json.load(r)
    if 'error' in result: raise RuntimeError(str(result['error']))
    return result['result']
def save(name,obj): (base/name).write_text(json.dumps(obj,indent=2)+'\n')
roles=rpc('roles.list'); save('roles.json',roles)
for role in ['intake','researcher','pm','designer','architect','coder','reviewer','qa','security','release','marketer','feedback','secretary']:
    rpc('roles.set',config=dict(role=role,targets=[dict(provider_id='fake',model_id='warsha-fake-v1',weight=100)],fallback_enabled=False,budget_cents_per_run=None,daily_spend_cap_cents=None))
p=rpc('projects.create',name='proofcalc-live',description='Real OpenCode four-lane proofcalc',language='en',confinement='workspace_write',approval_mode='never_ask',repo_path=None)
save('project.json',p)
pid=p['id']
rpc('swarm.project.set',project_id=pid,enable_swarm=True,max_parallel_agents=4)
r=rpc('runs.start',project_id=pid,idea='Build proofcalc, the four disjoint pure Rust modules described by the task plan. Write only your assigned module. Do not stage or commit files. Cargo.toml, lib.rs and integration tests are sequential follow-ups supplied later.',run_mode=None,spec_file_path=None,budget_cents=50000)
save('start.json',r); rid=r['id']; print('run',rid,flush=True)
# Explicit runs.start budget avoids a concurrent budget.set write racing intake.
for step in range(120):
    r=rpc('runs.get',run_id=rid); save('run.json',r)
    stage=r['current_stage']; status=r['status']; print(stage,status,flush=True)
    if stage in ('review_qa_security','gate_c') or status in ('failed','paused','cancelled'): break
    if stage.startswith('gate_'):
        rpc('gates.approve',run_id=rid,stage=stage,device_id=None)
        r=rpc('runs.advance',run_id=rid); save('advance.json',r)
    else:
        # Wait for background intake or executing stage, rather than busy RPC polling.
        time.sleep(1)
else: raise RuntimeError('walk exceeded stage bound')
for method,name in [('runs.subtasks','subtasks.json'),('runs.worktree','worktree.json'),('runs.events','events.json')]:
    save(name,rpc(method,run_id=rid))
print('evidence saved',flush=True)
