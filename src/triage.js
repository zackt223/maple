// Maple Freight alert triage: CSV export -> deduplicated, reclassified alerts -> actionable cases.
// Every rule is here so it can be read, tested and changed in one place.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Export taken Monday Sep 21 2026, 6:00 p.m. Eastern (EDT = UTC-4).
// Hamilton's gateway reconnected at 6:47 p.m. ET and delivered held alerts (hamilton_backfill.csv), so data is as of then.
const NOW_UTC = new Date('2026-09-21T22:47:00Z');
const EDT_OFFSET_H = -4;

const RULES = {
  speedingHighKmh: 115,      // > 115 km/h is high; <= 115 is medium (team rule)
  brakingHighG: 0.6,         // >= 0.6 g is emergency-level braking (0.4-0.5 g is ordinary "harsh")
  brakingMediumG: 0.45,      // below this on firmware 4.2.1 is mostly sensor sensitivity noise
  otaWindowHourLocal: 23,    // vendor OTA window 23:00-00:00 local: unplug/camera alerts expected
  dailyCapacity: 10,         // ops can act on ~10 things a day
  speedingOverLimitHigh: 40, // 40+ km/h over a known posted limit is extreme even below 115 (e.g. 104 in a 60)
  lateMinutes: 60,           // received > 60 min after the event = held by a communication/network failure
};

function parseCsv(file) {
  const lines = fs.readFileSync(path.join(DATA_DIR, file), 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

// work_orders.csv has quoted-free commas only inside notes we don't split on; re-join trailing cells.
function parseWorkOrders() {
  const lines = fs.readFileSync(path.join(DATA_DIR, 'work_orders.csv'), 'utf8').trim().split(/\r?\n/);
  return lines.slice(1).map((line) => {
    const c = line.split(',');
    return {
      wo_id: c[0], vehicle_id: c[1], opened_local: c[2], closed_local: c[3], status: c[4],
      work_done: c[5], technician_note: c.slice(6).join(','),
    };
  });
}

function parseDtc() {
  const lines = fs.readFileSync(path.join(DATA_DIR, 'dtc_reference.csv'), 'utf8').trim().split(/\r?\n/);
  const out = {};
  for (const line of lines.slice(1)) {
    const m = line.match(/^([^,]+),([^,]+),"?(.*?)"?$/);
    const urgency = m[3].split(' - ')[0].trim(); // Critical | High | Medium | Low
    out[m[1]] = { code: m[1], meaning: m[2], reference: m[3], urgency };
  }
  return out;
}

const toLocal = (iso) => new Date(new Date(iso).getTime() + EDT_OFFSET_H * 3600e3);
const localStr = (iso) => toLocal(iso).toISOString().slice(0, 16).replace('T', ' ');
// Work-order times are Eastern; convert to a UTC Date for comparison.
const woTimeUtc = (s) => (s ? new Date(s.replace(' ', 'T') + ':00Z').getTime() - EDT_OFFSET_H * 3600e3 : null);
const hoursAgo = (iso) => (NOW_UTC - new Date(iso)) / 3600e3;

function loadAll() {
  const vehicles = parseCsv('vehicles.csv');
  const vehicleById = Object.fromEntries(vehicles.map((v) => [v.vehicle_id, v]));
  const dtc = parseDtc();
  const workOrders = parseWorkOrders().map((w) => ({
    ...w,
    openedUtc: woTimeUtc(w.opened_local),
    closedUtc: woTimeUtc(w.closed_local),
    codes: (w.technician_note + ' ' + w.work_done).match(/P0\d{3}/g) || [],
    isDevice: /telematics|harness|obd/i.test(w.work_done + w.technician_note),
    isService: /service|oil and filters/i.test(w.work_done),
  }));
  const backfill = fs.existsSync(path.join(DATA_DIR, 'hamilton_backfill.csv')) ? parseCsv('hamilton_backfill.csv').map((a) => ({ ...a, backfill: true })) : [];
  const raw = [...parseCsv('alerts.csv'), ...backfill];
  return { vehicles, vehicleById, dtc, workOrders, raw };
}

// ---- Step 1: data quality ---------------------------------------------------
function dedupe(raw) {
  const seen = new Map();
  const kept = [];
  const dupes = [];
  for (const a of raw) {
    const key = [a.vehicle_id, a.alert_type, a.event_time_utc, a.value, a.dtc_code].join('|');
    if (seen.has(key)) { dupes.push({ ...a, duplicate_of: seen.get(key) }); continue; }
    seen.set(key, a.alert_id);
    kept.push(a);
  }
  return { kept, dupes };
}

// ---- Step 2: classify each alert ------------------------------------------
// Returns { priority: critical|high|medium|low|suppressed, reason, team }
function classify(a, ctx) {
  const v = +a.value;
  const hourLocal = toLocal(a.event_time_utc).getUTCHours();
  switch (a.alert_type) {
    case 'engine_fault': {
      const ref = ctx.dtc[a.dtc_code];
      const urgency = ref ? ref.urgency : 'High';
      const reading = a.value ? ` (${a.value} ${a.unit})` : '';
      if (urgency === 'Critical') return { priority: 'critical', team: 'maintenance', reason: `${a.dtc_code} ${ref.meaning}${reading} — reference says stop vehicle` };
      return { priority: 'high', team: 'maintenance', reason: `${a.dtc_code} ${ref ? ref.meaning : 'unknown code'} (reference: ${urgency})` };
    }
    case 'maintenance_due':
      if (v > 0) return { priority: 'high', team: 'maintenance', reason: `Service overdue by ${v} km` };
      return { priority: 'suppressed', team: 'maintenance', reason: `Not yet due (${v} km) — vendor: negative = not due` };
    case 'device_unplugged':
      if (hourLocal === ctx.rules.otaWindowHourLocal) return { priority: 'suppressed', team: 'operations', reason: 'During nightly OTA window (23:00–00:00) — expected' };
      return { priority: 'high', team: 'operations', reason: `Device unplugged at ${localStr(a.event_time_utc).slice(11)} — outside OTA window, possible tampering or loose harness` };
    case 'camera_offline':
      if (hourLocal === ctx.rules.otaWindowHourLocal) return { priority: 'suppressed', team: 'operations', reason: 'During nightly OTA window — expected' };
      return { priority: 'medium', team: 'operations', reason: 'Camera offline during operating hours' };
    case 'speeding':
      if (a.posted_limit_kmh && v - +a.posted_limit_kmh >= ctx.rules.speedingOverLimitHigh) return { priority: 'high', team: 'safety', reason: `${v} km/h in a ${a.posted_limit_kmh} zone — ${v - +a.posted_limit_kmh} km/h over the limit` };
      if (v > ctx.rules.speedingHighKmh) return { priority: 'high', team: 'safety', reason: `${v} km/h — above ${ctx.rules.speedingHighKmh} km/h` + (a.posted_limit_kmh ? ` (posted ${a.posted_limit_kmh})` : ' (posted limit unknown)') };
      return { priority: 'medium', team: 'safety', reason: `${v} km/h` + (a.posted_limit_kmh ? ` in a ${a.posted_limit_kmh} zone` : ' (posted limit unknown)') };
    case 'harsh_braking':
      if (v >= ctx.rules.brakingHighG) return { priority: 'high', team: 'safety', reason: `${v} g braking — emergency-stop level (≥ ${ctx.rules.brakingHighG} g)` };
      if (v >= ctx.rules.brakingMediumG) return { priority: 'medium', team: 'safety', reason: `${v} g braking` };
      return { priority: 'low', team: 'safety', reason: `${v} g braking — normal-range harsh event` };
    case 'harsh_accel':
    case 'harsh_cornering':
      return { priority: v >= 0.5 ? 'medium' : 'low', team: 'safety', reason: `${v} g ${a.alert_type.replace('harsh_', '')}` };
    case 'idling':
      return { priority: v >= 60 ? 'medium' : 'low', team: 'operations', reason: `Idled ${v} min` };
    default:
      return { priority: 'low', team: 'operations', reason: a.alert_type };
  }
}

// ---- Step 3: reconcile with work orders ------------------------------------
function matchWorkOrder(a, cls, workOrders) {
  const t = new Date(a.event_time_utc).getTime();
  const wos = workOrders.filter((w) => w.vehicle_id === a.vehicle_id);
  for (const w of wos) {
    const covers =
      (a.alert_type === 'engine_fault' && w.codes.includes(a.dtc_code)) ||
      (a.alert_type === 'device_unplugged' && w.isDevice) ||
      (a.alert_type === 'maintenance_due' && w.isService);
    if (!covers) continue;
    if (w.status === 'Closed' && t <= w.closedUtc) return { wo: w.wo_id, state: 'resolved', note: `Fixed by ${w.wo_id} (${w.work_done})` };
    if (w.status === 'Closed' && t > w.closedUtc) return { wo: w.wo_id, state: 'recurred', note: `Recurred after ${w.wo_id} closed ${w.closed_local}` };
    if (w.status !== 'Closed') return { wo: w.wo_id, state: 'open', note: `${w.wo_id} ${w.status}: ${w.technician_note}` };
  }
  // Engine fault on a vehicle repaired in the last 7 days for a different code — flag it.
  if (a.alert_type === 'engine_fault') {
    const recent = wos.find((w) => w.status === 'Closed' && w.codes.length && t > w.closedUtc && t - w.closedUtc < 7 * 864e5);
    if (recent) return { wo: recent.wo_id, state: 'after_repair', note: `New fault ${a.dtc_code} after ${recent.wo_id} (${recent.work_done}) closed ${recent.closed_local}` };
  }
  // Open work order that pulls the vehicle from service (any alert type).
  const open = wos.find((w) => w.status === 'Open' && /misfire/i.test(w.work_done) && a.alert_type === 'engine_fault');
  if (open) return { wo: open.wo_id, state: 'open', note: `${open.wo_id} Open: ${open.technician_note}` };
  return null;
}

// ---- Step 4: group high/critical alerts into cases --------------------------
function caseKey(a) {
  switch (a.alert_type) {
    case 'engine_fault': return `${a.vehicle_id}|engine`;
    case 'maintenance_due': return `${a.vehicle_id}|maintenance`;
    case 'device_unplugged': return `${a.vehicle_id}|device`;
    case 'speeding': return `${a.driver_id}|speeding`;
    case 'harsh_braking': return `${a.driver_id}|braking`;
    default: return `${a.vehicle_id}|${a.alert_type}`;
  }
}

const ACTIONS = {
  engine_critical: (c) => [
    `Maintenance: pull ${c.vehicle} from tomorrow's 6:00 a.m. dispatch and tag out.`,
    'Maintenance: inspect cooling and oil systems before the vehicle moves again; do not just clear codes.',
    `Operations: assign a spare unit for ${c.driver}'s route.`,
  ],
  engine_high: (c) => [
    `Maintenance: inspect ${c.vehicle} within 24 h (open a work order if none exists).`,
    'Operations: keep on short local routes until inspected.',
  ],
  engine_low: (c) => [`Maintenance: schedule repair for ${c.vehicle} at next service; no dispatch change.`],
  maintenance: (c) => [
    `Maintenance: book ${c.vehicle} into the next open bay; overdue service is a compliance and breakdown risk.`,
    'Operations: plan cover for the service day.',
  ],
  device: (c) => [
    `Operations: physically check the telematics harness on ${c.vehicle} at the depot before dispatch.`,
    `Safety: talk to ${c.driver} — unplugs during driving hours remove ELD/safety coverage.`,
  ],
  speeding: (c) => [
    `Safety: coach ${c.driver} on speeds above 115 km/h (review the listed events).`,
    'Safety: repeat within 7 days → formal warning.',
  ],
  braking: (c) => [
    `Safety: review camera footage for ${c.driver}'s emergency-level braking events.`,
    'Safety: coach on following distance; check for near-miss or collision.',
  ],
};

// Facts from vehicles.csv, vendor_notes.md and the latency check that change how a case should be read.
function contextNotes(c, v, ctx) {
  const notes = [];
  if (c.depot === 'Hamilton Depot') notes.push('Hamilton Depot alerts are arriving up to 30 h late. There may be newer events not shown yet.');
  if (['braking', 'speeding'].includes(c.kind) && v?.device_firmware === '4.2.1') notes.push('Firmware 4.2.1 over-reports light braking, but these events are serious-level, so they are real.');
  if (c.kind === 'braking' && v?.device_firmware !== '4.2.1') notes.push(`Firmware ${v?.device_firmware} is the less sensitive version, so these counts are not inflated.`);
  if (c.kind === 'speeding' && c.evidence.some((e) => /posted limit unknown/.test(e.reason))) notes.push('Some events have no posted limit from the map provider, so absolute speed is used.');
  if (v?.vehicle_class === 'Class 8 tractor' && c.kind === 'engine') notes.push('Class 8 tractor: a roadside failure blocks a full load. Inspect before dispatch.');
  return notes;
}

// Communication / network failures: alerts that reached the platform long after they happened, per depot.
function networkCases(alerts, ctx) {
  const out = [];
  const late = alerts.filter((a) => a.lagMin > ctx.rules.lateMinutes);
  for (const depot of ['North Yard', 'Airport Hub', 'Hamilton Depot']) {
    const list = late.filter((a) => a.depot === depot).sort((x, y) => y.received_time_utc.localeCompare(x.received_time_utc));
    if (!list.length) continue;
    const held = list.filter((a) => a.backfill);
    const heldBad = held.filter((a) => ['critical', 'high'].includes(a.priority));
    const maxLag = Math.max(...list.map((a) => a.lagMin)) / 60;
    const latest = list[0];
    const isOutage = held.length > 0;
    const title = isOutage
      ? `${depot} gateway outage: ${held.length} alerts held until ${localStr(latest.received_time_utc).slice(11)} ET`
      : `${depot} delayed data: ${list.length} alerts arrived over 1 h late (max ${maxLag.toFixed(1)} h)`;
    const c = {
      id: 'C-NET-' + depot.replace(/ /g, '-'), kind: 'network', title,
      score: (isOutage ? 1100 : 400) + list.length + (heldBad.length * 50),
      priority: isOutage && heldBad.some((a) => a.priority === 'critical') ? 'critical' : 'high',
      team: 'operations', vehicle: `${new Set(list.map((a) => a.vehicle_id)).size} vehicles`, driver: '—', depot,
      latestLocal: localStr(latest.received_time_utc), hoursAgo: Math.max(0, Math.round(hoursAgo(latest.received_time_utc))),
      count: list.length, recurred: false, workOrder: null, network: true,
      evidence: (held.length ? held : list).slice(0, 10).map((a) => ({ id: a.alert_id, when: localStr(a.event_time_utc), reason: `${a.vehicle_id} ${a.alert_type.replace(/_/g, ' ')}: ${a.reason} — arrived ${(a.lagMin / 60).toFixed(1)} h late`, vendor: a.vendor_severity })),
      actions: isOutage ? [
        `Operations: review the ${held.length} alerts that arrived after the gateway came back (${heldBad.length} are high or critical); they are now ranked in the normal queue.`,
        `Operations: treat ${depot} as possibly incomplete. Check vehicles in person before the 6:00 a.m. dispatch.`,
        'IT: open a ticket with TrackLine about the depot gateway (the vendor reports normal connectivity).',
      ] : [
        `Operations: ${depot} data can lag up to ${maxLag.toFixed(0)} h. Confirm critical issues by phone or in person.`,
        'IT: raise the delay pattern with TrackLine.',
      ],
      context: [`${list.length} delayed alerts at ${depot} in 14 days; worst delay ${maxLag.toFixed(1)} h.`],
    };
    out.push(c);
  }
  return out;
}

function buildCases(alerts, ctx) {
  const groups = new Map();
  for (const a of alerts) {
    if (!['critical', 'high'].includes(a.priority)) continue;
    if (a.wo && a.wo.state === 'resolved') continue; // already fixed by the shop
    const k = caseKey(a);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const cases = [];
  for (const [key, list] of groups) {
    list.sort((x, y) => y.event_time_utc.localeCompare(x.event_time_utc));
    const [, kind] = key.split('|');
    const latest = list[0];
    const v = ctx.vehicleById[latest.vehicle_id];
    const isCritical = list.some((a) => a.priority === 'critical');
    const recurred = list.some((a) => a.wo && ['recurred', 'after_repair'].includes(a.wo.state));
    const openWo = list.find((a) => a.wo && a.wo.state === 'open');
    const hrs = hoursAgo(latest.event_time_utc);

    let score = isCritical ? 1000 : 500;
    if (hrs <= 24) score += 150; else if (hrs <= 72) score += 75; else if (hrs > 168) score -= 100;
    if (recurred) score += 300;
    let actionKey = kind;
    let title = '';
    if (kind === 'engine') {
      const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
      const codes = [...new Set(list.map((a) => a.dtc_code))].sort((x, y) => (order[ctx.dtc[x]?.urgency] ?? 1) - (order[ctx.dtc[y]?.urgency] ?? 1));
      const worst = list.map((a) => ctx.dtc[a.dtc_code]?.urgency || 'High');
      const tier = worst.includes('Critical') ? 'critical' : worst.includes('High') ? 'high' : 'low';
      actionKey = `engine_${tier}`;
      if (tier === 'high') score += 200;
      if (tier === 'high' && !openWo) score += 150; // "inspect within 24 h" and nobody has opened a work order
      if (tier === 'low') score -= 350; // emissions/thermostat codes: real but not urgent
      title = `Engine fault ${codes.join(', ')} on ${latest.vehicle_id}`;
    } else if (kind === 'maintenance') {
      const km = +latest.value;
      score += Math.min(km / 5, 500);
      title = `${latest.vehicle_id} service overdue ${km} km`;
    } else if (kind === 'device') {
      score += list.length * 40;
      title = `${latest.vehicle_id} telematics unplugged ${list.length}× during driving hours`;
    } else if (kind === 'speeding') {
      const max = Math.max(...list.map((a) => +a.value));
      score += (max - 115) * 5 + list.length * 25;
      title = `${latest.driver_id} speeding over 115 km/h ×${list.length} (max ${max})`;
    } else if (kind === 'braking') {
      const max = Math.max(...list.map((a) => +a.value));
      score += (max - 0.6) * 400 + list.length * 25;
      title = `${latest.driver_id} emergency braking ×${list.length} (max ${max} g)`;
    }
    const lateCount = list.filter((a) => a.lagMin > ctx.rules.lateMinutes).length;
    if (list.some((a) => a.backfill)) score += 250; // held by the outage: nobody has seen these yet
    const c = {
      lateArrivals: lateCount, backfill: list.some((a) => a.backfill),
      id: 'C-' + key.replace('|', '-'),
      kind, title, score: Math.round(score),
      priority: isCritical || recurred ? 'critical' : 'high',
      team: latest.team,
      vehicle: latest.vehicle_id, driver: latest.driver_id, depot: v?.depot,
      latestLocal: localStr(latest.event_time_utc),
      hoursAgo: Math.round(hrs),
      count: list.length,
      recurred, workOrder: openWo ? openWo.wo : (recurred ? list.find((a) => a.wo)?.wo : null),
      evidence: list.slice(0, 8).map((a) => ({ id: a.alert_id, when: localStr(a.event_time_utc), reason: a.reason + (a.lagMin > ctx.rules.lateMinutes ? ` (arrived ${(a.lagMin / 60).toFixed(1)} h late${a.backfill ? ', after Hamilton gateway restored 6:47 p.m.' : ''})` : ''), vendor: a.vendor_severity, wo: a.wo?.note })),
    };
    c.actions = ACTIONS[actionKey](c);
    c.vehicleClass = v?.vehicle_class;
    c.context = contextNotes(c, v, ctx);
    cases.push(c);
  }
  // Engine cases also show faults the shop already "fixed" on that vehicle — the history matters (V-137).
  for (const c of cases) {
    if (c.kind !== 'engine') continue;
    c.history = alerts.filter((a) => a.vehicle_id === c.vehicle && a.alert_type === 'engine_fault' && a.wo?.state === 'resolved')
      .map((a) => ({ id: a.alert_id, when: localStr(a.event_time_utc), reason: a.reason, vendor: a.vendor_severity, wo: a.wo.note }));
  }
  cases.push(...networkCases(alerts, ctx));
  cases.sort((a, b) => b.score - a.score);
  cases.forEach((c, i) => { c.rank = i + 1; c.tonight = i < ctx.rules.dailyCapacity; });
  return cases;
}

// ---- Driver view: rate per 100 km, firmware-aware --------------------------
function driverStats(alerts, ctx) {
  const by = {};
  for (const v of ctx.vehicles) by[v.assigned_driver] = { driver: v.assigned_driver, vehicle: v.vehicle_id, firmware: v.device_firmware, km: +v.km_driven_14d, rawEvents: 0, serious: 0 };
  for (const a of alerts) {
    if (!['harsh_braking', 'harsh_accel', 'harsh_cornering', 'speeding'].includes(a.alert_type)) continue;
    const d = by[a.driver_id]; if (!d) continue;
    d.rawEvents++;
    if (a.priority === 'high') d.serious++;
  }
  const list = Object.values(by).map((d) => ({ ...d, rawPer100: +(d.rawEvents / d.km * 100).toFixed(2), seriousPer100: +(d.serious / d.km * 100).toFixed(2) }));
  const rawRank = [...list].sort((a, b) => b.rawEvents - a.rawEvents).map((d) => d.driver);
  const seriousRank = [...list].sort((a, b) => b.seriousPer100 - a.seriousPer100).map((d) => d.driver);
  list.forEach((d) => { d.rawRank = rawRank.indexOf(d.driver) + 1; d.seriousRank = seriousRank.indexOf(d.driver) + 1; });
  return list.sort((a, b) => a.seriousRank - b.seriousRank);
}

function dataQuality(raw, dupes, alerts, ctx) {
  const lateByDepot = {};
  for (const a of alerts) {
    const lagMin = (new Date(a.received_time_utc) - new Date(a.event_time_utc)) / 60000;
    const d = ctx.vehicleById[a.vehicle_id].depot;
    lateByDepot[d] ??= { total: 0, lateOver1h: 0, maxLagH: 0 };
    lateByDepot[d].total++;
    if (lagMin > 60) lateByDepot[d].lateOver1h++;
    lateByDepot[d].maxLagH = Math.max(lateByDepot[d].maxLagH, +(lagMin / 60).toFixed(1));
  }
  const fw = {};
  for (const v of ctx.vehicles) { fw[v.device_firmware] ??= { km: 0, braking: 0, vehicles: 0 }; fw[v.device_firmware].km += +v.km_driven_14d; fw[v.device_firmware].vehicles++; }
  for (const a of alerts) if (a.alert_type === 'harsh_braking') fw[ctx.vehicleById[a.vehicle_id].device_firmware].braking++;
  for (const k in fw) fw[k].brakingPer100km = +(fw[k].braking / fw[k].km * 100).toFixed(2);
  const lowCodesMarkedHigh = alerts.filter((a) => a.alert_type === 'engine_fault' && ctx.dtc[a.dtc_code]?.urgency === 'Low' && a.vendor_severity === 'HIGH').length;
  const vendorMismatch = alerts.filter((a) => a.alert_type === 'engine_fault' && ctx.dtc[a.dtc_code]?.urgency === 'Critical' && a.vendor_severity !== 'HIGH').length;
  return {
    rawAlerts: raw.length, duplicates: dupes.length, uniqueAlerts: alerts.length,
    suppressed: alerts.filter((a) => a.priority === 'suppressed').length,
    lateByDepot, firmware: fw, criticalCodesMarkedBelowHigh: vendorMismatch, lowCodesMarkedHigh,
    speedingVendorDisagrees: alerts.filter((a) => a.alert_type === 'speeding' && ((+a.value > 115) !== (a.vendor_severity === 'HIGH'))).length,
    speedingNoPostedLimit: alerts.filter((a) => a.alert_type === 'speeding' && !a.posted_limit_kmh).length,
  };
}

function run() {
  const ctx = loadAll();
  ctx.rules = RULES;
  const { kept, dupes } = dedupe(ctx.raw);
  const alerts = kept.map((a) => {
    const cls = classify(a, ctx);
    const out = { ...a, ...cls, depot: ctx.vehicleById[a.vehicle_id]?.depot, local: localStr(a.event_time_utc) };
    out.wo = matchWorkOrder(a, cls, ctx.workOrders);
    out.lagMin = (new Date(a.received_time_utc) - new Date(a.event_time_utc)) / 60000;
    return out;
  });
  const cases = buildCases(alerts, ctx);
  const counts = {};
  for (const a of alerts) counts[a.priority] = (counts[a.priority] || 0) + 1;
  // Daily series (Eastern dates) for the charts.
  const days = {};
  for (const a of alerts) {
    const d = a.local.slice(0, 10);
    const o = days[d] ||= { day: d, total: 0, highCritical: 0, critical: 0, late: 0, byDepot: {}, byType: {} };
    o.total++;
    if (['high', 'critical'].includes(a.priority)) o.highCritical++;
    if (a.priority === 'critical') o.critical++;
    if (a.lagMin > RULES.lateMinutes) o.late++;
    o.byDepot[a.depot] = (o.byDepot[a.depot] || 0) + 1;
    o.byType[a.alert_type] = (o.byType[a.alert_type] || 0) + 1;
  }
  const series = Object.values(days).sort((x, y) => x.day.localeCompare(y.day));
  const allAlerts = alerts.map((a) => {
    const v = ctx.vehicleById[a.vehicle_id];
    return { id: a.alert_id, type: a.alert_type, priority: a.priority, vendor: a.vendor_severity, when: a.local, vehicle: a.vehicle_id, vehicleClass: v.vehicle_class, firmware: v.device_firmware,
      driver: a.driver_id, depot: a.depot, reason: a.reason, value: a.value, unit: a.unit, dtc: a.dtc_code, lateH: a.lagMin > RULES.lateMinutes ? +(a.lagMin / 60).toFixed(1) : 0, backfill: !!a.backfill, wo: a.wo?.note || '' };
  }).sort((x, y) => y.when.localeCompare(x.when));
  return {
    series, allAlerts,
    generatedFor: 'Mon Sep 21 2026, 6:47 p.m. ET (incl. Hamilton backfill)',
    rules: RULES,
    counts,
    cases,
    lowMedium: alerts.filter((a) => ['medium', 'low'].includes(a.priority) && !a.wo)
      .sort((a, b) => b.event_time_utc.localeCompare(a.event_time_utc))
      .map((a) => ({ late: a.lagMin > RULES.lateMinutes, backfill: !!a.backfill, vehicleClass: ctx.vehicleById[a.vehicle_id]?.vehicle_class, id: a.alert_id, type: a.alert_type, priority: a.priority, vehicle: a.vehicle_id, driver: a.driver_id, depot: a.depot, when: a.local, reason: a.reason, vendor: a.vendor_severity })),
    workOrders: ctx.workOrders.map(({ openedUtc, closedUtc, codes, isDevice, isService, ...w }) => w),
    vehicles: ctx.vehicles,
    depots: ['North Yard', 'Airport Hub', 'Hamilton Depot'],
    drivers: driverStats(alerts, ctx),
    quality: dataQuality(ctx.raw, dupes, alerts, ctx),
    _alerts: alerts,
  };
}

module.exports = { run, classify, dedupe, RULES, localStr };
