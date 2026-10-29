// Tiny SVG line charts (form graph, points progression).
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/**
 * series: [{ label, color, points: [{x, y}] }]
 * opts: { yMin, yMax, height, xLabel(x), yTicks: [..], band: [lo, hi] }
 */
export function lineChart(series, opts = {}) {
  const W = 320, H = opts.height || 150, padL = 28, padR = 8, padT = 10, padB = 20;
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const xMin = Math.min(...xs, opts.xMin ?? Infinity), xMax = Math.max(...xs, opts.xMax ?? -Infinity);
  const yMin = opts.yMin ?? Math.min(...ys), yMax = opts.yMax ?? Math.max(...ys);
  const sx = (x) => padL + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - padL - padR);
  const sy = (y) => padT + (1 - (y - yMin) / Math.max(0.001, yMax - yMin)) * (H - padT - padB);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', class: 'chart' });
  if (opts.band) svg.appendChild(el('rect', { x: padL, y: sy(opts.band[1]), width: W - padL - padR, height: Math.max(0, sy(opts.band[0]) - sy(opts.band[1])), fill: 'currentColor', opacity: 0.06 }));
  for (const t of opts.yTicks || [yMin, (yMin + yMax) / 2, yMax]) {
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: sy(t), y2: sy(t), stroke: 'currentColor', 'stroke-opacity': 0.12 }));
    const tx = el('text', { x: padL - 4, y: sy(t) + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'currentColor', opacity: 0.6 });
    tx.textContent = Number.isInteger(t) ? t : t.toFixed(1);
    svg.appendChild(tx);
  }
  const xTicks = [...new Set(xs)].sort((a, b) => a - b);
  const step = Math.ceil(xTicks.length / 8);
  xTicks.forEach((x, i) => {
    if (i % step) return;
    const tx = el('text', { x: sx(x), y: H - 6, 'text-anchor': 'middle', 'font-size': 9, fill: 'currentColor', opacity: 0.6 });
    tx.textContent = opts.xLabel ? opts.xLabel(x) : x;
    svg.appendChild(tx);
  });
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    for (const p of s.points) {
      const c = el('circle', { cx: sx(p.x), cy: sy(p.y), r: 3.2, fill: s.color });
      const t = el('title', {}); t.textContent = `${s.label}: ${p.y}`; c.appendChild(t);
      svg.appendChild(c);
    }
  }
  return svg;
}
