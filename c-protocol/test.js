// test.js — run with: node test.js
// Checks the parser, the collision geometry, and that every authored sector is
// actually clearable by its intended solution within par.
'use strict';

const assert = require('assert');
const Curve = require('./curve.js');
const S = require('./sectors.js');
const F = require('./families.js');
const famOf = expr => { const f = F.classify(expr); return f ? f.id : null; };

const at = (src, x) => {
  const c = Curve.compile(src);
  assert.ok(!c.error, src + ' -> ' + c.error);
  return c.fn({ x: x || 0 });
};
const near = (got, want, msg) =>
  assert.ok(Math.abs(got - want) < 1e-9, (msg || '') + ' got ' + got + ' want ' + want);

// ---------------------------------------------------------------- parser
near(at('2x^2', 3), 18, 'implicit product binds looser than power:');
near(at('-2^2'), -4, 'unary minus applies after the power:');
near(at('2^3^2'), 512, 'power is right-associative:');
near(at('sin(pi/2)'), 1, 'sin:');
near(at('3sin(0)+1'), 1, 'implicit product with a call:');
near(at('min(x, 3)', 10), 3, 'piecewise clamp:');
near(at('abs(x - 5)', 1), 4, 'abs:');
near(at('(x+1)(x+2)', 1), 6, 'implicit product of two groups:');
near(at('mod(7, 3)'), 1, 'mod:');
near(at('0.03*x^3 - 0.6*x^2 + 2.4*x', 3), 2.61, 'cubic:');

assert.ok(Curve.compile('x +').error, 'incomplete expression must fail');
assert.ok(Curve.compile('foo(x)').error, 'unknown function must fail');
assert.ok(Curve.compile('a*x').error, 'coefficient placeholders are gone — a is not a name');
assert.ok(Curve.compile('sin').error, 'bare function name must fail');
assert.ok(Curve.compile('sin(x, 2)').error, 'wrong arity must fail');
assert.ok(Curve.compile('1.2.3').error, 'malformed number must fail');
assert.ok(Curve.compile('alert(1)').error, 'no arbitrary calls');
assert.ok(Curve.compile('').error, 'empty expression must fail');

// ---------------------------------------------------------------- sampling
{
  const f = Curve.compile('0').fn;
  const s = Curve.sample(f, { dir: 1, domain: 10, maxArc: 100, steps: 100 });
  near(s.arc, 10, 'flat line arc length:');
  near(s.pts[s.pts.length - 1][0], 10, 'domain reached:');

  const clip = Curve.sample(f, { dir: 1, domain: 10, maxArc: 4, steps: 100 });
  near(clip.arc, 4, 'arc cap:');
  assert.ok(clip.truncated, 'arc cap must flag truncation');

  const back = Curve.sample(f, { dir: -1, domain: 10, maxArc: 100, steps: 100 });
  near(back.pts[back.pts.length - 1][0], -10, 'negative domain:');

  const t = Curve.sample(Curve.compile('tan(x)').fn, { dir: 1, domain: 6, maxArc: 100, steps: 600 });
  assert.ok(t.truncated, 'tangent must stop at its asymptote');
  assert.ok(t.pts[t.pts.length - 1][0] < Math.PI / 2 + 0.05, 'tangent stops before pi/2');
}

// ------------------------------------------------- the curve starts at you
{
  const base = {
    px: 0, py: 0, domain: 10, arc: 20, walls: [], enemies: [], ab: {}
  };
  assert.ok(/must start at you/.test(Curve.fire(Object.assign({ expr: 'x^2 + 3' }, base)).error),
    'a curve that misses the origin is rejected');
  assert.ok(/must start at you/.test(Curve.fire(Object.assign({ expr: 'cos(x)' }, base)).error),
    'cos(x) starts one unit above the projector');
  assert.ok(/undefined at your position/.test(Curve.fire(Object.assign({ expr: 'ln(x)' }, base)).error),
    'ln(x) has no value at the origin');
  const ok = Curve.fire(Object.assign({ expr: 'cos(x) - 1' }, base));
  assert.ok(!ok.error, 'shifting cos down to the origin is accepted');
  near(ok.beams[0].pts[0].x, 0, 'the beam starts at the operative (x):');
  near(ok.beams[0].pts[0].y, 0, 'the beam starts at the operative (y):');
}

// ---------------------------------------------------------------- geometry
{
  const box = { x: 10, y: 0, w: 10, h: 10 };
  const h = Curve.segAABB(0, 5, 30, 5, box);
  assert.ok(h, 'segment must hit the box');
  near(h.t, 1 / 3, 'entry parameter:');
  near(h.nx, -1, 'entry normal points back along the ray:');
  assert.strictEqual(Curve.segAABB(0, 50, 30, 50, box), null, 'miss returns null');

  near(Curve.segCircle(0, 0, 10, 0, 5, 0, 1), 0.4, 'circle entry:');
  assert.strictEqual(Curve.segCircle(0, 0, 10, 0, 5, 9, 1), null, 'circle miss returns null');
}

// ---------------------------------------------------------------- resolve
{
  const line = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
  const wall = [{ x: 100, y: -50, w: 20, h: 100 }];
  const foe = [{ x: 200, y: 0, r: 15, type: 'd' }];

  let r = Curve.resolvePath(line, { walls: wall, enemies: foe, maxArc: 1000 });
  assert.strictEqual(r.stop, 'wall', 'a wall stops the curve');
  assert.strictEqual(r.events.length, 0, 'nothing behind the wall is hit');

  r = Curve.resolvePath(line, { walls: wall, enemies: foe, maxArc: 1000, phase: true });
  assert.strictEqual(r.events.length, 1, 'phase shift reaches the target');

  r = Curve.resolvePath(line, { walls: [], enemies: [foe[0], { x: 250, y: 0, r: 15, type: 'd' }], maxArc: 1000 });
  assert.strictEqual(r.events.length, 2, 'drones are pierced by default');

  const bul = [{ x: 200, y: 0, r: 15, type: 'b' }, { x: 250, y: 0, r: 15, type: 'd' }];
  r = Curve.resolvePath(line, { walls: [], enemies: bul, maxArc: 1000 });
  assert.strictEqual(r.events.length, 1, 'a bulwark halts the curve');
  assert.strictEqual(r.stop, 'armor');
  r = Curve.resolvePath(line, { walls: [], enemies: bul, maxArc: 1000, pierce: true });
  assert.strictEqual(r.events.length, 2, 'Pierce Protocol goes through the bulwark');

  // Reflect off the left face of a vertical wall and come back.
  r = Curve.resolvePath(line, { walls: wall, enemies: [], maxArc: 300, bounces: 2 });
  const tail = r.pts[r.pts.length - 1];
  assert.ok(tail.x < 0, 'reflected beam travels back past the origin, got x=' + tail.x);
  near(Math.round(r.length), 300, 'reflection consumes the full arc budget:');

  r = Curve.resolvePath(line, { walls: [], enemies: [], maxArc: 120 });
  assert.strictEqual(r.stop, 'arc');
  near(r.length, 120, 'arc cap in resolve:');
}

// -------------------------------------------------------- families & keying
// Every character's starter must parse, start at the operative, classify back to
// its own family, and never clear a sector on its own — even with that sector's
// loadout. Starters are shape hints, not answers.
F.FAMILIES.forEach(f => {
  const c = Curve.compile(f.starter);
  assert.ok(!c.error, f.name + ' starter does not parse: ' + c.error);
  assert.ok(Math.abs(c.fn({ x: 0 })) <= 0.005, f.name + ' starter misses the operative');
  if (!f.hidden) {
    assert.strictEqual(famOf(f.starter), f.id, f.name + ' starter classifies as ' + famOf(f.starter));
  }

  S.SECTORS.forEach((raw, idx) => {
    assert.ok(!raw.sol.some(s => s.expr === f.starter),
      f.name + ' starter is the answer to sector ' + (idx + 1) + ' (' + raw.name + ')');

    const sec = S.expand(raw);
    const loadouts = [{}, raw.sol[0].ab.reduce((o, id) => (o[id] = true, o), {})];
    loadouts.forEach(ab => {
      const out = Curve.fire({
        expr: f.starter, fam: f.id, px: sec.start[0], py: sec.start[1],
        domain: sec.domain, arc: sec.arc,
        walls: sec.walls, enemies: sec.enemies, ab: ab
      });
      if (out.error) return;
      assert.ok(out.killed.size < sec.enemies.length,
        f.name + ' starter clears sector ' + (idx + 1) + ' (' + raw.name + ') outright');
    });
  });
});

// Classification is behavioural, not textual.
assert.strictEqual(famOf('x*x'), 'parabola', 'x*x is a parabola however it is written');
assert.strictEqual(famOf('x/2'), 'linear', 'x/2 is linear, not rational');
assert.strictEqual(famOf('0'), 'linear', 'a constant belongs to the linear family');
assert.strictEqual(famOf('x/(0.25*x + 1)'), 'rational', 'x over x is rational');
assert.strictEqual(famOf('2*sin(x) + sin(2*x)'), 'harmonic', 'two waves make a harmonic');
assert.strictEqual(famOf('4*exp(-0.2*x)*sin(x)'), 'damped', 'decay times a wave is damped');
assert.strictEqual(famOf('cos(x) - 1'), 'sine', 'cosine belongs to the sine family');

// A curve only harms constructs keyed to its own family.
{
  const line = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
  const keyed = [{ x: 100, y: 0, r: 15, type: 'd', fam: 'sine' },
                 { x: 200, y: 0, r: 15, type: 'd', fam: 'linear' }];
  let r = Curve.resolvePath(line, { walls: [], enemies: keyed, maxArc: 1000, fam: 'linear' });
  assert.strictEqual(r.events.length, 1, 'a linear curve passes through a sine-keyed construct');
  assert.strictEqual(r.events[0].i, 1, 'and destroys the linear-keyed one behind it');
  r = Curve.resolvePath(line, { walls: [], enemies: keyed, maxArc: 1000, fam: 'sine' });
  assert.strictEqual(r.events[0].i, 0, 'a sine curve takes the sine-keyed construct');
  r = Curve.resolvePath(line, { walls: [], enemies: keyed, maxArc: 1000, fam: 'cubic' });
  assert.strictEqual(r.events.length, 0, 'a cubic curve harms neither');

  // an armoured construct of another family cannot block the beam either
  const armoured = [{ x: 100, y: 0, r: 15, type: 'b', fam: 'sine' },
                    { x: 200, y: 0, r: 15, type: 'd', fam: 'linear' }];
  r = Curve.resolvePath(line, { walls: [], enemies: armoured, maxArc: 1000, fam: 'linear' });
  assert.strictEqual(r.events.length, 1, 'an off-key bulwark does not stop the curve');
}

// Signatures identify curves by behaviour, so trivial rewrites are not new functions.
{
  const sig = e => Curve.signature(Curve.compile(e).fn);
  assert.ok(Curve.sameSignature(sig('0.5*x'), sig('x/2')), '0.5x and x/2 are one curve');
  assert.ok(!Curve.sameSignature(sig('0.5*x'), sig('0.51*x')), 'different slopes are different curves');
  assert.ok(Curve.sameSignature(sig('ln(x+1)'), sig('ln(x+1)')), 'undefined probes compare equal');
}

// ---------------------------------------------------------------- sectors
let failures = 0;
S.SECTORS.forEach((raw, idx) => {
  const sec = S.expand(raw);
  const slots = S.slotsFor(idx);
  const dead = new Set();
  const log = [];

  assert.ok(raw.sol.length <= sec.par, sec.name + ': intended solution exceeds par');

  // every construct lands on the half-unit lattice, so the coordinates the
  // player reads off the screen are exact rather than rounded
  sec.enemies.forEach(e => {
    const u = (e.x - sec.start[0]) / Curve.SCALE, v = (sec.start[1] - e.y) / Curve.SCALE;
    assert.ok(Math.abs(u * 2 - Math.round(u * 2)) < 1e-9 && Math.abs(v * 2 - Math.round(v * 2)) < 1e-9,
      sec.name + ': construct at (' + u + ', ' + v + ') is off the lattice');
    sec.walls.forEach(w => {
      const cx = Math.max(w.x, Math.min(e.x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(e.y, w.y + w.h));
      assert.ok(Math.hypot(e.x - cx, e.y - cy) >= e.r,
        sec.name + ': construct at (' + e.x + ',' + e.y + ') is buried in a barrier');
    });
  });

  if (raw.freedom) {
    // one distinct character per key, and every key must be answered
    const keys = new Set(sec.enemies.map(e => e.fam));
    const fams = raw.sol.map(s => famOf(s.expr));
    assert.ok(!keys.has(null), sec.name + ': a freedom construct is missing its key');
    assert.strictEqual(new Set(fams).size, fams.length,
      sec.name + ': the solution repeats a family — ' + fams.join(', '));
    keys.forEach(k => assert.ok(fams.indexOf(k) >= 0,
      sec.name + ': no shot answers the ' + k + ' key'));
    assert.strictEqual(raw.sol.length, keys.size,
      sec.name + ': par should equal the number of keys');
  }

  raw.sol.forEach((shot, n) => {
    assert.ok(shot.ab.length <= slots,
      sec.name + ': shot ' + (n + 1) + ' uses ' + shot.ab.length + ' abilities, only ' + slots + ' slot(s)');
    shot.ab.forEach(id => {
      const ab = S.ABILITIES.find(a => a.id === id);
      assert.ok(ab, sec.name + ': unknown ability ' + id);
      assert.ok(ab.from <= idx, sec.name + ': ' + id + ' is not unlocked until sector ' + (ab.from + 1));
    });

    const ab = {};
    shot.ab.forEach(id => { ab[id] = true; });
    const out = Curve.fire({
      expr: shot.expr, fam: famOf(shot.expr),
      px: sec.start[0], py: sec.start[1],
      domain: sec.domain, arc: sec.arc,
      walls: sec.walls, enemies: sec.enemies,
      ab: ab, dead: dead
    });
    assert.ok(!out.error, sec.name + ': ' + out.error);
    out.killed.forEach(i => dead.add(i));
    log.push('shot ' + (n + 1) + ' -> ' + out.killed.size + ' kill(s)');
  });

  const left = sec.enemies.length - dead.size;
  const tag = String(idx + 1).padStart(2, ' ') + '. ' + sec.name.padEnd(20);
  if (left === 0) {
    console.log('  ok  ' + tag + raw.sol.length + '/' + sec.par + ' shots, ' + sec.enemies.length + ' cleared');
  } else {
    failures++;
    const missed = sec.enemies
      .map((e, i) => (dead.has(i) ? null : '(' + e.x + ',' + e.y + ')'))
      .filter(Boolean).join(' ');
    console.log(' FAIL ' + tag + left + ' left: ' + missed + '   [' + log.join('; ') + ']');
  }
});

assert.strictEqual(failures, 0, failures + ' sector(s) are not clearable by their intended solution');
console.log('\nall checks passed');
