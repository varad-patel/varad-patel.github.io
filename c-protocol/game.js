// game.js — state, panel wiring, rendering. Geometry lives in curve.js,
// character art in rigs.js.
(function () {
  'use strict';

  var SCALE = Curve.SCALE, W = 960, H = 640, SPEED = 900;
  var HALF = SCALE / 2;                    // the half-unit lattice everything sits on
  var SAVE = 'curve-protocol-v1';

  var cv = document.getElementById('c'), ctx = cv.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };

  var G = {
    idx: 0, sec: null, player: { x: 0, y: 0 },
    expr: '', ab: {}, dead: new Set(), shots: 0,
    fam: null, sig: null, used: [],
    preview: null, dirty: true,
    shot: null, parts: [], t: 0,
    save: { unlocked: 0, best: {} }
  };

  try {
    var raw = localStorage.getItem(SAVE);
    if (raw) G.save = JSON.parse(raw);
  } catch (e) { /* first run, or storage blocked */ }

  function persist() {
    try { localStorage.setItem(SAVE, JSON.stringify(G.save)); } catch (e) {}
  }

  // --------------------------------------------------------------- palettes

  var ORANGE = ['#ffe97a', '#ff8a10', '#c11400'];
  var palCache = {};

  function mix(hex, to, t) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' + [16, 8, 0].map(function (sh) {
      return Math.round((n >> sh & 255) * (1 - t) + to * t);
    }).join(',') + ')';
  }

  function palette(id) {
    if (!id || !Families.BY_ID[id]) return { col: '#ff8a10', lens: ORANGE };
    if (!palCache[id]) {
      var c = Families.BY_ID[id].col;
      palCache[id] = { col: c, lens: [mix(c, 255, .6), c, mix(c, 0, .42)] };
    }
    return palCache[id];
  }

  function glyphPath(id) {
    var f = Families.BY_ID[id];
    if (!f._p) f._p = new Path2D(f.glyph);
    return f._p;
  }

  // ----------------------------------------------------------------- camera
  // cam.x / cam.y is the world point sitting at the middle of the canvas,
  // cam.z the scale. Everything the player navigates with goes through here.

  var cam = { x: W / 2, y: H / 2, z: 1 };
  var MINZ = 0.35, MAXZ = 4;

  function applyCam() {
    ctx.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
  }
  function resetCam() { ctx.setTransform(1, 0, 0, 1, 0, 0); }
  function sx(wx) { return (wx - cam.x) * cam.z + W / 2; }
  function sy(wy) { return (wy - cam.y) * cam.z + H / 2; }
  function toWorld(px, py) {
    return { x: (px - W / 2) / cam.z + cam.x, y: (py - H / 2) / cam.z + cam.y };
  }

  // canvas-space coordinates from a mouse event, independent of CSS size
  function canvasPt(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }

  function clampCam() {
    cam.x = Math.max(-W * .4, Math.min(W * 1.4, cam.x));
    cam.y = Math.max(-H * .4, Math.min(H * 1.4, cam.y));
  }

  function setZoom(z, at) {
    z = Math.max(MINZ, Math.min(MAXZ, z));
    if (Math.abs(z - cam.z) < 1e-9) return;
    var p = at || { x: W / 2, y: H / 2 };
    var before = toWorld(p.x, p.y);
    cam.z = z;
    var after = toWorld(p.x, p.y);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    clampCam();
    $('zLbl').textContent = Math.round(cam.z * 100) + '%';
  }

  function resetView() {
    cam.x = W / 2; cam.y = H / 2; cam.z = 1;
    $('zLbl').textContent = '100%';
  }

  // The canvas keeps its 960x640 buffer and is fitted to the pane in CSS, so
  // the page never scrolls sideways; navigation happens with the camera.
  function fitCss() {
    var pane = $('viewport').clientWidth || W;
    var w = Math.min(W, pane);
    cv.style.width = Math.round(w) + 'px';
    cv.style.height = Math.round(w * H / W) + 'px';
  }

  $('zIn').onclick = function () { setZoom(cam.z * 1.25); };
  $('zOut').onclick = function () { setZoom(cam.z / 1.25); };
  $('zFit').onclick = resetView;
  window.addEventListener('resize', fitCss);

  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    setZoom(cam.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), canvasPt(e));
  }, { passive: false });

  // Drag pans; a click that never moved repositions the operative.
  var drag = null;
  cv.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var p = canvasPt(e);
    drag = { x: p.x, y: p.y, moved: 0 };
    cv.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var p = canvasPt(e);
    var dx = p.x - drag.x, dy = p.y - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    cam.x -= dx / cam.z;
    cam.y -= dy / cam.z;
    clampCam();
    drag.x = p.x; drag.y = p.y;
  });
  window.addEventListener('mouseup', function (e) {
    if (!drag) return;
    var quiet = drag.moved < 5;
    drag = null;
    cv.style.cursor = 'crosshair';
    if (quiet && !G.shot) movePlayer(canvasPt(e));
  });

  // Movement snaps to the half-unit lattice, so every construct's coordinates
  // stay exact whatever the operative does.
  function movePlayer(p) {
    var w = toWorld(p.x, p.y);
    var dx = w.x - G.sec.start[0], dy = w.y - G.sec.start[1];
    var ox = Math.round(dx / HALF), oy = Math.round(dy / HALF);
    var L = Math.hypot(ox, oy), max = G.sec.move / HALF;
    if (L > max && L > 0) {
      var k = max / L;
      ox = Math.round(ox * k); oy = Math.round(oy * k);
    }
    G.player = { x: G.sec.start[0] + ox * HALF, y: G.sec.start[1] + oy * HALF };
    G.dirty = true;
  }

  // ------------------------------------------------------------------ setup

  function load(i) {
    G.idx = i;
    G.sec = Sectors.expand(Sectors.SECTORS[i]);
    G.player = { x: G.sec.start[0], y: G.sec.start[1] };
    G.dead = new Set();
    G.shots = 0;
    G.shot = null;
    G.parts = [];
    G.ab = {};
    G.used = [];
    G.dirty = true;
    buildRoster();
    buildAbilities();
    renderUsed();
    resetView();
    $('secNum').textContent = (i + 1) + ' of ' + Sectors.SECTORS.length;
    $('secName').textContent = G.sec.name;
    $('secBrief').textContent = G.sec.brief;
    $('secHint').textContent = G.sec.hint;
    $('slots').textContent = Sectors.slotsFor(i) + ' slot' + (Sectors.slotsFor(i) > 1 ? 's' : '');
    hideOverlay();
    syncStatus();
  }

  function syncStatus() {
    var total = 0;
    for (var k in G.save.best) total += G.save.best[k].insight;
    $('sbInsight').textContent = 'Insight ' + total;
    $('sbShots').textContent = 'Shots ' + G.shots + ' / ' + G.sec.par;
    $('sbLeft').textContent = 'Hostiles ' + (G.sec.enemies.length - G.dead.size);
  }

  function svgGlyph(f, px) {
    return '<svg viewBox="0 0 16 16" width="' + px + '" height="' + px + '">' +
      '<path d="' + f.glyph + '" fill="none" stroke="' + f.col +
      '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function buildRoster() {
    var host = $('examples');
    host.innerHTML = '';
    Families.FAMILIES.forEach(function (f) {
      if (f.hidden) return;
      var b = document.createElement('button');
      var locked = f.from > G.idx;
      b.className = 'ex';
      b.innerHTML = svgGlyph(f, 12) + '<span>' + f.name.toLowerCase() + '</span>';
      b.disabled = locked;
      b.title = locked ? 'available from sector ' + (f.from + 1)
                       : f.formula + ' — ' + f.desc + '\nstarter: y = ' + f.starter;
      if (!locked) b.onclick = function () {
        G.expr = f.starter;
        $('expr').value = f.starter;
        $('expr').focus();
        G.dirty = true;
      };
      host.appendChild(b);
    });
  }

  function buildAbilities() {
    var host = $('abilities');
    host.innerHTML = '';
    Sectors.ABILITIES.forEach(function (a) {
      var locked = a.from > G.idx;
      var lab = document.createElement('label');
      lab.className = 'ab' + (locked ? ' off' : '');
      lab.title = locked ? 'available from sector ' + (a.from + 1) : a.desc;
      lab.innerHTML = '<input type="checkbox" id="cb_' + a.id + '"><b>' + a.name + '</b>';
      host.appendChild(lab);
      var cb = $('cb_' + a.id);
      cb.disabled = locked;
      cb.checked = !!G.ab[a.id];
      cb.onchange = function () {
        if (cb.checked) {
          if (Object.keys(G.ab).length >= Sectors.slotsFor(G.idx)) { cb.checked = false; return; }
          G.ab[a.id] = true;
        } else delete G.ab[a.id];
        G.dirty = true;
      };
    });
  }

  // The character card for whatever is typed right now.
  function renderFam(f) {
    var el = $('famcard');
    if (!f) {
      el.className = 'none';
      el.innerHTML = 'no family — write a function of x';
      return;
    }
    el.className = '';
    el.innerHTML = svgGlyph(f, 26) +
      '<div><div class="fn" style="color:' + f.col + '">' + f.name + '</div>' +
      '<div class="fd">' + f.desc + '</div>' +
      '<div class="ff">' + f.formula + '</div></div>';
  }

  function renderUsed() {
    var el = $('used');
    if (!G.sec.freedom) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    if (!G.used.length) {
      el.innerHTML = '<span class="uh">Spent functions</span><br>' +
        '<span class="u" style="color:#5d7291">none yet — every curve must be new</span>';
      return;
    }
    el.innerHTML = '<span class="uh">Spent functions</span><br>' + G.used.map(function (u) {
      var c = Families.BY_ID[u.fam];
      return '<span class="u" style="color:' + (c ? c.col : '#333') + '">y = ' + u.expr + '</span>';
    }).join('<br>');
  }

  $('expr').value = G.expr;
  $('expr').oninput = function () { G.expr = this.value; G.dirty = true; };
  $('fire').onclick = fire;
  $('reset').onclick = function () { load(G.idx); };
  $('select').onclick = showSelect;

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); fire(); }
    else if (e.key === 'Escape') { showSelect(); }
    else if (e.target.tagName === 'INPUT') return;
    else if (e.key === 'r' || e.key === 'R') load(G.idx);
    else if (e.key === '+' || e.key === '=') setZoom(cam.z * 1.25);
    else if (e.key === '-' || e.key === '_') setZoom(cam.z / 1.25);
    else if (e.key === '0') resetView();
    else if (e.key.indexOf('Arrow') === 0) {
      var d = 60 / cam.z;
      if (e.key === 'ArrowLeft') cam.x -= d;
      else if (e.key === 'ArrowRight') cam.x += d;
      else if (e.key === 'ArrowUp') cam.y -= d;
      else cam.y += d;
      clampCam();
      e.preventDefault();
    }
  });

  // ------------------------------------------------------------------ shots

  function spec() {
    return {
      expr: G.expr, fam: G.fam,
      px: G.player.x, py: G.player.y,
      domain: G.sec.domain, arc: G.sec.arc,
      walls: G.sec.walls, enemies: G.sec.enemies,
      ab: G.ab, dead: G.dead
    };
  }

  var STOPTEXT = { end: 'domain limit', arc: 'arc limit', wall: 'barrier', armor: 'bulwark' };

  function blank(msg) {
    G.preview = null;
    $('err').className = '';
    $('err').textContent = msg;
    $('mDom').textContent = $('mArc').textContent = $('mStop').textContent = $('mKill').textContent = '—';
  }

  function recompute() {
    G.dirty = false;
    var f = Families.classify(G.expr);
    G.fam = f ? f.id : null;
    G.sig = null;
    renderFam(G.expr.trim() ? f : null);

    if (!G.expr.trim()) {
      return blank('Type a function of x. It must pass through you: f(0) = 0.');
    }

    // In a freedom sector every curve must be new — compared by behaviour, so
    // rewriting 0.5*x as x/2 does not buy a second shot.
    var c = Curve.compile(G.expr);
    if (!c.error) {
      G.sig = Curve.signature(c.fn);
      if (G.sec.freedom) {
        for (var i = 0; i < G.used.length; i++) {
          if (Curve.sameSignature(G.sig, G.used[i].sig)) {
            return blank('that curve is spent — you already fired y = ' + G.used[i].expr);
          }
        }
      }
    }

    var out = Curve.fire(spec());
    if (out.error) return blank(out.error);

    G.preview = out;
    $('err').className = 'ok';
    $('err').textContent = 'Trajectory locked.';
    var dom = 0;
    out.beams.forEach(function (b) {
      dom = Math.max(dom, Math.abs(b.local[b.local.length - 1][0]));
    });
    var b0 = out.beams[0];
    $('mDom').textContent = dom.toFixed(2) + ' / ' + G.sec.domain;
    $('mArc').textContent = (b0 ? (b0.length / SCALE).toFixed(2) : '0') + ' / ' + G.sec.arc;
    $('mStop').textContent = b0 ? (STOPTEXT[b0.stop] || b0.stop) : '—';
    var kills = out.killed.size, left = G.sec.enemies.length - G.dead.size;
    var el = $('mKill');
    el.textContent = kills + ' of ' + left;
    el.className = kills === 0 ? 'warn' : '';
  }

  function fire() {
    if (G.shot || !G.sec) return;
    if (G.dirty) recompute();
    if (!G.preview || !G.preview.beams.length) return;
    G.shots++;
    if (G.sec.freedom && G.sig) {
      G.used.push({ expr: G.expr, sig: G.sig, fam: G.fam });
      renderUsed();
    }
    G.shot = { head: 0, beams: G.preview.beams, done: new Set(), max: 0 };
    G.preview.beams.forEach(function (b) { G.shot.max = Math.max(G.shot.max, b.length); });
    burst(G.player.x, G.player.y, 9, '#ffb020', 130);
    syncStatus();
  }

  function kill(i) {
    if (G.dead.has(i)) return;
    G.dead.add(i);
    var e = G.sec.enemies[i];
    burst(e.x, e.y, e.type === 'b' ? 24 : 15, '#c8ccd2', 250);
    burst(e.x, e.y, 8, e.fam ? Families.BY_ID[e.fam].col : '#ff5a1e', 190);
    syncStatus();
  }

  function advanceShot(dt) {
    var s = G.shot;
    s.head += SPEED * dt;
    s.beams.forEach(function (b, bi) {
      b.events.forEach(function (ev, ei) {
        var key = bi + ':k' + ei;
        if (ev.d <= s.head && !s.done.has(key)) { s.done.add(key); kill(ev.i); }
      });
      b.dets.forEach(function (det, di) {
        var key = bi + ':d' + di;
        if (det.d <= s.head && !s.done.has(key)) {
          s.done.add(key);
          ring(det.x, det.y);
          det.hits.forEach(function (i) { kill(i); });
        }
      });
    });
    if (s.head > s.max + 40) {
      G.shot = null;
      G.dirty = true;
      if (G.dead.size >= G.sec.enemies.length) clearSector();
    }
  }

  function clearSector() {
    var par = G.sec.par;
    var rank = G.shots <= par ? 'S' : G.shots === par + 1 ? 'A' : G.shots === par + 2 ? 'B' : 'C';
    var insight = { S: 120, A: 80, B: 50, C: 25 }[rank];
    var prev = G.save.best[G.idx];
    if (!prev || insight > prev.insight) G.save.best[G.idx] = { rank: rank, insight: insight, shots: G.shots };
    G.save.unlocked = Math.max(G.save.unlocked, Math.min(G.idx + 1, Sectors.SECTORS.length - 1));
    persist();
    syncStatus();

    // The reference solution is withheld until the round is over.
    var ref = Sectors.SECTORS[G.idx].sol.map(function (s) { return 'y = ' + s.expr; }).join('<br>');

    var last = G.idx >= Sectors.SECTORS.length - 1;
    showOverlay('Sector clear',
      '<div class="rank">' + rank + '</div>' +
      '<div class="meta">' + G.sec.name + '<br>shots <b>' + G.shots + '</b> of par <b>' + par + '</b>' +
      '<br>constructs deleted <b>' + G.sec.enemies.length + '</b>' +
      '<br>insight awarded <b>+' + insight + '</b></div>' +
      '<div class="ref">reference solution<br><b>' + ref + '</b></div>' +
      '<button class="btn" id="ovA">' + (last ? 'Protocol complete — sector list' : 'Next sector') + '</button>' +
      '<button class="btn sm" id="ovB">Replay this sector</button>',
      function () {
        $('ovA').onclick = last ? showSelect : function () { load(G.idx + 1); };
        $('ovB').onclick = function () { load(G.idx); };
      });
  }

  // --------------------------------------------------------------- overlays

  function showOverlay(title, html, after) {
    $('card').innerHTML = '<div class="cbar">' + title + '</div><div class="cin">' + html + '</div>';
    $('overlay').classList.add('show');
    if (after) after();
  }

  // Emptied, not just hidden: a stale card would leave the last answer in the DOM.
  function hideOverlay() {
    $('overlay').classList.remove('show');
    $('card').innerHTML = '';
  }

  function showSelect() {
    var cells = Sectors.SECTORS.map(function (s, i) {
      var locked = i > G.save.unlocked;
      var best = G.save.best[i];
      return '<button class="cell' + (locked ? ' locked' : '') + '" data-i="' + i + '">' +
        '<span class="n">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="r">' + (best ? best.rank : '') + '</span>' +
        '<br>' + (locked ? '— locked —' : s.name) + '</button>';
    }).join('');
    showOverlay('Sector index',
      '<div class="meta">Aether Division — reclaimed sectors and standing ranks</div>' +
      '<div id="grid">' + cells + '</div>' +
      '<button class="btn sm" id="ovB">Resume</button>',
      function () {
        $('ovB').onclick = hideOverlay;
        [].forEach.call(document.querySelectorAll('.cell'), function (el) {
          if (el.classList.contains('locked')) return;
          el.onclick = function () { load(+el.dataset.i); };
        });
      });
  }

  // -------------------------------------------------------------- particles

  function burst(x, y, n, col, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = spd * (0.35 + Math.random() * 0.65);
      G.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 0, m: 0.4 + Math.random() * 0.4, c: col });
    }
  }
  function ring(x, y) {
    for (var i = 0; i < 22; i++) {
      var a = i / 22 * Math.PI * 2;
      G.parts.push({ x: x, y: y, vx: Math.cos(a) * Curve.BLAST * 2.4, vy: Math.sin(a) * Curve.BLAST * 2.4, l: 0, m: 0.42, c: '#ffb020' });
    }
  }

  // ---------------------------------------------------------------- drawing

  // Grid is drawn in screen space so the lines stay exactly one pixel and the
  // numbers stay legible at any zoom. Spacing steps up a ladder the way a
  // graphing calculator's does, and stays anchored on the operative.
  var LADDER = [0.25, 0.5, 1, 2, 5, 10, 25, 50];

  function gridStep() {
    for (var i = 0; i < LADDER.length; i++) {
      if (LADDER[i] * SCALE * cam.z >= 15) return LADDER[i];
    }
    return LADDER[LADDER.length - 1];
  }

  function screenBg() {
    resetCam();
    ctx.fillStyle = '#15171a';
    ctx.fillRect(0, 0, W, H);

    var step = gridStep(), px = step * SCALE * cam.z;
    var i0 = Math.floor((0 - sx(G.player.x)) / px) - 1;
    var i1 = Math.ceil((W - sx(G.player.x)) / px) + 1;
    var j0 = Math.floor((0 - sy(G.player.y)) / px) - 1;
    var j1 = Math.ceil((H - sy(G.player.y)) / px) + 1;
    var i, j, gx, gy;

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#232830';
    ctx.beginPath();
    for (i = i0; i <= i1; i++) {
      if (i % 5 === 0) continue;
      gx = Math.round(sx(G.player.x) + i * px) + .5;
      ctx.moveTo(gx, 0); ctx.lineTo(gx, H);
    }
    for (j = j0; j <= j1; j++) {
      if (j % 5 === 0) continue;
      gy = Math.round(sy(G.player.y) + j * px) + .5;
      ctx.moveTo(0, gy); ctx.lineTo(W, gy);
    }
    ctx.stroke();

    ctx.strokeStyle = '#39414c';
    ctx.beginPath();
    for (i = i0; i <= i1; i++) {
      if (i % 5) continue;
      gx = Math.round(sx(G.player.x) + i * px) + .5;
      ctx.moveTo(gx, 0); ctx.lineTo(gx, H);
    }
    for (j = j0; j <= j1; j++) {
      if (j % 5) continue;
      gy = Math.round(sy(G.player.y) + j * px) + .5;
      ctx.moveTo(0, gy); ctx.lineTo(W, gy);
    }
    ctx.stroke();

    // the operative's own axes
    var ax = Math.round(sx(G.player.x)) + .5, ay = Math.round(sy(G.player.y)) + .5;
    ctx.strokeStyle = '#6f7883';
    ctx.beginPath();
    ctx.moveTo(0, ay); ctx.lineTo(W, ay);
    ctx.moveTo(ax, 0); ctx.lineTo(ax, H);
    ctx.stroke();

    ctx.font = '10px "Lucida Console", monospace';
    ctx.fillStyle = '#8b95a2';
    var lbl = function (n) { return String(+n.toFixed(2)); };
    for (i = i0; i <= i1; i++) {
      if (i % 5 || !i) continue;
      gx = sx(G.player.x) + i * px;
      if (gx > 14 && gx < W - 22) ctx.fillText(lbl(i * step), gx + 3, Math.min(H - 4, Math.max(12, ay - 5)));
    }
    for (j = j0; j <= j1; j++) {
      if (j % 5 || !j) continue;
      gy = sy(G.player.y) + j * px;
      if (gy > 14 && gy < H - 6) ctx.fillText(lbl(-j * step), Math.min(W - 30, Math.max(4, ax + 5)), gy - 3);
    }
  }

  function screenFx() {
    resetCam();
    ctx.fillStyle = 'rgba(0,0,0,.10)';
    for (var y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    var g = ctx.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, H * 0.92);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function plate(w) {
    var g = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
    g.addColorStop(0, '#9aa1a9');
    g.addColorStop(.45, '#6e747c');
    g.addColorStop(1, '#43484f');
    ctx.fillStyle = g;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.fillRect(w.x, w.y, w.w, 2); ctx.fillRect(w.x, w.y, 2, w.h);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(w.x, w.y + w.h - 2, w.w, 2); ctx.fillRect(w.x + w.w - 2, w.y, 2, w.h);

    var along = w.h >= w.w, n = Math.max(2, Math.floor((along ? w.h : w.w) / 34));
    for (var i = 0; i < n; i++) {
      var t = (i + .5) / n;
      var rx = along ? w.x + w.w / 2 : w.x + w.w * t;
      var ry = along ? w.y + w.h * t : w.y + w.h / 2;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.arc(rx, ry + 1, 2.6, 0, 7); ctx.fill();
      var rg = ctx.createRadialGradient(rx - 1, ry - 1, .3, rx, ry, 2.6);
      rg.addColorStop(0, '#e6e9ec'); rg.addColorStop(1, '#787f88');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(rx, ry, 2.4, 0, 7); ctx.fill();
    }
  }

  function sphere(x, y, r, c1, c2, c3) {
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + r * .82, r * .94, r * .3, 0, 0, 7);
    ctx.fill();
    var g = ctx.createRadialGradient(x - r * .38, y - r * .44, r * .05, x, y, r * 1.08);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(.16, c1);
    g.addColorStop(.6, c2);
    g.addColorStop(1, c3);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawWalls() { G.sec.walls.forEach(plate); }

  function drawEnemies() {
    G.sec.enemies.forEach(function (e, i) {
      if (G.dead.has(i)) return;
      var bul = e.type === 'b', pal = palette(e.fam);
      var off = e.fam && G.fam !== e.fam;              // keyed to another character

      ctx.globalAlpha = off ? .5 : 1;
      if (e.fam) {
        var c = Families.BY_ID[e.fam].col;
        sphere(e.x, e.y, e.r, mix(c, 255, .5), mix(c, 0, .3), mix(c, 0, .72));
      } else if (bul) {
        sphere(e.x, e.y, e.r, '#cfc9b4', '#7a7462', '#2f2c25');
      } else {
        sphere(e.x, e.y, e.r, '#cdd2d8', '#767d87', '#31353b');
      }

      if (bul) {                                       // armour band
        ctx.strokeStyle = 'rgba(30,28,22,.7)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * .96, e.r * .42, 0, 0, 7); ctx.stroke();
      }

      if (e.fam) {
        Rigs.draw(ctx, e.fam, e.x, e.y, e.r, pal);
      } else {
        var pulse = .72 + .28 * Math.sin(G.t * 3 + i);
        ctx.globalAlpha = pulse;
        Rigs.lens(ctx, e.x, e.y - e.r * .06, e.r * .68, e.r * .23, 0, pal);
      }
      ctx.globalAlpha = 1;
    });
  }

  function drawPlayer() {
    var p = G.player, r = 17;
    ctx.setLineDash([3 / cam.z, 5 / cam.z]);
    ctx.strokeStyle = 'rgba(210,220,230,.28)';
    ctx.lineWidth = 1 / cam.z;
    ctx.beginPath();
    ctx.arc(G.sec.start[0], G.sec.start[1], G.sec.move, 0, 7);
    ctx.stroke();
    ctx.setLineDash([]);

    sphere(p.x, p.y, r, '#f2f4f6', '#b3b8bf', '#4b5158');
    // the operative wears the rig of whatever family is being written
    Rigs.draw(ctx, G.fam || 'freeform', p.x, p.y, r, palette(G.fam));
  }

  // Labels ride above the world in screen space, so they never scale or skew.
  function drawLabels() {
    resetCam();
    ctx.font = 'bold 10px "Lucida Console", monospace';
    ctx.textAlign = 'center';
    G.sec.enemies.forEach(function (e, i) {
      if (G.dead.has(i)) return;
      var ex = sx(e.x), ey = sy(e.y), rr = e.r * cam.z;
      if (ex < -60 || ex > W + 60 || ey < -60 || ey > H + 60) return;

      var u = (e.x - G.player.x) / SCALE, v = (G.player.y - e.y) / SCALE;
      var txt = u.toFixed(1) + ', ' + v.toFixed(1);
      var ly = ey - rr - 7;
      if (ly < 12) ly = ey + rr + 15;
      var w = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(8,10,13,.78)';
      ctx.fillRect(ex - w / 2 - 3, ly - 9, w + 6, 12);
      ctx.fillStyle = e.fam ? Families.BY_ID[e.fam].col : '#ffc451';
      ctx.fillText(txt, ex, ly);

      if (e.fam) {                                    // family badge under the shell
        ctx.save();
        ctx.translate(ex - 8, ey + rr + 3);
        ctx.strokeStyle = Families.BY_ID[e.fam].col;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = G.fam === e.fam ? 1 : .45;
        ctx.stroke(glyphPath(e.fam));
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    });
    ctx.textAlign = 'left';
  }

  // Draws the polyline up to `head` px of arc; head = Infinity draws all of it.
  function beamPath(pts, head) {
    var acc = 0, last = null;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      var L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc + L >= head) {
        var t = L < 1e-9 ? 0 : (head - acc) / L;
        last = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
        ctx.lineTo(last.x, last.y);
        return last;
      }
      acc += L;
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    return pts[pts.length - 1];
  }

  var LASER = [
    ['rgba(255,60,10,.16)', 12],
    ['rgba(255,74,18,.42)', 6.5],
    ['#ff3b16', 3],
    ['#ffe6b4', 1.2]
  ];

  // Beam widths are divided by the zoom so the trace keeps a constant weight on
  // screen, the way a plotted curve does.
  function laser(pts, head, alpha) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var tip = null;
    for (var i = 0; i < LASER.length; i++) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = LASER[i][0];
      ctx.lineWidth = LASER[i][1] / cam.z;
      tip = beamPath(pts, head);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return tip;
  }

  function tipFlare(t, k) {
    if (!t) return;
    var rad = 20 * k / cam.z;
    var g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, rad);
    g.addColorStop(0, 'rgba(255,250,235,.95)');
    g.addColorStop(.35, 'rgba(255,140,30,.55)');
    g.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(t.x, t.y, rad, 0, 7); ctx.fill();
  }

  function drawPreview() {
    if (!G.preview) return;
    G.preview.beams.forEach(function (b) {
      ctx.setLineDash([3 / cam.z, 4 / cam.z]);
      ctx.globalAlpha = .34;
      ctx.strokeStyle = '#a83a1c';
      ctx.lineWidth = 1 / cam.z;
      beamPath(b.world, Infinity);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      var tip = laser(b.pts, Infinity, .62);
      tipFlare(tip, .55);
      b.dets.forEach(function (d) {
        ctx.setLineDash([3 / cam.z, 5 / cam.z]);
        ctx.strokeStyle = 'rgba(255,176,32,.5)';
        ctx.lineWidth = 1 / cam.z;
        ctx.beginPath(); ctx.arc(d.x, d.y, Curve.BLAST, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      });
    });
  }

  function drawShot() {
    var s = G.shot;
    s.beams.forEach(function (b) {
      ctx.globalAlpha = .18;
      ctx.strokeStyle = '#8d3218';
      ctx.lineWidth = 1 / cam.z;
      beamPath(b.pts, Infinity);
      ctx.stroke();
      ctx.globalAlpha = 1;
      tipFlare(laser(b.pts, s.head, 1), 1);
    });
  }

  function drawParts(dt) {
    for (var i = G.parts.length - 1; i >= 0; i--) {
      var p = G.parts[i];
      p.l += dt;
      if (p.l >= p.m) { G.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= .93; p.vy *= .93;
      ctx.globalAlpha = 1 - p.l / p.m;
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 1.5 / cam.z;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * .014, p.y - p.vy * .014);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    resetCam();
    var left = G.sec.enemies.length - G.dead.size;
    ctx.font = 'bold 11px "Lucida Console", monospace';
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(8, 8, 200, 38);
    ctx.fillStyle = '#ffb020';
    ctx.fillText('SECTOR ' + String(G.idx + 1).padStart(2, '0') + '  ' + G.sec.name.slice(0, 14), 14, 23);
    ctx.fillStyle = left ? '#ff6a3a' : '#9fe07a';
    ctx.fillText('HOSTILES ' + left + '   SHOTS ' + G.shots + '/' + G.sec.par, 14, 38);
  }

  // ------------------------------------------------------------------- loop

  var prev = performance.now();
  function frame(now) {
    var dt = Math.min((now - prev) / 1000, 0.05);
    prev = now;
    G.t += dt;

    if (G.dirty && !G.shot) recompute();
    if (G.shot) advanceShot(dt);

    screenBg();
    applyCam();
    drawWalls();
    if (G.shot) drawShot(); else drawPreview();
    drawEnemies();
    drawPlayer();
    drawParts(dt);
    drawLabels();
    drawHud();
    screenFx();

    requestAnimationFrame(frame);
  }

  load(Math.min(G.save.unlocked, Sectors.SECTORS.length - 1));
  fitCss();
  $('expr').focus();
  requestAnimationFrame(frame);
})();
