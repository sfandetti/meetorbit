import unittest,tempfile
from pathlib import Path
from unittest.mock import patch
import app,recordings_store,media_status,privacy_cleanup
from types import SimpleNamespace

class QuickRecordingChecks(unittest.TestCase):
 def setUp(self):app.PROFILE=dict(app.DEFAULT);app.INVENTORY['apps']=[]
 def test_quick_targets(self):
  self.assertEqual(app.validate({'quick_taps':[17,16,18]})['quick_taps'],[17,16,18])
  self.assertEqual(app.validate({'quick_taps':[-1,0,19]})['quick_taps'],[-1,0,19])
  for bad in [[0],[],[0,1,21],[True,1,2],[0,1,-2],['1',2,3],None]:
   with self.assertRaises(ValueError):app.validate({'quick_taps':bad})
 def test_recording_delete_scope(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);folder=root/'Recordings';folder.mkdir();clip=folder/'test.avi';clip.write_bytes(b'test')
   active=folder/'active.part.avi';active.write_bytes(b'live');outside=root/'outside.avi';outside.write_bytes(b'keep')
   self.assertEqual([x['name'] for x in recordings_store.list_recordings(root)],['test.avi'])
   for bad in ['../outside.avi',str(outside),'active.part.avi','',None,'test.txt','..\\outside.avi']:
    with self.assertRaises(ValueError):recordings_store.delete_recording(root,bad)
   recordings_store.delete_recording(root,'test.avi')
   self.assertFalse(clip.exists());self.assertTrue(active.exists());self.assertTrue(outside.exists())
 def test_busy_file_clear_error(self):
  with tempfile.TemporaryDirectory() as t:
   folder=Path(t)/'Recordings';folder.mkdir();(folder/'test.avi').write_bytes(b'test')
   with patch.object(Path,'unlink',side_effect=PermissionError):
    with self.assertRaisesRegex(ValueError,'in use'):recordings_store.delete_recording(t,'test.avi')
 def test_explorer_launch_and_failure(self):
  with tempfile.TemporaryDirectory() as t,patch.object(recordings_store.subprocess,'Popen') as launch:
   recordings_store.open_folder(t)
   args=launch.call_args.args[0];self.assertTrue(args[0].endswith('explorer.exe'));self.assertEqual(Path(args[1]),Path(t)/'Recordings')
   launch.side_effect=OSError
   with self.assertRaisesRegex(ValueError,'File Explorer'):recordings_store.open_folder(t)
 def test_media_unknown_does_not_fake_playing(self):
  self.assertEqual(media_status.playback_state(lambda *a,**k:'Playing'),'Playing')
  self.assertEqual(media_status.playback_state(lambda *a,**k:'unexpected'),'Unknown')
  def failed(*a,**k):raise TimeoutError
  self.assertEqual(media_status.playback_state(failed),'Unknown')
 def test_browser_cleanup_spans_profiles_only_selected_data(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)
   for name in ['Default','Profile 1','Guest Profile']:
    profile=root/name;(profile/'Network').mkdir(parents=True);(profile/'Cache').mkdir()
    (profile/'Network'/'Cookies').write_bytes(b'fixture-cookie')
    (profile/'Cache'/'data').write_bytes(b'fixture-cache')
    (profile/'Bookmarks').write_bytes(b'keep')
   with patch.object(privacy_cleanup,'browser_roots',return_value={'chrome':root}),patch.object(privacy_cleanup.subprocess,'run',return_value=SimpleNamespace(stdout='')):
    plan=privacy_cleanup.prepare({'privacy_browsers':['chrome_cookies','chrome_cache'],'privacy_folders':[]})
    self.assertEqual(plan['files'],4)
    result=privacy_cleanup.commit(plan['confirmation']);self.assertEqual(result['deleted'],4)
   for name in ['Default','Profile 1']:
    self.assertTrue((root/name/'Bookmarks').exists());self.assertFalse((root/name/'Network'/'Cookies').exists())
   self.assertTrue((root/'Guest Profile'/'Network'/'Cookies').exists())
 def test_running_browser_blocks_cleanup(self):
  with patch.object(privacy_cleanup.subprocess,'run',return_value=SimpleNamespace(stdout='"chrome.exe","1"')):
   with self.assertRaisesRegex(ValueError,'Close Chrome'):privacy_cleanup.prepare({'privacy_browsers':['chrome_cache']})
 def test_privacy_device_request_only_prepares_confirmation(self):
  with patch.object(app,'request_system',return_value='Confirm YES or NO') as request:
   self.assertEqual(app.execute('privacy:cleanup'),'Confirm YES or NO');request.assert_called_once_with('cleanup')

if __name__=='__main__':unittest.main(verbosity=2)
