/* BACKUP — stamp-based blob version with warm-gold cursor.
 *
 * This is the file content immediately BEFORE the WebGL fluid simulation
 * rewrite. Saved on request so we can roll back to this stamp engine if
 * the fluid version misbehaves.
 *
 * To restore: copy this file's contents over hero.js (or rename this to
 * hero.js after backing up the fluid version separately).
 *
 * Identity hero — fluid-blob reveal system (v2: choreographed motion + helmet scan)
 *
 * Three layers inside .portrait__stage:
 *   1. <img.portrait__base>      — base portrait, always visible
 *   2. <canvas.portrait__reveal> — helmet composited through a fluid mask
 *   3. <svg.portrait__wire>      — helmet scan simulation (populated here)
 *
 * SVG wire layer is built programmatically and updated from the same
 * requestAnimationFrame loop: an elegant helmet outline that traces and
 * fades repeatedly, a faint interior grid clipped to the helmet shape,
 * and a horizontal scan bar that sweeps top-to-bottom continuously.
 *
 * Ghost swipes run on a scripted cycle:
 *   intro (helmet traces twice) →
 *   descend (top-down crossing diagonals) →
 *   ascend  (bottom-up crossing diagonals) →
 *   rest (pause at top) →
 *   repeat
 *
 * Each swipe has a primary sweep plus a tail-drag phase where the head
 * has exited but the tail lingers and shrinks. The final 1–2 passes of
 * a direction use a longer drag so the exit feels pulled off-screen.
 *
 * Blob gradient stops were tightened so the shape reads as a liquid body
 * with a clear head/tail instead of a diffuse fog. Stamp emission was
 * reshaped: larger forward-shifted head, narrower flanks, single tail.
 *
 * All tunables live in CFG / SIM.
 */
(() => {
  const stage    = document.querySelector('.portrait__stage');
  const portrait = document.querySelector('.portrait');
  const canvas   = document.querySelector('.portrait__reveal');
  const ctx      = canvas.getContext('2d');
  const wireSvg  = document.querySelector('.portrait__wire');
  const SVG_NS   = 'http://www.w3.org/2000/svg';
const HELMET_SRC = 'helmet-new.png';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CFG = {
    /* ----- shared stamp appearance ----- */
    maxAlpha:            0.98,
    maxStamps:           900,

    /* ----- cursor blob ----- */
    cursorBaseRatio:     0.125,
    cursorLifeMs:        500,
    cursorSpring:        0.16,
    cursorDamping:       0.78,
    cursorHoleSpeed:     14,
    cursorHoleSpeedMax:  44,

    /* ----- fluid cursor (landonorris.com-style) -----
     * Velocity-gated: below cursorMinEmitSpeed, no stamps emit so the blob
     * vanishes the instant the cursor stops. Above it, baseR + strength
     * scale linearly with speed up to cursorMaxSpeedRef.
     * cursorColor + cursorAlpha control the visible warm-gold fluid; the
     * helmet is composited on top with source-atop so it only appears
     * where the fluid has been drawn — i.e. the cursor "reveals" it. */
    cursorMinEmitSpeed:  1.4,
    cursorMaxSpeedRef:   28,
    cursorSizeMin:       0.55,
    cursorSizeMax:       1.65,
    cursorColor:         { r: 212, g: 168, b: 80 },   // warm gold
    cursorAlpha:         0.55,

    /* ----- ghost swipes ----- */
    swipeBaseRatio:      0.11,    // compact droplet — dominance via size + spacing
    swipeLifeMs:         700,     // stamps persist a touch longer
    swipeIdleAfterMs:    1400,    // cursor idle threshold before cycle runs

    /* ----- helmet fit (scale + position only — no cropping) ----- */
helmetFit: {
  scale: 0.78,   // bigger → wraps full head width
  cx:    0.50,
  cy:    0.35,   // lower → sits properly over face + neck
},    };

  const SIM = {
    cycle: {
      introMs:            3400,   // helmet traces ~2× before ghosts begin
      descendCount:       4,
      descendSpacingMs:   1050,   // time between spawns in descend
      ascendCount:        3,
      ascendSpacingMs:    1100,
      restMs:             3500,   // pause at top of loop
      swipeDurMin:        1120,   // main sweep duration (↑ from ~800)
      swipeDurMax:        1320,
    },
    tail: {
      dragMs:             900,    // tail drag after head exits
      dragMsFinal:        1400,   // longer drag on last 1–2 passes of a direction
    },
    // Helmet construction wave: top-down reveal + trailing dissolve.
    //   buildMs  — time for the wave's leading edge to travel crown→chin
    //   holdMs   — brief hold at the bottom before fade-out completes
    //   restMs   — pause after the pattern has fully dissolved
    //   trailVb  — length of trailing fade in viewBox y-units
    wave: {
      buildMs:            1800,   // unravel duration (1.5–2s range)
      holdMs:             900,    // hold at bottom before disappearing
      restMs:             600,    // short pause before the next unravel
      trailVb:            620,    // trail length so rows linger but fade
    },
    // helmet simulation coords — viewBox matches stage aspect 2752×1536
    vbW: 2752,
    vbH: 1536,
    helmetPath:
      'M 1378 36 ' +
      'C 1614 36, 1806 242, 1806 496 ' +
      'C 1806 860, 1680 1060, 1378 1060 ' +
      'C 1076 1060, 950 860, 950 496 ' +
      'C 950 242, 1142 36, 1378 36 Z',
    visorPath:
      'M 1060 470 ' +
      'C 1088 408, 1212 384, 1378 382 ' +
      'C 1544 384, 1668 408, 1696 470 ' +
      'C 1710 570, 1692 666, 1650 732 ' +
      'C 1558 760, 1468 766, 1378 766 ' +
      'C 1288 766, 1198 760, 1106 732 ' +
      'C 1064 666, 1046 570, 1060 470 Z',
    seamPaths: [
      'M 1090 406 C 1200 384, 1556 384, 1666 406',
      'M 1378 40 L 1378 380',
      'M 1160 560 C 1150 640, 1158 720, 1200 800',
      'M 1596 560 C 1606 640, 1598 720, 1556 800',
      'M 1118 732 Q 1378 792, 1638 732',
    ],
  };

  const helmet = new Image();
  helmet.decoding = 'async';
  helmet.src = HELMET_SRC;

  let W = 0, H = 0, DPR = 1;

  function resize() {
    const rect = stage.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
  }

  /* ---------- stamp pool ---------- */
const stamps = [];
function addStamp(
  x,
  y,
  r,
  life,
  alphaMul = 1,
  hole = false,
  angle = 0,
  sx = 1,
  sy = 1,
  kind = 'stamp'
) {
  if (r < 1 || life < 16) return;
  stamps.push({ x, y, r, life, age: 0, alphaMul, hole, angle, sx, sy, kind });
  if (stamps.length > CFG.maxStamps) {
    stamps.splice(0, stamps.length - CFG.maxStamps);
  }
}

  /* Blob emission = head + body + narrow flanks + tail + wisp (+ optional hole). */
function emitBlob(cx, cy, vx, vy, baseR, lifeMs, strength = 1, forceHole = false, profile = 'cursor') {
  const speed = Math.hypot(vx, vy);
  let dx = 1, dy = 0;
  if (speed > 0.001) { dx = vx / speed; dy = vy / speed; }
  const px = -dy, py = dx;

  const isSwipe = profile === 'swipe';
  const angle = speed > 0.001 ? Math.atan2(vy, vx) : 0;

  if (isSwipe) {
    for (let i = stamps.length - 1; i >= 0; i--) {
      if (stamps[i].kind === 'swipeShape' || stamps[i].kind === 'swipeHole') {
        stamps.splice(i, 1);
      }
    }

    const headR = baseR * 0.34;
    const bodyR = headR * 0.72;
    const tailR = headR * 0.42;
    const wispR = headR * 0.22;

    const headForward = headR * 0.42;
    const bodyBack = headR * 0.22;
    const tailBack = headR * 0.72;
    const wispBack = headR * 1.18;

    addStamp(cx + dx * headForward, cy + dy * headForward, headR, lifeMs, 1.0 * strength, false, angle, 1.18, 0.92, 'swipeShape');
    addStamp(cx - dx * bodyBack, cy - dy * bodyBack, bodyR, lifeMs * 0.96, 0.96 * strength, false, angle, 1.10, 0.95, 'swipeShape');
    addStamp(cx - dx * tailBack, cy - dy * tailBack, tailR, lifeMs * 0.82, 0.70 * strength, false, angle, 1.45, 0.78, 'swipeShape');
    addStamp(cx - dx * wispBack, cy - dy * wispBack, wispR, lifeMs * 0.62, 0.42 * strength, false, angle, 1.75, 0.62, 'swipeShape');

    if (forceHole) {
      addStamp(cx - dx * headR * 0.06, cy - dy * headR * 0.06, headR * 0.22, lifeMs * 0.88, 1.0 * strength, true, angle, 1.0, 1.0, 'swipeHole');
    }
    return;
  }

  const headGrow = 1 + Math.min(speed * 0.03, 0.85);
  const headR = baseR * headGrow * 1.35;
  const sf = Math.min(speed * 0.018, 0.35);
  const jit = () => 1 + (Math.random() - 0.5) * 0.04;

  const headForward = headR * 0.35;
  const flankOff = headR * 0.18;
  const tailBack = headR * 0.50;
  const wispBack = headR * 0.80;

  const headScaleX = (1 + sf) * jit();
  const headScaleY = (1 / (1 + sf * 0.55)) * jit();

  addStamp(cx + dx * headForward, cy + dy * headForward, headR, lifeMs, 1.0 * strength, false, angle, headScaleX, headScaleY);
  addStamp(cx, cy, headR * 0.70, lifeMs * 0.95, 1.0 * strength, false, angle, (1 + sf * 0.5) * jit(), (1 / (1 + sf * 0.3)) * jit());

  const flankSx = 1 + sf * 0.35;
  const flankSy = 1 / (1 + sf * 0.2);

  addStamp(cx + px * flankOff, cy + py * flankOff, headR * 0.50, lifeMs * 0.82, 0.5 * strength, false, angle, flankSx * jit(), flankSy * jit());
  addStamp(cx - px * flankOff, cy - py * flankOff, headR * 0.50, lifeMs * 0.82, 0.5 * strength, false, angle, flankSx * jit(), flankSy * jit());
  addStamp(cx - dx * tailBack, cy - dy * tailBack, headR * 0.22, lifeMs * 0.72, 0.68 * strength, false, angle, (1.18 + sf) * jit(), (1 / (1 + sf * 0.5)) * jit());
  addStamp(cx - dx * wispBack, cy - dy * wispBack, headR * 0.12, lifeMs * 0.55, 0.42 * strength, false, angle, (1 + sf * 0.3) * jit(), (1 / (1 + sf * 0.15)) * jit());

  if (forceHole) {
    addStamp(cx, cy, headR * 0.50, lifeMs * 0.90, 1.0 * strength, true, angle, (1 + sf * 0.5) * jit(), (1 / (1 + sf * 0.3)) * jit());
  } else if (speed > CFG.cursorHoleSpeed) {
    const k = Math.min((speed - CFG.cursorHoleSpeed) / (CFG.cursorHoleSpeedMax - CFG.cursorHoleSpeed), 1);
    addStamp(cx - dx * baseR * 0.12, cy - dy * baseR * 0.12, baseR * (0.26 + k * 0.42), lifeMs * 0.5, (0.5 + k * 0.4) * strength, true, angle, 1 + sf * 0.7, 1 / (1 + sf * 0.4));
  }
}
  /* ---------- cursor physics ---------- */
  let cursorX = null, cursorY = null;
  let hasPointer = false;
  let lastPointerMove = -1e9;
  const blob = { x: 0, y: 0, vx: 0, vy: 0, init: false };

  function onPointerMove(e) {
    if (e.pointerType === 'touch') return;
    const rect = stage.getBoundingClientRect();
    cursorX = e.clientX - rect.left;
    cursorY = e.clientY - rect.top;
    if (!blob.init) { blob.x = cursorX; blob.y = cursorY; blob.init = true; }
    hasPointer = true;
    lastPointerMove = performance.now();
  }
  function onPointerLeave() { hasPointer = false; }

  stage.addEventListener('pointermove',  onPointerMove,  { passive: true });
  stage.addEventListener('pointerenter', onPointerMove,  { passive: true });
  stage.addEventListener('pointerleave', onPointerLeave, { passive: true });

  /* ---------- ghost choreography ---------- */
  const swipes = [];
  const cycle  = { phase: 'stopped', start: 0, spawned: 0, nextAt: 0 };

  function setPhase(phase, now) {
    cycle.phase   = phase;
    cycle.start   = now;
    cycle.spawned = 0;
    cycle.nextAt  = now;
  }

  function spawnScriptedSwipe(direction, index, total) {
    const dirX = (index % 2 === 0) ? 1 : -1;
    const frac = total > 1 ? (index / (total - 1)) : 0;
    const band = direction === 'descend'
      ? 0.24 + frac * 0.54
      : 0.78 - frac * 0.54;
    const slopeSign = (index % 2 === 0) ? 1 : -1;
    const slope = slopeSign * 0.13;
    const arc   = slopeSign * 0.05;
    const startX = dirX > 0 ? -0.22 : 1.22;
    const endX   = dirX > 0 ?  1.22 : -0.22;
    const fromY = (band - slope / 2) * H;
    const toY   = (band + slope / 2) * H;
    const midY  = (fromY + toY) / 2 + arc * H;
    const isFinal    = index >= total - 2;
    const tailDragMs = isFinal ? SIM.tail.dragMsFinal : SIM.tail.dragMs;
    const dur = SIM.cycle.swipeDurMin
              + Math.random() * (SIM.cycle.swipeDurMax - SIM.cycle.swipeDurMin);
    swipes.push({
      start: performance.now(),
      dur, tailDragMs, isFinal,
      from: { x: startX * W, y: fromY },
      mid:  { x: (startX + endX) * 0.5 * W, y: midY },
      to:   { x: endX   * W, y: toY },
      baseR: CFG.swipeBaseRatio * Math.min(W, H) * (0.95 + Math.random() * 0.2),
      prevX: null, prevY: null
    });
  }

  function tickCycle(now) {
    if (reducedMotion) return;
    const cursorIdle = !hasPointer || (now - lastPointerMove) > CFG.swipeIdleAfterMs;
    if (!cursorIdle) {
      if (cycle.phase !== 'stopped') {
        cycle.phase = 'stopped';
        swipes.length = 0;
      }
      return;
    }
    if (cycle.phase === 'stopped') setPhase('intro', now);
    const c = SIM.cycle;
    const elapsed = now - cycle.start;
    switch (cycle.phase) {
      case 'intro':
        if (elapsed >= c.introMs) setPhase('descend', now);
        break;
      case 'descend':
        if (cycle.spawned < c.descendCount && now >= cycle.nextAt) {
          spawnScriptedSwipe('descend', cycle.spawned, c.descendCount);
          cycle.spawned++;
          cycle.nextAt = now + c.descendSpacingMs;
        } else if (cycle.spawned >= c.descendCount && swipes.length === 0) {
          setPhase('ascend', now);
        }
        break;
      case 'ascend':
        if (cycle.spawned < c.ascendCount && now >= cycle.nextAt) {
          spawnScriptedSwipe('ascend', cycle.spawned, c.ascendCount);
          cycle.spawned++;
          cycle.nextAt = now + c.ascendSpacingMs;
        } else if (cycle.spawned >= c.ascendCount && swipes.length === 0) {
          setPhase('rest', now);
        }
        break;
      case 'rest':
        if (elapsed >= c.restMs) setPhase('descend', now);
        break;
    }
  }

  function tickSwipes(now) {
    for (let i = swipes.length - 1; i >= 0; i--) {
      const s = swipes[i];
      const tRaw = (now - s.start) / s.dur;
      if (tRaw < 0) continue;
      if (tRaw < 1) {
        const ease = 0.5 - 0.5 * Math.cos(tRaw * Math.PI);
        const u = ease, iu = 1 - u;
        const px = iu * iu * s.from.x + 2 * iu * u * s.mid.x + u * u * s.to.x;
        const py = iu * iu * s.from.y + 2 * iu * u * s.mid.y + u * u * s.to.y;
        let vx = 0, vy = 0;
        if (s.prevX !== null) { vx = px - s.prevX; vy = py - s.prevY; }
        s.prevX = px; s.prevY = py;
        const envelope = Math.sin(tRaw * Math.PI);
        emitBlob(px, py, vx, vy, s.baseR, CFG.swipeLifeMs, 0.75 + envelope * 0.3, true);
      } else {
        const tDrag = (now - s.start - s.dur) / s.tailDragMs;
        if (tDrag >= 1) { swipes.splice(i, 1); continue; }
        const vx = s.to.x - s.mid.x;
        const vy = s.to.y - s.mid.y;
        const len = Math.hypot(vx, vy) || 1;
        const dx = vx / len, dy = vy / len;
        const shrink   = Math.pow(1 - tDrag, 0.85);
        const pullBack = (1 - tDrag * 0.25);
        const str      = 0.62 * shrink;
        addStamp(s.to.x - dx * s.baseR * 0.35 * pullBack, s.to.y - dy * s.baseR * 0.35 * pullBack, s.baseR * 0.78 * shrink, CFG.swipeLifeMs * 0.8, str);
        addStamp(s.to.x - dx * s.baseR * 1.05 * pullBack, s.to.y - dy * s.baseR * 1.05 * pullBack, s.baseR * 0.5 * shrink, CFG.swipeLifeMs * 0.6, 0.42 * shrink);
      }
    }
  }

  /* ---------- helmet wire SVG (unchanged) ---------- */
  let waveGrad = null;
  let waveStops = null;

  function initHelmetSim() {
    if (!wireSvg) return;
    wireSvg.setAttribute('viewBox', `0 0 ${SIM.vbW} ${SIM.vbH}`);
    wireSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    while (wireSvg.firstChild) wireSvg.removeChild(wireSvg.firstChild);

    const defs = document.createElementNS(SVG_NS, 'defs');
    const clip = document.createElementNS(SVG_NS, 'clipPath');
    clip.setAttribute('id', 'hx-helmet-clip');
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const clipShape = document.createElementNS(SVG_NS, 'path');
    clipShape.setAttribute('d', SIM.helmetPath);
    clip.appendChild(clipShape);
    defs.appendChild(clip);

    waveGrad = document.createElementNS(SVG_NS, 'linearGradient');
    waveGrad.setAttribute('id', 'hx-wave-grad');
    waveGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
    waveGrad.setAttribute('x1', '0');
    waveGrad.setAttribute('x2', '0');
    waveGrad.setAttribute('y1', '-1000');
    waveGrad.setAttribute('y2', '-400');
    const stopData = [
      [0.00, 0.00], [0.40, 0.05], [0.60, 0.16], [0.75, 0.38],
      [0.83, 0.72], [0.87, 1.00], [0.88, 0.00], [1.00, 0.00],
    ];
    waveStops = [];
    for (const [off, op] of stopData) {
      const s = document.createElementNS(SVG_NS, 'stop');
      s.setAttribute('offset', off);
      s.setAttribute('stop-color', '#fff');
      s.setAttribute('stop-opacity', op);
      waveGrad.appendChild(s);
      waveStops.push(s);
    }
    defs.appendChild(waveGrad);

    const waveMask = document.createElementNS(SVG_NS, 'mask');
    waveMask.setAttribute('id', 'hx-wave-mask');
    waveMask.setAttribute('maskUnits', 'userSpaceOnUse');
    waveMask.setAttribute('x', '0');
    waveMask.setAttribute('y', '0');
    waveMask.setAttribute('width', String(SIM.vbW));
    waveMask.setAttribute('height', String(SIM.vbH));
    const maskRect = document.createElementNS(SVG_NS, 'rect');
    maskRect.setAttribute('x', '0');
    maskRect.setAttribute('y', '0');
    maskRect.setAttribute('width', String(SIM.vbW));
    maskRect.setAttribute('height', String(SIM.vbH));
    maskRect.setAttribute('fill', 'url(#hx-wave-grad)');
    waveMask.appendChild(maskRect);
    defs.appendChild(waveMask);

    const feather = document.createElementNS(SVG_NS, 'filter');
    feather.setAttribute('id', 'hx-feather');
    feather.setAttribute('x', '-2%');
    feather.setAttribute('y', '-2%');
    feather.setAttribute('width', '104%');
    feather.setAttribute('height', '104%');
    const fb = document.createElementNS(SVG_NS, 'feGaussianBlur');
    fb.setAttribute('stdDeviation', '0.6');
    feather.appendChild(fb);
    defs.appendChild(feather);

    wireSvg.appendChild(defs);

    const shellG = document.createElementNS(SVG_NS, 'g');
    shellG.setAttribute('class', 'hx-shell');
    shellG.setAttribute('mask', 'url(#hx-wave-mask)');
    shellG.setAttribute('filter', 'url(#hx-feather)');

    const gridG = document.createElementNS(SVG_NS, 'g');
    gridG.setAttribute('class', 'hx-grid');
    gridG.setAttribute('clip-path', 'url(#hx-helmet-clip)');
    gridG.setAttribute('fill', 'none');
    gridG.setAttribute('stroke', 'rgba(23,21,20,0.20)');
    gridG.setAttribute('stroke-width', '1');
    gridG.setAttribute('vector-effect', 'non-scaling-stroke');

    const gridMinX = 950,  gridMaxX = 1806;
    const gridMinY = 36,   gridMaxY = 1060;
    const meshCx   = 1378, meshCy   = 496;
    const step     = 20;
    const yTopSpan = meshCy - gridMinY;
    const yBotSpan = gridMaxY - meshCy;

    for (let x = gridMinX; x <= gridMaxX; x += step) {
      const dx       = x - meshCx;
      const topBend  = dx * 0.48;
      const botBend  = dx;
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d',
        `M ${x - topBend} ${gridMinY} ` +
        `C ${x} ${gridMinY + 220}, ` +
        `${x - dx * 0.22} ${gridMaxY - 260}, ` +
        `${x - botBend} ${gridMaxY}`);
      gridG.appendChild(p);
    }
    for (let y = gridMinY; y <= gridMaxY; y += step) {
      const hFactor   = y < meshCy
        ? (meshCy - y) / yTopSpan
        : (y - meshCy) / yBotSpan;
      const sideDip   = 12 + hFactor * 52;
      const polarLift = y < meshCy
        ? (1 - hFactor) * 5
        : -hFactor * 2.5;
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d',
        `M ${gridMinX} ${y + sideDip} ` +
        `Q ${meshCx} ${y - sideDip * 0.32 + polarLift}, ` +
        `${gridMaxX} ${y + sideDip}`);
      gridG.appendChild(p);
    }
    shellG.appendChild(gridG);

    const seamG = document.createElementNS(SVG_NS, 'g');
    seamG.setAttribute('class', 'hx-seams');
    seamG.setAttribute('clip-path', 'url(#hx-helmet-clip)');
    seamG.setAttribute('fill', 'none');
    seamG.setAttribute('stroke', 'rgba(23,21,20,0.34)');
    seamG.setAttribute('stroke-width', '1.2');
    seamG.setAttribute('stroke-linecap', 'round');
    seamG.setAttribute('vector-effect', 'non-scaling-stroke');
    for (const d of SIM.seamPaths) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      seamG.appendChild(p);
    }
    shellG.appendChild(seamG);

    const visorOutline = document.createElementNS(SVG_NS, 'path');
    visorOutline.setAttribute('class', 'hx-outline hx-visor');
    visorOutline.setAttribute('d', SIM.visorPath);
    shellG.appendChild(visorOutline);

    const outlinePath = document.createElementNS(SVG_NS, 'path');
    outlinePath.setAttribute('class', 'hx-outline');
    outlinePath.setAttribute('d', SIM.helmetPath);
    shellG.appendChild(outlinePath);

    wireSvg.appendChild(shellG);
  }

  function updateHelmetSim(now) {
    if (!waveGrad) return;
    const W_                = SIM.wave;
    const trail             = W_.trailVb;
    const bufferBelow       = 80;
    const helmetTop         = 36;
    const helmetBottom      = 1060;
    const waveStartY        = helmetTop - bufferBelow;
    const waveEndY          = helmetBottom + trail;
    let leadY;
    if (reducedMotion) {
      leadY = helmetBottom + trail * 0.45;
    } else {
      const totalMs = W_.buildMs + W_.holdMs + W_.restMs;
      const phase   = now % totalMs;
      if (phase < W_.buildMs) {
        const t  = phase / W_.buildMs;
        const ts = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        leadY = waveStartY + (waveEndY - waveStartY) * ts;
      } else if (phase < W_.buildMs + W_.holdMs) {
        leadY = waveEndY;
      } else {
        leadY = waveEndY + 400;
      }
    }
    const y1 = leadY - trail;
    const y2 = leadY + bufferBelow;
    waveGrad.setAttribute('y1', y1.toFixed(1));
    waveGrad.setAttribute('y2', y2.toFixed(1));
  }

  /* ---------- main loop ---------- */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(now - last, 48);
    last = now;

    if (hasPointer && cursorX !== null) {
      const ax = (cursorX - blob.x) * CFG.cursorSpring;
      const ay = (cursorY - blob.y) * CFG.cursorSpring;
      blob.vx = (blob.vx + ax) * CFG.cursorDamping;
      blob.vy = (blob.vy + ay) * CFG.cursorDamping;
      blob.x += blob.vx;
      blob.y += blob.vy;
      const speed = Math.hypot(blob.vx, blob.vy);
      if (speed > CFG.cursorMinEmitSpeed) {
        const sNorm = Math.min(speed / CFG.cursorMaxSpeedRef, 1);
        const sizeFactor = CFG.cursorSizeMin
                         + (CFG.cursorSizeMax - CFG.cursorSizeMin) * sNorm;
        const baseR   = CFG.cursorBaseRatio * Math.min(W, H) * sizeFactor;
        const strength = 0.55 + 0.45 * sNorm;
        emitBlob(blob.x, blob.y, blob.vx, blob.vy, baseR, CFG.cursorLifeMs, strength);
      }
    } else if (blob.init) {
      blob.vx *= 0.9;
      blob.vy *= 0.9;
      blob.x += blob.vx;
      blob.y += blob.vy;
    }

    tickCycle(now);
    tickSwipes(now);
    updateHelmetSim(now);

    for (let i = stamps.length - 1; i >= 0; i--) {
      stamps[i].age += dt;
      if (stamps[i].age >= stamps[i].life) stamps.splice(i, 1);
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* 1) colored fluid pass — warm-gold stamps */
    const C = CFG.cursorColor;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      if (s.hole) continue;
      const p = s.age / s.life;
      const fade = p < 0.15
        ? (p / 0.15)
        : Math.pow(1 - (p - 0.15) / 0.85, 1.6);
      const a = CFG.cursorAlpha * s.alphaMul * fade;
      if (a < 0.003) continue;

      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.angle) ctx.rotate(s.angle);

      if (s.kind === 'swipeShape') {
        const r = s.r;
        ctx.beginPath();
        ctx.moveTo(r * 0.95, 0);
        ctx.bezierCurveTo(r * 0.55, -r * 0.75, -r * 0.25, -r * 0.80, -r * 0.55, -r * 0.35);
        ctx.bezierCurveTo(-r * 0.78, -r * 0.05, -r * 0.72, r * 0.25, -r * 0.38, r * 0.38);
        ctx.bezierCurveTo(-r * 0.05, r * 0.55, r * 0.55, r * 0.30, r * 0.95, 0);
        ctx.closePath();
        const g = ctx.createRadialGradient(r * 0.10, 0, 0, r * 0.10, 0, r);
        g.addColorStop(0,    `rgba(${C.r},${C.g},${C.b},${a})`);
        g.addColorStop(0.65, `rgba(${C.r},${C.g},${C.b},${a})`);
        g.addColorStop(0.85, `rgba(${C.r},${C.g},${C.b},${a * 0.25})`);
        g.addColorStop(1,    `rgba(${C.r},${C.g},${C.b},0)`);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
        continue;
      }

      ctx.scale(s.sx, s.sy);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.r);
      g.addColorStop(0,    `rgba(${C.r},${C.g},${C.b},${a})`);
      g.addColorStop(0.82, `rgba(${C.r},${C.g},${C.b},${a})`);
      g.addColorStop(0.93, `rgba(${C.r},${C.g},${C.b},${a * 0.5})`);
      g.addColorStop(1,    `rgba(${C.r},${C.g},${C.b},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* 2) hole stamps */
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      if (!s.hole) continue;
      const p = s.age / s.life;
      const fade = p < 0.25 ? (p / 0.25) : (1 - (p - 0.25) / 0.75);
      const a = s.alphaMul * fade;
      if (a < 0.01) continue;

      ctx.save();
      ctx.translate(s.x, s.y);
      if (s.angle) ctx.rotate(s.angle);

      if (s.kind === 'swipeHole') {
        const r = s.r;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, `rgba(0,0,0,${a})`);
        g.addColorStop(0.62, `rgba(0,0,0,${a * 0.18})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      ctx.scale(s.sx, s.sy);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.r);
      g.addColorStop(0,    `rgba(0,0,0,${a})`);
      g.addColorStop(0.55, `rgba(0,0,0,${a * 0.45})`);
      g.addColorStop(1,    `rgba(0,0,0,0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* 3) helmet on top — source-atop */
    if (helmet.complete && helmet.naturalWidth) {
      ctx.globalCompositeOperation = 'source-atop';
      const hf = CFG.helmetFit;
      const aspect = helmet.naturalHeight / helmet.naturalWidth;
      const dw  = W * hf.scale;
      const dh  = dw * aspect;
      const dxh = W * hf.cx - dw / 2;
      const dyh = H * hf.cy - dh / 2;
      ctx.drawImage(helmet, dxh, dyh, dw, dh);
    }

    requestAnimationFrame(frame);
  }

  /* ---------- init ---------- */
  function init() {
    resize();
    window.addEventListener('resize', resize);
    initHelmetSim();
    portrait.classList.add('is-loaded');
    last = performance.now();
    requestAnimationFrame(frame);
  }

  if (helmet.complete && helmet.naturalWidth) init();
  else helmet.addEventListener('load', init, { once: true });
})();
