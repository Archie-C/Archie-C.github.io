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
  let configured=false,dropCompletion=false,dropAdminImport=false,archiveAfterReviewPreview=false,port;
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
      if(['/rest/v1/rpc/revision_api','/rest/v1/rpc/revision_admin_api','/rest/v1/rpc/revision_is_admin','/rest/v1/rpc/revision_admin_coverage'].includes(url.pathname)) {
        const rpc=url.pathname.split('/').pop();
        let body='';for await(const chunk of req)body+=chunk;
        const request=JSON.parse(body);actions.push(request);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
        await db.exec('set role authenticated');
        try {
          const result=rpc==='revision_is_admin'?(await db.query('select public.revision_is_admin() data')).rows[0].data:
            rpc==='revision_admin_coverage'?(await db.query('select public.revision_admin_coverage() data')).rows[0].data:
            (await db.query(`select public.${rpc}($1,$2) data`,[request.p_action,request.p_payload])).rows[0].data;
          if(archiveAfterReviewPreview&&rpc==='revision_admin_api'&&request.p_action==='preview'&&request.p_payload.rows?.[0]?.question_id==='browser-review-a'){
            archiveAfterReviewPreview=false;await db.exec('reset role');
            await db.query("update public.revision_questions set status='archived' where id='browser-review-a' and version=2");
          }
          if(dropCompletion&&request.p_action==='complete'){req.socket.destroy();return;}
          if(dropAdminImport&&rpc==='revision_admin_api'&&request.p_action==='import'){dropAdminImport=false;return json(res,503,{message:'Simulated lost import response',code:'TEST'});}
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
    await page.getByRole('heading',{name:'Your chapters'}).waitFor();
    assert.equal((await db.query('select timezone from public.revision_profiles where user_id=$1',[uid])).rows[0].timezone,'Europe/London');
    assert.equal(await page.locator('#book-filter').count(),0);
    const confidence=page.locator('[data-confidence="maths-pure-mathematics-year-1-ch01"][data-confidence-value="3"]');
    await confidence.click();
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Chapter confidence saved'));
    await page.locator('[data-confidence="maths-pure-mathematics-year-1-ch01"][data-confidence-value=""]').click();
    await page.locator('[data-confidence="maths-pure-mathematics-year-1-ch01"][data-confidence-value=""]').waitFor({state:'detached'});
    await confidence.click();
    await confidence.waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-confidence="maths-pure-mathematics-year-1-ch01"][data-confidence-value="3"]')?.getAttribute('aria-pressed')==='true');
    await page.locator('[data-confidence="maths-pure-mathematics-year-1-ch02"][data-confidence-value="3"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-confidence="maths-pure-mathematics-year-1-ch02"][data-confidence-value="3"]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('#connection').textContent==='All changes saved');
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
    const studentRendering=await page.evaluate(()=>({
      prompt:document.querySelector('#question-text').innerHTML,
      assets:document.querySelector('#question-assets').innerHTML,
      solution:document.querySelector('#solution-text').innerHTML,
      font:getComputedStyle(document.querySelector('#question-text')).font
    }));
    assert.equal(await page.locator('input[name=ease]:enabled').count(),0);
    await page.locator('input[name=correctness][value="5"]').check();
    await page.getByLabel('Marks earned').fill('2');
    // Interrupted draft resumes with local correctness and server-revealed solution.
    // Also exercise Auth recovery of a session that needs refreshing on startup.
    await page.evaluate(()=>{const key='ac-revision-auth',session=JSON.parse(localStorage.getItem(key));session.expires_at=Math.floor(Date.now()/1000)-10;localStorage.setItem(key,JSON.stringify(session));});
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
    await page.getByRole('heading',{name:'Your progress'}).waitFor();
    await page.locator('a[data-view="exams"]').click();
    await page.getByRole('heading',{name:'No exam dates recorded'}).waitFor();
    const examPaper=(await db.query("select id from public.revision_papers where specification_id='edexcel-9ma0' and option_book_id is null order by id limit 1")).rows[0].id;
    const examYear=(await db.query('select exam_year from public.revision_profiles where user_id=$1',[uid])).rows[0].exam_year;
    await db.query("insert into public.revision_exams(paper_id,exam_date,source_url,start_time,duration_minutes,provisional) values($1,make_date($2,6,5),'https://example.com/timetable','09:00',120,false)",[examPaper,examYear]);
    await page.reload();
    await page.locator('.exam-row time').waitFor();
    assert.equal(await page.locator('.exam-row time').getAttribute('datetime'),`${examYear}-06-05`);
    assert.match(await page.locator('.exam-row').innerText(),/Starts 09:00/);
    assert.match(await page.locator('.exam-row').innerText(),/2 hr/);
    assert.equal(await page.getByRole('link',{name:'Timetable source'}).getAttribute('href'),'https://example.com/timetable');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1280,height:960});
    await db.query('delete from public.revision_exams where paper_id=$1 and exam_date=make_date($2,6,5)',[examPaper,examYear]);
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
    // Admin gate uses the same real session. A student never loads protected records.
    await page.goto(`http://127.0.0.1:${port}/admin/`);
    await page.getByRole('heading',{name:'Administrator access required'}).waitFor();
    assert.equal(await page.locator('#navigation').isVisible(),false);
    await db.query('select revision_private.set_admin($1,true)',[uid]);await page.reload();
    await page.getByRole('heading',{name:'Questions',exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    const {toCSV}=await import('../admin-import.mjs');
    const topic=(await db.query('select id from public.revision_subtopics order by id limit 1')).rows[0].id;
    const csv=toCSV([
      ['question_id','topic_codes','question','answer','difficulty','estimated_minutes','status'],
      ['browser-admin-question',topic,'Find $\\frac{6}{2}$, then explain.\nA second line.','Answer: $3$.',2,2,'verified']
    ]);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV template'}).click();assert.match((await download).suggestedFilename(),/questions-template.csv/);
    await page.getByLabel('CSV content').fill(csv);
    await page.getByRole('button',{name:'Parse, validate & preview'}).click();
    await page.getByRole('button',{name:'Confirm import',exact:true}).waitFor();
    assert.ok(await page.locator('.katex').count()>0,'Preview renders LaTeX');
    assert.equal((await db.query("select count(*)::int n from public.revision_questions where id='browser-admin-question'")).rows[0].n,0,'Preview does not mutate');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    await page.locator('#csv-file').setInputFiles({name:'questions.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.getByText('questions.csv · Up to', {exact:false}).waitFor();
    await page.getByRole('button',{name:'Parse, validate & preview'}).click();
    await page.getByLabel('I have reviewed these changes').check();
    // A committed import with a lost response is safely replayed from the same tab.
    dropAdminImport=true;
    await page.getByRole('button',{name:'Confirm import',exact:true}).click();
    await page.locator('#notice').filter({hasText:'result may be uncertain'}).waitFor();
    await page.getByLabel('I have reviewed these changes').check();
    await page.getByRole('button',{name:'Confirm import',exact:true}).click();
    await page.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
    assert.equal((await db.query("select count(*)::int n from public.revision_questions where id='browser-admin-question'")).rows[0].n,1);
    await page.getByRole('button',{name:'Back to records'}).click();
    await page.locator('[data-record="browser-admin-question"]').click();
    await page.getByLabel('Question (Markdown / LaTeX)',{exact:true}).fill('Updated $x^2$.');
    await page.getByRole('button',{name:'Validate & preview changes'}).click();
    await page.getByLabel('I have reviewed these changes').check();
    await page.getByRole('button',{name:'Confirm import',exact:true}).click();
    await page.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
    assert.equal((await db.query("select max(version) v from public.revision_questions where id='browser-admin-question'")).rows[0].v,2);
    // Review uses the student's exact content renderer without creating attempts.
    const draftBase=fixtureBank().questions.find(q=>q.id==='fixture-draft');
    const reviewDrafts=['browser-review-a','browser-review-b','browser-review-c'].map(id=>({...draftBase,id,
      assets:[{...draftBase.assets[0],url:'tests/fixtures/diagram.svg'}]}));
    await db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:reviewDrafts}]);
    const attemptsBeforeReview=(await db.query('select count(*)::int n from public.revision_attempts')).rows[0].n;
    await page.getByRole('button',{name:'Back to records'}).click();
    await page.getByRole('searchbox',{name:'Search',exact:true}).fill('browser-review');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await page.getByRole('button',{name:'Review drafts',exact:true}).click();
    await page.getByRole('heading',{name:'Review question',exact:true}).waitFor();
    assert.match(await page.locator('.admin-meta').innerText(),/browser-review-a/);
    assert.equal(await page.locator('[data-question-solution]').count(),1,'The solution is shown immediately');
    assert.equal(await page.getByRole('checkbox').count(),0,'Review needs no extra confirmation checkbox');
    assert.equal(await page.getByRole('button',{name:'Verify & next',exact:true}).isEnabled(),true);
    assert.equal(await page.locator('#review-details').count(),0,'Source/licence details are removed');
    assert.equal(await page.getByLabel('Source',{exact:true}).count(),0);
    assert.equal(await page.getByLabel('Licence',{exact:true}).count(),0);
    await page.waitForFunction(()=>{const img=document.querySelector('[data-question-assets] img');return img?.complete&&img.naturalWidth>0;});
    const adminRendering=await page.evaluate(()=>({
      prompt:document.querySelector('[data-question-prompt]').innerHTML,
      assets:document.querySelector('[data-question-assets]').innerHTML,
      solution:document.querySelector('[data-question-solution]').innerHTML,
      font:getComputedStyle(document.querySelector('[data-question-prompt]')).font
    }));
    assert.deepEqual(adminRendering,studentRendering,'Admin and student content, diagrams, maths and typography match');
    await page.getByRole('button',{name:'Skip',exact:true}).click();
    await page.getByText('browser-review-b · Version 1 · draft',{exact:true}).waitFor();
    assert.match(await page.locator('.admin-meta').innerText(),/browser-review-b/);
    assert.equal(await page.getByRole('button',{name:'Verify & next',exact:true}).isEnabled(),true);
    await page.setViewportSize({width:1280,height:960});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(artifacts,'admin-review-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(artifacts,'admin-review-mobile.png'),fullPage:true});
    assert.equal((await db.query("select status from public.revision_questions where id='browser-review-b'")).rows[0].status,'draft','Reading does not publish');
    dropAdminImport=true;
    await page.getByRole('button',{name:'Verify & next',exact:true}).click();
    await page.locator('#notice').filter({hasText:'result may be uncertain'}).waitFor();
    await page.getByRole('button',{name:'Retry verification',exact:true}).click();
    await page.getByText('browser-review-c · Version 1 · draft',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'content','The next question receives focus');
    assert.equal(await page.locator('#review-details').count(),0);
    assert.equal(await page.getByRole('button',{name:'Preview verification',exact:true}).count(),0);
    await page.getByRole('button',{name:'Verify & next',exact:true}).click();
    await page.getByRole('heading',{name:'No more drafts to review',exact:true}).waitFor();
    assert.equal((await db.query("select status from public.revision_questions where id='browser-review-c' and version=2")).rows[0].status,'verified','One click verifies and advances');
    const published=(await db.query("select * from public.revision_questions where id='browser-review-b' order by version desc")).rows;
    assert.equal(published.length,2,'Retry creates one immutable version');
    assert.equal(published[0].status,'verified');assert.equal(published[1].status,'draft');
    assert.equal('source' in published[0],false,'Question storage has no source metadata');
    assert.equal((await db.query("select admin_id from revision_private.admin_imports where changes->0->>'id'='browser-review-b'")).rows[0].admin_id,uid,'Reviewer identity is retained in the audit');
    assert.equal((await db.query("select count(*)::int n from revision_private.admin_imports where changes->0->>'id'='browser-review-b'")).rows[0].n,1,'Verification is audited once');
    assert.equal((await db.query("select status from public.revision_questions where id='browser-review-a'")).rows[0].status,'draft','Skip leaves the draft unchanged');
    await page.getByRole('button',{name:'Back to questions',exact:true}).click();
    await page.locator('[data-review="browser-review-a"]').click();
    await page.getByRole('button',{name:'Verify question',exact:true}).waitFor();
    await db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[{...reviewDrafts[0],version:2,prompt_md:'A changed question: $x=4$.'}]}]);
    await page.getByRole('button',{name:'Verify question',exact:true}).click();
    await page.locator('#notice').filter({hasText:'changed during review'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Verify question',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Reload question',exact:true}).click();
    await page.getByText('browser-review-a · Version 2 · draft',{exact:true}).waitFor();
    assert.match(await page.locator('[data-question-prompt]').innerText(),/A changed question/);
    // A concurrent change between automatic validation and publication is still rejected.
    archiveAfterReviewPreview=true;
    await page.getByRole('button',{name:'Verify question',exact:true}).click();
    await page.locator('#notice').filter({hasText:'PREVIEW_STALE'}).waitFor();
    assert.equal((await db.query("select max(version) v from public.revision_questions where id='browser-review-a'")).rows[0].v,2,'Concurrent change is never overwritten');
    await page.getByRole('button',{name:'Reload question',exact:true}).click();
    await page.getByText('browser-review-a · Version 2 · archived',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Verify question',exact:true}).isDisabled(),true,'Archived questions cannot be verified');
    await db.query('select revision_private.import_questions($1)',[{schema_version:1,questions:[{...reviewDrafts[0],version:3}]}]);
    await page.getByRole('button',{name:'Back to questions',exact:true}).click();
    await page.locator('[data-review="browser-review-a"]').click();
    await page.getByRole('button',{name:'Edit question',exact:true}).click();
    await page.getByLabel('Question (Markdown / LaTeX)',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.locator('[data-review="browser-review-a"]').click();
    await page.getByRole('button',{name:'Verify question',exact:true}).click();
    await page.locator('[data-review="browser-review-a"]').waitFor();
    assert.equal((await db.query("select status from public.revision_questions where id='browser-review-a' and version=4")).rows[0].status,'verified');
    assert.equal((await db.query('select count(*)::int n from public.revision_attempts')).rows[0].n,attemptsBeforeReview,'Admin reviews do not create student attempts');
    await page.getByRole('link',{name:'Import history'}).click();
    await page.getByRole('button',{name:'View changes'}).first().click();
    await page.getByText('browser-review-a · update',{exact:true}).waitFor();
    await page.getByRole('link',{name:'Exam timetables'}).click();
    await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    const paper=(await db.query('select p.*,s.code,su.board from public.revision_papers p join public.revision_specifications s on s.id=p.specification_id join public.revision_subjects su on su.id=s.subject_id order by p.id limit 1')).rows[0];
    await page.getByLabel('CSV content').fill(toCSV([
      ['exam_id','exam_board','specification','paper_code','paper_name','exam_date','start_time','duration_minutes','status'],
      ['browser-exam-2027',paper.board,paper.code,paper.id,paper.title,'2027-06-05','09:00',120,'confirmed']
    ]));
    await page.getByRole('button',{name:'Parse, validate & preview'}).click();
    await page.getByLabel('I have reviewed these changes').check();await page.getByRole('button',{name:'Confirm import',exact:true}).click();
    await page.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
    await page.getByRole('button',{name:'Back to records'}).click();
    await page.locator('[data-record="browser-exam-2027"]').waitFor();
    // New timetable records do not require a pre-existing syllabus.
    const standaloneCSV=toCSV([
      ['exam_id','exam_board','specification','paper_code','paper_name','exam_date','start_time','duration_minutes','status','subject_name','specification_title'],
      ['browser-unmapped-exam-2027','OCR','H777','h777-01','New science paper','2027-06-06','13:30',90,'estimated','New science','A-level New science']
    ]);
    await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    await page.getByLabel('CSV content').fill(standaloneCSV);await page.getByRole('button',{name:'Parse, validate & preview'}).click();
    await page.getByText('On confirmation, this batch also creates',{exact:false}).waitFor();
    assert.equal((await db.query("select count(*)::int n from public.revision_specifications where id='ocr-h777'")).rows[0].n,0);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal((await db.query("select count(*)::int n from public.revision_subjects where id='ocr-h777'")).rows[0].n,0);
    await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    await page.getByLabel('CSV content').fill(standaloneCSV);await page.getByRole('button',{name:'Parse, validate & preview'}).click();
    await page.getByRole('row').filter({hasText:'browser-unmapped-exam-2027'}).getByText('Will create:',{exact:false}).waitFor();
    await page.getByLabel('I have reviewed these changes').check();await page.getByRole('button',{name:'Confirm import',exact:true}).click();
    await page.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
    await page.getByText('Also created 1 subject, 1 specification, 1 paper.',{exact:false}).waitFor();
    assert.equal((await db.query("select count(*)::int n from public.revision_paper_chapters where paper_id='h777-01'")).rows[0].n,0);
    await page.getByRole('button',{name:'Back to records'}).click();
    await page.locator('[data-record="browser-unmapped-exam-2027"]').waitFor();
    await db.exec(`insert into public.revision_books(id,specification_id,title,required,sort_order) values('browser-science-book','ocr-h777','Science core and options',true,100);
      insert into public.revision_chapters(id,book_id,number,title) values('browser-science-a','browser-science-book',1,'Science chapter A'),('browser-science-b','browser-science-book',2,'Science chapter B');
      insert into public.revision_subtopics(id,chapter_id,number,title,page_start,page_count,length_rating,difficulty_rating,strand) values('browser-science-a-topic','browser-science-a','1.1','Science skill A',1,1,1,1,'Science'),('browser-science-b-topic','browser-science-b','2.1','Science skill B',2,1,1,1,'Science');`);
    await db.exec(`insert into public.revision_specifications(id,subject_id,code,title,source_url) values('ocr-h778','ocr-h777','H778','Other science specification','');
      insert into public.revision_books(id,specification_id,title,required,sort_order) values('browser-other-science-book','ocr-h778','Other science book',true,101);
      insert into public.revision_chapters(id,book_id,number,title) values('browser-other-science','browser-other-science-book',1,'Other science chapter');
      insert into public.revision_subtopics(id,chapter_id,number,title,page_start,page_count,length_rating,difficulty_rating,strand) values('browser-other-science-topic','browser-other-science','1.1','Other science skill',1,1,1,1,'Science');`);
    await page.getByRole('link',{name:'Topics & specifications'}).click();
    await page.getByRole('link',{name:'Subtopics',exact:true}).click();
    await page.getByRole('button',{name:'Export CSV',exact:true}).waitFor();
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.pager').textContent.includes('26'));
    // Changes made after opening the list must be present in the download.
    const quotedTitle='Science "forces", $F=ma$\nA second line';
    await db.query("insert into public.revision_subtopics(id,chapter_id,number,title,page_start,page_count,length_rating,difficulty_rating,strand) values('browser-science-export','browser-science-a','1.2',$1,3,2,2,3,'Science')",[quotedTitle]);
    await db.query("update public.revision_chapters set archived=true where id='browser-science-b'");
    const auditCountBeforeExport=(await db.query('select count(*)::int n from revision_private.admin_imports')).rows[0].n;
    const downloadTopics=async()=>{
      const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
      const file=await waiting;assert.equal(file.suggestedFilename(),'revision-topics.csv');
      // Use an independent CSV reader: exports can exceed the importer's 500-row limit.
      return JSON.parse(require('node:child_process').execFileSync('python',['-c',
        'import csv,json,sys; print(json.dumps(list(csv.DictReader(open(sys.argv[1],encoding="utf-8-sig",newline="")))))',
        await file.path()],{encoding:'utf8',maxBuffer:8*1024*1024}));
    };
    const allTopics=await downloadTopics();
    const activeIDs=(await db.query('select t.id from public.revision_subtopics t join public.revision_chapters c on c.id=t.chapter_id where not t.archived and not c.archived')).rows.map(t=>t.id).sort();
    assert.deepEqual(allTopics.map(t=>t.id).sort(),activeIDs,'Export uses live data and includes every page, excluding archived parents');
    assert.ok(allTopics.length>25);
    assert.equal(allTopics.find(t=>t.id==='browser-science-export').title,quotedTitle,'Quotes, commas, maths and line breaks survive the download');
    const optionValues=name=>page.locator(`select[name="${name}"] option`).evaluateAll(options=>options.map(o=>o.value));
    await page.getByRole('searchbox',{name:'Search',exact:true}).fill('forces');
    await page.getByLabel('Subject',{exact:true}).selectOption('ocr-h777');
    assert.deepEqual(await optionValues('specification'),['','ocr-h777','ocr-h778'],'Subject narrows specifications immediately');
    assert.deepEqual(await optionValues('chapter'),['','browser-other-science','browser-science-a','browser-science-b'],'Subject narrows chapters without choosing a specification first');
    await page.getByLabel('Specification',{exact:true}).selectOption('ocr-h777');
    assert.deepEqual(await optionValues('chapter'),['','browser-science-a','browser-science-b'],'Specification narrows chapters immediately');
    await page.getByLabel('Chapter',{exact:true}).selectOption('browser-science-a');
    await page.getByLabel('Specification',{exact:true}).selectOption('ocr-h778');
    assert.equal(await page.getByLabel('Chapter',{exact:true}).inputValue(),'','Changing specification clears the chapter');
    assert.deepEqual(await optionValues('chapter'),['','browser-other-science']);
    await page.getByLabel('Chapter',{exact:true}).selectOption('browser-other-science');
    await page.getByLabel('Subject',{exact:true}).selectOption('maths');
    assert.equal(await page.getByLabel('Specification',{exact:true}).inputValue(),'');
    assert.equal(await page.getByLabel('Chapter',{exact:true}).inputValue(),'');
    assert.deepEqual(await optionValues('specification'),['','edexcel-9ma0']);
    assert.ok((await optionValues('chapter')).slice(1).every(id=>id.startsWith('maths-')));
    assert.equal(await page.getByRole('searchbox',{name:'Search',exact:true}).inputValue(),'forces','Hierarchy changes preserve other filter inputs');
    await page.getByLabel('Subject',{exact:true}).selectOption('');
    assert.ok((await optionValues('specification')).includes('ocr-h778'),'Clearing a parent restores broader choices');
    await page.getByLabel('Subject',{exact:true}).selectOption('ocr-h777');
    await page.getByLabel('Specification',{exact:true}).selectOption('ocr-h777');
    await page.getByLabel('Chapter',{exact:true}).selectOption('browser-science-a');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await page.locator('[data-record="browser-science-export"]').waitFor();
    const scopedTopics=await downloadTopics();assert.equal(scopedTopics.length,1);
    assert.equal(scopedTopics[0].id,'browser-science-export');
    assert.equal(scopedTopics[0].chapter_title,'Science chapter A');
    assert.equal(scopedTopics[0].book_id,'browser-science-book');
    assert.equal(scopedTopics[0].specification_id,'ocr-h777');
    assert.equal(scopedTopics[0].specification_code,'H777');
    assert.equal(scopedTopics[0].subject_name,'New science');
    assert.equal(scopedTopics[0].exam_board,'OCR');
    await page.getByRole('searchbox',{name:'Search',exact:true}).fill('no-such-export-topic');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await page.getByText('No records match.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Export CSV',exact:true}).isDisabled(),true);
    await page.getByRole('searchbox',{name:'Search',exact:true}).fill('');
    await page.getByLabel('Chapter',{exact:true}).selectOption('');
    await page.getByLabel('Status',{exact:true}).selectOption('all');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await page.locator('[data-record="browser-science-b-topic"]').waitFor();
    const includingArchived=await downloadTopics();assert.equal(includingArchived.length,3);
    assert.equal(includingArchived.find(t=>t.id==='browser-science-b-topic').chapter_archived,'true');
    assert.equal((await db.query('select count(*)::int n from revision_private.admin_imports')).rows[0].n,auditCountBeforeExport,'Export does not mutate content or imports');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(artifacts,'admin-topic-export-mobile.png'),fullPage:true});
    await db.query("update public.revision_chapters set archived=false where id='browser-science-b'");
    await page.getByRole('link',{name:'Question bank'}).click();
    await page.getByLabel('Subject',{exact:true}).selectOption('ocr-h777');
    assert.deepEqual(await optionValues('specification'),['','ocr-h777','ocr-h778']);
    assert.ok((await optionValues('topic')).slice(1).every(id=>id.startsWith('browser-')));
    await page.getByLabel('Specification',{exact:true}).selectOption('ocr-h778');
    assert.deepEqual(await optionValues('topic'),['','browser-other-science-topic'],'Question topic choices follow the specification');
    await page.getByLabel('Topic',{exact:true}).selectOption('browser-other-science-topic');
    await page.getByLabel('Subject',{exact:true}).selectOption('maths');
    assert.equal(await page.getByLabel('Topic',{exact:true}).inputValue(),'','Changing subject clears a selected question topic');
    assert.ok((await optionValues('topic')).slice(1).every(id=>id.startsWith('maths-')));
    await page.getByRole('link',{name:'Topics & specifications'}).click();
    await page.getByRole('link',{name:'Option groups',exact:true}).click();
    await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    await page.getByLabel('CSV content').fill(toCSV([['id','specification_id','title','min_choices','max_choices'],['browser-science-options','ocr-h777','Science optional chapter',1,1]]));
    await page.getByRole('button',{name:'Parse, validate & preview'}).click();await page.getByLabel('I have reviewed these changes').check();
    await page.getByRole('button',{name:'Confirm import',exact:true}).click();await page.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
    await page.getByRole('link',{name:'Option choices',exact:true}).click();await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    await page.getByLabel('CSV content').fill(toCSV([['id','group_id','title','chapter_ids'],['browser-science-choice-a','browser-science-options','Science option A','browser-science-a'],['browser-science-choice-b','browser-science-options','Science option B','browser-science-b']]));
    await page.getByRole('button',{name:'Parse, validate & preview'}).click();await page.getByLabel('I have reviewed these changes').check();
    await page.getByRole('button',{name:'Confirm import',exact:true}).click();await page.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
    await page.goto(`http://127.0.0.1:${port}/a-level/#settings`);
    await page.locator('[name=specification][value="ocr-h777"]').check();await page.locator('[name=specification][value="edexcel-9ma0"]').uncheck();
    await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.locator('#notice').filter({hasText:'choose exactly 1'}).waitFor();
    await page.getByRole('radio',{name:'Science option A',exact:true}).check();await page.getByRole('button',{name:'Save settings',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Your settings are saved'}).waitFor();
    await page.locator('a[data-view=topics]').click();await page.locator('[data-confidence="browser-science-a"][data-confidence-value="3"]').waitFor();
    assert.equal(await page.locator('[data-confidence="browser-science-b"]').count(),0);
    await page.locator('[data-confidence="browser-science-a"][data-confidence-value="3"]').click();await page.locator('[data-confidence="browser-science-a"][data-confidence-value="3"][aria-pressed="true"]').waitFor();
    await page.locator('a[data-view=settings]').click();await page.getByRole('radio',{name:'Science option B',exact:true}).check();
    await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.locator('#notice').filter({hasText:'Your settings are saved'}).waitFor();
    await page.reload();await page.getByRole('radio',{name:'Science option B',exact:true}).waitFor();assert.equal(await page.getByRole('radio',{name:'Science option B',exact:true}).isChecked(),true);
    await page.locator('a[data-view=topics]').click();await page.locator('[data-confidence="browser-science-b"][data-confidence-value="3"]').waitFor();
    assert.equal(await page.locator('[data-confidence="browser-science-a"]').count(),0);
    assert.equal((await db.query("select confidence from public.revision_progress where user_id=$1 and chapter_id='browser-science-a'",[uid])).rows[0].confidence,3);
    await page.goto(`http://127.0.0.1:${port}/admin/#coverage`);
    await page.locator('.coverage-card').first().waitFor();
    assert.equal(await page.locator('.coverage-card').count(),12,'Coverage is paginated');
    const firstCoverageId=await page.locator('[data-coverage-topic]').first().getAttribute('data-coverage-topic');
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('[data-coverage-topic]')?.dataset.coverageTopic!==id,firstCoverageId);
    await page.getByLabel('Subject',{exact:true}).selectOption('maths');
    assert.ok((await optionValues('chapter')).slice(1).every(id=>id.startsWith('maths-')));
    await page.getByLabel('Chapter',{exact:true}).selectOption('maths-pure-mathematics-year-1-ch01');
    await page.getByLabel('Question target',{exact:true}).fill('2');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await page.locator('.coverage-ready').first().waitFor();
    const coverageRows=await page.locator('[data-coverage-topic]').count();
    assert.ok(coverageRows>0&&coverageRows<12);
    assert.ok(await page.locator('.coverage-stats').innerText().then(text=>text.includes('At target')));
    await page.setViewportSize({width:1280,height:960});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(artifacts,'admin-coverage-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Coverage fits mobile');
    await page.screenshot({path:path.join(artifacts,'admin-coverage-mobile.png'),fullPage:true});
    await page.locator('[data-coverage-status="empty"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-coverage-status="empty"]')?.getAttribute('aria-pressed')==='true');
    assert.equal(await page.locator('.coverage-card:not(.coverage-empty)').count(),0);
    await page.locator('[data-coverage-status="ready"]').click();
    await page.locator('.coverage-ready').first().waitFor();
    const coverageTopic=await page.locator('[data-coverage-topic]').first().getAttribute('data-coverage-topic');
    await page.locator('[data-coverage-topic]').first().click();
    await page.locator('#filters select[name=topic]').waitFor();
    assert.equal(await page.getByLabel('Topic',{exact:true}).inputValue(),coverageTopic,'Card opens the matching question bank');
    await page.getByRole('link',{name:'Question coverage'}).click();
    await page.getByLabel('Find a subtopic',{exact:true}).fill('no-matching-subtopic');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await page.getByRole('heading',{name:'No active subtopics found',exact:true}).waitFor();
    // A missing migration must never appear as a bank with zero questions.
    await page.route('**/rest/v1/rpc/revision_admin_coverage',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST202',message:'Function not found'})}));
    await page.getByRole('button',{name:'Refresh coverage',exact:true}).click();
    await page.locator('#notice').filter({hasText:'11-question-coverage.sql'}).waitFor();
    assert.equal(await page.locator('.coverage-card').count(),0);
    await page.unroute('**/rest/v1/rpc/revision_admin_coverage');
    await page.getByRole('button',{name:'Refresh coverage',exact:true}).click();
    await page.getByRole('heading',{name:'No active subtopics found',exact:true}).waitFor();
    await page.goto(`http://127.0.0.1:${port}/admin/#chapters`);
    await page.getByRole('link',{name:'Topics & specifications'}).click();
    await page.locator('[data-record]').first().click();
    await page.getByLabel('Representative example (Markdown / LaTeX)',{exact:true}).fill('Recall $\\int x\\,dx=\\frac{x^2}{2}+C$.');
    await page.getByLabel('Reminder reviewed',{exact:true}).selectOption('true');
    assert.ok(await page.locator('#edit-maths .katex').count()>0);
    await page.getByRole('button',{name:'Validate & preview changes'}).click();
    await page.getByLabel('I have reviewed these changes').check();await page.getByRole('button',{name:'Confirm import',exact:true}).click();
    await page.getByRole('heading',{name:'Import complete',exact:true}).waitFor();
    await page.getByRole('link',{name:'Students',exact:false}).click();
    await page.getByRole('button',{name:'View progress'}).first().click();
    await page.getByRole('heading',{name:'Chapter progress',exact:true}).waitFor();
    await page.getByRole('link',{name:'Question bank'}).click();
    await page.getByRole('button',{name:'Import CSV',exact:true}).click();
    await page.getByLabel('CSV content').fill(csv.replace(',"2","2",',',"8","2",'));
    await page.getByRole('button',{name:'Parse, validate & preview'}).click();
    await page.locator('.validation-error').filter({hasText:'Difficulty'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Confirm import',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.setViewportSize({width:1280,height:960});
    await page.screenshot({path:path.join(artifacts,'admin-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(artifacts,'admin-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('heading',{name:'Revision administration'}).waitFor();
    assert.equal(await page.locator('[data-record]').count(),0);
    // A stuck Auth lock/refresh must produce recovery UI, preserving local work.
    let stalledAuth=true;
    const vendor=fs.readFileSync(path.join(root,'a-level/assets/vendor/supabase.js'),'utf8');
    await page.route('**/a-level/assets/vendor/supabase.js',route=>route.fulfill({contentType:'application/javascript',body:vendor+(stalledAuth?`
      {const original=globalThis.supabase.createClient;globalThis.supabase={...globalThis.supabase,createClient(...args){const client=original(...args);client.auth.getSession=()=>new Promise(()=>{});return client;}}}
    `:'')}));
    const pendingKey=`ac-revision-outbox:${uid}`,pendingWork='[{"action":"complete","payload":{"correctness":4}}]';
    await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:pendingKey,value:pendingWork});
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${port}/a-level/`);
    await page.getByText('Checking saved sign-in…',{exact:true}).waitFor();
    await page.clock.runFor(16000);
    await page.getByRole('heading',{name:'Your revision space could not load.'}).waitFor();
    assert.match(await page.locator('#notice').innerText(),/saved sign-in timed out/);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),pendingKey),pendingWork);
    stalledAuth=false;await page.getByRole('button',{name:'Retry connection'}).click();
    await page.getByRole('heading',{name:'Welcome back'}).waitFor();
    stalledAuth=true;await page.goto(`http://127.0.0.1:${port}/admin/`);
    await page.getByText('Checking saved sign-in…',{exact:true}).waitFor();await page.clock.runFor(16000);
    await page.getByRole('heading',{name:'Your admin space could not load.'}).waitFor();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),pendingKey),pendingWork);
    assert.deepEqual(errors,[]);
    assert.ok(actions.some(a=>a.p_action==='complete'));
    const normalizeLines=text=>text.replace(/\r\n/g,'\n');
    assert.equal(normalizeLines(fs.readFileSync(path.join(root,'a-level/assets/colors_and_type.css'),'utf8')),normalizeLines(fs.readFileSync(path.join(root,'design_system/colors_and_type.css'),'utf8')));
    console.log('Browser integration: student/admin flows, question coverage filters/targets/pagination, missing-migration recovery, desktop/mobile coverage, matching student previews, draft verification/skip/edit, stale review protection, verification retries/audit, CSV imports, immutable edits, expired-session recovery, stalled-auth timeout/retry, preserved pending work and mobile passed.');
  } catch(error) {
    if(page){console.error('Browser state:',(await page.locator('main').innerText()).slice(0,2000));console.error('Notice:',await page.locator('#notice').innerText());fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true});}
    throw error;
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
