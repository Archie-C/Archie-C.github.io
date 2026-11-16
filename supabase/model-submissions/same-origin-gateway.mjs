// Optional same-origin gateway for a site served behind a Cloudflare Worker route.
// Configure SITE_ORIGIN and MODEL_FUNCTION_URL as documented. No service key is used.
const path='/api/model-submissions';
const denied=(message,status)=>Response.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
export default {
 async fetch(request,env) {
  let site,upstream;
  try {
   site=new URL(env.SITE_ORIGIN);
   upstream=new URL(env.MODEL_FUNCTION_URL);
   if(site.protocol!=='https:' || site.origin!==env.SITE_ORIGIN || upstream.protocol!=='https:' ||
      upstream.username || upstream.password || upstream.search || upstream.hash ||
      upstream.pathname!=='/functions/v1/model-submissions') throw Error();
  } catch { return denied('Submission gateway is not configured',503); }
  const incoming=new URL(request.url);
  if(incoming.origin!==site.origin || incoming.pathname!==path) return denied('Not found',404);
  if(!['GET','POST','OPTIONS'].includes(request.method)) return denied('Method not allowed',405);
  const origin=request.headers.get('Origin');
  // Browsers omit Origin on same-origin GET. Mutations must carry the expected Origin.
  if((origin && origin!==site.origin) || (request.method!=='GET' && origin!==site.origin)) return denied('Origin not allowed',403);
  upstream.search=incoming.search;
  const headers=new Headers();
  for(const name of ['cookie','content-type','x-model-file']) {
   const value=request.headers.get(name);if(value!==null)headers.set(name,value);
  }
  headers.set('Origin',site.origin);
  let result;
  try {
   result=await fetch(upstream,{method:request.method,headers,body:request.method==='POST'?request.body:undefined,redirect:'manual',duplex:'half'});
  } catch {return denied('Submission service temporarily unavailable',503);}
  if(result.status>=300 && result.status<400) return denied('Submission service temporarily unavailable',502);
  const output=new Headers();
  for(const name of ['content-type','set-cookie','access-control-allow-origin','access-control-allow-credentials','access-control-allow-headers','access-control-allow-methods','vary']) {
   const value=result.headers.get(name);if(value!==null)output.set(name,value);
  }
  output.set('Cache-Control','no-store');
  output.set('X-Content-Type-Options','nosniff');
  return new Response(result.body,{status:result.status,headers:output});
 }
};
