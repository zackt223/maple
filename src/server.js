// Zero-dependency local server: serves the dashboard and enforces role permissions on every write.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { run } = require('./triage');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, '..', 'state.json');

// Demo users. A real deployment would use company SSO; roles are what matter here.
const USERS = {
  'ops.manager':    { name: 'Operations Manager', role: 'operations' },
  'safety.manager': { name: 'Safety Manager',     role: 'safety' },
  'maint.lead':     { name: 'Maintenance Lead',   role: 'maintenance' },
};

// What each role may do. Checked server-side; the UI only hides buttons for convenience.
const PERMISSIONS = {
  operations:  ['escalate', 'resolve', 'case_note'],
  safety:      ['escalate', 'resolve', 'case_note'],
  maintenance: ['approve_wo', 'set_eta', 'wo_note'],
};

const triage = run();
const emptyState = () => ({ cases: {}, workOrders: {}, log: [] });
let state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : emptyState();
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// What each role is allowed to SEE. Enforced here: other roles' data is never sent to the browser.
// Operations owns vehicle availability (device + mechanical issues it escalates); Safety owns driver behaviour;
// Maintenance only sees its work-order queue.
const CASE_TEAMS = { operations: ['operations', 'maintenance'], safety: ['safety'], maintenance: [] };
const ALERT_TEAMS = { operations: ['operations'], safety: ['safety'], maintenance: [] };
const canSeeCase = (role, c) => CASE_TEAMS[role].includes(c.team);

function allWorkOrders() {
  const dashboardWos = Object.entries(state.workOrders).filter(([, w]) => w.source === 'dashboard').map(([id, w]) => {
    // Maintenance gets what it needs to do the job: the reported steps, evidence and repair history.
    const c = triage.cases.find((x) => x.id === w.caseId);
    const request = c ? { actions: c.actions, evidence: c.evidence.slice(0, 5), history: c.history || [], notes: state.cases[c.id]?.notes || [] } : null;
    return { wo_id: id, ...w, request };
  });
  const csvWos = triage.workOrders.map((w) => ({ ...w, source: 'shop', ...(state.workOrders[w.wo_id] || {}) }));
  const order = { 'Pending approval': 0, Approved: 1, Open: 2, Scheduled: 3, Closed: 4 };
  return [...dashboardWos, ...csvWos].sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
}

function scopedCases(role) {
  const capacity = triage.rules.dailyCapacity;
  return triage.cases.filter((c) => canSeeCase(role, c)).map((c, i) => {
    const cs = state.cases[c.id];
    const wo = cs?.workOrder ? state.workOrders[cs.workOrder] : null;
    return { ...c, rank: i + 1, tonight: i < capacity, state: cs || null,
      linkedWo: wo ? { id: cs.workOrder, status: wo.status, eta: wo.eta, notes: wo.notes } : null };
  });
}

function metrics(role, cases, workOrders) {
  if (role === 'maintenance') {
    const fromDashboard = workOrders.filter((w) => w.source === 'dashboard');
    return {
      pending: fromDashboard.filter((w) => w.status === 'Pending approval').length,
      approved: fromDashboard.filter((w) => w.status === 'Approved').length,
      withEta: workOrders.filter((w) => w.eta).length,
      escalationsReceived: fromDashboard.length,
      workflowActions: state.log.filter((l) => l.role === 'maintenance').length,
    };
  }
  const total = cases.length;
  const resolved = cases.filter((c) => c.state?.status === 'resolved').length;
  const tonight = cases.filter((c) => c.tonight);
  const tonightActioned = tonight.filter((c) => c.state).length;
  const ids = new Set(cases.map((c) => c.id));
  return {
    highCriticalSent: total,
    resolved,
    resolvedRate: total ? +(resolved / total * 100).toFixed(1) : 0,
    escalated: cases.filter((c) => c.state?.workOrder).length,
    tonightQueue: tonight.length,
    tonightActioned,
    // Guardrail: are we sending more high/critical items than the team actually works?
    tonightCoveragePct: tonight.length ? Math.round(tonightActioned / tonight.length * 100) : 0,
    guardrailBreached: tonightActioned < tonight.length,
    workflowActions: state.log.filter((l) => ids.has(l.target)).length,
  };
}

function apiData(user) {
  if (!user) return { users: USERS };
  const role = user.role;
  const base = { generatedFor: triage.generatedFor, rules: triage.rules, user: { ...user }, permissions: PERMISSIONS[role] };
  if (role === 'maintenance') {
    const workOrders = allWorkOrders();
    const woIds = new Set(workOrders.map((w) => w.wo_id));
    return { ...base, workOrders, log: state.log.filter((l) => woIds.has(l.target)).slice(-50).reverse(), metrics: metrics(role, [], workOrders) };
  }
  const cases = scopedCases(role);
  const ids = new Set(cases.map((c) => c.id));
  const out = {
    ...base, cases,
    lowMedium: triage.lowMedium.filter((a) => ALERT_TEAMS[role].includes(teamOf(a.type))),
    log: state.log.filter((l) => ids.has(l.target)).slice(-50).reverse(),
    metrics: metrics(role, cases),
  };
  if (role === 'safety') out.drivers = triage.drivers;
  return out;
}

const teamOf = (type) => (['speeding', 'harsh_braking', 'harsh_accel', 'harsh_cornering'].includes(type) ? 'safety' : 'operations');

function handleAction(user, body) {
  const role = user.role;
  const { action } = body;
  if (!PERMISSIONS[role].includes(action)) return [403, { error: `${user.name} (${role}) is not allowed to ${action.replace('_', ' ')}` }];
  const at = new Date().toISOString();
  const entry = { at, user: user.name, role, action };

  if (['escalate', 'resolve', 'case_note'].includes(action)) {
    const c = triage.cases.find((x) => x.id === body.caseId);
    if (!c) return [404, { error: 'Unknown case' }];
    if (!canSeeCase(role, c)) return [403, { error: `This case belongs to another team` }];
    const cs = state.cases[c.id] ||= { notes: [] };
    entry.target = c.id;
    if (action === 'escalate') {
      const priority = ['P1', 'P2', 'P3'].includes(body.priority) ? body.priority : 'P2';
      if (cs.workOrder) return [409, { error: `Already escalated as ${cs.workOrder}` }];
      const woId = 'WO-D' + String(Object.keys(state.workOrders).length + 1).padStart(3, '0');
      state.workOrders[woId] = {
        source: 'dashboard', vehicle_id: c.vehicle, caseId: c.id, priority, status: 'Pending approval',
        work_done: c.title, technician_note: '', opened_local: at, eta: null, notes: [],
        requestedBy: user.name,
      };
      Object.assign(cs, { status: 'escalated', workOrder: woId, priority });
      if (body.note) cs.notes.push({ at, by: user.name, text: body.note });
      entry.detail = `${woId} ${priority}`;
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
  } else {
    const id = body.woId;
    const known = state.workOrders[id] || triage.workOrders.find((w) => w.wo_id === id);
    if (!known) return [404, { error: 'Unknown work order' }];
    const ws = state.workOrders[id] ||= { notes: [] };
    ws.notes ||= [];
    entry.target = id;
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
  state.log.push(entry);
  save();
  return [200, apiData(user)];
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/api/data') return send(200, apiData(USERS[req.headers['x-user']]));
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
  server.listen(PORT, () => console.log(`Maple Freight triage dashboard → http://localhost:${PORT}`));
}
module.exports = { handleAction, apiData, USERS, PERMISSIONS, server };
