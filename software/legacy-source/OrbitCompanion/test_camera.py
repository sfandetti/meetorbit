import sys,unittest,tempfile,json,threading
from pathlib import Path
import app
from camera_worker import motion_percent,rgb565,recording_frame
from camera_manager import CameraManager
import numpy as np
from unittest.mock import patch
class CameraChecks(unittest.TestCase):
 def test_motion_static_and_changed(self):
  gray=np.zeros((90,160),dtype=np.uint8);background=gray.astype('float32')
  self.assertEqual(motion_percent(gray,background),0)
  gray[20:50,30:70]=255;self.assertGreater(motion_percent(gray,background),5)
 def test_pixel_transport(self):
  frame=np.zeros((90,160,3),dtype=np.uint8);frame[:,:,2]=255
  data=rgb565(frame);self.assertEqual(len(data),28800);self.assertEqual(data[:2],b'\xf8\x00')
 def test_native_worker_failure_contained(self):
  with tempfile.TemporaryDirectory() as t:
   camera=CameraManager(t,Path(t),lambda:{'camera':0},lambda:('127.0.0.1',''),threading.Event())
   camera.mode='sentry';camera.armed=True
   class Dead:
    def poll(self):return -1073741819
   camera.process=Dead();camera.tick(True,19)
   self.assertFalse(camera.armed);self.assertEqual(camera.status()['state'],'Error');self.assertIn('driver',camera.status()['error'])
 def test_new_frames_not_marked_as_sent(self):
  import os
  from unittest.mock import MagicMock
  with tempfile.TemporaryDirectory() as t:
   path=Path(t)/'camera-frame.bin';path.write_bytes(b'\0'*28800);before=path.stat().st_mtime
   camera=CameraManager(t,Path(t),lambda:{'camera':0},lambda:('127.0.0.1','test'),threading.Event())
   reply=MagicMock()
   def enter():
    os.utime(path,(before+1,before+1));return reply
   reply.__enter__.side_effect=enter
   with patch('camera_manager.urllib.request.urlopen',return_value=reply):camera.upload()
   self.assertEqual(camera.last_frame_sent,before)
   self.assertGreater(path.stat().st_mtime,camera.last_frame_sent)
 def test_recording_overlays(self):
  frame=np.zeros((360,640,3),dtype=np.uint8)
  self.assertTrue(np.array_equal(frame,recording_frame(frame,{'timestamp':False,'camera_name':''})))
  output=recording_frame(frame,{'timestamp':True,'camera_name':'Test webcam'})
  self.assertGreater(np.count_nonzero(output[339:]),0)
  self.assertEqual(np.count_nonzero(frame),0)
 def test_manual_record_persists_without_display(self):
  with tempfile.TemporaryDirectory() as t:
   camera=CameraManager(t,Path(t),lambda:{'camera':0},lambda:('127.0.0.1',''),threading.Event())
   with patch.object(camera,'control') as control:
    camera.record();control.assert_called_once_with('manual');self.assertFalse(camera.armed)
   camera.mode='manual'
   with patch.object(camera,'stop') as stop:
    camera.tick(False,0);stop.assert_not_called()
 def test_startup_selection(self):
  app.PROFILE=dict(app.DEFAULT);app.INVENTORY['apps']=[]
  profile=app.validate({'startup_page':19,'screens':[3]})
  self.assertEqual(profile['startup_page'],19);self.assertEqual(profile['screens'],[0,3,19])
  with self.assertRaises(ValueError):app.validate({'startup_page':21})
 def test_sentry_settings(self):
  app.PROFILE=dict(app.DEFAULT);app.INVENTORY['apps']=[]
  for value in [-1,0,30]:
   with self.assertRaises(ValueError):app.validate({'motion_sensitivity':value})
  for value in [0,99,20001]:
   with self.assertRaises(ValueError):app.validate({'recording_limit_mb':value})
if __name__=='__main__':unittest.main(verbosity=2)
