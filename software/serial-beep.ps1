param([Parameter(Mandatory=$true)][ValidatePattern('^COM[0-9]{1,4}$')][string]$Port,[ValidateSet('beep','loopback')][string]$Action='beep')
$ErrorActionPreference='Stop'
function Report([string]$event){[Console]::Out.WriteLine('{"event":"'+$event+'"}');[Console]::Out.Flush()}
$serial=[IO.Ports.SerialPort]::new($Port,115200)
$serial.DtrEnable=$false
$serial.RtsEnable=$false
$serial.WriteTimeout=1500
Add-Type -TypeDefinition 'using System; using System.Threading.Tasks; public static class OrbitSerialControl { public static Task<string> ReadStop() { return Task.Run(() => Console.ReadLine()); } }'
$stopRead=[OrbitSerialControl]::ReadStop()
$sent=$false
try {
  try {$serial.Open()} catch {Report 'port-unavailable';exit 1}
  Report 'opened'
  for($i=0;$i -lt 25;$i++){if($stopRead.IsCompleted){return};Start-Sleep -Milliseconds 100}
  $serial.DiscardInBuffer()
  $command=if($Action -eq 'loopback'){'AUDIO LOOPBACK'}else{'SPEAKER REPEAT'}
  $serial.Write($command+"`n")
  $sent=$true
  Report 'sent'
  $sentAt=[DateTime]::UtcNow
  $acknowledged=$false
  $buffer=''
  while(!$stopRead.IsCompleted){
    $buffer+=$serial.ReadExisting()
    while($buffer.Contains("`n")){
      $split=$buffer.IndexOf("`n");$line=$buffer.Substring(0,$split).Trim();$buffer=$buffer.Substring($split+1)
      if($line -match '^SPEAKER REPEAT STARTED(?: |$)' -and !$acknowledged){$acknowledged=$true;Report 'started'}
      elseif($line -eq 'AUDIO LOOPBACK READY 5S'){$acknowledged=$true;Report 'countdown'}
      elseif($line -eq 'AUDIO LOOPBACK RECORDING 3S'){Report 'recording'}
      elseif($line -eq 'AUDIO LOOPBACK PLAYING 3S'){Report 'playing'}
      elseif($line -match '^AUDIO LOOPBACK CAPTURED FRAMES=(\d+) PEAK=(\d+)$'){[Console]::Out.WriteLine('{"event":"captured","frames":'+$Matches[1]+',"peak":'+$Matches[2]+'}');[Console]::Out.Flush()}
      elseif($line -match '^AUDIO LOOPBACK ERROR (.+)$'){
        $reason=switch($Matches[1]){'MEMORY'{'memory-error'} 'RX INIT'{'rx-init-error'} 'RX WARMUP'{'rx-init-error'} 'TX INIT'{'tx-init-error'} 'NO SIGNAL'{'no-signal'} 'INCOMPLETE CAPTURE'{'capture-incomplete'} 'TX WRITE'{'tx-write-error'} default{'device-error'}}
        Report $reason;return
      }
      elseif($line -eq 'AUDIO LOOPBACK FAILED'){Report 'device-error';return}
      elseif($line -match '^AUDIO LOOPBACK (?:COMPLETE|STOPPED)$'){Report 'complete';return}
      elseif($line -match '^SPEAKER (?:WRITE )?ERROR'){Report 'device-error';return}
      elseif($line -eq 'SPEAKER TEST COMPLETE'){Report 'complete';return}
    }
    if($buffer.Length -gt 4096){$buffer=''}
    $elapsed=([DateTime]::UtcNow-$sentAt).TotalSeconds
    if(!$acknowledged -and $elapsed -gt 8){Report 'no-ack';return}
    if($Action -eq 'loopback' -and $elapsed -ge 22){Report 'device-error';return}
    if($elapsed -ge 61){Report 'complete';return}
    Start-Sleep -Milliseconds 100
  }
} catch {Report 'connection-error'}
finally {
  if($serial.IsOpen){
    if($sent){try{$serial.Write("AUDIO STOP`n");Start-Sleep -Milliseconds 100}catch{}}
    try{$serial.Close()}catch{}
  }
  $serial.Dispose()
}
