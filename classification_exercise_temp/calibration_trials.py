import sys, math
from dataclasses import replace
import rocket_calibration as c
from rocket_physics import step, Command, forces
for name in c.SCENARIOS:
 for powered in (False,True):
  p,s=c.configuration(name); t=0.; max_force=0.; max_moment=0.
  while t < 30:
   # Illustrative fixed-time burn; this is not an expert controller.
   burn={'demo_descent':5.0,'centred_descent':4.0,'crosswind_diagnostics':4.0,'near_ground_contact':0.0}[name]
   cmd=Command(1 if powered and t>=burn else 0,0)
   thrust,drag,lift,torque,aero,damping=forces(t,s,p)
   max_force=max(max_force,math.hypot(drag[0]+lift[0],drag[1]+lift[1]));max_moment=max(max_moment,abs(aero))
   s,contact=step(t,s,cmd,p,.01); t=contact.time if contact else t+.01
   if contact: break
  print(name,'powered' if powered else 'off','time',round(t,3),'contact',bool(contact),'x',round(s.x,2),'y',round(s.y,2),'vy',round(s.vy,2),'tilt',round(math.degrees(s.theta),2),'aeroN',round(max_force),'momentNm',round(max_moment))
