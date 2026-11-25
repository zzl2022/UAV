import './intro.css';

const CYAN = '#7fe8ff';
const CYAN_HOT = 'rgba(231, 253, 255, .92)';
const ORANGE = '#ff7a18';

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
};

export function mountIntro() {
  if (typeof document === 'undefined') return null;
  if (document.getElementById('ac8-intro')) return null;

  const params = new URLSearchParams(window.location.search);
  const forced = params.get('intro') === '1';
  const disabled = params.get('intro') === '0';
  if (disabled || (!forced && navigator.webdriver)) return null;

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.createElement('div');
  root.id = 'ac8-intro';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="ac8-veil"></div>
    <canvas class="ac8-canvas"></canvas>
    <div class="ac8-hud">
      <div class="ac8-hud-top">
        <div class="ac8-hud-kicker"><span class="ac8-dot"></span>UAV TACTICAL SYSTEM</div>
        <div class="ac8-hud-sub">OPTICAL INTERFACE / BOOT SEQUENCE 01</div>
      </div>
      <div class="ac8-hud-bottom">
        <div class="ac8-hud-status">INITIALIZING OPTICAL LINK</div>
        <div class="ac8-hud-hint">CLICK OR PRESS ESC TO SKIP</div>
      </div>
    </div>
    <div class="ac8-scan-readout">SCAN 000</div>`;
  document.body.appendChild(root);
  document.body.classList.add('intro-active');

  const canvas = root.querySelector('.ac8-canvas');
  const ctx = canvas.getContext('2d');
  const hudLayer = root.querySelector('.ac8-hud');
  const statusEl = root.querySelector('.ac8-hud-status');
  const readout = root.querySelector('.ac8-scan-readout');
  const veil = root.querySelector('.ac8-veil');

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, S = 0, x0 = 0, y0 = 0;
  let raf = 0, done = false, started = false, useHud = false, clipPrepared = false;
  let startAt = 0, scanStart = 0, lastStatus = '', scanProgress = 0;
  const T0 = performance.now();

  function hudApi() { return window.__ac8Hud; }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2;
    cy = H * 0.52;
    S = Math.max(220, Math.min(W * 0.62, H * 0.64, 780));
    x0 = cx - S / 2;
    y0 = cy - S / 2;
  }
  resize();

  function refreshCenter() {
    const hud = hudApi();
    if (!hud || !hud.ready || typeof hud.getCenterScreen !== 'function') return;
    try {
      const c = hud.getCenterScreen();
      if (Number.isFinite(c.x) && Number.isFinite(c.y)) {
        cx = c.x;
        cy = c.y;
      }
    } catch {}
  }

  function setStatus(text) {
    if (text !== lastStatus) {
      lastStatus = text;
      statusEl.textContent = text;
    }
  }

  function neonLine(x1, y1, x2, y2, color, opts = {}) {
    const { alpha = 1, width = 1.2, glow = 14, hot = CYAN_HOT } = opts;
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha * 0.9;
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.stroke();
    if (hot) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hot;
      ctx.globalAlpha = alpha * 0.7;
      ctx.lineWidth = Math.max(0.5, width * 0.42);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCrosshair(p, fade) {
    const a = p * fade;
    if (a <= 0.002) return;
    const arm = 18 + 74 * easeOutCubic(p);
    const gap = 8 + 6 * (1 - p);
    neonLine(0, cy, W, cy, CYAN, { alpha: a * 0.08, width: 0.8, glow: 0, hot: null });
    neonLine(cx, 0, cx, H, CYAN, { alpha: a * 0.08, width: 0.8, glow: 0, hot: null });
    neonLine(cx - arm, cy, cx - gap, cy, CYAN, { alpha: a, width: 1.1, glow: 12 });
    neonLine(cx + gap, cy, cx + arm, cy, CYAN, { alpha: a, width: 1.1, glow: 12 });
    neonLine(cx, cy - arm, cx, cy - gap, CYAN, { alpha: a, width: 1.1, glow: 12 });
    neonLine(cx, cy + gap, cx, cy + arm, CYAN, { alpha: a, width: 1.1, glow: 12 });
    const ticks = [[cx - arm, cy, -1, 0], [cx + arm, cy, 1, 0], [cx, cy - arm, 0, -1], [cx, cy + arm, 0, 1]];
    for (const [x, y, dx, dy] of ticks) neonLine(x, y, x + dx * 6, y + dy * 6, CYAN, { alpha: a, width: 2, glow: 14 });
    const r = 5 + 3 * easeOutCubic(p);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = CYAN;
    ctx.globalAlpha = a * 0.9;
    ctx.lineWidth = 1;
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Fallback 2D sequence, used only if the WebGL HUD cannot be created.
  function drawAxes(progress, fade) {
    if (progress <= 0.002) return;
    const e = easeInOutCubic(progress);
    const len = lerp(92, S / 2, e);
    const thetaA = -Math.PI / 2 + (Math.PI / 2) * e;
    const thetaB = (Math.PI / 2) * e;
    const orangeT = smoothstep(0.05, 0.6, progress);
    const colA = `rgb(${Math.round(lerp(127, 255, orangeT))},${Math.round(lerp(232, 122, orangeT))},${Math.round(lerp(255, 24, orangeT))})`;
    for (const sign of [-1, 1]) {
      const ax = cx + Math.cos(thetaA) * len * sign;
      const ay = cy + Math.sin(thetaA) * len * sign;
      const bx = cx + Math.cos(thetaB) * len * sign;
      const by = cy + Math.sin(thetaB) * len * sign;
      neonLine(cx, cy, ax, ay, colA, { alpha: fade, width: 1.6, glow: 18 });
      neonLine(cx, cy, bx, by, CYAN, { alpha: fade * 0.88, width: 1.6, glow: 16 });
    }
  }

  function drawSquare(q, fade) {
    if (q <= 0.002) return;
    const segs = [
      [x0, y0, x0 + S, y0],
      [x0 + S, y0, x0 + S, y0 + S],
      [x0 + S, y0 + S, x0, y0 + S],
      [x0, y0 + S, x0, y0],
    ];
    const colors = [CYAN, CYAN, ORANGE, CYAN];
    let remain = q * 4 * S;
    for (let i = 0; i < segs.length; i++) {
      if (remain <= 0) break;
      const [ax, ay, bx, by] = segs[i];
      const len = Math.hypot(bx - ax, by - ay);
      const k = Math.min(1, remain / len);
      neonLine(ax, ay, ax + (bx - ax) * k, ay + (by - ay) * k, colors[i], { alpha: fade, width: 1.6, glow: 16 });
      remain -= len;
    }
  }

  // Morph the 2D crosshair into the tilted 3D plane axes.
  function drawMorphCrosshair(axes, cross) {
    const hud = hudApi();
    if (!hud || !hud.ready || typeof hud.getAxisScreenFull !== 'function') return false;
    const axis = hud.getAxisScreenFull();
    if (!axis) return false;
    const morph = easeInOutCubic(clamp01(axes));
    const arm = 18 + 74 * easeOutCubic(clamp01(cross));
    const starts = [
      [cx - arm, cy, axis.xMinus, 'x'],
      [cx + arm, cy, axis.xPlus, 'x'],
      [cx, cy - arm, axis.zMinus, 'z'],
      [cx, cy + arm, axis.zPlus, 'z'],
    ];
    const orangeT = smoothstep(0.05, 0.6, axes);
    const colX = `rgb(${Math.round(lerp(127, 255, orangeT))},${Math.round(lerp(232, 122, orangeT))},${Math.round(lerp(255, 24, orangeT))})`;
    const alpha = 1 - smoothstep(0.82, 1, axes);
    if (alpha > 0.002) {
      for (const [sx, sy, target, kind] of starts) {
        const x = lerp(sx, target.x, morph);
        const y = lerp(sy, target.y, morph);
        const color = kind === 'x' ? colX : CYAN;
        neonLine(cx, cy, x, y, color, { alpha, width: 1.5, glow: 18 });
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    const centerAlpha = 1 - smoothstep(0.25, 0.8, axes);
    if (centerAlpha > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = CYAN;
      ctx.globalAlpha = centerAlpha;
      ctx.lineWidth = 1;
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  function drawGrid(g, fade) {
    if (g <= 0.002) return;
    const radius = easeOutCubic(g) * S * 0.78;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, S, S);
    ctx.clip();
    const N = 16;
    for (let i = 1; i < N; i++) {
      const px = x0 + (S * i) / N;
      if (Math.abs(px - cx) > radius) continue;
      const major = i % 4 === 0;
      neonLine(px, y0, px, y0 + S, CYAN, { alpha: (major ? 0.2 : 0.07) * fade, width: 0.6, glow: 0, hot: null });
    }
    for (let i = 1; i < N; i++) {
      const py = y0 + (S * i) / N;
      if (Math.abs(py - cy) > radius) continue;
      const major = i % 4 === 0;
      neonLine(x0, py, x0 + S, py, CYAN, { alpha: (major ? 0.2 : 0.07) * fade, width: 0.6, glow: 0, hot: null });
    }
    ctx.restore();
  }

  function drawBox(b, fade) {
    if (b <= 0.002) return;
    const e = easeOutCubic(b);
    const scale = 1 + 0.15 * e;
    const dy = -S * 0.06 * e;
    const near = [[x0, y0], [x0 + S, y0], [x0 + S, y0 + S], [x0, y0 + S]];
    const far = near.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale + dy]);
    for (let i = 0; i < 4; i++) {
      const [nx, ny] = near[i];
      const [fx, fy] = far[i];
      const grad = ctx.createLinearGradient(nx, ny, fx, fy);
      grad.addColorStop(0, 'rgba(127,232,255,.9)');
      grad.addColorStop(1, 'rgba(127,232,255,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(fx, fy);
      ctx.strokeStyle = grad;
      ctx.globalAlpha = fade;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.restore();
    }
  }

  function scanYFor(sp) {
    const top = Math.max(0, cy - S / 2);
    const bottom = Math.min(H, cy + S / 2);
    if (sp < 0.25) return lerp(0, top, sp / 0.25);
    if (sp < 0.75) return lerp(top, bottom, (sp - 0.25) / 0.5);
    return lerp(bottom, H, (sp - 0.75) / 0.25);
  }

  function drawFallbackScan(scanY, sp) {
    if (!(sp > 0 && sp < 1)) return;
    const alpha = Math.pow(Math.sin(Math.PI * sp), 0.35);
    neonLine(0, scanY, W, scanY, CYAN, { alpha: alpha * 0.65, width: 1, glow: 18 });
    neonLine(x0, scanY, x0 + S, scanY, ORANGE, { alpha, width: 2.4, glow: 30 });
  }

  function complete() {
    if (done) return;
    done = true;
    scanProgress = 1;
    window.__ac8IntroDone = true;
    if (raf) cancelAnimationFrame(raf);
    try { hudApi()?.finishIntro?.(); } catch {}
    root.style.setProperty('--ac8-scan', H + 'px');
    document.body.classList.remove('intro-active');
    root.classList.add('is-done');
    window.dispatchEvent(new CustomEvent('ac8-intro-complete'));
    window.setTimeout(() => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey, true);
      root.remove();
    }, 750);
  }

  function skip() {
    if (done) return;
    try { hudApi()?.finishIntro?.(); } catch {}
    root.style.setProperty('--ac8-scan', H + 'px');
    complete();
  }

  function onKey(event) {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      skip();
    }
  }

  root.addEventListener('pointerdown', event => {
    event.preventDefault();
    skip();
  }, { passive: false });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', resize, { passive: true });

  const api = {
    skip,
    finish: complete,
    get done() { return done; },
    get state() {
      return {
        elapsed: (performance.now() - T0) / 1000,
        t: started ? (performance.now() - startAt) / 1000 : 0,
        started,
        useHud,
        hudReady: !!hudApi()?.ready,
        scanProgress,
        scanStart: !!scanStart,
        status: lastStatus,
      };
    },
  };
  window.__ac8Intro = api;

  function frame(now) {
    if (done) return;
    const bootT = (now - T0) / 1000;
    const hud = hudApi();
    const appReady = document.documentElement.dataset.ready;
    const ready = appReady === 'true' || appReady === 'error';

    ctx.clearRect(0, 0, W, H);
    refreshCenter();

    if (!started) {
      const pulse = 0.3 + 0.08 * Math.sin(bootT * 3.2);
      drawCrosshair(pulse, 1);
      setStatus(ready ? 'SYNCING TACTICAL SCENE' : 'INITIALIZING OPTICAL LINK');
      if (hud && hud.ready && ready) {
        started = true;
        useHud = true;
        startAt = now;
      } else if (ready && (!hud || !hud.ready) && bootT > 1.6) {
        started = true;
        useHud = false;
        startAt = now;
      } else if (bootT > 10) {
        started = true;
        useHud = false;
        startAt = now;
      } else {
        raf = requestAnimationFrame(frame);
        return;
      }
    }

    if (reduced) {
      try { hudApi()?.finishIntro?.(); } catch {}
      complete();
      return;
    }

    const t = (now - startAt) / 1000;
    const cross = 0.32 + 0.68 * smoothstep(0, 0.45, t);
    const axes = smoothstep(0.3, 1.25, t);
    const square = smoothstep(1.15, 1.7, t);
    const grid = smoothstep(1.6, 2.15, t);
    const box = smoothstep(2.05, 2.85, t);
    const hudActive = useHud && hud && hud.ready;

    if (hudActive) {
      hud.setProgress({visible: axes > 0.01 || square > 0, axes, square, grid, box, scan: 0});
      if (!drawMorphCrosshair(axes, cross)) {
        drawCrosshair(cross, 1 - smoothstep(0.04, 0.5, axes));
      }
    } else {
      drawCrosshair(cross, 1 - smoothstep(0.04, 0.5, axes));
      drawAxes(axes, 1 - smoothstep(0.6, 0.98, square));
      drawSquare(square, 1);
      drawGrid(grid, 1);
      drawBox(box, 1);
    }

    if (hudActive && !clipPrepared && t >= 2.7) {
      clipPrepared = true;
      hud.prepareScanClip?.();
    }

    if (t < 0.7) setStatus('CROSSHAIR ONLINE');
    else if (t < 1.45) setStatus('AXIS VECTOR LOCK');
    else if (t < 1.9) setStatus('FRAME SYNCHRONIZED');
    else if (t < 2.35) setStatus('GRID MAPPING 16×16');
    else if (t < 2.95) setStatus('DEPTH PROJECTION');

    let sp = 0;
    if (t >= 2.95) {
      if (!scanStart) scanStart = now;
      sp = clamp01((now - scanStart) / 1900);
      scanProgress = sp;
      if (hudActive) hud.setProgress({scan: sp});
    }

    if (sp > 0) {
      let scanY = null;
      if (hudActive) {
        // The scan is a vertical sheet perpendicular to the square plane;
        // the model itself is clipped by that plane in the main scene.
        // Move the HUD into the main scene now so its plane is depth-tested
        // below the city during the reveal, not just afterwards.
        hud.enterMainScene?.();
        // Drop the opaque veil immediately: the model reveal is now driven by
        // the vertical clipping plane, not a camera-facing cut line.
        veil.style.display = 'none';
        hudLayer.style.display = 'none';
        const sy = hud.getScanScreenY();
        scanY = (sy != null && Number.isFinite(sy)) ? sy : H * sp;
      } else {
        scanY = scanYFor(sp);
        root.style.setProperty('--ac8-scan', scanY + 'px');
        drawFallbackScan(scanY, sp);
      }
      const pct = Math.round(sp * 100);
      setStatus(`OPTICAL SCAN ${String(pct).padStart(3, '0')}`);
      readout.style.top = scanY + 'px';
      readout.textContent = `SCAN ${String(pct).padStart(3, '0')}`;
      readout.style.opacity = String(sp > 0 && sp < 1 ? Math.min(1, Math.sin(Math.PI * sp) * 1.8) : 0);
      hudLayer.style.opacity = String(1 - smoothstep(0.02, 0.3, sp));
      if (sp >= 1) {
        setStatus('INTERFACE ONLINE');
        complete();
        return;
      }
    }

    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);
  return api;
}
