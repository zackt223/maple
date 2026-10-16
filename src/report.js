// Command-line version of tonight's list: `npm run report`. Same rules as the dashboard.
const { run } = require('./triage');
const r = run();
const q = r.quality;
console.log(`Maple Freight: what needs attention (${r.generatedFor})`);
console.log(`${q.rawAlerts} raw alerts → ${q.duplicates} duplicates removed → ${q.uniqueAlerts} unique → ${r.cases.length} high/critical cases → top ${r.rules.dailyCapacity} tonight\n`);
for (const c of r.cases.filter((x) => x.tonight)) {
  console.log(`#${c.rank} [${c.priority.toUpperCase()}] ${c.title}  (${c.team}; ${c.vehicle}, ${c.driver}, ${c.depot}; last ${c.latestLocal} ET)`);
  if (c.workOrder) console.log(`    ${c.workOrder.note}`);
  console.log(`    → ${c.actions[0]}`);
}
const d17 = r.drivers.find((d) => d.driver === 'D-17');
console.log(`\nD-17: raw-count rank #${d17.rawRank}, serious-events-per-100-km rank #${d17.seriousRank} of ${r.drivers.length}`);
const ham = q.lateByDepot['Hamilton Depot'];
console.log(`Hamilton Depot: ${ham.lateOver1h}/${ham.total} alerts arrived >1 h late (max ${ham.maxLagH} h)`);
console.log(`Counts by priority: ${JSON.stringify(r.counts)}`);
