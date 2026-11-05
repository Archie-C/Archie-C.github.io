// Geometry and packet checks without a browser or a simulation runtime.
const fs = require('fs');
const assert = require('assert');
const elements = new Map();
global.document = {getElementById(id) {
  if (!elements.has(id)) elements.set(id, {getContext: () => ({}), addEventListener() {}, options: [], value: '0'});
  return elements.get(id);
}};
global.window = {addEventListener() {}};
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const beforeStart = source.slice(0, source.lastIndexOf('\npoll();setInterval'));
eval(beforeStart + `
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10, a+' != '+b);
let s={x:0,y:0,theta:0}; let nose=bodyPoint([0,3],s,[0,1]);
near(nose[0],0);near(nose[1],2);
s.theta=Math.PI/2;nose=bodyPoint([0,3],s,[0,1]);near(nose[0],-2);near(nose[1],0);
// If COM and fuel-dependent offset move together, the body reference stays fixed.
let first=bodyPoint([1,0],{x:0,y:1,theta:0},[0,1]);
let second=bodyPoint([1,0],{x:0,y:.8,theta:0},[0,.8]);
near(first[0],second[0]);near(first[1],second[1]);
camera={x:0,y:0,scale:2}; canvas.clientWidth=100;canvas.clientHeight=100;
let pixel=screen([1,2]);near(pixel[0],52);near(pixel[1],46);
let terrain=[[-2,3],[0,1],[4,5]];near(terrainHeight(terrain,-3),3);near(terrainHeight(terrain,-1),2);near(terrainHeight(terrain,0),1);near(terrainHeight(terrain,2),3);near(terrainHeight(terrain,5),5);
for(const g of [-.2,.2]){assert.equal(Math.sign(thrustDirection(0,g)[0]),-Math.sign(g));assert.equal(Math.sign(nozzleDirection(0,g)[0]),Math.sign(g));}
// A positive gimbal tips the thrust left and the physical nozzle right of the downward body axis.
assert.ok(thrustDirection(0,.2)[0]<0);assert.ok(nozzleDirection(0,.2)[0]>0);
let packet={run_id:'r',sequence:0,time:0,state:{x:0,y:1,vx:0,vy:0,theta:0,omega:0,fuel:1,thrust:0,gimbal:0},centre:[0,0],command:{throttle:0,gimbal:0,action:null}};
assert.ok(validPacket(packet,'r'));assert.ok(!validPacket(packet,'other'));
assert.ok(!validPacket({...packet,state:{...packet.state,x:NaN}},'r'));
let recording={schema:'rocket-run-v1',status:'paused',config:{schema:'rocket-run-v1',run_id:'r',physics_config:'test',units:'SI',initial_state:packet.state,actions:Array.from({length:10},()=>({throttle:0,gimbal:0})),parameters:{hull:[[0,0],[1,0],[0,1]],feet:[],terrain:[[0,0]],engine:[0,0],length:1,max_thrust:1,timestep:.02,control_interval:.2,event_tolerance:1e-9}},commands:[],snapshots:[packet,{...packet,sequence:1,time:1}]};
let a={...packet,diagnostics:{clearance:10}},b={...packet,sequence:1,time:1,state:{...packet.state,x:2,theta:.4},diagnostics:{clearance:10}};
let middle=snapshotAt([a,b],.5,recording.config.parameters);near(middle.state.x,1);near(middle.state.theta,.2);
let unsafe={...b,diagnostics:{clearance:0}};assert.equal(snapshotAt([a,unsafe],.5,recording.config.parameters),a);
let switched={...b,command:{throttle:1,gimbal:0,action:null}};assert.equal(snapshotAt([a,switched],.5,recording.config.parameters),a);
assert.ok(validate(recording));assert.throws(()=>validate({...recording,status:'contact',terminal:null}));assert.throws(()=>validate({...recording,config:{...recording.config,actions:[]}}));assert.throws(()=>validate({...recording,config:{...recording.config,parameters:{...recording.config.parameters,length:Infinity}}}));assert.throws(()=>validate({...recording,snapshots:[recording.snapshots[1],packet]}));
`);
console.log('Rendering geometry and packet checks passed');
