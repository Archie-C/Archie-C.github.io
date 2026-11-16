// Deploy with --no-verify-jwt. All privileged credentials stay in this function.
const site = Deno.env.get('MODEL_SITE_ORIGIN') || 'https://archie-c.github.io';
const base = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const cookieName = '__Host-model_participant';
const cors = {'Access-Control-Allow-Origin':site, 'Access-Control-Allow-Credentials':'true', 'Access-Control-Allow-Headers':'content-type, x-model-file', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Vary':'Origin', 'Cache-Control':'no-store'};
const headers = {apikey:key, Authorization:`Bearer ${key}`};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body: unknown, status=200, extra: Record<string,string>={}) => Response.json(body,{status,headers:{...cors,...extra}});
class UserError extends Error { status: number; constructor(message: string,status=400){super(message);this.status=status;} }
async function rpc(name: string, data: object) {
 const r = await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if (!r.ok) { const err = await r.json().catch(()=>({}));
   const allowed = ['Submissions are closed','Too many active submissions','Please wait before submitting again','Upload unavailable','Submission cannot be queued','Both valid files are required','Name must be 1 to 40 characters','Only completed submissions with a score can be published'];
   if (allowed.includes(err.message)) throw new UserError(err.message,409);
   throw Error('Database request failed');
 }
 return r.status===204 ? null : await r.json();
}
async function readJson(request: Request) {
 const reader=request.body?.getReader(); const chunks: Uint8Array[]=[]; let size=0;
 if (reader) while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>4096){await reader.cancel();throw new UserError('Request too large',413);} chunks.push(value); }
 const bytes=new Uint8Array(size); let pos=0; for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;} const raw=new TextDecoder().decode(bytes);
 try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
 catch { throw new UserError('Invalid request'); }
}
function getId(value: unknown) { if (typeof value !== 'string' || !uuid.test(value)) throw new UserError('Invalid submission'); return value; }
Deno.serve(async (request: Request) => {
 if (request.headers.get('origin') !== site) return reply({error:'Origin not allowed'},403);
 if (request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if (!base || !key) return reply({error:'Submission service is not configured'},503);
 try {
  const url = new URL(request.url), action = url.searchParams.get('action') || 'dashboard';
  const exercise=url.searchParams.get('exercise') ?? 'nn-rocket';
  if (!/^[a-z0-9-]{1,64}$/.test(exercise)) throw new UserError('Invalid exercise');
  if (!['GET','POST'].includes(request.method)) throw new UserError('Method not allowed',405);
  if ((action==='dashboard') !== (request.method==='GET')) throw new UserError('Method not allowed',405);
  let secret = request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  const identityNew = !secret || !/^[a-f0-9]{64}$/.test(secret);
  if (identityNew) {
   if (action!=='dashboard') throw new UserError('Browser identity unavailable. Reload the page and enable cookies.',401);
   secret = Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  const setCookie = {'Set-Cookie':`${cookieName}=${secret}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=None; Partitioned`};
  // Do not create an identity until the browser has returned the cookie.
  if (identityNew) { const data=await rpc('model_dashboard',{p_participant:null,p_exercise:exercise}); return reply({...data,identity_new:true},200,setCookie); }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))),b=>b.toString(16).padStart(2,'0')).join('');
  const participant = await rpc(action==='create' || action==='name' ? 'model_identity' : 'model_lookup',{p_hash:hash});
  if (action==='dashboard') { const data=await rpc('model_dashboard',{p_participant:participant,p_exercise:exercise}); return reply({...data,identity_new:false},200,setCookie); }
  if (!participant) throw new UserError('No submissions found for this browser.',401);
  if (action==='upload') {
   const id=getId(url.searchParams.get('id')), file=request.headers.get('x-model-file');
   if (file!=='model.py' && file!=='weights.safetensors') throw new UserError('Invalid filename');
   await rpc('model_rate',{p_participant:participant,p_action:'upload'});
   const info=await rpc('model_upload_info',{p_participant:participant,p_submission:id,p_file:file});
   const declared=Number(request.headers.get('content-length'));
   if (declared && declared>info.max_bytes) throw new UserError('File is too large',413);
   // Read with an explicit cap even when Content-Length is absent or false.
   const reader=request.body?.getReader(); if (!reader) throw new UserError('File is empty');
   const chunks: Uint8Array[]=[]; let size=0;
   while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>info.max_bytes){await reader.cancel(); throw new UserError('File is too large',413);} chunks.push(value); }
   if (!size) throw new UserError('File is empty');
   const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   const target=`${base}/storage/v1/object/model-artifacts/${info.path.split('/').map(encodeURIComponent).join('/')}`;
   const stored=await fetch(target,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','x-upsert':'false'},body:bytes});
   if (!stored.ok) throw new UserError('Upload failed; please start a new attempt',409);
   await rpc('model_record_upload',{p_participant:participant,p_submission:id,p_file:file,p_sha256:digest});
   return reply({uploaded:true});
  }
  const data=await readJson(request);
  if (action==='create') return reply(await rpc('model_create',{p_participant:participant,p_exercise:exercise}));
  if (action==='queue' || action==='abort') { if(action==='queue') await rpc('model_rate',{p_participant:participant,p_action:'queue'}); await rpc(`model_${action}`,{p_participant:participant,p_submission:getId(data.id)}); return reply({ok:true}); }
  if (action==='name') { if(typeof data.name!=='string') throw new UserError('Invalid name'); await rpc('model_name',{p_participant:participant,p_name:data.name}); return reply({ok:true}); }
  if (action==='publish') { const id=data.id===null?null:getId(data.id); await rpc('model_publish',{p_participant:participant,p_exercise:exercise,p_submission:id}); return reply({ok:true}); }
  throw new UserError('Unknown action',404);
 } catch(error) {
  if (error instanceof UserError) return reply({error:error.message},error.status);
  console.error('Model submissions request failed'); return reply({error:'Submission service temporarily unavailable'},503);
 }
});
