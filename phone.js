'use strict';
/* PowerStats v5 (V3 layout) on the phone, laid out like Claude Trade: three tabs that stay put at the bottom (Today, Classes,
   Upcoming), and anything you tap (a class, an assignment, your path to 90%) slides up in a sheet over the screen you
   were on. Pull it down (or tap ✕) and you're right back where you were: no jumping around. Sheets never stack: an
   assignment's "Open the class" swaps the sheet's content, with ‹ to go back.
   The pieces inside (class details, sliders, charts) are core.js (PSCore), shared with the Mac; app.js is the shell
   (the lock, refreshing, notifications). */
(function (root) {
  const C = root.PSCore, F = C.fmt, esc = F.esc;
  const $ = (s, el = document) => el.querySelector(s);
  let H = null;
  const st = { tab: 'today', stack: [], scroll: {} };

  const ICON = {
    today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    classes: '<svg viewBox="0 0 24 24"><path d="M4 19V11M10 19V5M16 19v-6M21 19H3"/></svg>',
    upcoming: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  };
  const TABS = [['today', 'Today'], ['classes', 'Classes'], ['upcoming', 'Upcoming']];

  /* ---------------- the three screens ---------------- */
  function today() {
    const s = C.status();
    if (!s) return '<div class="empty">No grades yet.</div>';
    const g = C.goalNow(), per = s.per, sp = C.shownPeriod();
    let eyebrow = per.name + (s.final ? ' final' : '');
    if (!s.final && per.end) {
      const k = F.dayDiff(per.end);
      eyebrow += k > 1 ? ` · ${k} days left` : k === 1 ? ' · ends tomorrow' : k === 0 ? ' · ends today' : '';
    }
    const year = C.average('year').pct;
    const qs = C.quarterSeg(false);
    // v5: the average as a big plain number (no ring), then every class against the goal
    let h = `${qs ? `<div class="qbar">${qs}</div>` : ''}<section class="hero${s.early ? ' early' : ''}"><div class="hero-row">${C.avgBlock(s)}
        <div class="kpis">${!s.final && !s.early && s.proj != null && isFinite(s.proj) ? `<div><small>If it goes like usual</small><b class="num ${F.gcls(s.proj)}">${F.p(s.proj)}</b></div>` : ''}
          <div><small>Year so far${!s.final && C.courses().some(c => C.early(c, per.id)) ? ' · for now' : ''}</small><b class="num ${F.gcls(year)}">${F.p(year)}</b></div></div></div>
      <p class="eyebrow"><i></i>${esc(eyebrow)}</p><h1>${esc(s.head)}</h1><p class="sub">${esc(s.sub)}</p>
      <div class="chips"><button class="chip go" data-act="path"><i></i>${s.final ? `Start ${esc(F.shortP(sp.next || per))} strong` : s.early ? 'Tests coming up' : `Your path to ${F.pts(s.goal)}`} ›</button>
        ${g && g.checks.length ? `<button class="chip warn" data-act="path">${F.plural(g.checks.length, 'thing')} to check ›</button>` : ''}</div></section>
      <section class="card pane cpane"><div class="pane-h"><h2>Your classes</h2><span>tap one</span></div>${C.classChart({ dir: 'h' })}</section>`;

    const series = C.averageSeries(per.id);
    if (series.length >= 2) h += `<section class="card pane"><div class="pane-h"><h2>Your average</h2><span>${esc(per.name)}</span></div>${C.chart(series, { h: 150 })}</section>`;

    if (g && !s.final) {
      const moves = g.moves.slice().sort((a, b) => C.likely(b) - C.likely(a)).filter(mv => !g.young(mv.course)).slice(0, 3);
      if (moves.length) h += `<section class="sec"><div class="sec-h"><h2>Do these first</h2><span>what moves your average most</span></div><div class="list">${moves.map(mv => C.moveRow(mv, true)).join('')}</div></section>`;
    }
    // v5: tests get their own cards up top; Due soon is the homework checklist (no test shows twice)
    const soon = C.upcoming(7), tests = soon.filter(x => C.isTest(x.i)), hw = soon.filter(x => !C.isTest(x.i));
    if (tests.length) h += `<section class="sec"><div class="sec-h"><h2>Tests and quizzes</h2><span>the next 7 days</span></div><div class="tcards">${tests.slice(0, 4).map(C.testCard).join('')}</div></section>`;
    if (hw.length) {
      h += `<section class="sec"><div class="sec-h"><h2>Due soon</h2><span>homework, the next 7 days</span></div><div class="list">${hw.slice(0, 5).map(x => C.upRow(x)).join('')}</div>
        ${hw.length > 5 ? `<button class="more" data-act="tab" data-v="upcoming">See all ${soon.length} in Upcoming ›</button>` : ''}</section>`;
    }
    const news = C.recentGrades(14);
    if (news.length) h += `<section class="sec"><div class="sec-h"><h2>New grades</h2><span>the last two weeks</span></div><div class="list">${news.slice(0, 4).map(C.gradeRow).join('')}</div></section>`;
    return h + foot();
  }

  function classes() {
    const sp = C.shownPeriod(), year = C.ui.scope === 'year' || !sp;
    const pid = year ? 'year' : sp.per.id;
    const list = C.courses().map(c => ({ c, g: C.grade(c, pid) }));
    const rows = list.filter(x => x.g != null).concat(list.filter(x => x.g == null));
    const o = C.average(pid);
    return `<div class="scr-h"><h1>Classes</h1>${C.quarterSeg(true)}</div>
      <div class="list clist">${rows.map(x => C.classRow(x.c, { pid })).join('')}</div>
      <p class="legend">Bars run from 60 to 100 with a mark at ${F.pts(+C.settings.goal || 90)}${year ? '' : ' · ▲▼ = this week'}.</p>
      <button class="card avgcard" data-act="average"><div><small>Your ${year ? 'year' : esc(F.shortP(sp.per))} average</small><b class="num ${F.gcls(o.pct)}">${F.p(o.pct)}</b></div><span>How it’s figured ›</span></button>` + foot();
  }

  function upcoming() {
    const g = C.goalNow(), all = C.upcoming(14);
    let h = '<div class="scr-h"><h1>Upcoming</h1><span class="scr-sub">the next two weeks</span></div>';
    if (g && g.checks.length) {
      h += `<section class="sec"><div class="sec-h"><h2>Was it turned in?</h2><span>past due, no grade yet</span></div><div class="list">${g.checks.map(r => C.upRow({ c: r.course, i: r.item, mv: null })).join('')}</div></section>`;
    }
    if (!all.length) return h + '<div class="card empty">Nothing due in the next two weeks.</div>' + foot();
    const days = {};
    for (const x of all) (days[x.i.due.slice(0, 10)] = days[x.i.due.slice(0, 10)] || []).push(x);
    for (const d of Object.keys(days).sort()) {
      const k = F.dayDiff(d), t = F.D(d);
      const name = k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][t.getDay()];
      const tests = days[d].filter(x => x.i.test || /\b(test|exam|quiz|prueba|rq|reading quiz|l\.?e\.?q)\b/i.test(x.i.t)).length;
      h += `<section class="sec"><div class="sec-h"><h2>${name}</h2><span>${esc(F.md(d))}${tests ? ` · ${F.plural(tests, 'test or quiz', 'tests and quizzes')}` : ''}</span></div>
        <div class="list">${days[d].map(x => C.upRow(x, { date: false }) + C.testNb(x)).join('')}</div></section>`;
    }
    return h + foot();
  }
  function foot() {
    const s = C.snap, t = s.checked || s.at;
    return `<p class="foot">Checked Schoology ${esc(F.synced(t))}${s.at !== t ? ` · grades last changed ${esc(F.synced(s.at))}` : ''}.<br>PowerStats only reads Schoology; it can’t change anything.</p>`;
  }

  /* ---------------- drawing ---------------- */
  function draw(keep) {
    const view = $('#view');
    if (!view || !C.snap) return;
    const y = window.scrollY;
    view.innerHTML = `<div class="screen" data-tab="${st.tab}">${{ today, classes, upcoming }[st.tab]()}</div>`;
    C.mountCharts(view);
    C.fillTries(view);
    for (const b of document.querySelectorAll('.tabbar button')) {
      b.classList.toggle('on', b.dataset.v === st.tab);
      if (b.dataset.v === st.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    C.a11y(view);
    if (keep) window.scrollTo(0, y);
    if (H.onRender) H.onRender();
  }
  function setTab(v) {
    if (v === st.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    st.scroll[st.tab] = window.scrollY;
    st.tab = v;
    H.set('tab', v);
    draw();
    window.scrollTo(0, st.scroll[v] || 0);
  }

  /* ---------------- sheets: one at a time, over the screen you were on ---------------- */
  function sheetContent(sh) {
    const c = sh.cid ? C.course(sh.cid) : null;
    if (sh.kind === 'class' && c) {
      return { title: c.short, sub: c.name, body: C.classDetail(c) };
    }
    if (sh.kind === 'assignment') {
      const i = c && c.items.find(j => j.id === sh.id);
      if (i) {
        return { title: i.t, sub: c.short, body: C.assignmentDetail(c, i) + `<div class="sheet-btns">${C.isTest(i) && i.s == null ? C.nbLink(c, 'wide') : ''}<button class="btn" data-act="open-class" data-cid="${c.id}">Open ${esc(c.short)}</button>
          <a class="btn" href="https://schoology.canisiushigh.org/assignment/${encodeURIComponent(i.id)}" target="_blank" rel="noopener">Open in Schoology</a></div>` };
      }
      const e = (C.snap.cal || []).find(x => x.sid === sh.id);  // a calendar item that isn't in the gradebook
      if (e) {
        const due = e.date + (e.time ? `T${e.time}` : '');
        return { title: e.title, sub: c ? c.short : 'School', body: `<div class="a-top"><div class="a-meta">${esc(c ? c.name : 'Schoology calendar')}</div>
          <div class="chips"><span class="chip">Due ${esc(F.dueText(due))}</span><span class="chip">Not in the gradebook</span></div></div>
          ${e.details ? `<p class="say">“${esc(e.details)}”</p>` : ''}<p class="note">It’s on the Schoology calendar but has no points in the gradebook, so it doesn’t change a grade on its own.</p>
          <div class="sheet-btns">${e.test && c ? C.nbLink(c, 'wide') : ''}${c ? `<button class="btn" data-act="open-class" data-cid="${c.id}">Open ${esc(c.short)}</button>` : ''}<a class="btn" href="https://schoology.canisiushigh.org/assignment/${encodeURIComponent(e.sid)}" target="_blank" rel="noopener">Open in Schoology</a></div>` };
      }
    }
    if (sh.kind === 'path') {
      const s = C.status();
      return { title: s && s.final ? `${F.shortP(s.per)} is over` : s && s.early ? 'Tests coming up' : `Your path to ${F.pts(+C.settings.goal || 90)}`, sub: s ? s.per.name : '', body: C.pathDetail() };
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
      layer.innerHTML = '<div class="scrim" data-act="close"></div><aside class="sheet" role="dialog" aria-modal="true"></aside>';
      el = $('.sheet', layer);
      pull(el);
      document.documentElement.classList.add('locked');
    }
    el.innerHTML = `<header class="sheet-h"><span class="grab"></span>${st.stack.length > 1 ? `<button class="ic" data-act="back" aria-label="Back">${ICON.back}</button>` : ''}
      <div class="sheet-t"><b>${esc(ct.title)}</b>${ct.sub ? `<small>${esc(ct.sub)}</small>` : ''}</div><button class="ic" data-act="close" aria-label="Close">${ICON.x}</button></header>
      <div class="sheet-b">${ct.body}</div>`;
    const b = $('.sheet-b', el);
    b.scrollTop = y;
    C.mountCharts(b);
    C.fillTries(b);
    C.a11y(b);
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
    setTimeout(() => { if (!st.stack.length) layer.innerHTML = ''; }, 220);
  }
  // pull a sheet down from its top to close it, like an iPhone sheet (charts inside keep their own touch)
  function pull(el) {
    let y0 = null, dy = 0, on = false;
    el.addEventListener('touchstart', e => {
      const b = $('.sheet-b', el), top = e.target.closest('.sheet-h') || (b && b.scrollTop <= 0);
      y0 = e.touches.length === 1 && top && !e.target.closest('.chart, .slider') ? e.touches[0].clientY : null; dy = 0; on = false;
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

  /* v5: text size, for this phone (pinch-zoom works too) */
  const SIZES = [[1, 'Normal'], [1.15, 'Large'], [1.3, 'Larger']];
  const tsize = () => { const v = +H.get('tsize'); return SIZES.some(x => x[0] === v) ? v : 1; };
  const applySize = () => document.documentElement.style.setProperty('--ts', String(tsize()));
  function textSize() {
    return `<h4 class="h4">Text size</h4><div class="set"><div class="main">Text and numbers<small>Bigger text on every screen</small></div>
      <div class="mini">${SIZES.map(([v, l]) => `<button class="${tsize() === v ? 'on' : ''}" data-act="tsize" data-v="${v}">${l}</button>`).join('')}</div></div>`;
  }

  /* ---------------- taps ---------------- */
  const ACT = {
    tab: el => { closeSheet(); setTab(el.dataset.v); },
    class: el => openSheet({ kind: 'class', cid: el.dataset.cid }),
    assignment: el => openSheet({ kind: 'assignment', cid: el.dataset.cid, id: el.dataset.id }),
    'open-class': el => openSheet({ kind: 'class', cid: el.dataset.cid }, true),
    path: () => openSheet({ kind: 'path' }),
    average: () => openSheet({ kind: 'average' }),
    settings: () => openSheet({ kind: 'settings' }),
    close: closeSheet,
    tsize: el => { H.set('tsize', +el.dataset.v); applySize(); drawSheet(); },
    back: () => { st.stack.pop(); C.ui.item = null; drawSheet(true); },
  };
  function redraw() {  // a shared piece changed (a category opened, a setting): draw what's showing again
    if (st.stack.length) drawSheet(); else draw(true);
    if (st.stack.length && st.stack[st.stack.length - 1].kind === 'settings') draw(true);
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
    });
    document.addEventListener('input', ev => { const el = ev.target.closest('[data-in]'); if (el) C.input(el); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheet(); });
  }

  /* ---------------- the host's way in ---------------- */
  function init(host) {
    H = host;
    C.init({ get: H.get, set: H.set, now: H.now, place: 'phone', redraw });
    applySize();
    st.tab = H.get('tab') || 'today';
    if (!TABS.some(t => t[0] === st.tab)) st.tab = 'today';
    const bar = $('.tabbar');
    if (bar) bar.innerHTML = TABS.map(([v, l]) => `<button data-act="tab" data-v="${v}" aria-label="${l}">${ICON[v]}<span>${l}</span></button>`).join('');
    wire();
  }
  function show(snap) {
    C.setSnap(snap);
    draw(true);
    if (st.stack.length) drawSheet();
  }
  // a link like #class/ID (older notifications) opens that class; #goal the path
  function openFromHash(hash) {
    const [v, id] = decodeURIComponent(String(hash || '').replace(/^#/, '')).split('/');
    if (v === 'class' && id && C.snap && C.course(id)) { openSheet({ kind: 'class', cid: id }); return true; }
    if (v === 'goal' && C.snap) { openSheet({ kind: 'path' }); return true; }
    return false;
  }
  root.PSPhone = { init, show, toast, closeSheet, openFromHash, openSettings: () => openSheet({ kind: 'settings' }) };
})(window);
