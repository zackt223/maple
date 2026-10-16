// Builds a static copy of the dashboard into docs/ for GitHub Pages (no server needed).
// The triage runs here at build time; the same src/core.js used by `npm start` then runs in the browser,
// and each browser keeps its own escalations, notes and costs in local storage.
const fs = require('fs');
const path = require('path');
const { run } = require('../src/triage');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);

for (const f of fs.readdirSync(path.join(ROOT, 'public'))) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, 'src', 'core.js'), path.join(OUT, 'core.js'));

const { _alerts, ...triage } = run();
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(triage));

fs.writeFileSync(path.join(OUT, 'static.js'), `// GitHub Pages build: there is no server, so /api/* requests are answered in the browser
// by the same core (permissions, visibility, workflow) that the Node server uses.
(function () {
  const KEY = 'maple-state-v1';
  const realFetch = window.fetch.bind(window);
  const ready = realFetch('data.json').then((r) => r.json()).then((triage) => MapleCore.createCore({
    triage,
    loadState: () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
    saveState: (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} },
  }));
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, opts = {}) => {
    const u = typeof url === 'string' ? url : url.url;
    if (!u.startsWith('/api/')) return realFetch(url, opts);
    const core = await ready;
    const user = core.USERS[(opts.headers || {})['X-User']];
    if (u === '/api/version') return reply(200, { version: core.version });
    if (u === '/api/data') return reply(200, core.apiData(user));
    if (u === '/api/alerts') return user && core.SEES_ALL_ALERTS.includes(user.role) ? reply(200, core.triage.allAlerts) : reply(403, { error: 'Not available for this role' });
    if (u === '/api/action') {
      if (!user) return reply(401, { error: 'Sign in first' });
      try { const [code, out] = core.handleAction(user, JSON.parse(opts.body)); return reply(code, out); }
      catch (e) { return reply(400, { error: e.message }); }
    }
    return reply(404, { error: 'Not found' });
  };
})();
`);

const htmlPath = path.join(OUT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('<script src="charts.js"></script>')) throw new Error('index.html layout changed; update build-pages.js');
fs.writeFileSync(htmlPath, html.replace('<script src="charts.js"></script>', '<script src="core.js"></script>\n<script src="static.js"></script>\n<script src="charts.js"></script>'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // serve files as-is

console.log(`Built docs/ (${(fs.statSync(path.join(OUT, 'data.json')).size / 1024).toFixed(0)} KB of data). Commit it and serve /docs with GitHub Pages.`);
