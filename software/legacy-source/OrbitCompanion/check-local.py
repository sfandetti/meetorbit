import app,json
app.load()
assert app.protect(app.protect('test-secret'),True)=='test-secret'
x=app.inventory()
print(json.dumps({'cameras':x['cameras'],'ports':x['ports'],'app_count':len(x['apps'])}))
