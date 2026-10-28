param(
    [ValidateSet('Show','Start','Stop','Status')][string]$Action = 'Show',
    [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$orbitRoot = $PSScriptRoot
# Machine-local deployment settings contain no API key or pairing token.
$orbitInstallFile = Join-Path $orbitRoot 'orbit-install.json'
if (Test-Path -LiteralPath $orbitInstallFile) {
    $orbitInstall = Get-Content -LiteralPath $orbitInstallFile -Raw | ConvertFrom-Json
    if ($orbitInstall.threadId) { $env:ORBIT_CODEX_THREAD_ID = [string]$orbitInstall.threadId }
    if ($orbitInstall.deviceHost) { $env:ORBIT_DEVICE_HOST = [string]$orbitInstall.deviceHost }
}

$orbitServices = @(
    @{ Port = 8787; Script = 'serve.mjs'; Label = 'Voice relay' },
    @{ Port = 8788; Script = 'gateway.mjs'; Label = 'Console' }
)
function Get-OrbitListener([int]$Port) {
    @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function Assert-OrbitOwner($Listener, $Service) {
    $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $Listener.OwningProcess)
    $expected = Join-Path $orbitRoot $Service.Script
    if ($owner.Name -ne 'node.exe' -or $owner.CommandLine.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Port $($Service.Port) belongs to another process. Orbit will leave it alone."
    }
}
function Test-OrbitPage([int]$Port) {
    try {
        $page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2
        return ($page.StatusCode -eq 200 -and $page.Content -match 'Orbit')
    } catch { return $false }
}
function Start-Orbit {
    $node = Join-Path $orbitRoot 'node.exe'
    if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
    # Validate every occupied port before changing either service.
    foreach ($service in $orbitServices) {
        foreach ($listener in (Get-OrbitListener $service.Port)) { Assert-OrbitOwner $listener $service }
    }
    foreach ($service in $orbitServices) {
        if ((Get-OrbitListener $service.Port).Count -eq 0) {
            $file = Join-Path $orbitRoot $service.Script
            Start-Process -FilePath $node -ArgumentList ('"' + $file + '"') -WorkingDirectory $orbitRoot -WindowStyle Hidden
        }
        $ready = $false
        for ($attempt = 0; $attempt -lt 12; $attempt++) {
            if (Test-OrbitPage $service.Port) { $ready = $true; break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $ready) { throw "$($service.Label) is not responding. Use Stop, then Start to restart Orbit." }
    }
    if (-not $NoOpen) { Start-Process 'http://127.0.0.1:8788/' }
}
function Stop-Orbit {
    $verified = @()
    foreach ($service in $orbitServices) {
        foreach ($listener in (Get-OrbitListener $service.Port)) {
            Assert-OrbitOwner $listener $service
            $verified += $listener.OwningProcess
        }
    }
    foreach ($processId in ($verified | Select-Object -Unique)) { Stop-Process -Id $processId -ErrorAction Stop }
    # Browser windows and unrelated services deliberately stay open.
}
function Get-OrbitStatus {
    $ports = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port
    $console = 8788 -in $ports
    $relay = 8787 -in $ports
    if ($console -and $relay) { return 'Orbit is running' }
    if (-not $console -and -not $relay) { return 'Orbit is stopped' }
    return 'Orbit is partly running — Stop, then Start'
}
switch ($Action) {
    'Start' { Start-Orbit; Get-OrbitStatus; return }
    'Stop' { Stop-Orbit; Get-OrbitStatus; return }
    'Status' { Get-OrbitStatus; return }
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = 'Orbit Control'
$form.ClientSize = New-Object Drawing.Size(490,245)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object Drawing.Font('Segoe UI',11)
$form.BackColor = [Drawing.Color]::FromArgb(245,248,248)
$title = New-Object Windows.Forms.Label
$title.Text = 'Orbit'
$title.Font = New-Object Drawing.Font('Segoe UI',23,[Drawing.FontStyle]::Bold)
$title.SetBounds(24,16,440,48)
$form.Controls.Add($title)
$status = New-Object Windows.Forms.Label
$status.SetBounds(27,75,440,30)
$form.Controls.Add($status)
$hint = New-Object Windows.Forms.Label
$hint.Text = 'Stop ends voice sessions. Your browser stays open.'
$hint.SetBounds(27,187,440,40)
$hint.Font = New-Object Drawing.Font('Segoe UI',9)
$form.Controls.Add($hint)
function Refresh-OrbitStatus { $status.Text = Get-OrbitStatus }
function Invoke-OrbitButton([scriptblock]$Work) {
    $form.UseWaitCursor = $true
    try { & $Work } catch { [Windows.Forms.MessageBox]::Show($_.Exception.Message,'Orbit Control') | Out-Null }
    finally { $form.UseWaitCursor = $false; Refresh-OrbitStatus }
}
$start = New-Object Windows.Forms.Button
$start.Text = 'Start Orbit'
$start.SetBounds(25,125,140,48)
$start.Add_Click({ Invoke-OrbitButton { Start-Orbit } })
$form.Controls.Add($start)
$stop = New-Object Windows.Forms.Button
$stop.Text = 'Stop Orbit'
$stop.SetBounds(175,125,140,48)
$stop.Add_Click({ Invoke-OrbitButton { Stop-Orbit } })
$form.Controls.Add($stop)
$open = New-Object Windows.Forms.Button
$open.Text = 'Open Console'
$open.SetBounds(325,125,140,48)
$open.Add_Click({ Invoke-OrbitButton { if (Test-OrbitPage 8788) { Start-Process 'http://127.0.0.1:8788/' } else { throw 'Click Start Orbit first.' } } })
$form.Controls.Add($open)
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({ Refresh-OrbitStatus })
$form.Add_Shown({ Refresh-OrbitStatus; $timer.Start() })
$form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })
[void]$form.ShowDialog()
$form.Dispose()
