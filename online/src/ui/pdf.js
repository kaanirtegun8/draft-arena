// Season report as a PDF file: loads pdfmake on first use, builds the file and
// lets the player share it (WhatsApp etc.), save it or open it.
import { h, toast, openSheet, closeSheet } from './dom.js';
import { buildSeasonReport, reportDoc, reportFileName } from '../core/export.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12';
const SCRIPTS = [
  [`${CDN}/pdfmake.min.js`, 'sha384-UbICcZf4B6+FB/cmTNLOqZzUc40rHayX14EhEDfAnFhmte7yAAA7s081OeuC8VVT'],
  [`${CDN}/vfs_fonts.min.js`, 'sha384-nXUiXap6sIVQQCtbYdJPsTOTJwv3rZjOdv8Ckh+3udRCVp3YLpdgHnjpPHD/LaC0'],
];
let loading = null;

function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('PDF aracı yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.')); };
    document.head.appendChild(s);
  });
}

function loadPdfMake() {
  if (window.pdfMake && window.pdfMake.vfs) return Promise.resolve(window.pdfMake);
  if (!loading) {
    loading = SCRIPTS.reduce((p, [src, sri]) => p.then(() => loadScript(src, sri)), Promise.resolve())
      .then(() => window.pdfMake)
      .catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function makeBlob(pdfMake, doc) {
  return new Promise((resolve, reject) => {
    try {
      const r = pdfMake.createPdf(doc).getBlob(resolve);
      if (r && typeof r.then === 'function') r.then(resolve, reject);
    } catch (e) { reject(e); }
  });
}

// room: the live room or an archived season shaped like one.
export async function exportSeasonPdf(room, byId, { seasonNo, names } = {}) {
  toast('PDF hazırlanıyor…');
  const pdfMake = await loadPdfMake();
  const data = buildSeasonReport(room, byId, { seasonNo, names });
  const blob = await makeBlob(pdfMake, reportDoc(data));
  const name = reportFileName(data);
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/pdf' }) : null;
  const url = URL.createObjectURL(blob);
  const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const save = () => {
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  };
  // sharing needs a fresh tap (iOS), so the buttons live in a sheet
  openSheet('PDF hazır', h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, `${name} · ${Math.max(1, Math.round(blob.size / 1024))} KB`),
    canShare ? h('button', { class: 'btn block primary', onclick: async () => {
      try { await navigator.share({ files: [file], title: `${data.league} · ${data.seasonNo}. sezon` }); closeSheet(); } catch (e) { if (e && e.name !== 'AbortError') toast('Paylaşılamadı, "İndir" ile kaydedebilirsin.', 'err'); }
    } }, '📤 Paylaş (WhatsApp, Mail…)') : null,
    h('button', { class: `btn block ${canShare ? '' : 'primary'}`, onclick: save }, '⬇️ İndir'),
    h('button', { class: 'btn block ghost', onclick: () => window.open(url, '_blank') }, '👁️ Aç ve görüntüle')),
  () => setTimeout(() => URL.revokeObjectURL(url), 60000));
  return data;
}
