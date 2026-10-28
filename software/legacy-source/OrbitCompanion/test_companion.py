import app, unittest, tempfile, threading, urllib.request, urllib.error,json
from pathlib import Path
class Checks(unittest.TestCase):
 def setUp(self):
  app.PROFILE=dict(app.DEFAULT);app.INVENTORY['apps']=[{'id':'safe.id','name':'Test app'}];app.INVENTORY['cameras']=[{'id':0,'name':'Test camera'}]
 def test_dpapi(self):
  secret='local-test-secret';sealed=app.protect(secret);self.assertNotIn(secret,sealed);self.assertEqual(app.protect(sealed,True),secret)
 def test_screen_validation(self):
  for pages in [[],[-1],[21],[True],['1']]:
   with self.assertRaises(ValueError):app.validate({'screens':pages})
  self.assertEqual(app.validate({'screens':[1,3,1]})['screens'],[0,1,3])
 def test_allowlisted_apps(self):
  with self.assertRaises(ValueError):app.validate({'apps':[{'id':'cmd.exe','name':'Command'}]})
  self.assertEqual(app.validate({'apps':[{'id':'safe.id'}]})['apps'][0]['id'],'safe.id')
 def test_address_validation(self):
  for address in ['evil.com/path','http://127.0.0.1','a:8080','x\nY']:
   with self.assertRaises(ValueError):app.validate({'address':address})
 def test_theme_validation(self):
  for t in [-1,4]:
   with self.assertRaises(ValueError):app.validate({"theme":t})
  for t in range(4):self.assertEqual(app.validate({"theme":t})["theme"],t)
 def test_command_retries(self):
  from unittest.mock import patch
  app.SEEN.clear();app.COMMAND_HISTORY.clear();app.ACK=None
  status={'command':'media:play','command_id':1,'command_session':'boot1'}
  with patch.object(app,'execute',return_value='Done') as execute,patch.object(app,'atomic') as persist:
   app.handle_command(status);app.handle_command(status)
   self.assertEqual(execute.call_count,1);self.assertEqual(app.ACK['result'],'Done')
   app.ACK=None;app.handle_command(status);self.assertEqual(execute.call_count,1)
   status['command_session']='boot2';app.handle_command(status);self.assertEqual(execute.call_count,2)
   self.assertEqual(app.COMMAND_HISTORY,['boot1:1','boot2:1'])
 def test_secret_redaction(self):
  app.SECRETS={'api_key':'test-only-secret','pair_key':'pair-only-secret'}
  self.assertNotIn('secret',json.dumps(app.public()))
 def test_expiring_message(self):
  app.message('Question','Ready?');self.assertLess(app.MESSAGE['expires']-app.time.time(),301);self.assertNotIn('expires',app.STATE)
 def test_http_guard(self):
  server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler);port=server.server_address[1];old=app.PORT;app.PORT=port
  threading.Thread(target=server.serve_forever,daemon=True).start()
  url=f'http://127.0.0.1:{port}'
  try:
   with urllib.request.urlopen(url+'/api/state') as r:state=json.load(r);self.assertIn('token',state);self.assertEqual(r.headers['Cross-Origin-Resource-Policy'],'same-origin')
   for headers in [{},{'Origin':'http://evil.test','X-Orbit-Token':app.TOKEN},{'Origin':url,'X-Orbit-Token':'wrong'}]:
    with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(urllib.request.Request(url+'/api/message',b'{}',headers=headers))
    self.assertEqual(e.exception.code,403)
   req=urllib.request.Request(url+'/api/message',json.dumps({'body':'Test question'}).encode(),headers={'Origin':url,'X-Orbit-Token':app.TOKEN,'Content-Type':'application/json'})
   with urllib.request.urlopen(req) as r:self.assertIn('id',json.load(r))
   with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(urllib.request.Request(url+'/api/state',headers={'Host':'evil.test'}))
   self.assertEqual(e.exception.code,403)
  finally:server.shutdown();server.server_close();app.PORT=old
if __name__=='__main__':unittest.main(verbosity=2)
