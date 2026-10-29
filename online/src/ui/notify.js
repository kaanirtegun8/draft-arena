// Turn notifications: sound (Web Audio), vibration, title blink and a system
// notification through the service worker when the page is in the background.
let ctx = null;
let unlocked = false;

export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    // play a silent blip so iOS keeps the context usable
    const o = ctx.createOscillator(); const g = ctx.createGain();
    g.gain.value = 0.0001; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.01);
    unlocked = true;
  } catch { /* no audio */ }
}

export function chime(kind = 'turn') {
  if (!ctx || !unlocked) return;
  const notes = kind === 'turn' ? [880, 1175, 1568] : kind === 'goal' ? [523, 659, 784, 1047] : [660, 880];
  const t0 = ctx.currentTime;
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.16);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.16 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.3);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.32);
  });
}

let blink = null;
const baseTitle = document.title;
export function blinkTitle(text) {
  stopBlink();
  let on = false;
  blink = setInterval(() => { document.title = (on = !on) ? text : baseTitle; }, 900);
  const stop = () => { if (!document.hidden) stopBlink(); };
  document.addEventListener('visibilitychange', stop, { once: true });
}
export function stopBlink() { if (blink) clearInterval(blink); blink = null; document.title = baseTitle; }

export function notificationsSupported() { return 'Notification' in window && 'serviceWorker' in navigator; }
export function notificationState() { return notificationsSupported() ? Notification.permission : 'unsupported'; }

export async function requestNotifications() {
  unlockAudio();
  if (!notificationsSupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

let swReg = null;
export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { swReg = await navigator.serviceWorker.register('sw.js'); } catch { swReg = null; }
  return swReg;
}
export function swRegistration() { return swReg; }

export async function systemNotify(title, body, tag = 'draft-arena') {
  if (notificationState() !== 'granted') return;
  try {
    const reg = swReg || (await navigator.serviceWorker.getRegistration());
    if (reg) await reg.showNotification(title, { body, tag, renotify: true, icon: 'icon.svg', badge: 'icon.svg', vibrate: [200, 100, 200] });
    else new Notification(title, { body, tag });
  } catch { /* ignore */ }
}

export function alertTurn(text = 'Sıra sende! Oyuncunu seç.') {
  chime('turn');
  try { if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 400]); } catch { /* ignore */ }
  if (document.hidden) { blinkTitle('🔔 Sıra sende!'); systemNotify('Draft Arena · Sıra sende!', text, 'turn'); }
}

// Full-screen "SIRA SENDE!" splash: pops in, then shatters into dust (~1.6 s).
export function turnSplash(text = 'SIRA SENDE!') {
  try {
    const old = document.querySelector('.turn-splash');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.className = 'turn-splash';
    const word = document.createElement('div');
    word.className = 'ts-word';
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch === ' ' ? ' ' : ch;
      const ang = (Math.random() - 0.5) * 140;
      s.style.setProperty('--dx', `${(Math.random() - 0.5) * 520}px`);
      s.style.setProperty('--dy', `${(Math.random() - 0.65) * 520}px`);
      s.style.setProperty('--rot', `${ang}deg`);
      s.style.animationDelay = `${0.75 + i * 0.02}s`;
      word.appendChild(s);
    });
    wrap.appendChild(word);
    for (let i = 0; i < 46; i++) {
      const d = document.createElement('i');
      d.className = 'ts-dust';
      d.style.left = `${30 + Math.random() * 40}%`;
      d.style.top = `${42 + Math.random() * 16}%`;
      d.style.setProperty('--dx', `${(Math.random() - 0.5) * 700}px`);
      d.style.setProperty('--dy', `${(Math.random() - 0.6) * 600}px`);
      d.style.animationDelay = `${0.75 + Math.random() * 0.15}s`;
      wrap.appendChild(d);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 1900);
  } catch { /* ignore */ }
}
