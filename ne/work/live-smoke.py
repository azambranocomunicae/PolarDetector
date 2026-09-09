import json,urllib.request,urllib.error,time
cases=[('search','https://bsky.app/search?q=climate'),('feed','https://bsky.app/profile/did:plc:qrz3lhbyuxbeilrc6nekdqme/feed/67d312af68b6'),('invalid','https://example.com/private')]
for label,url in cases:
 t=time.monotonic()
 req=urllib.request.Request('http://localhost:3000/api/analyze',data=json.dumps({'url':url,'window':'24h'}).encode(),headers={'Content-Type':'application/json'})
 try:r=urllib.request.urlopen(req,timeout=120)
 except urllib.error.HTTPError as e:r=e
 d=json.load(r)
 with open('work/live-'+label+'.json','w') as f:json.dump(d,f,ensure_ascii=False)
 a=d.get('analysis') or {}
 print(json.dumps({'case':label,'http':r.code,'status':d.get('status'),'posts':len(d.get('posts',[])),'score':a.get('score'),'coverage':a.get('coverage'),'groups':[(g['label'],round(g['share'],3)) for g in a.get('groups',[])],'error':d.get('error'),'seconds':round(time.monotonic()-t,1)},ensure_ascii=False),flush=True)
