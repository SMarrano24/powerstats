/* PowerStats math: the same rules as powerstats.py (which checks them against Schoology on every sync), plus
   what-ifs, "what do I need" answers, the year and the overall average. No page code in here, so test_engine.js
   can check it on the Mac. A course looks like powerstats.py's snapshot(): periods [{id, name, w, sg}], cats
   [{id, name, w, mode, drop}], hid {"period-category": {s, m} or {q}}, items [{id, p, c, t, s, m, mg, due, f}]. */
(function (root) {
  'use strict';
  const EXCLUDED = /^(exempt|excused)/i;

  const exception = i => { const f = String(i.f || ''), k = f.indexOf('x:'); return k < 0 ? '' : f.slice(k + 2); };
  const sum = a => a.reduce((x, y) => x + y, 0);

  // A course's assignments with this phone's what-ifs on top: o = changed scores {itemId: {s, m}},
  // x = pretend assignments [{id, p, c, t, s, m}]. Changed items keep the original as `orig`.
  function itemsWith(course, wi) {
    const o = (wi && wi.o) || {};
    const out = course.items.map(i => {
      const w = o[i.id];
      if (!w || (w.s == null && w.m == null)) return i;
      const j = Object.assign({}, i, { orig: i });
      if (w.m != null) j.m = w.m;
      if (w.s != null) {  // a what-if score always counts, even on an assignment Schoology marked Exempt or Missing
        j.s = w.s;
        j.wi = true;
        if (j.m == null) j.m = i.mg;
        j.f = '';
      }
      return j;
    });
    for (const x of (wi && wi.x) || []) out.push(Object.assign({ f: '', pretend: true, wi: x.s != null }, x));
    return out;
  }

  // [score, max] if the assignment counts, else null. Exempt/Excused never count; Missing counts as 0.
  function scored(i) {
    const ex = exception(i);
    if (ex) {
      if (EXCLUDED.test(ex)) return null;
      if (/^missing/i.test(ex)) {
        const m = i.m != null ? i.m : i.mg;
        return m != null ? [+(i.s || 0), +m] : null;
      }
    }
    if (i.s == null || i.m == null) return null;
    return [+i.s, +i.m];
  }

  function catMath(rows, mode, drop) {
    const order = rows.map((r, k) => [r.m ? r.s / r.m : Infinity, k, r]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const k = Math.min(drop || 0, Math.max(rows.length - 1, 0));
    const dropped = new Set(order.slice(0, k).map(x => x[2].id));
    let pts = 0, pos = 0;
    const pcts = [];
    for (const r of rows) {
      if (dropped.has(r.id)) continue;
      pts += r.s;
      pos += r.m;
      if (r.m) pcts.push(r.s / r.m * 100);
    }
    const pct = mode === 'equal' ? (pcts.length ? sum(pcts) / pcts.length : null) : (pos ? pts / pos * 100 : null);
    return { pct, pts, pos, pcts, dropped };
  }

  function catResult(course, pid, cat, items, opts) {
    const mine = items.filter(i => i.p === pid && i.c === cat.id);
    const rows = [];
    for (const i of mine) { const sc = scored(i); if (sc) rows.push({ id: i.id, s: sc[0], m: sc[1] }); }
    const r = catMath(rows, cat.mode || 'points', cat.drop || 0);
    r.items = mine;
    r.counted = rows.length - r.dropped.size;
    const h = !(opts && opts.hidden === false) && course.hid && course.hid[`${pid}-${cat.id}`];
    if (h) {
      r.hidden = h;
      if (h.q != null) { r.pcts = r.pcts.concat([h.q]); r.pct = sum(r.pcts) / r.pcts.length; }
      else { r.pts += h.s; r.pos += h.m; r.pct = r.pos ? r.pts / r.pos * 100 : null; }
    }
    return r;
  }

  const weighted = course => course.cats.some(c => (c.w || 0) > 0);

  // One grading period: its grade and every category's part in it. share = the category's real share of the
  // grade (empty categories' weights are spread over the rest, like Schoology does); contrib = share x grade.
  function period(course, pid, items, opts) {
    const useW = weighted(course);
    const cats = course.cats.map(cat => Object.assign({ cat }, catResult(course, pid, cat, items, opts)));
    let tw = 0, tot = 0, pts = 0, pos = 0;
    for (const r of cats) {
      if (r.pct == null) continue;
      if (useW) { const w = r.cat.w || 0; if (w > 0) { tw += w; tot += w * r.pct; } }
      else { pos += r.pos; pts += r.cat.mode === 'equal' ? r.pct / 100 * r.pos : r.pts; }
    }
    const pct = useW ? (tw ? tot / tw : null) : (pos ? pts / pos * 100 : null);
    for (const r of cats) {
      r.share = r.pct == null ? 0 : useW ? (r.cat.w || 0) / (tw || 1) : r.pos / (pos || 1);
      r.contrib = r.pct == null ? 0 : r.share * r.pct;
    }
    return { pct, cats, weighted: useW, tw, pts, pos };
  }
  const periodPct = (course, pid, items, opts) => period(course, pid, items, opts).pct;

  // The year: each period's grade times its weight (Q1-Q4 22.5% each and the June exam 10% at Canisius).
  // assume = {periodId: pct} fills periods with no grade yet (for planning).
  function year(course, items, assume) {
    let tw = 0, tot = 0, all = 0;
    const parts = [];
    for (const p of course.periods) {
      if (!(p.w > 0)) continue;
      all += p.w;
      let pct = periodPct(course, p.id, items), assumed = false;
      if (pct == null && assume && assume[p.id] != null) { pct = assume[p.id]; assumed = true; }
      parts.push({ p, pct, assumed });
      if (pct != null) { tw += p.w; tot += p.w * pct; }
    }
    return { pct: tw ? tot / tw : null, parts, done: tw, all };
  }

  // What average on the periods with no grade yet makes the year come out at `target`?
  function yearNeed(course, items, target) {
    const y = year(course, items);
    const left = y.all - y.done;
    if (!left || y.pct == null) return null;
    return { need: (target * y.all - y.pct * y.done) / left, left, y };
  }

  // What score on the chosen assignments gets this period to `target`? Every pick gets the same percentage of its
  // points; found by halving the range, so weights, drops and hidden scores all count exactly as in the grade.
  // picks: [{id, m}] (ungraded assignments or pretend ones that are already in `items`).
  function solve(course, pid, items, picks, target) {
    const byId = {};
    for (const p of picks) byId[p.id] = p;
    const at = r => periodPct(course, pid, items.map(i => byId[i.id] ? Object.assign({}, i, { s: r * byId[i.id].m, m: byId[i.id].m, f: '' }) : i));
    const lo = at(0), hi = at(1);
    if (lo == null || hi == null) return null;
    if (lo >= target - 1e-9) return { status: 'safe', r: 0, lo, hi };
    if (hi < target - 1e-9) return { status: 'reach', r: null, lo, hi };
    let a = 0, b = 1;
    for (let k = 0; k < 48; k++) { const mid = (a + b) / 2; if (at(mid) >= target - 1e-9) b = mid; else a = mid; }
    return { status: 'ok', r: b, lo, hi };
  }

  // The grade with one assignment left out (to show what a score did to the grade).
  function without(course, pid, items, id) {
    return periodPct(course, pid, items.map(i => i.id === id ? Object.assign({}, i, { s: null, f: '' }) : i));
  }

  // Grade over time inside a period, from due dates: [[date, pct]] (hidden scores only in the last point).
  function trend(course, pid, items) {
    const days = [...new Set(items.filter(i => i.p === pid && scored(i) && i.due).map(i => i.due.slice(0, 10)))].sort();
    const out = [];
    for (const d of days) {
      const g = periodPct(course, pid, items.filter(i => !i.due || i.due.slice(0, 10) <= d), { hidden: false });
      if (g != null) out.push([d, g]);
    }
    const now = periodPct(course, pid, items);
    if (now != null && out.length) out[out.length - 1] = [out[out.length - 1][0], now];
    return out;
  }

  // The overall average: each class's grade times its credits (settings can change credits, leave classes out
  // and add AP points).
  function overall(rows, settings) {
    let tw = 0, tot = 0;
    const used = [];
    for (const { course, pct } of rows) {
      if (pct == null) continue;
      const s = settings || {};
      if (s.include && s.include[course.id] === false) continue;
      const cr = s.credits && s.credits[course.id] != null ? +s.credits[course.id] : course.credits;
      if (!(cr > 0)) continue;
      const g = pct + (course.ap ? +(s.apBonus || 0) : 0);
      tw += cr;
      tot += cr * g;
      used.push({ course, pct: g, credits: cr });
    }
    return { pct: tw ? tot / tw : null, credits: tw, used };
  }

  /* ---------- reaching a goal for the quarter's overall average (powerstats.py's goal_plan does the same) ---------- */
  // Never offered as a redo: tests and exams (never redone at Sam's school) and the categories Sam named
  // (course.noredo, from the Mac's data/rules.json; e.g. APUSH Unit MC Quizzes).
  const TEST = /\b(tests?|exams?|examen|finals?|midterms?)\b/i;
  const noRedo = (course, i) => TEST.test(i.t || '') || /^\s*tests?\s*$/i.test((course.cats.find(c => c.id === i.c) || {}).name || '')
    || (course.noredo || []).includes(i.c);
  // 'never', 'usually' (Sam said that class usually allows redos: course.redook = '*' or category ids) or 'maybe'
  const redoLevel = (course, i) => (noRedo(course, i) ? 'never'
    : course.redook === '*' || (Array.isArray(course.redook) && course.redook.includes(i.c)) ? 'usually' : 'maybe');
  const maxOf = i => (i.m != null ? i.m : i.mg);
  const turnedIn = i => /^d?s$/.test(i.f || '');
  const ahead = (i, now) => !turnedIn(i) && (!i.due || (i.due.length === 10 ? i.due >= now.slice(0, 10) : i.due > now));
  const withScore = (items, id, s) => items.map(i => (i.id === id ? Object.assign({}, i, { s, m: maxOf(i), f: '' }) : i));

  // The period with everything not graded yet filled in at your usual: your grade in that category so far
  // (or the class grade, or 85%). This is "if what's left goes like usual".
  function project(course, pid, items) {
    const det = period(course, pid, items);
    const usual = {};
    for (const r of det.cats) if (r.pct != null) usual[r.cat.id] = Math.min(r.pct, 100);
    const fallback = det.pct != null ? Math.min(det.pct, 100) : 85;
    return items.map(i => {
      if (i.p !== pid || i.s != null || exception(i) || !maxOf(i)) return i;
      const u = usual[i.c] != null ? usual[i.c] : fallback;
      return Object.assign({}, i, { s: u / 100 * maxOf(i), m: maxOf(i), f: '', usual: u });
    });
  }

  // Every way to raise the overall average for period `pid`, biggest first, measured from the projection:
  //   upcoming = still to come (acing it instead of your usual), redo = graded below full marks (full credit on a
  //   redo or corrections, if the teacher allows), missing = marked Missing (turning it in for full credit).
  // risks = past due, no grade and not marked turned in (what a zero would cost); leaks = the categories costing
  // the most points; path = the biggest moves in order until the average reaches `goal`.
  // Gains are points of the overall average; gainClass is points of that class's grade.
  // list = [{course, items}]; now = 'YYYY-MM-DDTHH:MM'.
  function goalPlan(list, pid, settings, now, goal) {
    const rows = list.map(({ course, items }) => {
      const proj = project(course, pid, items);
      return { course, items, proj, now: periodPct(course, pid, items), base: periodPct(course, pid, proj) };
    });
    const nowAvg = overall(rows.map(r => ({ course: r.course, pct: r.now })), settings);
    const projAvg = overall(rows.map(r => ({ course: r.course, pct: r.base })), settings);
    const credit = {};
    for (const u of projAvg.used) credit[u.course.id] = u.credits;
    const moves = [], risks = [], leaks = [];
    for (const r of rows) {
      if (!credit[r.course.id] || r.base == null) continue;
      const share = credit[r.course.id] / projAvg.credits;
      for (const i of r.items) {
        if (i.p !== pid) continue;
        const ex = exception(i), m = maxOf(i);
        if ((ex && EXCLUDED.test(ex)) || !m) continue;
        let kind;
        if (/^missing/i.test(ex)) kind = 'missing';
        else if (i.s != null) { if (i.s >= m || redoLevel(r.course, i) === 'never') continue; kind = 'redo'; }
        else if (turnedIn(i)) continue;  // done, waiting for its grade
        else kind = ahead(i, now) ? 'upcoming' : 'check';
        const full = periodPct(r.course, pid, withScore(r.proj, i.id, m));
        const zero = periodPct(r.course, pid, withScore(r.proj, i.id, 0));
        if (kind === 'check') {  // hidden: Schoology already counts a score it isn't showing in this category
          risks.push({ course: r.course, item: i, kind, m, share, lossClass: r.base - zero, loss: (r.base - zero) * share,
            hidden: !!(r.course.hid && r.course.hid[`${pid}-${i.c}`]) });
          continue;
        }
        const gainClass = full - r.base;
        if (gainClass * share < 0.005) continue;
        const p = r.proj.find(j => j.id === i.id);
        moves.push({ course: r.course, item: i, kind, m, share, gainClass, gain: gainClass * share,
          perPoint: (full - zero) / m * share, usual: p && p.usual, redo: kind === 'redo' ? redoLevel(r.course, i) : null });
      }
      const det = period(r.course, pid, r.items);  // real grades only, not the projection's guesses
      for (const c of det.cats) {
        if (c.pct == null || !(c.share > 0) || c.pct >= 100) continue;
        leaks.push({ course: r.course, cat: c.cat, pct: c.pct, share: c.share, lost: share * c.share * (100 - c.pct) });
      }
    }
    moves.sort((a, b) => b.gain - a.gain);
    risks.sort((a, b) => b.loss - a.loss);
    leaks.sort((a, b) => b.lost - a.lost);
    // the path starts with what's in your hands (still to come, missing), then redos that are usually allowed, then
    // redos that need the teacher's OK
    const path = [];
    if (goal != null && projAvg.pct != null && projAvg.pct < goal) {
      const cur = {};
      for (const r of rows) cur[r.course.id] = r.proj;
      const big = moves.filter(x => x.gain >= 0.05);  // tiny moves only clutter the path
      const group = x => (x.redo === 'usually' ? 1 : x.redo === 'maybe' ? 2 : 0);
      for (const mv of [0, 1, 2].flatMap(g => big.filter(x => group(x) === g))) {
        cur[mv.course.id] = withScore(cur[mv.course.id], mv.item.id, mv.m);
        const avg = overall(rows.map(r => ({ course: r.course, pct: periodPct(r.course, pid, cur[r.course.id]) })), settings).pct;
        path.push({ move: mv, avg });
        if (avg >= goal - 1e-9) break;
      }
    }
    return { now: nowAvg, projected: projAvg, moves, risks, leaks, path };
  }

  root.PSMath = { itemsWith, scored, catMath, catResult, period, periodPct, year, yearNeed, solve, without, trend,
    overall, weighted, exception, project, goalPlan, noRedo, redoLevel };
})(typeof window !== 'undefined' ? window : this);
