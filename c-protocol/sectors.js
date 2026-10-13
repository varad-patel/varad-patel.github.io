// sectors.js — hand-authored sectors, worked examples, ability roster.
// walls:   [x, y, w, h]        (canvas px)
// enemies: [x, y, 'd' | 'b']   ('d' drone: always pierced, 'b' bulwark: stops the curve
//                               unless Pierce Protocol is equipped)
// sol:     the intended solution, one entry per shot — verified by test.js
// Every expression must satisfy f(0) = 0: the projector sits at the operative.
(function () {
  'use strict';

  var ABILITIES = [
    { id: 'pierce',  name: 'Pierce Protocol',    from: 4,  desc: 'Continue through bulwark constructs instead of stopping.' },
    { id: 'phase',   name: 'Phase Shift',        from: 7,  desc: 'Ignore all barriers. Cancels reflection.' },
    { id: 'domain',  name: 'Domain Breaker',     from: 8,  desc: 'Extend the curve into the negative domain as well.' },
    { id: 'reflect', name: 'Reflective Lattice', from: 9,  desc: 'Bounce off barriers at the true angle of incidence.' },
    { id: 'root',    name: 'Root Detonation',    from: 10, desc: 'Detonate at every root and local extremum of the curve.' },
    { id: 'echo',    name: 'Parallel Echoes',    from: 11, desc: 'Fire two offset copies of the same function alongside it.' }
  ];

  function slotsFor(i) { return 1 + (i >= 7 ? 1 : 0) + (i >= 11 ? 1 : 0); }

  var SECTORS = [
    {
      name: 'PRIME VECTOR',
      brief: 'Three drones on a single bearing. Nothing between you and them.',
      hint: 'The flat line through you is y = 0. Type it.',
      start: [130, 320], move: 60, domain: 20, arc: 26, par: 1,
      walls: [],
      enemies: [[400, 320], [580, 320], [780, 320]],
      sol: [{ expr: '0', ab: [] }]
    },
    {
      name: 'DECLINATION',
      brief: 'The lane is blocked. The targets are not level with you.',
      hint: 'Slope. Three collinear targets, one correct multiplier on x.',
      start: [120, 500], move: 70, domain: 20, arc: 30, par: 1,
      walls: [[300, 440, 26, 200]],
      enemies: [[360, 380], [600, 260], [840, 140]],
      sol: [{ expr: '0.5*x', ab: [] }]
    },
    {
      name: 'PARABOLIC ENVELOPE',
      brief: 'A barrier rises directly ahead. Go over it and come back down.',
      hint: 'A negative x^2 term opens the arc downward. The x term sets the launch angle.',
      start: [130, 540], move: 70, domain: 20, arc: 34, par: 1,
      walls: [[420, 300, 34, 340]],
      enemies: [[530, 300], [610, 386], [690, 518]],
      sol: [{ expr: '-0.14*x^2 + 2*x', ab: [] }]
    },
    {
      name: 'VERTEX DOCTRINE',
      brief: 'Two pillars. Five constructs strung along a single arc.',
      hint: 'For a*x^2 + b*x the vertex sits at x = -b / 2a. Put it between the pillars.',
      start: [160, 600], move: 70, domain: 22, arc: 40, par: 1,
      walls: [[380, 300, 32, 340], [700, 300, 32, 340]],
      enemies: [[320, 344], [400, 264], [560, 200], [720, 264], [880, 456]],
      sol: [{ expr: '-0.1*x^2 + 2*x', ab: [] }]
    },
    {
      name: 'ARMORED LINE',
      brief: 'Bulwark constructs absorb a curve on contact. Pierce Protocol is now available.',
      hint: 'Equip Pierce Protocol, then fire flat.',
      start: [130, 320], move: 60, domain: 20, arc: 26, par: 1,
      walls: [],
      enemies: [[380, 320, 'b'], [560, 320], [740, 320, 'b'], [880, 320]],
      sol: [{ expr: '0', ab: ['pierce'] }]
    },
    {
      name: 'INFLECTION',
      brief: 'Targets above, below, and above again. No line and no parabola reaches all four.',
      hint: 'A cubic turns twice. Small positive x^3 term, negative x^2 term.',
      start: [120, 320], move: 60, domain: 20, arc: 44, par: 1,
      walls: [[330, 150, 26, 120], [660, 120, 26, 180]],
      enemies: [[240, 216], [400, 412], [560, 571], [720, 230]],
      sol: [{ expr: '0.03*x^3 - 0.6*x^2 + 2.4*x', ab: [] }]
    },
    {
      name: 'HARMONIC SLALOM',
      brief: 'Alternating barriers. The targets sit on the crests and the troughs.',
      hint: 'In a*sin(b*x), a is the amplitude and b sets how quickly it repeats.',
      start: [120, 320], move: 60, domain: 20, arc: 36, par: 1,
      walls: [[215, 240, 26, 200], [424, 120, 26, 280], [633, 240, 26, 220]],
      enemies: [[225, 200], [434, 440], [643, 200], [852, 440]],
      sol: [{ expr: '3*sin(0.6*x)', ab: [] }]
    },
    {
      name: 'PHASE BREACH',
      brief: 'The sector is sealed end to end. Hard light will not open it.',
      hint: 'Phase Shift ignores barriers entirely. The curve itself can stay trivial.',
      start: [130, 320], move: 60, domain: 20, arc: 26, par: 1,
      walls: [[420, 0, 36, 640]],
      enemies: [[560, 320], [700, 320], [840, 320]],
      sol: [{ expr: '0', ab: ['phase'] }]
    },
    {
      name: 'MIRROR DOMAIN',
      brief: 'Three constructs behind you, one ahead. Repositioning will not save you.',
      hint: 'Domain Breaker mirrors the curve into negative x. One shot covers both sides.',
      start: [700, 320], move: 50, domain: 20, arc: 26, par: 1,
      walls: [[600, 0, 28, 230], [600, 410, 28, 230]],
      enemies: [[860, 320], [520, 320], [380, 320], [240, 320]],
      sol: [{ expr: '0', ab: ['domain'] }]
    },
    {
      name: 'LATTICE RICOCHET',
      brief: 'One target sits behind your own position, walled off from the direct approach.',
      hint: 'y = f(x) can never turn back. Reflective Lattice can. Aim right, arrive left.',
      start: [200, 400], move: 50, domain: 14, arc: 32, par: 1,
      walls: [[700, 120, 30, 420], [150, 240, 26, 200]],
      enemies: [[500, 344], [400, 252], [120, 200]],
      sol: [{ expr: '0.185*x', ab: ['reflect'] }]
    },
    {
      name: 'ROOT CASCADE',
      brief: 'The clusters straddle the axis. Passing between them achieves nothing.',
      hint: 'Root Detonation fires where the curve crosses zero. Line those crossings up.',
      start: [130, 320], move: 60, domain: 20, arc: 36, par: 1,
      walls: [],
      enemies: [[339, 270], [339, 370], [549, 265], [549, 375], [758, 272], [758, 368]],
      sol: [{ expr: '3*sin(0.6*x)', ab: ['root'] }]
    },
    {
      name: 'PARALLEL SWEEP',
      brief: 'Nine constructs across three lanes. One curve, three paths.',
      hint: 'Parallel Echoes offsets copies by 0.9 units either side. The lanes are spaced to match.',
      start: [130, 320], move: 60, domain: 20, arc: 28, par: 1,
      walls: [],
      enemies: [
        [420, 284], [420, 320], [420, 356],
        [640, 284], [640, 320], [640, 356],
        [860, 284], [860, 320], [860, 356]
      ],
      sol: [{ expr: '0', ab: ['echo'] }]
    },
    {
      name: 'FINAL PROTOCOL',
      brief: 'A slotted barrier, a bulwark, a far wall, and one straggler on your own side.',
      hint: 'Thread the slot, pierce the bulwark, ricochet off the far wall. Then clean up.',
      start: [150, 540], move: 60, domain: 20, arc: 34, par: 2,
      walls: [[460, 0, 30, 440], [460, 540, 30, 100], [880, 140, 30, 380]],
      enemies: [
        [620, 446, 'b'], [760, 418], [850, 400],
        [700, 358], [540, 326], [300, 240]
      ],
      sol: [
        { expr: '0.2*x', ab: ['pierce', 'reflect'] },
        { expr: '2*x', ab: [] }
      ]
    },

    // ------------------------------------------------------------- freedom
    // Every family is unlocked by now. From here constructs are phase-keyed to
    // one function family and are inert to every other, so no single curve can
    // end a sector — you need a sequence of different characters.
    {
      name: 'FREEDOM PROTOCOL',
      freedom: true,
      brief: 'Keyed constructs. Each lattice answers to one function family and ignores the rest.',
      hint: 'Three keys: a line, an arc, a wave. One curve per key, and no curve twice.',
      start: [130, 320], move: 50, domain: 20, arc: 36, par: 3,
      walls: [],
      enemies: [
        [400, 320, 'd', 'linear'], [600, 320, 'd', 'linear'], [800, 320, 'd', 'linear'],
        [290, 352, 'd', 'parabola'], [450, 448, 'd', 'parabola'], [610, 608, 'd', 'parabola'],
        [256, 240, 'd', 'sine'], [507, 400, 'd', 'sine'], [758, 240, 'd', 'sine']
      ],
      sol: [
        { expr: '0', ab: [] },
        { expr: '-0.05*x^2', ab: [] },
        { expr: '2*sin(0.5*x)', ab: [] }
      ]
    },
    {
      name: 'TRIPLE LOCK',
      freedom: true,
      brief: 'Three keys, three problems: one sealed away, one armoured, one behind you.',
      hint: 'Each key needs its own loadout as well as its own family.',
      start: [300, 320], move: 50, domain: 20, arc: 30, par: 3,
      walls: [[520, 0, 30, 640]],
      enemies: [
        [660, 320, 'd', 'linear'], [780, 320, 'd', 'linear'], [880, 320, 'd', 'linear'],
        [340, 360, 'd', 'absolute'], [420, 440, 'b', 'absolute'], [500, 360, 'd', 'absolute'],
        [180, 262, 'd', 'exponential'], [60, 118, 'd', 'exponential']
      ],
      sol: [
        { expr: '0', ab: ['phase'] },
        { expr: 'abs(x - 3) - 3', ab: ['pierce'] },
        { expr: 'exp(-0.3*x) - 1', ab: ['domain'] }
      ]
    },
    {
      name: 'OPEN PROTOCOL',
      freedom: true,
      brief: 'Four keys. A sealed chamber behind you, and one lattice that only a divergent curve reaches.',
      hint: 'The chamber needs Phase Shift and Domain Breaker together. The high lattice sits past an asymptote.',
      start: [430, 400], move: 50, domain: 22, arc: 40, par: 4,
      walls: [
        [180, 120, 180, 16], [180, 236, 180, 16],
        [180, 120, 16, 132], [344, 120, 16, 132]
      ],
      enemies: [
        [600, 400, 'd', 'linear'], [760, 400, 'b', 'linear'], [880, 400, 'd', 'linear'],
        [550, 285, 'd', 'parabola'], [730, 220, 'd', 'parabola'], [870, 259, 'd', 'parabola'],
        [310, 208, 'd', 'cubic'], [230, 200, 'd', 'cubic'],
        [550, 350, 'd', 'tangent'], [590, 297, 'd', 'tangent'], [610, 222, 'd', 'tangent']
      ],
      sol: [
        { expr: '0', ab: ['pierce'] },
        { expr: '-0.08*x^2 + 1.2*x', ab: [] },
        { expr: '0.1*x^3 + 0.5*x^2 - x', ab: ['phase', 'domain'] },
        { expr: 'tan(0.3*x)', ab: [] }
      ]
    }
  ];

  // Constructs are snapped onto the half-unit lattice measured from the
  // operative's start, so the coordinates shown on screen are exact rather than
  // rounded. Movement snaps to the same lattice, which keeps them exact.
  var Q = 20;                                   // half a unit, in px

  function expand(s) {
    var snap = function (v, origin) { return origin + Math.round((v - origin) / Q) * Q; };
    return {
      name: s.name, brief: s.brief, hint: s.hint, freedom: !!s.freedom,
      start: s.start, move: s.move, domain: s.domain, arc: s.arc, par: s.par,
      walls: s.walls.map(function (w) { return { x: w[0], y: w[1], w: w[2], h: w[3] }; }),
      enemies: s.enemies.map(function (e) {
        return {
          x: snap(e[0], s.start[0]), y: snap(e[1], s.start[1]),
          r: e[2] === 'b' ? 17 : 15,            // hitbox matches what is drawn
          type: e[2] || 'd', fam: e[3] || null
        };
      })
    };
  }

  var API = {
    SECTORS: SECTORS, ABILITIES: ABILITIES,
    slotsFor: slotsFor, expand: expand
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.Sectors = API;
})();
