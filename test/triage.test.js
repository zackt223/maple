const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
process.env.STATE_FILE = path.join(os.tmpdir(), `maple-test-state-${process.pid}.json`);
const { run, classify, dedupe, RULES } = require('../src/triage');
const { handleAction, apiData, USERS } = require('../src/server');

const r = run();
const ctx = { rules: RULES, dtc: { P0217: { urgency: 'Critical', meaning: 'over-temp' }, P0420: { urgency: 'Low', meaning: 'cat' } } };
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

test('unplugged: OTA window (23:00 ET = 03:00Z) suppressed, daytime high', () => {
  assert.equal(classify(alert({ alert_type: 'device_unplugged', event_time_utc: '2026-09-21T03:30:00Z' }), ctx).priority, 'suppressed');
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
  assert.equal(wos.length, 3, 'one per depot');
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
