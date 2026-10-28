param([string]$Python='python')
$ErrorActionPreference='Stop'
$env:PYTHONPATH=Join-Path $PSScriptRoot 'packages'
& $Python -m PyInstaller --noconfirm --clean --onedir --windowed --name OrbitCompanion --paths (Join-Path $PSScriptRoot 'packages') --distpath (Join-Path $PSScriptRoot 'dist') --workpath (Join-Path $PSScriptRoot 'build') --specpath $PSScriptRoot --add-data ((Join-Path $PSScriptRoot 'web')+';web') --add-data ((Join-Path $PSScriptRoot 'health.ps1')+';.') --collect-all cv2 --collect-all cv2_enumerate_cameras (Join-Path $PSScriptRoot 'app.py')
if($LASTEXITCODE -ne 0){throw 'Orbit app build failed.'}
