import io, math, struct, subprocess, threading, wave, winsound

class Alarm:
    def __init__(self):self.active=False;self.cancel=threading.Event();self.thread=None;self.voice=None
    def stop(self):
        self.cancel.set();winsound.PlaySound(None,0)
        if self.voice and self.voice.poll() is None:self.voice.terminate()
        self.active=False
    def start(self,sound,loop=False):
        self.stop()
        if self.thread and self.thread.is_alive():self.thread.join(timeout=1)
        cancel=threading.Event();self.cancel=cancel;self.active=True
        def play():
            try:
                while not cancel.is_set():
                    if sound=='intruder':
                        self.voice=subprocess.Popen(['powershell.exe','-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Speech; $voice=New-Object System.Speech.Synthesis.SpeechSynthesizer; $voice.Speak('Intruder! Intruder!')"],creationflags=0x08000000)
                        while self.voice.poll() is None:
                            if cancel.wait(.1):self.voice.terminate();break
                    else:
                        pcm=bytearray();rate=16000;phase=0
                        for i in range(rate*2):
                            t=i/rate;freq=550+400*math.sin(t*math.pi*3) if sound=='siren' else (220 if int(t*6)%2 else 440)
                            phase+=2*math.pi*freq/rate;envelope=min(1,t*20,(2-t)*20);sample=int(math.sin(phase)*8000*max(0,envelope))
                            pcm.extend(struct.pack('<h',sample))
                        raw=io.BytesIO()
                        with wave.open(raw,'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes(pcm)
                        if not cancel.is_set():winsound.PlaySound(raw.getvalue(),winsound.SND_MEMORY)
                    if not loop or cancel.wait(.3):break
            finally:
                if self.cancel is cancel:self.active=False
        self.thread=threading.Thread(target=play,daemon=True);self.thread.start()
