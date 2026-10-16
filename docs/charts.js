// Small dependency-free SVG charts in the style of the reference: lime lines on smoked glass.
const Charts = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const day = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  let uid = 0;

  // Smooth path through points (Catmull-Rom → cubic Bézier).
  function smooth(pts) {
    if (pts.length < 2) return '';
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
    }
    return d;
  }

  function scale(values, h, pad) {
    const max = Math.max(1, ...values);
    const nice = Math.ceil(max / 5) * 5 || 5;
    return { y: (v) => pad + (h - pad * 2) * (1 - v / nice), max: nice };
  }

  // "Overview" card: one smooth lime line with a highlighted point and pill label.
  function line(series, key, { label = '', height = 170 } = {}) {
    const W = 420, H = height, P = 18, L = 28;
    const vals = series.map((s) => s[key]);
    const sc = scale(vals, H, P);
    const x = (i) => L + (W - L - 8) * (i / Math.max(1, series.length - 1));
    const pts = vals.map((v, i) => [x(i), sc.y(v)]);
    const peak = vals.indexOf(Math.max(...vals));
    const id = 'g' + ++uid;
    const ticks = [0, 0.5, 1].map((t) => Math.round(sc.max * t));
    const [px, py] = pts[peak];
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d7f23c" stop-opacity=".28"/><stop offset="1" stop-color="#d7f23c" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((t) => `<text x="0" y="${sc.y(t) + 4}" class="ax">${t}</text><line x1="${L}" x2="${W}" y1="${sc.y(t)}" y2="${sc.y(t)}" class="grid"/>`).join('')}
      <rect x="${px - 22}" y="${P}" width="44" height="${H - P * 2}" rx="10" class="band"/>
      <path d="${smooth(pts)} L${x(vals.length - 1)},${H - P} L${L},${H - P} Z" fill="url(#${id})"/>
      <path d="${smooth(pts)}" class="lime-line"/>
      <circle cx="${px}" cy="${py}" r="5" class="dot-hi"/>
      <g transform="translate(${Math.min(Math.max(px - 34, L), W - 70)},${Math.max(py - 34, 2)})"><rect width="68" height="22" rx="11" class="pill"/><text x="34" y="15" text-anchor="middle" class="pill-t">${vals[peak]} · ${day(series[peak].day)}</text></g>
    </svg>`;
  }

  // "General statistics" card: two lines with a lime diagonal hatch between them.
  function hatch(series, upperKey, lowerKey, { label = '', height = 230 } = {}) {
    const W = 760, H = height, P = 22, L = 34, B = 22;
    const up = series.map((s) => s[upperKey]), lo = series.map((s) => s[lowerKey]);
    const sc = scale(up, H - B, P);
    const x = (i) => L + (W - L - 12) * (i / Math.max(1, series.length - 1));
    const pu = up.map((v, i) => [x(i), sc.y(v)]), pl = lo.map((v, i) => [x(i), sc.y(v)]);
    const id = 'h' + ++uid;
    const peak = up.indexOf(Math.max(...up));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(sc.max * t));
    const area = `M${pu.map((p) => p.join(',')).join(' L')} L${pl.slice().reverse().map((p) => p.join(',')).join(' L')} Z`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)}">
      <defs><pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="10" fill="#d7f23c"/></pattern></defs>
      ${ticks.map((t) => `<text x="0" y="${sc.y(t) + 4}" class="ax">${t}</text>`).join('')}
      <path d="${area}" fill="url(#${id})" opacity=".9"/>
      <polyline points="${pu.map((p) => p.join(',')).join(' ')}" class="thin"/>
      <polyline points="${pl.map((p) => p.join(',')).join(' ')}" class="thin"/>
      ${pu.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="dot-lime"/>`).join('')}
      ${pl.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="dot-lime"/>`).join('')}
      <g transform="translate(${Math.min(pu[peak][0] - 30, W - 70)},${Math.max(pu[peak][1] - 32, 0)})"><rect width="60" height="24" rx="8" class="pill solid"/><text x="30" y="16" text-anchor="middle" class="pill-t dark">${up[peak]}</text></g>
      ${series.map((s, i) => (i % 2 === 0 || i === series.length - 1 ? `<text x="${x(i)}" y="${H - 4}" text-anchor="middle" class="ax">${day(s.day)}</text>` : '')).join('')}
    </svg>`;
  }

  // "Daily relative dominance" card: polar-area wedges sized by share.
  const WEDGE = ['#2f5a2a', '#4c3f6e', '#7a6a22', '#2b5d63', '#5b2f4a', '#3f6b3a', '#6a5a8a', '#8a7a2a', '#245a7a', '#6a3a2a'];
  function polar(parts, { label = '', size = 260 } = {}) {
    const total = parts.reduce((n, p) => n + p.value, 0) || 1;
    const max = Math.max(...parts.map((p) => p.value)) || 1;
    const cx = size / 2, cy = size / 2, R = size / 2 - 34;
    let a0 = -Math.PI / 2;
    const wedges = parts.map((p, i) => {
      const a1 = a0 + (p.value / total) * Math.PI * 2;
      const r = R * (0.45 + 0.55 * Math.sqrt(p.value / max));
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
      const mid = (a0 + a1) / 2;
      const lx = cx + (r + 14) * Math.cos(mid), ly = cy + (r + 14) * Math.sin(mid);
      const pct = Math.round((p.value / total) * 100);
      const out = `<path d="${d}" fill="${p.color || WEDGE[i % WEDGE.length]}" stroke="rgba(255,255,255,.25)" stroke-width="1"/>${pct >= 4 ? `<text x="${lx}" y="${ly}" text-anchor="${Math.cos(mid) > 0 ? 'start' : 'end'}" class="ax small">${esc(p.label)} ${pct}%</text>` : ''}`;
      a0 = a1;
      return out;
    });
    return `<svg viewBox="-40 0 ${size + 80} ${size}" class="chart" role="img" aria-label="${esc(label)}"><circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 4"/>${wedges.join('')}</svg>`;
  }

  // Thin horizontal bars (depot or cost comparisons).
  function bars(items, { format = (v) => v } = {}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return `<div class="hbars">${items.map((i) => `<div class="hb"><span class="hb-l">${esc(i.label)}</span><span class="hb-t"><span style="width:${(i.value / max) * 100}%;background:${i.color || 'var(--lime)'}"></span></span><span class="hb-v">${esc(format(i.value))}</span></div>`).join('')}</div>`;
  }

  return { line, hatch, polar, bars, day };
})();
