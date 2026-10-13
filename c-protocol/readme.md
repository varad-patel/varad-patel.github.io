# CURVE PROTOCOL — Mathematical Ordnance System

Top-down puzzle-action where the only weapon is a function. You type `y = f(x)`
in the operative's local frame, watch the ghost preview, and authorize the shot.
The red laser follows the curve exactly.

Presentation is late-90s desktop software: silver bevels, a blue title bar,
Tahoma, and chrome spheres behind orange visors on a CRT plotting screen.

**Play:** open `index.html`. No build step, no dependencies, no server.

**Test:**

```bash
node test.js && node test-ui.js
```

`test.js` covers the parser, sampling, collision geometry, and proves every
sector is clearable by its authored solution within par. `test-ui.js` boots
`game.js` against a stub DOM and plays the whole campaign end to end.

## Controls

| | |
|---|---|
| `ENTER` | authorize shot |
| `R` | reset sector |
| `ESC` | sector index |
| drag | pan the view |
| scroll | zoom at the cursor (or `− + Fit` in the status bar) |
| arrows / `+` `-` / `0` | pan, zoom, reset the view |
| click | reposition inside the movement envelope |

The map navigates like a graphing calculator: drag to pan, scroll to zoom about
the pointer, and the grid steps up a ladder of spacings so it never gets denser
or sparser than it should. It is a camera transform inside the canvas, not a
resize — the drawing buffer stays 960×640, curve and grid strokes keep a
constant screen weight, and the page itself never scrolls. A drag that never
moved counts as a click, so repositioning still works.

Each construct is labelled with its position **in your frame**, in units.
Constructs and your own movement both snap to the **half-unit lattice**, so
those labels are exact rather than rounded — `6.5` means 6.5.

Curves are sampled adaptively: the x step halves wherever the curve climbs
faster than 0.2 units, so steep sections are drawn as curves rather than long
straight chords, and collision cannot cut the corner past a construct. A worst
case (six beams of a tangent near its asymptote) costs about 1.3 ms.

## Files

| | |
|---|---|
| `curve.js` | expression parser (no `eval`), curve sampling, collision, shot resolution |
| `families.js` | the twelve function characters and the classifier |
| `rigs.js` | each character's headgear and eyewear, drawn on canvas |
| `sectors.js` | the 16 sectors and the ability roster |
| `game.js` | state, UI wiring, rendering |
| `index.html` | markup and styling |

## Writing trajectories

You type the function. There are no coefficient sliders — the text box is the
whole interface.

The starters in the function library are deliberately mistuned, never answers:
`test.js` asserts that no starter matches a sector's solution or clears one on
its own, even with that sector's loadout. The reference solution appears only on
the Sector Clear card, and the card is emptied when dismissed so it cannot leak
into the next round.

## Characters

Every function belongs to a family, and each family is a character with its own
look — twelve of them, from LINEAR through HARMONIC and DAMPED. Not just a tint:
each has its own rig, drawn from canvas primitives in `rigs.js` so it stays
sharp as you zoom in.

| | |
|---|---|
| LINEAR | racing stripe, single wide band visor |
| PARABOLA | headphones and cat-eye goggles |
| ABSOLUTE | louvred shutter shades |
| CUBIC | star goggles over a speckled shell |
| SINE WAVE | round aviator goggles, waves on the shell |
| TANGENT | ball cap and black shades |
| CLAMP | hard hat and a level bar |
| EXPONENTIAL | gas mask, twin lenses, antenna |
| LOGARITHMIC | deerstalker and a monocle on a chain |
| RATIONAL | bowler, round spectacles, moustache |
| HARMONIC | a waveform display for a face |
| DAMPED | decaying orbit rings |

As you type, the panel identifies which character you are writing — and your
operative puts on that character's rig.

Classification is behavioural, not textual. Named functions decide first
(`tan` → TANGENT, decay times a wave → DAMPED, two waves → HARMONIC), and
anything algebraic is measured by finite differences: `x*x` is a PARABOLA and
`x/2` is LINEAR however you write them.

## Freedom sectors

Once every family is unlocked, the last three sectors change the rules.
Constructs there are **phase-keyed to one family and inert to every other** — a
parabola cannot touch a sine's targets, and an off-key bulwark will not even
stop your beam. No single curve can end the sector; you need a sequence of
different characters, one per key.

A second rule applies in those sectors: **no curve twice**. Curves are compared
by behaviour, so rewriting `0.5*x` as `x/2` does not buy you a second shot. The
panel lists what you have already spent.

Free text, parsed against a fixed whitelist. One variable, `x`; constants
`pi e tau`; `sin cos tan asin acos atan sinh cosh tanh abs sqrt exp ln log log2
floor ceil round sign trunc min max pow atan2 mod step`. Implicit products work
— `2x`, `3sin(x)`, `(x+1)(x+2)`.

**The curve must originate at you: `f(0)` has to be 0.** The projector sits at
the operative, so a curve that misses the origin has no launch point and is
refused before it costs a shot. `cos(x)` is rejected; `cos(x) - 1` is not. Every
shot is then capped by a per-sector **domain** (extent in x) and **arc length**
(distance actually travelled). Asymptotes and blow-ups terminate the curve where
they occur — that is the tangent safeguard.

Drones are pierced automatically. **Bulwarks** absorb a curve on contact unless
Pierce Protocol is equipped.

## Built vs. deferred

Built: the full shot pipeline, live preview with wall clipping, 16 hand-authored
sectors (13 campaign + 3 freedom), twelve function characters with behavioural
classification, six abilities (Pierce Protocol, Phase Shift, Domain Breaker,
Reflective Lattice, Root Detonation, Parallel Echoes), slot unlocks, ranking,
Insight, saved progress.

Deferred, and why:

- **Temporal Dilation, Residual Graph, Homing Segment, Asymptote Anchor** —
  every one of them is a timing or zone-denial tool, and these constructs do not
  move. They need mobile enemies first.
- **Insight shop, Energy Cores, range/speed/movement upgrade tracks** — sector
  limits are authored per puzzle instead. A shop makes sense once there are
  enough sectors that one build cannot cover them all.
- **Parametric and polar forms** — the whole engine assumes single-valued
  `y = f(x)`, which is also what makes Reflective Lattice interesting (a function
  can never turn back in x; only a bounce can). Parametric needs its own sampler.
- **Audio** — none.

Functions are not gated in the text box; only the worked examples unlock with
progression. Sector geometry does the real gating, and a linear function cannot
solve a slalom no matter when you unlock it.
