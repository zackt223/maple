// Independent re-validation of the raw files (does not use src/triage.js).
const fs = require('fs');
const load = (f) => { const L = fs.readFileSync('data/' + f, 'utf8').trim().split(/\r?\n/); const h = L[0].split(','); return L.slice(1).map((l) => { const c = l.split(','); return Object.fromEntries(h.map((k, i) => [k, c[i] ?? ''])); }); };
const A = load('alerts.csv'), B = load('hamilton_backfill.csv'), V = load('vehicles.csv');
const vm = Object.fromEntries(V.map((v) => [v.vehicle_id, v]));
const all = [...A, ...B.map((b) => ({ ...b, bf: 1 }))];
const out = {};
out.rows = { alerts: A.length, backfill: B.length, vehicles: V.length, drivers: new Set(V.map((v) => v.assigned_driver)).size };
out.alertIdCollisions = all.length - new Set(all.map((a) => a.alert_id)).size;
const key = (a) => [a.vehicle_id, a.alert_type, a.event_time_utc, a.value, a.dtc_code].join('|');
const ks = new Map(); let dup = 0, dupAcrossFiles = 0;
for (const a of all) { if (ks.has(key(a))) { dup++; if (ks.get(key(a)) !== !!a.bf) dupAcrossFiles++; } else ks.set(key(a), !!a.bf); }
out.duplicates = dup; out.dupBetweenExportAndBackfill = dupAcrossFiles;
out.unknownVehicles = [...new Set(all.filter((a) => !vm[a.vehicle_id]).map((a) => a.vehicle_id))];
out.driverMismatch = all.filter((a) => vm[a.vehicle_id] && vm[a.vehicle_id].assigned_driver !== a.driver_id).length;
out.backfillAllHamilton = B.every((b) => vm[b.vehicle_id].depot === 'Hamilton Depot');
out.backfillReceived = [...new Set(B.map((b) => b.received_time_utc.slice(0, 16)))];
out.backfillEventRangeUTC = [B.map((b) => b.event_time_utc).sort()[0], B.map((b) => b.event_time_utc).sort().pop()];
out.eventRange = [all.map((a) => a.event_time_utc).sort()[0], all.map((a) => a.event_time_utc).sort().pop()];
out.receivedBeforeEvent = all.filter((a) => a.received_time_utc < a.event_time_utc).length;
out.receivedAfterExport = all.filter((a) => a.received_time_utc > '2026-09-21T22:00:00Z').map((a) => a.alert_id + (a.bf ? ' (backfill)' : ''));
out.engineNoDtc = all.filter((a) => a.alert_type === 'engine_fault' && !a.dtc_code).length;
out.engineNoValue = all.filter((a) => a.alert_type === 'engine_fault' && !a.value).length;
out.unknownDtc = [...new Set(all.filter((a) => a.dtc_code && !['P0217','P0524','P0300','P0171','P0128','P0420'].includes(a.dtc_code)).map((a) => a.dtc_code))];
out.speedNoLimit = all.filter((a) => a.alert_type === 'speeding' && !a.posted_limit_kmh).length;
out.speedBelowLimit = all.filter((a) => a.alert_type === 'speeding' && a.posted_limit_kmh && +a.value <= +a.posted_limit_kmh).length;
out.maintNegative = all.filter((a) => a.alert_type === 'maintenance_due' && +a.value <= 0).length;
out.v102AfterUnitRemoved = all.filter((a) => a.vehicle_id === 'V-102' && a.event_time_utc > '2026-09-19T03:00:00Z').length;
out.v137AfterSensorFix = all.filter((a) => a.vehicle_id === 'V-137' && a.event_time_utc > '2026-09-21T11:40:00Z').map((a) => `${a.alert_type} ${a.dtc_code} ${a.value}${a.unit}`);
out.v108 = all.filter((a) => a.vehicle_id === 'V-108' && a.alert_type === 'engine_fault').map((a) => `${a.event_time_utc} ${a.dtc_code} ${a.value}${a.unit} ${a.vendor_severity}${a.bf ? ' backfill' : ''}`);
out.v158AfterWoOpened = all.filter((a) => a.vehicle_id === 'V-158' && a.event_time_utc > '2026-09-21T21:30:00Z').length;
out.lateByDepot = {}; for (const a of all) { const d = vm[a.vehicle_id].depot; const late = (new Date(a.received_time_utc) - new Date(a.event_time_utc)) > 3600e3; out.lateByDepot[d] = (out.lateByDepot[d] || 0) + (late ? 1 : 0); }
out.d17km = vm['V-142'].km_driven_14d; out.d17firmware = vm['V-142'].device_firmware;
out.vehicleDriverOneToOne = new Set(V.map((v) => v.assigned_driver)).size === V.length;
out.driverIdGap = V.filter((v) => v.assigned_driver === 'D-42' || v.assigned_driver === 'D-17').map((v) => v.vehicle_id + '→' + v.assigned_driver);
console.log(JSON.stringify(out, null, 1));
