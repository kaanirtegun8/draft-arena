// Save / load. Works with any storage that has getItem/setItem/removeItem
// (localStorage in the browser, an in-memory map in tests).
import { DATA_VERSION } from './config.js';

export const SAVE_FORMAT = 'draft-arena-save';
export const SLOTS = ['auto', '1', '2', '3'];
const KEY = (slot) => `draftArena.save.${slot}`;

export function serialize(state) {
  return JSON.stringify({ format: SAVE_FORMAT, version: DATA_VERSION, savedAt: new Date().toISOString(), state });
}

export function deserialize(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('Kayıt dosyası okunamadı (JSON değil).'); }
  if (!obj || obj.format !== SAVE_FORMAT) throw new Error('Bu bir Draft Arena kaydı değil.');
  if (obj.version > DATA_VERSION) throw new Error('Kayıt daha yeni bir sürümle oluşturulmuş.');
  const s = obj.state;
  const required = ['seed', 'phase', 'managers', 'draft', 'playerState', 'schedule', 'matches', 'currentWeek'];
  for (const k of required) if (!(k in s)) throw new Error(`Kayıt eksik: ${k}`);
  if (!Array.isArray(s.managers) || s.managers.length !== 5) throw new Error('Kayıtta 5 menajer yok.');
  return s;
}

export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

export function saveToSlot(storage, slot, state) {
  const text = serialize(state);
  storage.setItem(KEY(slot), text);
  return text.length;
}

export function loadFromSlot(storage, slot) {
  const text = storage.getItem(KEY(slot));
  return text ? deserialize(text) : null;
}

export function slotInfo(storage, slot) {
  const text = storage.getItem(KEY(slot));
  if (!text) return null;
  try {
    const o = JSON.parse(text);
    const s = o.state;
    return { slot, savedAt: o.savedAt, name: s.name, phase: s.phase, week: s.currentWeek, picks: s.draft.picks.length };
  } catch { return { slot, broken: true }; }
}

export function deleteSlot(storage, slot) { storage.removeItem(KEY(slot)); }
