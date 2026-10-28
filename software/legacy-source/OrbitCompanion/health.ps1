param([string]$DataDirectory,[string]$DeviceAddress='',[int]$RunSeconds=0,[switch]$Tray)
$ErrorActionPreference='Stop'
$culture=[Globalization.CultureInfo]::InvariantCulture
Add-Type -AssemblyName System.Security
$protected=Get-Content -LiteralPath (Join-Path $DataDirectory 'private.json') -Raw | ConvertFrom-Json
$private=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($protected.protected),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)) | ConvertFrom-Json
$profile=Get-Content -LiteralPath (Join-Path $DataDirectory 'profile.json') -Raw | ConvertFrom-Json
$config=[pscustomobject]@{address=$profile.address;key=$private.pair_key}
if(!$DeviceAddress){$DeviceAddress=$config.address}
if(!$DeviceAddress){$DeviceAddress='seth-orbit.local'}
if($config.key.Length -ne 32){throw 'Display pairing is not configured.'}
$bridgeLog=Join-Path $DataDirectory 'pc-health-wireless.log'
$snapshot=Join-Path $DataDirectory 'pc-health-latest.json'
$inbox=Join-Path $DataDirectory 'ai-message.json'
$replyFile=Join-Path $DataDirectory 'ai-reply.json'
$stopFile=Join-Path $DataDirectory '.pc-feed-stop'
$clock=[Diagnostics.Stopwatch]::StartNew()
$netPrevious=$null;$netAt=0.0;$networkName=$null;$os=$null;$drive=$null
$lastSlow=-100.0;$lastNetwork=-100.0;$lastLog=-100.0;$failures=0
$gpuTool=Get-Command nvidia-smi -ErrorAction SilentlyContinue
$script:bridgeStop=$false;$trayIcon=$null;$ownedMutex=$false
$mutex=[Threading.Mutex]::new($false,'Local\OrbitCompanionHealth')
try{$ownedMutex=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$ownedMutex=$true}
if(!$ownedMutex){$mutex.Dispose();return}
if(Test-Path -LiteralPath $stopFile){Remove-Item -LiteralPath $stopFile}
Add-Type -AssemblyName System.Net.Http
$client=[Net.Http.HttpClient]::new()
$client.Timeout=[TimeSpan]::FromSeconds(2)
$client.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$config.key)
if($Tray){
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $trayIcon=[Windows.Forms.NotifyIcon]::new()
  $trayIcon.Icon=[Drawing.SystemIcons]::Application
  $trayIcon.Text='Orbit PC Gauges - Wi-Fi feed'
  $menu=[Windows.Forms.ContextMenuStrip]::new()
  $stopItem=$menu.Items.Add('Stop live PC feed')
  $stopItem.add_Click({$script:bridgeStop=$true})
  $trayIcon.ContextMenuStrip=$menu;$trayIcon.Visible=$true
}
function Number($value){
  if($null -eq $value){return -1.0}
  $parsed=0.0
  if([double]::TryParse([string]$value,[Globalization.NumberStyles]::Float,$culture,[ref]$parsed)){return $parsed}
  return -1.0
}
function Log([string]$message){Add-Content -LiteralPath $bridgeLog -Value ((Get-Date -Format 's')+' '+$message)}
Log 'Wi-Fi bridge starting'
try{
  while(!$script:bridgeStop -and !(Test-Path -LiteralPath $stopFile) -and ($RunSeconds -eq 0 -or $clock.Elapsed.TotalSeconds -lt $RunSeconds)){
    $loopAt=$clock.Elapsed.TotalSeconds
    try{
      $now=$clock.Elapsed.TotalSeconds
      if($now-$lastSlow -gt 10) {
        $os=Get-CimInstance Win32_OperatingSystem
        $drive=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
        $lastSlow=$now
      }
      $cpu=[double](Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
      $ram=100.0*(1.0-[double]$os.FreePhysicalMemory/[double]$os.TotalVisibleMemorySize)
      $ramTotal=[double]$os.TotalVisibleMemorySize/1MB
      $ramUsed=([double]$os.TotalVisibleMemorySize-[double]$os.FreePhysicalMemory)/1MB
      $driveUsed=100.0*(1.0-[double]$drive.FreeSpace/[double]$drive.Size)
      $driveFree=[double]$drive.FreeSpace/1GB
      $gpu=-1.0;$temp=-1.0;$vram=-1.0;$watts=-1.0;$fan=-1.0
      if($gpuTool) {
        $gpuLine=(& $gpuTool.Source --query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed --format=csv,noheader,nounits 2>$null | Select-Object -First 1)
        if($gpuLine) {
          $parts=$gpuLine -split ',\s*'
          if($parts.Count -eq 6){$gpu=Number $parts[0];$temp=Number $parts[1];$used=Number $parts[2];$total=Number $parts[3];if($total -gt 0){$vram=100.0*$used/$total};$watts=Number $parts[4];$fan=Number $parts[5]}
        }
      }
      $disk=Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
      $diskBusy=[Math]::Min(100,[double]$disk.PercentDiskTime)
      $readMB=[double]$disk.DiskReadBytesPersec/1MB
      $writeMB=[double]$disk.DiskWriteBytesPersec/1MB
      if($now-$lastNetwork -gt 30 -or !$networkName) {
        $route=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
        $adapter=Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
        if($adapter.Name -ne $networkName){$netPrevious=$null}
        $networkName=$adapter.Name;$lastNetwork=$now
      }
      $down=0.0;$up=0.0
      if($networkName) {
        $net=Get-NetAdapterStatistics -Name $networkName
        $netNow=$clock.Elapsed.TotalSeconds
        if($netPrevious -and $netNow-$netAt -gt 0) {
          $down=[Math]::Max(0,([double]$net.ReceivedBytes-[double]$netPrevious.ReceivedBytes)/($netNow-$netAt)/1KB)
          $up=[Math]::Max(0,([double]$net.SentBytes-[double]$netPrevious.SentBytes)/($netNow-$netAt)/1KB)
        }
        $netPrevious=$net;$netAt=$netNow
      }
      $values=@($cpu,$ram,$gpu,$temp,$vram,$watts,$fan,$driveUsed,$down,$up,$diskBusy,$ramUsed,$ramTotal,$driveFree,$readMB,$writeMB)
      $valuesText=($values | ForEach-Object {$_.ToString('F2',$culture)}) -join ' '
      $form=[Collections.Generic.Dictionary[string,string]]::new()
      $form.Add('pc',$valuesText)
      $message=$null
      $content=[Net.Http.FormUrlEncodedContent]::new($form)
      try{
        $response=$client.PostAsync(('http://'+$DeviceAddress+'/feed'),$content).GetAwaiter().GetResult()
        try{
          [void]$response.EnsureSuccessStatusCode()
          $status=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        }finally{$response.Dispose()}
      }finally{$content.Dispose()}
      if($status.firmware -notmatch '^CYD-[C-Z]$' -or $status.width -ne 320 -or $status.height -ne 240 -or !$status.live){throw 'Unexpected or inactive display response.'}
      $failures=0
      [ordered]@{updated=(Get-Date -Format 'o');transport='WI-FI';device=$DeviceAddress;cpu=$cpu;ram=$ram;gpu=$gpu;gpuTemperatureC=$temp;gpuVramPercent=$vram;gpuWatts=$watts;gpuFanPercent=$fan;driveUsedPercent=$driveUsed;downloadKBps=$down;uploadKBps=$up;ramUsedGiB=$ramUsed;ramTotalGiB=$ramTotal;driveFreeGiB=$driveFree;diskReadMBps=$readMB;diskWriteMBps=$writeMB;adapter=$networkName;deviceStatus=$status} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $snapshot -Encoding utf8
      if($message -and $status.reply -ne 'NONE'){
        [ordered]@{id=$message.id;reply=$status.reply;at=(Get-Date -Format 'o');note='Display acknowledgment only; execution permissions remain in the computer application.'} | ConvertTo-Json | Set-Content -LiteralPath $replyFile -Encoding utf8
      }
      if($clock.Elapsed.TotalSeconds-$lastLog -gt 10){Log ('Wi-Fi live; packets='+$status.packets+' page='+$status.page+' fps='+$status.fps);$lastLog=$clock.Elapsed.TotalSeconds}
    }catch{
      $failures++
      if($failures -eq 1 -or $failures%10 -eq 0){Log 'Display unavailable; retrying Wi-Fi connection'}
      if($failures%3 -eq 0){
        try{$resolved=[Net.Dns]::GetHostAddresses('seth-orbit.local') | Where-Object AddressFamily -eq InterNetwork | Select-Object -First 1;if($resolved){$DeviceAddress=$resolved.IPAddressToString}}catch{}
      }
    }
    if($Tray){[Windows.Forms.Application]::DoEvents()}
    $remaining=1.0-($clock.Elapsed.TotalSeconds-$loopAt)
    if($remaining -gt 0){Start-Sleep -Milliseconds ([int]($remaining*1000))}
  }
}finally{
  $client.Dispose()
  if($trayIcon){$trayIcon.Visible=$false;$trayIcon.Dispose();$menu.Dispose()}
  if($ownedMutex){$mutex.ReleaseMutex()};$mutex.Dispose()
  Log 'Wi-Fi bridge stopped'
}

