const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
process.env.STATE_FILE = path.join(os.tmpdir(), `maple-test-state-${process.pid}.json`);
const { run, classify, dedupe, RULES } = require('../src/triage');
const { handleAction, apiData, USERS } = require('../src/server');

const r = run();
const ctx = { rules: RULES, otaNights: { 'V-9': 5 }, dtc: { P0217: { urgency: 'Critical', meaning: 'over-temp' }, P0420: { urgency: 'Low', meaning: 'cat' } } };
const alert = (o) => ({ alert_type: 'speeding', value: '100', event_time_utc: '2026-09-21T15:00:00Z', posted_limit_kmh: '', ...o });

test('speeding: >115 high, <=115 medium', () => {
  assert.equal(classify(alert({ value: '116' }), ctx).priority, 'high');
  assert.equal(classify(alert({ value: '115' }), ctx).priority, 'medium');
});

test('harsh braking: >=0.6 g high', () => {
  assert.equal(classify(alert({ alert_type: 'harsh_braking', value: '0.6' }), ctx).priority, 'high');
  assert.equal(classify(alert({ alert_type: 'harsh_braking', value: '0.5' }), ctx).priority, 'medium');
  assert.equal(classify(alert({ alert_type: 'harsh_braking', value: '0.4' }), ctx).priority, 'low');
});

test('engine faults: severity from DTC reference, not vendor', () => {
  assert.equal(classify(alert({ alert_type: 'engine_fault', dtc_code: 'P0217', vendor_severity: 'MEDIUM' }), ctx).priority, 'critical');
  assert.equal(classify(alert({ alert_type: 'engine_fault', dtc_code: 'P0420', vendor_severity: 'HIGH' }), ctx).priority, 'high');
});

test('unplugged: update hour (23:00 ET = 03:00Z) is low (not hidden), repeated nightly is high, daytime high', () => {
  assert.equal(classify(alert({ alert_type: 'device_unplugged', vehicle_id: 'V-1', event_time_utc: '2026-09-21T03:30:00Z' }), ctx).priority, 'low');
  assert.equal(classify(alert({ alert_type: 'device_unplugged', vehicle_id: 'V-9', event_time_utc: '2026-09-21T03:30:00Z' }), ctx).priority, 'high');
  assert.equal(classify(alert({ alert_type: 'device_unplugged', event_time_utc: '2026-09-21T15:30:00Z' }), ctx).priority, 'high');
});

test('maintenance_due: negative km is not due', () => {
  assert.equal(classify(alert({ alert_type: 'maintenance_due', value: '-50' }), ctx).priority, 'suppressed');
  assert.equal(classify(alert({ alert_type: 'maintenance_due', value: '50' }), ctx).priority, 'high');
});

test('dedupe removes identical events with different alert_ids', () => {
  const a = alert({ alert_id: 'A-1', vehicle_id: 'V-1' });
  const { kept, dupes } = dedupe([a, { ...a, alert_id: 'A-2' }]);
  assert.equal(kept.length, 1); assert.equal(dupes.length, 1);
});

test('dataset: counts recompute', () => {
  assert.equal(r.quality.rawAlerts, 2380); // 2,370 export + 10 Hamilton backfill
  assert.equal(r.quality.duplicates, 134);
  assert.equal(r.quality.uniqueAlerts, 2246);
});

test('V-137 is critical: P0524 after the sensor repair', () => {
  const top = r.cases.find((c) => c.vehicle === 'V-137' && c.kind === 'engine');
  assert.equal(top.vehicle, 'V-137');
  assert.equal(top.priority, 'critical');
  assert.ok(top.recurred);
  assert.equal(top.history.length, 4); // four P0217 overheat events before the "fix"
});

test('resolved-by-WO alerts do not create cases (V-114 P0217 fixed by WO-5519)', () => {
  assert.ok(!r.cases.some((c) => c.vehicle === 'V-114' && c.kind === 'engine' && c.title.includes('P0217')));
});

test('D-17 tops raw counts but not normalized risk', () => {
  const d = r.drivers.find((x) => x.driver === 'D-17');
  assert.equal(d.rawRank, 1);
  assert.ok(d.seriousRank > 30);
});

test('tonight list is capped at daily capacity', () => {
  assert.equal(r.cases.filter((c) => c.tonight).length, RULES.dailyCapacity);
});

test('permissions: maintenance cannot escalate; ops cannot approve', () => {
  const caseId = r.cases[0].id;
  assert.equal(handleAction(USERS['maint.lead'], { action: 'escalate', caseId })[0], 403);
  assert.equal(handleAction(USERS['maint.lead'], { action: 'resolve', caseId })[0], 403);
  const [code] = handleAction(USERS['ops.manager'], { action: 'escalate', caseId, priority: 'P1', note: 'ground it' });
  assert.equal(code, 200);
  const wo = apiData(USERS['maint.lead']).workOrders.find((w) => w.caseId === caseId);
  assert.ok(wo.request.actions.length, 'maintenance sees what was reported');
  assert.equal(wo.status, 'Pending approval');
  assert.equal(handleAction(USERS['ops.manager'], { action: 'approve_wo', woId: wo.wo_id })[0], 403);
  assert.equal(handleAction(USERS['maint.lead'], { action: 'approve_wo', woId: wo.wo_id })[0], 200);
  assert.equal(handleAction(USERS['maint.lead'], { action: 'set_eta', woId: wo.wo_id, eta: '2026-09-22T12:00' })[0], 200);
  const [, after] = handleAction(USERS['maint.lead'], { action: 'wo_note', woId: wo.wo_id, note: 'Oil pump inspection' });
  assert.equal(after.metrics.approved, 1);
  assert.equal(apiData(USERS['ops.manager']).metrics.escalated, 1);
  assert.equal(apiData(USERS['ops.manager']).cases[0].linkedWo.eta, '2026-09-22T12:00', 'ops sees maintenance ETA on its case');
});

test('visibility: each role only receives its own data', () => {
  const ops = apiData(USERS['ops.manager']);
  const safety = apiData(USERS['safety.manager']);
  const maint = apiData(USERS['maint.lead']);
  assert.ok(!ops.workOrders && !safety.workOrders, 'ops/safety get no maintenance work-order board');
  assert.ok(!maint.cases && !maint.lowMedium && !maint.drivers, 'maintenance gets no ops/safety cases');
  assert.ok(ops.cases.every((c) => ['operations', 'maintenance'].includes(c.team)));
  assert.ok(safety.cases.every((c) => c.team === 'safety'));
  assert.ok(!ops.drivers, 'driver data is safety-only');
  assert.equal(apiData(undefined).cases, undefined, 'signed-out gets nothing but the user list');
});

test('safety cannot act on an ops case', () => {
  const opsCase = apiData(USERS['ops.manager']).cases[1].id;
  assert.equal(handleAction(USERS['safety.manager'], { action: 'case_note', caseId: opsCase, note: 'x' })[0], 403);
});

test('ops can bring in safety with a note; safety responds and can send to maintenance', () => {
  const ops = USERS['ops.manager'], safety = USERS['safety.manager'], maint = USERS['maint.lead'];
  const caseId = apiData(ops).cases.find((c) => c.vehicle === 'V-137' && c.kind === 'device').id;
  assert.equal(handleAction(ops, { action: 'refer_safety', caseId })[0], 400, 'note is required');
  assert.equal(handleAction(safety, { action: 'refer_safety', caseId, note: 'x' })[0], 403, 'only ops refers');
  assert.equal(handleAction(ops, { action: 'refer_safety', caseId, note: 'Daytime unplugs — talk to D-37?' })[0], 200);
  const ref = apiData(safety).referrals.find((r) => r.caseId === caseId);
  assert.equal(ref.status, 'Open');
  assert.equal(handleAction(safety, { action: 'referral_note', referralId: ref.id, note: 'Coaching D-37 at 7:00' })[0], 200);
  assert.equal(handleAction(safety, { action: 'escalate', caseId, priority: 'P2', note: 'Check harness' })[0], 200);
  const opsView = apiData(ops).cases.find((c) => c.id === caseId);
  assert.equal(opsView.referral.status, 'Actioned');
  assert.ok(opsView.referral.workOrder, 'ops sees the work order safety created');
  assert.ok(apiData(maint).workOrders.some((w) => w.caseId === caseId && w.requestedBy === 'Safety Manager'));
  assert.equal(handleAction(maint, { action: 'close_referral', referralId: ref.id })[0], 403);
});

test('safety advisory and firmware minimum create maintenance work orders', () => {
  const safety = USERS['safety.manager'], maint = USERS['maint.lead'];
  assert.equal(handleAction(safety, { action: 'advise_maintenance', vehicleId: 'V-142', note: 'Check brake sensor calibration', priority: 'P3' })[0], 200);
  assert.equal(handleAction(USERS['ops.manager'], { action: 'set_min_firmware', version: '4.3.0' })[0], 403);
  assert.equal(handleAction(safety, { action: 'set_min_firmware', version: '4.3.0' })[0], 200);
  const fw = apiData(safety).firmware;
  assert.equal(fw.belowMinimum.length, 36); // 24 on 4.1.8 + 12 on 4.2.1
  assert.equal(fw.compliant, 24);
  assert.equal(handleAction(safety, { action: 'request_firmware_update' })[0], 200);
  const wos = apiData(maint).workOrders.filter((w) => w.firmwareTarget === '4.3.0');
  assert.ok(wos.length >= 3, 'split by depot and phase');
  const veh = Object.fromEntries(apiData(safety).vehicles.map((v) => [v.id, v.firmware]));
  assert.ok(wos.every((w) => w.vehicles.every((id) => (veh[id] === '4.2.1') === (w.priority === 'P2'))), '4.2.1 first (P2), older versions P3');
  assert.equal(wos.reduce((n, w) => n + w.vehicles.length, 0), 36);
  assert.equal(apiData(safety).firmware.belowMinimum.every((v) => v.requested), true);
  assert.equal(handleAction(safety, { action: 'request_firmware_update' })[0], 409, 'no duplicate requests');
  assert.ok(!apiData(USERS['ops.manager']).firmware, 'firmware policy is a safety view');
});

test('Hamilton backfill: V-108 overheat + oil pressure is the top case; outage is a network case', () => {
  assert.equal(r.cases[0].vehicle, 'V-108');
  assert.equal(r.cases[0].priority, 'critical');
  assert.ok(r.cases[0].backfill);
  const net = r.cases.find((c) => c.id === 'C-NET-Hamilton-Depot');
  assert.ok(net && net.priority === 'critical' && /10 alerts held/.test(net.title));
  assert.ok(!r.cases.some((c) => c.id === 'C-NET-Airport-Hub'), 'Airport Hub had no delays');
  assert.equal(classify(alert({ value: '104', posted_limit_kmh: '60' }), ctx).priority, 'high', '44 over the limit is extreme');
});

test('business manager sees every team, read-only', () => {
  const admin = apiData(USERS['biz.admin']);
  assert.ok(admin.teams.operations.cases && admin.teams.safety.drivers && admin.teams.maintenance.workOrders);
  assert.equal(handleAction(USERS['biz.admin'], { action: 'case_note', caseId: r.cases[0].id, note: 'x' })[0], 403);
});

test('finance records and reviews costs; others cannot; maintenance never sees costs', () => {
  const fin = USERS['finance.lead'];
  const wo = apiData(fin).workOrders.find((w) => w.wo_id === 'WO-5540');
  assert.equal(wo.cost, null, 'no costs in the shop export');
  assert.equal(handleAction(USERS['ops.manager'], { action: 'record_cost', woId: 'WO-5540', parts: 80, labourHours: 1.5, labourRate: 120 })[0], 403);
  assert.equal(handleAction(fin, { action: 'record_cost', woId: 'WO-5540', parts: -1, labourHours: 1, labourRate: 1 })[0], 400);
  assert.equal(handleAction(fin, { action: 'record_cost', woId: 'WO-5540', parts: 80, labourHours: 1.5, labourRate: 120, invoice: 'INV-1' })[0], 200);
  assert.equal(apiData(fin).workOrders.find((w) => w.wo_id === 'WO-5540').cost.total, 260);
  assert.equal(handleAction(fin, { action: 'review_cost', woId: 'WO-5540', review: 'Verified' })[0], 200);
  assert.equal(handleAction(fin, { action: 'record_cost', woId: 'WO-5540', parts: 100, labourHours: 1.5, labourRate: 120 })[0], 200);
  const c = apiData(fin).workOrders.find((w) => w.wo_id === 'WO-5540').cost;
  assert.equal(c.history[0].total, 260, 'corrections keep history');
  assert.equal(c.review, 'Unreviewed', 'a corrected cost must be re-reviewed');
  assert.ok(apiData(USERS['maint.lead']).workOrders.every((w) => !('cost' in w)));
  assert.equal(handleAction(fin, { action: 'escalate', caseId: r.cases[0].id })[0], 403);
  assert.ok(apiData(USERS['biz.admin']).finance.total > 0, 'business manager sees costs');
});

test('delete rules: withdraw own pending request only; admin removes items raised in error', () => {
  const ops = USERS['ops.manager'], safety = USERS['safety.manager'], admin = USERS['biz.admin'];
  const c = apiData(ops).cases.find((x) => x.kind === 'engine' && !x.state);
  handleAction(ops, { action: 'escalate', caseId: c.id, priority: 'P2' });
  const woId = apiData(ops).cases.find((x) => x.id === c.id).linkedWo.id;
  assert.equal(handleAction(safety, { action: 'withdraw_wo', woId })[0], 403, "can't withdraw another team's request");
  assert.equal(handleAction(ops, { action: 'withdraw_wo', woId })[0], 200);
  assert.equal(apiData(ops).cases.find((x) => x.id === c.id).linkedWo, null);
  handleAction(ops, { action: 'escalate', caseId: c.id, priority: 'P2' });
  const wo2 = apiData(ops).cases.find((x) => x.id === c.id).linkedWo.id;
  handleAction(USERS['maint.lead'], { action: 'approve_wo', woId: wo2 });
  assert.equal(handleAction(admin, { action: 'delete_wo', woId: wo2 })[0], 409, 'approved work is not deleted');
  assert.equal(handleAction(admin, { action: 'delete_wo', woId: 'WO-5540' })[0], 404, 'shop records are never deleted');
  assert.equal(handleAction(USERS['maint.lead'], { action: 'delete_wo', woId: wo2 })[0], 403);
});

test('all-alerts explorer is available to ops, safety, finance and admin only', () => {
  for (const u of ['ops.manager', 'safety.manager', 'finance.lead', 'biz.admin']) assert.equal(apiData(USERS[u]).canSeeAllAlerts, true, u);
  assert.equal(apiData(USERS['maint.lead']).canSeeAllAlerts, false);
  assert.equal(r.allAlerts.length, 2246);
  assert.ok(r.allAlerts.every((a) => a.vehicleClass && a.firmware && a.driver && a.depot), 'every alert carries vehicle, driver and yard details');
});

test('ids are never reused after a delete', () => {
  const ops = USERS['ops.manager'];
  const [a, b] = apiData(ops).cases.filter((x) => x.kind === 'engine' && !x.state?.workOrder).slice(0, 2);
  handleAction(ops, { action: 'escalate', caseId: a.id });
  handleAction(ops, { action: 'escalate', caseId: b.id });
  const idA = apiData(ops).cases.find((x) => x.id === a.id).linkedWo.id;
  const idB = apiData(ops).cases.find((x) => x.id === b.id).linkedWo.id;
  handleAction(ops, { action: 'withdraw_wo', woId: idA });
  handleAction(ops, { action: 'escalate', caseId: a.id });
  const idA2 = apiData(ops).cases.find((x) => x.id === a.id).linkedWo.id;
  assert.notEqual(idA2, idB);
  assert.equal(apiData(ops).cases.find((x) => x.id === b.id).linkedWo.id, idB, 'existing work order untouched');
});

test('edge-case fixes', () => {
  const { tzOffsetMin, localStr } = require('../src/triage');
  assert.equal(tzOffsetMin(new Date('2026-09-21T12:00:00Z')), -240, 'EDT in September');
  assert.equal(tzOffsetMin(new Date('2026-11-05T12:00:00Z')), -300, 'EST after Nov 1');
  assert.equal(localStr('2026-11-05T15:00:00Z'), '2026-11-05 10:00');
  const v137 = r.cases.find((c) => c.vehicle === 'V-137' && c.kind === 'engine');
  assert.deepEqual(v137.movedAfter, ['10:40', '11:37'], 'V-137 was in use after being cleared');
  assert.ok(r.cases.find((c) => c.vehicle === 'V-158' && c.kind === 'engine').actions[0].includes('hold V-158 from the 6:00 a.m. dispatch'));
  assert.ok(r.cases.find((c) => c.vehicle === 'V-151' && c.kind === 'maintenance').actions[0].includes('too late'));
  const v118 = r.cases.find((c) => c.vehicle === 'V-118' && c.kind === 'device');
  assert.ok(v118 && /11 nights/.test(v118.title), 'nightly unplug pattern surfaced');
  const silent = r.cases.filter((c) => c.kind === 'silent');
  assert.ok(silent.length && silent.every((c) => !c.vehicle.includes('V-102')), 'quiet units flagged; V-102 is known out of service');
  assert.ok(r.allAlerts.every((a) => a.aiNote && a.aiNote.length > 10), 'every alert has an AI note');
  assert.ok(r.allAlerts.find((a) => a.vehicle === 'V-142').aiNote.includes("don't look for D-17 on V-117"));
  assert.ok(r.allAlerts.filter((a) => a.type === 'engine_fault' && !a.value).every((a) => a.aiNote.includes('No reading')));
  assert.ok(r.allAlerts.some((a) => /sent this 2 times/.test(a.aiNote)), 'duplicates explained');
  assert.ok(r.allAlerts.filter((a) => a.type === 'maintenance_due').every((a) => /latest value counts/.test(a.aiNote)));
});

test('network and reporting cases cannot be sent to the maintenance shop', () => {
  assert.equal(handleAction(USERS['ops.manager'], { action: 'escalate', caseId: 'C-NET-Hamilton-Depot' })[0], 400);
  const silent = r.cases.find((c) => c.kind === 'silent');
  assert.equal(handleAction(USERS['ops.manager'], { action: 'escalate', caseId: silent.id })[0], 400);
});

test('late data: each depot shows when it last sent data, and new data bumps the version the page checks', () => {
  assert.equal(r.quality.lastReceived['Hamilton Depot'], '2026-09-21 18:47', 'Hamilton backfill arrival');
  const { createCore } = require('../src/core');
  const core = createCore({ triage: r, loadState: () => null, saveState: () => {} });
  const v = core.version;
  core.setTriage(run());
  assert.equal(core.version, v + 1, 'page sees a new version and refreshes');
  assert.ok(core.apiData(USERS['ops.manager']).lastReceived, 'freshness is sent to the page');
});
