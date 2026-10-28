from pathlib import Path
import hashlib,json,shutil,zipfile
r=Path(__file__).resolve().parent.parent;app=r/'OrbitCompanion';dist=app/'dist'/'OrbitCompanion';runtime=dist/'_internal';fw=runtime/'firmware';fw.mkdir(parents=True,exist_ok=True)
items=[]
for source,name,offset in [('OrbitRemote.ino.bootloader.bin','bootloader.bin','0x1000'),('OrbitRemote.ino.partitions.bin','partitions.bin','0x8000'),('boot_app0.bin','boot_app0.bin','0xe000'),('OrbitRemote.ino.bin','orbit.bin','0x10000')]:
 p=fw/name;shutil.copy2(r/'remote-build'/source,p);items.append({'file':name,'offset':offset,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(fw/'manifest.json').write_text(json.dumps({'firmware':'CYD-K','board':'ESP32-2432S028R','images':items},indent=2),encoding='utf-8')
shutil.copy2(Path.home()/'AppData/Local/Arduino15/packages/esp32/tools/esptool_py/5.3.1/esptool.exe',runtime/'esptool.exe')
# Publish only explicit program assets. Per-user settings/camera photos are never copied.
release=app/'release';release.mkdir(exist_ok=True)
shutil.copytree(dist,release/'OrbitCompanion',dirs_exist_ok=True)
for name in ['Install.ps1','Install.cmd','READ-ME.txt']:shutil.copy2(app/name,release/name)
hashes=[]
for p in sorted((release/'OrbitCompanion').rglob('*')):
 if p.is_file():hashes.append({'path':p.relative_to(release/'OrbitCompanion').as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(release/'package-hashes.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
with zipfile.ZipFile(r/'Orbit-Companion-Windows-Preview.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in release.rglob('*'):
  if p.is_file():z.write(p,p.relative_to(release))
# Preserve all editable project work and the exact firmware with a separate source archive.
with zipfile.ZipFile(r/'Orbit-Companion-Source-Saved.zip','w',zipfile.ZIP_DEFLATED) as z:
 for p in (r/'OrbitRemote').rglob('*'):
  if p.is_file():z.write(p,p.relative_to(r))
 for name in ['app.py','recordings_store.py','media_status.py','test_quick_recordings.py','ai_providers.py','shortcuts.py','privacy_cleanup.py','alarm_audio.py','test_integrations.py','camera_manager.py','camera_worker.py','health.ps1','test_companion.py','test_camera.py','Build.ps1','Package.py','Install.ps1','Install.cmd','READ-ME.txt']:
  p=app/name
  if p.exists():z.write(p,p.relative_to(r))
 for p in (app/'web').rglob('*'):
  if p.is_file():z.write(p,p.relative_to(r))
 for p in fw.iterdir():z.write(p,Path('firmware')/p.name)
 for p in (r/'cyd-libs').rglob('*'):
  if p.is_file():z.write(p,p.relative_to(r))
print('Release package complete; files:',len(hashes))
