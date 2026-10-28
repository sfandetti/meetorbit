$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node -ErrorAction Stop).Source
function Start-OrbitEndpoint([string]$Url,[string]$Script) {
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2
        if ($response.Content -notmatch 'Orbit · companion simulator') { throw 'Port is occupied by another application.' }
        return
    } catch { if ($_.Exception.Message -match 'another application') { throw } }
    $serverFile = Join-Path $PSScriptRoot $Script
    Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 1
            if ($response.Content -match 'Orbit · companion simulator') { return }
        } catch { }
    }
    throw 'Orbit could not start its local endpoint.'
}
Start-OrbitEndpoint 'http://127.0.0.1:8787' 'serve.mjs'
Start-OrbitEndpoint 'http://127.0.0.1:8788' 'gateway.mjs'
Start-Process 'http://127.0.0.1:8788'
