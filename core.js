'use strict';
/* PowerStats v5 (V3 layout): what the phone (phone.js) and the Mac (mac/ui/grades.js) share: the numbers and words for every
   grade, and the pieces both draw: a class row, a class's details, an assignment's details, the path to 90%, the
   average's table, charts, the average and the class bars. Each screen decides where they go (the phone in sheets that slide up,
   the Mac in a side panel). engine.js (PSMath) does the math; nothing here can change Schoology.
   The host gives: get/set (saved settings), now(), place ('phone' or 'Mac') and redraw() (draw again after a tap). */
(function (root) {
  const M = root.PSMath;
  let H = null, snap = null, settings = null;
  // what's open: categories {key: 1}, the assignment whose slider is showing, folds {key: 1}, a class's own period
  // and the quarter Sam switched to (q: null = the current one; not saved, so the app always opens on the current one)
  const ui = { cats: {}, item: null, tryv: null, folds: {}, pid: {}, scope: 'period', q: null };

  /* ---------------- formatting ---------------- */
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dec = () => (settings.dec === 1 ? 1 : 2);
  const ok = x => x != null && isFinite(x);
  const p = (x, d) => (ok(x) ? x.toFixed(d == null ? dec() : d) : '—');
  const pc = (x, d) => (ok(x) ? p(x, d) + '%' : '—');
  const pts = x => (ok(x) ? String(Math.round(x * 100) / 100) : '—');
  const sgn = (x, d) => (x > 0.0049 ? '+' : x < -0.0049 ? '−' : '±') + Math.abs(x).toFixed(d == null ? dec() : d);
  const goalPct = () => +settings.goal || 90;
  // green = at your goal or above; blue = on the way; amber and red = under 80 and 70
  const gcls = x => (!ok(x) ? 'g-none' : x >= goalPct() - 1e-9 ? 'g-good' : x >= 80 ? 'g-ok' : x >= 70 ? 'g-low' : 'g-bad');
  const pad = n => String(n).padStart(2, '0');
  const D = s => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number), t = new Date(y, m - 1, d);
    if (s.length > 10) { const [hh, mm] = s.slice(11, 16).split(':').map(Number); t.setHours(hh, mm); }
    return t;
  };
  const now = () => H.now();
  const dayStart = t => new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const iso = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const todayISO = () => iso(now());
  const nowISO = () => { const t = now(); return `${todayISO()}T${pad(t.getHours())}:${pad(t.getMinutes())}`; };
  const dayDiff = s => Math.round((dayStart(D(s)) - dayStart(now())) / 864e5);
  const md = s => { const t = D(s); return `${MON[t.getMonth()]} ${t.getDate()}`; };
  const clock = t => { const h = t.getHours(); return `${h % 12 || 12}:${pad(t.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`; };
  function relDay(s) {
    const k = dayDiff(s);
    return k === 0 ? 'today' : k === 1 ? 'tomorrow' : k === -1 ? 'yesterday' : k > 1 && k < 7 ? DAY[D(s).getDay()] : md(s);
  }
  const dueText = s => (s ? relDay(s) + (s.length > 10 && s.slice(11) !== '23:59' && dayDiff(s) >= -1 && dayDiff(s) <= 6 ? ` ${clock(D(s))}` : '') : 'no due date');
  const synced = at => { const k = dayDiff(at); return (k === 0 ? '' : k === -1 ? 'yesterday ' : `${md(at)} `) + clock(D(at)); };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const ICON = {
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    right: '<svg class="chev r" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  };

  /* ---------------- the data ---------------- */
  const courses = () => snap.courses;
  const course = id => courses().find(c => c.id === id);
  const realPeriods = c => c.periods.filter(x => x.w > 0);
  const shortP = per => per.name.replace(/^Quarter\s*/i, 'Q').replace(/^Exam.*$/i, 'Exam').replace(/^Semester\s*/i, 'S');
  const longP = per => per.name.replace(/^Exam \((\w+)\)$/i, '$1 exam');
  function currentPid(c) {
    const t = todayISO(), ps = realPeriods(c).filter(x => x.start);
    const cur = ps.find(x => x.start <= t && t <= (x.end || '9999'));
    if (cur) return cur.id;
    const started = ps.filter(x => x.start <= t);
    return (started[started.length - 1] || ps[0] || {}).id;
  }
  function globalPeriod() {
    const count = {};
    for (const c of courses()) { const id = currentPid(c); if (id) count[id] = (count[id] || 0) + 1; }
    const id = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    for (const c of courses()) { const per = c.periods.find(x => x.id === id); if (per) return per; }
    return null;
  }
  const hasGradesIn = (c, pid) => c.items.some(i => i.p === pid && i.s != null);
  function previousPeriod(per) {
    const seen = {};
    for (const c of courses()) for (const x of c.periods) if (x.w > 0 && x.start && x.start < per.start) seen[x.id] = x;
    return Object.values(seen).sort((a, b) => (a.start < b.start ? 1 : -1))[0] || null;
  }
  // every quarter that has started, in order: the quarter switch's choices
  function quarters() {
    const seen = {}, t = todayISO();
    for (const c of courses()) for (const x of realPeriods(c)) if (x.start && x.start <= t && !/^exam/i.test(x.name)) seen[x.id] = x;
    return Object.values(seen).sort((a, b) => (a.start < b.start ? -1 : 1));
  }
  const ended = per => !!(per && per.end && per.end < todayISO());
  // the quarter to show: the one Sam switched to; else the current one once any class has grades in it, else the one
  // before it, as final
  function shownPeriod() {
    const pick = ui.q && quarters().find(x => x.id === ui.q);
    if (pick) return { per: pick, final: ended(pick), next: ended(pick) ? quarters().find(x => x.start > pick.start) || null : null, picked: true };
    const gp = globalPeriod();
    if (!gp || courses().some(c => hasGradesIn(c, gp.id))) return gp && { per: gp, final: false };
    const prev = previousPeriod(gp);
    return prev && courses().some(c => hasGradesIn(c, prev.id)) ? { per: prev, final: true, next: gp } : { per: gp, final: false };
  }
  // the period a class shows: what was picked inside it, else the quarter shown (its year when the year is shown)
  function pidOf(c) {
    const own = ui.pid[c.id];
    if (own && (own === 'year' || c.periods.some(x => x.id === own))) return own;
    if (ui.scope === 'year') return 'year';
    const sp = shownPeriod();
    return sp && c.periods.some(x => x.id === sp.per.id) ? sp.per.id : (realPeriods(c)[0] || {}).id;
  }
  const maxOf = i => (i.m != null ? i.m : i.mg);
  const guessed = i => i.m == null && !i.mk;  // the points are PowerStats' guess until Schoology shows them
  const turnedIn = i => /^d?s$/.test(i.f || '');
  const ahead = i => !turnedIn(i) && (!i.due || (i.due.length === 10 ? i.due >= todayISO() : i.due > nowISO()));
  // by due date; a date with no time counts as the end of that day
  const dueKey = i => (!i.due ? '9' : i.due.length === 10 ? i.due + 'T23:59' : i.due);
  const byDue = (a, b) => (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0);
  const pending = (c, pid) => c.items.filter(i => i.p === pid && i.s == null && !M.exception(i));
  // early in a quarter that's still going, a class with only 1 or 2 grades: its grade is just for now (one quiz can
  // make it 30%), so it's labeled that way and left out of what to worry about
  const EARLY = 3;
  const gradedIn = (c, pid) => c.items.filter(i => i.p === pid && i.s != null).length;
  function early(c, pid) {
    const per = c.periods.find(x => x.id === pid), n = per ? gradedIn(c, pid) : 0;
    return !!per && !ended(per) && n > 0 && n < EARLY;
  }
  const earlyNote = (c, pid) => `${plural(gradedIn(c, pid), 'grade')} so far, just for now`;
  // the whole quarter is early: no class has 3 grades in it yet
  const earlyQuarter = pid => { const cs = courses().filter(c => gradedIn(c, pid) > 0); return cs.length > 0 && cs.every(c => early(c, pid)); };
  // the switch: Q1, Q2 … (and Year where a list can show the year)
  function quarterSeg(withYear) {
    const qs = quarters(), sp = shownPeriod();
    if (!sp || (qs.length < 2 && !withYear)) return '';
    const yr = withYear && ui.scope === 'year';
    return `<div class="seg qseg" role="group" aria-label="Quarter">${qs.map(x => `<button class="${!yr && sp.per.id === x.id ? 'on' : ''}" data-act="quarter" data-v="${x.id}">${esc(shortP(x))}</button>`).join('')}`
      + (withYear ? `<button class="${yr ? 'on' : ''}" data-act="quarter" data-v="year">Year</button>` : '') + '</div>';
  }
  const catOf = (c, id) => c.cats.find(k => k.id === id) || { name: '?', w: null };
  const grade = (c, pid) => (pid === 'year' ? M.year(c, c.items).pct : M.periodPct(c, pid, c.items));
  const scoreAt = (c, pid, id, s) => M.periodPct(c, pid, c.items.map(i => (i.id === id ? Object.assign({}, i, { s, m: maxOf(i), f: '' }) : i)));
  const average = (pid, swap) => M.overall(courses().map(k => ({ course: k, pct: swap && k.id === swap.id ? swap.pct : grade(k, pid) })), settings);
  function weekChange(c, pid) {
    const tr = M.trend(c, pid, c.items);
    if (tr.length < 2) return null;
    const cut = now(); cut.setDate(cut.getDate() - 7);
    const before = tr.filter(x => x[0] <= iso(cut)).pop();
    return before ? tr[tr.length - 1][1] - before[1] : null;
  }
  // what PowerStats learned on the Mac (learn.py): each class's grading speed and how Sam does on each kind of work
  const learned = () => snap.learn || {};
  function graceDays(cid) {
    const s = (learned().speed || {})[cid];
    return s && s.n >= 2 ? Math.max(1, Math.round((s.d * 1.5 + 1) * 10) / 10) : 3;
  }
  function schoolDaysSince(due) {  // Monday to Friday only, like learn.py
    let t = due.length > 10 ? D(due) : new Date(D(due).getTime() + 15 * 3600e3), total = 0;
    const end = now();
    while (t < end) {
      const next = new Date(Math.min(end, new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)));
      if (t.getDay() !== 0 && t.getDay() !== 6) total += (next - t) / 864e5;
      t = next;
    }
    return total;
  }

  // the goal plan for the quarter shown (real grades): what moves the average most
  let goalCache = null;
  function goalNow() {
    const sp = shownPeriod();
    if (!sp) return null;
    const key = `${snap.at}|${sp.per.id}|${JSON.stringify(settings)}|${nowISO()}`;
    if (goalCache && goalCache.key === key) return goalCache.val;
    const val = Object.assign({ per: sp.per, final: sp.final, next: sp.next, goal: goalPct() },
      M.goalPlan(courses().map(c => ({ course: c, items: c.items })), sp.per.id, settings, nowISO(), sp.final ? null : goalPct()));
    // "did you turn it in?" only once it's later than that class usually takes to grade
    val.checks = val.risks.filter(r => r.item.due && schoolDaysSince(r.item.due) > graceDays(r.course.id));
    // early in a quarter one score swings the average a lot: gains only for classes with 3 grades in it
    val.young = c => c.items.filter(i => i.p === sp.per.id && i.s != null).length < 3;
    goalCache = { key, val };
    return val;
  }
  const likely = mv => mv.gain * (mv.kind !== 'redo' ? 1 : mv.redo === 'usually' ? 0.8 : 0.4);
  const KIND = { upcoming: ['Ace it', 'acc'], redo: ['Redo if allowed', 'warn'], 'redo-ok': ['Redo, usually OK', 'good'], missing: ['Turn it in', 'bad'], check: ['Make sure it’s in', 'bad'] };
  const kindOf = mv => KIND[mv.kind === 'redo' && mv.redo === 'usually' ? 'redo-ok' : mv.kind];
  const moveFor = id => { const g = goalNow(); return g && g.moves.find(m => m.item.id === id); };
  const verb = mv => (mv.kind === 'redo' ? 'Redo' : mv.kind === 'missing' ? 'Turn in' : 'Ace');

  // where the average stands, in words: the headline both screens put on top
  function status() {
    const g = goalNow(), sp = shownPeriod();
    if (!g || !sp) return null;
    const avg = average(sp.per.id).pct, goal = goalPct(), proj = g.projected.pct;
    const out = { avg, goal, per: sp.per, final: sp.final, next: sp.next, proj, path: g.path, gap: goal - avg };
    if (!ok(avg)) { out.head = 'No grades yet.'; out.sub = 'They show up here as soon as Schoology has them.'; return out; }
    if (sp.final) {
      out.head = avg >= goal ? `${shortP(sp.per)} finished above ${pts(goal)}%.` : `${shortP(sp.per)} finished at ${p(avg)}%.`;
      out.sub = sp.picked ? `${sp.per.name} is over: these are its final grades.${sp.next ? ` ${sp.next.name} is the quarter now.` : ''}`
        : `${sp.next ? `${sp.next.name} started ${md(sp.next.start)}. ` : ''}Its grades start counting as soon as they’re posted.`;
      return out;
    }
    // the quarter just started: a grade or two can't say much yet
    const young = courses().filter(c => early(c, sp.per.id));
    if (earlyQuarter(sp.per.id)) {
      const n = young.reduce((t, c) => t + gradedIn(c, sp.per.id), 0);
      out.early = true;
      out.head = `${shortP(sp.per)} just started.`;
      out.sub = `${plural(n, 'grade')} so far (${young.map(c => c.short).join(', ')}), so ${pc(avg)} is just for now. It settles as more grades come in.`;
      return out;
    }
    const youngNote = young.length ? ` ${young.map(c => c.short).join(' and ')} ${young.length === 1 ? 'has' : 'have'} only a grade or two, so ${young.length === 1 ? 'its grade is' : 'theirs are'} just for now.` : '';
    if (avg >= goal) {
      out.head = `${p(avg - goal)} above ${pts(goal)}%.`;
      out.sub = ok(proj) && proj < goal ? `Careful: if the rest goes like usual you’d end at ${pc(proj)}.` : 'Keep it up: everything still to come counts.';
    } else if (g.path.length) {
      const last = g.path[g.path.length - 1], first = g.path[0];
      if (last.avg >= goal - 1e-9) {
        out.head = `${p(goal - avg)} to ${pts(goal)}%.`;
        const redos = g.path.filter(x => x.move.kind === 'redo').length;
        out.sub = `${verb(first.move)} ${first.move.item.t} and you’re at ${pc(first.avg)}.` + (g.path.length > 1 ? ` ${plural(g.path.length - 1, 'more step')} to pass ${pts(goal)}${redos ? ` (${plural(redos, 'redo')})` : ''}.` : '');
      } else {
        out.head = `${p(goal - avg)} below ${pts(goal)}%.`;
        out.sub = `Even every move left gets you to ${pc(last.avg)}, so make each point count toward the year.`;
      }
    } else {
      out.head = `${p(goal - avg)} below ${pts(goal)}%.`;
      out.sub = ok(proj) ? `If the rest goes like usual: ${pc(proj)}.` : '';
    }
    out.sub += youngNote;
    return out;
  }

  /* ---------------- grades over time (charts) ---------------- */
  // a class's grade after each date something was due, through today
  const classSeries = (c, pid) => M.trend(c, pid, c.items).filter(x => x[0] <= todayISO());
  // the overall average after each date anything was due, through today
  function averageSeries(pid) {
    const days = [...new Set(courses().flatMap(c => c.items.filter(i => i.p === pid && i.due && M.scored(i)).map(i => i.due.slice(0, 10))))].filter(d => d <= todayISO()).sort();
    const out = [];
    for (const d of days) {
      const rows = courses().map(c => ({ course: c, pct: M.periodPct(c, pid, c.items.filter(i => !i.due || i.due.slice(0, 10) <= d), { hidden: false }) }));
      const o = M.overall(rows, settings).pct;
      if (ok(o)) out.push([d, o]);
    }
    const nowAvg = average(pid).pct;
    if (out.length && ok(nowAvg)) out[out.length - 1] = [out[out.length - 1][0], nowAvg];
    return out;
  }
  let chartN = 0;
  // a line with a soft fill, the goal as a dashed line, and the dates underneath; touch or hover reads each point
  function chart(series, opts) {
    opts = opts || {};
    if (!series || series.length < 2) return '';
    const W = 600, Hh = opts.h || 150, padT = 10, padB = 22;
    const vals = series.map(x => x[1]), goal = goalPct();
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (goal >= lo - 6 && goal <= hi + 6) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
    lo = Math.max(0, Math.floor(lo - 2)); hi = Math.min(110, Math.ceil(hi + 1));
    if (hi - lo < 6) { lo = Math.max(0, hi - 6); }
    const t0 = D(series[0][0]).getTime(), t1 = D(series[series.length - 1][0]).getTime() || t0 + 1;
    const X = d => ((D(d).getTime() - t0) / Math.max(1, t1 - t0)) * W;
    const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (Hh - padT - padB);
    const pts2 = series.map(x => [X(x[0]), Y(x[1])]);
    const line = pts2.map((q, k) => `${k ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('');
    const area = `${line}L${W},${Hh - padB}L0,${Hh - padB}Z`;
    const id = 'ch' + (++chartN), last = pts2[pts2.length - 1], cls = gcls(vals[vals.length - 1]);
    const gy = Y(goal), showGoal = goal >= lo && goal <= hi;
    const data = esc(JSON.stringify(series.map(x => [x[0], Math.round(x[1] * 100) / 100])));
    return `<div class="chart ${cls}" data-series="${data}" data-lo="${lo}" data-hi="${hi}" data-h="${Hh}">
      <svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" style="height:${Hh}px" aria-hidden="true">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient></defs>
        ${showGoal ? `<line class="goal" x1="0" x2="${W}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}"/>` : ''}
        <path class="area" d="${area}" fill="url(#${id})"/><path class="line" d="${line}"/>
      </svg>
      <span class="dot-end" style="left:${(last[0] / W * 100).toFixed(2)}%;top:${last[1].toFixed(1)}px"></span>
      ${showGoal ? `<span class="goal-l" style="top:${gy.toFixed(1)}px">${pts(goal)}</span>` : ''}
      <div class="axis"><span>${esc(md(series[0][0]))}</span><span>${esc(md(series[series.length - 1][0]))}</span></div>
      <div class="tip" hidden></div><span class="cross" hidden></span></div>`;
  }
  function mountCharts(rootEl) {
    for (const el of rootEl.querySelectorAll('.chart:not([data-on])')) {
      el.dataset.on = '1';
      const series = JSON.parse(el.dataset.series), lo = +el.dataset.lo, hi = +el.dataset.hi, Hh = +el.dataset.h;
      const tip = el.querySelector('.tip'), cross = el.querySelector('.cross');
      const t0 = D(series[0][0]).getTime(), t1 = D(series[series.length - 1][0]).getTime();
      const show = ev => {
        const r = el.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left));
        const t = t0 + (x / r.width) * Math.max(1, t1 - t0);
        let best = series[0];
        for (const q of series) if (Math.abs(D(q[0]).getTime() - t) < Math.abs(D(best[0]).getTime() - t)) best = q;
        const bx = ((D(best[0]).getTime() - t0) / Math.max(1, t1 - t0)) * r.width;
        const by = 10 + (1 - (best[1] - lo) / (hi - lo)) * (Hh - 32);
        cross.hidden = false; cross.style.left = `${bx}px`; cross.style.top = `${by}px`;
        tip.hidden = false; tip.innerHTML = `<small>${esc(md(best[0]))}</small><b class="${gcls(best[1])}">${p(best[1])}</b>`;
        tip.style.left = `${Math.max(36, Math.min(r.width - 36, bx))}px`;
      };
      const hide = () => { tip.hidden = true; cross.hidden = true; };
      el.addEventListener('pointermove', show);
      el.addEventListener('pointerdown', show);
      el.addEventListener('pointerleave', hide);
      el.addEventListener('touchmove', show, { passive: true });
      el.addEventListener('touchend', () => setTimeout(hide, 1200));
    }
  }

  /* ---------------- small pieces ---------------- */
  // v5: each class has its own color and emoji everywhere (the emoji is its Gemini Notebook's when it has one), so a
  // class is known before its name is read
  const LOOKS = [
    [/apush|history/i, '#f0a878', '🗽'], [/spanish/i, '#ff8fa3', '🇪🇸'], [/lit|english/i, '#c49bff', '📚'],
    [/physics/i, '#5cc8ff', '⚛️'], [/comp|computer/i, '#6fe0c0', '💻'], [/alg|math|calc|geom|trig/i, '#8ea6ff', '📐'],
    [/relig|theo/i, '#f2d16b', '✝️'], [/phys.*ed|^pe\b|gym/i, '#a5e37e', '🏋️'], [/service/i, '#b8c0d0', '🤝'],
  ];
  const SPARE = ['#e9a0ff', '#7fd4ff', '#ffb36b', '#9fe6a0'];
  // the subject's emoji (the Statue of Liberty for APUSH, an atom for Physics, ...), the same on every screen
  function look(c) {
    if (!c) return { color: '#8a92a2', emoji: '📅' };
    const hit = LOOKS.find(([re]) => re.test(c.short) || re.test(c.name));
    return { color: hit ? hit[1] : SPARE[Math.abs([...String(c.id)].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)) % SPARE.length],
      emoji: hit ? hit[2] : '📘' };
  }
  const cc = c => `--cc:${look(c).color}`;
  const emo = c => `<span class="emo" aria-hidden="true">${look(c).emoji}</span>`;

  // v5: the average, big and plain (it replaced the ring): the number, and how far it is from the goal in words
  function avgBlock(s) {
    const goal = s.goal, avg = s.avg;
    const gap = !ok(avg) ? 'No grades yet'
      : avg >= goal - 1e-9 ? `<b class="pos">✓ ${p(avg - goal)} above ${pts(goal)}</b>`
      : `<b class="${s.final ? 'neg' : ''}">${p(goal - avg)}</b> ${s.final ? 'short of' : 'to'} ${pts(goal)}`;
    return `<div class="avg${s.early ? ' early' : ''}"><small>${esc(shortP(s.per))} average${s.final ? ' · final' : ''}</small>
      <div class="avg-n"><b class="num ${s.early ? 'g-ok' : gcls(avg)}">${p(avg)}</b><span>%</span></div>
      <p class="avg-gap">${gap}${s.early ? '<span> · just for now</span>' : ''}</p></div>`;
  }
  // v5: every class's grade as a bar against the goal line, lowest last, so you see which class pulls the average
  // down. dir 'v' (columns, the Mac) or 'h' (rows, the phone). Each bar opens its class.
  function classChart(opts) {
    opts = opts || {};
    const sp = shownPeriod(), yr = ui.scope === 'year' || !sp, pid = yr ? 'year' : sp.per.id;
    const lo = 50, goal = goalPct(), at = x => Math.max(0, Math.min(100, (x - lo) / (100 - lo) * 100));
    const rows = courses().map(c => ({ c, g: pid === 'year' || c.periods.some(x => x.id === pid) ? grade(c, pid) : null }))
      .sort((a, b) => (ok(b.g) ? b.g : -1) - (ok(a.g) ? a.g : -1));
    const bars = rows.map(({ c, g }) => {
      const young = ok(g) && !yr && early(c, pid), L = look(c);
      const said = `${c.short}: ${ok(g) ? pc(g) : 'no grades yet'}${young ? ', just for now' : ''}`;
      return `<button class="cb${ok(g) ? '' : ' none'}${young ? ' early' : ''}" data-act="${opts.act || 'class'}" data-cid="${c.id}" aria-label="${esc(said)}" style="--cc:${L.color}">
        <span class="cb-v num ${young ? 'g-early' : gcls(g)}">${ok(g) ? p(g, 0) : '—'}</span>
        <span class="cb-t"><i class="${young ? 'young' : gcls(g)}" style="--h:${ok(g) ? Math.max(2, at(g)).toFixed(1) : 0}"></i><em style="--gh:${at(goal).toFixed(1)}"></em></span>
        <span class="cb-n"><span class="emo" aria-hidden="true">${L.emoji}</span><span>${esc(c.short)}</span></span></button>`;
    }).join('');
    const early1 = rows.some(r => ok(r.g) && !yr && early(r.c, pid));
    return `<div class="cchart ${opts.dir === 'h' ? 'h' : 'v'}" role="group" aria-label="Your classes against ${pts(goal)}">${bars}</div>
      <p class="cc-key"><span><i class="k-goal"></i>${pts(goal)}, your goal</span>${early1 ? '<span><i class="k-young"></i>only a grade or two, just for now</span>' : ''}<span>bars start at ${lo}</span></p>`;
  }
  // a class's grade on a bar from 60 to 100 with a tick at the goal, so classes compare at a glance
  function bar(g, lo) {
    lo = lo == null ? 60 : lo;
    const at = x => Math.max(0, Math.min(100, (x - lo) / (100 - lo) * 100));
    return `<div class="bar"><i class="${gcls(g)}" style="width:${ok(g) ? at(g) : 0}%"></i><em style="left:${at(goalPct())}%"></em></div>`;
  }
  const pctBar = x => `<div class="bar thin"><i class="${gcls(x)}" style="width:${ok(x) ? Math.max(0, Math.min(100, x)) : 0}%"></i></div>`;
  const tag = ([text, cls]) => `<span class="tag ${cls}">${esc(text)}</span>`;
  function dateChip(s) {
    if (!s) return '<div class="when"><span>—</span><b>?</b></div>';
    const t = D(s), k = dayDiff(s);
    return `<div class="when${k >= 0 && k <= 1 ? ' soon' : k < 0 ? ' late' : ''}"><span>${k === 0 ? 'Today' : k === 1 ? 'Tmrw' : DOW[t.getDay()]}</span><b>${t.getDate()}</b></div>`;
  }

  /* ---------------- a class: its row, and its details ---------------- */
  function nextUp(c) {  // what's next for one class (any quarter), else what's waiting for a grade
    const mine = c.items.filter(i => i.s == null && !M.exception(i));
    const next = mine.filter(ahead).sort(byDue), waiting = mine.filter(turnedIn);
    if (next.length) return `${next[0].t} · ${dueText(next[0].due)}` + (next.length > 1 ? ` · ${next.length - 1} more` : '');
    if (waiting.length) return waiting.length === 1 ? `${waiting[0].t}: waiting for a grade` : `${waiting.length} waiting for grades`;
    return '';
  }
  function classRow(c, opts) {
    opts = opts || {};
    const pid = opts.pid || (ui.scope === 'year' ? 'year' : (shownPeriod() || { per: {} }).per.id);
    const has = pid === 'year' || c.periods.some(x => x.id === pid);
    const ep = pid === 'year' ? currentPid(c) : pid;  // the year leans on the quarter going on now
    const g = has ? grade(c, pid) : null, young = has && ok(g) && early(c, ep);
    const wk = pid !== 'year' && has && !young && !ended(c.periods.find(x => x.id === pid)) ? weekChange(c, pid) : null;
    const next = nextUp(c);
    const sub = young ? (pid === 'year' ? `${shortP(c.periods.find(x => x.id === ep))}: ` : '') + earlyNote(c, ep) + (next ? ` · ${next}` : '')
      : next || (!has ? `Graded in ${realPeriods(c).map(shortP).join(' and ')}` : ok(g) ? plural(pid === 'year' ? c.items.filter(i => i.s != null).length : gradedIn(c, pid), 'grade') : 'No grades yet');
    const note = ok(wk) && Math.abs(wk) >= 0.05 ? `<span class="cnote ${wk > 0 ? 'pos' : 'neg'}">${wk > 0 ? '▲' : '▼'} ${Math.abs(wk).toFixed(dec())}</span>` : '<span class="cnote"></span>';
    return `<button class="crow${ok(g) ? '' : ' none'}${young ? ' early' : ''}${opts.on ? ' on' : ''}" data-act="${opts.act || 'class'}" data-cid="${c.id}"${opts.on ? ' aria-current="true"' : ''} style="${cc(c)}">
      <div class="c1">${emo(c)}<span class="cname">${esc(c.short)}</span><b class="cg num ${young ? 'g-early' : gcls(g)}">${ok(g) ? p(g) : '—'}</b>${opts.chev === false ? '' : ICON.right}</div>
      <div class="csub">${esc(sub)}</div>${ok(g) && !young ? `<div class="c3">${bar(g)}${note}</div>` : ''}</button>`;
  }

  // everything about one class, simple first: its grade, the chart, how it's weighted (each part opens to its
  // assignments, each assignment opens to a slider), what's not graded yet, best moves, what PowerStats noticed,
  // then the year and how it's figured, folded
  /* ---------------- Gemini Notebook (v4): each class's study notebook, from Chief's data/notebooks.json ---------------- */
  const TEST_RE = /\b(test|exam|quiz|prueba|rq|reading quiz|l\.?e\.?q)\b/i;
  const isTest = i => !!(i && (i.test || TEST_RE.test(i.t || '')));
  function notebook(c) { return c && snap && snap.notebooks ? snap.notebooks[c.id] || null : null; }
  // a plain link (the phone opens it in Safari; the Mac sends data-nb links to Chrome)
  function nbLink(c, cls) {
    const nb = notebook(c);
    return nb ? `<a class="btn nb${cls ? ' ' + cls : ''}" href="${esc(nb.url)}" target="_blank" rel="noopener noreferrer" data-nb="1"><span class="nb-e" aria-hidden="true">${look(c).emoji}</span>Study in Gemini Notebook</a>` : '';
  }
  function nbSection(c) {
    const nb = notebook(c);
    if (!nb) return '';
    const nt = nb.next_test, n = nt && nt.due ? dayDiff(nt.due) : null;
    const when = nt && nt.due ? `${md(nt.due)}${n === 0 ? ' · today' : n === 1 ? ' · tomorrow' : n > 1 ? ` · in ${n} days` : ''}` : '';
    return `<section class="d-sec d-nb"><h3>Study<span>Gemini Notebook</span></h3><div class="nb-box">
      ${nt ? `<p class="nb-next"><b>${esc(nt.title)}</b>${when ? ` <span>${esc(when)}</span>` : ''}</p>` : ''}${nb.focus ? `<p class="nb-what">${esc(nb.focus)}</p>` : ''}
      ${nbLink(c)}</div></section>`;
  }
  // under a test in a list: its class's notebook
  function testNb(x) {
    const nb = x && x.c && isTest(x.i) && notebook(x.c);
    return nb ? `<a class="nbrow" href="${esc(nb.url)}" target="_blank" rel="noopener noreferrer" data-nb="1"><i aria-hidden="true">${look(x.c).emoji}</i>Study for it in Gemini Notebook<span aria-hidden="true">›</span></a>` : '';
  }

  function classDetail(c, opts) {
    const split = !!(opts && opts.split);
    const pid = pidOf(c);
    const periods = realPeriods(c).filter(x => hasGradesIn(c, x.id) || x.id === currentPid(c));
    const seg = periods.length > 1 || pid === 'year' ? `<div class="seg">${periods.map(x => `<button class="${pid === x.id ? 'on' : ''}" data-act="cpid" data-cid="${c.id}" data-v="${x.id}">${esc(shortP(x))}</button>`).join('')}<button class="${pid === 'year' ? 'on' : ''}" data-act="cpid" data-cid="${c.id}" data-v="year">Year</button></div>` : '';
    if (pid === 'year') return `<div class="d-top">${seg}</div>${yearDetail(c)}${nbSection(c)}`;
    const per = c.periods.find(x => x.id === pid);
    if (!per) return '<div class="empty">No grading periods in Schoology yet.</div>';
    const g = grade(c, pid), wk = weekChange(c, pid), chk = c.check && c.check[pid], y = M.year(c, c.items);
    const chips = [];
    if (per.sg != null) chips.push(`<span class="chip${chk && !chk.ok ? ' warn' : ''}">Schoology <b class="num">${per.sg}%</b></span>`);
    if (ok(wk) && Math.abs(wk) >= 0.05) chips.push(`<span class="chip"><b class="num ${wk > 0 ? 'pos' : 'neg'}">${wk > 0 ? '▲' : '▼'} ${Math.abs(wk).toFixed(dec())}</b> this week</span>`);
    if (ok(y.pct)) chips.push(`<span class="chip">Year <b class="num">${p(y.pct)}</b></span>`);
    const young = ok(g) && early(c, pid);
    const top = `<div class="d-top"><div class="d-grade"><b class="num ${young ? 'g-early' : gcls(g)}">${p(g)}</b><small>${esc(per.name)}${ok(g) ? (young ? ` · ${esc(earlyNote(c, pid))}` : ended(per) ? ' · final' : '') : ' · no grades yet'}</small></div>${seg}</div>
      ${ok(g) && !young ? bar(g) : ''}<div class="chips">${chips.join('')}</div>
      ${young ? `<p class="say early-say">Only ${plural(gradedIn(c, pid), 'grade')} in ${esc(per.name)} so far, so ${pc(g)} is just for now. It settles as more grades come in.</p>` : ''}${nbSection(c)}`;
    const series = classSeries(c, pid);
    const chartSec = series.length >= 2 ? `<section class="d-sec"><h3>This quarter<span>touch the line to read it</span></h3>${chart(series, { h: split ? 170 : 140 })}</section>` : '';

    const det = M.period(c, pid, c.items);
    const shown = det.cats.filter(r => r.items.length || r.pct != null || r.cat.w > 0);
    const cats = `<section class="d-sec d-cats"><h3>${det.weighted ? 'How it’s weighted' : 'Counted by total points'}<span>tap one for its work</span></h3><div class="list">`
      + (shown.length ? shown.map(r => catRow(c, pid, r, det)).join('') : `<div class="empty">Nothing in ${esc(per.name)} yet.</div>`) + '</div></section>';

    const left = pending(c, pid).sort(byDue);
    const leftSec = left.length ? `<section class="d-sec d-left"><h3>Not graded yet<span>tap one to try a score</span></h3><div class="list">${left.map(i => itemRow(c, pid, i, true)).join('')}</div></section>` : '';
    const later = c.items.filter(i => i.p !== pid && i.s == null && !M.exception(i) && i.due && ahead(i)).sort(byDue).slice(0, 4);
    const laterSec = later.length ? `<section class="d-sec d-later"><h3>Coming, counts later</h3><div class="list">${later.map(i => {
      const lp = c.periods.find(x => x.id === i.p);
      return `<div class="row">${dateChip(i.due)}<div class="main"><div class="t">${esc(i.t)}</div><div class="s">${lp && lp.w > 0 ? `Counts in ${esc(lp.name)}` : 'Doesn’t count toward a quarter'} · ${pts(maxOf(i))} pts${guessed(i) ? '?' : ''}</div></div></div>`;
    }).join('')}</div></section>` : '';
    let movesSec = '';
    const g2 = goalNow();
    if (g2 && g2.per.id === pid) {
      const mine = g2.moves.filter(m => m.course.id === c.id).sort((a, b) => likely(b) - likely(a)).slice(0, 3);
      const risky = g2.checks.filter(r => r.course.id === c.id);
      if (mine.length || risky.length) {
        movesSec = `<section class="d-sec d-moves"><h3>Best moves<span>for your average</span></h3><div class="list">${risky.map(r => `<button class="row" data-act="item" data-cid="${c.id}" data-id="${esc(r.item.id)}">
          <div class="main"><div class="t">${esc(r.item.t)}</div><div class="s">${tag(KIND.check)} no grade yet, not marked turned in</div></div>
          <div class="r"><b class="num neg">−${p(r.loss)}</b><small>if it’s a 0</small></div></button>`).join('')}${mine.map(mv => moveRow(mv, false)).join('')}</div></section>`;
      }
    }
    const said = noticed(c, pid, det);
    const noteSec = said ? `<section class="d-sec d-note"><h3>Noticed</h3><p class="note">${said}</p></section>` : '';
    const folds = fold(`how:${c.id}`, `How ${shortP(per)} is figured`, () => howFigured(c, pid, det)) + fold(`year:${c.id}`, 'The year', () => yearDetail(c));
    if (split) return `<div class="cd-l">${top}${chartSec}${cats}</div><div class="cd-r">${leftSec}${laterSec}${movesSec}${noteSec}${folds}</div>`;
    return top + chartSec + cats + leftSec + laterSec + movesSec + noteSec + folds;
  }

  function catRow(c, pid, r, det) {
    const k = r.cat, key = `${c.id}:${pid}:${k.id}`, open = !!ui.cats[key];
    const wtxt = det.weighted ? (k.w > 0 ? `${pts(k.w)}%` : 'no weight') : `${p(r.share * 100, 0)}% of pts`;
    const n = r.items.filter(i => i.s != null).length, left = r.items.filter(i => i.s == null && !M.exception(i)).length;
    let h = `<div class="cat${open ? ' open' : ''}"><button class="cat-h" data-act="cat" data-k="${esc(key)}">
      <div class="k1"><span class="kn">${esc(k.name)}</span><span class="kw num">${wtxt}</span><b class="kp num ${gcls(r.pct)}">${pc(r.pct, 1)}</b></div>
      <div class="k2">${pctBar(r.pct)}<span class="kc">${n}${left ? ` + ${left} to come` : ' graded'}</span>${ICON.chev}</div></button>`;
    if (open) {
      const bits = [];
      if (det.weighted && k.w > 0) {
        const share = r.share * 100;
        bits.push(`Counts ${pts(k.w)}% of the grade${Math.abs(share - k.w) > 0.05 && ok(r.pct) ? ` (${p(share, 1)}% for now, while some parts have no grades)` : ''}.`);
      }
      if (k.mode === 'equal') bits.push('Every assignment counts the same, whatever its points.');
      else if (ok(r.pct)) bits.push(`${pts(r.pts)} of ${pts(r.pos)} points.`);
      if (k.drop) bits.push(`Your lowest ${k.drop === 1 ? 'score is' : `${k.drop} scores are`} dropped.`);
      if (det.weighted && ok(r.pct) && k.w > 0) bits.push(`Adds ${p(r.contrib)} to the ${p(det.pct)}.`);
      h += `<div class="cat-b"><p class="knote">${bits.join(' ')}</p>${r.items.slice().sort((a, b) => -byDue(a, b)).map(i => itemRow(c, pid, i, false, r)).join('')}`;
      if (r.hidden) {
        const hd = r.hidden;
        h += `<div class="it off"><div class="main"><div class="t">A score Schoology counts but isn’t showing</div><div class="s">Schoology’s ${pc(c.csg[`${pid}-${k.id}`])} for ${esc(k.name)} needs it</div></div><div class="r"><b class="num">${hd.q != null ? pc(hd.q, 0) : `≈${pts(Math.round(hd.s))}/${pts(hd.m)}`}</b></div></div>`;
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  // one assignment inside a class; tapped, a slider opens right under it (a redo for graded work)
  function itemRow(c, pid, i, withDate, r) {
    const open = ui.item === i.id, ex = M.exception(i), dropped = r && r.dropped.has(i.id);
    const tags = [];
    if (ex) tags.push(`<span class="tag ${/missing/i.test(ex) ? 'bad' : ''}">${esc(ex)}</span>`);
    if (dropped) tags.push('<span class="tag">dropped</span>');
    if (i.s == null && turnedIn(i)) tags.push('<span class="tag">turned in</span>');
    let right;
    if (i.s != null && i.m != null) right = `<b class="num">${pts(i.s)}/${pts(i.m)}</b><small class="num">${i.m ? p(i.s / i.m * 100, 1) + '%' : 'extra'}</small>`;
    else if (/missing/i.test(ex)) right = `<b class="num neg">0/${pts(maxOf(i))}</b><small>counts as 0</small>`;
    else if (ex) right = '<b class="faint">—</b><small>doesn’t count</small>';
    else {
      const lo = scoreAt(c, pid, i.id, 0), hi = scoreAt(c, pid, i.id, maxOf(i));
      right = `<b class="num"><span class="${gcls(lo)}">${p(lo, 1)}</span><span class="faint">–</span><span class="${gcls(hi)}">${p(hi, 1)}</span></b><small>at 0–100%</small>`;
    }
    const off = (ex && !/missing/i.test(ex)) || dropped;
    return `<div class="it-w${open ? ' open' : ''}"><button class="it${off ? ' off' : ''}" data-act="item" data-cid="${c.id}" data-id="${esc(i.id)}">
      ${withDate ? dateChip(i.due) : ''}<div class="main"><div class="t">${esc(i.t)}</div>
      <div class="s">${withDate ? `${esc(catOf(c, i.c).name)} · ${pts(maxOf(i))} pts${guessed(i) && i.s == null ? '?' : ''}` : (i.due ? esc(md(i.due)) : 'no date')} ${tags.join(' ')}</div></div><div class="r">${right}</div></button>
      ${open ? tryPanel(c, pid, i) : ''}</div>`;
  }

  // a slider: what a score on this one does to the class and to the average (for graded work: if it were redone)
  function tryPanel(c, pid, i) {
    const graded = i.s != null;
    const usual = (() => { const q = M.project(c, pid, c.items).find(j => j.id === i.id); return q && ok(q.usual) ? q.usual : 85; })();
    const v = ui.tryv != null ? ui.tryv : graded ? 100 : Math.round(usual);
    const redo = graded ? M.redoLevel(c, i) : null;
    const note = redo === 'never' ? 'Tests can’t be redone at your school; this only shows what it would have done.'
      : redo === 'usually' ? 'Redos are usually allowed in this class.' : redo ? 'Only if your teacher allows a redo or corrections.' : '';
    return `<div class="try"><div class="try-h"><span>${graded ? 'If you redid it and got' : 'If you get'}</span><b class="num" data-try="v">${v}%</b></div>
      <input class="slider" type="range" min="0" max="100" step="1" value="${v}" style="--v:${v}%" data-in="try" data-cid="${c.id}" data-id="${esc(i.id)}" data-pid="${pid}" aria-label="Score to try">
      <div class="try-out"><div>${esc(c.short)}<b class="num" data-try="c"></b></div><div>Your average<b class="num" data-try="a"></b></div></div>
      ${graded ? (note ? `<p class="needs">${note}</p>` : '') : `<p class="needs">${needsText(c, pid, i)}</p>`}</div>`;
  }
  function needsText(c, pid, i) {  // to keep the grade where it is, and for the next marks (and the goal)
    const base = grade(c, pid), m = maxOf(i);
    if (!ok(base) || !m) return '';
    const need = t => M.solve(c, pid, c.items, [{ id: i.id, m }], t);
    const bits = [], keep = need(base - 0.005);
    if (keep && keep.status === 'ok') bits.push(`<b>${p(keep.r * 100, 0)}%</b> keeps ${p(base, 1)}`);
    const marks = [70, 75, 80, 85, 90, 93, 95, 97].filter(x => x > base + 0.25).slice(0, 2);
    if (goalPct() > base + 0.25 && !marks.includes(goalPct())) marks.push(goalPct());
    for (const t of marks.sort((a, b) => a - b)) {
      const r = need(t);
      if (!r) continue;
      if (r.status === 'ok') bits.push(`<b>${p(r.r * 100, 0)}%</b> for ${t}`);
      else if (r.status === 'reach') { bits.push(`${t} is out of reach (100% gets ${p(r.hi, 1)})`); break; }
    }
    return bits.length ? `On this one: ${bits.join(' · ')}` : '';
  }
  // the slider moved: fill in the numbers right there, without drawing everything again
  function updateTry(el) {
    const c = course(el.dataset.cid), pid = el.dataset.pid, i = c && c.items.find(j => j.id === el.dataset.id);
    if (!i) return;
    const v = +el.value, box = el.closest('.try');
    ui.tryv = v;
    el.style.setProperty('--v', v + '%');
    const before = grade(c, pid), after = scoreAt(c, pid, i.id, v / 100 * maxOf(i));
    const a0 = average(pid).pct, a1 = average(pid, { id: c.id, pct: after }).pct;
    const diff = (a, b) => (ok(a) && ok(b) ? `<small class="${b - a > 0.004 ? 'pos' : b - a < -0.004 ? 'neg' : 'faint'}">${sgn(b - a)}</small>` : '');
    box.querySelector('[data-try=v]').textContent = `${v}%`;
    box.querySelector('[data-try=c]').innerHTML = `<span class="${gcls(after)}">${p(after)}</span>${diff(before, after)}`;
    box.querySelector('[data-try=a]').innerHTML = `<span class="${gcls(a1)}">${p(a1)}</span>${diff(a0, a1)}`;
  }

  function moveRow(mv, withClass) {
    const i = mv.item, c = mv.course;
    const line = mv.kind === 'upcoming' ? `${dueText(i.due)} · ${pts(mv.m)} pts${guessed(i) ? '?' : ''} · usual ${p(mv.usual, 0)}%` : mv.kind === 'missing' ? 'missing, counts as 0' : `got ${pts(i.s)}/${pts(mv.m)}`;
    return `<button class="row" data-act="${withClass ? 'assignment' : 'item'}" data-cid="${c.id}" data-id="${esc(i.id)}"><div class="main"><div class="t">${esc(i.t)}</div>
      <div class="s">${tag(kindOf(mv))} ${withClass ? `${esc(c.short)} · ` : ''}${esc(line)}</div></div>
      <div class="r"><b class="num pos">+${p(mv.gain)}</b><small class="num">+${p(mv.gainClass, 1)} class</small></div></button>`;
  }

  function noticed(c, pid, det) {
    const out = [];
    const cats = det.cats.filter(r => ok(r.pct) && r.share > 0);
    if (cats.length > 1) {
      const worst = cats.slice().sort((a, b) => b.share * (100 - b.pct) - a.share * (100 - a.pct))[0];
      if (worst.pct < 95) out.push(`<b>${esc(worst.cat.name)}</b> ${det.weighted ? `(${pts(worst.cat.w)}% of the grade)` : `(${p(worst.share * 100, 0)}% of the points)`} is where this class loses the most: you’re at ${pc(worst.pct, 1)}.`);
    }
    const kd = (learned().kinds || {})[c.id];
    if (!out.length && kd && kd.test && kd.test[1] >= 2) {
      const rest = Object.entries(kd).filter(([kk]) => kk !== 'test').map(([, v]) => v), n = rest.reduce((a, v) => a + v[1], 0);
      const avg = n ? rest.reduce((a, v) => a + v[0] * v[1], 0) / n : null;
      if (ok(avg) && avg - kd.test[0] >= 8) out.push(`Your tests here average ${p(kd.test[0], 0)}%, everything else ${p(avg, 0)}%.`);
    }
    const sp = (learned().speed || {})[c.id];
    if (sp && sp.n >= 3) out.push(`Grades usually show up ${sp.d < 0.3 ? 'on the day they’re due' : sp.d < 1.5 ? 'about a day after they’re due' : `about ${p(sp.d, 0)} school days after they’re due`}.`);
    return out.join(' ');
  }

  function fold(key, title, body) {
    const open = !!ui.folds[key];
    return `<section class="d-fold${open ? ' open' : ''}"><button class="fold-h" data-act="fold" data-k="${esc(key)}"><span>${esc(title)}</span>${ICON.chev}</button>${open ? `<div class="fold-b">${body()}</div>` : ''}</section>`;
  }
  function howFigured(c, pid, det) {
    const per = c.periods.find(x => x.id === pid);
    let rows = '';
    if (det.weighted) {
      for (const r of det.cats) {
        if (!(r.cat.w > 0)) continue;
        rows += `<tr><td>${esc(r.cat.name)}</td><td class="num">${ok(r.pct) ? `${p(r.share * 100, 1)}% × ${pc(r.pct)}` : `<span class="faint">${pts(r.cat.w)}%, no grades yet</span>`}</td><td class="num">${ok(r.pct) ? p(r.contrib) : '—'}</td></tr>`;
      }
      rows = `<table class="ex"><tr><th>Category</th><th>Weight × grade</th><th>Adds</th></tr>${rows}<tr class="tot"><td colspan="2">${esc(per.name)}</td><td class="num">${pc(det.pct)}</td></tr></table>`;
    } else {
      for (const r of det.cats) if (ok(r.pct)) rows += `<tr><td>${esc(r.cat.name)}</td><td class="num">${pts(r.pts)} / ${pts(r.pos)}</td><td class="num">${pc(r.pct, 1)}</td></tr>`;
      rows = `<table class="ex"><tr><th>Category</th><th>Points</th><th>Grade</th></tr>${rows}<tr class="tot"><td>All points</td><td class="num">${pts(det.pts)} / ${pts(det.pos)}</td><td class="num">${pc(det.pct)}</td></tr></table>`;
    }
    const notes = [];
    if (det.weighted && det.tw < 99.99 && det.tw > 0) notes.push('Categories with no grades yet don’t count, so the others are scaled up to 100%, like Schoology does.');
    if (per.sg != null && ok(det.pct)) notes.push(`Schoology shows ${per.sg}% because it rounds to whole numbers.`);
    if (c.check && c.check[pid] && c.check[pid].ok) notes.push('Checked against Schoology’s own numbers at the last sync: they match.');
    notes.push(`${per.name} counts ${pts(per.w)}% of the year.`);
    return `${rows}<p class="note">${notes.join(' ')}</p>`;
  }
  function yearDetail(c) {
    const y = M.year(c, c.items), cur = currentPid(c);
    const yg = ui.ygoal && ui.ygoal[c.id] != null ? ui.ygoal[c.id] : [70, 75, 80, 85, 90, 93, 95, 97, 99].find(x => !ok(y.pct) || x >= y.pct + 0.5) || 100;
    return `<div class="parts">${y.parts.map(part => `<div class="part${part.p.id === cur ? ' cur' : ''}"><b class="num ${gcls(part.pct)}">${p(part.pct, 1)}</b><span>${esc(shortP(part.p))}</span><small class="num">${pts(part.p.w)}%</small></div>`).join('')}</div>
      <div class="goalrow"><span>Goal for the year</span><div class="stepper"><button data-act="ygoal" data-cid="${c.id}" data-v="-1" aria-label="Lower">−</button><b class="num" data-ygoal="${c.id}">${pts(yg)}</b><button data-act="ygoal" data-cid="${c.id}" data-v="1" aria-label="Raise">+</button></div></div>
      <div data-yans="${c.id}">${yearAnswer(c, yg)}</div>`;
  }
  function yearAnswer(c, goal) {
    const r = M.yearNeed(c, c.items, goal);
    if (!r) return `<p class="say">${M.year(c, c.items).pct == null ? 'No grades yet this year.' : 'Every part of the year has a grade already.'}</p>`;
    const rest = r.y.parts.filter(x => x.pct == null).map(x => shortP(x.p));
    let h = `<p class="say">To finish at <b>${pc(goal, goal % 1 ? 1 : 0)}</b>, average <b>${pc(r.need, 1)}</b> across ${esc(rest.join(', '))}${r.need > 100 ? ', more than 100%, so not reachable' : r.need <= 0 ? '. You’re already there' : ''}.</p>`;
    const exam = r.y.parts.find(x => /exam/i.test(x.p.name) && x.pct == null), others = r.y.parts.filter(x => x.pct == null && x !== exam);
    if (exam && others.length && ok(r.y.pct)) {
      const assume = {};
      for (const x of others) assume[x.p.id] = r.y.pct;
      const y2 = M.year(c, c.items, assume), needExam = (goal * y2.all - y2.pct * y2.done) / exam.p.w;
      h += `<p class="say">If ${esc(others.map(x => shortP(x.p)).join(', '))} stay at ${p(r.y.pct, 1)}%, you’d need <b>${pc(needExam, 1)}</b> on the ${esc(longP(exam.p))}${needExam > 100 ? ' (not reachable that way)' : needExam <= 0 ? ' (any score works)' : ''}.</p>`;
    }
    return h;
  }

  /* ---------------- one assignment, from anywhere ---------------- */
  function assignmentDetail(c, i) {
    const pid = i.p, per = c.periods.find(x => x.id === pid), ex = M.exception(i), mv = moveFor(i.id);
    const counts = per && per.w > 0;
    let h = `<div class="a-top"><div class="a-meta">${esc(c.name)} · ${esc(catOf(c, i.c).name)}</div>`;
    if (i.s != null && i.m != null) h += `<div class="a-score"><b class="num ${gcls(i.m ? i.s / i.m * 100 : null)}">${pts(i.s)}<small>/${pts(i.m)}</small></b><span class="num">${i.m ? p(i.s / i.m * 100, 1) + '%' : 'extra credit'}</span></div>`;
    else h += `<div class="a-score"><b class="num faint">${/missing/i.test(ex) ? '0' : '—'}<small>/${pts(maxOf(i))}${guessed(i) ? '?' : ''}</small></b><span>${ex ? esc(ex) : turnedIn(i) ? 'Turned in, waiting for a grade' : 'Not graded yet'}</span></div>`;
    h += `<div class="chips"><span class="chip">${i.due ? `Due ${esc(dueText(i.due))}${dayDiff(i.due) > 6 || dayDiff(i.due) < -1 ? '' : ''}` : 'No due date'}</span>${per ? `<span class="chip">${counts ? `Counts in ${esc(per.name)}` : 'Doesn’t count toward a quarter'}</span>` : ''}${mv ? tag(kindOf(mv)) : ''}</div></div>`;
    if (counts) {
      if (i.s != null) {
        const without = M.without(c, pid, c.items, i.id), cur = grade(c, pid);
        if (ok(without) && ok(cur)) h += `<p class="say">It moved ${esc(c.short)} <b class="${cur - without >= 0 ? 'pos' : 'neg'}">${sgn(cur - without)}</b> (from ${p(without)} to ${p(cur)}).</p>`;
      } else if (!ex) {
        const lo = scoreAt(c, pid, i.id, 0), hi = scoreAt(c, pid, i.id, maxOf(i));
        h += `<p class="say">${esc(c.short)} ends up between <b class="${gcls(lo)}">${p(lo, 1)}</b> (a 0) and <b class="${gcls(hi)}">${p(hi, 1)}</b> (100%).${mv && mv.gain >= 0.05 && !goalNow().young(c) ? ` Acing it adds <b class="pos">+${p(mv.gain)}</b> to your average.` : ''}</p>`;
      }
      if (!ex || /missing/i.test(ex)) { const keep = ui.item; ui.item = i.id; h += tryPanel(c, pid, i); ui.item = keep; }
    }
    if (i.s != null && mv && mv.kind === 'redo') h += `<p class="note">${mv.redo === 'usually' ? 'Redos are usually allowed in this class: full credit adds' : 'If your teacher allows a redo, full credit adds'} <b class="pos">+${p(mv.gain)}</b> to your average.</p>`;
    return h;
  }

  /* ---------------- the path to the goal, and the average's table ---------------- */
  function pathDetail() {
    const g = goalNow();
    if (!g) return '<div class="empty">No quarter yet.</div>';
    const goal = g.goal, nowPct = average(g.per.id).pct;
    let h = '';
    if (g.final) {
      const leaks = g.leaks.slice(0, 5);
      h += `<p class="say">${esc(g.per.name)} is over. These cost it the most, so they’re where ${g.next ? esc(shortP(g.next)) : 'the next quarter'} can start strong:</p>`;
      h += `<div class="list">${leaks.map(leakRow).join('')}</div>`;
      return h;
    }
    if (earlyQuarter(g.per.id)) {
      const tests = upcomingTests(14);
      h += `<p class="say">${esc(g.per.name)} just started, and no class has 3 grades yet, so your average (${pc(nowPct)}) is just for now. The path to ${pts(goal)}% shows up once there’s more to go on. ${tests.length ? 'Until then, the tests and quizzes coming up count the most:' : 'Until then, ace what’s coming.'}</p>`;
      return h + (tests.length ? `<div class="tcards">${tests.slice(0, 5).map(testCard).join('')}</div>` : '');
    }
    const youngCs = courses().filter(c => early(c, g.per.id));
    if (youngCs.length) h += `<p class="note">${esc(youngCs.map(c => c.short).join(' and '))} ${youngCs.length === 1 ? 'has' : 'have'} only a grade or two this quarter, so ${youngCs.length === 1 ? 'its grade is' : 'theirs are'} just for now.</p>`;
    if (ok(g.projected.pct) && g.projected.pct >= goal) h += `<p class="say">On track: if what’s left goes like usual you finish ${esc(g.per.name)} at <b>${pc(g.projected.pct)}</b>. These add a cushion:</p><div class="list">${g.moves.slice().sort((a, b) => likely(b) - likely(a)).slice(0, 5).map(mv => moveRow(mv, true)).join('')}</div>`;
    else if (g.path.length) {
      h += `<p class="say">From <b>${pc(nowPct)}</b>, in order: what’s still to come, then redos your class usually allows, then ones to ask about. The number is your average after each step.</p>`;
      h += `<ol class="steps">${g.path.map((x, k) => `<li><button class="row" data-act="assignment" data-cid="${x.move.course.id}" data-id="${esc(x.move.item.id)}"><span class="stepn num">${k + 1}</span>
        <div class="main"><div class="t">${verb(x.move)} ${esc(x.move.item.t)}</div><div class="s">${tag(kindOf(x.move))} ${esc(x.move.course.short)}</div></div>
        <div class="r"><b class="num ${x.avg >= goal - 1e-9 ? 'pos' : ''}">${p(x.avg)}</b><small class="num">+${p(x.move.gain)}</small></div></button></li>`).join('')}</ol>`;
    } else h += `<p class="say">Nothing left this quarter moves the average much. Every point still counts toward the year.</p>`;
    if (g.checks.length) h += `<h3 class="h3">Make sure these are in</h3><div class="list">${g.checks.map(r => `<button class="row" data-act="assignment" data-cid="${r.course.id}" data-id="${esc(r.item.id)}">${dateChip(r.item.due)}<div class="main"><div class="t">${esc(r.item.t)}</div><div class="s">${esc(r.course.short)} · no grade, not marked turned in</div></div><div class="r"><b class="num neg">−${p(r.loss)}</b><small>if it’s a 0</small></div></button>`).join('')}</div>`;
    if (g.leaks.length) h += `<h3 class="h3">Where you lose the most points</h3><div class="list">${g.leaks.slice(0, 5).map(leakRow).join('')}</div>`;
    return h;
  }
  const leakRow = x => `<button class="row" data-act="class" data-cid="${x.course.id}"><div class="main"><div class="t">${esc(x.course.short)} · ${esc(x.cat.name)}</div>
    <div class="s">${M.weighted(x.course) ? `${pts(x.cat.w)}% of the class` : `${p(x.share * 100, 0)}% of its points`} · you’re at ${pc(x.pct, 1)}</div></div>
    <div class="r"><b class="num neg">−${p(x.lost)}</b><small>off the average</small></div></button>`;
  function averageDetail() {
    const sp = shownPeriod(), gp = sp && sp.per, scope = ui.scope === 'year' || !gp ? 'year' : 'period';
    const rows = courses().map(c => ({ course: c, pct: scope === 'year' ? M.year(c, c.items).pct : grade(c, gp.id) }));
    const o = M.overall(rows, settings);
    const t = rows.map(r => { const u = o.used.find(x => x.course.id === r.course.id); return `<tr${u ? '' : ' class="faint"'}><td>${esc(r.course.short)}</td><td class="num">${u ? pc(u.pct) : ok(r.pct) ? 'left out' : 'no grade'}</td><td class="num">${u ? pts(u.credits) : '—'}</td></tr>`; }).join('');
    return `<table class="ex"><tr><th>Class</th><th>Grade</th><th>Credits</th></tr>${t}<tr class="tot"><td>Average</td><td class="num">${pc(o.pct)}</td><td class="num">${pts(o.credits)}</td></tr></table>
      <p class="note">Each grade times its credits, divided by ${pts(o.credits)} credits. Canisius doesn’t publish its exact rule, so this uses the credits from its graduation list (Comp Sci, Phys Ed and Ignatian Service are half credits)${settings.apBonus ? ` and adds ${settings.apBonus} points to AP classes` : ''}. Change it in Settings.</p>`;
  }

  /* ---------------- coming up and new grades (every class) ---------------- */
  // everything due from today on, from the gradebook and (on the phone) the school calendar, in order
  function upcoming(days) {
    const g = goalNow(), cut = new Date(dayStart(now()).getTime() + (days || 14) * 864e5);
    const out = courses().flatMap(c => c.items.filter(i => i.s == null && !M.exception(i) && i.due && ahead(i) && D(i.due) < cut)
      .map(i => ({ c, i, mv: g && !g.young(c) ? g.moves.find(m => m.item.id === i.id && m.kind === 'upcoming') : null })));
    for (const e of snap.cal || []) {  // the calendar's Schoology work that isn't in the gradebook (readings, forms)
      const c = courses().find(k => k.id === e.course) || null, due = e.date + (e.time ? `T${e.time}` : '');
      if (!out.some(x => x.i.id === e.sid) && D(due) < cut && (due.length === 10 ? due >= todayISO() : due > nowISO())) {
        out.push({ c, i: { id: e.sid, t: e.title, due, cal: true, details: e.details, test: e.test }, mv: null });
      }
    }
    return out.sort((a, b) => byDue(a.i, b.i));
  }
  function recentGrades(days) {
    const ev = (snap.events || []).filter(e => dayDiff(e.at) >= -(days || 14) && course(e.course));
    return ev.map(e => ({ c: course(e.course), i: course(e.course).items.find(i => i.id === e.item), e })).filter(x => x.i);
  }
  function upRow(x, opts) {  // one thing due, for lists outside a class
    const { c, i, mv } = x, per = c && c.periods.find(p2 => p2.id === i.p), g = goalNow();
    const right = mv ? `<b class="num pos">+${p(mv.gain)}</b><small>if you ace it</small>`
      : i.cal ? `<b class="faint">—</b><small>not graded</small>`
      : per && !(per.w > 0) ? '<b class="faint">—</b><small>doesn’t count</small>'
      : g && per && per.id !== g.per.id ? `<b class="faint num">${esc(shortP(per))}</b><small>counts then</small>` : `<b class="num">${pts(maxOf(i))}</b><small>pts${guessed(i) ? '?' : ''}</small>`;
    const test = isTest(i);
    // v5: homework is a checklist row with its class's color down the side; a test says so in words
    return `<button class="row u${test ? ' test' : ''}" data-act="assignment" data-cid="${c ? c.id : ''}" data-id="${esc(i.id)}" style="${cc(c)}">${opts && opts.date === false ? '' : dateChip(i.due)}
      <div class="main"><div class="t">${test ? `<span class="tag test">${testWord(i)}</span>` : ''}${esc(i.t)}</div><div class="s">${c ? emo(c) : ''}${esc(c ? c.short : 'School')}${i.due && i.due.length > 10 && i.due.slice(11) !== '23:59' ? ` · ${esc(clock(D(i.due)))}` : ''}${i.details ? ` · ${esc(i.details)}` : ''}</div></div>
      <div class="r">${right}</div></button>`;
  }
  const testWord = i => (/exam/i.test(i.t || '') ? 'Exam' : /quiz|\brq\b|prueba/i.test(i.t || '') ? 'Quiz' : 'Test');
  const countdown = s => { const k = dayDiff(s); return k <= 0 ? ['Today', ''] : k === 1 ? ['Tmrw', ''] : [String(k), 'days']; };
  // v5: a test or quiz gets its own card: how many days are left, big, and its notebook right under it
  function testCard(x) {
    const { c, i } = x, [n, unit] = countdown(i.due), k = dayDiff(i.due);
    return `<div class="tcard${k <= 2 ? ' soon' : ''}" style="${cc(c)}"><button class="tc-b" data-act="assignment" data-cid="${c ? c.id : ''}" data-id="${esc(i.id)}">
      <span class="tc-when${unit ? '' : ' word'}"><b class="num">${n}</b>${unit ? `<small>${unit}</small>` : ''}</span>
      <span class="main"><span class="tag test">${testWord(i)}</span><span class="t">${esc(i.t)}</span><span class="s">${c ? emo(c) : ''}${esc(c ? c.short : 'School')} · ${esc(DAY[D(i.due).getDay()])} ${esc(md(i.due))}</span></span></button>${testNb(x)}</div>`;
  }
  const upcomingTests = days => upcoming(days || 14).filter(x => isTest(x.i));
  // v5: a new grade leads with the score, in its color, so it can't be mistaken for homework
  function gradeRow(x) {
    const { c, i, e } = x, cur = M.periodPct(c, i.p, c.items), before = M.without(c, i.p, c.items, i.id);
    const d = ok(cur) && ok(before) ? cur - before : null, q = i.m ? i.s / i.m * 100 : null;
    return `<button class="row gr" data-act="assignment" data-cid="${c.id}" data-id="${esc(i.id)}" style="${cc(c)}"><span class="score ${gcls(q)}"><b class="num">${ok(q) ? p(q, 0) : '+'}</b><small>${ok(q) ? '%' : 'extra'}</small></span>
      <div class="main"><div class="t">${esc(i.t)}</div>
      <div class="s">${emo(c)}${esc(c.short)} · ${esc(relDay(e.at))}</div></div>
      <div class="r"><b class="num">${pts(i.s)}/${pts(i.m)}</b><small>${ok(d) && Math.abs(d) >= 0.005 ? `<span class="${d > 0 ? 'pos' : 'neg'}">${sgn(d)}</span> ${esc(c.short)}` : 'points'}</small></div></button>`;
  }

  /* ---------------- v5.1: are the grade checks running? ---------------- */
  // Checks run on school days (Monday to Friday) from 7 AM to 10:30 PM. Only that check time counts: if more than 3
  // hours of it have passed since the last successful check, the checks have stopped, so the screens say so in words.
  // Nights and weekends don't count, so it doesn't cry wolf every night or weekend. It only reads the last-check time.
  const CHECK_FROM = [7, 0], CHECK_TO = [22, 30], PAUSE_MIN = 180;
  function checkMinutes(a, b) {
    let total = 0, day = dayStart(a);
    for (let k = 0; day < b && k < 400; k++) {
      if (day.getDay() !== 0 && day.getDay() !== 6) {
        const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
        const lo = Math.max(a, new Date(y, m, d, CHECK_FROM[0], CHECK_FROM[1])), hi = Math.min(b, new Date(y, m, d, CHECK_TO[0], CHECK_TO[1]));
        if (hi > lo) total += (hi - lo) / 6e4;
      }
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    }
    return total;
  }
  function paused() {
    const t = snap && (snap.checked || snap.at);
    if (!t) return null;
    return checkMinutes(D(t), now()) > PAUSE_MIN ? { since: t } : null;
  }
  function pausedNote() {
    const x = paused();
    return x ? `<p class="paused" role="note"><span class="pz-i" aria-hidden="true">⏸︎</span><span><b>Grade checks paused since ${esc(synced(x.since))}.</b> Grades may be behind.</span></p>` : '';
  }

  /* ---------------- settings ---------------- */
  function settingsBody(extra) {
    const goal = goalPct();
    const rows = courses().map(c => {
      const cr = settings.credits[c.id] != null ? +settings.credits[c.id] : c.credits;
      return `<div class="set"><div class="main">${esc(c.short)}<small>${c.ap ? 'AP · ' : ''}${plural(cr, 'credit')}</small></div>
        <div class="mini">${[0.5, 1].map(x => `<button class="${cr === x ? 'on' : ''}" data-act="credits" data-id="${c.id}" data-v="${x}">${x === 0.5 ? '½' : '1'}</button>`).join('')}</div>
        <label class="switch" aria-label="Count ${esc(c.short)}"><input type="checkbox" data-act="include" data-id="${c.id}"${settings.include[c.id] === false ? '' : ' checked'}><span></span></label></div>`;
    }).join('');
    const t = snap.checked || snap.at;
    return `<h4 class="h4">Goal</h4><div class="set"><div class="main">Every quarter above<small>The path to it plans toward this</small></div>
        <div class="mini">${[85, 88, 90, 92, 95].map(x => `<button class="${goal === x ? 'on' : ''}" data-act="goalset" data-v="${x}">${x}</button>`).join('')}</div></div>
      <h4 class="h4">Your average</h4>${rows}
      <div class="set"><div class="main">AP bonus<small>Points added to AP classes in the average</small></div><div class="mini">${[0, 5, 10].map(x => `<button class="${(settings.apBonus || 0) === x ? 'on' : ''}" data-act="ap" data-v="${x}">${x ? '+' + x : 'None'}</button>`).join('')}</div></div>
      <h4 class="h4">Numbers</h4><div class="set"><div class="main">Decimal places</div><div class="mini">${[1, 2].map(x => `<button class="${dec() === x ? 'on' : ''}" data-act="dec" data-v="${x}">${x === 1 ? '87.1' : '87.09'}</button>`).join('')}</div></div>
      ${extra || ''}
      <p class="note">Last checked Schoology ${esc(synced(t))}; grades last changed ${esc(synced(snap.at))}. Your Mac checks Schoology every hour on weekdays (7 AM to 10 PM) and twice a day on weekends, checks the math against Schoology’s own numbers, and uploads a copy locked with your code. Nothing here can change Schoology.</p>`;
  }

  /* ---------------- taps the shared pieces handle ---------------- */
  const ACT = {
    cat: el => { const k = el.dataset.k; if (ui.cats[k]) delete ui.cats[k]; else ui.cats[k] = 1; return true; },
    item: el => { const id = el.dataset.id; ui.item = ui.item === id ? null : id; ui.tryv = null; return true; },
    fold: el => { const k = el.dataset.k; ui.folds[k] = !ui.folds[k]; return true; },
    cpid: el => { ui.pid[el.dataset.cid] = el.dataset.v; ui.item = null; return true; },
    scope: el => { ui.scope = el.dataset.v; ui.pid = {}; ui.item = null; save(); return true; },
    quarter: el => {
      const v = el.dataset.v;
      ui.pid = {}; ui.item = null; goalCache = null;
      if (v === 'year') ui.scope = 'year';
      else {
        ui.scope = 'period'; ui.q = null;
        const d = shownPeriod();
        ui.q = d && d.per.id === v ? null : v;  // the current quarter needs no pick
      }
      save();
      return true;
    },
    ygoal: el => {
      const c = course(el.dataset.cid), cur = ui.ygoal && ui.ygoal[c.id] != null ? ui.ygoal[c.id] : null;
      const y = M.year(c, c.items), base = cur != null ? cur : [70, 75, 80, 85, 90, 93, 95, 97, 99].find(x => !ok(y.pct) || x >= y.pct + 0.5) || 100;
      ui.ygoal = ui.ygoal || {};
      ui.ygoal[c.id] = Math.max(0, Math.min(100, base + +el.dataset.v));
      const root2 = el.closest('.fold-b, .sheet, .panel, body');
      const b = root2.querySelector(`[data-ygoal="${c.id}"]`), a = root2.querySelector(`[data-yans="${c.id}"]`);
      if (b) b.textContent = pts(ui.ygoal[c.id]);
      if (a) a.innerHTML = yearAnswer(c, ui.ygoal[c.id]);
      return false;  // drawn in place
    },
    goalset: el => { settings.goal = +el.dataset.v; goalCache = null; saveSet(); return true; },
    credits: el => { settings.credits[el.dataset.id] = +el.dataset.v; goalCache = null; saveSet(); return true; },
    include: el => { settings.include[el.dataset.id] = el.checked; goalCache = null; saveSet(); return true; },
    ap: el => { settings.apBonus = +el.dataset.v; goalCache = null; saveSet(); return true; },
    dec: el => { settings.dec = +el.dataset.v; saveSet(); return true; },
  };
  const saveSet = () => H.set('settings', settings);
  const save = () => H.set('view3', { scope: ui.scope });
  // a tap on a shared piece: true when it was one of ours (then the host draws again)
  function act(name, el) {
    if (!ACT[name]) return false;
    if (ACT[name](el) !== false) H.redraw(name);
    return true;
  }
  function input(el) { if (el.dataset.in === 'try') updateTry(el); }
  function fillTries(rootEl) { for (const s of rootEl.querySelectorAll('.slider')) updateTry(s); }
  // v5: switches say which choice is on to screen readers too, not only with color
  function a11y(rootEl) {
    for (const b of (rootEl || document).querySelectorAll('.seg button, .mini button')) b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
  }

  /* ---------------- the host's way in ---------------- */
  function init(host) {
    H = host;
    settings = Object.assign({ credits: {}, include: {}, apBonus: 0, dec: 2, goal: 90 }, H.get('settings') || {});
    Object.assign(ui, { scope: (H.get('view3') || {}).scope || 'period' });
  }
  function setSnap(s) { snap = s; goalCache = null; }

  root.PSCore = {
    init, setSnap, act, input, fillTries, mountCharts, a11y, ui,
    get snap() { return snap; }, get settings() { return settings; },
    // data
    paused, pausedNote, courses, course, shownPeriod, currentPid, goalNow, status, average, grade, upcoming, recentGrades, averageSeries, classSeries,
    learned, pidOf, likely, weekChange, previousPeriod, quarters, quarterSeg, early, earlyQuarter, gradedIn, notebook, isTest,
    // pieces
    classRow, classDetail, nbLink, testNb, testCard, upcomingTests, assignmentDetail, pathDetail, averageDetail, settingsBody, upRow, gradeRow, moveRow, chart, avgBlock, classChart, look, bar, dateChip, tag, kindOf,
    // words
    fmt: { esc, p, pc, pts, sgn, gcls, md, clock, D, dueText, relDay, synced, plural, shortP, cap, dayDiff, todayISO },
  };
})(window);
