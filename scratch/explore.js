const fs=require('fs');
const rows=fs.readFileSync('data/alerts.csv','utf8').trim().split(/\r?\n/);
const h=rows[0].split(',');const A=rows.slice(1).map(r=>{const c=r.split(',');const o={};h.forEach((k,i)=>o[k]=c[i]);return o});
const cnt=(f)=>{const m={};A.forEach(a=>{const k=f(a);m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1])};
console.log('total',A.length);
console.log('type x sev',cnt(a=>a.alert_type+' '+a.vendor_severity));
console.log('units',cnt(a=>a.alert_type+' '+a.unit));
console.log('ids unique',new Set(A.map(a=>a.alert_id)).size);
const dupKey=a=>[a.vehicle_id,a.alert_type,a.event_time_utc,a.value].join('|');
const d=cnt(dupKey).filter(x=>x[1]>1);console.log('dup events',d.length,d.slice(0,5));
console.log('per day',cnt(a=>a.event_time_utc.slice(0,10)).sort());
// lag
const lag=A.map(a=>[(new Date(a.received_time_utc)-new Date(a.event_time_utc))/60000,a]);
lag.sort((x,y)=>y[0]-x[0]);console.log('max lags',lag.slice(0,15).map(([l,a])=>[l.toFixed(0),a.vehicle_id,a.alert_type,a.event_time_utc,a.received_time_utc]));
console.log('neg lag',lag.filter(x=>x[0]<0).length);
console.log('engine faults',A.filter(a=>a.alert_type==='engine_fault').map(a=>[a.vehicle_id,a.driver_id,a.dtc_code,a.vendor_severity,a.event_time_utc,a.received_time_utc].join(' ')).join('\n'));
