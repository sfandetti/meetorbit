import json, os, shutil, subprocess, urllib.request
from pathlib import Path

INSTRUCTIONS='You are Orbit, a helpful PC desk companion. Answer in under 200 characters for a small display. Do not claim to execute PC actions or approve actions in other applications.'
KEYS={'openai':'api_key','claude':'claude_key','cursor':'cursor_key'}

def cursor_binary(configured=''):
    candidates=[configured] if configured else [shutil.which('agent.exe'),shutil.which('cursor-agent.exe'),str(Path.home()/'.local/bin/agent.exe')]
    return next((str(Path(p).resolve()) for p in candidates if p and Path(p).is_file() and Path(p).suffix.lower()=='.exe'),'')

def ask(profile,secrets,prompt,workdir):
    provider=profile.get('ai_provider','openai');key=secrets.get(KEYS[provider],'');model=profile.get('model','')
    if provider=='cursor':
        binary=cursor_binary(profile.get('cursor_path',''))
        if not binary:raise ValueError('Install Cursor CLI or select its agent.exe in AI desk')
        workdir.mkdir(parents=True,exist_ok=True)
        cmd=[binary,'--mode=ask','--print','--output-format','text']
        if model:cmd+=['--model',model]
        cmd+=[INSTRUCTIONS+'\n\n'+str(prompt)[:2000]]
        env=os.environ.copy()
        if key:env['CURSOR_API_KEY']=key
        try:p=subprocess.run(cmd,cwd=workdir,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=65,creationflags=0x08000000)
        except subprocess.TimeoutExpired:raise ValueError('Cursor timed out. Try a shorter prompt') from None
        if p.returncode:raise ValueError('Cursor could not answer. Sign into Cursor CLI or check its API key')
        return p.stdout.strip(),{}
    if not key or not model:raise ValueError('Save a provider API key and choose a model in AI desk')
    if provider=='claude':
        url='https://api.anthropic.com/v1/messages';headers={'x-api-key':key,'anthropic-version':'2023-06-01','Content-Type':'application/json'}
        body={'model':model,'system':INSTRUCTIONS,'messages':[{'role':'user','content':str(prompt)[:2000]}],'max_tokens':256}
    else:
        url='https://api.openai.com/v1/responses';headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'}
        body={'model':model,'instructions':INSTRUCTIONS,'input':str(prompt)[:2000],'max_output_tokens':160}
    with urllib.request.urlopen(urllib.request.Request(url,json.dumps(body).encode(),headers),timeout=60) as r:result=json.load(r)
    answer=' '.join(c.get('text','') for c in result.get('content',[]) if c.get('type')=='text') if provider=='claude' else ' '.join(c.get('text','') for o in result.get('output',[]) for c in o.get('content',[]) if c.get('type')=='output_text')
    return answer,result.get('usage',{})

def models(profile,secrets):
    provider=profile.get('ai_provider','openai')
    if provider=='cursor':return []
    key=secrets.get(KEYS[provider])
    if not key:raise ValueError('Save an API key for the selected provider first')
    url='https://api.anthropic.com/v1/models?limit=100' if provider=='claude' else 'https://api.openai.com/v1/models'
    headers={'x-api-key':key,'anthropic-version':'2023-06-01'} if provider=='claude' else {'Authorization':'Bearer '+key}
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=15) as r:data=json.load(r)
    return sorted(m['id'] for m in data['data'] if provider=='claude' or m['id'].startswith(('gpt-','o3','o4')) and not any(x in m['id'] for x in ['audio','realtime','transcribe','tts','image','search','codex']))
