import fs from 'node:fs';
const R=process.env.HV_REPO, OUT=process.env.TRACE_OUT; const S={};
const wrap=(C,cls,names)=>{for(const n of names){const f=C.prototype[n]; if(typeof f!=='function')continue; C.prototype[n]=function(...a){const t=performance.now();const k=cls+'.'+n;const done=()=>{const s=S[k]||(S[k]={n:0,ms:0});s.n++;s.ms+=performance.now()-t};const r=f.apply(this,a); if(r&&typeof r.then==='function') return r.finally(done); done(); return r;}}};
const all=(C)=>Object.getOwnPropertyNames(C.prototype).filter(n=>n!=='constructor'&&!Object.getOwnPropertyDescriptor(C.prototype,n).get&&!Object.getOwnPropertyDescriptor(C.prototype,n).set);
if(process.argv.some(a=>a.endsWith('server.mjs'))||process.argv.includes('start')){
for(const [file,cls] of [['core','VaultCore'],['search','Index'],['audit','Audit'],['sync','Sync'],['crdt','OpStore'],['store','Store'],['groupcommit','GroupCommitWriter'],['projector','Projector']]){
 const m=await import(`${R}/server/src/${file}.mjs`); wrap(m[cls],cls,all(m[cls]));}
if(OUT) setInterval(()=>{Object.keys(S).length&&fs.writeFileSync(OUT+"."+process.pid,JSON.stringify(S))},1000).unref();}
