// Maple Freight dashboard client. The server decides what each role can see and do; this only renders it.
let DATA = null;
let USER = store('user');
let TAB = store('tab');
const OPEN = new Set();
let filter = { priority: 'all', type: 'all', depot: 'all', limit: 60 };

const ROLE_META = {
  operations: { color: '#007aff', short: 'Ops', blurb: 'Vehicle availability for the 6:00 a.m. dispatch' },
  safety: { color: '#af52de', short: 'Safety', blurb: 'Driver behaviour and coaching' },
  maintenance: { color: '#ff9500', short: 'Maintenance', blurb: 'Work orders escalated to the shop' },
};
const TABS = {
  operations: [['tonight', 'Tonight'], ['backlog', 'Backlog'], ['other', 'Low & medium'], ['activity', 'Activity']],
  safety: [['tonight', 'Tonight'], ['backlog', 'Backlog'], ['drivers', 'Drivers'], ['other', 'Low & medium'], ['activity', 'Activity']],
  maintenance: [['queue', 'Queue'], ['done', 'Closed'], ['activity', 'Activity']],
};

function store(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; }
}
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const et = (iso) => (iso ? new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtEta = (s) => et(s.length === 16 ? s + ':00-04:00' : s);

async function load() {
  const r = await fetch('/api/data', { headers: USER ? { 'X-User': USER } : {} });
  DATA = await r.json();
  if (!DATA.user) { USER = null; store('user', null); }
  render();
}

async function act(payload) {
  const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': USER }, body: JSON.stringify(payload) });
  const out = await r.json();
  if (!r.ok) return toast(out.error, true);
  DATA = out;
  toast({ escalate: 'Sent to maintenance', resolve: 'Marked resolved', approve_wo: 'Work order approved', set_eta: 'ETA saved' }[payload.action] || 'Note added');
  render();
}

function toast(msg, error) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast glass show' + (error ? ' error' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'toast glass' + (error ? ' error' : '')), 2400);
}

// ---------- Sign in ----------
function signIn() {
  const users = DATA.users;
  $('#app').innerHTML = `<div class="signin"><div class="signin-card glass">
    <div class="logo">M</div>
    <div class="large" style="font-size:1.7rem">Maple Freight</div>
    <p class="lede" style="margin:0">Choose your team to see what needs you tonight.</p>
    <div class="roles">${Object.entries(users).map(([id, u]) => `
      <button class="role glass" data-user="${id}" style="--role:${ROLE_META[u.role].color}">
        <span class="ic">${ROLE_META[u.role].short[0]}</span>
        <span><div class="t">${esc(u.name)}</div><div class="d">${ROLE_META[u.role].blurb}</div></span>
      </button>`).join('')}</div>
  </div></div>`;
  document.querySelectorAll('[data-user]').forEach((b) => b.addEventListener('click', () => {
    USER = b.dataset.user; store('user', USER); TAB = null; store('tab', null); OPEN.clear(); load();
  }));
}

// ---------- Shell ----------
function render() {
  if (!DATA.user) return signIn();
  const role = DATA.user.role;
  const tabs = TABS[role];
  if (!tabs.some(([id]) => id === TAB)) TAB = tabs[0][0];
  const counts = tabCounts(role);
  $('#app').innerHTML = `
    <header class="top"><div class="top-inner">
      <span class="eyebrow">${esc(DATA.generatedFor)}</span>
      <button class="avatar glass" id="signout" style="--role:${ROLE_META[role].color}" aria-label="Sign out"><span class="dot"></span>${esc(DATA.user.name)} · Sign out</button>
    </div></header>
    <main class="wrap">${view(role)}</main>
    <nav class="tabbar glass" role="tablist">${tabs.map(([id, label]) => `<button class="tab" role="tab" aria-selected="${id === TAB}" data-tab="${id}">${label}${counts[id] != null ? `<span class="n">${counts[id]}</span>` : ''}</button>`).join('')}</nav>`;
  wire();
}

function tabCounts(role) {
  if (role === 'maintenance') {
    return { queue: DATA.workOrders.filter((w) => w.status !== 'Closed').length, done: DATA.workOrders.filter((w) => w.status === 'Closed').length };
  }
  const open = DATA.cases.filter((c) => c.state?.status !== 'resolved');
  return { tonight: DATA.cases.filter((c) => c.tonight).length, backlog: open.filter((c) => !c.tonight).length, other: DATA.lowMedium.length };
}

function heading(title, lede) { return `<h1 class="large">${title}</h1><p class="lede">${lede}</p>`; }

function view(role) {
  if (TAB === 'activity') return activity();
  if (role === 'maintenance') return maintenance();
  const m = DATA.metrics;
  const tiles = `<section class="tiles">
    <div class="tile glass"><div class="k">Resolved here</div><div class="v">${m.resolved}<span class="s"> / ${m.highCriticalSent}</span></div><div class="s">high & critical cases</div></div>
    <div class="tile glass ${m.guardrailBreached ? 'warn' : 'good'}"><div class="k">Tonight actioned</div><div class="v">${m.tonightActioned}<span class="s"> / ${m.tonightQueue}</span></div><div class="s">${m.guardrailBreached ? 'More sent than worked' : 'All worked'}</div></div>
    <div class="tile glass"><div class="k">Actions taken</div><div class="v">${m.workflowActions}</div><div class="s">${m.escalated} sent to maintenance</div></div>
  </section>`;
  const team = role === 'safety' ? 'driver-behaviour' : 'vehicle';
  if (TAB === 'tonight') return heading('Tonight', `Your ${DATA.rules.dailyCapacity} most important ${team} issues, ranked. Start at the top.`) + tiles + cards(DATA.cases.filter((c) => c.tonight));
  if (TAB === 'backlog') return heading('Backlog', 'Other high and critical issues, ranked. Pull from here once tonight is done.') + cards(DATA.cases.filter((c) => !c.tonight && c.state?.status !== 'resolved'));
  if (TAB === 'drivers') return drivers();
  if (TAB === 'other') return lowMedium();
  return '';
}

// ---------- Cases ----------
function cards(list) {
  if (!list.length) return '<div class="empty glass">Nothing here.</div>';
  return `<div class="list">${list.map(card).join('')}</div>`;
}

function statusCapsule(c) {
  const st = c.state;
  if (!st) return '';
  if (st.status === 'resolved') return '<span class="capsule ok">Resolved</span>';
  if (c.linkedWo) return `<span class="capsule plain">${esc(c.linkedWo.id)} · ${esc(c.linkedWo.status)}${c.linkedWo.eta ? ' · ETA ' + esc(fmtEta(c.linkedWo.eta)) : ''}</span>`;
  return `<span class="capsule plain">${cap(st.status)}</span>`;
}

function card(c) {
  const open = OPEN.has(c.id);
  const done = c.state?.status === 'resolved';
  const st = c.state || {};
  return `<article class="card glass ${c.priority} ${open ? 'open' : ''}" data-card="${c.id}" tabindex="0" aria-expanded="${open}" style="${done ? 'opacity:.6' : ''}">
    <div class="row">
      <span class="badge">${c.rank}</span>
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        <div class="sub">${esc(c.vehicle)} · ${esc(c.driver)} · ${esc(c.depot)} · ${c.hoursAgo < 48 ? c.hoursAgo + ' h ago' : Math.round(c.hoursAgo / 24) + ' days ago'}</div>
        <div class="capsules"><span class="capsule">${cap(c.priority)}</span>${c.recurred ? '<span class="capsule critical">After repair</span>' : ''}${statusCapsule(c)}</div>
      </div>
      <span class="chev">›</span>
    </div>
    ${open ? '' : `<div class="next"><b>Next:</b> ${esc(c.actions[0])}</div>`}
    ${open ? `<div class="detail">
      <div><h4>What to do</h4><ol>${c.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol></div>
      ${c.context?.length ? `<div><h4>Keep in mind</h4>${c.context.map((n) => `<div class="context">${esc(n)}</div>`).join('')}</div>` : ''}
      <div><h4>Evidence</h4>${c.evidence.map((e) => `<div class="ev"><span class="when">${esc(e.when)} ET</span> · ${esc(e.reason)}${e.wo ? `<div class="m">${esc(e.wo)}</div>` : ''}</div>`).join('')}
        ${(c.history || []).length ? `<h4 style="margin-top:10px">Earlier faults the shop marked fixed</h4>${c.history.map((e) => `<div class="ev"><span class="when">${esc(e.when)} ET</span> · ${esc(e.reason)}<div class="m">${esc(e.wo)}</div></div>`).join('')}` : ''}</div>
      ${(st.notes || []).length || c.linkedWo ? `<div><h4>Updates</h4>
        ${(st.notes || []).map((n) => `<div class="note"><b>${esc(n.by)}</b> · ${esc(et(n.at))}<br>${esc(n.text)}</div>`).join('')}
        ${c.linkedWo ? `<div class="note"><b>Maintenance · ${esc(c.linkedWo.id)}</b> · ${esc(c.linkedWo.status)}${c.linkedWo.eta ? ' · ETA ' + esc(fmtEta(c.linkedWo.eta)) : ' · no ETA yet'}</div>
          ${(c.linkedWo.notes || []).map((n) => `<div class="note"><b>${esc(n.by)}</b> · ${esc(et(n.at))}<br>${esc(n.text)}</div>`).join('')}` : ''}</div>` : ''}
      ${done ? '' : `<div class="form" data-case-form="${c.id}">
        <h4>Take action</h4>
        <input class="field" type="text" placeholder="Add a note (optional)" aria-label="Note">
        ${st.workOrder ? '' : `<div class="seg" role="group" aria-label="Priority for maintenance">${['P1', 'P2', 'P3'].map((p) => `<button type="button" data-prio="${p}" aria-pressed="${(p === 'P1' && c.priority === 'critical') || (p === 'P2' && c.priority !== 'critical')}">${{ P1: 'P1 · Today', P2: 'P2 · 48 h', P3: 'P3 · Next service' }[p]}</button>`).join('')}</div>`}
        <div class="btns">
          ${st.workOrder ? '' : '<button class="btn primary" data-do="escalate">Send to maintenance</button>'}
          <button class="btn" data-do="case_note">Add note</button>
          <button class="btn ok" data-do="resolve">Mark resolved</button>
        </div></div>`}
    </div>` : ''}
  </article>`;
}

// ---------- Maintenance ----------
function maintenance() {
  const m = DATA.metrics;
  const list = DATA.workOrders.filter((w) => (TAB === 'done' ? w.status === 'Closed' : w.status !== 'Closed'));
  const tiles = `<section class="tiles">
    <div class="tile glass ${m.pending ? 'warn' : 'good'}"><div class="k">Waiting for approval</div><div class="v">${m.pending}</div><div class="s">from Ops & Safety</div></div>
    <div class="tile glass"><div class="k">Approved</div><div class="v">${m.approved}</div><div class="s">${m.withEta} with an ETA</div></div>
    <div class="tile glass"><div class="k">Actions taken</div><div class="v">${m.workflowActions}</div><div class="s">approvals, ETAs, notes</div></div>
  </section>`;
  const head = TAB === 'done' ? heading('Closed', 'Completed work orders from the shop system.') : heading('Work orders', 'Approve new requests, set when they’ll be done, and leave notes. Ops and Safety see your updates.');
  return head + (TAB === 'done' ? '' : tiles) + (list.length ? `<div class="list">${list.map(woCard).join('')}</div>` : '<div class="empty glass">No work orders here.</div>');
}

function woCard(w) {
  const open = OPEN.has(w.wo_id);
  const tone = w.priority ? { P1: 'critical', P2: 'high', P3: 'medium' }[w.priority] : (w.status === 'Closed' ? 'ok' : 'low');
  const closed = w.status === 'Closed';
  return `<article class="card glass ${tone} ${open ? 'open' : ''}" data-card="${esc(w.wo_id)}" tabindex="0" aria-expanded="${open}">
    <div class="row">
      <span class="badge">${w.priority || (closed ? '✓' : '•')}</span>
      <div class="grow">
        <div class="title">${esc(w.vehicle_id)} · ${esc(w.work_done)}</div>
        <div class="sub">${esc(w.wo_id)} · ${w.source === 'dashboard' ? 'from ' + esc(w.requestedBy) + ' · ' + esc(et(w.opened_local)) : 'shop system · opened ' + esc(w.opened_local)}</div>
        <div class="capsules"><span class="capsule ${w.status === 'Pending approval' ? 'high' : closed ? 'ok' : 'plain'}">${esc(w.status)}</span>${w.eta ? `<span class="capsule plain">ETA ${esc(fmtEta(w.eta))}</span>` : ''}</div>
      </div>
      <span class="chev">›</span>
    </div>
    ${open ? `<div class="detail">
      ${w.request ? `<div><h4>What Ops / Safety reported</h4><ol>${w.request.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>
        ${w.request.evidence.map((e) => `<div class="ev"><span class="when">${esc(e.when)} ET</span> · ${esc(e.reason)}</div>`).join('')}
        ${(w.request.history || []).map((e) => `<div class="ev"><span class="when">${esc(e.when)} ET</span> · ${esc(e.reason)}<div class="m">${esc(e.wo)}</div></div>`).join('')}
        ${w.request.notes.map((n) => `<div class="note"><b>${esc(n.by)}</b> · ${esc(n.text)}</div>`).join('')}</div>` : ''}
      ${w.technician_note ? `<div><h4>Technician note</h4><div class="ev">${esc(w.technician_note)}${w.closed_local ? `<div class="m">Closed ${esc(w.closed_local)}</div>` : ''}</div></div>` : ''}
      ${(w.notes || []).length ? `<div><h4>Notes</h4>${w.notes.map((n) => `<div class="note"><b>${esc(n.by)}</b> · ${esc(et(n.at))}<br>${esc(n.text)}</div>`).join('')}</div>` : ''}
      ${closed ? '' : `<div class="form" data-wo-form="${esc(w.wo_id)}">
        <h4>Update</h4>
        ${w.status === 'Pending approval' ? '<div class="btns"><button class="btn primary" data-do="approve_wo">Approve work order</button></div>' : ''}
        <label class="sub" for="eta-${esc(w.wo_id)}">Estimated completion</label>
        <div class="btns"><input class="field" style="flex:1" id="eta-${esc(w.wo_id)}" type="datetime-local" value="${esc(w.eta || '')}"><button class="btn" data-do="set_eta">Save ETA</button></div>
        <div class="btns"><input class="field" style="flex:1" type="text" placeholder="Note for Ops & Safety" aria-label="Note"><button class="btn" data-do="wo_note">Add note</button></div>
      </div>`}
    </div>` : ''}
  </article>`;
}

// ---------- Other views ----------
function lowMedium() {
  const f = filter;
  const types = [...new Set(DATA.lowMedium.map((a) => a.type))].sort();
  const list = DATA.lowMedium.filter((a) => (f.priority === 'all' || a.priority === f.priority) && (f.type === 'all' || a.type === f.type) && (f.depot === 'all' || a.depot === f.depot));
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return heading('Low & medium', 'Not urgent and not tied to a work order. Kept here so tonight’s list stays short. Good for weekly reviews.') +
    `<div class="filters">
      <select class="field" data-f="priority" aria-label="Priority">${opt('all', f.priority, 'All priorities')}${opt('medium', f.priority, 'Medium')}${opt('low', f.priority, 'Low')}</select>
      <select class="field" data-f="type" aria-label="Type">${opt('all', f.type, 'All types')}${types.map((t) => opt(t, f.type, cap(t.replace(/_/g, ' ')))).join('')}</select>
      <select class="field" data-f="depot" aria-label="Depot">${opt('all', f.depot, 'All depots')}${['North Yard', 'Airport Hub', 'Hamilton Depot'].map((d) => opt(d, f.depot, d)).join('')}</select>
    </div>
    <div class="rows glass">${list.slice(0, f.limit).map((a) => `<div class="r ${a.priority}"><span class="dot"></span><div class="grow"><div class="title" style="font-size:.92rem">${esc(a.reason)}</div><div class="sub">${esc(a.vehicle)} · ${esc(a.driver)} · ${esc(a.depot)} · ${esc(a.when)} ET</div></div><span class="capsule">${cap(a.priority)}</span></div>`).join('') || '<div class="r">No alerts match.</div>'}</div>
    ${list.length > f.limit ? `<button class="btn more" id="more">Show more (${list.length - f.limit})</button>` : ''}`;
}

function drivers() {
  const rows = DATA.drivers.slice(0, 20).map((d) => `<div class="r ${d.driver === 'D-17' ? 'flag' : ''}"><span class="badge" style="--tone:${d.seriousRank <= 5 ? 'var(--high)' : 'var(--low)'}">${d.seriousRank}</span>
    <div class="grow"><div class="title">${d.driver} <span class="sub">· ${d.vehicle} · firmware ${d.firmware}</span></div><div class="sub">${d.serious} serious events in ${d.km.toLocaleString()} km · raw count ${d.rawEvents} (rank ${d.rawRank})</div></div>
    <span class="num">${d.seriousPer100}<div class="sub">per 100 km</div></span></div>`).join('');
  const d17 = DATA.drivers.find((d) => d.driver === 'D-17');
  return heading('Drivers', 'Ranked by serious events (braking ≥ 0.6 g or over 115 km/h) per 100 km, so drivers who drive more or have more sensitive devices aren’t unfairly ranked.') +
    `<div class="context" style="margin-bottom:12px"><b>About D-17:</b> top of the raw count (${d17.rawEvents} events) because D-17 drives the most km (${d17.km.toLocaleString()}) on firmware 4.2.1, which logs about 5× more light braking. On serious events per 100 km, D-17 ranks #${d17.seriousRank} of ${DATA.drivers.length}.</div>
    <div class="rows glass">${rows}</div><p class="sub" style="text-align:center">Top 20 of ${DATA.drivers.length} drivers</p>`;
}

function activity() {
  const lede = DATA.user.role === 'maintenance' ? 'Updates on your work orders.' : 'Every escalation, note and resolution on your team’s cases. These count toward your metrics.';
  if (!DATA.log.length) return heading('Activity', lede) + '<div class="empty glass">No actions yet.</div>';
  const label = { escalate: 'Sent to maintenance', resolve: 'Resolved', case_note: 'Note', approve_wo: 'Approved', set_eta: 'ETA set', wo_note: 'Note' };
  return heading('Activity', lede) + `<div class="rows glass">${DATA.log.map((l) => `<div class="r"><div class="grow"><div class="title" style="font-size:.92rem">${label[l.action] || l.action} · ${esc(l.target)}</div><div class="sub">${esc(l.user)} · ${esc(et(l.at))}${l.detail ? ' · ' + esc(l.detail) : ''}</div></div></div>`).join('')}</div>`;
}

// ---------- Events ----------
function wire() {
  $('#signout').addEventListener('click', () => { USER = null; store('user', null); OPEN.clear(); load(); });
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { TAB = b.dataset.tab; store('tab', TAB); OPEN.clear(); render(); window.scrollTo({ top: 0 }); }));
  document.querySelectorAll('[data-card]').forEach((el) => {
    const toggle = (e) => {
      if (e.target.closest('.detail')) return;
      const id = el.dataset.card;
      OPEN.has(id) ? OPEN.delete(id) : OPEN.add(id);
      render();
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); toggle(e); } });
  });
  document.querySelectorAll('[data-prio]').forEach((b) => b.addEventListener('click', () => {
    b.parentElement.querySelectorAll('[data-prio]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  document.querySelectorAll('[data-case-form] [data-do]').forEach((b) => b.addEventListener('click', () => {
    const f = b.closest('[data-case-form]');
    const prio = f.querySelector('[data-prio][aria-pressed="true"]');
    act({ action: b.dataset.do, caseId: f.dataset.caseForm, note: f.querySelector('input').value.trim(), priority: prio?.dataset.prio });
  }));
  document.querySelectorAll('[data-wo-form] [data-do]').forEach((b) => b.addEventListener('click', () => {
    const f = b.closest('[data-wo-form]');
    act({ action: b.dataset.do, woId: f.dataset.woForm, eta: f.querySelector('input[type=datetime-local]').value, note: f.querySelector('input[type=text]').value.trim() });
  }));
  document.querySelectorAll('.filters select').forEach((s) => s.addEventListener('change', () => { filter[s.dataset.f] = s.value; filter.limit = 60; render(); }));
  const more = $('#more'); if (more) more.addEventListener('click', () => { filter.limit += 120; render(); });
}

load();
