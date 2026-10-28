// Tiny DOM helpers (no framework).
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function toast(msg, kind = '') {
  const root = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, msg);
  root.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 4200 : 2600);
}

let sheetCloseCb = null;
export function openSheet(title, content, onClose) {
  closeSheet();
  const root = document.getElementById('sheet-root');
  const back = h('div', { class: 'sheet-backdrop', onclick: () => closeSheet() });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'grab' }),
    h('div', { class: 'row between' }, h('h2', null, title), h('button', { class: 'iconbtn', 'aria-label': 'Kapat', onclick: () => closeSheet() }, '✕')),
    content);
  root.append(back, sheet);
  sheetCloseCb = onClose || null;
  document.body.style.overflow = 'hidden';
  return sheet;
}
export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (!root || !root.firstChild) return;
  clear(root);
  document.body.style.overflow = '';
  const cb = sheetCloseCb; sheetCloseCb = null;
  if (cb) cb();
}

export function confirmSheet(title, message, okLabel = 'Onayla', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openSheet(title, h('div', null,
      h('p', { class: 'muted' }, message),
      h('div', { class: 'btns mt' },
        h('button', { class: 'btn', onclick: () => { finish(false); closeSheet(); } }, 'Vazgeç'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { finish(true); closeSheet(); } }, okLabel))), () => finish(false));
  });
}

export function ratingClass(r) {
  if (r >= 8) return 'rating r-hi';
  if (r >= 7) return 'rating r-good';
  if (r >= 6) return 'rating r-avg';
  return 'rating r-low';
}

export function condBar(v, width) {
  const cls = v >= 75 ? 'bar' : v >= 55 ? 'bar mid' : 'bar low';
  return h('div', { class: cls, style: width ? { width } : null, title: `Kondisyon ${Math.round(v)}` }, h('i', { style: { width: `${Math.max(0, Math.min(100, v))}%` } }));
}

export function seg(options, value, onChange) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', onclick: () => onChange(v) }, label)));
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
