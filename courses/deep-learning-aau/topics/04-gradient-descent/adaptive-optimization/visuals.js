(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = n => Number.isFinite(n) ? Number(n.toPrecision(5)).toString() : 'out of range';
  const colors = {gd:'#5b2a86', momentum:'#286a85', adagrad:'#a04d58', rmsprop:'#497946', adam:'#a07120'};
  const labels = {gd:'Gradient descent', momentum:'Momentum', adagrad:'AdaGrad', rmsprop:'RMSProp', adam:'Adam'};
  const eps = 1e-8;
  const value = id => Number($(id).value);
  const sequence = id => $(id).value.split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const valid = a => a.length > 0 && a.length <= 100 && a.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6);
  function inputs(ids, fn) { ids.forEach(id => $(id).addEventListener('input', fn)); }
  function output(id) { const node = $(id + '-out'); if (node) node.textContent = $(id).value; }
  function svg(id, inner) { $(id).innerHTML = inner; }
  function path(points, color, width=2) { return `<polyline fill="none" stroke="${color}" stroke-width="${width}" points="${points.map(p => p.map(fmt).join(',')).join(' ')}"/>`; }
  function contours(rotated) {
    let s = '<rect x="35" y="10" width="610" height="265" fill="var(--bg-sunk)"/><g clip-path="url(#clip)">';
    // Equal data scale in both axes. The rotated ellipse is transformed about the origin.
    for (const level of [0.5,2,8,32,80,200]) {
      const pts=[];
      for(let i=0;i<=100;i++){ const a=i*Math.PI*2/100, u=Math.sqrt(2*level/100)*Math.cos(a), v=Math.sqrt(2*level)*Math.sin(a); const x=rotated?(u-v)/Math.SQRT2:u, y=rotated?(u+v)/Math.SQRT2:v; pts.push([340+x*100,142.5-y*100]); }
      s += path(pts,'var(--rule-strong)',1);
    }
    return s;
  }
  function chartPaths(id, trajectories, rotated) {
    let s='<defs><clipPath id="clip"><rect x="35" y="10" width="610" height="265"/></clipPath></defs>'+contours(rotated);
    for(const [name, points] of Object.entries(trajectories)) s+=path(points.map(([x,y])=>[340+x*100,142.5-y*100]),colors[name]);
    s+='</g><text x="615" y="293" fill="var(--fg-2)" font-size="12">w₁ →</text><text x="38" y="25" fill="var(--fg-2)" font-size="12">w₂ ↑</text>';
    svg(id,s);
  }
  function gradient(w, rotated) { if(!rotated) return [100*w[0],w[1]]; const u=(w[0]+w[1])/Math.SQRT2, v=(-w[0]+w[1])/Math.SQRT2; return [(100*u-v)/Math.SQRT2,(100*u+v)/Math.SQRT2]; }
  function objective(w,rotated) { const g=gradient(w,rotated); return (w[0]*g[0]+w[1]*g[1])/2; }
  function scaleDraw() {
    ['scale1','scale2','scale-steps'].forEach(output);
    const paths={gd:[[1,1]],adam:[[1,1]]};
    for(let t=0;t<value('scale-steps');t++) for(const name of Object.keys(paths)){const w=paths[name].at(-1), g=gradient(w,false), a=name==='gd'?[0.01,0.01]:[value('scale1'),value('scale2')]; paths[name].push(w.map((x,i)=>x-a[i]*g[i]));}
    chartPaths('scaling',paths,false);
    $('scaling-readout').textContent=`Purple: ordinary gradient descent; ochre: coordinate-scaled. At iteration ${value('scale-steps')}: ordinary (${paths.gd.at(-1).map(fmt).join(', ')}), scaled (${paths.adam.at(-1).map(fmt).join(', ')}).`;
  }
  inputs(['scale1','scale2','scale-steps'],scaleDraw); scaleDraw();
  function seqDraw() {
    const a=sequence('sequence'); if(!valid(a)){ $('sequence-readout').textContent='Enter 1–100 finite comma-separated gradients, each between −1,000,000 and 1,000,000.'; svg('sequence-chart',''); return; }
    const slider=$('seq-step'); slider.max=a.length; slider.value=Math.min(+slider.value,a.length); ['beta','seq-step'].forEach(output);
    let ada=0,rms=0, A=[],R=[]; const b=value('beta'), t=value('seq-step');
    a.forEach(g=>{ada+=g*g;rms=b*rms+(1-b)*g*g;A.push(ada);R.push(rms);});
    const g=a[t-1], ar=A[t-1], rr=R[t-1], ae=0.1/(Math.sqrt(ar)+eps), re=0.1/(Math.sqrt(rr)+eps);
    $('sequence-readout').textContent=`Iteration ${t}, gradient ${fmt(g)}. AdaGrad: sum = ${fmt(ar)}, effective rate = ${fmt(ae)}, update = ${fmt(-ae*g)}, |update| = ${fmt(Math.abs(ae*g))}. RMSProp: average = ${fmt(rr)}, effective rate = ${fmt(re)}, update = ${fmt(-re*g)}, |update| = ${fmt(Math.abs(re*g))}.`;
    const max=Math.max(1,...A,...R), x=i=>40+i*600/Math.max(1,a.length-1), y=v=>185-155*v/max;
    svg('sequence-chart',`<line x1="40" y1="185" x2="640" y2="185" stroke="var(--rule-strong)"/>${path(A.map((v,i)=>[x(i),y(v)]),colors.adagrad)}${path(R.map((v,i)=>[x(i),y(v)]),colors.rmsprop)}<line x1="${x(t-1)}" y1="20" x2="${x(t-1)}" y2="185" stroke="var(--fg-2)" stroke-dasharray="3 3"/><text x="40" y="15" fill="var(--fg-2)" font-size="12">Squared gradient statistic · maximum ${fmt(max)}</text><text x="40" y="210" fill="${colors.adagrad}" font-size="12">AdaGrad</text><text x="130" y="210" fill="${colors.rmsprop}" font-size="12">RMSProp</text><text x="570" y="210" fill="var(--fg-2)" font-size="12">iteration →</text>`);
  }
  inputs(['sequence','beta','seq-step'],seqDraw);seqDraw();
  function adamDraw(){
    const a=sequence('adam-sequence'); if(!valid(a)){ $('adam-readout').textContent='Enter 1–100 finite comma-separated gradients, each between −1,000,000 and 1,000,000.'; return; }
    const slider=$('adam-step'); slider.max=a.length; slider.value=Math.min(+slider.value,a.length); ['b1','b2','adam-step'].forEach(output);
    let m=0,v=0; const b1=value('b1'),b2=value('b2'),t=value('adam-step'); for(let i=0;i<t;i++){m=b1*m+(1-b1)*a[i];v=b2*v+(1-b2)*a[i]**2;}
    const mh=m/(1-b1**t),vh=v/(1-b2**t);
    $('adam-readout').textContent=`Iteration ${t}: gradient = ${fmt(a[t-1])}; m = ${fmt(m)}; v = ${fmt(v)}; corrected m̂ = ${fmt(mh)}; corrected v̂ = ${fmt(vh)}; corrected update = ${fmt(-0.1*mh/(Math.sqrt(vh)+eps))}; without correction = ${fmt(-0.1*m/(Math.sqrt(v)+eps))}.`;
  }
  inputs(['adam-sequence','b1','b2','adam-step'],adamDraw);adamDraw();
  function simulate(name,steps,rate,mu,beta,b1,b2,rotated){
    let w=[1,1], velocity=[0,0],r=[0,0],m=[0,0],v=[0,0]; const points=[w.slice()], losses=[objective(w,rotated)];
    for(let t=1;t<=steps;t++){
      const g=gradient(w,rotated);
      w=w.map((x,i)=>{if(name==='gd') return x-rate*g[i]; if(name==='momentum'){velocity[i]=mu*velocity[i]-rate*g[i]; return x+velocity[i];} if(name==='adagrad'){r[i]+=g[i]**2;return x-rate*g[i]/(Math.sqrt(r[i])+eps);} if(name==='rmsprop'){r[i]=beta*r[i]+(1-beta)*g[i]**2;return x-rate*g[i]/(Math.sqrt(r[i])+eps);} m[i]=b1*m[i]+(1-b1)*g[i];v[i]=b2*v[i]+(1-b2)*g[i]**2;return x-rate*(m[i]/(1-b1**t))/(Math.sqrt(v[i]/(1-b2**t))+eps);});
      points.push(w.slice());losses.push(objective(w,rotated));
    } return {points,losses};
  }
  function comparison(){
    ['rate','mu','cmp-beta','cmp-b1','cmp-b2','iterations'].forEach(output);
    const chosen=[...document.querySelectorAll('#method-controls input:checked')].map(x=>x.value), rotated=value('rotation')===1, steps=value('iterations'), trajectories={}, results={};
    chosen.forEach(n=>{results[n]=simulate(n,steps,value('rate'),value('mu'),value('cmp-beta'),value('cmp-b1'),value('cmp-b2'),rotated);trajectories[n]=results[n].points;});
    chartPaths('paths',trajectories,rotated);
    let s='<defs><clipPath id="loss-clip"><rect x="55" y="10" width="590" height="180"/></clipPath></defs><line x1="55" y1="190" x2="645" y2="190" stroke="var(--rule-strong)"/><g clip-path="url(#loss-clip)">';
    // Fixed log scale allows comparisons across control changes; zero is clamped for display.
    for(const n of chosen) s+=path(results[n].losses.map((v,i)=>[55+i*590/100,190-(Math.log10(Math.max(v,1e-12))+12)*180/18]),colors[n]);
    s+='</g><text x="5" y="20" fill="var(--fg-2)" font-size="11">10⁶</text><text x="5" y="190" fill="var(--fg-2)" font-size="11">10⁻¹²</text><text x="575" y="215" fill="var(--fg-2)" font-size="12">iteration → 100</text>';
    svg('loss',s);
    $('paths-readout').textContent=chosen.length?chosen.map(n=>`${labels[n]}: E = ${fmt(results[n].losses.at(-1))}`).join(' · '):'Select at least one optimiser.';
  }
  inputs(['rate','mu','cmp-beta','cmp-b1','cmp-b2','iterations','rotation'],comparison); $('method-controls').addEventListener('change',comparison);
  let timer=null; function stop(){if(timer!==null){clearInterval(timer);timer=null; $('play').textContent='Play';}}
  $('step').addEventListener('click',()=>{stop();$('iterations').value=Math.min(100,value('iterations')+1);comparison();});
  $('reset').addEventListener('click',()=>{stop();$('iterations').value=0;comparison();});
  $('play').addEventListener('click',()=>{if(timer!==null){stop();return;} if(value('iterations')>=100)$('iterations').value=0; $('play').textContent='Pause';timer=setInterval(()=>{if(value('iterations')>=100){stop();return;} $('iterations').value=value('iterations')+1;comparison();},200);});
  comparison();
})();
