// GitHub Pages build: there is no server, so /api/* requests are answered in the browser
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
