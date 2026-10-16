const fs=require('fs');
const load=f=>{const rows=fs.readFileSync(f,'utf8').trim().split(/\r?\n/);const h=rows[0].split(',');return rows.slice(1).map(r=>{const c=r.split(',');const o={};h.forEach((k,i)=>o[k]=c[i]);return o})};
let A=load('data/alerts.csv');const V=load('data/vehicles.csv');const vm=Object.fromEntries(V.map(v=>[v.vehicle_id,v]));
const seen=new Set();A=A.filter(a=>{const k=[a.vehicle_id,a.alert_type,a.event_time_utc,a.value,a.dtc_code].join('|');if(seen.has(k))return false;seen.add(k);return true});
console.log('dedup',A.length);
const loc=t=>new Date(new Date(t).getTime()-4*3600e3).toISOString().slice(0,16).replace('T',' ');
console.log('max event',A.map(a=>a.event_time_utc).sort().pop());
console.log('V-137 all eng/after 9/20:',A.filter(a=>a.vehicle_id==='V-137'&&(a.alert_type==='engine_fault'||a.event_time_utc>'2026-09-21')).map(a=>[a.alert_type,a.dtc_code,a.value,a.unit,loc(a.event_time_utc)].join(' ')));
console.log('V-102 after 9/19 03Z:',A.filter(a=>a.vehicle_id==='V-102'&&a.event_time_utc>'2026-09-19T03:00').map(a=>[a.alert_type,a.vendor_severity,a.value,loc(a.event_time_utc)].join(' ')));
console.log('V-158/V-151 recent:',A.filter(a=>['V-158','V-151'].includes(a.vehicle_id)&&(a.alert_type==='engine_fault'||a.alert_type==='maintenance_due')).map(a=>[a.vehicle_id,a.alert_type,a.dtc_code,a.value,loc(a.event_time_utc)].join(' ')));
// speeding
const sp=A.filter(a=>a.alert_type==='speeding');
const nolim=sp.filter(a=>!a.posted_limit_kmh);console.log('speeding',sp.length,'no limit',nolim.length);
const vals=sp.map(a=>+a.value).sort((a,b)=>a-b);console.log('speed min/med/max',vals[0],vals[vals.length>>1],vals.at(-1));
const b={};sp.forEach(a=>{const k=(+a.value>115?'>115':'<=115')+' '+a.vendor_severity;b[k]=(b[k]||0)+1});console.log(b);
console.log('limits',[...new Set(sp.map(a=>a.posted_limit_kmh))]);
console.log('top speeds',sp.sort((x,y)=>y.value-x.value).slice(0,12).map(a=>[a.vehicle_id,a.driver_id,a.value,a.posted_limit_kmh,a.vendor_severity,loc(a.event_time_utc)].join(' ')));
// speeding low/odd: over limit by small? value < limit?
console.log('value<=limit',sp.filter(a=>a.posted_limit_kmh&&+a.value<=+a.posted_limit_kmh).length);
// harsh braking dist by firmware
const hb=A.filter(a=>a.alert_type==='harsh_braking');const hist={};hb.forEach(a=>{const k=vm[a.vehicle_id].device_firmware+' '+(Math.floor(a.value*10)/10).toFixed(1);hist[k]=(hist[k]||0)+1});console.log(Object.entries(hist).sort());
console.log('hb>=0.6',hb.filter(a=>+a.value>=0.6).map(a=>[a.vehicle_id,a.driver_id,a.value,a.vendor_severity,loc(a.event_time_utc)].join(' ')));
// per driver per 100km
const per={};A.forEach(a=>{if(!['harsh_braking','harsh_accel','harsh_cornering','speeding'].includes(a.alert_type))return;per[a.driver_id]=(per[a.driver_id]||0)+1});
const km=Object.fromEntries(V.map(v=>[v.assigned_driver,+v.km_driven_14d]));const fw=Object.fromEntries(V.map(v=>[v.assigned_driver,v.device_firmware]));
const rk=Object.entries(per).map(([d,n])=>[d,n,km[d],(n/km[d]*100).toFixed(2),fw[d]]).sort((x,y)=>y[1]-x[1]);console.log('raw top',rk.slice(0,6));console.log('rate top',rk.sort((x,y)=>y[3]-x[3]).slice(0,8));
// driver mismatch
console.log('driver mismatch',A.filter(a=>vm[a.vehicle_id]&&vm[a.vehicle_id].assigned_driver!==a.driver_id).length, [...new Set(A.filter(a=>vm[a.vehicle_id]&&vm[a.vehicle_id].assigned_driver!==a.driver_id).map(a=>a.vehicle_id+'/'+a.driver_id))]);
console.log('unknown vehicles',[...new Set(A.filter(a=>!vm[a.vehicle_id]).map(a=>a.vehicle_id))]);
// firmware rates of harsh braking
const fr={};V.forEach(v=>{fr[v.device_firmware]=fr[v.device_firmware]||{n:0,km:0};fr[v.device_firmware].km+=+v.km_driven_14d});hb.forEach(a=>fr[vm[a.vehicle_id].device_firmware].n++);console.log('hb per 100km by fw',Object.entries(fr).map(([f,o])=>[f,(o.n/o.km*100).toFixed(2)]));
