// Worker-only API. Deploy with --no-verify-jwt and a separate random MODEL_WORKER_TOKEN.
// The service-role credential remains in the function, never on the worker.
const base=Deno.env.get('SUPABASE_URL') || '';
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const token=Deno.env.get('MODEL_WORKER_TOKEN') || '';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers={apikey:key,Authorization:`Bearer ${key}`};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class InputError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
async function validBearer(value:string|null) {
 const candidate=value?.startsWith('Bearer ')?value.slice(7):'';
 const enc=new TextEncoder();
 const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(token)),crypto.subtle.digest('SHA-256',enc.encode(candidate))]);
 const x=new Uint8Array(a),y=new Uint8Array(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
async function jsonBody(request:Request,limit=32768) {
 const reader=request.body?.getReader();if(!reader)throw new InputError('JSON body required');
 const chunks:Uint8Array[]=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new InputError('Request too large',413);}chunks.push(value);}
 const all=new Uint8Array(length);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.length;}
 try {const value=JSON.parse(new TextDecoder().decode(all));if(!value || typeof value!=='object' || Array.isArray(value))throw Error();return value;}
 catch {throw new InputError('Invalid JSON');}
}
function checkedId(value:unknown) {if(typeof value!=='string'||!uuid.test(value))throw new InputError('Invalid claim');return value;}
async function rpc(name:string,data:object) {
 const r=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!r.ok){if(r.status===400 || r.status===422)throw new InputError('Invalid worker request');throw Error('Database unavailable');}
 return r.status===204?null:await r.json();
}
Deno.serve(async(request:Request)=>{
 if(!base || !key || !/^[a-f0-9]{64}$/i.test(token))return reply({error:'Worker service is not configured'},503);
 if(request.headers.has('origin') || !(await validBearer(request.headers.get('authorization'))))return reply({error:'Unauthorized'},401);
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 try {
  const action=new URL(request.url).searchParams.get('action');const data=await jsonBody(request,action==='replay'?8*1024*1024+4096:32768);
  if(action==='claim'){
   if(typeof data.exercise!=='string'||!/^[a-z0-9-]{1,64}$/.test(data.exercise))throw new InputError('Invalid exercise');
   return reply({claim:await rpc('model_claim',{p_exercise:data.exercise})});
  }
  const submission=checkedId(data.submission_id),claim=checkedId(data.claim_token);
  if(action==='replay'){
   if(!Number.isInteger(data.run_id)||data.run_id<0||data.run_id>3)throw new InputError('Invalid public run');
   const scenarios=['demo_descent','centred_descent','crosswind_diagnostics','near_ground_contact'];
   const replay=data.replay;
   if(!replay||replay.schema!=='rocket-run-v1'||replay.config?.scenario!==scenarios[data.run_id]||!Array.isArray(replay.snapshots)||!replay.snapshots.length)throw new InputError('Invalid replay');
   const bytes=new TextEncoder().encode(JSON.stringify(replay));if(bytes.length>8*1024*1024)throw new InputError('Replay too large',413);
   const path=await rpc('model_worker_replay',{p_submission:submission,p_token:claim,p_run:data.run_id});
   if(!path)throw new InputError('Claim expired or replay unavailable',409);
   const stored=await fetch(`${base}/storage/v1/object/model-artifacts/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{...headers,'Content-Type':'application/json','x-upsert':'false'},body:bytes});
   if(!stored.ok)throw Error('Replay upload failed');
   // Check the lease again after uploading; only finish can publish its manifest.
   if(!await rpc('model_worker_replay',{p_submission:submission,p_token:claim,p_run:data.run_id}))throw new InputError('Claim expired',409);
   return reply({uploaded:true});
  }
  if(action==='heartbeat')return reply({accepted:await rpc('model_heartbeat',{p_submission:submission,p_token:claim})});
  if(action==='reuse'){
   const reused=await rpc('model_reuse_result',{p_submission:submission,p_token:claim,
    p_model_sha256:data.model_sha256,p_weights_sha256:data.weights_sha256,
    p_evaluator_version:data.evaluator_version,p_test_set_version:data.test_set_version,p_duration_ms:data.duration_ms});
   return reply({reused});
  }
  if(action==='finish'){
   const result=await rpc('model_finish',{p_submission:submission,p_token:claim,p_metrics:data.metrics??null,p_duration_ms:data.duration_ms,
    p_evaluator_version:data.evaluator_version??null,p_test_set_version:data.test_set_version??null,p_error_category:data.error_category??null,p_metadata:data.metadata??{}});
   return reply({accepted:result});
  }
  if(action==='artifact'){
   if(data.file!=='model.py' && data.file!=='weights.safetensors')throw new InputError('Invalid artifact');
   const path=await rpc('model_worker_artifact',{p_submission:submission,p_token:claim,p_file:data.file});
   if(!path)throw new InputError('Claim expired or artifact unavailable',409);
   const url=`${base}/storage/v1/object/authenticated/model-artifacts/${path.split('/').map(encodeURIComponent).join('/')}`;
   const stored=await fetch(url,{headers});if(!stored.ok)throw Error('Artifact unavailable');
   return new Response(stored.body,{status:200,headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  throw new InputError('Unknown action',404);
 }catch(error){if(error instanceof InputError)return reply({error:error.message},error.status);console.error('Worker API request failed');return reply({error:'Worker service temporarily unavailable'},503);}
});
