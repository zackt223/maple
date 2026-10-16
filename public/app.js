// Dashboard client. The server is the source of truth for permissions; this file only renders.
let DATA = null;
let USER = localGet('user') || 'ops.manager';
let TAB = localGet('tab') || 'tonight';
let lmFilter = { priority: 'all', type: 'all', depot: 'all', limit: 150 };

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const role = () => DATA.users[USER].role;
const can = (action) => DATA.permissions[role()].includes(action);
const et = (iso) => iso ? new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' ET' : '';
const teamLabel = { operations: 'Operations', safety: 'Safety', maintenance: 'Maintenance' };

async function load() {
  const r = await fetch('/api/data');
  DATA = await r.json();
  render();
}

async function act(payload) {
  const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': USER }, body: JSON.stringify(payload) });
  const out = await r.json();
  if (!r.ok) return toast(out.error, true);
  DATA = out;
  toast('Saved');
  render();
}

function toast(msg, error) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast'), 2200);
}

function segmented(el, items, current, onPick) {
  el.innerHTML = items.map(([id, label, count]) =>
    `<button role="tab" aria-selected="${id === current}" data-id="${id}">${esc(label)}${count != null ? `<span class="count">${count}</span>` : ''}</button>`).join('');
  // Respond on press, not release
  el.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', () => onPick(b.dataset.id)));
  el.querySelectorAll('button').forEach((b) => b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onPick(b.dataset.id); }));
}

function render() {
  $('#asof').textContent = `Export as of ${DATA.generatedFor} · next look before 6:00 a.m. dispatch`;
  segmented($('#userSeg'), Object.entries(DATA.users).map(([id, u]) => [id, u.name]), USER, (id) => { USER = id; localSet('user', id); render(); });
  const open = DATA.cases.filter((c) => c.state?.status !== 'resolved');
  const pendingWo = DATA.workOrders.filter((w) => w.status === 'Pending approval' || w.status === 'Open' || w.status === 'Scheduled' || w.status === 'Approved').length;
  segmented($('#tabSeg'), [
    ['tonight', 'Tonight', DATA.cases.filter((c) => c.tonight).length],
    ['backlog', 'High & critical backlog', open.filter((c) => !c.tonight).length],
    ['maintenance', 'Maintenance', pendingWo],
    ['lowmed', 'Low & medium', DATA.lowMedium.length],
    ['drivers', 'Drivers', null],
    ['log', 'Activity', DATA.log.length],
  ], TAB, (id) => { TAB = id; localSet('tab', id); render(); });
  renderMetrics();
  renderQuality();
  const v = $('#view');
  if (TAB === 'tonight') v.innerHTML = intro('Tonight’s 10', `Ops can act on about ${DATA.rules.dailyCapacity} things a day, so this is the ranked top ${DATA.rules.dailyCapacity} of ${DATA.cases.length} high/critical cases (grouped from ${DATA.counts.high + DATA.counts.critical} high/critical alerts). Work top-down.`) + cards(DATA.cases.filter((c) => c.tonight));
  if (TAB === 'backlog') v.innerHTML = intro('High & critical backlog', 'Everything high/critical that didn’t make tonight’s cut, ranked. Pull from here when the top 10 is done.') + cards(open.filter((c) => !c.tonight));
  if (TAB === 'maintenance') v.innerHTML = maintenance();
  if (TAB === 'lowmed') v.innerHTML = lowMedium();
  if (TAB === 'drivers') v.innerHTML = drivers();
  if (TAB === 'log') v.innerHTML = activity();
  wire();
}

const intro = (title, text) => `<h2>${title}</h2><p class="muted">${text}</p>`;

function renderMetrics() {
  const m = DATA.metrics;
  $('#metrics').innerHTML = `
    <div class="metric primary"><div class="label">Primary · resolved via dashboard</div><div class="value">${m.resolved}<span class="count">/ ${m.highCriticalSent}</span></div><div class="hint">high/critical cases closed here (${m.resolvedRate}%) · ${m.escalated} escalated to maintenance</div></div>
    <div class="metric ${m.guardrailBreached ? 'warn' : 'good'}"><div class="label">Guardrail · sent vs actioned</div><div class="value">${m.tonightCoveragePct}%</div><div class="hint">${m.tonightActioned} of tonight’s ${m.tonightQueue} actioned · ${m.casesActioned} of ${m.highCriticalSent} overall (${m.actionCoveragePct}%). ${m.guardrailBreached ? 'More sent than worked.' : 'Queue is being worked.'}</div></div>
    <div class="metric"><div class="label">Workflow actions taken</div><div class="value">${m.workflowActions}</div><div class="hint">escalations, approvals, ETAs, notes, resolutions</div></div>
    <div class="metric"><div class="label">Noise removed</div><div class="value">${m.rawAlerts.toLocaleString()} → ${m.tonightQueue}</div><div class="hint">raw alerts → ${m.highCriticalSent} cases → tonight’s list</div></div>`;
}

function renderQuality() {
  const q = DATA.quality;
  const ham = q.lateByDepot['Hamilton Depot'];
  const fw = q.firmware;
  const d17 = DATA.drivers.find((d) => d.driver === 'D-17');
  const el = $('#quality');
  const wasOpen = el.open;
  el.innerHTML = `<summary>Data checks: what I didn’t take at face value</summary><ul>
    <li><b>${q.duplicates} duplicate alerts</b> (same vehicle, type, time and value; different alert_id). The vendor says “exactly once”, but that’s not true. Removed, so ${q.rawAlerts} → ${q.uniqueAlerts}.</li>
    <li><b>Hamilton Depot data arrives late</b>: ${ham.lateOver1h} of ${ham.total} alerts landed more than 1 h after the event (max ${ham.maxLagH} h). Other depots: almost none. The vendor says connectivity is normal. Tonight’s Hamilton picture may be incomplete.</li>
    <li><b>Firmware 4.2.1 inflates harsh braking</b>: ${fw['4.2.1'].brakingPer100km} events/100 km vs ${fw['4.1.8'].brakingPer100km} (4.1.8) and ${fw['4.3.0'].brakingPer100km} (4.3.0). The excess is almost all 0.40–0.45 g. Driver ranking uses only ≥ 0.6 g braking and > 115 km/h, per 100 km.</li>
    <li><b>D-17 is not the worst driver.</b> D-17 is #${d17.rawRank} by raw count (${d17.rawEvents} events) only because of the most km (${d17.km}) on 4.2.1 firmware. On serious events per 100 km, D-17 ranks #${d17.seriousRank} of 60.</li>
    <li><b>Vendor severity is unreliable for engine faults</b>: ${q.criticalCodesMarkedBelowHigh} critical-code faults (P0217 overheating, P0524 oil pressure) were marked below HIGH, while ${q.lowCodesMarkedHigh} low-urgency P0420 emissions faults were marked HIGH. Severity here comes from the DTC reference, not the vendor.</li>
    <li><b>Speeding severity</b> ignores the vendor label (${q.speedingVendorDisagrees} alerts disagree with the 115 km/h rule). ${q.speedingNoPostedLimit} speeding alerts have no posted limit, so absolute speed is used.</li>
    <li><b>${q.suppressed} alerts suppressed</b>: unplug/camera alerts in the vendor’s 23:00–00:00 update window, and maintenance_due with negative km (not yet due).</li>
  </ul>`;
  el.open = wasOpen;
}

function cards(list) {
  if (!list.length) return '<p class="muted">Nothing here.</p>';
  return `<div class="cards">${list.map(card).join('')}</div>`;
}

function card(c) {
  const st = c.state || {};
  const done = st.status === 'resolved';
  const statusPill = st.status ? `<span class="pill ${done ? 'ok' : 'team'}">${esc(st.status)}${st.workOrder ? ' · ' + esc(st.workOrder) + ' ' + esc(st.priority) : ''}</span>` : '';
  const ev = c.evidence.map((e) => `<div class="ev"><b>${esc(e.when)}</b> — ${esc(e.reason)} <span class="vendor">· vendor said ${esc(e.vendor)}</span>${e.wo ? `<br><span class="muted">${esc(e.wo)}</span>` : ''}</div>`).join('');
  const hist = (c.history || []).map((e) => `<div class="ev"><b>${esc(e.when)}</b> — ${esc(e.reason)} <span class="vendor">· vendor said ${esc(e.vendor)}</span><br><span class="muted">${esc(e.wo)}</span></div>`).join('');
  const caseActions = can('escalate') ? `
    <div class="controls" data-case="${c.id}">
      <input type="text" placeholder="Note (optional for escalate)" aria-label="Note">
      <select aria-label="Priority"><option value="P1">P1 · today</option><option value="P2" selected>P2 · 48 h</option><option value="P3">P3 · next service</option></select>
      <button class="btn primary" data-do="escalate" ${st.workOrder ? 'disabled' : ''}>Escalate to maintenance</button>
      <button class="btn" data-do="case_note">Add note</button>
      <button class="btn ok" data-do="resolve" ${done ? 'disabled' : ''}>Mark resolved</button>
    </div>` : `<div class="controls"><span class="locked">Maintenance can’t change cases. Escalated ones appear in the Maintenance tab.</span></div>`;
  const lw = c.linkedWo;
  const woLine = lw ? `<div class="notes"><div><b>${esc(lw.id)}</b> · ${esc(lw.status)}${lw.eta ? ' · ETA ' + esc(lw.eta.replace('T', ' ')) : ' · no ETA yet'}</div>${(lw.notes || []).map((n) => `<div>🔧 <b>${esc(n.by)}</b> · ${esc(et(n.at))} — ${esc(n.text)}</div>`).join('')}</div>` : '';
  const notes = (st.notes || []).map((n) => `<div><b>${esc(n.by)}</b> · ${esc(et(n.at))} — ${esc(n.text)}</div>`).join('');
  return `<article class="card ${c.priority} ${done ? 'done' : ''}">
    <div class="card-head"><span class="rank">#${c.rank}</span><h3>${esc(c.title)}</h3>
      <span class="pill ${c.priority}">${c.priority}</span><span class="pill team">${teamLabel[c.team]}</span>${c.recurred ? '<span class="pill critical">after repair</span>' : ''}${statusPill}</div>
    <div class="meta">${esc(c.vehicle)} · ${esc(c.driver)} · ${esc(c.depot)} · last ${esc(c.latestLocal)} ET (${c.hoursAgo} h ago) · ${c.count} alert${c.count > 1 ? 's' : ''}${c.workOrder ? ' · ' + esc(c.workOrder.note) : ''}</div>
    <ol>${c.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>
    <details><summary>Evidence (${c.evidence.length}${hist ? ' + repair history' : ''})</summary>${ev}${hist ? '<p class="muted">Earlier faults the shop marked fixed:</p>' + hist : ''}</details>
    ${notes ? `<div class="notes">${notes}</div>` : ''}${woLine}
    ${caseActions}
  </article>`;
}

function maintenance() {
  const wos = DATA.workOrders;
  const rows = wos.map((w) => {
    const pr = w.priority ? { P1: 'critical', P2: 'high', P3: 'medium' }[w.priority] : (w.status === 'Closed' ? 'low' : 'medium');
    const ctrl = w.status === 'Closed' ? '' : can('approve_wo') ? `
      <div class="controls" data-wo="${esc(w.wo_id)}">
        ${w.status === 'Pending approval' ? '<button class="btn primary" data-do="approve_wo">Approve work order</button>' : ''}
        <input type="datetime-local" aria-label="Estimated completion" value="${esc(w.eta || '')}"><button class="btn" data-do="set_eta">Set ETA</button>
        <input type="text" placeholder="Note for ops & safety" aria-label="Note"><button class="btn" data-do="wo_note">Add note</button>
      </div>` : `<div class="controls"><span class="locked">Read-only for ${teamLabel[role()]}. Maintenance approves, sets ETAs and adds notes.</span></div>`;
    const notes = (w.notes || []).map((n) => `<div><b>${esc(n.by)}</b> · ${esc(et(n.at))} — ${esc(n.text)}</div>`).join('');
    return `<article class="card ${pr}">
      <div class="card-head"><span class="rank">${esc(w.wo_id)}</span><h3>${esc(w.vehicle_id)} · ${esc(w.work_done)}</h3>
        ${w.priority ? `<span class="pill ${pr}">${esc(w.priority)}</span>` : ''}<span class="pill ${w.status === 'Closed' ? 'ok' : 'team'}">${esc(w.status)}</span>
        <span class="pill team">${w.source === 'dashboard' ? 'Escalated by ' + esc(w.requestedBy) : 'Shop system'}</span></div>
      <div class="meta">Opened ${esc(w.source === 'dashboard' ? et(w.opened_local) : w.opened_local)}${w.closed_local ? ' · closed ' + esc(w.closed_local) : ''}${w.eta ? ' · <b>ETA ' + esc(w.eta.replace('T', ' ')) + '</b>' : ''}${w.approvedBy ? ' · approved by ' + esc(w.approvedBy) : ''}</div>
      ${w.technician_note ? `<p class="meta">${esc(w.technician_note)}</p>` : ''}
      ${notes ? `<div class="notes">${notes}</div>` : ''}
      ${ctrl}
    </article>`;
  }).join('');
  return intro('Maintenance work orders', 'Escalations from Operations and Safety land here as “Pending approval”, alongside the shop’s own work orders. Maintenance approves, sets an estimated completion time and leaves notes that Ops and Safety can follow.') + `<div class="cards">${rows}</div>`;
}

function lowMedium() {
  const f = lmFilter;
  const types = [...new Set(DATA.lowMedium.map((a) => a.type))].sort();
  const list = DATA.lowMedium.filter((a) => (f.priority === 'all' || a.priority === f.priority) && (f.type === 'all' || a.type === f.type) && (f.depot === 'all' || a.depot === f.depot));
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label || v}</option>`;
  return intro('Low & medium alerts', 'Not tied to any work order and not urgent. Kept out of the main queue so it stays workable. Use it for weekly coaching and trend checks.') +
    `<div class="filters" id="lmFilters">
      <select data-f="priority" aria-label="Priority">${opt('all', f.priority, 'All priorities')}${opt('medium', f.priority, 'Medium')}${opt('low', f.priority, 'Low')}</select>
      <select data-f="type" aria-label="Type">${opt('all', f.type, 'All types')}${types.map((t) => opt(t, f.type)).join('')}</select>
      <select data-f="depot" aria-label="Depot">${opt('all', f.depot, 'All depots')}${['North Yard', 'Airport Hub', 'Hamilton Depot'].map((d) => opt(d, f.depot)).join('')}</select>
      <span class="muted">${list.length} alerts</span></div>
    <div class="table-wrap"><table><thead><tr><th>Priority</th><th>When (ET)</th><th>Type</th><th>Vehicle</th><th>Driver</th><th>Depot</th><th>Detail</th><th>Vendor</th></tr></thead><tbody>
    ${list.slice(0, f.limit).map((a) => `<tr><td><span class="dot ${a.priority}"></span>${a.priority}</td><td>${esc(a.when)}</td><td>${esc(a.type)}</td><td>${esc(a.vehicle)}</td><td>${esc(a.driver)}</td><td>${esc(a.depot)}</td><td>${esc(a.reason)}</td><td>${esc(a.vendor)}</td></tr>`).join('')}
    </tbody></table></div>${list.length > f.limit ? '<p><button class="btn" id="lmMore">Show more</button></p>' : ''}`;
}

function drivers() {
  const rows = DATA.drivers.map((d) => `<tr class="${d.driver === 'D-17' ? 'flag' : ''}"><td class="num">${d.seriousRank}</td><td>${d.driver}</td><td>${d.vehicle}</td><td>${d.firmware}</td><td class="num">${d.km}</td><td class="num">${d.serious}</td><td class="num">${d.seriousPer100}</td><td class="num">${d.rawEvents}</td><td class="num">${d.rawRank}</td></tr>`).join('');
  return intro('Driver risk, normalized', 'Ranked by serious events (braking ≥ 0.6 g, speed > 115 km/h) per 100 km. Raw counts reward driving more and penalize firmware 4.2.1, so they’re shown only for comparison.') +
    `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Driver</th><th>Vehicle</th><th>Firmware</th><th>km (14 d)</th><th>Serious</th><th>Serious / 100 km</th><th>Raw events</th><th>Raw rank</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function activity() {
  if (!DATA.log.length) return intro('Activity', 'No workflow actions yet. Every escalation, approval, ETA, note and resolution is logged here and counts toward the metrics.');
  return intro('Activity', 'Latest 50 workflow actions.') + `<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>
    ${DATA.log.map((l) => `<tr><td>${esc(et(l.at))}</td><td>${esc(l.user)}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td><td>${esc(l.detail)}</td></tr>`).join('')}</tbody></table></div>`;
}

function wire() {
  document.querySelectorAll('[data-case] [data-do]').forEach((b) => b.addEventListener('click', () => {
    const box = b.closest('[data-case]');
    act({ action: b.dataset.do, caseId: box.dataset.case, note: box.querySelector('input').value.trim(), priority: box.querySelector('select').value });
  }));
  document.querySelectorAll('[data-wo] [data-do]').forEach((b) => b.addEventListener('click', () => {
    const box = b.closest('[data-wo]');
    act({ action: b.dataset.do, woId: box.dataset.wo, eta: box.querySelector('input[type=datetime-local]').value, note: box.querySelector('input[type=text]').value.trim() });
  }));
  document.querySelectorAll('#lmFilters select').forEach((s) => s.addEventListener('change', () => { lmFilter[s.dataset.f] = s.value; lmFilter.limit = 150; render(); }));
  const more = $('#lmMore'); if (more) more.addEventListener('click', () => { lmFilter.limit += 300; render(); });
}

load();
