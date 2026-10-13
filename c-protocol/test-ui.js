// test-ui.js — run with: node test-ui.js
// Headless end-to-end run of game.js against a stub DOM + canvas.
// Plays every sector with its authored solution and asserts it clears.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

const byId = {};
const byClass = {};

function reg(el) {
  if (el.id) byId[el.id] = el;
  (el.className || '').split(/\s+/).filter(Boolean).forEach(c => {
    (byClass[c] = byClass[c] || []).push(el);
  });
}

const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') {
      return () => ({ addColorStop() {} });
    }
    if (k === 'measureText') return () => ({ width: 10 });
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; }
});

function mkEl(tag) {
  const el = {
    tagName: tag.toUpperCase(), id: '', _class: '', style: {}, dataset: {},
    children: [], textContent: '', value: '', title: '',
    checked: false, disabled: false,
    onclick: null, oninput: null, onchange: null,
    classList: {
      add: c => { if (!el._class.split(' ').includes(c)) { el._class = (el._class + ' ' + c).trim(); reg(el); } },
      remove: c => { el._class = el._class.split(' ').filter(x => x && x !== c).join(' '); },
      contains: c => el._class.split(' ').includes(c)
    },
    appendChild(k) { el.children.push(k); reg(k); return k; },
    addEventListener() {},
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }),
    getContext: () => ctxStub,
    querySelector(sel) { return sel[0] === '#' ? byId[sel.slice(1)] || null : (byClass[sel.slice(1)] || [])[0] || null; },
    querySelectorAll(sel) { return sel[0] === '.' ? (byClass[sel.slice(1)] || []).slice() : []; }
  };
  Object.defineProperty(el, 'className', {
    get: () => el._class,
    set: v => { el._class = v; reg(el); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._html || '',
    set: v => {
      el._html = v;
      // register any ids / classes the markup declares so lookups keep working
      const re = /<(\w+)([^>]*)>/g;
      let m;
      while ((m = re.exec(v))) {
        const attrs = m[2];
        const idm = /id="([^"]+)"/.exec(attrs);
        const cm = /class="([^"]+)"/.exec(attrs);
        const dm = /data-i="([^"]+)"/.exec(attrs);
        if (!idm && !cm) continue;
        const child = mkEl(m[1]);
        if (idm) child.id = idm[1];
        if (cm) child._class = cm[1];
        if (dm) child.dataset.i = dm[1];
        reg(child);
        el.children.push(child);
      }
    }
  });
  return el;
}

// pre-create every id the page markup declares
['c', 'viewport', 'overlay', 'card', 'secNum', 'secName', 'secBrief', 'secHint', 'examples',
 'expr', 'err', 'famcard', 'used', 'slots', 'abilities', 'mDom', 'mArc', 'mStop', 'mKill',
 'fire', 'reset', 'select', 'sbShots', 'sbLeft', 'sbInsight',
 'zIn', 'zOut', 'zFit', 'zLbl'].forEach(id => {
  const el = mkEl(id === 'c' ? 'canvas' : 'div');
  el.id = id;
  if (id === 'c') { el.width = 960; el.height = 640; }   // the markup's attributes
  reg(el);
});

let raf = [];
global.document = {
  getElementById: id => byId[id] || null,
  createElement: mkEl,
  addEventListener() {},
  querySelectorAll: sel => (sel[0] === '.' ? (byClass[sel.slice(1)] || []).slice() : [])
};
global.window = global;
global.Path2D = function () {};
global.addEventListener = () => {};
global.innerWidth = 1320;
global.innerHeight = 900;
global.performance = { now: () => nowMs };
global.requestAnimationFrame = fn => { raf.push(fn); };
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

global.Curve = require(path.join(ROOT, 'curve.js'));
global.Families = require(path.join(ROOT, 'families.js'));
global.Rigs = require(path.join(ROOT, 'rigs.js'));
global.Sectors = require(path.join(ROOT, 'sectors.js'));

let nowMs = 0;
function pump(frames, step) {
  step = step || 16;
  for (let i = 0; i < frames; i++) {
    nowMs += step;
    const q = raf; raf = [];
    q.forEach(fn => fn(nowMs));
  }
}
const num = el => parseInt(el.textContent.replace(/\D+/, '').trim(), 10);

// boot
new Function(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'))();
pump(2);

assert.strictEqual(byId.secName.textContent, 'PRIME VECTOR', 'first sector loads');
assert.ok(byClass.ex.length > 0, 'worked examples built');
assert.ok(byId.cb_pierce && byId.cb_echo, 'ability checkboxes built');
assert.ok(byId.cb_pierce.disabled, 'a locked ability is disabled in sector 1');

// zoom drives the camera, never the drawing buffer or the CSS box
const cssW = byId.c.style.width;
assert.strictEqual(byId.c.width, 960, 'the drawing buffer stays 960 wide');
byId.zIn.onclick();
assert.strictEqual(byId.zLbl.textContent, '125%', 'zoom in steps the camera scale');
byId.zIn.onclick(); byId.zIn.onclick(); byId.zIn.onclick();
byId.zIn.onclick(); byId.zIn.onclick(); byId.zIn.onclick();
assert.strictEqual(byId.zLbl.textContent, '400%', 'zoom is capped at 400%');
byId.zOut.onclick();
assert.strictEqual(byId.zLbl.textContent, '320%', 'zoom out steps back down');
byId.zFit.onclick();
assert.strictEqual(byId.zLbl.textContent, '100%', 'fit returns to 100%');
assert.strictEqual(byId.c.style.width, cssW, 'zooming never resizes the canvas box');
assert.strictEqual(byId.c.width, 960, 'fit leaves the buffer alone');
console.log('boot ok — ' + byId.secName.textContent + ', ' + byId.mKill.textContent + ' projected');

function setShot(shot) {
  byId.expr.value = shot.expr;
  byId.expr.oninput.call(byId.expr);
  Sectors.ABILITIES.forEach(a => {
    const cb = byId['cb_' + a.id];
    if (!cb || cb.disabled) return;
    const want = shot.ab.indexOf(a.id) >= 0;
    if (want !== cb.checked) { cb.checked = want; cb.onchange(); }
  });
  pump(1);
}

const raws = Sectors.SECTORS;
for (let i = 0; i < raws.length; i++) {
  const raw = raws[i];
  assert.strictEqual(byId.secName.textContent, raw.name, 'expected sector ' + raw.name);

  assert.strictEqual(byId.card.innerHTML, '',
    raw.name + ': a stale card is holding an answer before the round starts');

  raw.sol.forEach((shot, n) => {
    setShot(shot);
    assert.strictEqual(byId.err.className, 'ok', raw.name + ': ' + byId.err.textContent);
    assert.ok(byId.card.innerHTML.indexOf('reference solution') < 0,
      raw.name + ': the answer is revealed before the round finishes');
    assert.ok(byId.famcard.innerHTML.indexOf(Families.classify(shot.expr).name) >= 0,
      raw.name + ': the character card does not name the family being written');
    byId.fire.onclick();
    pump(160);                                    // ~2.5s, long enough for any beam

    if (raw.freedom && n === 0) {
      // the same curve cannot be spent twice, however it is rewritten
      byId.expr.value = shot.expr;
      byId.expr.oninput.call(byId.expr);
      pump(1);
      assert.ok(/already fired/.test(byId.err.textContent),
        raw.name + ': a spent curve was accepted again');
      const before = num(byId.sbShots);
      byId.fire.onclick();
      pump(20);
      assert.strictEqual(num(byId.sbShots), before, raw.name + ': a spent curve still cost a shot');

      // an off-key family cannot touch the remaining constructs
      const keys = new Set(raw.enemies.map(e => e[3]));
      const off = Families.FAMILIES.find(f => !f.hidden && !keys.has(f.id) && f.from <= i);
      if (off) {
        byId.expr.value = off.starter;
        byId.expr.oninput.call(byId.expr);
        pump(1);
        assert.strictEqual(byId.mKill.textContent.split(' ')[0], '0',
          raw.name + ': a ' + off.id + ' curve reached constructs keyed to another family');
      }
    }
  });

  assert.ok(byId.overlay.classList.contains('show'),
    raw.name + ': sector did not clear (' + byId.mKill.textContent + ')');
  assert.ok(byId.card.innerHTML.indexOf('reference solution') >= 0 &&
            byId.card.innerHTML.indexOf(raw.sol[0].expr) >= 0,
    raw.name + ': the reference solution is missing from the clear card');
  const rank = /class="rank">(.)</.exec(byId.card.innerHTML);
  console.log('  ok  ' + String(i + 1).padStart(2, ' ') + '. ' + raw.name.padEnd(20) +
              'rank ' + (rank ? rank[1] : '?') + ', ' + byId.sbInsight.textContent.toLowerCase());

  if (i < raws.length - 1) {
    byId.ovA.onclick();                           // Next sector
    pump(2);
  }
}

// sector index overlay still works after the campaign
byId.select.onclick();
pump(1);
assert.ok(byId.overlay.classList.contains('show'), 'sector index opens');
assert.ok(byClass.cell.length >= raws.length, 'sector index lists every sector');

console.log('\nheadless playthrough passed — ' + raws.length + '/' + raws.length +
            ' sectors cleared, ' + byId.sbInsight.textContent.toLowerCase());

// --- negative paths -------------------------------------------------------
byId.ovB.onclick();                               // Resume out of the index
byId.reset.onclick();                             // fresh sector, zero shots
pump(2);
assert.strictEqual(num(byId.sbShots), 0, 'reset clears the shot counter');

byId.expr.value = 'sin(';
byId.expr.oninput.call(byId.expr);
pump(1);
assert.strictEqual(byId.err.className, '', 'bad expression reports an error');
byId.fire.onclick();                              // must be a no-op, not a crash
pump(30);
assert.strictEqual(num(byId.sbShots), 0, 'a rejected expression costs no shot');

byId.expr.value = 'a*x';
byId.expr.oninput.call(byId.expr);
pump(1);
assert.ok(/unknown name/.test(byId.err.textContent), 'coefficient letters are not variables');

byId.expr.value = '0.2*x^2 + 4';
byId.expr.oninput.call(byId.expr);
pump(1);
assert.ok(/must start at you/.test(byId.err.textContent), 'a curve that misses the operative is refused');
byId.fire.onclick();
pump(30);
assert.strictEqual(num(byId.sbShots), 0, 'a refused curve costs no shot');

byId.expr.value = '5*x';
byId.expr.oninput.call(byId.expr);
pump(1);
assert.strictEqual(byId.mKill.textContent.split(' ')[0], '0', 'a miss projects zero kills');
byId.fire.onclick();
pump(160);
assert.ok(!byId.overlay.classList.contains('show'), 'a miss does not clear the sector');
assert.strictEqual(num(byId.sbShots), 1, 'a fired miss costs a shot');
console.log('negative paths passed');
