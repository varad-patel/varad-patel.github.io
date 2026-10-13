// rigs.js — the look of each character. One rig per function family: not just a
// tint but its own headgear and eyewear, drawn from canvas primitives so it
// stays sharp at any zoom.
//
//   Rigs.draw(ctx, familyId, x, y, r, pal)
//   pal = { col, lens: [light, mid, dark] }
//
// Everything is proportional to r, so the same rig serves a 15px construct and
// the operative's own sphere.
(function () {
  'use strict';

  var DARK = '#23262a', METAL = '#8d939b', STRAP = '#3a3f45';

  function rr(ctx, x, y, w, h, rad) {
    rad = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  // A tinted lens with a frame and a specular streak.
  function lens(ctx, x, y, rx, ry, tilt, pal, frame) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt || 0);
    var g = ctx.createLinearGradient(0, -ry, 0, ry);
    g.addColorStop(0, pal.lens[0]);
    g.addColorStop(.42, pal.lens[1]);
    g.addColorStop(1, pal.lens[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, 7);
    ctx.fill();
    if (frame !== false) {
      ctx.lineWidth = Math.max(0.8, ry * .5);
      ctx.strokeStyle = DARK;
      ctx.stroke();
    }
    ctx.globalAlpha = .5;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(-rx * .22, -ry * .4, rx * .44, ry * .17, -.18, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function clipShell(ctx, x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.clip();
  }

  // ------------------------------------------------------------ accessories

  function headphones(ctx, x, y, r, col) {
    ctx.strokeStyle = DARK;
    ctx.lineWidth = r * .17;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.0, -Math.PI * .88, -Math.PI * .12);
    ctx.stroke();
    for (var s = -1; s <= 1; s += 2) {
      ctx.fillStyle = DARK;
      rr(ctx, x + s * r * .96 - r * .17, y - r * .3, r * .34, r * .6, r * .13);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x + s * r * .96, y, r * .1, 0, 7);
      ctx.fill();
    }
  }

  function catEars(ctx, x, y, r, col) {
    for (var s = -1; s <= 1; s += 2) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x + s * r * .34, y - r * .82);
      ctx.lineTo(x + s * r * .62, y - r * 1.42);
      ctx.lineTo(x + s * r * .86, y - r * .58);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = DARK;
      ctx.lineWidth = r * .07;
      ctx.stroke();
    }
  }

  function cap(ctx, x, y, r, col, brimDir) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y - r * .12, r * .92, Math.PI * 1.06, Math.PI * 1.94);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = DARK;                                   // brim
    ctx.beginPath();
    ctx.ellipse(x + brimDir * r * .62, y - r * .5, r * .62, r * .17, brimDir * .12, 0, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)';                // button
    ctx.beginPath();
    ctx.arc(x, y - r * .96, r * .09, 0, 7);
    ctx.fill();
  }

  function bowler(ctx, x, y, r, col) {
    ctx.fillStyle = DARK;
    ctx.beginPath();
    ctx.ellipse(x, y - r * .62, r * 1.15, r * .16, 0, 0, 7);  // brim
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - r * .68, r * .58, Math.PI, 0);            // dome
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = col;                                     // hat band
    ctx.fillRect(x - r * .58, y - r * .78, r * 1.16, r * .13);
  }

  function deerstalker(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x, y - r * .58, r * 1.2, r * .2, 0, 0, 7);    // front/back brim
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - r * .6, r * .72, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';                     // check pattern
    ctx.lineWidth = r * .05;
    ctx.beginPath();
    ctx.moveTo(x - r * .4, y - r * 1.2); ctx.lineTo(x - r * .4, y - r * .6);
    ctx.moveTo(x + r * .3, y - r * 1.2); ctx.lineTo(x + r * .3, y - r * .6);
    ctx.moveTo(x - r * .7, y - r * .92); ctx.lineTo(x + r * .7, y - r * .92);
    ctx.stroke();
  }

  function hardhat(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y - r * .3, r * .78, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(x - r * 1.02, y - r * .42, r * 2.04, r * .16);  // flat brim
    ctx.fillStyle = 'rgba(255,255,255,.3)';                      // centre ridge
    ctx.fillRect(x - r * .07, y - r * 1.06, r * .14, r * .62);
  }

  function antenna(ctx, x, y, r, col) {
    ctx.strokeStyle = METAL;
    ctx.lineWidth = r * .08;
    ctx.beginPath();
    ctx.moveTo(x + r * .5, y - r * .82);
    ctx.quadraticCurveTo(x + r * .95, y - r * 1.4, x + r * .72, y - r * 1.62);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x + r * .72, y - r * 1.66, r * .13, 0, 7);
    ctx.fill();
  }

  function moustache(ctx, x, y, r) {
    ctx.fillStyle = '#e8e6e2';
    ctx.beginPath();
    ctx.moveTo(x, y + r * .34);
    ctx.quadraticCurveTo(x - r * .5, y + r * .18, x - r * .74, y + r * .5);
    ctx.quadraticCurveTo(x - r * .38, y + r * .5, x, y + r * .56);
    ctx.quadraticCurveTo(x + r * .38, y + r * .5, x + r * .74, y + r * .5);
    ctx.quadraticCurveTo(x + r * .5, y + r * .18, x, y + r * .34);
    ctx.fill();
  }

  function strap(ctx, x, y, r) {
    ctx.fillStyle = STRAP;
    ctx.fillRect(x - r, y - r * .2, r * 2, r * .22);
  }

  // ------------------------------------------------------------------ rigs

  var RIG = {
    // straight racing stripe, one wide band visor
    linear: function (ctx, x, y, r, pal) {
      clipShell(ctx, x, y, r);
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillRect(x - r, y - r * .78, r * 2, r * .17);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(x - r, y - r * .58, r * 2, r * .1);
      ctx.restore();
      lens(ctx, x, y - r * .04, r * .76, r * .25, 0, pal);
    },

    // headphones and cat-eye goggles
    parabola: function (ctx, x, y, r, pal) {
      headphones(ctx, x, y, r, pal.col);
      lens(ctx, x - r * .42, y - r * .06, r * .38, r * .22, .34, pal);
      lens(ctx, x + r * .42, y - r * .06, r * .38, r * .22, -.34, pal);
      ctx.fillStyle = DARK;
      ctx.fillRect(x - r * .12, y - r * .14, r * .24, r * .1);
    },

    // louvred shutter shades
    absolute: function (ctx, x, y, r, pal) {
      var w = r * 1.62, h = r * .52, lx = x - w / 2, ly = y - r * .3;
      ctx.fillStyle = pal.lens[1];
      rr(ctx, lx, ly, w, h, r * .12);
      ctx.fill();
      ctx.strokeStyle = DARK;
      ctx.lineWidth = r * .1;
      ctx.stroke();
      ctx.lineWidth = r * .09;
      ctx.beginPath();
      for (var i = 1; i < 4; i++) {
        ctx.moveTo(lx + r * .06, ly + h * i / 4);
        ctx.lineTo(lx + w - r * .06, ly + h * i / 4);
      }
      ctx.stroke();
      ctx.fillStyle = DARK;                                   // temple arms
      ctx.fillRect(x - r * 1.02, y - r * .26, r * .2, r * .12);
      ctx.fillRect(x + r * .82, y - r * .26, r * .2, r * .12);
    },

    // star goggles over a speckled shell
    cubic: function (ctx, x, y, r, pal) {
      clipShell(ctx, x, y, r);
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      [[-.5, -.62], [.36, -.5], [-.14, -.8], [.62, -.74]].forEach(function (p) {
        ctx.beginPath();
        ctx.arc(x + p[0] * r, y + p[1] * r, r * .05, 0, 7);
        ctx.fill();
      });
      ctx.restore();
      strap(ctx, x, y, r);
      for (var s = -1; s <= 1; s += 2) {
        lens(ctx, x + s * r * .42, y - r * .05, r * .36, r * .3, 0, pal);
        ctx.save();
        ctx.translate(x + s * r * .42, y - r * .05);
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath();
        for (var i = 0; i < 10; i++) {
          var a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * .08 : r * .19;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },

    // round aviator goggles with a strap, waves on the shell
    sine: function (ctx, x, y, r, pal) {
      clipShell(ctx, x, y, r);
      ctx.strokeStyle = 'rgba(255,255,255,.34)';
      ctx.lineWidth = r * .08;
      for (var k = 0; k < 2; k++) {
        var yy = y - r * (.62 - k * .26);
        ctx.beginPath();
        ctx.moveTo(x - r, yy);
        ctx.quadraticCurveTo(x - r * .5, yy - r * .16, x, yy);
        ctx.quadraticCurveTo(x + r * .5, yy + r * .16, x + r, yy);
        ctx.stroke();
      }
      ctx.restore();
      strap(ctx, x, y, r);
      for (var s = -1; s <= 1; s += 2) {
        ctx.fillStyle = METAL;
        ctx.beginPath();
        ctx.arc(x + s * r * .44, y - r * .04, r * .38, 0, 7);
        ctx.fill();
        lens(ctx, x + s * r * .44, y - r * .04, r * .28, r * .28, 0, pal, false);
      }
    },

    // ball cap and black shades
    tangent: function (ctx, x, y, r, pal) {
      cap(ctx, x, y, r, pal.col, 1);
      for (var s = -1; s <= 1; s += 2) {
        ctx.fillStyle = '#141416';
        ctx.beginPath();
        ctx.ellipse(x + s * r * .42, y + r * .04, r * .36, r * .24, -s * .12, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = '#141416';
      ctx.fillRect(x - r * .12, y - r * .02, r * .24, r * .1);
      ctx.globalAlpha = .35;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(x - r * .5, y - r * .04, r * .16, r * .07, -.3, 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    },

    // hard hat and a single level bar
    clamp: function (ctx, x, y, r, pal) {
      hardhat(ctx, x, y, r, pal.col);
      ctx.fillStyle = DARK;
      rr(ctx, x - r * .8, y - r * .06, r * 1.6, r * .3, r * .1);
      ctx.fill();
      lens(ctx, x, y + r * .09, r * .68, r * .09, 0, pal, false);
    },

    // gas mask filter, twin lenses, antenna
    exponential: function (ctx, x, y, r, pal) {
      antenna(ctx, x, y, r, pal.col);
      strap(ctx, x, y, r);
      for (var s = -1; s <= 1; s += 2) {
        ctx.fillStyle = METAL;
        ctx.beginPath();
        ctx.arc(x + s * r * .46, y - r * .14, r * .34, 0, 7);
        ctx.fill();
        lens(ctx, x + s * r * .46, y - r * .14, r * .25, r * .25, 0, pal, false);
      }
      ctx.fillStyle = STRAP;                                  // filter canister
      ctx.beginPath();
      ctx.arc(x, y + r * .48, r * .3, 0, 7);
      ctx.fill();
      ctx.strokeStyle = METAL;
      ctx.lineWidth = r * .07;
      ctx.beginPath();
      ctx.arc(x, y + r * .48, r * .18, 0, 7);
      ctx.stroke();
    },

    // deerstalker and a monocle on a chain
    logarithmic: function (ctx, x, y, r, pal) {
      deerstalker(ctx, x, y, r, pal.col);
      lens(ctx, x + r * .38, y + r * .06, r * .3, r * .3, 0, pal);
      ctx.strokeStyle = '#d8d4c8';
      ctx.lineWidth = r * .05;
      ctx.beginPath();
      ctx.moveTo(x + r * .66, y + r * .2);
      ctx.quadraticCurveTo(x + r * .88, y + r * .6, x + r * .5, y + r * .8);
      ctx.stroke();
      ctx.fillStyle = DARK;                                   // the other eye
      ctx.beginPath();
      ctx.arc(x - r * .38, y + r * .04, r * .11, 0, 7);
      ctx.fill();
    },

    // bowler, round spectacles, moustache
    rational: function (ctx, x, y, r, pal) {
      bowler(ctx, x, y, r, pal.col);
      for (var s = -1; s <= 1; s += 2) {
        lens(ctx, x + s * r * .38, y - r * .04, r * .27, r * .27, 0, pal);
      }
      ctx.strokeStyle = DARK;
      ctx.lineWidth = r * .07;
      ctx.beginPath();
      ctx.moveTo(x - r * .12, y - r * .04);
      ctx.lineTo(x + r * .12, y - r * .04);
      ctx.stroke();
      moustache(ctx, x, y, r);
    },

    // a waveform display for a face
    harmonic: function (ctx, x, y, r, pal) {
      var w = r * 1.6, h = r * .82;
      ctx.fillStyle = '#0d1014';
      rr(ctx, x - w / 2, y - h / 2, w, h, r * .14);
      ctx.fill();
      ctx.strokeStyle = METAL;
      ctx.lineWidth = r * .07;
      ctx.stroke();
      ctx.save();
      rr(ctx, x - w / 2, y - h / 2, w, h, r * .14);
      ctx.clip();
      ctx.strokeStyle = pal.col;
      ctx.lineWidth = r * .1;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (var i = 0; i <= 16; i++) {
        var t = i / 16, px = x - w / 2 + w * t;
        var py = y - (Math.sin(t * 9) * .5 + Math.sin(t * 21) * .28) * h * .34;
        ctx[i ? 'lineTo' : 'moveTo'](px, py);
      }
      ctx.stroke();
      ctx.restore();
    },

    // decaying orbit rings and a slim visor
    damped: function (ctx, x, y, r, pal) {
      ctx.strokeStyle = pal.col;
      ctx.lineWidth = r * .07;
      ctx.globalAlpha = .8;
      ctx.save();
      ctx.translate(x, y);
      for (var k = 0; k < 2; k++) {
        ctx.rotate(k ? 1.1 : -.5);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * (1.3 - k * .18), r * (.42 - k * .1), 0, 0, 7);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      lens(ctx, x, y - r * .04, r * .74, r * .2, 0, pal);
    },

    // fallback: a plain single visor
    freeform: function (ctx, x, y, r, pal) {
      lens(ctx, x, y - r * .06, r * .68, r * .23, 0, pal);
    }
  };

  function draw(ctx, id, x, y, r, pal) {
    var f = RIG[id] || RIG.freeform;
    ctx.save();
    f(ctx, x, y, r, pal);
    ctx.restore();
  }

  var API = { draw: draw, lens: lens, RIG: RIG };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.Rigs = API;
})();
