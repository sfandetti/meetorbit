# Start the correct Orbit companion console (8910), plus its voice/Codex services.
param([switch]$NoOpen)
$ErrorActionPreference='Stop'
$install=Join-Path $env:LOCALAPPDATA 'Programs\OrbitControl'
$companion=Join-Path $env:LOCALAPPDATA 'Programs\OrbitCompanion\OrbitCompanion.exe'
$stateDir=Join-Path $env:LOCALAPPDATA 'OrbitControl'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$stateFile=Join-Path $stateDir 'console-startup-status.json'
$mutex=New-Object Threading.Mutex($false,'Local\OrbitConsoleLauncher')
$ownsMutex=$false
function Test-Console {
    try {
        $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8910/' -TimeoutSec 2
        return ($page.StatusCode -eq 200 -and $page.Content -match 'Orbit.*Make it yours')
    } catch {return $false}
}
try {
    try {$ownsMutex=$mutex.WaitOne(60000)} catch [Threading.AbandonedMutexException] {$ownsMutex=$true}
    if(-not $ownsMutex){throw 'Orbit is still starting. Please try the shortcut again shortly.'}
    if(-not(Test-Path -LiteralPath $companion)){throw 'Orbit Companion is missing from this computer.'}
    # Existing launcher validates occupied ports and leaves the running key-owning relay intact.
    & (Join-Path $install 'Orbit-Control.ps1') -Action Start -NoOpen
    if(-not(Test-Console)) {
        $listeners=@(Get-NetTCPConnection -State Listen -LocalPort 8910 -ErrorAction SilentlyContinue)
        if($listeners.Count){throw 'Port 8910 is occupied, but the Orbit console did not respond.'}
        # Wait for an already-starting companion instead of launching another copy.
        if(-not(Get-Process OrbitCompanion -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $companion -WorkingDirectory (Split-Path $companion) -WindowStyle Hidden
        }
        $ready=$false
        for($attempt=0;$attempt -lt 30;$attempt++) {
            if(Test-Console){$ready=$true;break}
            Start-Sleep -Seconds 1
        }
        if(-not $ready){throw 'Orbit did not finish starting. Try the Orbit Console shortcut again.'}
    }
    [IO.File]::WriteAllText($stateFile,(@{state='ready';url='http://127.0.0.1:8910/';checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json))
    if(-not $NoOpen){Start-Process 'http://127.0.0.1:8910/'}
    Write-Output 'Orbit Console is ready at http://127.0.0.1:8910/'
} catch {
    [IO.File]::WriteAllText($stateFile,(@{state='failed';message=$_.Exception.Message;checkedAt=(Get-Date).ToString('o')}|ConvertTo-Json))
    if(-not $NoOpen){Add-Type -AssemblyName System.Windows.Forms;[void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'Orbit Console')}
    throw
} finally {
    if($ownsMutex){$mutex.ReleaseMutex()}
    $mutex.Dispose()
}
