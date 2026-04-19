/* Identity hero — fluid-blob reveal system
 *
 * Three layers inside .portrait__stage:
 *   1. <img.portrait__base>      — base portrait, always visible
 *   2. <canvas.portrait__reveal> — helmet composited through a fluid mask
 *   3. <svg.portrait__wire>      — traced outline
 *
 * Every frame:
 *   A) clear the canvas
 *   B) stamp a bank of white radial gradients (= mask alpha)
 *      - cursor contributes a physics-driven blob (head / sides / tail)
 *      - autoplay contributes ghost-swipe strokes crossing the portrait
 *      - at high velocities a few "hole" stamps punch the core with
 *        destination-out to create a liquid-split gap
 *   C) globalCompositeOperation = 'source-in' + drawImage(helmet)
 *      keeps helmet pixels only where mask alpha > 0.
 *
 * The cursor blob uses a tiny spring-damper toward the pointer so it
 * lags, overshoots, and eases — never follows rigidly. The swipe
 * scheduler launches one sling at a time from alternating edges.
 *
 * All tunables live in CFG.
 */
(() => {
  const stage    = document.querySelector('.portrait__stage');
  const portrait = document.querySelector('.portrait');
  const canvas   = document.querySelector('.portrait__reveal');
  const ctx      = canvas.getContext('2d');
  const HELMET_SRC = 'Gemini_Generated_Image_v93y4iv93y4iv93y.png';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CFG = {
    /* ----- shared stamp appearance ----- */
    maxAlpha:            0.94,
    maxStamps:           900,

    /* ----- cursor blob ----- */
    cursorBaseRatio:     0.12,   // base radius as fraction of min(W,H)
    cursorLifeMs:        480,
    cursorSpring:        0.16,   // pull strength toward pointer
    cursorDamping:       0.78,   // velocity retention (<1)
    cursorHoleSpeed:     14,     // px/frame at which a core hole appears
    cursorHoleSpeedMax:  44,     // speed where hole is fully expanded

    /* ----- ghost swipes ----- */
    swipeBaseRatio:      0.135,
    swipeLifeMs:         560,
    swipeDurMinMs:       640,
    swipeDurMaxMs:       960,
    swipeGapMinMs:       520,
    swipeGapMaxMs:       1150,
    swipeInitialDelay:   420,    // first swipe after load
    swipeIdleAfterMs:    1600,   // resume swipes if cursor idle this long
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

  /* ---------- stamp pool ----------
   * Each stamp is a short-lived radial gradient.
   * hole=true stamps are drawn with destination-out to subtract alpha. */
  const stamps = [];
  function addStamp(x, y, r, life, alphaMul = 1, hole = false) {
    if (r < 1 || life < 16) return;
    stamps.push({ x, y, r, life, age: 0, alphaMul, hole });
    if (stamps.length > CFG.maxStamps) {
      stamps.splice(0, stamps.length - CFG.maxStamps);
    }
  }

  /* A single "blob emission" = head + body + flanks + tail (+ optional hole).
   * Direction and stretch come from velocity (vx, vy) in px/frame. */
  function emitBlob(cx, cy, vx, vy, baseR, lifeMs, strength = 1) {
    const speed = Math.hypot(vx, vy);
    let dx = 1, dy = 0;
    if (speed > 0.001) { dx = vx / speed; dy = vy / speed; }
    const px = -dy, py = dx; // perpendicular

    // speed-driven morph (soft-clamped)
    const stretch = Math.min(speed * 0.055, 2.4);   // how far head & tail extend
    const widen   = Math.min(speed * 0.028, 0.95);  // flank offset
    const headGrow = 1 + Math.min(speed * 0.022, 0.7);
    const tailShrink = 1 / (1 + Math.min(speed * 0.02, 0.9));

    const j = () => (Math.random() - 0.5) * baseR * 0.08; // subtle organic jitter

    // head — larger, shifted forward
    addStamp(
      cx + dx * baseR * stretch * 0.85 + j(),
      cy + dy * baseR * stretch * 0.85 + j(),
      baseR * headGrow * (0.95 + Math.random() * 0.1),
      lifeMs,
      1.00 * strength
    );

    // core
    addStamp(
      cx + j(), cy + j(),
      baseR * (0.88 + Math.random() * 0.08),
      lifeMs * 0.95,
      0.9 * strength
    );

    // flanks — widen with velocity
    const flankR = baseR * (0.68 + widen * 0.25);
    addStamp(
      cx + px * baseR * (0.35 + widen * 0.9),
      cy + py * baseR * (0.35 + widen * 0.9),
      flankR, lifeMs * 0.9,
      0.72 * strength
    );
    addStamp(
      cx - px * baseR * (0.35 + widen * 0.9),
      cy - py * baseR * (0.35 + widen * 0.9),
      flankR, lifeMs * 0.9,
      0.72 * strength
    );

    // tail — smaller, pulled back, quicker decay
    addStamp(
      cx - dx * baseR * stretch * 0.95,
      cy - dy * baseR * stretch * 0.95,
      baseR * (0.55 + stretch * 0.18) * tailShrink,
      lifeMs * 0.72,
      0.55 * strength
    );
    // tail wisp — even further behind when stretched
    if (stretch > 0.6) {
      addStamp(
        cx - dx * baseR * stretch * 1.55,
        cy - dy * baseR * stretch * 1.55,
        baseR * 0.38 * tailShrink,
        lifeMs * 0.55,
        0.38 * strength
      );
    }

    // liquid-split hole: at high speeds, subtract alpha near the core
    if (speed > CFG.cursorHoleSpeed) {
      const k = Math.min(
        (speed - CFG.cursorHoleSpeed) / (CFG.cursorHoleSpeedMax - CFG.cursorHoleSpeed),
        1
      );
      const holeR = baseR * (0.28 + k * 0.45);
      const holeAlpha = 0.55 + k * 0.4;
      addStamp(
        cx - dx * baseR * 0.15,
        cy - dy * baseR * 0.15,
        holeR,
        lifeMs * 0.55,
        holeAlpha * strength,
        true // hole — drawn with destination-out
      );
    }
  }

  /* ---------- cursor physics ---------- */
  let cursorX = null, cursorY = null;
  let hasPointer = false;
  let lastPointerMove = -1e9;

  // spring-damper state
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
  function onPointerLeave() {
    hasPointer = false;
  }

  stage.addEventListener('pointermove',  onPointerMove,  { passive: true });
  stage.addEventListener('pointerenter', onPointerMove,  { passive: true });
  stage.addEventListener('pointerleave', onPointerLeave, { passive: true });

  /* ---------- ghost-swipe scheduler ----------
   * One swipe at a time. Each is a path with curvature; we sample
   * along it every frame and emit a blob with real velocity. */
  const swipes = [];
  let nextSwipeAt = 0;
  let lastSwipeDir = 1;

  function spawnSwipe(first = false) {
    const dir = -lastSwipeDir; // alternate
    lastSwipeDir = dir;

    // band of the face to sweep through (0..1 in stage space)
    const bandRoll = Math.random();
    let band;
    if (bandRoll < 0.32) band = 0.28 + Math.random() * 0.08; // upper
    else if (bandRoll < 0.72) band = 0.45 + Math.random() * 0.12; // middle
    else band = 0.64 + Math.random() * 0.12; // lower

    const slope = (Math.random() - 0.5) * 0.38; // diagonal amount
    const arc   = (Math.random() - 0.5) * 0.18; // mid-path arc

    const startX = dir > 0 ? -0.22 : 1.22;
    const endX   = dir > 0 ?  1.22 : -0.22;

    const fromY = (band - slope / 2) * H;
    const toY   = (band + slope / 2) * H;
    const midY  = (fromY + toY) / 2 + arc * H;

    swipes.push({
      start: first ? performance.now() + 120 : performance.now(),
      dur: CFG.swipeDurMinMs + Math.random() * (CFG.swipeDurMaxMs - CFG.swipeDurMinMs),
      from: { x: startX * W, y: fromY },
      mid:  { x: (startX + endX) * 0.5 * W, y: midY },
      to:   { x: endX * W,   y: toY },
      baseR: CFG.swipeBaseRatio * Math.min(W, H) * (0.85 + Math.random() * 0.35),
      prevX: null, prevY: null
    });
  }

  function tickSwipes(now) {
    if (reducedMotion) return;

    const cursorIdle = !hasPointer || (now - lastPointerMove) > CFG.swipeIdleAfterMs;

    if (cursorIdle && now >= nextSwipeAt && swipes.length === 0) {
      spawnSwipe();
      nextSwipeAt = now + CFG.swipeGapMinMs
        + Math.random() * (CFG.swipeGapMaxMs - CFG.swipeGapMinMs);
    }

    for (let i = swipes.length - 1; i >= 0; i--) {
      const s = swipes[i];
      const t = (now - s.start) / s.dur;
      if (t < 0) continue;
      if (t >= 1) { swipes.splice(i, 1); continue; }

      // ease in-out for smooth enter/exit, bezier-style
      const ease = 0.5 - 0.5 * Math.cos(t * Math.PI);

      // quadratic Bezier from → mid → to
      const u = ease, iu = 1 - u;
      const px = iu * iu * s.from.x + 2 * iu * u * s.mid.x + u * u * s.to.x;
      const py = iu * iu * s.from.y + 2 * iu * u * s.mid.y + u * u * s.to.y;

      let vx = 0, vy = 0;
      if (s.prevX !== null) { vx = px - s.prevX; vy = py - s.prevY; }
      s.prevX = px; s.prevY = py;

      // ramp strength in/out so swipe fades at the edges
      const envelope = Math.sin(t * Math.PI); // 0 → 1 → 0
      emitBlob(px, py, vx, vy, s.baseR, CFG.swipeLifeMs, 0.75 + envelope * 0.35);
    }
  }

  /* ---------- main loop ---------- */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(now - last, 48);
    last = now;

    // cursor physics: spring toward pointer, damped velocity
    if (hasPointer && cursorX !== null) {
      const ax = (cursorX - blob.x) * CFG.cursorSpring;
      const ay = (cursorY - blob.y) * CFG.cursorSpring;
      blob.vx = (blob.vx + ax) * CFG.cursorDamping;
      blob.vy = (blob.vy + ay) * CFG.cursorDamping;
      blob.x += blob.vx;
      blob.y += blob.vy;
      const baseR = CFG.cursorBaseRatio * Math.min(W, H);
      emitBlob(blob.x, blob.y, blob.vx, blob.vy, baseR, CFG.cursorLifeMs, 1);
    } else if (blob.init) {
      // gently decay residual velocity so nothing "pops" on re-entry
      blob.vx *= 0.9;
      blob.vy *= 0.9;
      blob.x += blob.vx;
      blob.y += blob.vy;
    }

    // ghost swipes when idle
    tickSwipes(now);

    // age + prune
    for (let i = stamps.length - 1; i >= 0; i--) {
      stamps[i].age += dt;
      if (stamps[i].age >= stamps[i].life) stamps.splice(i, 1);
    }

    // redraw mask
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 1) additive build-up of mask alpha
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      if (s.hole) continue;
      const p = s.age / s.life;
      // ease-in-out fade: ramp up early, ease out late
      const fade = p < 0.18
        ? (p / 0.18)
        : (1 - (p - 0.18) / 0.82) * (1 - (p - 0.18) / 0.82);
      const a = CFG.maxAlpha * s.alphaMul * fade;
      if (a < 0.003) continue;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0,    `rgba(255,255,255,${a})`);
      g.addColorStop(0.45, `rgba(255,255,255,${a * 0.58})`);
      g.addColorStop(1,    'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2) hole stamps — subtract alpha at fast-moving cores
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < stamps.length; i++) {
      const s = stamps[i];
      if (!s.hole) continue;
      const p = s.age / s.life;
      const fade = p < 0.25 ? (p / 0.25) : (1 - (p - 0.25) / 0.75);
      const a = s.alphaMul * fade;
      if (a < 0.01) continue;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0,    `rgba(0,0,0,${a})`);
      g.addColorStop(0.55, `rgba(0,0,0,${a * 0.45})`);
      g.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3) composite helmet through the mask
    if (helmet.complete && helmet.naturalWidth) {
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(helmet, 0, 0, W, H);
    }

    requestAnimationFrame(frame);
  }

  /* ---------- init ---------- */
  function init() {
    resize();
    window.addEventListener('resize', resize);
    portrait.classList.add('is-loaded');
    requestAnimationFrame(frame);
    nextSwipeAt = performance.now() + CFG.swipeInitialDelay;
  }

  if (helmet.complete && helmet.naturalWidth) init();
  else helmet.addEventListener('load', init, { once: true });
})();
