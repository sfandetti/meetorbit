import {spawn} from 'node:child_process';
// Live PC readings for Orbit's gauge screens, sent over the device link instead of the
// companion app's paired Wi-Fi feed. One long-running PowerShell loop prints a line each second
// in the firmware's "PC" format: cpu ram gpu temp vram watts fan driveUsed down up diskBusy
// ramUsed ramTotal driveFree readMB writeMB (-1 = not available). Same measurements as the
// companion's health.ps1. GPU: NVIDIA via nvidia-smi; otherwise (AMD, Intel) Windows' own WDDM data,
// the source of Task Manager's GPU tab: usage, temperature and VRAM of the card with the most VRAM.
const SCRIPT=String.raw`
$ErrorActionPreference='SilentlyContinue';$c=[Globalization.CultureInfo]::InvariantCulture
$gpuTool=Get-Command nvidia-smi -ErrorAction SilentlyContinue;$clock=[Diagnostics.Stopwatch]::StartNew();$lastSlow=-99;$lastNet=-99;$prev=$null
if(!$gpuTool){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class OrbitGpu{
 [StructLayout(LayoutKind.Sequential)] struct LUID{public uint Low;public int High;}
 [StructLayout(LayoutKind.Sequential)] struct ADAPTERINFO{public uint hAdapter;public LUID Luid;public uint NumOfSources;public int Precise;}
 [StructLayout(LayoutKind.Sequential)] struct ENUM2{public uint NumAdapters;public IntPtr pAdapters;}
 [StructLayout(LayoutKind.Sequential)] struct QUERY{public uint hAdapter;public int Type;public IntPtr pData;public uint Size;}
 [StructLayout(LayoutKind.Sequential)] struct PERFDATA{public uint PhysicalAdapterIndex;public ulong MemoryFrequency;public ulong MaxMemoryFrequency;public ulong MaxMemoryFrequencyOC;public ulong MemoryBandwidth;public ulong PCIEBandwidth;public uint FanRPM;public uint Power;public uint Temperature;public byte PowerStateOverride;}
 [DllImport("gdi32.dll")] static extern int D3DKMTEnumAdapters2(ref ENUM2 e);
 [DllImport("gdi32.dll")] static extern int D3DKMTQueryAdapterInfo(ref QUERY q);
 static int Query(uint h,int type,IntPtr buf,int size){var q=new QUERY{hAdapter=h,Type=type,pData=buf,Size=(uint)size};return D3DKMTQueryAdapterInfo(ref q);}
 // One line per adapter: "luid_0xHIGH_0xLOW|name|temperature C|fan rpm|power tenths-of-percent"
 public static string[] Read(){
  var e=new ENUM2();D3DKMTEnumAdapters2(ref e);int sz=Marshal.SizeOf(typeof(ADAPTERINFO));e.pAdapters=Marshal.AllocHGlobal(sz*(int)Math.Max(1,e.NumAdapters));
  try{if(D3DKMTEnumAdapters2(ref e)!=0)return new string[0];var rows=new string[e.NumAdapters];
   for(int i=0;i<e.NumAdapters;i++){var a=(ADAPTERINFO)Marshal.PtrToStructure(e.pAdapters+i*sz,typeof(ADAPTERINFO));
    IntPtr reg=Marshal.AllocHGlobal(4*260*2);string name="";if(Query(a.hAdapter,8,reg,4*260*2)==0)name=Marshal.PtrToStringUni(reg);Marshal.FreeHGlobal(reg);
    var p=new PERFDATA();int psz=Marshal.SizeOf(p);IntPtr buf=Marshal.AllocHGlobal(psz);Marshal.StructureToPtr(p,buf,false);
    bool ok=Query(a.hAdapter,62,buf,psz)==0;p=(PERFDATA)Marshal.PtrToStructure(buf,typeof(PERFDATA));Marshal.FreeHGlobal(buf);
    rows[i]=string.Format("luid_0x{0:x8}_0x{1:x8}|{2}|{3}|{4}|{5}",a.Luid.High,a.Luid.Low,name,ok?p.Temperature/10.0:-1,ok?(double)p.FanRPM:-1,ok?(double)p.Power:-1);}
   return rows;}finally{Marshal.FreeHGlobal(e.pAdapters);}
 }
}
'@
 # The discrete card is the one with the most VRAM (from the display driver's registry entries).
 $vramByName=@{};Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' -Name 'HardwareInformation.qwMemorySize','DriverDesc'|ForEach-Object{$vramByName[$_.DriverDesc]=[double]$_.'HardwareInformation.qwMemorySize'}
}
while($true){
 $now=$clock.Elapsed.TotalSeconds
 if($now-$lastSlow -gt 10){$os=Get-CimInstance Win32_OperatingSystem;$drive=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'";$lastSlow=$now}
 $cpu=[double](Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
 $ram=100.0*(1.0-[double]$os.FreePhysicalMemory/[double]$os.TotalVisibleMemorySize)
 $ramTotal=[double]$os.TotalVisibleMemorySize/1MB;$ramUsed=([double]$os.TotalVisibleMemorySize-[double]$os.FreePhysicalMemory)/1MB
 $driveUsed=100.0*(1.0-[double]$drive.FreeSpace/[double]$drive.Size);$driveFree=[double]$drive.FreeSpace/1GB
 $gpu=-1.0;$temp=-1.0;$vram=-1.0;$watts=-1.0;$fan=-1.0
 if($gpuTool){$p=((& $gpuTool.Source --query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed --format=csv,noheader,nounits 2>$null)|Select-Object -First 1) -split ',\s*'
  if($p.Count -eq 6){$n={param($v)$r=0.0;if([double]::TryParse($v,[Globalization.NumberStyles]::Float,$c,[ref]$r)){$r}else{-1.0}};$gpu=&$n $p[0];$temp=&$n $p[1];$t=&$n $p[3];if($t -gt 0){$vram=100.0*(&$n $p[2])/$t};$watts=&$n $p[4];$fan=&$n $p[5]}}
 else{
  $best=$null;foreach($row in [OrbitGpu]::Read()){$f=$row -split '\|';$size=$vramByName[$f[1]];if($size -and (!$best -or $size -gt $best.Size)){$best=@{Luid=$f[0];Size=$size;Temp=[double]::Parse($f[2],$c);Fan=[double]::Parse($f[3],$c)}}}
  if($best){
   # Load: the busiest GPU (on hybrid laptops the integrated chip draws the desktop while the
   # discrete card sleeps). Temperature and VRAM: the discrete card.
   $loadByLuid=@{};$used=0.0
   (Get-Counter -Counter @("\GPU Engine(*engtype_3D)\Utilization Percentage","\GPU Adapter Memory($($best.Luid)*)\Dedicated Usage")).CounterSamples|ForEach-Object{
    if($_.Path -like '*utilization percentage'){if($_.InstanceName -match '(luid_0x[0-9a-f]+_0x[0-9a-f]+)'){$loadByLuid[$matches[1]]+=$_.CookedValue}}else{$used+=$_.CookedValue}}
   $gpu=0.0;foreach($v in $loadByLuid.Values){$gpu=[Math]::Max($gpu,$v)};$gpu=[Math]::Min(100,$gpu);$vram=100.0*$used/$best.Size
   if($best.Temp -gt 0){$temp=$best.Temp};if($best.Fan -gt 0){$fan=[Math]::Min(100,$best.Fan/50.0)}
  }
 }
 $disk=Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
 $busy=[Math]::Min(100,[double]$disk.PercentDiskTime);$readMB=[double]$disk.DiskReadBytesPersec/1MB;$writeMB=[double]$disk.DiskWriteBytesPersec/1MB
 if($now-$lastNet -gt 30 -or !$netName){$route=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0'|Sort-Object RouteMetric|Select-Object -First 1;$a=Get-NetAdapter -InterfaceIndex $route.InterfaceIndex;if($a.Name -ne $netName){$prev=$null};$netName=$a.Name;$lastNet=$now}
 $down=0.0;$up=0.0
 if($netName){$net=Get-NetAdapterStatistics -Name $netName;$at=$clock.Elapsed.TotalSeconds;if($prev -and $at-$prevAt -gt 0){$down=[Math]::Max(0,([double]$net.ReceivedBytes-[double]$prev.ReceivedBytes)/($at-$prevAt)/1KB);$up=[Math]::Max(0,([double]$net.SentBytes-[double]$prev.SentBytes)/($at-$prevAt)/1KB)};$prev=$net;$prevAt=$at}
 $v=@($cpu,$ram,$gpu,$temp,$vram,$watts,$fan,$driveUsed,$down,$up,$busy,$ramUsed,$ramTotal,$driveFree,$readMB,$writeMB)
 [Console]::Out.WriteLine('PC '+(($v|ForEach-Object{([double]$_).ToString('F2',$c)}) -join ' '));[Console]::Out.Flush()
 $sleep=1000-[int](($clock.Elapsed.TotalSeconds-$now)*1000);if($sleep -gt 50){Start-Sleep -Milliseconds $sleep}
}`;
export const PC_LINE=/^PC( -?\d+\.\d{2}){16}$/;
export function startPcStats(onLine){
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(SCRIPT,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let buffer='';
  child.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(PC_LINE.test(line))onLine(line);}if(buffer.length>4096)buffer='';});
  child.on('error',()=>{});
  return {stop(){child.kill();}};
}
