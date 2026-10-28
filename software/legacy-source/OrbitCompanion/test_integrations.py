import hashlib, io, json, os, sys, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
import app, ai_providers, shortcuts, privacy_cleanup

class Integrations(unittest.TestCase):
    def setUp(self):
        self.old_private=app.SECRETS;self.old_profile=app.PROFILE
        app.SECRETS={};app.PROFILE=dict(app.DEFAULT);app.PIN_FAILURES=0;app.PIN_BLOCKED_UNTIL=0
    def tearDown(self):app.SECRETS=self.old_private;app.PROFILE=self.old_profile
    def test_claude_request_and_text(self):
        captured=[]
        def response(request,**kwargs):captured.append(request);return io.BytesIO(json.dumps({'content':[{'type':'text','text':'Ready'}],'usage':{'input_tokens':4}}).encode())
        with patch.object(ai_providers.urllib.request,'urlopen',side_effect=response):
            answer,usage=ai_providers.ask({'ai_provider':'claude','model':'test-model'},{'claude_key':'test-private-key'},'Hi',Path('.'))
        self.assertEqual(answer,'Ready');self.assertEqual(usage['input_tokens'],4)
        request=captured[0];self.assertEqual(request.full_url,'https://api.anthropic.com/v1/messages')
        body=json.loads(request.data);self.assertEqual(body['messages'][0]['role'],'user');self.assertIn('system',body)
        self.assertEqual(request.get_header('X-api-key'),'test-private-key')
    def test_provider_keys_not_crossed(self):
        with self.assertRaises(ValueError):ai_providers.ask({'ai_provider':'claude','model':'test'},{'api_key':'openai-only'},'Hi',Path('.'))
    def test_cursor_ask_mode(self):
        with patch.object(ai_providers,'cursor_binary',return_value=sys.executable),patch.object(ai_providers.subprocess,'run') as run:
            run.return_value.returncode=0;run.return_value.stdout='Cursor reply'
            answer,_=ai_providers.ask({'ai_provider':'cursor'},{},'Hello',Path(tempfile.gettempdir())/'orbit-ask-test')
            args=run.call_args.args[0];self.assertIn('--mode=ask',args);self.assertNotIn('--force',args);self.assertEqual(answer,'Cursor reply')
    def test_executable_arguments_stay_arguments(self):
        with patch.object(shortcuts.subprocess,'Popen') as run:
            item={'kind':'executable','name':'Test','path':sys.executable,'arguments':'-c "print(1)" & literal','cwd':''}
            shortcuts.launch(item);self.assertFalse(run.call_args.kwargs['shell']);self.assertIn('& literal',run.call_args.args[0])
    def test_command_output_and_failure(self):
        shortcuts.RUNS.clear();shortcuts.launch({'kind':'command','name':'Test output','command':'echo Orbit-test-output','cwd':'','show_terminal':False})
        deadline=time.time()+5
        while shortcuts.status()[0]['state']=='Running' and time.time()<deadline:time.sleep(.02)
        result=shortcuts.status()[0];self.assertEqual(result['exit_code'],0);self.assertIn('Orbit-test-output',result['output'])
    def test_custom_validation(self):
        with self.assertRaises(ValueError):shortcuts.validate([{'kind':'executable','name':'Missing','path':'Z:/missing.exe'}],[],[])
        chosen=shortcuts.validate([{'kind':'command','name':'Script','command':'python script.py'}],[],[]);self.assertEqual(chosen[0]['command'],'python script.py')
        with self.assertRaises(ValueError):shortcuts.validate([{'kind':'system','action':'unknown'}],[],[])
    def test_pin_checks_and_redaction(self):
        app.SECRETS={'pin_salt':'test-salt','pin_hash':hashlib.sha256(b'test-salt1234').hexdigest()}
        app.require_pin('1234')
        for i in range(5):
            with self.assertRaises(ValueError):app.require_pin('0000')
        with self.assertRaises(ValueError):app.require_pin('1234')
        public=json.dumps(app.public());self.assertNotIn('test-salt',public);self.assertNotIn(app.SECRETS['pin_hash'],public)
    def test_protected_folders(self):
        for p in [Path.home(),Path(os.environ['SystemRoot']),Path.home()/'AppData']:
            with self.assertRaises(ValueError):privacy_cleanup.validate_folders([str(p)],[app.ROOT,app.DATA])
    def test_cleanup_confirmation_and_changed_files(self):
        artifact=Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory(prefix='orbit-cleanup-fixture-',dir=artifact) as folder:
            root=Path(folder);self.assertEqual(root.parent,artifact)
            f=root/'disposable-test.txt';f.write_text('test fixture')
            folders=privacy_cleanup.validate_folders([str(root)],[app.ROOT,app.DATA])
            profile={'privacy_folders':folders,'privacy_browsers':[]};plan=privacy_cleanup.prepare(profile)
            f.write_text('changed test fixture')
            with self.assertRaises(ValueError):privacy_cleanup.commit(plan['confirmation'])
            self.assertTrue(f.exists());plan=privacy_cleanup.prepare(profile);result=privacy_cleanup.commit(plan['confirmation'])
            self.assertEqual(result['deleted'],1);self.assertTrue(root.exists());self.assertFalse(f.exists())
            with self.assertRaises(ValueError):privacy_cleanup.commit(plan['confirmation'])
    def test_no_session_action_runs_during_setup(self):
        with patch.object(app.subprocess,'Popen') as run:
            selected=shortcuts.validate([{'kind':'system','action':'signout'}],[],[])
            self.assertEqual(selected[0]['action'],'signout');run.assert_not_called()
    def test_alarm_stop(self):
        with patch('alarm_audio.winsound.PlaySound') as play:
            app.ALARM.stop();self.assertFalse(app.ALARM.active);play.assert_called()

if __name__=='__main__':unittest.main()
