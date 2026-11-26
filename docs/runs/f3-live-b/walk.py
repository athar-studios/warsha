import json, pathlib, urllib.request, time, tomllib
base=pathlib.Path('/home/moe/tools/f3-live-b')
out=base/'evidence'; out.mkdir(exist_ok=True)
config=tomllib.loads((base/'config.toml').read_text())  # token never printed
def rpc(method, **params):
    body=json.dumps(dict(jsonrpc='2.0',id=1,method=method,params=params)).encode()
    req=urllib.request.Request('http://127.0.0.1:19211/',data=body,headers={'Content-Type':'application/json','Authorization':'Bearer '+config['auth_token']})
    with urllib.request.urlopen(req,timeout=3600) as r: result=json.load(r)
    if 'error' in result: raise RuntimeError(method+': '+str(result['error']))
    return result['result']
def save(name,obj): (out/name).write_text(json.dumps(obj,indent=2)+'\n')
save('roles-before.json',rpc('roles.list'))
for role in ['intake','researcher','pm','designer','architect','coder','reviewer','qa','security','release','marketer','feedback','secretary']:
    rpc('roles.set',config=dict(role=role,targets=[dict(provider_id='fake',model_id='warsha-fake-v1',weight=100)],fallback_enabled=False,budget_cents_per_run=None,daily_spend_cap_cents=None))
p=rpc('projects.create',name='proofcalc-f3b',description='F3 attempt B: real OpenCode four-lane proofcalc',language='en',confinement='workspace_write',approval_mode='never_ask',repo_path=None)
save('project.json',p); pid=p['id']
save('swarm-set.json',rpc('swarm.project.set',project_id=pid,enable_swarm=True,max_parallel_agents=4))
r=rpc('runs.start',project_id=pid,idea='Build proofcalc, the four disjoint pure Rust modules described by the task plan. Write only your assigned module. Do not stage or commit files. Cargo.toml, lib.rs and integration tests are sequential follow-ups supplied later.',run_mode=None,spec_file_path=None,budget_cents=50000)
save('start.json',r); rid=r['id']; print('run',rid,flush=True)
trace=[]; captured_gate_c=False
for step in range(400):
    r=rpc('runs.get',run_id=rid); save('run.json',r)
    stage=r['current_stage']; status=r['status']
    if not trace or trace[-1]!=(stage,status): trace.append((stage,status)); print(time.strftime('%H:%M:%S'),stage,status,flush=True)
    if status in ('completed','failed','cancelled'): break
    if status=='paused': print('PAUSED',json.dumps(r)[:2000],flush=True); break
    if stage=='gate_c' and not captured_gate_c:
        for method,name in [('runs.subtasks','subtasks-gate-c.json'),('runs.worktree','worktree-gate-c.json'),('runs.events','events-gate-c.json')]:
            save(name,rpc(method,run_id=rid))
        captured_gate_c=True
    if stage.startswith('gate_'):
        save('approve-'+stage+'.json',rpc('gates.approve',run_id=rid,stage=stage,device_id=None))
        save('advance-after-'+stage+'.json',rpc('runs.advance',run_id=rid))
    elif stage=='idea':
        time.sleep(2)  # background intake
    else:
        save('advance-from-'+stage+'.json',rpc('runs.advance',run_id=rid))
else: raise RuntimeError('walk exceeded stage bound')
save('stage-trace.json',trace)
for method,name in [('runs.get','run-final.json'),('runs.subtasks','subtasks.json'),('runs.worktree','worktree.json'),('runs.events','events.json'),('runs.artifacts','artifacts.json')]:
    try: save(name,rpc(method,run_id=rid))
    except Exception as e: print(method,'failed',e,flush=True)
print('final',r['current_stage'],r['status'],flush=True)
