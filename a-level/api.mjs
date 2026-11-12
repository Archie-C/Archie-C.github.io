import config from './config.js';

export class RevisionBackend {
  constructor() {
    this.configured=Boolean(config.supabaseUrl&&config.supabasePublishableKey);
    if(this.configured) {
      if(!globalThis.supabase) throw new Error('The sign-in library did not load. Reload the page.');
      this.client=globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{
        auth:{storageKey:'ac-revision-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
      });
    }
  }
  async call(action,payload={}) {
    const {data,error}=await this.client.rpc('revision_api',{p_action:action,p_payload:payload});
    if(error) {const problem=new Error(error.message);problem.code=error.code;throw problem;}
    return data;
  }
}

// Persist exact payloads before sending: a response lost after commit is safe to retry.
export class Outbox {
  constructor(user,send,onChange=()=>{}) {
    this.key=`ac-revision-outbox:${user}`;this.send=send;this.onChange=onChange;this.running=null;this.blocked=null;
    try {this.entries=JSON.parse(localStorage.getItem(this.key)||'[]');if(!Array.isArray(this.entries)) throw new Error();}
    catch {throw new Error('Saved revision data could not be read. Preserve browser storage and contact the site owner.');}
  }
  persist() {localStorage.setItem(this.key,JSON.stringify(this.entries));this.onChange(this.entries.length,this.blocked);}
  enqueue(action,payload) {
    const entry={action,payload:{...payload,request_id:crypto.randomUUID()}};
    // Only supersede checkpoints that have never been sent; in-flight payloads are immutable.
    if(action==='checkpoint') this.entries=this.entries.filter(e=>!(e.action==='checkpoint'&&!e.sent&&e.payload.item_id===payload.item_id));
    this.entries.push(entry);this.persist();return entry;
  }
  flush(versionFor) {
    if(this.running) return this.running;
    this.running=(async()=>{
      while(this.entries.length&&!this.blocked) {
        const entry=this.entries[0];
        if(!entry.sent) {
          if(entry.payload.session_id) entry.payload.expected_version=versionFor(entry.payload.session_id);
          entry.sent=true;this.persist();
        }
        try {await this.send(entry.action,entry.payload);this.entries.shift();this.persist();}
        catch(error) {
          if(error.code&&!['PGRST000','PGRST001','PGRST002','PGRST301','PGRST302','28000'].includes(error.code)) this.blocked=error;
          this.onChange(this.entries.length,this.blocked);throw error;
        }
      }
    })().finally(()=>{this.running=null;});
    return this.running;
  }
  // Explicit conflict review is required before rebasing unsaved work onto the latest state.
  rebase(session) {
    for(const entry of this.entries) {
      if(entry.payload.session_id!==session?.id) continue;
      const item=session.items.find(i=>i.id===entry.payload.item_id);
      if(item?.state==='completed') {entry.discard=true;continue;}
      if(entry.action==='activate'&&item?.state!=='queued'){entry.discard=true;continue;}
      if(['finish','refresh'].includes(entry.action)&&session.status==='finished'){entry.discard=true;continue;}
      if(entry.action==='finish'&&session.items.some(i=>i.state==='active')){entry.discard=true;continue;}
      if(entry.payload.item_id&&item?.state!=='active'&&entry.action!=='activate') throw new Error('This question changed elsewhere. Your local draft is preserved; contact the site owner before clearing it.');
      if(item&&entry.payload.active_seconds!==undefined) entry.payload.active_seconds=Math.max(item.active_seconds,entry.payload.active_seconds);
      if(item?.revealed_at&&entry.payload.ease!==undefined) entry.payload.ease=item.ease;
      entry.payload.request_id=crypto.randomUUID();delete entry.payload.expected_version;delete entry.sent;
    }
    this.entries=this.entries.filter(e=>!e.discard);this.blocked=null;this.persist();
  }
}
