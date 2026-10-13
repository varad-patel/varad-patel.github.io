// families.js — the function families, one character each, and the classifier
// that decides which character a typed expression belongs to.
// `starter` is a deliberately mistuned example, never a sector's answer.
// `glyph` is SVG path data in a 16x16 box, stroked in the family colour.
(function () {
  'use strict';

  var FAMILIES = [
    {
      id: 'linear', name: 'LINEAR', from: 0, col: '#7ed321',
      desc: 'Shots travel in a straight line.',
      formula: 'y = m·x', starter: 'x',
      glyph: 'M2 14 L14 2'
    },
    {
      id: 'parabola', name: 'PARABOLA', from: 2, col: '#b46bff',
      desc: 'Shots follow a parabolic arc. Good for long range.',
      formula: 'y = a·x² + b·x', starter: '-0.2*x^2 + 1.5*x',
      glyph: 'M2 14 Q8 -2 14 14'
    },
    {
      id: 'absolute', name: 'ABSOLUTE', from: 3, col: '#ff9500',
      desc: 'Shots turn at a sharp angle about one point.',
      formula: 'y = a·|x − h| + k', starter: 'abs(x - 4) - 4',
      glyph: 'M2 3 L8 14 L14 3'
    },
    {
      id: 'cubic', name: 'CUBIC', from: 5, col: '#4a90ff',
      desc: 'Shots follow a cubic curve. Turns twice.',
      formula: 'y = a·x³ + b·x² + c·x', starter: '0.02*x^3 - 0.45*x^2 + 1.8*x',
      glyph: 'M2 14 C5 2 11 14 14 2'
    },
    {
      id: 'sine', name: 'SINE WAVE', from: 6, col: '#35b8ff',
      desc: 'Shots oscillate in a sine wave pattern.',
      formula: 'y = a·sin(b·x + c)', starter: '2*sin(x)',
      glyph: 'M2 8 Q4.5 1 7 8 T12 8 Q13 5.5 14 6'
    },
    {
      id: 'tangent', name: 'TANGENT', from: 8, col: '#ffc107',
      desc: 'Shots follow a tangent curve and die at the asymptote.',
      formula: 'y = a·tan(b·x)', starter: 'tan(0.25*x)',
      glyph: 'M3 14 Q8 13 8.5 8 Q9 3 14 2'
    },
    {
      id: 'clamp', name: 'CLAMP', from: 9, col: '#8fa3b8',
      desc: 'Shots rise, then hold a flat ceiling.',
      formula: 'y = min(a·x + b, c)', starter: 'min(x, 3)',
      glyph: 'M2 14 L8 4 L14 4'
    },
    {
      id: 'exponential', name: 'EXPONENTIAL', from: 10, col: '#2ec4a6',
      desc: 'Shots speed away from the axis exponentially.',
      formula: 'y = a·e^(b·x) + c', starter: 'exp(0.25*x) - 1',
      glyph: 'M2 14 Q10 14 14 2'
    },
    {
      id: 'logarithmic', name: 'LOGARITHMIC', from: 10, col: '#9acd32',
      desc: 'Shots rise quickly, then level off.',
      formula: 'y = a·ln(b·x + c)', starter: 'ln(x + 1)',
      glyph: 'M2 14 Q6 2 14 4'
    },
    {
      id: 'rational', name: 'RATIONAL', from: 11, col: '#ff5ea8',
      desc: 'Shots bend toward a horizontal asymptote.',
      formula: 'y = (a·x) / (c·x + d)', starter: 'x/(0.25*x + 1)',
      glyph: 'M2 3 Q7 4 8 8 Q9 12 14 13'
    },
    {
      id: 'harmonic', name: 'HARMONIC', from: 11, col: '#b6ff3b',
      desc: 'Shots ride a sum of waves — a small Fourier series.',
      formula: 'y = Σ aₙ·sin(n·x)', starter: '2*sin(x) + sin(2*x)',
      glyph: 'M2 8 Q3.5 2 5 8 T8 8 Q9.5 1 11 8 T14 8'
    },
    {
      id: 'damped', name: 'DAMPED', from: 11, col: '#ff6b6b',
      desc: 'Shots oscillate while the amplitude decays.',
      formula: 'y = a·e^(−b·x)·sin(c·x)', starter: '4*exp(-0.2*x)*sin(x)',
      glyph: 'M2 8 Q3.5 1 5 8 T8 8 Q9.5 4 11 8 T14 8'
    },
    {
      id: 'freeform', name: 'FREEFORM', from: 0, col: '#c0c0c0', hidden: true,
      desc: 'No standard family — the lattice cannot key to it.',
      formula: 'y = f(x)', starter: 'x',
      glyph: 'M2 12 Q5 3 8 9 Q11 15 14 5'
    }
  ];

  var BY_ID = {};
  FAMILIES.forEach(function (f) { BY_ID[f.id] = f; });

  // Degree via finite differences: 0 constant, 1 linear, 2 quadratic, 3 cubic,
  // -1 for anything that never flattens (or is undefined on the probe points).
  function degree(fn) {
    var env = { x: 0 }, v = [], scale = 0, i;
    for (i = 1; i <= 8; i++) {
      env.x = i * 0.7;
      var y = fn(env);
      if (!isFinite(y)) return -1;
      scale = Math.max(scale, Math.abs(y));
      v.push(y);
    }
    var tol = 1e-7 * (1 + scale);
    for (var k = 0; k <= 4 && v.length > 1; k++) {
      var w = [];
      for (i = 1; i < v.length; i++) w.push(v[i] - v[i - 1]);
      v = w;
      var flat = true;
      for (i = 0; i < v.length; i++) if (Math.abs(v[i]) > tol) { flat = false; break; }
      if (flat) return k;
    }
    return -1;
  }

  // Which character is this expression? Named functions decide first, then the
  // algebraic shape is measured rather than pattern-matched: `x*x` is a
  // parabola and `x/2` is linear, however they are written.
  function classify(src) {
    var toks;
    try { toks = Curve.tokenize(src); } catch (e) { return null; }

    var names = {}, hasDiv = false, hasX = false;
    toks.forEach(function (t) {
      if (t.t === 'id') {
        if (t.v === 'x') hasX = true;
        else names[t.v] = (names[t.v] || 0) + 1;
      } else if (t.t === '/') hasDiv = true;
    });
    var has = function (n) { return !!names[n]; };
    var trig = (names.sin || 0) + (names.cos || 0);

    if (has('tan')) return BY_ID.tangent;
    if (has('exp') && trig) return BY_ID.damped;
    if (trig >= 2) return BY_ID.harmonic;
    if (trig === 1) return BY_ID.sine;
    if (has('exp')) return BY_ID.exponential;
    if (has('ln') || has('log') || has('log2')) return BY_ID.logarithmic;
    if (has('abs')) return BY_ID.absolute;
    if (has('min') || has('max') || has('floor') || has('ceil') ||
        has('round') || has('sign') || has('step') || has('mod')) return BY_ID.clamp;

    var c = Curve.compile(src);
    if (c.error) return null;
    var d = degree(c.fn);
    if (d === 0 || d === 1) return BY_ID.linear;
    if (d === 2) return BY_ID.parabola;
    if (d === 3) return BY_ID.cubic;
    if (hasDiv && hasX) return BY_ID.rational;
    return BY_ID.freeform;
  }

  var API = { FAMILIES: FAMILIES, BY_ID: BY_ID, classify: classify, degree: degree };
  if (typeof module !== 'undefined' && module.exports) {
    global.Curve = global.Curve || require('./curve.js');
    module.exports = API;
  }
  if (typeof window !== 'undefined') window.Families = API;
})();
