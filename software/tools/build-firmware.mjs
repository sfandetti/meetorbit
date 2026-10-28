// Builds Orbit's two firmware programs and packages them in firmware-images/ for Wi-Fi updates.
//   node tools/build-firmware.mjs            build both, then package
//   node tools/build-firmware.mjs --no-build package the last builds
// Needs arduino-cli with the ESP32 core. Defaults to the project's work/ tools; override with
// ARDUINO_CLI, ARDUINO_CONFIG and ARDUINO_LIBRARIES.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.resolve(app,'..','work');
const cli=process.env.ARDUINO_CLI||path.join(work,'tools','arduino-cli.exe');
const config=process.env.ARDUINO_CONFIG||path.join(work,'arduino-cli.json');
const libraries=process.env.ARDUINO_LIBRARIES||path.join(work,'firmware-libraries');
// min_spiffs gives two 1.875 MB app slots, which Wi-Fi updates need. Never use huge_app.
const FQBN='esp32:esp32:esp32:FlashSize=4M,PartitionScheme=min_spiffs';
const targets=[{sketch:'OrbitDevice',role:'main',file:'orbit-main.bin'},{sketch:'OrbitSpeaker',role:'speaker',file:'orbit-speaker.bin'}];
const out=path.join(app,'firmware-images');await mkdir(out,{recursive:true});
const images=[];
for(const t of targets){
  const build=path.join(work,'firmware-build-'+t.sketch.toLowerCase());
  if(!process.argv.includes('--no-build')){
    console.log(`Building ${t.sketch}...`);
    execFileSync(cli,['--config-file',config,'compile','--jobs','4','--fqbn',FQBN,'--libraries',libraries,'--build-path',build,path.join(app,'firmware',t.sketch)],{stdio:'inherit'});
  }
  await copyFile(path.join(build,t.sketch+'.ino.bin'),path.join(out,t.file));
  const data=await readFile(path.join(out,t.file));images.push({role:t.role,file:t.file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
const firmware=/\\"firmware\\":\\"([\w-]+)\\"/.exec(await readFile(path.join(app,'firmware','OrbitDevice','ota_update.h'),'utf8'))?.[1]||'unknown';
await writeFile(path.join(out,'manifest.json'),JSON.stringify({firmware,board:'ESP32-2432S028R',images},null,2)+'\n');
console.log(`Packaged ${firmware}: ${images.map(i=>`${i.file} ${(i.bytes/1048576).toFixed(2)} MB`).join(', ')}`);
