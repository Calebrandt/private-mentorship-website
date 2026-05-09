/* Identity hero — WebGL fluid simulation reveal
 *
 * Replaces the previous stamp-based blob with a real Navier-Stokes fluid
 * simulation (adapted from Pavel Dobryakov's WebGL-Fluid-Simulation, MIT).
 * The cursor and ghost swipes inject velocity + dye into a velocity field;
 * each frame the field advects, swirls (vorticity confinement), and is
 * projected to be divergence-free. Dye is rendered as a translucent
 * warm-gold texture that genuinely jiggles, tears off, and forms small
 * air bubbles when flicked — i.e. it actually looks like water, not paint.
 *
 * Three layers inside .portrait__stage (DOM unchanged):
 *   1. <img.portrait__base>      — base portrait, always visible
 *   2. <canvas.portrait__reveal> — 2D canvas. Each frame we drawImage the
 *      offscreen WebGL fluid canvas into here, then composite the helmet
 *      on top with `source-atop` so the helmet only appears where fluid is
 *   3. <svg.portrait__wire>      — helmet wire-mesh scan (unchanged)
 *
 * Ghost choreography (intro → descend → ascend → rest) is preserved, but
 * each swipe step now injects velocity+dye splats into the fluid sim
 * instead of placing canvas stamps. The fluid advects them naturally.
 *
 * If WebGL2 is unavailable (very rare in modern browsers), the canvas
 * stays empty and the base portrait shows through — graceful fallback.
 *
 * All visual tunables live in CFG.
 */
(() => {
  /* ---------- DOM ---------- */
  const stage    = document.querySelector('.portrait__stage');
  const portrait = document.querySelector('.portrait');
  const canvas   = document.querySelector('.portrait__reveal');
  const ctx      = canvas.getContext('2d');
  const wireSvg  = document.querySelector('.portrait__wire');
  const SVG_NS   = 'http://www.w3.org/2000/svg';
  const HELMET_SRC = 'helmet-new.png';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- CONFIG ---------- */
  const CFG = {
    /* helmet fit — scale + position only, no cropping */
    helmetFit: { scale: 0.78, cx: 0.50, cy: 0.35 },

    /* cursor — spring-damper toward pointer, splatted into the fluid sim */
    cursorSpring:        0.20,
    cursorDamping:       0.78,
    cursorMinEmitSpeed:  1.2,    // below this speed, no splats (blob fades)
    cursorMaxSpeedRef:   30,     // speed at which size/force saturates
    cursorRadiusMin:     0.12,   // splat radius (viewport-min fraction)
    cursorRadiusMax:     0.30,
    cursorForce:         5400,   // velocity injected per splat (Pavel-scale)
    cursorColor:         { r: 0.50, g: 0.78, b: 0.55 },  // soft sage green (0..1)
    /* Alternate palettes if you want to try them — swap cursorColor:
     *   landonorris:  { r: 0.62, g: 0.85, b: 0.35 }   // yellow-green (his actual)
     *   warm gold:    { r: 0.83, g: 0.66, b: 0.31 }
     *   cool aqua:    { r: 0.42, g: 0.78, b: 0.92 }
     *   pale cyan:    { r: 0.55, g: 0.85, b: 0.95 }
     *   mint sage:    { r: 0.50, g: 0.82, b: 0.68 }
     *   silver mist:  { r: 0.78, g: 0.85, b: 0.92 } */

    /* ghost swipes — same scripted cycle, fed into the fluid */
    swipeRadius:         0.18,
    swipeForce:          6800,
    swipeIdleAfterMs:    1400,

    /* fluid simulation (Pavel Dobryakov-style; WebGL2) */
    SIM_RESOLUTION:      128,    // velocity grid (low = fast, high = detailed)
    DYE_RESOLUTION:      1024,   // dye grid (visual quality)
    DENSITY_DISSIPATION: 1.0,    // dye lingers a touch longer (calmer)
    VELOCITY_DISSIPATION: 1.5,   // velocity decays gently, not violently
    PRESSURE:            0.8,
    PRESSURE_ITERATIONS: 20,     // Jacobi solver passes (more = stiffer fluid)
    CURL:                3,      // VERY low vorticity = no flame-tongue swirls
                                 // (was 30 = fire/smoke; 0–5 = water/cloud)
  };

  /* ---------- ghost choreography & helmet wire geometry ---------- */
  const SIM = {
    cycle: {
      introMs:            3400,
      descendCount:       4,
      descendSpacingMs:   1050,
      ascendCount:        3,
      ascendSpacingMs:    1100,
      restMs:             3500,
      swipeDurMin:        1120,
      swipeDurMax:        1320,
    },
    tail: {
      dragMs:             900,
      dragMsFinal:        1400,
    },
    wave: {
      buildMs:            1800,
      holdMs:             900,
      restMs:             600,
      trailVb:            620,
    },
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

  /* ---------- helmet image ---------- */
  const helmet = new Image();
  helmet.decoding = 'async';
  helmet.src = HELMET_SRC;

  let W = 0, H = 0, DPR = 1;

  /* ---------- pointer / cursor blob ---------- */
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

  /* ---------- ghost choreography (cycle of scripted swipes) ---------- */
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
      dur,
      tailDragMs,
      isFinal,
      from: { x: startX * W, y: fromY },
      mid:  { x: (startX + endX) * 0.5 * W, y: midY },
      to:   { x: endX   * W, y: toY },
      prevX: null, prevY: null,
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

  /* Each swipe step: walk along the bezier, splat velocity + dye into the
   * fluid at the current point. Tail-drag continues splatting at the exit
   * with shrinking radius/strength so the trail "drips off". */
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
        const force    = CFG.swipeForce * (0.6 + envelope * 0.5);
        splatPx(px, py, vx * force * 0.05, vy * force * 0.05,
                CFG.cursorColor, CFG.swipeRadius);
      } else {
        const tDrag = (now - s.start - s.dur) / s.tailDragMs;
        if (tDrag >= 1) { swipes.splice(i, 1); continue; }
        const dx = (s.to.x - s.mid.x);
        const dy = (s.to.y - s.mid.y);
        const shrink = Math.pow(1 - tDrag, 1.2);
        splatPx(s.to.x, s.to.y,
                dx * 0.4 * shrink, dy * 0.4 * shrink,
                CFG.cursorColor,
                CFG.swipeRadius * 0.55 * shrink);
      }
    }
  }

  /* ---------- helmet wire SVG (unchanged from previous version) ---------- */
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

  /* ========================================================================
     WEBGL FLUID SIMULATION
     ========================================================================
     Adapted from Pavel Dobryakov's WebGL-Fluid-Simulation (MIT licensed):
     https://github.com/PavelDoGreat/WebGL-Fluid-Simulation

     One frame, in order:
       1. Apply input splats (cursor + ghost swipes) — inject velocity & dye
       2. Curl              — compute curl of velocity
       3. Vorticity         — confinement force amplifies small swirls
                              (this is what gives the air-bubble look)
       4. Divergence        — compute divergence of velocity
       5. Clear pressure    — decay last frame's pressure by CFG.PRESSURE
       6. Pressure          — Jacobi iterations solving Poisson equation
       7. Gradient subtract — project velocity to be divergence-free
       8. Advect velocity   — carry velocity through itself
       9. Advect dye        — carry dye through velocity
      10. Display dye       — render translucent warm-gold to fluidCanvas

     fluidCanvas is then drawImage'd into the existing 2D reveal canvas so
     the helmet `source-atop` composite continues to work as before.
     ======================================================================== */

  const fluidCanvas = document.createElement('canvas');
  let gl = null;
  let fluidExt = null;
  let copyProgram, splatProgram, advectionProgram, divergenceProgram,
      curlProgram, vorticityProgram, pressureProgram, gradientSubtractProgram,
      clearProgram, displayProgram;
  let dye, velocity, divergence, curl, pressure;
  let blit = null;
  let fluidReady = false;

  function compileShader(type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[hero] shader compile failed:\n' + gl.getShaderInfoLog(sh) + '\n--- source ---\n' + source);
      return null;
    }
    return sh;
  }

  function createProgram(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[hero] program link failed:\n' + gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  function getUniforms(program) {
    const out = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(program, i).name;
      out[name] = gl.getUniformLocation(program, name);
    }
    return out;
  }

  function makeProgram(vs, fs) {
    const program = createProgram(vs, fs);
    return {
      program,
      uniforms: getUniforms(program),
      bind() { gl.useProgram(program); },
    };
  }

  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const texelSizeX = 1 / w, texelSizeY = 1 / h;
    return {
      texture: tex,
      fbo, width: w, height: h,
      texelSizeX, texelSizeY,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        return id;
      },
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    let f1 = createFBO(w, h, internalFormat, format, type, param);
    let f2 = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w, height: h,
      texelSizeX: f1.texelSizeX, texelSizeY: f1.texelSizeY,
      get read()  { return f1; },
      set read(v) { f1 = v; },
      get write() { return f2; },
      set write(v){ f2 = v; },
      swap() { const t = f1; f1 = f2; f2 = t; },
    };
  }

  function getResolution(target) {
    const aspect = fluidCanvas.width / fluidCanvas.height;
    let max = Math.round(target);
    let min = Math.round(target / aspect);
    if (aspect < 1) { const tmp = max; max = min; min = tmp; }
    return fluidCanvas.width > fluidCanvas.height
      ? { width: max, height: min }
      : { width: min, height: max };
  }

  function initFluid() {
    const params = {
      alpha: true, depth: false, stencil: false,
      antialias: false, preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    };
    gl = fluidCanvas.getContext('webgl2', params);
    if (!gl) {
      console.warn('[hero] WebGL2 unavailable — fluid disabled, base portrait only');
      return false;
    }
    if (!gl.getExtension('EXT_color_buffer_float')) {
      console.warn('[hero] EXT_color_buffer_float unavailable — fluid may degrade');
    }
    gl.getExtension('OES_texture_float_linear');

    fluidExt = {
      formatRGBA:  { internalFormat: gl.RGBA16F, format: gl.RGBA },
      formatRG:    { internalFormat: gl.RG16F,   format: gl.RG },
      formatR:     { internalFormat: gl.R16F,    format: gl.RED },
      texType:     gl.HALF_FLOAT,
    };

    /* ---------- shaders ---------- */
    const baseVS = compileShader(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      layout(location = 0) in vec2 aPosition;
      out vec2 vUv;
      out vec2 vL;
      out vec2 vR;
      out vec2 vT;
      out vec2 vB;
      uniform vec2 texelSize;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `);

    const copyFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uTexture;
      out vec4 outColor;
      void main() { outColor = texture(uTexture, vUv); }
    `);

    const clearFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      out vec4 outColor;
      void main() { outColor = value * texture(uTexture, vUv); }
    `);

    const splatFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      out vec4 outColor;
      void main() {
        vec2 p = vUv - point;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture(uTarget, vUv).xyz;
        outColor = vec4(base + splat, 1.0);
      }
    `);

    const advectionFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      precision highp sampler2D;
      in vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform float dt;
      uniform float dissipation;
      out vec4 outColor;
      void main() {
        vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
        vec4 result = texture(uSource, coord);
        float decay = 1.0 + dissipation * dt;
        outColor = result / decay;
      }
    `);

    const divergenceFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      in vec2 vL;
      in vec2 vR;
      in vec2 vT;
      in vec2 vB;
      uniform sampler2D uVelocity;
      out vec4 outColor;
      void main() {
        float L = texture(uVelocity, vL).x;
        float R = texture(uVelocity, vR).x;
        float T = texture(uVelocity, vT).y;
        float B = texture(uVelocity, vB).y;
        vec2  C = texture(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x;
        if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y;
        if (vB.y < 0.0) B = -C.y;
        float div = 0.5 * (R - L + T - B);
        outColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `);

    const curlFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      in vec2 vL;
      in vec2 vR;
      in vec2 vT;
      in vec2 vB;
      uniform sampler2D uVelocity;
      out vec4 outColor;
      void main() {
        float L = texture(uVelocity, vL).y;
        float R = texture(uVelocity, vR).y;
        float T = texture(uVelocity, vT).x;
        float B = texture(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        outColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `);

    const vorticityFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      in vec2 vL;
      in vec2 vR;
      in vec2 vT;
      in vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      out vec4 outColor;
      void main() {
        float L = texture(uCurl, vL).x;
        float R = texture(uCurl, vR).x;
        float T = texture(uCurl, vT).x;
        float B = texture(uCurl, vB).x;
        float C = texture(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 vel = texture(uVelocity, vUv).xy;
        vel += force * dt;
        vel = clamp(vel, -1000.0, 1000.0);
        outColor = vec4(vel, 0.0, 1.0);
      }
    `);

    const pressureFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      in vec2 vL;
      in vec2 vR;
      in vec2 vT;
      in vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      out vec4 outColor;
      void main() {
        float L = texture(uPressure, vL).x;
        float R = texture(uPressure, vR).x;
        float T = texture(uPressure, vT).x;
        float B = texture(uPressure, vB).x;
        float divergence = texture(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        outColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `);

    const gradientSubtractFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      in vec2 vL;
      in vec2 vR;
      in vec2 vT;
      in vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      out vec4 outColor;
      void main() {
        float L = texture(uPressure, vL).x;
        float R = texture(uPressure, vR).x;
        float T = texture(uPressure, vT).x;
        float B = texture(uPressure, vB).x;
        vec2 vel = texture(uVelocity, vUv).xy;
        vel.xy -= vec2(R - L, T - B);
        outColor = vec4(vel, 0.0, 1.0);
      }
    `);

    /* Display: dye color preserved (capped to keep saturation, not blown to
     * white in dense areas), alpha softer so it reads as a calm cloud, not
     * an ember. Lower mult/clamp = closer to landonorris's faint reveal feel. */
    const displayFS = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUv;
      uniform sampler2D uTexture;
      out vec4 outColor;
      void main() {
        vec3 c = texture(uTexture, vUv).rgb;
        float intensity = max(c.r, max(c.g, c.b));
        // Discard faint dye — kills the smoke / dim-grey haze trails entirely.
        if (intensity < 0.03) discard;
        // Fixed pure green, NOT the dye RGB. Dim dye = transparent edge,
        // never a "dim grey/black smoke" colour. Body of the blob always
        // reads as a clean green stroke.
        vec3 col = vec3(0.52, 0.86, 0.55);
        // Quick smoothstep ramp: most of the blob is fully opaque
        // (so the helmet underneath shows at 100%, not 55%) with a
        // narrow soft fluid fringe at the trailing edge.
        float a = smoothstep(0.03, 0.15, intensity);
        outColor = vec4(col, a);
      }
    `);

    copyProgram             = makeProgram(baseVS, copyFS);
    clearProgram            = makeProgram(baseVS, clearFS);
    splatProgram            = makeProgram(baseVS, splatFS);
    advectionProgram        = makeProgram(baseVS, advectionFS);
    divergenceProgram       = makeProgram(baseVS, divergenceFS);
    curlProgram             = makeProgram(baseVS, curlFS);
    vorticityProgram        = makeProgram(baseVS, vorticityFS);
    pressureProgram         = makeProgram(baseVS, pressureFS);
    gradientSubtractProgram = makeProgram(baseVS, gradientSubtractFS);
    displayProgram          = makeProgram(baseVS, displayFS);

    /* ---------- fullscreen quad ---------- */
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
      gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 0, 2, 3]),
      gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    blit = (target, clearFlag = false) => {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      if (clearFlag) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };

    initFramebuffers();
    fluidReady = true;
    return true;
  }

  function initFramebuffers() {
    if (!gl || !fluidExt) return;
    const simRes = getResolution(CFG.SIM_RESOLUTION);
    const dyeRes = getResolution(CFG.DYE_RESOLUTION);
    const t  = fluidExt.texType;
    const RGBA = fluidExt.formatRGBA;
    const RG   = fluidExt.formatRG;
    const R    = fluidExt.formatR;
    const filt = gl.LINEAR;

    dye = createDoubleFBO(dyeRes.width, dyeRes.height,
      RGBA.internalFormat, RGBA.format, t, filt);
    velocity = createDoubleFBO(simRes.width, simRes.height,
      RG.internalFormat, RG.format, t, filt);
    divergence = createFBO(simRes.width, simRes.height,
      R.internalFormat, R.format, t, gl.NEAREST);
    curl = createFBO(simRes.width, simRes.height,
      R.internalFormat, R.format, t, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height,
      R.internalFormat, R.format, t, gl.NEAREST);
  }

  function correctRadius(radius) {
    const aspect = fluidCanvas.width / fluidCanvas.height;
    if (aspect > 1) return radius * aspect;
    return radius;
  }

  /* Splat in CSS pixel coords (within the stage). Velocity inject uses the
   * Pavel-style scale: large numbers (thousands) are normal because the
   * advection texelSize is ~1/128 and the field decays each frame. */
  function splatPx(xPx, yPx, vxInject, vyInject, color, radiusFrac) {
    if (!fluidReady) return;
    const x = (xPx * DPR) / fluidCanvas.width;
    const y = 1.0 - (yPx * DPR) / fluidCanvas.height;
    const aspectRatio = fluidCanvas.width / fluidCanvas.height;
    const radius = correctRadius((radiusFrac || 0.18) * 0.015);

    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, aspectRatio);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, vxInject, -vyInject, 0.0);
    gl.uniform1f(splatProgram.uniforms.radius, radius);
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  function stepFluid(dtSec) {
    if (!fluidReady) return;
    gl.disable(gl.BLEND);

    /* 1. Curl */
    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    /* 2. Vorticity confinement */
    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, CFG.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dtSec);
    blit(velocity.write);
    velocity.swap();

    /* 3. Divergence */
    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    /* 4. Decay last-frame pressure */
    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, CFG.PRESSURE);
    blit(pressure.write);
    pressure.swap();

    /* 5. Pressure Jacobi iterations */
    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < CFG.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    /* 6. Project velocity to be divergence-free */
    gradientSubtractProgram.bind();
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    /* 7. Advect velocity through itself */
    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    const velId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velId);
    gl.uniform1f(advectionProgram.uniforms.dt, dtSec);
    gl.uniform1f(advectionProgram.uniforms.dissipation, CFG.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    /* 8. Advect dye through velocity (note: velocity sampled at sim res, dye at dye res) */
    gl.uniform2f(advectionProgram.uniforms.texelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, CFG.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  function renderFluid() {
    if (!fluidReady) return;
    gl.disable(gl.BLEND);
    displayProgram.bind();
    gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
    blit(null, true);
  }

  /* ---------- resize ---------- */
  function resize() {
    const rect = stage.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    if (fluidCanvas.width !== canvas.width || fluidCanvas.height !== canvas.height) {
      fluidCanvas.width  = canvas.width;
      fluidCanvas.height = canvas.height;
      if (gl) initFramebuffers();
    }
  }

  /* ---------- main loop ---------- */
  let last = performance.now();

  function frame(now) {
    const dt    = Math.min(now - last, 48);
    const dtSec = dt / 1000;
    last = now;

    /* Cursor — spring-damper toward pointer; splat into fluid when moving */
    if (hasPointer && cursorX !== null) {
      const ax = (cursorX - blob.x) * CFG.cursorSpring;
      const ay = (cursorY - blob.y) * CFG.cursorSpring;
      blob.vx = (blob.vx + ax) * CFG.cursorDamping;
      blob.vy = (blob.vy + ay) * CFG.cursorDamping;
      blob.x += blob.vx;
      blob.y += blob.vy;
      const speed = Math.hypot(blob.vx, blob.vy);
      if (speed > CFG.cursorMinEmitSpeed && fluidReady) {
        const sNorm  = Math.min(speed / CFG.cursorMaxSpeedRef, 1);
        const radius = CFG.cursorRadiusMin
                     + (CFG.cursorRadiusMax - CFG.cursorRadiusMin) * sNorm;
        const force  = CFG.cursorForce * (0.5 + 0.5 * sNorm);
        splatPx(blob.x, blob.y,
                blob.vx * force * 0.04,
                blob.vy * force * 0.04,
                CFG.cursorColor,
                radius);
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

    /* Step the fluid (clamp substep for numerical stability) */
    if (fluidReady) {
      const subDt = Math.min(dtSec, 0.0166);
      stepFluid(subDt);
      renderFluid();
    }

    /* Draw fluid into the 2D reveal canvas, then helmet on top */
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (fluidReady) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(fluidCanvas, 0, 0, canvas.width, canvas.height);
    }

    if (helmet.complete && helmet.naturalWidth) {
      ctx.globalCompositeOperation = 'source-atop';
      const hf = CFG.helmetFit;
      const aspect = helmet.naturalHeight / helmet.naturalWidth;
      const dw  = canvas.width * hf.scale;
      const dh  = dw * aspect;
      const dxh = canvas.width * hf.cx - dw / 2;
      const dyh = canvas.height * hf.cy - dh / 2;
      ctx.drawImage(helmet, dxh, dyh, dw, dh);
    }

    requestAnimationFrame(frame);
  }

  /* ---------- init ---------- */
  function init() {
    resize();
    window.addEventListener('resize', resize);
    initFluid();
    initHelmetSim();
    portrait.classList.add('is-loaded');
    last = performance.now();
    requestAnimationFrame(frame);
  }

  if (helmet.complete && helmet.naturalWidth) init();
  else helmet.addEventListener('load', init, { once: true });
})();
