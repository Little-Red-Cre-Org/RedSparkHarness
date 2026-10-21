import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { strict as assert } from 'node:assert';
import ts from 'typescript';
const root=process.cwd();
const originalRoot='E:/redsparkHarness/RedSparkHarness';
const file='rsh/Engine/context/session-reference/src/projection.ts';
const req=createRequire(pathToFileURL(originalRoot+'/'+file));
const compile=(source)=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2024}}).outputText;
const dataUrl=(source)=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const serializer=dataUrl(compile(readFileSync(resolve(root,'rsh/Engine/context/session-reference/src/serialization.ts'),'utf8')));
async function loadProjection(source){
 const code=compile(source).replace(/from (['"])([^'"]+)\1/g,(_,quote,id)=>'from '+JSON.stringify(id==='./serialization.ts'?serializer:pathToFileURL(req.resolve(id)).href));
 return (await import(dataUrl(code))).retainReferencedSession;
}
const before=await loadProjection(execFileSync('git',['show','HEAD:'+file],{encoding:'utf8'}));
const after=await loadProjection(readFileSync(file,'utf8'));
function timed(fn){const values=[];for(let n=0;n<3;n++){const start=performance.now();fn();values.push(performance.now()-start)}return Number(values.sort((a,b)=>a-b)[1].toFixed(3))}
const results={node:process.version,session:[],browser:[]};
for(const count of [100,500,1500]){
 const snapshot={session:{id:'perf-source',cwd:'/work'},capturedThroughSeq:count,events:Array.from({length:count},(_,i)=>({type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:`${i}: <tag>界🙂\\\n`+'x'.repeat(240)}]}}))};
 assert.deepEqual(after(snapshot,'fixture',1024),before(snapshot,'fixture',1024));
 results.session.push({messages:count,beforeMs:timed(()=>before(snapshot,'fixture',1024)),afterMs:timed(()=>after(snapshot,'fixture',1024)),identical:true});
}
const oldWire=await import(dataUrl(compile(readFileSync('.optimization-evidence/browser-wire-before.ts','utf8'))));
const newWire=await import(dataUrl(compile(readFileSync('E:/redsparkHarness/RedSparkHarness-zero-budget-next/rsh/Modules/Official/web/browser-read-only/src/wire.ts','utf8'))));
const payload={text:'界🙂'.repeat(20000)};
const body=Buffer.from(JSON.stringify(payload));const header=Buffer.alloc(4);header.writeUInt32LE(body.length);const frame=Buffer.concat([header,body]);
for(const chunkBytes of [1024,32]){
 const chunks=[];for(let i=0;i<frame.length;i+=chunkBytes)chunks.push(frame.subarray(i,i+chunkBytes));
 const run=(decoder)=>{const input=new PassThrough();let result;const detach=decoder.receiveFrames(input,value=>{result=value},()=>{throw new Error('Decode error')});for(const chunk of chunks)input.write(chunk);detach();input.destroy();return result};
 assert.deepEqual(run(oldWire),payload);assert.deepEqual(run(newWire),payload);
 results.browser.push({bodyBytes:body.length,chunkBytes,beforeMs:timed(()=>run(oldWire)),afterMs:timed(()=>run(newWire)),identical:true});
}
writeFileSync('.optimization-evidence/performance.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
