// Pre-match automatic substitution rules.
export const RULE_TYPES = {
  fatigue: 'Kondisyon düşünce değiştir',
  minute: 'Belirli dakikada değiştir',
  losing: 'Geride isek değiştir',
  winning: 'Öndeysek değiştir',
  drawing: 'Berabereysek değiştir',
  yellow: 'Sarı kartlıyı değiştir',
};

const clampInt = (v, a, b, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };

export function sanitizeRules(rules) {
  return (rules || []).filter((r) => r && RULE_TYPES[r.type]).slice(0, 8).map((r) => {
    if (r.type === 'fatigue') return { type: r.type, threshold: clampInt(r.threshold, 30, 90, 60), fromMinute: clampInt(r.fromMinute, 46, 89, 60) };
    if (r.type === 'yellow') return { type: r.type, fromMinute: clampInt(r.fromMinute, 46, 89, 60) };
    const o = { type: r.type, minute: clampInt(r.minute, 46, 89, 65) };
    if (r.outId) o.outId = r.outId;
    if (r.inId) o.inId = r.inId;
    return o;
  });
}
