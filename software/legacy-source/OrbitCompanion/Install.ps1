param([switch]$NoOpen)
$ErrorActionPreference='Stop'
$package=Join-Path $PSScriptRoot 'OrbitCompanion'
$index=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-hashes.json') -Raw | ConvertFrom-Json
foreach($item in $index){
 $candidate=Join-Path $package $item.path
 if(!(Test-Path -LiteralPath $candidate) -or (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -ne $item.sha256){throw 'Package verification failed. Extract a fresh copy of the complete zip.'}
}
try{
 $state=Invoke-RestMethod -Uri 'http://127.0.0.1:8910/api/state' -TimeoutSec 2
 if($state.product -eq 'OrbitCompanion'){
  $null=Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8910/api/quit' -ContentType 'application/json' -Headers @{Origin='http://127.0.0.1:8910';'X-Orbit-Token'=$state.token} -Body '{}' -TimeoutSec 3
  Start-Sleep -Seconds 2
 }
}catch{}
$target=Join-Path $env:LOCALAPPDATA 'Programs\OrbitCompanion'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $package '*') -Destination $target -Recurse -Force
$startMenu=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$shell=New-Object -ComObject WScript.Shell
$link=$shell.CreateShortcut((Join-Path $startMenu 'Orbit Companion.lnk'))
$link.TargetPath=Join-Path $target 'OrbitCompanion.exe';$link.Arguments='--open';$link.WorkingDirectory=$target;$link.Description='Open Orbit device setup';$link.Save()
if($NoOpen){Start-Process -FilePath (Join-Path $target 'OrbitCompanion.exe') -WindowStyle Hidden}
else{Start-Process -FilePath (Join-Path $target 'OrbitCompanion.exe') -ArgumentList '--open' -WindowStyle Hidden}
Write-Host 'Orbit is installed. Open Orbit Companion from Start whenever you want to change settings.'
