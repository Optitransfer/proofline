import fs from 'node:fs'; import http from 'node:http'; import { spawn, execSync } from 'node:child_process';
import * as L from './lib.mjs';
const N=+process.argv[2], PORT=+process.argv[3]; const W=(process.env.BENCH_DIR||"/tmp/hvbench")+`/n${N}`; fs.rmSync(W,{recursive:true,force:true}); fs.mkdirSync(W,{recursive:true});
const out={N}; const save=()=>fs.writeFileSync(`${W}.json`,JSON.stringify(out,null,1));
const pid=(port)=>{try{return +execSync(`ss -ltnpH 'sport = :${port}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2`).toString().trim()}catch{return 0}};
const rss=(p)=>{try{return +(+fs.readFileSync(`/proc/${p}/status`,'utf8').match(/VmRSS:\s+(\d+)/)[1]/1024).toFixed(0)}catch{return null}};
const st=(a)=>({n:a.length,p50:L.pct(a,.5),p95:L.pct(a,.95),max:+Math.max(...a).toFixed(1)});
const body=(i)=>`# Note ${i}\n\nService ${i%60} depends on Service ${(i*7+3)%60}. Owned by Person ${i%8}.\nMeeting ${i}: latency budget ${i%97} ms, quarter ${1+i%4}.\nToken ${(i*2654435761>>>0).toString(36)}.\n`;
const v=await L.initVault({home:`${W}/home`,dir:`${W}/vault`,port:PORT});
let t=performance.now(); const chunk=[];
for(let i=0;i<N;i+=200){const s=performance.now();const writes=[];for(let j=i;j<Math.min(N,i+200);j++)writes.push({path:`work/p/n${j}.md`,body:body(j)});
 const r=await L.http(v,'POST','/v1/notes/batch',{body:{writes,defer:true}}); if(r.status>=300){out.loadErr=[r.status,r.text.slice(0,300)];save();console.log(JSON.stringify(out));process.exit(1)} chunk.push((performance.now()-s)/writes.length);}
out.loopMs=+(performance.now()-t).toFixed(0); out.loopMsPerNote=+(out.loopMs/N).toFixed(2); out.chunkMsPerNote={first:+chunk[0].toFixed(2),last:+chunk.at(-1).toFixed(2)};
t=performance.now(); const f=await L.http(v,'POST','/v1/notes/batch',{body:{flush:true}}); out.flushMs=+(performance.now()-t).toFixed(0); out.flushStatus=f.status; out.flushResp=(f.text||'').slice(0,300);
out.rssLoaded=rss(pid(PORT)); save(); console.error('loaded',out.loopMs,out.flushMs,f.status);
for(const Wn of [1,8,32]){const lat=[];const per=Wn===1?40:Math.ceil(640/Wn);const s=performance.now();let errs=0;
 await Promise.all(Array.from({length:Wn},async(_,w)=>{for(let k=0;k<per;k++){const r=await L.http(v,'PUT',`/v1/notes/work/c/w${Wn}-${w}-${k}.md`,{body:{body:body(N+w*1000+k)}});if(r.status>=300)errs++;lat.push(r.ms)}}));
 const el=(performance.now()-s)/1000; out[`writers${Wn}`]={...st(lat),savesPerSec:+(lat.length/el).toFixed(0),errs}; save(); console.error(Wn,JSON.stringify(out[`writers${Wn}`]));}
let bytes={req:0,res:0}; const PX=PORT+2;
const px=http.createServer((rq,rs)=>{const up=http.request({host:'127.0.0.1',port:PORT,path:rq.url,method:rq.method,headers:rq.headers},(u)=>{rs.writeHead(u.statusCode,u.headers);u.on('data',d=>{bytes.res+=d.length;rs.write(d)});u.on('end',()=>rs.end())});rq.on('data',d=>{bytes.req+=d.length;up.write(d)});rq.on('end',()=>up.end())}).listen(PX);
const B=await L.initVault({home:`${W}/homeB`,dir:`${W}/vaultB`,port:PORT+1});
const tok=await L.mint(v,'peer-b','Vault B <b@example.com>',{scopes:['read','write','sync']}).catch(()=>L.mint(v,'peer-b','Vault B <b@example.com>'));
out.peerAdd=L.cli(['peer','add','a',`http://127.0.0.1:${PX}`,'--token',tok],{home:B.home,root:B.root,port:B.port,allowFail:true}).out.slice(-200);
const run=()=>new Promise(res=>{const s=Date.now();const env={...process.env,HOME:B.home,HIVEVAULT_ROOT:B.root,HIVEVAULT_PORT:String(B.port)};const p=spawn(process.execPath,[L.CLI,'sync','a'],{env});let o='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>o+=d);p.on('close',c=>res({code:c,ms:Date.now()-s,tail:o.slice(-250)}))});
let s1=await run(); out.syncFull={...s1,bytes:{...bytes}}; bytes={req:0,res:0};
await L.http(v,'PUT','/v1/notes/work/inc.md',{body:{body:'one change\n'}});
let s2=await run(); out.syncOne={...s2,bytes:{...bytes}}; save(); console.error('sync',JSON.stringify(out.syncOne));
L.cli(['stop'],{home:v.home,root:v.root,port:v.port,allowFail:true}); await L.sleep(1000);
const env={...process.env,HOME:v.home,HIVEVAULT_ROOT:v.root,HIVEVAULT_PORT:String(PORT)};
t=Date.now(); const p=spawn(process.execPath,[L.SERVER,'--http','--port',String(PORT),'--root',v.root],{env,stdio:'ignore'});
for(let i=0;i<3000;i++){const h=await L.http(v,'GET','/readyz',{token:null});if(h.status===200){out.coldStartMs=Date.now()-t;break}await L.sleep(50)}
out.rssRestart=rss(p.pid); p.kill(); px.close(); L.cli(['stop'],{home:B.home,root:B.root,port:B.port,allowFail:true}); save(); console.log(JSON.stringify(out)); process.exit(0);
