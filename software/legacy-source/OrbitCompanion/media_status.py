"""Read Windows media playback state without affecting the player."""
SCRIPT=r'''
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$type=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$op=$type::RequestAsync()
$method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1} | Select-Object -First 1
$task=$method.MakeGenericMethod($type).Invoke($null,@($op))
if(!$task.Wait(1500)){throw 'Media status timed out'}
$session=$task.Result.GetCurrentSession()
if($null -eq $session){'None'}else{$session.GetPlaybackInfo().PlaybackStatus.ToString()}
'''

def playback_state(run):
    try:
        value=run(SCRIPT,timeout=4)
        return value if value in ('Playing','Paused','Stopped','Closed','Opened','Changing','None') else 'Unknown'
    except Exception:return 'Unknown'
