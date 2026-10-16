// Zero-dependency local server: serves the dashboard and enforces role permissions on every read and write.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { run, DATA_DIR } = require('./triage');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, '..', 'state.json');

// Demo users. A real deployment would use company SSO; roles are what matter here.
const USERS = {
  'ops.manager':    { name: 'Operations Manager', role: 'operations' },
  'safety.manager': { name: 'Safety Manager',     role: 'safety' },
  'maint.lead':     { name: 'Maintenance Lead',   role: 'maintenance' },
  'biz.admin':      { name: 'Business Manager',   role: 'admin' },
  'finance.lead':   { name: 'Sales & Finance',    role: 'finance' },
};

// What each role may do. Checked server-side; the UI only hides buttons for convenience.
const PERMISSIONS = {
  operations:  ['escalate', 'resolve', 'case_note', 'refer_safety', 'withdraw_wo'],
  safety:      ['escalate', 'resolve', 'case_note', 'referral_note', 'close_referral', 'advise_maintenance', 'set_min_firmware', 'request_firmware_update', 'withdraw_wo'],
  maintenance: ['approve_wo', 'set_eta', 'wo_note'],
  finance:     ['record_cost', 'review_cost', 'audit_note'],
  admin:       ['delete_wo', 'delete_referral'], // oversees everything; can only remove items raised in error
};

// The same rules as a human-readable view / edit / delete matrix (shown in the app and README).
const ACCESS = {
  operations:  { view: 'Ops cases (vehicle, device, network), low & medium ops alerts, all alerts, its own activity', edit: 'Send to maintenance, bring in Safety, notes, resolve', delete: 'Withdraw its own maintenance request while still pending approval' },
  safety:      { view: 'Driver cases, referrals from Ops, firmware policy, drivers, all alerts, its own activity', edit: 'Coach/act on drivers, reply to Ops, advise maintenance, set minimum firmware, request updates', delete: 'Withdraw its own maintenance request while still pending approval' },
  maintenance: { view: 'Work-order queue only (with the evidence Ops/Safety sent)', edit: 'Approve work orders, set estimated completion, add notes', delete: 'None' },
  finance:     { view: 'Every work order with costs, cost totals by depot, all alerts, full audit log', edit: 'Record work-order costs (parts, labour, invoice #), verify or flag a cost, add audit notes', delete: 'None. Costs are corrected by re-recording, and every change is kept in the audit log' },
  admin:       { view: 'Every team dashboard, every metric, costs, all alerts, full audit log', edit: 'None (oversight only)', delete: 'Remove a work order or referral raised in error while pending' },
};

// Vendor notes on each firmware release (vendor_notes.md) plus what the data showed.
const FIRMWARE_NOTES = {
  '4.1.8': 'Legacy. Still supported, but no longer current.',
  '4.2.1': 'Aug 2026. "Improved harsh-event sensitivity": in this data it logs about 5× more light (0.40–0.45 g) braking per 100 km.',
  '4.3.0': 'Current release. Stability fixes. Normal harsh-braking rate.',
};

// Rebuilt whenever a file in data/ changes, so late deliveries (like the Hamilton backfill) show up without a restart.
let triage = run();
let dataVersion = 1;
let reloadTimer = null;
function reloadData() {
  try { triage = run(); dataVersion++; console.log(`Data reloaded (version ${dataVersion})`); }
  catch (e) { console.error('Data reload failed, keeping the previous data:', e.message); }
}
const emptyState = () => ({ cases: {}, workOrders: {}, referrals: {}, costs: {}, policy: { minFirmware: null }, log: [] });
let state = fs.existsSync(STATE_FILE) ? { ...emptyState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } : emptyState();
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// What each role is allowed to SEE. Other roles' dashboards are never sent to the browser.
// Operations owns vehicle availability; Safety owns driver behaviour (plus cases Ops refers to it);
// Maintenance only sees its work-order queue.
const CASE_TEAMS = { operations: ['operations', 'maintenance'], safety: ['safety'], maintenance: [], admin: [], finance: [] };
const ALERT_TEAMS = { operations: ['operations'], safety: ['safety'], maintenance: [], admin: [], finance: [] };
const SEES_ALL_ALERTS = ['operations', 'safety', 'finance', 'admin'];
const depotOfMap = () => Object.fromEntries(triage.vehicles.map((v) => [v.vehicle_id, v.depot]));
const referralFor = (caseId) => Object.entries(state.referrals).find(([, r]) => r.caseId === caseId);
const canSeeCase = (role, c) => CASE_TEAMS[role].includes(c.team) || (role === 'safety' && !!referralFor(c.id));
const teamOf = (type) => (['speeding', 'harsh_braking', 'harsh_accel', 'harsh_cornering'].includes(type) ? 'safety' : 'operations');

const verNum = (v) => v.split('.').reduce((n, p) => n * 1000 + +p, 0);
// Next free id after the highest ever issued, so a deleted id is never reused (counting keys would overwrite).
const nextId = (prefix, obj) => {
  state.seq ||= {};
  const used = Object.keys(obj).filter((k) => k.startsWith(prefix)).map((k) => +k.slice(prefix.length));
  state.seq[prefix] = Math.max(state.seq[prefix] || 0, ...used) + 1;
  return prefix + String(state.seq[prefix]).padStart(3, '0');
};

function caseSummary(c) {
  return { title: c.title, priority: c.priority, vehicle: c.vehicle, driver: c.driver, depot: c.depot, actions: c.actions, evidence: c.evidence.slice(0, 5), history: c.history || [], context: c.context || [] };
}

function newWorkOrder(user, at, fields) {
  const woId = nextId('WO-D', state.workOrders);
  state.workOrders[woId] = { source: 'dashboard', status: 'Pending approval', technician_note: '', opened_local: at, eta: null, notes: [], requestedBy: user.name, requestedRole: user.role, ...fields };
  return woId;
}

function allWorkOrders() {
  const dashboardWos = Object.entries(state.workOrders).filter(([, w]) => w.source === 'dashboard').map(([id, w]) => {
    // Maintenance gets what it needs to do the job: the reported steps, evidence and repair history.
    const c = w.caseId && triage.cases.find((x) => x.id === w.caseId);
    const request = c ? { ...caseSummary(c), notes: state.cases[c.id]?.notes || [] } : w.request || null;
    return { wo_id: id, ...w, request };
  });
  const csvWos = triage.workOrders.map((w) => ({ ...w, source: 'shop', ...(state.workOrders[w.wo_id] || {}) }));
  for (const w of [...dashboardWos, ...csvWos]) w.depot = depotOfMap()[w.vehicle_id] || w.depotName || null;
  const order = { 'Pending approval': 0, Approved: 1, Open: 2, Scheduled: 3, Closed: 4 };
  return [...dashboardWos, ...csvWos].sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
}

const woView = (id) => {
  const wo = id && state.workOrders[id];
  return wo ? { id, status: wo.status, eta: wo.eta, notes: wo.notes } : null;
};

function scopedCases(role) {
  const capacity = triage.rules.dailyCapacity;
  return triage.cases.filter((c) => CASE_TEAMS[role].includes(c.team)).map((c, i) => {
    const cs = state.cases[c.id];
    const ref = referralFor(c.id);
    return { ...c, rank: i + 1, tonight: i < capacity, state: cs || null, linkedWo: woView(cs?.workOrder),
      referral: ref ? { id: ref[0], status: ref[1].status, notes: ref[1].notes, workOrder: woView(ref[1].workOrder) } : null };
  });
}

function referrals() {
  return Object.entries(state.referrals).map(([id, r]) => {
    const c = triage.cases.find((x) => x.id === r.caseId);
    return { id, ...r, case: caseSummary(c), opsNotes: state.cases[c.id]?.notes || [], linkedWo: woView(r.workOrder) };
  }).sort((a, b) => (a.status === 'Open' ? 0 : 1) - (b.status === 'Open' ? 0 : 1) || b.at.localeCompare(a.at));
}

function firmware() {
  const min = state.policy.minFirmware;
  const versions = Object.entries(triage.quality.firmware).map(([v, s]) => ({ version: v, vehicles: s.vehicles, brakingPer100km: s.brakingPer100km, note: FIRMWARE_NOTES[v] }))
    .sort((a, b) => verNum(b.version) - verNum(a.version));
  const below = min ? triage.vehicles.filter((v) => verNum(v.device_firmware) < verNum(min)) : [];
  const requested = new Set(Object.values(state.workOrders).filter((w) => w.firmwareTarget === min).flatMap((w) => w.vehicles || []));
  return {
    policy: state.policy, versions, recommended: '4.3.0',
    belowMinimum: below.map((v) => ({ vehicle: v.vehicle_id, depot: v.depot, firmware: v.device_firmware, driver: v.assigned_driver, requested: requested.has(v.vehicle_id) })),
    compliant: triage.vehicles.length - below.length, total: triage.vehicles.length,
  };
}

function metrics(role, cases, workOrders) {
  const workflowActions = state.log.filter((l) => l.role === role).length;
  if (role === 'maintenance') {
    const fromDashboard = workOrders.filter((w) => w.source === 'dashboard');
    return {
      pending: fromDashboard.filter((w) => w.status === 'Pending approval').length,
      approved: fromDashboard.filter((w) => w.status === 'Approved').length,
      withEta: workOrders.filter((w) => w.eta).length,
      workflowActions,
    };
  }
  const total = cases.length;
  const resolved = cases.filter((c) => c.state?.status === 'resolved').length;
  const tonight = cases.filter((c) => c.tonight);
  const tonightActioned = tonight.filter((c) => c.state || c.referral).length;
  return {
    highCriticalSent: total, resolved,
    resolvedRate: total ? +(resolved / total * 100).toFixed(1) : 0,
    escalated: cases.filter((c) => c.state?.workOrder).length,
    referred: Object.keys(state.referrals).length,
    tonightQueue: tonight.length, tonightActioned,
    // Guardrail: are we sending more high/critical items than the team actually works?
    tonightCoveragePct: tonight.length ? Math.round(tonightActioned / tonight.length * 100) : 0,
    guardrailBreached: tonightActioned < tonight.length,
    workflowActions,
  };
}

function apiData(user) {
  if (!user) return { users: USERS };
  const role = user.role;
  const base = { dataVersion, lastReceived: triage.quality.lastReceived, generatedFor: triage.generatedFor, rules: triage.rules, user: { ...user }, permissions: PERMISSIONS[role], access: ACCESS[role], series: triage.series, depots: triage.depots, canSeeAllAlerts: SEES_ALL_ALERTS.includes(role) };
  const log = state.log.filter((l) => (l.visibleTo || [l.role]).includes(role)).slice(-50).reverse();
  if (role === 'maintenance') {
    const workOrders = allWorkOrders();
    return { ...base, workOrders, log, metrics: metrics(role, [], workOrders) };
  }
  if (role === 'finance') {
    const workOrders = withCosts(allWorkOrders());
    return { ...base, workOrders, finance: financeSummary(workOrders), log: state.log.slice(-200).reverse(), counts: triage.counts };
  }
  if (role === 'admin') {
    // Business Manager: every team's dashboard and metrics.
    const teams = {};
    for (const r of ['operations', 'safety', 'maintenance']) teams[r] = apiData(Object.values(USERS).find((u) => u.role === r));
    const workOrders = withCosts(allWorkOrders());
    return { ...base, teams, workOrders, finance: financeSummary(workOrders), access: ACCESS, allAccess: true, log: state.log.slice(-200).reverse(), quality: triage.quality, counts: triage.counts, referralsAll: referrals() };
  }
  const cases = scopedCases(role);
  const out = { ...base, cases, lowMedium: triage.lowMedium.filter((a) => ALERT_TEAMS[role].includes(teamOf(a.type))), log, metrics: metrics(role, cases) };
  if (role === 'safety') {
    out.drivers = triage.drivers.map((d) => ({ ...d, depot: depotOfMap()[d.vehicle] }));
    out.referrals = referrals();
    out.firmware = firmware();
    out.vehicles = triage.vehicles.map((v) => ({ id: v.vehicle_id, depot: v.depot, driver: v.assigned_driver, firmware: v.device_firmware, cls: v.vehicle_class }));
  }
  return out;
}

function withCosts(wos) {
  return wos.map((w) => ({ ...w, cost: state.costs[w.wo_id] || null }));
}

function financeSummary(wos) {
  const recorded = wos.filter((w) => w.cost);
  const total = recorded.reduce((n, w) => n + w.cost.total, 0);
  const byDepot = {};
  for (const w of recorded) byDepot[w.depot || 'Unassigned'] = (byDepot[w.depot || 'Unassigned'] || 0) + w.cost.total;
  return {
    total, recorded: recorded.length, missing: wos.filter((w) => !w.cost && w.status !== 'Pending approval').length,
    verified: recorded.filter((w) => w.cost.review === 'Verified').length, flagged: recorded.filter((w) => w.cost.review === 'Flagged').length,
    byDepot, workOrders: wos.length,
  };
}

function handleAction(user, body) {
  const role = user.role;
  const { action } = body;
  if (!PERMISSIONS[role].includes(action)) return [403, { error: `${user.name} isn't allowed to ${action.replace(/_/g, ' ')}` }];
  const at = new Date().toISOString();
  const entry = { at, user: user.name, role, action, visibleTo: [role] };
  const priority = ['P1', 'P2', 'P3'].includes(body.priority) ? body.priority : 'P2';

  if (['escalate', 'resolve', 'case_note', 'refer_safety'].includes(action)) {
    const c = triage.cases.find((x) => x.id === body.caseId);
    if (!c) return [404, { error: 'Unknown case' }];
    if (!canSeeCase(role, c)) return [403, { error: 'This case belongs to another team' }];
    if (action === 'escalate' && c.network) return [400, { error: 'Network and reporting problems go to IT and the vendor, not the maintenance shop' }];
    const ref = referralFor(c.id);
    // Safety works a referred Ops case through the referral, not the Ops case itself.
    const viaReferral = role === 'safety' && !CASE_TEAMS.safety.includes(c.team);
    entry.target = c.id;
    if (action === 'refer_safety') {
      if (!body.note) return [400, { error: 'Add a note so Safety knows what you need' }];
      if (ref && ref[1].status === 'Open') return [409, { error: `Already referred (${ref[0]})` }];
      const id = nextId('R-', state.referrals);
      state.referrals[id] = { caseId: c.id, note: body.note, from: user.name, at, status: 'Open', notes: [], workOrder: null };
      (state.cases[c.id] ||= { notes: [] }).status ||= 'referred to safety';
      entry.detail = `${id}: ${body.note}`;
      entry.visibleTo = ['operations', 'safety'];
    } else if (viaReferral && action === 'escalate') {
      const r = ref[1];
      if (r.workOrder) return [409, { error: `Already sent as ${r.workOrder}` }];
      r.workOrder = newWorkOrder(user, at, { vehicle_id: c.vehicle, caseId: c.id, priority, work_done: c.title });
      r.notes.push({ at, by: user.name, text: `Sent to maintenance as ${r.workOrder} (${priority})${body.note ? ': ' + body.note : ''}` });
      r.status = 'Actioned';
      entry.detail = `${r.workOrder} ${priority}`;
      entry.visibleTo = ['operations', 'safety', 'maintenance'];
    } else if (viaReferral) {
      return [403, { error: 'Use the referral to respond to Operations' }];
    } else {
      const cs = state.cases[c.id] ||= { notes: [] };
      if (action === 'escalate') {
        if (cs.workOrder) return [409, { error: `Already escalated as ${cs.workOrder}` }];
        const woId = newWorkOrder(user, at, { vehicle_id: c.vehicle, caseId: c.id, priority, work_done: c.title });
        Object.assign(cs, { status: 'escalated', workOrder: woId, priority });
        if (body.note) cs.notes.push({ at, by: user.name, text: body.note });
        entry.detail = `${woId} ${priority}`;
        entry.visibleTo = [role, 'maintenance'];
      } else if (action === 'resolve') {
        cs.status = 'resolved';
        cs.notes.push({ at, by: user.name, text: body.note || 'Resolved' });
        entry.detail = body.note || '';
      } else {
        if (!body.note) return [400, { error: 'Note is empty' }];
        cs.status ||= 'acknowledged';
        cs.notes.push({ at, by: user.name, text: body.note });
        entry.detail = body.note;
      }
    }
  } else if (action === 'record_cost' || action === 'review_cost') {
    const wo = allWorkOrders().find((w) => w.wo_id === body.woId);
    if (!wo) return [404, { error: 'Unknown work order' }];
    entry.target = wo.wo_id; entry.visibleTo = ['finance', 'admin'];
    if (action === 'record_cost') {
      const parts = Number(body.parts), hours = Number(body.labourHours), rate = Number(body.labourRate);
      if (![parts, hours, rate].every((n) => Number.isFinite(n) && n >= 0)) return [400, { error: 'Parts, labour hours and rate must be numbers of 0 or more' }];
      const prev = state.costs[wo.wo_id];
      state.costs[wo.wo_id] = { parts, labourHours: hours, labourRate: rate, total: +(parts + hours * rate).toFixed(2), invoice: String(body.invoice || '').slice(0, 40), review: 'Unreviewed', by: user.name, at, history: [...(prev?.history || []), ...(prev ? [{ total: prev.total, at: prev.at, by: prev.by }] : [])] };
      entry.detail = `${state.costs[wo.wo_id].total.toFixed(2)}${prev ? ` (was ${prev.total.toFixed(2)})` : ''}`;
    } else {
      const c = state.costs[wo.wo_id];
      if (!c) return [409, { error: 'Record a cost before reviewing it' }];
      if (!['Verified', 'Flagged'].includes(body.review)) return [400, { error: 'Review must be Verified or Flagged' }];
      c.review = body.review; c.reviewNote = body.note || ''; c.reviewedBy = user.name;
      entry.detail = body.review + (body.note ? ': ' + body.note : '');
    }
  } else if (action === 'audit_note') {
    if (!body.note) return [400, { error: 'Note is empty' }];
    entry.target = body.target || 'audit'; entry.detail = body.note; entry.visibleTo = ['finance', 'admin'];
  } else if (action === 'withdraw_wo' || action === 'delete_wo') {
    const w = state.workOrders[body.woId];
    if (!w || w.source !== 'dashboard') return [404, { error: 'Only work orders raised in this dashboard can be removed' }];
    if (w.status !== 'Pending approval') return [409, { error: `${body.woId} is already ${w.status}; ask Maintenance instead` }];
    if (action === 'withdraw_wo' && w.requestedRole !== role) return [403, { error: 'You can only withdraw your own requests' }];
    delete state.workOrders[body.woId];
    for (const cs of Object.values(state.cases)) if (cs.workOrder === body.woId) { delete cs.workOrder; cs.status = 'acknowledged'; }
    for (const r of Object.values(state.referrals)) if (r.workOrder === body.woId) r.workOrder = null;
    entry.target = body.woId; entry.detail = body.note || 'Removed while pending'; entry.visibleTo = ['operations', 'safety', 'maintenance', 'finance', 'admin'];
  } else if (action === 'delete_referral') {
    const r = state.referrals[body.referralId];
    if (!r) return [404, { error: 'Unknown referral' }];
    if (r.status !== 'Open') return [409, { error: 'Only open referrals can be removed' }];
    delete state.referrals[body.referralId];
    entry.target = body.referralId; entry.detail = body.note || 'Removed (raised in error)'; entry.visibleTo = ['operations', 'safety', 'admin'];
  } else if (['referral_note', 'close_referral'].includes(action)) {
    const r = state.referrals[body.referralId];
    if (!r) return [404, { error: 'Unknown referral' }];
    entry.target = body.referralId;
    entry.visibleTo = ['operations', 'safety'];
    if (action === 'referral_note') {
      if (!body.note) return [400, { error: 'Note is empty' }];
      r.notes.push({ at, by: user.name, text: body.note });
      if (r.status === 'Open') r.status = 'Actioned';
    } else {
      r.status = 'Closed';
      r.notes.push({ at, by: user.name, text: body.note || 'Closed by Safety' });
    }
    entry.detail = body.note || '';
  } else if (action === 'advise_maintenance') {
    const v = triage.vehicles.find((x) => x.vehicle_id === body.vehicleId);
    if (!v) return [400, { error: 'Choose a vehicle' }];
    if (!body.note) return [400, { error: 'Describe the safety concern for maintenance' }];
    const woId = newWorkOrder(user, at, {
      vehicle_id: v.vehicle_id, priority, work_done: `Safety advisory: ${body.note.slice(0, 70)}`,
      request: { title: 'Safety advisory', actions: [body.note], evidence: [], history: [], context: [`${v.vehicle_class} · ${v.depot} · driver ${v.assigned_driver} · firmware ${v.device_firmware}`], notes: [] },
    });
    entry.target = woId; entry.detail = `${v.vehicle_id} ${priority}: ${body.note}`;
    entry.visibleTo = ['safety', 'maintenance'];
  } else if (action === 'set_min_firmware') {
    if (!FIRMWARE_NOTES[body.version]) return [400, { error: 'Unknown firmware version' }];
    state.policy = { minFirmware: body.version, setBy: user.name, at };
    entry.target = 'firmware policy'; entry.detail = `Minimum ${body.version}`;
  } else if (action === 'request_firmware_update') {
    const fw = firmware();
    const min = state.policy.minFirmware;
    if (!min) return [400, { error: 'Set a minimum version first' }];
    const todo = fw.belowMinimum.filter((v) => !v.requested);
    if (!todo.length) return [409, { error: 'Every vehicle below the minimum already has an update request' }];
    // Phased plan: 4.2.1 first (it skews driver scores), older versions after. An update plan, not a dispatch block.
    const byDepot = {};
    todo.forEach((v) => (byDepot[v.depot + '|' + (v.firmware === '4.2.1' ? 'P2' : 'P3')] ||= []).push(v));
    const created = Object.entries(byDepot).map(([key, list]) => { const [depot, phase] = key.split('|'); return newWorkOrder(user, at, {
      vehicle_id: `${list.length} vehicles · ${depot}`, depotName: depot, priority: body.priority === 'P1' ? 'P1' : phase, firmwareTarget: min, vehicles: list.map((v) => v.vehicle),
      work_done: `Update telematics firmware to ${min} or newer`,
      request: { title: 'Firmware policy', actions: [`Update telematics firmware to ${min}+ on: ${list.map((v) => `${v.vehicle} (${v.firmware})`).join(', ')}`, 'Schedule during the nightly window or before morning dispatch.', 'This is an update plan, not a dispatch block: vehicles keep running until updated.', ...(body.note ? [body.note] : [])], evidence: [], history: [], context: [FIRMWARE_NOTES[min]], notes: [] },
    }); });
    entry.target = created.join(', '); entry.detail = `${todo.length} vehicles to ${min}+ (4.2.1 first)`;
    entry.visibleTo = ['safety', 'maintenance'];
  } else {
    const id = body.woId;
    const known = state.workOrders[id] || triage.workOrders.find((w) => w.wo_id === id);
    if (!known) return [404, { error: 'Unknown work order' }];
    const ws = state.workOrders[id] ||= { notes: [] };
    ws.notes ||= [];
    entry.target = id;
    entry.visibleTo = ['maintenance', ...(ws.requestedRole ? [ws.requestedRole] : [])];
    if (action === 'approve_wo') {
      const current = ws.status || known.status;
      if (current !== 'Pending approval') return [409, { error: `${id} is ${current}, not pending approval` }];
      ws.status = 'Approved';
      ws.approvedBy = user.name;
    } else if (action === 'set_eta') {
      if (!body.eta) return [400, { error: 'ETA is empty' }];
      ws.eta = body.eta;
      entry.detail = body.eta;
    } else {
      if (!body.note) return [400, { error: 'Note is empty' }];
      ws.notes.push({ at, by: user.name, text: body.note });
      entry.detail = body.note;
    }
  }
  entry.visibleTo = [...new Set([...entry.visibleTo, 'admin', 'finance'])];
  state.log.push(entry);
  save();
  return [200, apiData(user)];
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/api/version') return send(200, { version: dataVersion });
  if (req.url === '/api/data') return send(200, apiData(USERS[req.headers['x-user']]));
  if (req.url === '/api/alerts') {
    const u = USERS[req.headers['x-user']];
    if (!u || !SEES_ALL_ALERTS.includes(u.role)) return send(403, { error: 'Not available for this role' });
    return send(200, triage.allAlerts);
  }
  if (req.url === '/api/action' && req.method === 'POST') {
    const user = USERS[req.headers['x-user']];
    if (!user) return send(401, { error: 'Sign in first' });
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try { const [code, out] = handleAction(user, JSON.parse(body)); send(code, out); }
      catch (e) { send(400, { error: e.message }); }
    });
    return;
  }
  const file = path.join(PUBLIC, req.url === '/' ? 'index.html' : path.normalize(req.url).replace(/^([\\/])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  fs.createReadStream(file).pipe(res);
});

if (require.main === module) {
  fs.watch(DATA_DIR, () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reloadData, 500); });
  server.listen(PORT, () => console.log(`Maple Freight triage dashboard → http://localhost:${PORT}`));
}
module.exports = { handleAction, apiData, USERS, PERMISSIONS, ACCESS, server };
