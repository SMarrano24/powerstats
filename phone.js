'use strict';
/* PowerStats v10 on the phone: just the grade calculator (Sam, 2026-11-11: "make the phone app the grade calculator
   simply with the what assignment to do to bring it up"). One screen, no tabs:
     1. your average for the quarter and how far it is from your goal,
     2. what to do to bring it up: the assignments that raise it the most, in order, with your average after each,
     3. the calculator: tap a class for its grade, a slider on every assignment that isn't graded yet, and
        "Try a new grade" for one Schoology doesn't have yet.
   Tapping something slides a sheet up over the screen; pull it down (or tap ✕) to go back. The pieces inside (class
   details, sliders) are core.js (PSCore); the math is engine.js (PSMath); app.js is the shell (the lock, refreshing,
   notifications). The Mac app, the Team, the focus pages and the study room were retired in v10 (archive/2026-11-11). */
(function (root) {
  const C = root.PSCore, M = root.PSMath, F = C.fmt, esc = F.esc;
  const $ = (s, el = document) => el.querySelector(s);
  let H = null;
  const st = { stack: [], nw: {} };

  const ICON = {
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  };

  /* ---------------- the one screen ---------------- */
  function home() {
    const s = C.status();
    if (!s) return '<div class="card empty">No grades yet. They show up here as soon as Schoology has them.</div>' + foot();
    const sp = C.shownPeriod(), pid = sp.per.id;
    const pathTitle = s.final ? `Where ${esc(F.shortP(s.per))} lost points` : s.avg >= s.goal ? 'What keeps it up' : 'What to do to bring it up';
    let h = `<h1 class="sr">PowerStats: your grades</h1>
      <section class="calc-hero">${C.quarterSeg(false)}${C.avgBlock(s)}
        <button class="calc-how" data-act="average">How your average is figured ›</button></section>
      <section class="sec calc-path" id="path"><div class="sec-h"><h2>${pathTitle}</h2>${s.final ? '' : '<span>tap one to try a score</span>'}</div>${C.pathDetail()}</section>`;
    const list = C.courses().map(c => ({ c, g: C.grade(c, pid) }));
    const rows = list.filter(x => x.g != null).sort((a, b) => a.g - b.g).concat(list.filter(x => x.g == null));
    h += `<section class="sec"><div class="sec-h"><h2>Grade calculator</h2><span>tap a class to try scores</span></div>
      <div class="list clist">${rows.map(x => C.classRow(x.c, { pid })).join('')}</div></section>`;
    return h + foot();
  }
  function foot() {
    const s = C.snap, t = s.checked || s.at;
    return `<p class="foot">Checked Schoology ${esc(F.synced(t))}${s.at !== t ? ` · grades last changed ${esc(F.synced(s.at))}` : ''}.<br>PowerStats only reads Schoology; it can’t change anything.</p>`;
  }

  /* ---------------- "Try a new grade": one that isn't in Schoology yet ---------------- */
  // what it would do to the class and to your average, for a grade in any part of the class, worth any points
  function newGrade(c) {
    const sp = C.shownPeriod();
    if (!sp || sp.final || C.pidOf(c) !== sp.per.id || !c.periods.some(x => x.id === sp.per.id)) return '';
    const cats = c.cats.filter(k => !M.weighted(c) || k.w > 0);
    if (!cats.length) return '';
    const testy = cats.find(k => /test|assess|exam/i.test(k.name)) || cats[0];
    const n = st.nw[c.id] || (st.nw[c.id] = { cat: testy.id, m: 100, v: 90 });
    if (!cats.some(k => k.id === n.cat)) n.cat = testy.id;
    const pick = cats.length > 1 ? `<label class="nw-l">Counts in<select data-nw="cat" data-cid="${c.id}">${cats.map(k => `<option value="${esc(k.id)}"${k.id === n.cat ? ' selected' : ''}>${esc(k.name)}${M.weighted(c) ? ` (${F.pts(k.w)}%)` : ''}</option>`).join('')}</select></label>` : '';
    return `<section class="d-sec d-new"><h3>Try a new grade<span>one Schoology doesn’t have yet</span></h3><div class="try nw" data-nwbox="${c.id}">
      <div class="nw-row">${pick}<label class="nw-l">Worth<span class="nw-pts"><input type="number" inputmode="decimal" min="1" max="1000" step="1" value="${n.m}" data-nw="m" data-cid="${c.id}" aria-label="Points it's worth">points</span></label></div>
      <div class="try-h"><span>If you get</span><b class="num" data-nwo="v">${n.v}%</b></div>
      <input class="slider" type="range" min="0" max="100" step="1" value="${n.v}" style="--v:${n.v}%" data-nw="v" data-cid="${c.id}" aria-label="Score to try on the new grade">
      <div class="try-out"><div>${esc(c.short)}<b class="num" data-nwo="c"></b></div><div>Your average<b class="num" data-nwo="a"></b></div></div>
      <p class="needs" data-nwo="need"></p></div></section>`;
  }
  function updateNew(box) {
    const c = C.course(box.dataset.nwbox), sp = C.shownPeriod();
    if (!c || !sp) return;
    const pid = sp.per.id, n = st.nw[c.id];
    const m = Math.max(1, Math.min(1000, +n.m || 0)) || 100;
    const at = v => M.periodPct(c, pid, c.items.concat([{ id: '__new', t: 'New grade', p: pid, c: n.cat, s: v / 100 * m, m, f: '' }]));
    const before = C.grade(c, pid), after = at(n.v);
    const a0 = C.average(pid).pct, a1 = C.average(pid, { id: c.id, pct: after }).pct;
    const ok = x => x != null && isFinite(x);
    const diff = (a, b) => (ok(a) && ok(b) ? `<small class="${b - a > 0.004 ? 'pos' : b - a < -0.004 ? 'neg' : 'faint'}">${F.sgn(b - a)}</small>` : '');
    box.querySelector('[data-nwo=v]').textContent = `${n.v}%`;
    box.querySelector('[data-nwo=c]').innerHTML = `<span class="${F.gcls(after)}">${F.p(after)}</span>${diff(before, after)}`;
    box.querySelector('[data-nwo=a]').innerHTML = `<span class="${F.gcls(a1)}">${F.p(a1)}</span>${diff(a0, a1)}`;
    // the score this new grade needs to keep the class where it is, and to reach the next marks
    const need = t => { for (let v = 0; v <= 100; v++) if (at(v) >= t - 1e-9) return v; return null; };
    const bits = [];
    if (ok(before)) {
      const keep = need(before - 0.005);
      if (keep != null) bits.push(`<b>${keep}%</b> keeps ${F.p(before, 1)}`);
      const goal = +C.settings.goal || 90;
      const marks = [80, 85, 90, 93, 95].filter(x => x > before + 0.25).slice(0, 2);
      if (goal > before + 0.25 && !marks.includes(goal)) marks.push(goal);
      for (const t of marks.sort((a, b) => a - b)) {
        const v = need(t);
        if (v != null) bits.push(`<b>${v}%</b> for ${t}`);
        else { bits.push(`${t} is out of reach with this one (100% gets ${F.p(at(100), 1)})`); break; }
      }
    }
    box.querySelector('[data-nwo=need]').innerHTML = bits.length ? `On it: ${bits.join(' · ')}` : '';
    const sl = box.querySelector('input[data-nw=v]'); if (sl) sl.style.setProperty('--v', n.v + '%');
  }
  function fillNew(el) { for (const b of el.querySelectorAll('[data-nwbox]')) updateNew(b); }
  function onNew(el) {
    const n = st.nw[el.dataset.cid];
    if (!n) return;
    if (el.dataset.nw === 'cat') n.cat = el.value;
    else if (el.dataset.nw === 'm') { if (+el.value > 0) n.m = Math.min(1000, +el.value); else return; }
    else n.v = +el.value;
    updateNew(el.closest('[data-nwbox]'));
  }

  /* ---------------- drawing ---------------- */
  function draw(keep) {
    const view = $('#view');
    if (!view || !C.snap) return;
    const y = window.scrollY;
    view.innerHTML = `<div class="screen">${home()}</div>`;
    C.mountCharts(view);
    C.fillTries(view);
    C.a11y(view);
    if (keep) window.scrollTo(0, y);
    if (H.onRender) H.onRender();
  }

  /* ---------------- sheets: one at a time, over the screen ---------------- */
  function sheetContent(sh) {
    const c = sh.cid ? C.course(sh.cid) : null;
    if (sh.kind === 'class' && c) return { title: c.short, sub: c.name, body: C.classDetail(c, { extra: newGrade(c) }) };
    if (sh.kind === 'assignment' && c) {
      const i = c.items.find(j => String(j.id) === String(sh.id));
      if (i) {
        return { title: i.t, sub: c.short, body: C.assignmentDetail(c, i) + `<div class="sheet-btns"><button class="btn" data-act="open-class" data-cid="${c.id}">Open ${esc(c.short)}</button>
          <a class="btn" href="https://schoology.canisiushigh.org/assignment/${encodeURIComponent(i.id)}" target="_blank" rel="noopener">Open in Schoology</a></div>` };
      }
    }
    if (sh.kind === 'path') {
      const s = C.status();
      return { title: s && s.final ? `${F.shortP(s.per)} is over` : `Your path to ${F.pts(+C.settings.goal || 90)}`, sub: s ? s.per.name : '', body: C.pathDetail() };
    }
    if (sh.kind === 'average') return { title: 'Your average', sub: C.ui.scope === 'year' ? 'Year so far' : (C.shownPeriod() || { per: { name: '' } }).per.name, body: C.averageDetail() };
    if (sh.kind === 'settings') return { title: 'Settings', sub: 'Saved on this phone', body: textSize() + C.settingsBody(H.extraSettings ? H.extraSettings() : '') };
    return null;
  }
  function openSheet(sh, push) {
    if (push && st.stack.length) st.stack.push(sh); else st.stack = [sh];
    C.ui.item = null; C.ui.tryv = null;
    drawSheet(true);
  }
  function drawSheet(fresh) {
    const sh = st.stack[st.stack.length - 1], layer = $('#layer');
    if (!sh) return closeSheet();
    const ct = sheetContent(sh);
    if (!ct) return closeSheet();
    let el = $('.sheet', layer);
    if (el && el.classList.contains('out')) { layer.innerHTML = ''; el = null; }  // one still sliding away: start fresh
    const y = el && !fresh ? $('.sheet-b', el).scrollTop : 0;
    if (!el) {
      layer.innerHTML = '<div class="scrim" data-act="close" aria-hidden="true"></div><aside class="sheet" role="dialog" aria-modal="true"></aside>';
      el = $('.sheet', layer);
      pull(el);
      document.documentElement.classList.add('locked');
      st.opener = document.activeElement;  // focus goes back here when the sheet closes
      fresh = 'new';
    }
    const was = el.contains(document.activeElement) ? sigOf(document.activeElement) : null;  // a redraw keeps keyboard focus where it was
    el.setAttribute('aria-label', ct.title || 'Details');
    el.innerHTML = `<header class="sheet-h"><span class="grab"></span>${st.stack.length > 1 ? `<button class="ic" data-act="back" aria-label="Back">${ICON.back}</button>` : ''}
      <div class="sheet-t"><h2>${esc(ct.title)}</h2>${ct.sub && ct.sub !== ct.title ? `<small>${esc(ct.sub)}</small>` : ''}</div><button class="ic" data-act="close" aria-label="Close">${ICON.x}</button></header>
      <div class="sheet-b">${ct.body}</div>`;
    const b = $('.sheet-b', el);
    b.scrollTop = y;
    C.mountCharts(b);
    C.fillTries(b);
    fillNew(b);
    C.a11y(b);
    const again = was && el.querySelector(was);
    if (again) again.focus({ preventScroll: true });
    else if (fresh === 'new' || !el.contains(document.activeElement)) { const x = $('.sheet-h [data-act=close]', el); if (x) x.focus({ preventScroll: true }); }
  }
  const sigOf = x => (x && x.dataset && x.dataset.act ? `[data-act="${CSS.escape(x.dataset.act)}"]${x.dataset.v != null ? `[data-v="${CSS.escape(x.dataset.v)}"]` : ''}${x.dataset.id ? `[data-id="${CSS.escape(x.dataset.id)}"]` : ''}${x.dataset.cid ? `[data-cid="${CSS.escape(x.dataset.cid)}"]` : ''}` : x && x.id ? `#${CSS.escape(x.id)}` : null);
  // Tab and Shift-Tab stay inside an open sheet (keyboard users don't get lost behind it)
  function trapTab(ev, box) {
    if (!box) return;
    const f = [...box.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!box.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
  function closeSheet() {
    const layer = $('#layer');
    if (!layer) return;
    const el = $('.sheet', layer);
    st.stack = [];
    document.documentElement.classList.remove('locked');
    if (!el) { layer.innerHTML = ''; return; }
    el.classList.add('out');
    const scrim = $('.scrim', layer); if (scrim) scrim.classList.add('out');
    const back = st.opener; st.opener = null;
    if (back && document.contains(back) && back.focus) back.focus({ preventScroll: true });
    setTimeout(() => { if (!st.stack.length) layer.innerHTML = ''; }, 220);
  }
  // pull a sheet down from its top to close it, like an iPhone sheet (sliders inside keep their own touch)
  function pull(el) {
    let y0 = null, dy = 0, on = false;
    el.addEventListener('touchstart', e => {
      const b = $('.sheet-b', el), top = e.target.closest('.sheet-h') || (b && b.scrollTop <= 0);
      y0 = e.touches.length === 1 && top && !e.target.closest('.chart, .slider, select, input') ? e.touches[0].clientY : null; dy = 0; on = false;
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      if (!on) { if (dy < 0) { y0 = null; return; } if (dy < 8) return; on = true; }
      e.preventDefault();
      el.style.transition = 'none';
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }, { passive: false });
    const end = () => {
      if (!on) { y0 = null; return; }
      el.style.transition = 'transform .22s var(--ease)';
      if (dy > 110) { el.style.transform = 'translateY(105%)'; setTimeout(closeSheet, 180); } else el.style.transform = '';
      y0 = null; on = false;
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }
  let toastT = 0;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* text size, for this phone (pinch-zoom works too) */
  const SIZES = [[1, 'Normal'], [1.15, 'Large'], [1.3, 'Larger']];
  const tsize = () => { const v = +H.get('tsize'); return SIZES.some(x => x[0] === v) ? v : 1; };
  const applySize = () => document.documentElement.style.setProperty('--ts', String(tsize()));
  function textSize() {
    return `<h4 class="h4">Text size</h4><div class="set"><div class="main">Text and numbers<small>Bigger text on every screen</small></div>
      <div class="mini">${SIZES.map(([v, l]) => `<button class="${tsize() === v ? 'on' : ''}" data-act="tsize" data-v="${v}">${l}</button>`).join('')}</div></div>`;
  }

  /* ---------------- taps ---------------- */
  const ACT = {
    class: el => openSheet({ kind: 'class', cid: el.dataset.cid }),
    assignment: el => openSheet({ kind: 'assignment', cid: el.dataset.cid, id: el.dataset.id }),
    'open-class': el => openSheet({ kind: 'class', cid: el.dataset.cid }, true),
    path: () => { closeSheet(); const p = $('#path'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    tab: () => { closeSheet(); window.scrollTo({ top: 0, behavior: 'smooth' }); },  // old links from the tab days
    average: () => openSheet({ kind: 'average' }),
    settings: () => openSheet({ kind: 'settings' }),
    close: closeSheet,
    tsize: el => { H.set('tsize', +el.dataset.v); applySize(); drawSheet(); },
    back: () => { st.stack.pop(); C.ui.item = null; drawSheet(true); },
  };
  function redraw() {  // a shared piece changed (a category opened, a setting, the quarter): draw what's showing again
    if (st.stack.length) drawSheet();
    draw(true);
  }
  function wire() {
    document.addEventListener('click', ev => {
      const a = ev.target.closest('[data-act]');
      if (!a || a.type === 'checkbox') return;
      const name = a.dataset.act;
      if (ACT[name]) { ACT[name](a, ev); return; }
      if (C.act(name, a)) return;
      if (H.act) H.act(name, a, ev);
    });
    document.addEventListener('change', ev => {
      const a = ev.target.closest('input[type=checkbox][data-act]');
      if (a) C.act(a.dataset.act, a);
      const n = ev.target.closest('[data-nw]');
      if (n) onNew(n);
    });
    document.addEventListener('input', ev => {
      const el = ev.target.closest('[data-in]'); if (el) C.input(el);
      const n = ev.target.closest('[data-nw]'); if (n) onNew(n);
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') closeSheet();
      if (ev.key === 'Tab') trapTab(ev, $('#layer .sheet:not(.out)'));
    });
  }

  /* ---------------- the host's way in ---------------- */
  function init(host) {
    H = host;
    C.init({ get: H.get, set: H.set, now: H.now, place: 'phone', redraw });
    applySize();
    wire();
  }
  function show(snap) {
    C.setSnap(snap);
    draw(true);
    if (st.stack.length) drawSheet();
  }
  // a link like #class/ID (from a notification) opens that class; #goal the path
  function openFromHash(hash) {
    const [v, id] = decodeURIComponent(String(hash || '').replace(/^#/, '')).split('/');
    if (v === 'class' && id && C.snap && C.course(id)) { openSheet({ kind: 'class', cid: id }); return true; }
    if (v === 'goal' && C.snap) { ACT.path(); return true; }
    return false;
  }
  root.PSPhone = { init, show, toast, closeSheet, openFromHash, openSettings: () => openSheet({ kind: 'settings' }) };
})(window);
