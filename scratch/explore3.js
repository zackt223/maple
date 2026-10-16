const fs=require('fs');
const load=f=>{const rows=fs.readFileSync(f,'utf8').trim().split(/\r?\n/);const h=rows[0].split(',');return rows.slice(1).map(r=>{const c=r.split(',');const o={};h.forEach((k,i)=>o[k]=c[i]);return o})};
let A=load('data/alerts.csv');const V=load('data/vehicles.csv');const vm=Object.fromEntries(V.map(v=>[v.vehicle_id,v]));
const seen=new Set();A=A.filter(a=>{const k=[a.vehicle_id,a.alert_type,a.event_time_utc,a.value,a.dtc_code].join('|');if(seen.has(k))return false;seen.add(k);return true});
const loc=t=>new Date(new Date(t).getTime()-4*3600e3).toISOString().slice(0,16).replace('T',' ');
for(const t of ['device_unplugged','camera_offline']){const x=A.filter(a=>a.alert_type===t);const hr={};x.forEach(a=>{const h=loc(a.event_time_utc).slice(11,13);hr[h]=(hr[h]||0)+1});console.log(t,x.length,hr);
 const out=x.filter(a=>loc(a.event_time_utc).slice(11,13)!=='23');const bv={};out.forEach(a=>{bv[a.vehicle_id]=(bv[a.vehicle_id]||[]);bv[a.vehicle_id].push(loc(a.event_time_utc))});console.log('outside window by vehicle',bv);
 const dep={};x.forEach(a=>{const d=vm[a.vehicle_id].depot;dep[d]=(dep[d]||0)+1});console.log('by depot',dep);}
const md=A.filter(a=>a.alert_type==='maintenance_due');const last={};md.forEach(a=>{if(!last[a.vehicle_id]||a.event_time_utc>last[a.vehicle_id].event_time_utc)last[a.vehicle_id]=a});
console.log('maint latest',Object.values(last).map(a=>[a.vehicle_id,a.value,a.vendor_severity,loc(a.event_time_utc)].join(' ')));
console.log('maint times',[...new Set(md.map(a=>loc(a.event_time_utc).slice(11)))]);
const idl=A.filter(a=>a.alert_type==='idling').map(a=>+a.value).sort((a,b)=>a-b);console.log('idle min/med/max',idl[0],idl[idl.length>>1],idl.at(-1));
// lag by depot
const lag={};A.forEach(a=>{const l=(new Date(a.received_time_utc)-new Date(a.event_time_utc))/60000;const d=vm[a.vehicle_id].depot;lag[d]=lag[d]||{n:0,late:0};lag[d].n++;if(l>60)lag[d].late++});console.log('late>60min by depot',lag);
// today's (Sep 21 local) alerts count
console.log('sep21 local',A.filter(a=>loc(a.event_time_utc).startsWith('2026-09-21')).length);
