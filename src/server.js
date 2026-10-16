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

function metrics() {
  const total = triage.cases.length;
  const caseStates = Object.values(state.cases);
  const resolved = caseStates.filter((c) => c.status === 'resolved').length;
  const escalated = caseStates.filter((c) => c.status === 'escalated').length;
  const actioned = triage.cases.filter((c) => state.cases[c.id]).length;
  const tonight = triage.cases.filter((c) => c.tonight);
  const tonightActioned = tonight.filter((c) => state.cases[c.id]).length;
  const actions = state.log.length;
  return {
    highCriticalSent: total,
    tonightQueue: tonight.length,
    tonightActioned,
    resolved,
    escalated,
    resolvedRate: total ? +(resolved / total * 100).toFixed(1) : 0,
    workflowActions: actions,
    casesActioned: actioned,
    // Guardrail: are we sending more high/critical items than the team actually works?
    actionCoveragePct: total ? +(actioned / total * 100).toFixed(1) : 0,
    tonightCoveragePct: tonight.length ? +(tonightActioned / tonight.length * 100).toFixed(1) : 0,
    guardrailBreached: tonightActioned < tonight.length,
    rawAlerts: triage.quality.rawAlerts,
  };
}

function apiData() {
  const { _alerts, ...rest } = triage;
  const cases = triage.cases.map((c) => {
    const cs = state.cases[c.id];
    const wo = cs?.workOrder ? state.workOrders[cs.workOrder] : null;
    return { ...c, state: cs || null, linkedWo: wo ? { id: cs.workOrder, status: wo.status, eta: wo.eta, notes: wo.notes } : null };
  });
  const escalated = Object.entries(state.workOrders).map(([id, w]) => ({ wo_id: id, ...w }));
  const csvWos = triage.workOrders.map((w) => ({ ...w, source: 'shop', ...(state.workOrders[w.wo_id] || {}) }));
  const dashboardWos = escalated.filter((w) => w.source === 'dashboard');
  const order = { 'Pending approval': 0, Approved: 1, Open: 2, Scheduled: 3, Closed: 4 };
  const workOrders = [...dashboardWos, ...csvWos].sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
  return { ...rest, cases, workOrders, log: state.log.slice(-50).reverse(), metrics: metrics(), users: USERS, permissions: PERMISSIONS };
}

function handleAction(user, body) {
  const role = user.role;
  const { action } = body;
  if (!PERMISSIONS[role].includes(action)) return [403, { error: `${user.name} (${role}) is not allowed to ${action.replace('_', ' ')}` }];
  const at = new Date().toISOString();
  const entry = { at, user: user.name, role, action };

  if (['escalate', 'resolve', 'case_note'].includes(action)) {
    const c = triage.cases.find((x) => x.id === body.caseId);
    if (!c) return [404, { error: 'Unknown case' }];
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
  return [200, apiData()];
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/api/data') return send(200, apiData());
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
  if (req.url === '/api/reset' && req.method === 'POST') { state = emptyState(); save(); return send(200, apiData()); }
  const file = path.join(PUBLIC, req.url === '/' ? 'index.html' : path.normalize(req.url).replace(/^([\\/])+/, ''));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  fs.createReadStream(file).pipe(res);
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Maple Freight triage dashboard → http://localhost:${PORT}`));
}
module.exports = { handleAction, USERS, PERMISSIONS, server };
