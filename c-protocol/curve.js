// curve.js — expression parser, curve sampling, collision geometry, shot resolution.
// No eval(): expressions compile to a tree of closures over a whitelist.
// Loads as a classic <script> (window.Curve) and as a node require().
(function () {
  'use strict';

  var SCALE = 40;    // px per math unit
  var BLAST = 62;    // root-detonation radius, px

  var FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp,
    ln: Math.log, log: Math.log10, log2: Math.log2,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    sign: Math.sign, trunc: Math.trunc,
    min: Math.min, max: Math.max, pow: Math.pow, atan2: Math.atan2,
    mod: function (a, b) { return ((a % b) + b) % b; },
    step: function (a) { return a >= 0 ? 1 : 0; }
  };
  var CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  var VARS = { x: 1 };

  // ---------------------------------------------------------------- parsing

  function tokenize(src) {
    var out = [], i = 0, j, ch;
    while (i < src.length) {
      ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
      if (ch >= '0' && ch <= '9' || ch === '.') {
        j = i;
        while (j < src.length && (src[j] >= '0' && src[j] <= '9' || src[j] === '.')) j++;
        var num = src.slice(i, j);
        if (num.split('.').length > 2) throw new Error('bad number "' + num + '"');
        out.push({ t: 'num', v: parseFloat(num) });
        i = j; continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        j = i;
        while (j < src.length && /[a-zA-Z_0-9]/.test(src[j])) j++;
        out.push({ t: 'id', v: src.slice(i, j) });
        i = j; continue;
      }
      if ('+-*/^(),'.indexOf(ch) >= 0) { out.push({ t: ch }); i++; continue; }
      throw new Error('unexpected character "' + ch + '"');
    }
    return out;
  }

  function parse(src) {
    var ts = tokenize(src), p = 0;
    if (!ts.length) throw new Error('empty expression');

    function peek() { return ts[p]; }
    function next() { return ts[p++]; }
    function expect(t) {
      if (!ts[p] || ts[p].t !== t) throw new Error('expected "' + t + '"');
      return ts[p++];
    }

    function expr() {
      var n = term(), k, op, l, r;
      while ((k = peek()) && (k.t === '+' || k.t === '-')) {
        op = next().t; r = term(); l = n;
        n = op === '+'
          ? (function (l, r) { return function (env) { return l(env) + r(env); }; })(l, r)
          : (function (l, r) { return function (env) { return l(env) - r(env); }; })(l, r);
      }
      return n;
    }

    function startsAtom() {
      var k = peek();
      return !!k && (k.t === 'num' || k.t === 'id' || k.t === '(');
    }

    function term() {
      var n = unary(), k, op, l, r;
      for (;;) {
        k = peek();
        if (k && (k.t === '*' || k.t === '/')) {
          op = next().t; r = unary(); l = n;
          n = op === '*'
            ? (function (l, r) { return function (env) { return l(env) * r(env); }; })(l, r)
            : (function (l, r) { return function (env) { return l(env) / r(env); }; })(l, r);
        } else if (startsAtom()) {           // implicit product: 2x, 3sin(x), a b
          r = unary(); l = n;
          n = (function (l, r) { return function (env) { return l(env) * r(env); }; })(l, r);
        } else return n;
      }
    }

    function unary() {
      var k = peek(), r;
      if (k && k.t === '-') { next(); r = unary(); return function (env) { return -r(env); }; }
      if (k && k.t === '+') { next(); return unary(); }
      return power();
    }

    function power() {
      var base = atom(), ex;
      if (peek() && peek().t === '^') {
        next(); ex = unary();
        return function (env) { return Math.pow(base(env), ex(env)); };
      }
      return base;
    }

    function atom() {
      var k = next(), n, name, f, args, v;
      if (!k) throw new Error('expression ends early');
      if (k.t === 'num') { v = k.v; return function () { return v; }; }
      if (k.t === '(') { n = expr(); expect(')'); return n; }
      if (k.t === 'id') {
        name = k.v;
        if (peek() && peek().t === '(') {
          f = FUNCS[name];
          if (!f) throw new Error('unknown function "' + name + '"');
          next(); args = [];
          if (peek() && peek().t !== ')') {
            args.push(expr());
            while (peek() && peek().t === ',') { next(); args.push(expr()); }
          }
          expect(')');
          if (args.length !== f.length) {
            throw new Error(name + '() takes ' + f.length + (f.length === 1 ? ' argument' : ' arguments'));
          }
          if (args.length === 1) {
            return (function (a) { return function (env) { return f(a(env)); }; })(args[0]);
          }
          return (function (a, b) { return function (env) { return f(a(env), b(env)); }; })(args[0], args[1]);
        }
        if (name in CONSTS) { v = CONSTS[name]; return function () { return v; }; }
        if (name in VARS) { return function (env) { return env[name]; }; }
        if (FUNCS[name]) throw new Error(name + ' needs parentheses — try ' + name + '(x)');
        throw new Error('unknown name "' + name + '"');
      }
      throw new Error('unexpected "' + k.t + '"');
    }

    var fn = expr();
    if (p < ts.length) throw new Error('trailing input after a complete expression');
    return fn;
  }

  // Fingerprint of a curve, used to tell two typed expressions apart by what
  // they actually do rather than by their text. `0.5*x` and `x/2` are the same
  // curve and count as one function in a freedom sector.
  var PROBE = [0.7, 1.3, 2.1, 3.4, 5.5, 8.9, -1.6, -4.2];

  function signature(fn) {
    var env = { x: 0 }, out = [];
    for (var i = 0; i < PROBE.length; i++) {
      env.x = PROBE[i];
      var v = fn(env);
      out.push(isFinite(v) ? v : NaN);
    }
    return out;
  }

  function sameSignature(a, b) {
    for (var i = 0; i < a.length; i++) {
      var an = !isFinite(a[i]), bn = !isFinite(b[i]);
      if (an !== bn) return false;
      if (!an && Math.abs(a[i] - b[i]) > 1e-9) return false;
    }
    return true;
  }

  // Returns {fn} or {error}. fn(env) with env = {x}.
  function compile(src) {
    try {
      if (!src || !src.trim()) return { error: 'empty expression' };
      var fn = parse(src);
      fn({ x: 0 });                           // smoke test
      return { fn: fn };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ---------------------------------------------------------------- sampling

  // Walks outward from the player's origin (x = 0) in `dir`, honouring the
  // domain and arc-length caps. Bails out at asymptotes and blow-ups.
  //
  // The x step is halved wherever the curve climbs faster than `maxSeg` units,
  // so steep sections are drawn as curves rather than long straight chords and
  // collision does not cut the corner. Uniform stepping is wrong here: a
  // tangent near its asymptote moves further in one step than an enemy is wide.
  function sample(fn, o) {
    var env = { x: 0 };
    var dir = o.dir || 1;
    var N = o.steps || 600;
    var step0 = o.domain / N;
    var minStep = step0 / 32;
    var maxSeg = o.maxSeg || 0.2;
    var maxPts = o.maxPts || 2400;
    var yLimit = o.yLimit || 40, jump = o.jumpLimit || 2;
    var pts = [], arc = 0, truncated = false;

    var py = fn(env);
    if (!isFinite(py) || Math.abs(py) > yLimit) return { pts: [], arc: 0, truncated: true, bad: true };
    var px = 0;
    pts.push([0, py]);

    var t = 0, guard = 0;
    while (t < o.domain - 1e-12 && guard++ < 40000) {
      var step = Math.min(step0, o.domain - t), x, y;
      for (;;) {
        x = dir * (t + step);
        env.x = x;
        y = fn(env);
        if (step <= minStep) break;
        if (!isFinite(y) || Math.abs(y - py) > maxSeg) { step /= 2; continue; }
        break;
      }
      if (!isFinite(y) || Math.abs(y) > yLimit) { truncated = true; break; }
      var seg = Math.hypot(x - px, y - py);
      if (seg > jump) { truncated = true; break; }          // asymptote / discontinuity
      if (arc + seg >= o.maxArc) {
        var f = (o.maxArc - arc) / seg;
        pts.push([px + (x - px) * f, py + (y - py) * f]);
        arc = o.maxArc; truncated = true; break;
      }
      arc += seg;
      pts.push([x, y]);
      px = x; py = y; t += step;
      if (pts.length >= maxPts) { truncated = true; break; }
    }
    return { pts: pts, arc: arc, truncated: truncated };
  }

  // ---------------------------------------------------------------- geometry

  // Segment vs axis-aligned box. Returns {t, nx, ny} at the entry face, else null.
  function segAABB(x0, y0, x1, y1, b) {
    var d = [x1 - x0, y1 - y0], p = [x0, y0];
    var lo = [b.x, b.y], hi = [b.x + b.w, b.y + b.h];
    var tmin = 0, tmax = 1, axis = -1, sgn = 0;
    for (var i = 0; i < 2; i++) {
      if (Math.abs(d[i]) < 1e-12) {
        if (p[i] < lo[i] || p[i] > hi[i]) return null;
        continue;
      }
      var t1 = (lo[i] - p[i]) / d[i], t2 = (hi[i] - p[i]) / d[i], s = -1;
      if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (axis < 0) return null;                              // started inside
    return { t: tmin, nx: axis === 0 ? sgn : 0, ny: axis === 1 ? sgn : 0 };
  }

  // Segment vs circle. Returns entry parameter t in [0,1], else null.
  function segCircle(x0, y0, x1, y1, cx, cy, r) {
    var dx = x1 - x0, dy = y1 - y0, fx = x0 - cx, fy = y0 - cy;
    var a = dx * dx + dy * dy;
    if (a < 1e-12) return null;
    var b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    var s = Math.sqrt(disc);
    var t = (-b - s) / (2 * a);
    if (t < 0) t = (-b + s) / (2 * a);
    if (t < 0 || t > 1) return null;
    return t;
  }

  function pointAt(pts, d) {
    var acc = 0;
    for (var i = 1; i < pts.length; i++) {
      var L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc + L >= d) {
        var t = L < 1e-9 ? 0 : (d - acc) / L;
        return {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t
        };
      }
      acc += L;
    }
    return pts.length ? pts[pts.length - 1] : null;
  }

  // ---------------------------------------------------------------- resolve

  // Walks the world-space polyline, stopping at walls (or reflecting), killing
  // what it crosses. Returns {pts, events, length, stop}.
  function resolvePath(pts, o) {
    var walls = o.walls || [], enemies = o.enemies || [];
    var maxArc = o.maxArc || 1e9;
    var dead = o.dead || new Set();
    var out = [{ x: pts[0].x, y: pts[0].y }];
    var events = [];
    var cur = out[0], dist = 0, bounces = o.bounces || 0, stop = 'end';
    var queue = pts.slice(1);
    var guard = 0;

    function done() { return { pts: out, events: events, length: dist, stop: stop, dead: dead }; }

    while (queue.length && guard++ < 20000) {
      var nxt = queue.shift();
      var ex = nxt.x, ey = nxt.y;
      var dx = ex - cur.x, dy = ey - cur.y;
      var L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;

      var clipped = false;
      if (dist + L > maxArc) {
        var ct = (maxArc - dist) / L;
        dx *= ct; dy *= ct; ex = cur.x + dx; ey = cur.y + dy; L = maxArc - dist;
        clipped = true;
      }

      var wt = 2, wn = null;
      if (!o.phase) {
        for (var wi = 0; wi < walls.length; wi++) {
          var h = segAABB(cur.x, cur.y, ex, ey, walls[wi]);
          if (h && h.t < wt) { wt = h.t; wn = h; }
        }
      }
      var lim = wt <= 1 ? wt : 1;

      var hits = [];
      for (var k = 0; k < enemies.length; k++) {
        if (dead.has(k)) continue;
        // phase-keyed constructs are inert to every other function family
        if (enemies[k].fam && enemies[k].fam !== o.fam) continue;
        var t = segCircle(cur.x, cur.y, ex, ey, enemies[k].x, enemies[k].y, enemies[k].r);
        if (t != null && t <= lim) hits.push({ t: t, k: k });
      }
      hits.sort(function (p, q) { return p.t - q.t; });

      var end = lim, halted = false;
      for (var hi = 0; hi < hits.length; hi++) {
        dead.add(hits[hi].k);
        events.push({ d: dist + hits[hi].t * L, type: 'kill', i: hits[hi].k });
        if (enemies[hits[hi].k].type === 'b' && !o.pierce) {
          end = hits[hi].t; halted = true; stop = 'armor'; break;
        }
      }

      var hx = cur.x + dx * end, hy = cur.y + dy * end;
      out.push({ x: hx, y: hy });
      dist += L * end;
      cur = { x: hx, y: hy };
      if (halted) return done();

      if (wt <= 1) {
        if (bounces > 0) {
          bounces--;
          var len = Math.hypot(dx, dy) || 1;
          var rx = dx / len, ry = dy / len;
          var dot = rx * wn.nx + ry * wn.ny;
          rx -= 2 * dot * wn.nx; ry -= 2 * dot * wn.ny;
          cur = { x: hx + wn.nx * 0.75, y: hy + wn.ny * 0.75 };
          out[out.length - 1] = cur;
          var rem = maxArc - dist;
          if (rem <= 1) { stop = 'arc'; return done(); }
          queue = [{ x: cur.x + rx * rem, y: cur.y + ry * rem }];
          continue;
        }
        stop = 'wall'; return done();
      }
      if (clipped) { stop = 'arc'; return done(); }
    }
    return done();
  }

  // Roots and local extrema of the sampled curve, mapped to arc distance.
  function detonations(local, world, res, enemies, dead, fam) {
    var cum = [0], i;
    for (i = 1; i < world.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(world[i].x - world[i - 1].x, world[i].y - world[i - 1].y);
    }
    var idx = [];
    for (i = 1; i < local.length; i++) {
      if ((local[i - 1][1] < 0) !== (local[i][1] < 0)) idx.push(i);
    }
    for (i = 1; i < local.length - 1; i++) {
      var s0 = local[i][1] - local[i - 1][1], s1 = local[i + 1][1] - local[i][1];
      if (s0 !== 0 && s1 !== 0 && (s0 < 0) !== (s1 < 0)) idx.push(i);
    }
    idx.sort(function (a, b) { return a - b; });

    var out = [], last = -1e9;
    for (var j = 0; j < idx.length && out.length < 8; j++) {
      var d = cum[idx[j]];
      if (d > res.length) break;
      if (d - last < 30) continue;
      last = d;
      var p = pointAt(res.pts, d);
      if (!p) continue;
      var blastHits = [];
      for (var k = 0; k < enemies.length; k++) {
        if (dead.has(k)) continue;
        if (enemies[k].fam && enemies[k].fam !== fam) continue;
        if (Math.hypot(enemies[k].x - p.x, enemies[k].y - p.y) <= BLAST + enemies[k].r) blastHits.push(k);
      }
      out.push({ d: d, x: p.x, y: p.y, hits: blastHits });
    }
    return out;
  }

  // ---------------------------------------------------------------- the shot

  // spec: {expr, px, py, domain, arc, walls, enemies, ab, dead, steps}
  // ab:   {phase, pierce, reflect, root, echo, domain}
  // The projector sits at the operative. A curve that does not pass through the
  // origin has no launch point, so it is rejected outright.
  function fire(spec) {
    var c = compile(spec.expr);
    if (c.error) return { error: c.error };
    var v0 = c.fn({ x: 0 });
    if (!isFinite(v0)) return { error: 'the curve is undefined at your position' };
    if (Math.abs(v0) > 0.005) {
      return { error: 'the curve must start at you — f(0) = ' + (Math.round(v0 * 100) / 100) + ', not 0' };
    }
    var A = spec.ab || {};
    var dirs = A.domain ? [1, -1] : [1];
    var offs = A.echo ? [0, 0.9, -0.9] : [0];
    var base = spec.dead || new Set();
    var beams = [], killed = new Set();

    for (var di = 0; di < dirs.length; di++) {
      for (var oi = 0; oi < offs.length; oi++) {
        var off = offs[oi];
        var fn = off
          ? (function (f, o) { return function (env) { return f(env) + o; }; })(c.fn, off)
          : c.fn;
        var s = sample(fn, {
          dir: dirs[di], domain: spec.domain, maxArc: spec.arc,
          steps: spec.steps || 600, yLimit: 40, jumpLimit: 2
        });
        if (s.bad) return { error: 'curve is undefined at the origin' };
        if (s.pts.length < 2) continue;

        var world = s.pts.map(function (p) {
          return { x: spec.px + p[0] * SCALE, y: spec.py - p[1] * SCALE };
        });
        var res = resolvePath(world, {
          walls: spec.walls, enemies: spec.enemies, fam: spec.fam,
          phase: !!A.phase, pierce: !!A.pierce, bounces: A.reflect ? 4 : 0,
          maxArc: spec.arc * SCALE, dead: new Set(base)
        });
        res.local = s.pts;
        res.world = world;
        res.truncated = s.truncated;
        res.dets = A.root ? detonations(s.pts, world, res, spec.enemies, res.dead, spec.fam) : [];

        res.events.forEach(function (e) { killed.add(e.i); });
        res.dets.forEach(function (t) { t.hits.forEach(function (i) { killed.add(i); }); });
        beams.push(res);
      }
    }
    return { beams: beams, killed: killed };
  }

  var API = {
    SCALE: SCALE, BLAST: BLAST, FUNCS: FUNCS, CONSTS: CONSTS,
    tokenize: tokenize, compile: compile, sample: sample,
    signature: signature, sameSignature: sameSignature,
    segAABB: segAABB, segCircle: segCircle,
    pointAt: pointAt, resolvePath: resolvePath, detonations: detonations, fire: fire
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.Curve = API;
})();
