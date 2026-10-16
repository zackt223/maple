const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
process.env.STATE_FILE = path.join(os.tmpdir(), `maple-test-state-${process.pid}.json`);
const { run, classify, dedupe, RULES } = require('../src/triage');
const { handleAction, USERS } = require('../src/server');

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
  assert.equal(r.quality.rawAlerts, 2370);
  assert.equal(r.quality.duplicates, 134);
  assert.equal(r.quality.uniqueAlerts, 2236);
});

test('V-137 is the #1 case: P0524 after the sensor repair', () => {
  const top = r.cases[0];
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
  const [code, data] = handleAction(USERS['ops.manager'], { action: 'escalate', caseId, priority: 'P1', note: 'ground it' });
  assert.equal(code, 200);
  const wo = data.workOrders.find((w) => w.caseId === caseId);
  assert.equal(wo.status, 'Pending approval');
  assert.equal(handleAction(USERS['ops.manager'], { action: 'approve_wo', woId: wo.wo_id })[0], 403);
  assert.equal(handleAction(USERS['maint.lead'], { action: 'approve_wo', woId: wo.wo_id })[0], 200);
  assert.equal(handleAction(USERS['maint.lead'], { action: 'set_eta', woId: wo.wo_id, eta: '2026-09-22T12:00' })[0], 200);
  const [, after] = handleAction(USERS['maint.lead'], { action: 'wo_note', woId: wo.wo_id, note: 'Oil pump inspection' });
  assert.equal(after.metrics.escalated, 1);
  assert.equal(after.metrics.workflowActions, 4);
});
