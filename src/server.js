// Zero-dependency local server: serves the dashboard; src/core.js enforces role permissions on every read and write.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { run, DATA_DIR } = require('./triage');
const { createCore } = require('./core');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, '..', 'state.json');

const core = createCore({
  triage: run(),
  loadState: () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : null),
  saveState: (state) => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)),
});
const { apiData, handleAction, USERS, PERMISSIONS, ACCESS, SEES_ALL_ALERTS } = core;

// Rebuilt whenever a file in data/ changes, so late deliveries (like the Hamilton backfill) show up without a restart.
let reloadTimer = null;
function reloadData() {
  try { core.setTriage(run()); console.log(`Data reloaded (version ${core.version})`); }
  catch (e) { console.error('Data reload failed, keeping the previous data:', e.message); }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/api/version') return send(200, { version: core.version });
  if (req.url === '/api/data') return send(200, apiData(USERS[req.headers['x-user']]));
  if (req.url === '/api/alerts') {
    const u = USERS[req.headers['x-user']];
    if (!u || !SEES_ALL_ALERTS.includes(u.role)) return send(403, { error: 'Not available for this role' });
    return send(200, core.triage.allAlerts);
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
