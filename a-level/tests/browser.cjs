// Real browser + real PostgreSQL functions; only Supabase's HTTP/Auth transport is emulated.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {createDatabase,fixtureBank,uid}=require('./database.cjs');
const root=path.resolve(__dirname,'../..');
const artifacts=path.join(__dirname,'artifacts');

async function run() {
  const db=await createDatabase();
  await db.query('select revision_private.import_questions($1)',[fixtureBank()]);
  let configured=false,dropCompletion=false,port;
  const actions=[];
  const authUser={id:uid,aud:'authenticated',role:'authenticated',email:'student@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  const jwt=[{alg:'HS256',typ:'JWT'},{sub:uid,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.test-signature';
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/auth/v1/')) {
        if(url.pathname.endsWith('/logout'))return json(res,200,{});
        if(url.pathname.endsWith('/user'))return json(res,200,authUser);
        return json(res,200,{access_token:jwt,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'fixture-refresh',user:authUser});
      }
      if(url.pathname==='/rest/v1/rpc/revision_api') {
        let body='';for await(const chunk of req)body+=chunk;
        const request=JSON.parse(body);actions.push(request);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
        await db.exec('set role authenticated');
        try {
          const result=(await db.query('select public.revision_api($1,$2) data',[request.p_action,request.p_payload])).rows[0].data;
          if(dropCompletion&&request.p_action==='complete'){req.socket.destroy();return;}
          return json(res,200,result);
        }catch(error){return json(res,400,{message:error.message,code:error.code});}
        finally {await db.exec('reset role');}
      }
      if(url.pathname==='/a-level/config.js') {
        res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});
        res.end(configured?`export default {supabaseUrl:'http://127.0.0.1:${port}',supabasePublishableKey:'fixture-public-key'};`:'export default {supabaseUrl:"",supabasePublishableKey:""};');return;
      }
      const relative=decodeURIComponent(url.pathname).replace(/^\/+/,''),target=path.resolve(root,relative||'index.html');
      if(!target.startsWith(root+path.sep)||relative.split('/').some(p=>p.startsWith('.')||p==='node_modules')) {res.writeHead(403);res.end();return;}
      const file=fs.statSync(target).isDirectory()?path.join(target,'index.html'):target;
      const type={'.html':'text/html','.css':'text/css','.js':'application/javascript','.mjs':'application/javascript','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'}[path.extname(file)]||'text/plain';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(fs.readFileSync(file));
    }catch(error){if(!res.headersSent)res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
  let browser,page;
  try {
    const executable=process.env.REVISION_BROWSER||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
    browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
    const context=await browser.newContext({viewport:{width:1280,height:960},timezoneId:'Europe/Vienna'});
    page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/a-level/`);
    await page.getByRole('heading',{name:'Connect your revision space'}).waitFor();
    configured=true;await page.reload();
    await page.getByLabel('Email',{exact:true}).fill('student@example.test');
    await page.getByLabel('Password',{exact:true}).fill('fixture-password');
    await page.getByRole('button',{name:'Sign in →',exact:true}).click();
    await page.getByRole('heading',{name:'Make this your revision space.'}).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'Timezone',exact:true}).inputValue(),'Europe/Vienna');
    await page.getByRole('combobox',{name:'Timezone',exact:true}).selectOption({label:'United Kingdom — London (GMT / BST)'});
    await page.getByLabel('Daily revision target (minutes)').fill('10');
    await page.getByRole('button',{name:'Save and review your syllabus'}).click();
    await page.getByRole('heading',{name:'Start with what you have covered.'}).waitFor();
    assert.equal((await db.query('select timezone from public.revision_profiles where user_id=$1',[uid])).rows[0].timezone,'Europe/London');
    const confidence=page.locator('[data-confidence="maths-pure-mathematics-year-1-ch01"]');
    await confidence.selectOption('3');
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Chapter confidence saved'));
    await page.locator('[data-confidence="maths-pure-mathematics-year-1-ch02"]').selectOption('3');
    await page.waitForFunction(()=>document.querySelector('[data-confidence="maths-pure-mathematics-year-1-ch02"]').value==='3'&&document.querySelector('#connection').textContent==='All changes saved');
    await page.locator('a[data-view="today"]').click();
    await page.getByRole('button',{name:'Start revision'}).click();
    await page.getByRole('button',{name:'Begin next question'}).click();
    await page.locator('#question-text .katex').first().waitFor();
    await page.waitForFunction(()=>{const img=document.querySelector('#question-assets img');return img?.complete&&img.naturalWidth>0;});
    assert.equal(await page.locator('#solution-text').count(),0);
    await page.getByRole('button',{name:'Reveal worked solution'}).click();
    await page.getByRole('status').filter({hasText:'Choose how easy'}).waitFor();
    await page.locator('input[name=ease][value="4"]').check();
    await page.getByRole('button',{name:'Reveal worked solution'}).click();
    await page.locator('#solution-text .katex').first().waitFor();
    assert.equal(await page.locator('input[name=ease]:enabled').count(),0);
    await page.locator('input[name=correctness][value="5"]').check();
    await page.getByLabel('Marks earned').fill('2');
    // Interrupted draft resumes with local correctness and server-revealed solution.
    await page.reload();
    await page.locator('#solution-text').waitFor();
    assert.equal(await page.locator('input[name=correctness][value="5"]').isChecked(),true);
    assert.equal(await page.getByRole('button',{name:'Resume timer'}).count(),1);
    // Commit succeeds but the HTTP response disappears: retry must add exactly one attempt.
    dropCompletion=true;
    await page.getByRole('button',{name:'Save attempt and continue'}).click();
    await page.getByRole('button',{name:'Retry pending saves'}).waitFor();
    dropCompletion=false;
    await page.getByRole('button',{name:'Retry pending saves'}).click();
    await page.getByRole('heading',{name:'Ready for your next question?'}).waitFor();
    assert.equal((await db.query('select count(*)::int n from public.revision_attempts')).rows[0].n,1);
    await page.getByRole('button',{name:'Begin next question'}).click();
    await page.locator('input[name=ease][value="2"]').check();
    await page.getByRole('button',{name:'Reveal worked solution'}).click();
    await page.locator('#solution-text').waitFor();
    await context.setOffline(true);
    await page.locator('input[name=correctness][value="1"]').check();
    await page.getByRole('button',{name:'Save attempt and continue'}).click();
    await page.getByRole('button',{name:'Retry pending saves'}).waitFor();
    assert.match(await page.locator('#connection').innerText(),/pending/);
    await context.setOffline(false);
    await page.getByRole('heading',{name:'Ready for your next question?'}).waitFor();
    assert.equal((await db.query('select count(*)::int n from public.revision_attempts')).rows[0].n,2);
    // Another client advances the version: preserve the draft and require explicit conflict review.
    await page.getByRole('button',{name:'Begin next question'}).click();
    await page.locator('#question-text').waitFor();
    await db.exec('reset role');
    await db.query('update public.revision_sessions set version=version+1 where user_id=$1',[uid]);
    await page.locator('input[name=ease][value="3"]').check();
    await page.getByRole('button',{name:'Review latest saved session'}).waitFor();
    await page.getByRole('button',{name:'Review latest saved session'}).click();
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Latest session loaded'));
    assert.equal(await page.locator('input[name=ease][value="3"]').isChecked(),true);
    // Raw HTML and unsafe URLs do not become executable DOM; LaTeX still renders.
    const rendered=await page.evaluate(async()=>{
      const {renderMarkdown}=await import('./model.mjs');const target=document.createElement('div');document.body.append(target);
      renderMarkdown(target,'<img src=x onerror="window.pwned=1">\n\n[x](javascript:alert(1))\n\n$x_1^2$');
      const result={unsafe:target.querySelectorAll('[onerror],a[href^="javascript:"],script').length,math:target.querySelectorAll('.katex').length,pwned:window.pwned||0};target.remove();return result;
    });
    assert.equal(rendered.unsafe,0);assert.equal(rendered.math,1);assert.equal(rendered.pwned,0);
    fs.mkdirSync(artifacts,{recursive:true});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(artifacts,'practice-desktop.png'),fullPage:true});
    await page.locator('a[data-view="progress"]').click();
    await page.getByRole('heading',{name:'Understand what you know.'}).waitFor();
    assert.match(await page.locator('main').innerText(),/provisional/);
    await page.locator('a[data-view="exams"]').click();
    await page.getByRole('heading',{name:'No exam dates recorded'}).waitFor();
    await page.locator('a[data-view="today"]').click();
    fs.mkdirSync(artifacts,{recursive:true});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(artifacts,'today-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(artifacts,'today-mobile.png'),fullPage:true});
    await page.locator('a[data-view="topics"]').click();
    await page.locator('summary').first().focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('details').first().getAttribute('open'),'');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--p-accent').trim()),'#6B2C5C');
    await page.locator('a[data-view="settings"]').click();
    assert.equal(await page.getByRole('combobox',{name:'Timezone',exact:true}).inputValue(),'Europe/London');
    await page.reload();
    await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'Timezone',exact:true}).inputValue(),'Europe/London');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(artifacts,'settings-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    assert.ok(actions.some(a=>a.p_action==='complete'));
    assert.equal(fs.readFileSync(path.join(root,'a-level/assets/colors_and_type.css'),'utf8'),fs.readFileSync(path.join(root,'design_system/colors_and_type.css'),'utf8'));
    console.log('Browser integration: setup, auth, onboarding, maths, reveal, interrupted drafts, offline saves, lost responses, mobile and keyboard checks passed.');
  } catch(error) {
    if(page){console.error('Browser state:',(await page.locator('main').innerText()).slice(0,2000));console.error('Notice:',await page.locator('#notice').innerText());fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true});}
    throw error;
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
