'use strict';
/* PowerStats on the phone (V3). This file is the phone's shell: it unlocks the grades the Mac uploads (data.json,
   locked with Sam's code), keeps them fresh, and handles the Home Screen icon and notifications. The screens are
   phone.js (PSPhone: three tabs and sheets), built from core.js's pieces (PSCore, shared with the Mac app); the math
   is engine.js (PSMath). Settings are saved on this phone only; nothing here can change Schoology. */
const $ = (s, el = document) => el.querySelector(s);
const LS_KEY = 'ps.key', LS_ENV = 'ps.env', LS_PUSH = 'ps.push';
const REFRESH_MS = 10 * 60e3;
// this copy's version (the ?v= stamps on its style sheet and scripts, in page order); data.json says which version
// the website has now, so a Home Screen app that's been open a while reloads once when there's a newer one
const SITE_VER = [...document.querySelectorAll('link[rel=stylesheet][href*="?v="], script[src*="?v="]')]
  .map(x => (x.getAttribute('href') || x.getAttribute('src')).split('?v=')[1]).join('.');

/* ---------------- storage ---------------- */
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function writeJSON(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
const state = { env: null, bits: null, snap: null, busy: false, lastCheck: 0 };
// "now", which testing can move to another day (localStorage 'ps.today' = 'YYYY-MM-DD'; never set in normal use)
const FAKE_DAY = (() => { try { return localStorage.getItem('ps.today'); } catch (e) { return null; } })();
function now() {
  const t = new Date();
  if (!FAKE_DAY) return t;
  const [y, m, d] = FAKE_DAY.split('-').map(Number);
  return new Date(y, m - 1, d, t.getHours(), t.getMinutes());
}

/* ---------------- the lock (the same as powerstats.py's seal) ---------------- */
const te = new TextEncoder(), td = new TextDecoder();
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function b64e(u) { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
const norm = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function joinBytes(...parts) {
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}
async function derive(code, env) {
  const base = await crypto.subtle.importKey('raw', te.encode(norm(code)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(env.salt), iterations: env.rounds }, base, 512));
}
async function unlock(env, bits) {
  const salt = b64d(env.salt), iv = b64d(env.iv), ct = b64d(env.ct);
  const mk = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('HMAC', mk, b64d(env.mac), joinBytes(te.encode(`ps1:${env.rounds}:`), salt, iv, ct))) throw new Error('code');
  const ek = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-CBC' }, false, ['decrypt']);
  return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ek, ct)));
}
function savedBits(env) {
  const k = readJSON(LS_KEY);
  return k && env && k.salt === env.salt && k.rounds === env.rounds ? b64d(k.bits) : null;
}
async function fetchEnv() {
  const r = await fetch('data.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const env = await r.json();
  if (env.app !== 'powerstats') throw new Error('not a PowerStats file');
  return env;
}

/* ---------------- the Home Screen icon ----------------
   iOS gives a Home Screen app its own storage, separate from Safari's, so a code typed in Safari isn't known there.
   So once this page is unlocked in Safari (with "Remember on this phone"), its Home Screen link carries the key after
   "#" (that part of a link stays on the phone and is never sent anywhere): the icon opens unlocked. The key is what
   the code turns into, never the code. The same as Claude Fantasy's phone app. */
const STANDALONE = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const toUrl64 = s => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); return s + '='.repeat((4 - s.length % 4) % 4); };
(() => {  // #k=<key>&s=<salt>&r=<rounds> from the Home Screen link, kept in this app's own storage
  const q = new URLSearchParams(location.hash.slice(1));
  if (!q.get('k') || !q.get('s')) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (!readJSON(LS_KEY)) writeJSON(LS_KEY, { salt: fromUrl64(q.get('s')), rounds: +q.get('r') || 600000, bits: fromUrl64(q.get('k')) });
})();
// Safari reads the Home Screen settings (the manifest) once, when the page loads, so the link is chosen right here:
// with the key if this Safari remembers it, otherwise the plain one (and the page reloads once after unlocking).
const KEYED = (() => {
  const k = readJSON(LS_KEY), base = new URL('./', location.href).href;
  let href = 'manifest.webmanifest';
  if (k && !STANDALONE) {
    href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify({
      id: base, name: 'PowerStats', short_name: 'PowerStats', description: 'Sam’s grades: every class, what-ifs and the path to 90%',
      start_url: `${base}#k=${toUrl64(k.bits)}&s=${toUrl64(k.salt)}&r=${k.rounds}`, scope: base, display: 'standalone',
      background_color: '#0b0c0f', theme_color: '#0b0c0f',
      icons: [{ src: base + 'icon-180.png', sizes: '180x180', type: 'image/png' },
        { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }));
  }
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = href;
  document.head.appendChild(link);
  return href !== 'manifest.webmanifest';
})();

/* ---------------- start, unlock, refresh ---------------- */
function lockMsg(text, good) { const m = $('#lock-msg'); m.textContent = text || ''; m.classList.toggle('ok', !!good); }
function showLock(msg) {
  PSPhone.closeSheet();
  $('#app').hidden = true; $('#lock').hidden = false;
  lockMsg(msg || '');
}
const HOST = {
  place: 'phone',
  get: k => readJSON('ps.' + k),
  set: (k, v) => writeJSON('ps.' + k, v),
  now,
  onRender: freshTime,
  act: (name, el) => {
    if (name === 'fresh') { refresh(true); return true; }
    if (name === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
    if (name === 'push-on') { pushOn(); return true; }
    if (name === 'push-off') { pushOff(); return true; }
    if (name === 'forget') {
      writeJSON(LS_KEY, null); writeJSON(LS_ENV, null); state.bits = null; state.snap = null;
      showLock('Locked. Type your code to open PowerStats.');
      return true;
    }
    return false;
  },
  extraSettings: () => `<h4 class="h4">This phone</h4>${pushRow()}
    <div class="set"><div class="main">Lock PowerStats<small>Forgets the code here; you’ll type it again</small></div><button class="btn sm" data-act="forget">Lock</button></div>`,
};
function freshTime() {
  const s = state.snap;
  if (!s) return;
  const t = s.checked || s.at, f = $('#fresh');
  $('#fresh-t').textContent = PSCore.fmt.synced(t).replace(/^yesterday /, 'Yest. ');  // short, so the top bar fits
  // v5.1: stale once 3 hours of school-day check time pass with no check (PSCore.paused), not after 30 hours
  const pz = PSCore.paused();
  f.classList.toggle('stale', !!pz);
  const box = $('#paused');
  if (box) { box.innerHTML = PSCore.pausedNote(); box.hidden = !pz; }
  f.setAttribute('aria-label', `Checked Schoology ${PSCore.fmt.synced(t)}${pz ? ', grade checks paused' : ''}. Tap to look for new grades`);
}
async function boot() {
  $('#lock-form').addEventListener('submit', onUnlock);
  $('#eye').addEventListener('click', () => {
    const c = $('#code'), show = c.type === 'password';
    c.type = show ? 'text' : 'password'; $('#eye').textContent = show ? 'Hide' : 'Show';
  });
  for (const el of document.querySelectorAll('[data-version]')) el.textContent = window.PS_VERSION || '';  // version.js
  PSPhone.init(HOST);
  if (!window.crypto || !crypto.subtle) { showLock('This browser can’t unlock PowerStats. Open the link in Safari.'); return; }
  const cached = readJSON(LS_ENV), bits = savedBits(cached);
  if (cached && bits) {
    try { state.env = cached; state.bits = bits; show(await unlock(cached, bits)); } catch (e) { /* fetch below */ }
  }
  $('#lock-tip').hidden = STANDALONE;
  if (!state.snap) { showLock(); if (readJSON(LS_KEY)) lockMsg('Opening your grades…', true); }
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.lastCheck > 60e3) refresh(); });
  window.addEventListener('hashchange', () => { if (state.snap && PSPhone.openFromHash(location.hash)) history.replaceState(null, '', location.pathname + location.search); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
async function refresh(manual) {
  if (state.busy) return;
  state.busy = true;
  const f = $('#fresh'); f.classList.add('busy');
  try {
    const env = await fetchEnv();
    // a Home Screen app can stay open for days: when the website has a newer version, load it (once per version)
    if (env.site && SITE_VER && env.site !== SITE_VER) {
      let seen = null;
      try { seen = sessionStorage.getItem('ps.reloaded'); sessionStorage.setItem('ps.reloaded', env.site); } catch (e) { /* private mode */ }
      if (seen !== env.site) { location.reload(); return; }
    }
    state.lastCheck = Date.now();
    if (state.snap && state.env && env.iv === state.env.iv) { if (manual) PSPhone.toast(`Up to date · checked ${PSCore.fmt.synced(state.snap.checked || state.snap.at)}`); return; }
    const bits = state.bits && state.env && state.env.salt === env.salt ? state.bits : savedBits(env);
    state.env = env;
    if (bits) {
      try {
        const snap = await unlock(env, bits);
        state.bits = bits;
        if (readJSON(LS_KEY)) writeJSON(LS_ENV, env);
        const fresh = state.snap && snap.at !== state.snap.at;
        show(snap);
        if (fresh || manual) PSPhone.toast(fresh ? `New grades from ${PSCore.fmt.synced(snap.at)}` : `Up to date · checked ${PSCore.fmt.synced(snap.checked || snap.at)}`);
        return;
      } catch (e) { writeJSON(LS_KEY, null); state.bits = null; }
    }
    if (state.snap) { state.snap = null; showLock('The code changed. Type the new one.'); }
    else lockMsg('');  // no saved key fits these grades: the code has to be typed
  } catch (e) {
    if (!state.snap) lockMsg('Can’t reach PowerStats right now. Check the connection and try again.');
    else if (manual) PSPhone.toast('Offline: showing the last copy');
  } finally {
    state.busy = false;
    f.classList.remove('busy');
    freshTime();  // v5.1: the paused note follows the clock even when nothing new came in
  }
}
async function onUnlock(ev) {
  ev.preventDefault();
  const code = $('#code').value;
  if (norm(code).length < 4) { lockMsg('Type your PowerStats code.'); return; }
  const go = $('#go');
  go.disabled = true; go.textContent = 'Unlocking…'; lockMsg('');
  try {
    const env = state.env || await fetchEnv();
    state.env = env;
    const bits = await derive(code, env);
    let snap;
    try { snap = await unlock(env, bits); } catch (e) {
      const card = $('#lock-form'); card.classList.remove('bad'); void card.offsetWidth; card.classList.add('bad');
      lockMsg('That code didn’t work. Capitals, spaces and dashes don’t matter.');
      return;
    }
    state.bits = bits;
    const keep = $('#remember').checked;
    if (keep) { writeJSON(LS_KEY, { salt: env.salt, rounds: env.rounds, bits: b64e(bits) }); writeJSON(LS_ENV, env); }
    $('#code').value = '';
    $('#code').blur();  // put the keyboard away first, or the iPhone can leave the page pushed down
    show(snap);
    window.scrollTo(0, 0);
    if (keep && !STANDALONE && !KEYED) setTimeout(() => location.reload(), 400);  // so Add to Home Screen gets the key
  } catch (e) {
    lockMsg('Can’t reach PowerStats right now. Check the connection and try again.');
  } finally { go.disabled = false; go.textContent = 'Unlock'; }
}
function show(snap) {
  const first = !state.snap;
  state.snap = snap;
  $('#lock').hidden = true; $('#app').hidden = false;
  PSPhone.show(snap);
  if (first && location.hash && PSPhone.openFromHash(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  pushCheck();  // also re-sends a subscription the Mac hasn't picked up yet
}

/* ---------------- notifications (push.py on the Mac) ---------------- */
// The phone asks iOS, subscribes with the Mac's public key, locks the subscription with the code (the same lock as
// the grades, the other way round) and drops it in the private inbox named inside the locked copy. The Mac picks it up
// at its next grade check and lists the phone in snap.push.on. Until then this phone re-sends it (at most hourly).
const push = { st: 'checking', err: '' };
const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
async function subId(ep) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(ep))); return Array.from(h.slice(0, 6), b => b.toString(16).padStart(2, '0')).join(''); }
async function sealUp(obj) {
  const env = state.env, bits = state.bits, salt = b64d(env.salt), iv = crypto.getRandomValues(new Uint8Array(16));
  const ek = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-CBC' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, ek, te.encode(JSON.stringify(obj))));
  const mk = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', mk, joinBytes(te.encode(`ps1:${env.rounds}:`), salt, iv, ct)));
  return { app: 'powerstats-push', v: 1, rounds: env.rounds, salt: env.salt, iv: b64e(iv), ct: b64e(ct), mac: b64e(mac) };
}
const devName = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Browser';
async function tellMac(sub, on) {
  const pu = (state.snap || {}).push;
  if (!pu || !state.bits) throw new Error('locked');
  const j = sub.toJSON ? sub.toJSON() : sub;
  const r = await fetch('https://ntfy.sh/' + encodeURIComponent(pu.inbox), { method: 'POST', body: JSON.stringify(await sealUp({ sub: j, on, name: devName(), at: Date.now() })) });
  if (!r.ok) throw new Error('inbox ' + r.status);
  writeJSON(LS_PUSH, { id: await subId(j.endpoint), sent: Date.now(), on });
}
async function pushCheck() {
  const pu = (state.snap || {}).push;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!pu || !pu.key) push.st = 'none';
  else if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) push.st = ios && !STANDALONE ? 'need-home' : 'unsupported';
  else if (Notification.permission === 'denied') push.st = 'blocked';
  else {
    try {
      const reg = await withTimeout(navigator.serviceWorker.ready, 10e3);
      const sub = await withTimeout(reg.pushManager.getSubscription(), 10e3);
      if (!sub || Notification.permission !== 'granted') push.st = 'off';
      else {
        const id = await subId(sub.endpoint);
        if ((pu.on || []).includes(id)) push.st = 'on';
        else {
          push.st = 'pending';
          const last = readJSON(LS_PUSH) || {};
          if (last.id !== id || Date.now() - (last.sent || 0) > 3600e3) await tellMac(sub, true).catch(() => {});
        }
      }
    } catch (e) { push.st = 'error'; push.err = 'This phone didn’t answer. Close PowerStats and open it again.'; }
  }
  const el = $('#push-row'); if (el) el.outerHTML = pushRow();
}
async function pushOn() {
  push.st = 'working'; push.err = ''; let el = $('#push-row'); if (el) el.outerHTML = pushRow();
  try {
    if (await withTimeout(Notification.requestPermission(), 60e3) !== 'granted') { await pushCheck(); return; }
    const reg = await withTimeout(navigator.serviceWorker.ready, 10e3);
    const sub = (await withTimeout(reg.pushManager.getSubscription(), 10e3))
      || await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(state.snap.push.key) }), 20e3);
    await tellMac(sub, true);
    await pushCheck();
  } catch (e) {
    push.st = 'error'; push.err = 'Couldn’t turn them on: ' + (e && e.message === 'timeout' ? 'the phone didn’t answer' : (e && e.message) || 'unknown problem') + '. Try again.';
    el = $('#push-row'); if (el) el.outerHTML = pushRow();
  }
}
async function pushOff() {
  try {
    const reg = await withTimeout(navigator.serviceWorker.ready, 10e3), sub = await withTimeout(reg.pushManager.getSubscription(), 10e3);
    if (sub) { await tellMac(sub, false).catch(() => {}); await sub.unsubscribe(); }
  } catch (e) { /* already off */ }
  writeJSON(LS_PUSH, null); await pushCheck(); PSPhone.toast('Notifications are off');
}
function pushRow() {
  const st = push.st, b = (act, label, pri) => `<button class="btn sm${pri ? ' go' : ''}" data-act="${act}">${label}</button>`;
  if (st === 'none') return '<div id="push-row"></div>';
  const [text, btn] = {
    checking: ['Checking this phone…', ''],
    working: ['Waiting for your answer (iPhone asks once)…', ''],
    'need-home': ['Needs the Home Screen app: Share → Add to Home Screen, open it from there, then turn them on here.', ''],
    unsupported: ['This browser can’t get notifications. Use the Home Screen app on your iPhone.', ''],
    blocked: ['Blocked. Turn them on in iPhone Settings → Notifications → PowerStats.', ''],
    off: ['New grades, and what’s due (mornings and evenings).', b('push-on', 'Turn on', true)],
    pending: ['<span class="warn">Almost on:</span> your Mac turns them on at its next grade check, then sends a welcome.', b('push-off', 'Cancel')],
    on: ['<span class="pos">✓ On.</span> New grades, and what’s due (mornings and evenings).', b('push-off', 'Turn off')],
    error: [`<span class="warn">${PSCore.fmt.esc(push.err)}</span>`, b('push-on', 'Try again', true)],
  }[st] || ['', ''];
  return `<div class="set" id="push-row"><div class="main">Notifications<small>${text.includes('<span') ? text : PSCore.fmt.esc(text)}</small></div>${btn}</div>`;
}

boot();
