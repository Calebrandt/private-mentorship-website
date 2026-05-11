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
 * 1. <img.portrait__base>      — base portrait, always visible
 * 2. <canvas.portrait__reveal> — helmet composited through a fluid mask
 * 3. <svg.portrait__wire>      — helmet scan simulation (populated here)
 *
 * SVG wire layer is built programmatically and updated from the same
 * requestAnimationFrame loop: an elegant helmet outline that traces and
 * fades repeatedly, a faint interior grid clipped to the helmet shape,
 * and a horizontal scan bar that sweeps top-to-bottom continuously.
 *
 * Ghost swipes run on a scripted cycle:
 * intro (helmet traces twice) →
 * descend (top-down crossing diagonals) →
 * ascend  (bottom-up crossing diagonals) →
 * rest (pause at top) →
 * repeat
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
  /* Offscreen mask canvas — stamps draw here (any color, never shown).
     Each frame we use it as a clip mask for the helmet via destination-in,
     so the visible canvas only ever shows revealed helmet pixels.
     Net effect: blob is invisible/clear-glass in empty space; helmet
     is cleanly revealed where the blob crosses the head area. */
  const maskCanvas = document.createElement('canvas');
  const maskCtx    = maskCanvas.getContext('2d');
  /* portraitAlphaCanvas holds the base portrait's alpha channel as a
     stencil. It's used to punch the body silhouette out of the cream
     outside-helmet fill so the blob shows her t-shirt/body through
     the stroke instead of covering it with #f5f5f1. */
  const portraitAlphaCanvas = document.createElement('canvas');
  const portraitAlphaCtx    = portraitAlphaCanvas.getContext('2d');
  const baseImg  = document.querySelector('.portrait__base');
  /* Assistant portrait toggle — each entry pairs a photo with its own
     inline transform so the subject's face lands on the helmet/mesh anchor
     regardless of the source image's framing. The girl's framing matches
     hero.css's default scale(1.10) translateY(6%) origin 50% 35%, so her
     transform mirrors that. The guy's photo is framed looser, so he gets
     more zoom + an origin shift to pull his face up onto the mesh. */
  const PORTRAITS = [
    { src: 'Gemini_Generated_Image_nenw4knenw4knenw.png',
      transform: 'scale(1.10) translateY(6%)',
      origin: '50% 35%' },
    { src: 'Gemini_Generated_Image_yvhhcnyvhhcnyvhh.png',
      transform: 'scale(1.02) translateY(-3%)',
      origin: '50% 35%' },
  ];
  let portraitIdx = 0;
  const applyPortrait = () => {
    if (!baseImg) return;
    const p = PORTRAITS[portraitIdx];
    baseImg.src = p.src;
    baseImg.style.setProperty('transform', p.transform, 'important');
    baseImg.style.setProperty('transform-origin', p.origin, 'important');
  };
  applyPortrait();

  /* Minimal arrow button, fixed to the right edge. Click cycles portraits. */
  const swapStyle = document.createElement('style');
  swapStyle.className = 'pm-portrait-swap-style';
  swapStyle.textContent = `
    .pm-portrait-swap {
      position: absolute;
      right: 28px;
      top: 40%;
      width: 44px;
      height: 44px;
      padding: 0;
      border-radius: 50%;
      border: 1.5px solid #b88a36;
      background: rgba(255,255,255,0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #b88a36;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 50;
      transform: translateY(-50%);
      transition: background 180ms ease, border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
    }
    .pm-portrait-swap:hover {
      background: rgba(255,255,255,0.96);
      border-color: #b88a36;
      transform: translateY(-50%) translateX(2px);
      box-shadow: 0 6px 18px rgba(184,138,54,0.22);
    }
    .pm-portrait-swap:active {
      transform: translateY(-50%) scale(0.94);
    }
    .pm-portrait-swap svg { display: block; }
    @media (prefers-reduced-motion: reduce) {
      .pm-portrait-swap,
      .pm-portrait-swap:hover,
      .pm-portrait-swap:active { transition: none; }
    }
  `;
  document.head.appendChild(swapStyle);

  const swapBtn = document.createElement('button');
  swapBtn.className = 'pm-portrait-swap';
  swapBtn.type = 'button';
  swapBtn.setAttribute('aria-label', 'Switch assistant');
  swapBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  swapBtn.addEventListener('click', () => {
    portraitIdx = (portraitIdx + 1) % PORTRAITS.length;
    applyPortrait();
  });
  const swapHost = document.querySelector('.identity-hero') || document.querySelector('.hero') || document.body;
  swapHost.appendChild(swapBtn);

  const wireSvg  = document.querySelector('.portrait__wire');
  const SVG_NS   = 'http://www.w3.org/2000/svg';
const HELMET_SRC = 'helmet-new.png';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CFG = {
    /* ----- shared stamp appearance ----- */
    maxAlpha:            0.98,
    maxStamps:           900,

    /* ----- cursor blob ----- */
    cursorBaseRatio:     0.068,    // slightly larger droplet base
    cursorLifeMs:        460,
    cursorSpring:        0.22,
    cursorDamping:       0.68,     // more momentum = more fluid feel
    cursorHoleSpeed:     18,
    cursorHoleSpeedMax:  44,

    /* ----- fluid cursor (Lando-style metaball) -----
     * Idle-instant: when the cursor stops moving, no stamps emit AND
     * existing stamps decay fast so the blob disappears immediately.
     * Velocity-gated: shape grows from droplet → head+body → head+body+tail
     * → tail break-off based on speed. */
    cursorMinEmitSpeed:  1.2,
    cursorIdleMs:        60,       // ms since last pointer move = "idle"
    cursorIdleDecay:     3.0,      // stamp age multiplier while idle
    cursorMaxSpeedRef:   26,       // lower reference → reaches max shape sooner
    cursorSizeMin:       0.55,
    cursorSizeMax:       2.20,     // much bigger growth at speed
    cursorAlpha:         1.0,

    /* ----- metaball rendering -----
     * Blur+contrast applied when compositing the mask onto the visible
     * canvas. Blur merges overlapping stamps into one body; contrast
     * thresholds the result into a hard liquid edge (not a soft fog).
     * outsideColor renders the blob body where it does NOT overlap the
     * helmet silhouette — the color the user sees outside the face zone. */
    metaballBlur:        9,        // bigger merge radius = more fluid fusion
    metaballContrast:    14,       // softer threshold = organic edges not paint
    outsideColor:        '#f5f5f1',

    /* ----- ghost swipes ----- */
    swipeBaseRatio:      0.11,
    swipeLifeMs:         700,
    swipeIdleAfterMs:    1400,

    /* ----- helmet fit (scale + position only — no cropping) ----- */
    helmetFit: {
      scale: 0.86,
      cx:    0.50,
      cy:    0.41,
    },
  };

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
      // Each wave unravels slowly (2.8s crown→chin) so the mesh is
      // readable. A second wave is phase-offset by buildMs/2 so a new
      // unravel begins while the previous one is still halfway down —
      // net perceived repeat is ~1.4s, but no single wave rushes.
      buildMs:            2800,
      holdMs:             0,
      restMs:             0,
      trailVb:            560,
    },
    // helmet simulation coords — viewBox matches stage aspect 2752×1536
    vbW: 2752,
    vbH: 1536,
    // Mesh fit — scales the wire mesh around a center point so it sits
    // tight around the portrait's head instead of bleeding past the
    // ears/jaw. Increase `scale` to grow, decrease to shrink.
    meshFit: {
      scale: 0.78,   // tight around her head
      cx:    1378,   // viewBox center (matches face x)
      cy:    598,    // midpoint of helmet vertical extent
    },
    // Full-face SPORT helmet silhouette with a proper 3D ROUNDED DOME
    // at the top (not a narrow triangle). The dome is where the
    // unravel animation begins — a small reveal at the apex expands
    // downward through the dome, then over the face, then down the
    // chin bar. Chin bar, sides, and visor are unchanged.
    //
    // Path segments:
    //   (896,200)  left equator of dome
    //   dome arcs up and over to
    //   (1378,-200) apex (north pole)
    //   dome arcs down to
    //   (1860,200) right equator
    //   then upper flank → sidewall → chin bar → flat bottom →
    //   mirror chin bar → mirror sidewall → mirror upper flank → close.
    // Silhouette profile — a smooth teardrop/egg with no chin-bar step:
    //   y=-220  apex               rx=0     ← rounded crown
    //   y= 240  equator            rx≈518   ← widest (top is wider than bottom)
    //   y= 560  upper cheek        rx≈499
    //   y= 860  jaw                rx≈429
    //   y=1020  chin corners       rx≈330
    //   y=1152  chin point         rx=0
    // One continuous curve each side — dome → smooth taper → rounded
    // chin. No sidewall/chin-bar step. Matches user's egg-shape sketch.
    helmetPath:
      'M 860 240 ' +
      'C 860 -60, 1100 -220, 1378 -220 ' +         // left dome → apex
      'C 1656 -220, 1896 -60, 1896 240 ' +         // apex → right equator
      'C 1896 560, 1844 860, 1708 1020 ' +         // right side smooth taper
      'C 1620 1110, 1500 1152, 1378 1152 ' +       // right rounded chin
      'C 1256 1152, 1136 1110, 1048 1020 ' +       // left rounded chin
      'C 912 860, 860 560, 860 240 Z',             // left side smooth taper → close
    // Visor (eye port) — wide horizontal wrap-around port on the upper
    // third of the helmet. Taller/wider than an oval: nearly rectangular
    // with rounded corners, matching a sport helmet's full-width visor.
    visorPath:
      'M 1036 456 ' +
      'C 1092 398, 1240 380, 1378 380 ' +
      'C 1516 380, 1664 398, 1720 456 ' +
      'C 1736 544, 1724 628, 1684 694 ' +
      'C 1592 722, 1488 732, 1378 732 ' +
      'C 1268 732, 1164 722, 1072 694 ' +
      'C 1032 628, 1020 544, 1036 456 Z',
    // Mouth / chin vents — shallow downward arcs on the chin bar.
    // The curve (center drops below endpoints) matches the chin-bar
    // forward projection so the vents read as lying on a convex surface.
    ventPaths: [
      'M 1188 902 Q 1378 928, 1568 902',
      'M 1198 934 Q 1378 958, 1558 934',
      'M 1210 966 Q 1378 988, 1546 966',
      'M 1224 996 Q 1378 1016, 1532 996',
    ],
    // Structural seams — kept minimal to suit the smooth teardrop
    // silhouette (no chin-bar step means no sidewall/lower-seam lines).
    seamPaths: [
      'M 1078 404 C 1208 380, 1548 380, 1678 404',     // brow seam above visor
      'M 1378 -220 L 1378 380',                         // crown centerline
      // Shell-to-face-shield transition arc under the visor, following
      // the new smooth taper (no chin-bar step).
      'M 920 790 C 1140 840, 1616 840, 1836 790',
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
    maskCanvas.width  = canvas.width;
    maskCanvas.height = canvas.height;
    portraitAlphaCanvas.width  = canvas.width;
    portraitAlphaCanvas.height = canvas.height;
    renderPortraitAlpha();
  }

  /* Paint the base portrait (in its transformed position) into
     portraitAlphaCanvas. Later, destination-out with this canvas punches
     the girl's body silhouette out of the cream overlay. The CSS
     transform on .portrait__base is `scale(1.10) translateY(6%)` with
     origin `50% 35%` — we mirror that here so the stencil lines up
     pixel-perfectly with what the user sees. */
  function renderPortraitAlpha() {
    portraitAlphaCtx.setTransform(1, 0, 0, 1, 0, 0);
    portraitAlphaCtx.clearRect(0, 0, portraitAlphaCanvas.width, portraitAlphaCanvas.height);
    if (!baseImg || !baseImg.complete || !baseImg.naturalWidth) return;
    const scale = 1.10;
    const ox    = W * 0.50 * DPR;  // transform-origin x
    const oy    = H * 0.35 * DPR;  // transform-origin y
    const ty    = H * 0.06 * DPR;  // translateY(6%) of height
    portraitAlphaCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // object-fit: cover, scale(1.10) translateY(6%) about origin (50%, 35%).
    const cw = W, ch = H;
    const iw = baseImg.naturalWidth;
    const ih = baseImg.naturalHeight;
    // cover logic
    const s = Math.max(cw / iw, ch / ih);
    const dw = iw * s;
    const dh = ih * s;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    portraitAlphaCtx.save();
    // apply scale 1.10 about origin (cw*.5, ch*.35), then translate y by 6% of height
    portraitAlphaCtx.translate(cw * 0.5, ch * 0.35);
    portraitAlphaCtx.scale(scale, scale);
    portraitAlphaCtx.translate(-cw * 0.5, -ch * 0.35);
    portraitAlphaCtx.translate(0, ch * 0.06);
    portraitAlphaCtx.drawImage(baseImg, dx, dy, dw, dh);
    portraitAlphaCtx.restore();
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

  /* Velocity-driven liquid emission.
   * speed < 3:   head only                         → droplet
   * speed 3-8:   head + body                       → small water body
   * speed 8-18:  head + body + tail                → stretched liquid
   * speed > 18:  head + body + elongated tail      → pulled fluid
   * speed > 26:  + detached droplet (break-off)    → tail snaps away
   * speed > 20:  + inner hole (radial hollow)      → puddle with eye
   * Stamps are solid — the metaball filter on the visible canvas fuses
   * them into one body and thresholds the edges hard. No soft radial
   * wash here — that's what made it read as fog before. */
function emitBlob(cx, cy, vx, vy, baseR, lifeMs, strength = 1, forceHole = false, profile = 'cursor') {
  const speed = Math.hypot(vx, vy);
  let dx = 1, dy = 0;
  if (speed > 0.001) { dx = vx / speed; dy = vy / speed; }
  const angle = speed > 0.001 ? Math.atan2(vy, vx) : 0;

  if (profile === 'swipe') {
    for (let i = stamps.length - 1; i >= 0; i--) {
      if (stamps[i].kind === 'swipeShape' || stamps[i].kind === 'swipeHole') {
        stamps.splice(i, 1);
      }
    }
    const headR = baseR * 0.36;
    const bodyR = headR * 0.80;
    const tailR = headR * 0.52;
    addStamp(cx + dx * headR * 0.40, cy + dy * headR * 0.40, headR, lifeMs, strength, false, angle, 1.15, 0.92, 'swipeShape');
    addStamp(cx - dx * headR * 0.25, cy - dy * headR * 0.25, bodyR, lifeMs * 0.95, strength * 0.95, false, angle, 1.08, 0.95, 'swipeShape');
    addStamp(cx - dx * headR * 0.85, cy - dy * headR * 0.85, tailR, lifeMs * 0.75, strength * 0.75, false, angle, 1.35, 0.82, 'swipeShape');
    if (forceHole) {
      addStamp(cx - dx * headR * 0.06, cy - dy * headR * 0.06, headR * 0.20, lifeMs * 0.85, strength, true, angle, 1, 1, 'swipeHole');
    }
    return;
  }

  // Cursor mode.
  const sNorm = Math.min(speed / CFG.cursorMaxSpeedRef, 1);

  // Head — always present. Grows + elongates with speed.
  const headR = baseR * (1 + sNorm * 0.55);
  const headForward = headR * (0.20 + sNorm * 0.25);
  const headScaleX = 1 + sNorm * 0.35;
  const headScaleY = 1 / (1 + sNorm * 0.22);
  addStamp(cx + dx * headForward, cy + dy * headForward, headR, lifeMs, strength, false, angle, headScaleX, headScaleY);

  // Body — emits at mid speed, connects head to tail.
  if (speed > 3) {
    const bodyR = headR * 0.78;
    const bodyBack = headR * 0.42;
    const bodyFrac = Math.min((speed - 3) / 8, 1);
    addStamp(
      cx - dx * bodyBack, cy - dy * bodyBack,
      bodyR, lifeMs * 0.93,
      strength * (0.7 + bodyFrac * 0.25),
      false, angle,
      1 + sNorm * 0.28, 1 / (1 + sNorm * 0.18)
    );
  }

  // Tail — emits at higher speed, length scales with velocity.
  if (speed > 8) {
    const tailR = headR * (0.52 - sNorm * 0.15);
    const tailBack = headR * (0.95 + sNorm * 0.85);
    const tailFrac = Math.min((speed - 8) / 12, 1);
    addStamp(
      cx - dx * tailBack, cy - dy * tailBack,
      tailR, lifeMs * 0.78,
      strength * (0.55 + tailFrac * 0.25),
      false, angle,
      1 + sNorm * 0.25, 1 / (1 + sNorm * 0.18)
    );
  }

  // Break-off droplet — at moderate-to-high velocity the tail snaps off
  // as a separate drop. Threshold is low so a normal flick produces it.
  if (speed > 18 && Math.random() < 0.55) {
    const dropR = headR * (0.26 + sNorm * 0.10);
    const dropBack = headR * (1.7 + sNorm * 0.6);
    addStamp(
      cx - dx * dropBack, cy - dy * dropBack,
      dropR, lifeMs * 0.60,
      strength * 0.48,
      false, 0, 1, 1, 'droplet'
    );
  }

  // Inner hole — spin / fast motion punches a hollow in the middle.
  if (forceHole) {
    addStamp(cx, cy, headR * 0.45, lifeMs * 0.88, strength, true, angle, 1, 1);
  } else if (speed > CFG.cursorHoleSpeed) {
    const k = Math.min((speed - CFG.cursorHoleSpeed) / (CFG.cursorHoleSpeedMax - CFG.cursorHoleSpeed), 1);
    addStamp(cx - dx * baseR * 0.1, cy - dy * baseR * 0.1, baseR * (0.22 + k * 0.42), lifeMs * 0.45, (0.5 + k * 0.4) * strength, true, angle, 1 + sNorm * 0.35, 1 / (1 + sNorm * 0.2));
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

  /* ---------- parallax head-tracking ----------
   * Tracks the mouse anywhere on the page (not just over the stage) and
   * smoothly translates the entire .portrait__stage toward the cursor —
   * face, helmet, and wire mesh all move together as one unit because
   * they're inside the stage. Magnitude is intentionally subtle so it
   * feels like the portrait is alive, not floating.
   *
   * Same direction as cursor (mouse up = portrait up) per Lando's site —
   * gives a "head following" feel rather than a parallax-window depth feel.
   *
   * Smoothing is JS-side (lerp toward target each frame); no CSS transition
   * because the two would fight and stutter.
   */
  const PARALLAX = {
    maxX:    20,    // px — horizontal sway range
    maxY:    14,    // px — vertical sway range (smaller, feels natural)
    lerp:    0.08,  // 0 = no movement, 1 = instant snap
    targetX: 0,
    targetY: 0,
    curX:    0,
    curY:    0,
  };
  function onWindowMouseMove(e) {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;
    PARALLAX.targetX = ((e.clientX - cx) / cx) * PARALLAX.maxX;
    PARALLAX.targetY = ((e.clientY - cy) / cy) * PARALLAX.maxY;
  }
  window.addEventListener('mousemove', onWindowMouseMove, { passive: true });

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
        // forceHole=false — auto ghost swipes read as clean flying liquid
        // bodies, not donuts. Any hole in the middle makes them feel
        // hollow/ring-shaped instead of fluid and continuous.
        emitBlob(px, py, vx, vy, s.baseR, CFG.swipeLifeMs, 0.75 + envelope * 0.3, false);
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

  let waveGradB = null;
  let waveStopsB = null;

  function initHelmetSim() {
    if (!wireSvg) return;
    wireSvg.setAttribute('viewBox', `0 0 ${SIM.vbW} ${SIM.vbH}`);
    wireSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // Allow the crown (extended above y=0 in path coords) to render
    // outside the viewBox. The portrait stage also needs overflow
    // visible so the dome can extend above the stage bounds and sit
    // over the top of the head in the surrounding hero section.
    wireSvg.style.overflow = 'visible';
    if (stage) stage.style.overflow = 'visible';
    while (wireSvg.firstChild) wireSvg.removeChild(wireSvg.firstChild);

    const defs = document.createElementNS(SVG_NS, 'defs');

    // Clip path for the MESH (excludes visor via evenodd — the visor
    // becomes a hole in the grid, so the wireframe reads as an open
    // eye slot instead of a solid oval of lines).
    const clip = document.createElementNS(SVG_NS, 'clipPath');
    clip.setAttribute('id', 'hx-helmet-clip');
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const clipShape = document.createElementNS(SVG_NS, 'path');
    clipShape.setAttribute('fill-rule', 'evenodd');
    clipShape.setAttribute('d', SIM.helmetPath + ' ' + SIM.visorPath);
    clip.appendChild(clipShape);
    defs.appendChild(clip);

    // Plain (no-visor-hole) clip for the helmet outline + visor outline.
    const clipFull = document.createElementNS(SVG_NS, 'clipPath');
    clipFull.setAttribute('id', 'hx-helmet-clip-full');
    clipFull.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const clipFullShape = document.createElementNS(SVG_NS, 'path');
    clipFullShape.setAttribute('d', SIM.helmetPath);
    clipFull.appendChild(clipFullShape);
    defs.appendChild(clipFull);

    const stopData = [
      [0.00, 0.00], [0.40, 0.05], [0.60, 0.16], [0.75, 0.38],
      [0.83, 0.72], [0.87, 1.00], [0.88, 0.00], [1.00, 0.00],
    ];
    const buildGradient = (id) => {
      const g = document.createElementNS(SVG_NS, 'linearGradient');
      g.setAttribute('id', id);
      g.setAttribute('gradientUnits', 'userSpaceOnUse');
      g.setAttribute('x1', '0');
      g.setAttribute('x2', '0');
      g.setAttribute('y1', '-1000');
      g.setAttribute('y2', '-400');
      const stops = [];
      for (const [off, op] of stopData) {
        const s = document.createElementNS(SVG_NS, 'stop');
        s.setAttribute('offset', off);
        s.setAttribute('stop-color', '#fff');
        s.setAttribute('stop-opacity', op);
        g.appendChild(s);
        stops.push(s);
      }
      return { grad: g, stops };
    };
    const a = buildGradient('hx-wave-grad-a');
    const b = buildGradient('hx-wave-grad-b');
    waveGrad   = a.grad;  waveStops  = a.stops;
    waveGradB  = b.grad;  waveStopsB = b.stops;
    defs.appendChild(waveGrad);
    defs.appendChild(waveGradB);

    // Two masks, each fed by its own gradient. Rendered on two stacked
    // copies of the shell group — their contributions add together on
    // screen, so at any instant you see wave A's leading edge AND
    // wave B's trailing edge. Result: the unravel feels continuous
    // and slower visually while still restarting every ~1.7s.
    // Mask coverage extends ABOVE viewBox y=0 so the dome (apex at
    // y≈-200) is included. Anything outside a mask's rect is fully
    // transparent — if we left the rect at y=0 the crown would be
    // invisible regardless of gradient stops.
    const maskYStart  = -400;
    const maskHeight  = SIM.vbH - maskYStart;
    const buildMask = (id, gradId) => {
      const m = document.createElementNS(SVG_NS, 'mask');
      m.setAttribute('id', id);
      m.setAttribute('maskUnits', 'userSpaceOnUse');
      m.setAttribute('x', '0');
      m.setAttribute('y', String(maskYStart));
      m.setAttribute('width',  String(SIM.vbW));
      m.setAttribute('height', String(maskHeight));
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', '0');
      r.setAttribute('y', String(maskYStart));
      r.setAttribute('width',  String(SIM.vbW));
      r.setAttribute('height', String(maskHeight));
      r.setAttribute('fill', `url(#${gradId})`);
      m.appendChild(r);
      return m;
    };
    defs.appendChild(buildMask('hx-wave-mask-a', 'hx-wave-grad-a'));
    defs.appendChild(buildMask('hx-wave-mask-b', 'hx-wave-grad-b'));

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

    /* Build ONE shell group with all the lines. We'll then clone it
       to produce the second overlapping wave. */
    const buildShell = () => {
      const shellG = document.createElementNS(SVG_NS, 'g');
      shellG.setAttribute('class', 'hx-shell');
      shellG.setAttribute('filter', 'url(#hx-feather)');

      // Mesh grid — clipped to (helmet - visor). Less circular: vertical
      // lines match the true helmet silhouette proportions (taller than
      // wide), horizontal lines are flatter ellipses.
      const gridG = document.createElementNS(SVG_NS, 'g');
      gridG.setAttribute('class', 'hx-grid');
      gridG.setAttribute('clip-path', 'url(#hx-helmet-clip)');
      gridG.setAttribute('fill', 'none');
      gridG.setAttribute('stroke', 'rgba(23,21,20,0.22)');
      gridG.setAttribute('stroke-width', '1');
      gridG.setAttribute('vector-effect', 'non-scaling-stroke');

      // Grid bounds. gridMinY is only used by the LOWER horizontal-band
      // loop now — the dome uses its own (apex, equator) geometry.
      const gridMinX = 860,  gridMaxX = 1896;
      const gridMaxY = 1140;
      const meshCx   = 1378;
      const visorY   = 560;
      const chinY    = 960;
      const halfW    = 518;       // matches the outline dome equator (y=240, rx=518)
      const step     = 16;        // denser mesh to match racing-helmet reference

      // Dome geometry — a 3D hemisphere above the head, rendered as a
      // longitude/latitude grid. The key to a non-pinched dome is the
      // MERIDIAN TANGENT at the pole: on a real sphere viewed from the
      // front, every meridian leaves the pole with a HORIZONTAL tangent
      // pointing toward its equator side (they fan out radially like
      // wheel spokes). Giving our cubic beziers horizontal tangents at
      // the apex reproduces that — meridians spread smoothly instead
      // of stacking into a cone/nub. Parallels are horizontal ellipses
      // with perspective squash, starting just inside the pole.
      const apexY       = -220;   // shared pole (matches outline apex)
      const equatorY    = 240;    // dome meets helmet upper flank
      const domeRx      = 518;    // horizontal semi-axis at equator (matches outline)
      const tilt        = 0.26;   // ry/rx ratio for perspective squash

      // Vertical meridian curves — all meet at (meshCx, apexY) with
      // HORIZONTAL tangents radiating outward, then curve down to the
      // equator with a VERTICAL tangent (tangent to the latitude at
      // the waist). This is the correct longitude-line shape and has
      // no cone tip — curves fan out from the pole like a real dome.
      for (let x = gridMinX; x <= gridMaxX; x += step) {
        const norm = (x - meshCx) / halfW;
        const equatorX = meshCx + norm * halfW * 1.00;
        const visorX   = meshCx + norm * halfW * 1.00;
        const chinX    = meshCx + norm * halfW * 0.98;
        const bottomX  = meshCx + norm * halfW * 0.42;
        // Skip the exact center meridian (norm≈0) — it degenerates to
        // a vertical line at the pole that would render as a bold
        // spine. The crown centerline in seamPaths already covers it.
        if (Math.abs(norm) < 0.02) continue;
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d',
          // Start at the single rounded apex (shared by every meridian)
          `M ${meshCx.toFixed(1)} ${apexY.toFixed(1)} ` +
          // Dome arc apex→equator. CP1 at (meshCx + norm*domeRx*0.6,
          // apexY) → HORIZONTAL tangent at pole (meridians radiate
          // sideways). CP2 at (equatorX, equatorY - 220) → VERTICAL
          // tangent at equator (meridian meets latitude at right
          // angle). This is the true sphere-longitude curve.
          `C ${(meshCx + norm * domeRx * 0.60).toFixed(1)} ${apexY.toFixed(1)}, ` +
          `${equatorX.toFixed(1)} ${(equatorY - 220).toFixed(1)}, ` +
          `${equatorX.toFixed(1)} ${equatorY.toFixed(1)} ` +
          // Upper flank to visor
          `C ${(meshCx + norm * halfW * 1.01).toFixed(1)} 400, ` +
          `${visorX.toFixed(1)} 480, ` +
          `${visorX.toFixed(1)} ${visorY} ` +
          // Sidewall down to chin
          `L ${chinX.toFixed(1)} ${chinY} ` +
          // Chin bar to flat bottom
          `C ${chinX.toFixed(1)} 1030, ` +
          `${bottomX.toFixed(1)} 1100, ` +
          `${bottomX.toFixed(1)} ${gridMaxY}`);
        gridG.appendChild(p);
      }

      // Dome parallel rings — concentric latitudes from near-pole to
      // equator. Using t² easing so rings cluster closer to the pole
      // (smaller rings near the top) — matches the dense-near-apex
      // pattern of a real mesh-smoothed helmet dome.
      const parallelCount = 11;
      for (let i = 1; i <= parallelCount; i++) {
        const t   = i / (parallelCount + 1);
        const phi = Math.sqrt(t) * (Math.PI / 2);  // more rings near pole
        const rx  = domeRx * Math.sin(phi);
        const py  = apexY + (equatorY - apexY) * (1 - Math.cos(phi));
        const ry  = rx * tilt;
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d',
          `M ${(meshCx - rx).toFixed(1)} ${py.toFixed(1)} ` +
          `A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(meshCx + rx).toFixed(1)} ${py.toFixed(1)} ` +
          `A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(meshCx - rx).toFixed(1)} ${py.toFixed(1)} Z`);
        gridG.appendChild(p);
      }

      // Horizontal bands in the LOWER helmet region (below the dome).
      //   visor row  → nearly flat (equator)
      //   chin       → bow DOWN (chin bar projects forward)
      const splitY = visorY - 10;
      const lowerMinY = equatorY;
      for (let y = lowerMinY; y <= gridMaxY; y += step) {
        const signed = (y - splitY) / (gridMaxY - lowerMinY);
        const mag = 5 + signed * signed * 360;
        const bow = signed < 0 ? -mag : mag;
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d',
          `M ${gridMinX} ${y.toFixed(1)} ` +
          `Q ${meshCx} ${(y + bow).toFixed(1)}, ` +
          `${gridMaxX} ${y.toFixed(1)}`);
        gridG.appendChild(p);
      }
      shellG.appendChild(gridG);

      // Seams — structural panel lines inside the helmet.
      const seamG = document.createElementNS(SVG_NS, 'g');
      seamG.setAttribute('class', 'hx-seams');
      seamG.setAttribute('clip-path', 'url(#hx-helmet-clip)');
      seamG.setAttribute('fill', 'none');
      seamG.setAttribute('stroke', 'rgba(23,21,20,0.36)');
      seamG.setAttribute('stroke-width', '1.2');
      seamG.setAttribute('stroke-linecap', 'round');
      seamG.setAttribute('vector-effect', 'non-scaling-stroke');
      for (const d of SIM.seamPaths) {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        seamG.appendChild(p);
      }
      shellG.appendChild(seamG);

      // Mouth / chin vents — four horizontal slats under the visor.
      const ventG = document.createElementNS(SVG_NS, 'g');
      ventG.setAttribute('class', 'hx-vents');
      ventG.setAttribute('clip-path', 'url(#hx-helmet-clip-full)');
      ventG.setAttribute('fill', 'none');
      ventG.setAttribute('stroke', 'rgba(23,21,20,0.44)');
      ventG.setAttribute('stroke-width', '2.2');
      ventG.setAttribute('stroke-linecap', 'round');
      ventG.setAttribute('vector-effect', 'non-scaling-stroke');
      for (const d of SIM.ventPaths) {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        ventG.appendChild(p);
      }
      shellG.appendChild(ventG);

      // Visor outline — drawn on top so the eye slot is crisply defined.
      const visorOutline = document.createElementNS(SVG_NS, 'path');
      visorOutline.setAttribute('class', 'hx-outline hx-visor');
      visorOutline.setAttribute('d', SIM.visorPath);
      shellG.appendChild(visorOutline);

      // Helmet outer outline.
      const outlinePath = document.createElementNS(SVG_NS, 'path');
      outlinePath.setAttribute('class', 'hx-outline');
      outlinePath.setAttribute('d', SIM.helmetPath);
      shellG.appendChild(outlinePath);

      return shellG;
    };

    // Shrink transform: the helmet-path coordinates (viewBox 2752×1536)
    // were drawn oversized relative to the face. We scale both shells
    // around the helmet's visual center so the mesh fits closer to the
    // portrait's head contour instead of extending past the ears/jaw.
    // Tweak SIM.meshFit.scale to resize; cx/cy keep it centered on her face.
    const fit = SIM.meshFit;
    const meshTransform = `translate(${fit.cx} ${fit.cy}) scale(${fit.scale}) translate(${-fit.cx} ${-fit.cy})`;

    // Wave A
    const shellA = buildShell();
    shellA.setAttribute('mask', 'url(#hx-wave-mask-a)');
    shellA.setAttribute('transform', meshTransform);
    wireSvg.appendChild(shellA);
    // Wave B (offset phase, same geometry)
    const shellB = buildShell();
    shellB.setAttribute('mask', 'url(#hx-wave-mask-b)');
    shellB.setAttribute('transform', meshTransform);
    wireSvg.appendChild(shellB);
  }

  function updateHelmetSim(now) {
    if (!waveGrad) return;
    const W_                = SIM.wave;
    const trail             = W_.trailVb;
    const bufferBelow       = 80;
    const helmetTop         = -220;
    const helmetBottom      = 1060;
    const waveStartY        = helmetTop - bufferBelow;
    const waveEndY          = helmetBottom + trail;
    const totalMs           = W_.buildMs + W_.holdMs + W_.restMs;
    const phaseOffset       = W_.buildMs * 0.5;

    const computeLeadY = (phase) => {
      if (reducedMotion) return helmetBottom + trail * 0.45;
      if (phase < W_.buildMs) {
        const t  = phase / W_.buildMs;
        const ts = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        return waveStartY + (waveEndY - waveStartY) * ts;
      }
      if (phase < W_.buildMs + W_.holdMs) return waveEndY;
      return waveEndY + 400;
    };

    const leadA = computeLeadY(now % totalMs);
    const leadB = computeLeadY(((now + phaseOffset) % totalMs));

    const y1A = leadA - trail, y2A = leadA + bufferBelow;
    waveGrad.setAttribute('y1', y1A.toFixed(1));
    waveGrad.setAttribute('y2', y2A.toFixed(1));

    if (waveGradB) {
      const y1B = leadB - trail, y2B = leadB + bufferBelow;
      waveGradB.setAttribute('y1', y1B.toFixed(1));
      waveGradB.setAttribute('y2', y2B.toFixed(1));
    }
  }

  /* ---------- main loop ---------- */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(now - last, 48);
    last = now;

    // Hard idle detection — if no pointer movement for cursorIdleMs, we stop
    // emitting AND accelerate existing stamp decay so the blob vanishes
    // immediately instead of lingering as fog. This is the single biggest
    // fix for "it feels like smoke that hangs around."
    const pointerIdleMs = now - lastPointerMove;
    const isPointerIdle = !hasPointer || pointerIdleMs > CFG.cursorIdleMs;

    if (hasPointer && cursorX !== null) {
      const ax = (cursorX - blob.x) * CFG.cursorSpring;
      const ay = (cursorY - blob.y) * CFG.cursorSpring;
      blob.vx = (blob.vx + ax) * CFG.cursorDamping;
      blob.vy = (blob.vy + ay) * CFG.cursorDamping;
      blob.x += blob.vx;
      blob.y += blob.vy;
      const speed = Math.hypot(blob.vx, blob.vy);
      if (!isPointerIdle && speed > CFG.cursorMinEmitSpeed) {
        const sNorm = Math.min(speed / CFG.cursorMaxSpeedRef, 1);
        const sizeFactor = CFG.cursorSizeMin
                         + (CFG.cursorSizeMax - CFG.cursorSizeMin) * sNorm;
        const baseR   = CFG.cursorBaseRatio * Math.min(W, H) * sizeFactor;
        const strength = 0.6 + 0.4 * sNorm;
        emitBlob(blob.x, blob.y, blob.vx, blob.vy, baseR, CFG.cursorLifeMs, strength);
      }
    } else if (blob.init) {
      blob.vx *= 0.85;
      blob.vy *= 0.85;
      blob.x += blob.vx;
      blob.y += blob.vy;
    }

    tickCycle(now);
    tickSwipes(now);
    updateHelmetSim(now);

    /* Parallax — lerp current toward mouse-driven target, write to CSS vars. */
    PARALLAX.curX += (PARALLAX.targetX - PARALLAX.curX) * PARALLAX.lerp;
    PARALLAX.curY += (PARALLAX.targetY - PARALLAX.curY) * PARALLAX.lerp;
    stage.style.setProperty('--parallax-x', PARALLAX.curX.toFixed(2) + 'px');
    stage.style.setProperty('--parallax-y', PARALLAX.curY.toFixed(2) + 'px');

    // Age stamps. Cursor stamps decay faster when pointer is idle so the
    // blob disappears instantly on halt instead of floating for 500ms.
    for (let i = stamps.length - 1; i >= 0; i--) {
      const s = stamps[i];
      const isCursorStamp = s.kind !== 'swipeShape' && s.kind !== 'swipeHole';
      const ageStep = (isPointerIdle && isCursorStamp) ? dt * CFG.cursorIdleDecay : dt;
      s.age += ageStep;
      if (s.age >= s.life) stamps.splice(i, 1);
    }

    /* ============================================================
       METABALL LIQUID PIPELINE
       ------------------------------------------------------------
       1. maskCanvas: stamps drawn as SOLID fills (no soft radial wash).
       2. On composite to visible canvas, apply blur + contrast filter:
            blur merges overlapping stamps into one body;
            contrast thresholds the result into a hard liquid edge.
       3. Visible canvas composite order:
          a. Paint `outsideColor` (#f5f5f1) across the whole canvas.
          b. Draw helmet image on top — helmet pixels replace the
             `outsideColor` where it exists (inside its bounds).
          c. destination-in with the filtered mask → everything clipped
             to the blob shape. Outside the blob: transparent.
          Result: where the blob crosses the helmet → helmet revealed;
          where it crosses empty space → #f5f5f1 body; elsewhere
          nothing. Exactly matches the spec.
       ============================================================ */

    /* --- pass 1: solid stamps to offscreen mask --- */
    maskCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    maskCtx.clearRect(0, 0, W, H);
    maskCtx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      if (s.hole) continue;
      const p = s.age / s.life;
      // Fast ramp-in, gentle ramp-out. Power 1.4 so stamps stay
      // solid for most of their life then drop quickly.
      const fade = p < 0.08
        ? (p / 0.08)
        : Math.pow(1 - (p - 0.08) / 0.92, 1.4);
      const a = CFG.cursorAlpha * s.alphaMul * fade;
      if (a < 0.05) continue;

      maskCtx.save();
      maskCtx.translate(s.x, s.y);
      if (s.angle) maskCtx.rotate(s.angle);
      maskCtx.scale(s.sx, s.sy);

      // Solid disc with a thin feathered rim. The blur+contrast
      // pass on composite does the heavy lifting for metaball fusion.
      const g = maskCtx.createRadialGradient(0, 0, 0, 0, 0, s.r);
      g.addColorStop(0,    `rgba(0,0,0,${a})`);
      g.addColorStop(0.82, `rgba(0,0,0,${a})`);
      g.addColorStop(1,    `rgba(0,0,0,0)`);
      maskCtx.fillStyle = g;
      maskCtx.beginPath();
      maskCtx.arc(0, 0, s.r, 0, Math.PI * 2);
      maskCtx.fill();
      maskCtx.restore();
    }

    /* --- pass 1b: hole stamps punch through the mask (inner hollow) --- */
    maskCtx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      if (!s.hole) continue;
      const p = s.age / s.life;
      const fade = p < 0.20 ? (p / 0.20) : Math.pow(1 - (p - 0.20) / 0.80, 1.3);
      const a = s.alphaMul * fade;
      if (a < 0.05) continue;

      maskCtx.save();
      maskCtx.translate(s.x, s.y);
      if (s.angle) maskCtx.rotate(s.angle);
      maskCtx.scale(s.sx, s.sy);

      const g = maskCtx.createRadialGradient(0, 0, 0, 0, 0, s.r);
      g.addColorStop(0,    `rgba(0,0,0,${a})`);
      g.addColorStop(0.72, `rgba(0,0,0,${a})`);
      g.addColorStop(1,    `rgba(0,0,0,0)`);
      maskCtx.fillStyle = g;
      maskCtx.beginPath();
      maskCtx.arc(0, 0, s.r, 0, Math.PI * 2);
      maskCtx.fill();
      maskCtx.restore();
    }

    /* --- pass 2: visible canvas composite ---
       Helmet-only reveal: the blob paints nothing outside the helmet.
       Order:
         2a. Paint the helmet on the canvas (it only covers the head area).
         2b. destination-in with the filtered blob mask — clip to blob shape.
       Net result per pixel INSIDE the blob shape:
         over empty bg  → transparent (nothing painted)
         over her body  → transparent
         over her head  → helmet revealed
       Outside the blob shape: transparent. */
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 2a: helmet only — no cream fill, so the blob is invisible off the head.
    ctx.globalCompositeOperation = 'source-over';
    if (helmet.complete && helmet.naturalWidth) {
      const hf = CFG.helmetFit;
      const aspect = helmet.naturalHeight / helmet.naturalWidth;
      const dw  = W * hf.scale;
      const dh  = dw * aspect;
      const dxh = W * hf.cx - dw / 2;
      const dyh = H * hf.cy - dh / 2;
      ctx.drawImage(helmet, dxh, dyh, dw, dh);
    }

    // 2b: clip to blob shape via metaball filter.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${CFG.metaballBlur}px) contrast(${CFG.metaballContrast})`;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';

    requestAnimationFrame(frame);
  }

  /* ---------- init ---------- */
  function init() {
    resize();
    window.addEventListener('resize', resize);
    // Rebuild portrait alpha once the base img finishes loading
    // (resize() may run before the img is decoded on first paint).
    if (baseImg && !(baseImg.complete && baseImg.naturalWidth)) {
      baseImg.addEventListener('load', renderPortraitAlpha, { once: true });
    }
    initHelmetSim();
    portrait.classList.add('is-loaded');
    last = performance.now();
    requestAnimationFrame(frame);
  }

  if (helmet.complete && helmet.naturalWidth) init();
  else helmet.addEventListener('load', init, { once: true });
})();

/* ------------------------------------------------------------------
   Hero overlays — editorial/motorsport UI (scope-safe, JS-only)
   - Top-left: "PRIVATE MENTORSHIP" wordmark (condensed display type)
   - Bottom-left: precision card — mechanical pen dial + laurel badge
   Principles: hairline strokes, mathematical alignment, restrained palette.
   ------------------------------------------------------------------ */
(() => {
  if (document.querySelector('.pm-overlay-style')) return;

  /* Load display + text faces from Google Fonts.
     Anton    — condensed display black for the wordmark (Lando-style).
     Archivo  — precise grotesque for the technical card text. */
  const fontLink = document.createElement('link');
  fontLink.rel  = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@500;600;700;800&display=swap';
  document.head.appendChild(fontLink);

  const INK   = '#171514';      // dark ink for light/cream backgrounds
  const HAIR  = 'rgba(23, 21, 20, 0.12)';   // hairline stroke (reduced for premium feel)

  const css = `
    /* Retina displays render -webkit-optimize-contrast bilinearly
       which looks soft. high-quality forces a better resample. */
    .portrait__base {
      image-rendering: auto !important;
      image-rendering: high-quality !important;
      image-rendering: smooth !important;
    }

    .pm-wordmark {
      position: absolute;
      top: 62px;
      left: 36px;
      z-index: 12;
      color: #3a2a10;
      pointer-events: none;
      user-select: none;
      text-rendering: geometricPrecision;
      text-transform: none;
      line-height: 0.84;
    }

    .pm-wordmark__top,
    .pm-wordmark__bottom {
      background-image: linear-gradient(90deg,
        #b88a36 0%,
        #c89a44 35%,
        #e8c878 50%,
        #c89a44 65%,
        #b88a36 100%);
      background-size: 320% 100%;
      background-position: 50% 0;
      -webkit-background-clip: text;
              background-clip: text;
      color: transparent;
      -webkit-text-fill-color: transparent;
      animation: pmHeroWordmarkGoldShimmer 22s ease-in-out infinite;
      filter: drop-shadow(0 1px 0 rgba(255,238,180,0.30))
              drop-shadow(0 14px 24px rgba(180,135,55,0.18));
    }
    .pm-wordmark__bottom { animation-delay: 4s; }

    @keyframes pmHeroWordmarkGoldShimmer {
      0%   { background-position: 90% 0; }
      50%  { background-position: 10% 0; }
      100% { background-position: 90% 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pm-wordmark__top,
      .pm-wordmark__bottom { animation: none; background-position: 50% 0; }
    }

    .pm-wordmark__top {
      display: block;
      font-family: 'Archivo', 'Helvetica Neue', 'Helvetica', sans-serif;
      font-size: clamp(28px, 8.5vw, 62px);
      font-weight: 600;
      letter-spacing: -0.055em;
      line-height: 0.86;
      text-transform: uppercase;
    }

    .pm-wordmark__bottom {
      display: block;
      font-family: 'Anton', 'Impact', 'Haettenschweiler', 'Arial Narrow', sans-serif;
      font-size: clamp(34px, 9.5vw, 74px);
      font-weight: 400;
      letter-spacing: -0.01em;
      line-height: 0.82;
      margin-top: -6px;
      text-transform: uppercase;
    }
    @media (max-width: 540px){
      /* On mobile, place the wordmark below the page nav (~68px tall)
         and to the left margin. The wordmark now lives at the top of
         the hero section, clear of the model's face. */
      .pm-wordmark{top:84px;left:18px;right:18px;line-height:0.86;}
    }

    .pm-card {
      position: fixed;
      bottom: 32px;
      left: 34px;
      z-index: 50;
      width: 150px;
      padding: 14px 12px 16px;
      color: #2a2520;
      font-family: 'Archivo', sans-serif;
      text-align: center;
      pointer-events: none;
      user-select: none;
      background: transparent;
      transform-origin: 50% 100%;
      transform: translateY(0) rotateX(0deg);
      opacity: 1;
      transition: transform 520ms cubic-bezier(0.7, 0, 0.2, 1), opacity 360ms ease-out;
      will-change: transform, opacity;
      perspective: 900px;
    }

    .pm-card.is-rolled {
      transform: translateY(14px) rotateX(95deg);
      opacity: 0;
    }

    /* Folder-tab outline drawn as SVG so the corner notch + fold crease
       render cleanly at any size. preserveAspectRatio=none lets the
       rectangle portion stretch to the card; the 20px corner stays
       pinned via viewBox math. */
    .pm-card__frame {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
    }
    .pm-card__frame path {
      fill: none;
      stroke: rgba(42,37,32,0.65);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .pm-card__inner {
      position: relative;
      z-index: 1;
    }

    .pm-card__meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2px 8px;
      border-bottom: 1px solid rgba(42,37,32,0.55);
      margin: 0 -2px 14px;
      font-size: 8px;
      font-weight: 600;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      opacity: 0.85;
    }

    .pm-card__meta-dot {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #2a2520;
      opacity: 0.85;
    }

    .pm-card__flag-box {
      width: 84px;
      height: 84px;
      margin: 0 auto 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      perspective: 700px;
    }

    .pm-card__flag-3d {
      width: 76px;
      height: 76px;
      object-fit: contain;
      animation: pm-flag-spin 5s linear infinite;
      transform-style: preserve-3d;
      backface-visibility: visible;
      /* recolor the dark Canada map PNG to premium warm graphite */
      filter: brightness(0) saturate(100%) invert(13%) sepia(35%) saturate(420%) hue-rotate(355deg) brightness(1.05);
    }

    @keyframes pm-flag-spin {
      from { transform: rotateX(65deg) rotateZ(0deg); }
      to   { transform: rotateX(65deg) rotateZ(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      .pm-card__flag-3d { animation: none; }
    }

    .pm-card__city {
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(42, 37, 32, 0.95);
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(42,37,32,0.55);
      margin: 0 -2px 12px;
    }

    .pm-card__badge {
      position: relative;
      width: 160px;
      height: 128px;
      margin: 0 0 -6px 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pm-card__laurel {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0.95;
      pointer-events: none;
      /* recolor the dark laurel PNG to premium warm graphite */
      filter: brightness(0) saturate(100%) invert(13%) sepia(35%) saturate(420%) hue-rotate(355deg) brightness(1.05);
    }

    .pm-card__helmet {
      position: relative;
      width: 80px;
      height: auto;
      z-index: 1;
    }

    .pm-card__role {
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(42, 37, 32, 0.95);
      line-height: 1.15;
    }

    .pm-card__since {
      margin-top: 5px;
      font-size: 7px;
      font-weight: 500;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      opacity: 0.5;
    }

    /* Mobile: shrink the PM folder card properly so it reads as a
       deliberate, premium chip — not an oversized panel that
       crowds (and slightly overlaps) the portrait. Everything inside
       scales down together so proportions still look intentional:
       flag : city border : helmet+laurel : role+since. */
    @media (max-width: 760px){
      .pm-card{
        width: 78px;
        bottom: 12px;
        left: 12px;
        padding: 7px 6px 9px;
      }
      .pm-card__meta{
        font-size: 5px;
        letter-spacing: 0.22em;
        padding: 0 1px 4px;
        margin: 0 -1px 6px;
      }
      .pm-card__meta-dot{ width: 3px; height: 3px; }
      .pm-card__flag-box{
        width: 36px;
        height: 36px;
        margin: 0 auto 6px;
        perspective: 360px;
      }
      .pm-card__flag-3d{ width: 30px; height: 30px; }
      .pm-card__city{
        font-size: 5.5px;
        letter-spacing: 0.18em;
        padding-bottom: 5px;
        margin: 0 -1px 5px;
      }
      .pm-card__badge{
        width: 70px;
        height: 56px;
        margin: 0 0 -3px 50%;
      }
      .pm-card__helmet{ width: 38px; }
      .pm-card__role{
        font-size: 6.5px;
        letter-spacing: 0.16em;
        line-height: 1.18;
      }
      .pm-card__since{
        margin-top: 3px;
        font-size: 5px;
        letter-spacing: 0.24em;
      }
    }
  `;

  const style = document.createElement('style');
  style.className = 'pm-overlay-style';
  style.textContent = css;
  document.head.appendChild(style);

  // Anchor the wordmark to the SECTION (identity-hero) instead of the
  // portrait stage. The stage is sized to the portrait's aspect ratio
  // and centered vertically, so on mobile the stage lands halfway down
  // the viewport — anchoring the wordmark there puts it on top of the
  // model's face. Anchoring to the section keeps the wordmark at the
  // true top of the hero on every screen size.
  const heroSection = document.querySelector('.identity-hero');
  const stageOverlay = document.querySelector('.portrait__stage');

  const mark = document.createElement('div');
  mark.className = 'pm-wordmark';
  mark.innerHTML = `
    <span class="pm-wordmark__top">PRIVATE</span>
    <span class="pm-wordmark__bottom">MENTORSHIP</span>
  `;
  (heroSection || stageOverlay || document.body).appendChild(mark);
  
  const card = document.createElement('div');
  card.className = 'pm-card';
  card.innerHTML = `
    <svg class="pm-card__frame" viewBox="0 0 150 240" preserveAspectRatio="none">
      <path d="M 0 0 L 130 0 L 150 20 L 150 240 L 0 240 Z" />
      <path d="M 130 0 L 130 20 L 150 20" />
    </svg>
    <div class="pm-card__inner">
      <div class="pm-card__meta">
        <span>PM · 001</span>
        <span class="pm-card__meta-dot"></span>
      </div>
      <div class="pm-card__flag-box">
        <img src="canada-map.png" class="pm-card__flag-3d" alt="Canada">
      </div>
      <div class="pm-card__city">Vancouver&nbsp;BC</div>
      <div class="pm-card__badge">
        <img class="pm-card__laurel" src="laurel.png" alt="">
        <img class="pm-card__helmet" src="helmet-alt.png" alt="Badge">
      </div>
      <div class="pm-card__role">Family<br>Assistant</div>
      <div class="pm-card__since">Since&nbsp;2023</div>
    </div>
  `;
  document.body.appendChild(card);

  const ROLL_THRESHOLD = 8;
  let rolled = false;
  const syncRoll = () => {
    const shouldRoll = window.scrollY > ROLL_THRESHOLD;
    if (shouldRoll !== rolled) {
      rolled = shouldRoll;
      card.classList.toggle('is-rolled', rolled);
    }
  };
  window.addEventListener('scroll', syncRoll, { passive: true });
  syncRoll();
})();
