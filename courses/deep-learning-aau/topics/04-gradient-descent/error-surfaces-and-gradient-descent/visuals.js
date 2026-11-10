(() => {
  'use strict';
  const ns = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  function el(parent, tag, attrs, content) {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    if (content !== undefined) node.textContent = content;
    parent.appendChild(node); return node;
  }
  const path = (svg, points, attrs = {}) => el(svg, 'polyline', {points: points.map(p => p.map(x => x.toFixed(2)).join(',')).join(' '), fill: 'none', ...attrs});
  const label = (svg, x, y, s, attrs = {}) => el(svg, 'text', {x, y, ...attrs}, s);
  const fmt = n => Math.abs(n) < 1e-10 ? '0' : Math.abs(n) >= 10000 ? n.toExponential(3) : String(Number(n.toFixed(5)));
  const loss = w => (w - 3) ** 2;
  const loss2 = (x, y) => (x - 2) ** 2 + 4 * (y + 1) ** 2;
  const gradient = (x, y) => [2 * (x - 2), 8 * (y + 1)];
  function arrow(svg, x, y, dx, dy, color) {
    const len = Math.hypot(dx, dy); if (len < 0.01) return;
    const ex = x + dx, ey = y + dy, ux = dx / len, uy = dy / len;
    el(svg, 'line', {x1:x,y1:y,x2:ex,y2:ey,stroke:color,'stroke-width':2});
    el(svg, 'polygon', {points:`${ex},${ey} ${ex-9*ux+4*uy},${ey-9*uy-4*ux} ${ex-9*ux-4*uy},${ey-9*uy+4*ux}`,fill:color});
  }
  function contour(svg, bounds, rect) {
    const [xmin,xmax,ymin,ymax] = bounds, [left,top,width,height] = rect;
    const X = x => left + (x-xmin)/(xmax-xmin)*width, Y = y => top + (ymax-y)/(ymax-ymin)*height;
    el(svg,'rect',{x:left,y:top,width,height,fill:'var(--bg-sunk)',stroke:'var(--rule)'});
    // Clip contours and paths to the plotting rectangle.
    const id = `clip-${svg.id}`; const defs = el(svg,'defs'); const clip = el(defs,'clipPath',{id}); el(clip,'rect',{x:left,y:top,width,height});
    const group = el(svg,'g',{'clip-path':`url(#${id})`});
    [0.25,1,2,4,8,16,32,64,128,256,512,1024,4096,16384,65536,262144,1048576].forEach(c => {
      let points=[]; for(let i=0;i<=100;i++){const a=2*Math.PI*i/100; points.push([X(2+Math.sqrt(c)*Math.cos(a)),Y(-1+Math.sqrt(c)/2*Math.sin(a))]);}
      path(group,points,{stroke:'var(--rule-strong)','stroke-width':1});
    });
    label(svg,left,top+height+20,fmt(xmin)); label(svg,left+width,top+height+20,fmt(xmax),{'text-anchor':'end'});
    label(svg,left-8,top+9,fmt(ymax),{'text-anchor':'end'}); label(svg,left-8,top+height,fmt(ymin),{'text-anchor':'end'});
    label(svg,left+width/2,top+height+36,'w₁',{'text-anchor':'middle'}); label(svg,10,top+height/2,'w₂');
    return {X,Y,group};
  }
  function surface() {
    const svg=$('surface');
    // Orthographic projection of the same quadratic, expressed in offsets from its minimum.
    const project=(u,v)=>[165+42*u-30*v,205+16*u+12*v-4*(u*u+4*v*v)];
    for(let v=-1.5;v<=1.501;v+=0.3){let pts=[];for(let u=-2;u<=2.001;u+=0.1)pts.push(project(u,v));path(svg,pts,{stroke:'var(--rule-strong)','stroke-width':1});}
    for(let u=-2;u<=2.001;u+=0.4){let pts=[];for(let v=-1.5;v<=1.501;v+=0.06)pts.push(project(u,v));path(svg,pts,{stroke:'var(--accent)','stroke-opacity':0.65,'stroke-width':1});}
    label(svg,165,255,'quadratic surface',{'text-anchor':'middle'});
    const {X,Y}=contour(svg,[-2,6,-3,1],[400,25,240,190]);
    el(svg,'circle',{cx:X(2),cy:Y(-1),r:4,fill:'var(--accent)'}); label(svg,520,255,'contours',{'text-anchor':'middle'});
  }
  function stationary() {
    const svg=$('stationary'); const curve=(fun,x0,x1,X,Y)=>{const p=[];for(let i=0;i<=160;i++){let x=x0+(x1-x0)*i/160;p.push([X(x),Y(fun(x))]);}return p;};
    const X=x=>165+90*x, Y=y=>185-70*y;
    el(svg,'line',{x1:30,y1:185,x2:300,y2:185,class:'axis'});
    path(svg,curve(x=>(x*x-1)**2,-1.5,1.5,X,Y),{stroke:'var(--accent)','stroke-width':2});
    [[-1,0],[0,1],[1,0]].forEach(([x,y])=>el(svg,'circle',{cx:X(x),cy:Y(y),r:4,fill:'var(--accent)'}));
    label(svg,75,205,'−1'); label(svg,160,105,'max'); label(svg,250,205,'1'); label(svg,165,225,'two minima',{'text-anchor':'middle'});
    const X2=x=>510+80*x, Y2=y=>115-50*y;
    path(svg,curve(x=>x*x,-1.35,1.35,X2,Y2),{stroke:'var(--accent)','stroke-width':2});
    path(svg,curve(x=>-x*x,-1.35,1.35,X2,Y2),{stroke:'var(--c-cat-2)','stroke-width':2});
    el(svg,'circle',{cx:510,cy:115,r:4,fill:'var(--fg)'}); label(svg,510,225,'saddle: two slices',{'text-anchor':'middle'});
    label(svg,620,48,'w₂ = 0',{'text-anchor':'end'});label(svg,620,195,'w₁ = 0',{'text-anchor':'end'});
  }
  function drawGradient(){
    const svg=$('gradient');svg.replaceChildren();const {X,Y,group}=contour(svg,[-1.5,5.5,-2.75,0.75],[90,12,490,245]);
    const x=+$('point1').value,y=+$('point2').value,g=gradient(x,y); const dx=g[0]*70,dy=-g[1]*70;
    el(group,'circle',{cx:X(2),cy:Y(-1),r:3,fill:'var(--fg-3)'}); label(svg,X(2)+8,Y(-1)-8,'minimum');
    const scale=68/(Math.hypot(dx,dy)||1); arrow(group,X(x),Y(y),dx*scale,dy*scale,'var(--accent)'); arrow(group,X(x),Y(y),-dx*scale,-dy*scale,'var(--c-cat-2)');
    el(group,'circle',{cx:X(x),cy:Y(y),r:4,fill:'var(--fg)'}); $('point1-value').textContent=fmt(x);$('point2-value').textContent=fmt(y);
    $('gradient-readout').textContent=`w = (${fmt(x)}, ${fmt(y)}) · ∇E = (${fmt(g[0])}, ${fmt(g[1])}) · E = ${fmt(loss2(x,y))}`;
  }
  function oneChart(id,values) {
    const svg=$(id);svg.replaceChildren();const maxDist=Math.max(5,...values.map(v=>Math.abs(v-3)))*1.15;
    const xmin=3-maxDist,xmax=3+maxDist,ymax=maxDist**2*1.08, X=x=>55+(x-xmin)/(xmax-xmin)*570,Y=y=>245-y/ymax*220;
    el(svg,'line',{x1:55,y1:245,x2:625,y2:245,class:'axis'});el(svg,'line',{x1:55,y1:25,x2:55,y2:245,class:'axis'});
    let pts=[];for(let i=0;i<=160;i++){let x=xmin+(xmax-xmin)*i/160;pts.push([X(x),Y(loss(x))]);}path(svg,pts,{stroke:'var(--fg-2)','stroke-width':2});
    path(svg,values.map(w=>[X(w),Y(loss(w))]),{stroke:'var(--accent)','stroke-width':1.5,'stroke-dasharray':'4 3'});
    values.forEach((w,i)=>el(svg,'circle',{cx:X(w),cy:Y(loss(w)),r:i===values.length-1?5:3,fill:'var(--accent)'}));
    label(svg,55,265,fmt(xmin));label(svg,625,265,fmt(xmax),{'text-anchor':'end'});label(svg,340,285,'w',{'text-anchor':'middle'});label(svg,12,30,'E(w)');label(svg,60,35,fmt(ymax));
  }
  function oneDemo(prefix, chart, initial, eta) {
    let values=[initial()];
    function render(){oneChart(chart,values);const w=values[values.length-1];$(prefix+'-readout').textContent=`iteration ${values.length-1} · w = ${fmt(w)} · E(w) = ${fmt(loss(w))}`;}
    function reset(){values=[initial()];render();}
    $(prefix+'-step').addEventListener('click',()=>{if(values.length>=101)return;const w=values[values.length-1], next=w-2*eta()*(w-3);if(Number.isFinite(loss(next))) values.push(next);render();});
    $(prefix+'-reset').addEventListener('click',reset);render();$(prefix+'-controls').hidden=false;return reset;
  }
  function twoDemo() {
    let values=[[0,0]]; const svg=$('two-dimensional');
    function render(){
      svg.replaceChildren();const extent=Math.max(3,...values.flatMap(([x,y])=>[Math.abs(x-2),Math.abs(y+1)*2]))*1.15;
      const {X,Y,group}=contour(svg,[2-extent,2+extent,-1-extent/2,-1+extent/2],[80,15,520,235]);
      path(group,values.map(([x,y])=>[X(x),Y(y)]),{stroke:'var(--accent)','stroke-width':2});
      values.forEach(([x,y])=>el(group,'circle',{cx:X(x),cy:Y(y),r:3,fill:'var(--accent)'}));
      const [x,y]=values[values.length-1],g=gradient(x,y),dx=-g[0]*520/(2*extent),dy=g[1]*235/extent,scale=55/(Math.hypot(dx,dy)||1);
      arrow(group,X(x),Y(y),dx*scale,dy*scale,'var(--accent)');el(group,'circle',{cx:X(x),cy:Y(y),r:5,fill:'var(--fg)'});
      $('two-rate-value').textContent=fmt(+$('two-rate').value);$('two-readout').textContent=`iteration ${values.length-1} · w = (${fmt(x)}, ${fmt(y)}) · ∇E = (${fmt(g[0])}, ${fmt(g[1])}) · E = ${fmt(loss2(x,y))}`;
    }
    function reset(){values=[[0,0]];render();}
    $('two-step').addEventListener('click',()=>{if(values.length>=101)return;const [x,y]=values[values.length-1],g=gradient(x,y),eta=+$('two-rate').value,next=[x-eta*g[0],y-eta*g[1]];if(Number.isFinite(loss2(...next)))values.push(next);render();});
    $('two-reset').addEventListener('click',reset);$('two-rate').addEventListener('input',reset);render();$('two-controls').hidden=false;
  }
  surface(); stationary(); drawGradient(); $('gradient-controls').hidden=false; ['point1','point2'].forEach(id=>$(id).addEventListener('input',drawGradient));
  const resetOne=oneDemo('one','one-dimensional',()=>+$('initial').value,()=>0.1);
  $('initial-value').textContent=fmt(+$('initial').value);$('initial').addEventListener('input',()=>{$('initial-value').textContent=fmt(+$('initial').value);resetOne();});
  const resetRate=oneDemo('rate','rate-chart',()=>0,()=>+$('rate').value);
  $('rate-value').textContent=fmt(+$('rate').value);$('rate').addEventListener('input',()=>{$('rate-value').textContent=fmt(+$('rate').value);resetRate();});twoDemo();
})();
