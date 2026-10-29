// Saves screenshots of Orbit's screen through the running Orbit console (http://127.0.0.1:8910).
//   node tools/orbit-screen.mjs name [rot=0-3] [page=n] [view=0-3] [tap=x,y]
// e.g. node tools/orbit-screen.mjs home-up rot=0 page=0   -> %LOCALAPPDATA%\Orbit\screens\home-up.png
// rot turns Orbit's picture until it restarts or ROTATE is tapped (it is not saved).
const [name='orbit',...rest]=process.argv.slice(2);
const body={name,...Object.fromEntries(rest.map(a=>a.split('=')))};
const console_='http://127.0.0.1:8910';
const response=await fetch(console_+'/api/orbit/screen',{method:'POST',headers:{'Content-Type':'application/json',Origin:console_},body:JSON.stringify(body)});
const result=await response.json();
if(!response.ok){console.error(result.error||response.status);process.exit(1);}
console.log(`${result.file} (${result.width} x ${result.height}, rotation ${result.rot})`);
