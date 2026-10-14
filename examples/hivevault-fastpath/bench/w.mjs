import { spawn } from 'node:child_process'; import fs from 'node:fs'; import * as L from './lib.mjs';
const W=(process.env.BENCH_DIR||'/tmp/hvbench')+'/n4000', PORT=47710; const admin=fs.readFileSync(`${W}/vault/.vault/admin-token.txt`,'utf8').trim();
const v={home:`${W}/home`,root:`${W}/vault`,port:PORT,admin,base:`http://127.0.0.1:${PORT}`};
const p=spawn(process.execPath,[L.SERVER,'--http','--port',String(PORT),'--root',v.root],{env:{...process.env,HOME:v.home},stdio:'ignore'});
for(let i=0;i<600;i++){if((await L.http(v,'GET','/readyz',{token:null})).status===200)break;await L.sleep(50)}
const out={};
for(const wait of ['durable','sealed']) for(const Wn of [1,32]){const lat=[];const per=Wn===1?40:20;const s=performance.now();let e=[];
 await Promise.all(Array.from({length:Wn},async(_,w)=>{for(let k=0;k<per;k++){const r=await L.http(v,'PUT',`/v1/notes/work/d/${wait}${Wn}-${w}-${k}.md`,{body:{body:`x ${w} ${k}\n`,wait}});if(r.status>=300)e.push(r.status+r.text.slice(0,80));lat.push(r.ms)}}));
 out[wait+Wn]={p50:L.pct(lat,.5),p95:L.pct(lat,.95),max:+Math.max(...lat).toFixed(0),perSec:+(lat.length/((performance.now()-s)/1000)).toFixed(0),errs:e.slice(0,2)};}
const r=await L.http(v,'PUT','/v1/notes/work/d/one.md',{body:{body:'y\n',wait:'durable'}}); out.receipt=r.text.slice(0,400);
console.log(JSON.stringify(out,null,1)); p.kill(); process.exit(0);
