// JSON tree helpers that mimic Firebase Realtime Database semantics
// (multi-path updates, null deletes, empty objects disappear).
export function splitPath(path) { return String(path).split('/').filter(Boolean); }

export function getPath(tree, path) {
  let cur = tree;
  for (const k of splitPath(path)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

export function applyUpdates(tree, updates) {
  const root = tree && typeof tree === 'object' ? JSON.parse(JSON.stringify(tree)) : {};
  for (const [path, value] of Object.entries(updates)) {
    const keys = splitPath(path);
    if (!keys.length) continue;
    let cur = root;
    const stack = [];
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
      stack.push([cur, keys[i]]);
      cur = cur[keys[i]];
    }
    const last = keys[keys.length - 1];
    const v = normalize(value);
    if (v === null) delete cur[last]; else cur[last] = v;
    // prune empty parents
    for (let i = stack.length - 1; i >= 0; i--) {
      const [obj, k] = stack[i];
      if (obj[k] && typeof obj[k] === 'object' && !Object.keys(obj[k]).length) delete obj[k];
    }
  }
  return root;
}

// Arrays become index-keyed objects; null/undefined/empty values vanish (like RTDB).
function normalize(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { const n = normalize(x); if (n !== null) o[i] = n; });
    return Object.keys(o).length ? o : null;
  }
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const n = normalize(x); if (n !== null) o[k] = n; }
    return Object.keys(o).length ? o : null;
  }
  return v;
}
