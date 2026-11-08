import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';

const CYAN = new THREE.Color(0x7fe8ff);
const ORANGE = new THREE.Color(0xff7a18);
const PALE_BLUE = new THREE.Color(0xa9f0ff);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
};
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function makeNTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '800 148px "Segoe UI", "Microsoft YaHei", Arial, sans-serif';
  g.shadowColor = '#7fe8ff';
  g.shadowBlur = 30;
  g.fillStyle = '#f2feff';
  g.fillText('N', size / 2, size * 0.56);
  g.shadowBlur = 0;
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(127,232,255,.9)';
  g.strokeText('N', size / 2, size * 0.56);
  g.strokeStyle = 'rgba(255,122,24,.95)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(size / 2, 26);
  g.lineTo(size / 2, 58);
  g.stroke();
  g.beginPath();
  g.moveTo(size / 2 - 12, 46);
  g.lineTo(size / 2, 26);
  g.lineTo(size / 2 + 12, 46);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createAc8Hud({scene: mainScene, camera, viewport, getActiveGroup}) {
  if (typeof document === 'undefined') return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({alpha: true, antialias: true});
  } catch (error) {
    console.warn('AC8 HUD renderer unavailable', error);
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const canvas = renderer.domElement;
  canvas.className = 'ac8-hud-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'AC8_HoloPlane';
  scene.add(root);

  const resolution = new THREE.Vector2(1, 1);
  const materials = [];
  // LineMaterial linewidth is in CSS pixels; three overwrites resolution with
  // the renderer viewport (CSS units), so do not multiply it by DPR here.
  const lineScale = 1;

  function newMaterial(color, width, opacity) {
    const m = new LineMaterial({
      color,
      linewidth: width * lineScale,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      resolution,
    });
    materials.push(m);
    return m;
  }

  function makeLine(points, color, opts = {}) {
    const {
      width = 2, opacity = 1, glowWidth = 8, glowOpacity = 0.22,
      dashed = false, dashSize = 0.04, gapSize = 0.025,
    } = opts;
    const group = new THREE.Group();
    const geometry = new LineGeometry();
    geometry.setPositions(points);
    const build = (w, o) => {
      const material = newMaterial(color, w, o);
      if (dashed) {
        material.dashed = true;
        material.dashSize = dashSize;
        material.gapSize = gapSize;
        material.needsUpdate = true;
      }
      const line = new Line2(geometry, material);
      line.frustumCulled = false;
      if (dashed) line.computeLineDistances();
      return line;
    };
    const core = build(width, opacity);
    group.add(core);
    if (glowWidth > 0) group.add(build(glowWidth, glowOpacity));
    group.userData.core = core;
    group.userData.glow = group.children[1] || null;
    return group;
  }

  function setLineColor(group, color) {
    for (const line of group.children) {
      if (line.material && line.material.color) line.material.color.copy(color);
    }
  }

  // Axes: orange east-west, cyan north-south (three.js z = -north).
  const axisX = makeLine([-1, 0, 0, 1, 0, 0], CYAN, {width: 2.4, glowWidth: 10, glowOpacity: 0.3});
  const axisZ = makeLine([0, 0, -1, 0, 0, 1], CYAN, {width: 2.2, glowWidth: 9, glowOpacity: 0.28});
  const axisLines = [...axisX.children, ...axisZ.children];
  const axisBaseOpacity = axisLines.map(line => line.material.opacity);
  axisX.scale.x = 0.001;
  axisZ.scale.z = 0.001;
  root.add(axisX, axisZ);

  // Square frame: the north edge is orange, the rest cyan.
  const edgeGroups = [];
  function addEdge(x0, z0, x1, z1, color) {
    const group = new THREE.Group();
    group.position.set(x0, 0.00005, z0);
    const line = makeLine([0, 0, 0, x1 - x0, 0, z1 - z0], color, {width: 2.3, glowWidth: 10, glowOpacity: 0.28});
    group.add(line);
    group.userData.axis = x1 !== x0 ? 'x' : 'z';
    group.userData.color = color;
    edgeGroups.push(group);
    root.add(group);
    return group;
  }
  addEdge(-1, -1, 1, -1, ORANGE); // north
  addEdge(1, -1, 1, 1, CYAN);
  addEdge(1, 1, -1, 1, ORANGE); // south
  addEdge(-1, 1, -1, -1, CYAN);

  // Grid, revealed from the center by scaling the group.
  const gridGroup = new THREE.Group();
  root.add(gridGroup);
  function makeGrid(step, opacity, width) {
    const points = [];
    for (let i = -1 + step; i < 1 - 1e-9; i += step) {
      points.push(i, 0, -1, i, 0, 1);
      points.push(-1, 0, i, 1, 0, i);
    }
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(points);
    const grid = new LineSegments2(geometry, newMaterial(CYAN, width, opacity));
    grid.frustumCulled = false;
    return grid;
  }
  gridGroup.add(makeGrid(2 / 16, 0.08, 0.8));
  gridGroup.add(makeGrid(2 / 4, 0.16, 1.1));
  gridGroup.scale.set(0.001, 1, 0.001);

  // Four long pale-blue dashed pillars perpendicular to the plane.
  const pillarGroups = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [x, z] of corners) {
    const group = new THREE.Group();
    group.position.set(x, 0.00005, z);
    const pillar = makeLine([0, 0, 0, 0, 0.32, 0], PALE_BLUE, {
      width: 1.7, glowWidth: 7, glowOpacity: 0.18,
      dashed: true, dashSize: 0.035, gapSize: 0.022,
    });
    group.add(pillar);
    group.scale.y = 0.001;
    root.add(group);
    pillarGroups.push(group);
  }

  // North tick + billboarded N.
  const northTick = makeLine([0, 0.00005, -1, 0, 0.012, -1], ORANGE, {width: 1.4, glowWidth: 6, glowOpacity: 0.25});
  root.add(northTick);

  const nMaterial = new THREE.SpriteMaterial({
    map: makeNTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const nSprite = new THREE.Sprite(nMaterial);
  nSprite.center.set(0.5, 0);
  nSprite.position.set(0, 0.00005, -1.002);
  nSprite.renderOrder = 20;
  root.add(nSprite);

  // Scan line. scanFrame lets the old-map hide scan use the old model's
  // bounds while the visible square has already scaled to the new model.
  const scanFrame = new THREE.Group();
  root.add(scanFrame);
  const scanGroup = new THREE.Group();
  scanFrame.add(scanGroup);
  const scanLine = makeLine([-1, 0, 0, 1, 0, 0], ORANGE, {width: 3.2, glowWidth: 16, glowOpacity: 0.45});
  scanGroup.add(scanLine);
  const scanStripMaterial = new THREE.MeshBasicMaterial({
    color: 0xff7a18,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const scanStrip = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.05), scanStripMaterial);
  scanStrip.rotation.x = -Math.PI / 2;
  scanStrip.position.y = 0.00001;
  scanGroup.add(scanStrip);

  function makeScanSheetTexture() {
    const width = 32, height = 256;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    const grad = g.createLinearGradient(0, height, 0, 0);
    grad.addColorStop(0, 'rgba(255,190,120,.85)');
    grad.addColorStop(0.12, 'rgba(255,150,60,.5)');
    grad.addColorStop(0.55, 'rgba(255,122,24,.26)');
    grad.addColorStop(1, 'rgba(255,122,24,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const scanSheetMaterial = new THREE.MeshBasicMaterial({
    map: makeScanSheetTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const scanSheet = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.3), scanSheetMaterial);
  scanSheet.position.y = 0.15;
  scanGroup.add(scanSheet);

  scanGroup.visible = false;
  const scanBaseOpacity = scanLine.children.map(line => line.material.opacity);

  function setScanAlpha(alpha) {
    scanLine.children.forEach((line, i) => { line.material.opacity = scanBaseOpacity[i] * alpha; });
    scanStripMaterial.opacity = 0.12 * alpha;
    scanSheetMaterial.opacity = 0.8 * alpha;
  }

  const state = {
    axes: 0,
    square: 0,
    grid: 0,
    box: 0,
    scan: 0,
    visible: false,
  };
  let hasModel = false;
  let finished = false;
  let enteredMainScene = false;
  let scanTransition = false;
  let switching = false;
  let activeGroup = null;
  let clippedGroup = null;
  const clippedMaterials = new Set();
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function clearClip() {
    for (const material of clippedMaterials) {
      if (material?.userData && '__ac8OriginalClipping' in material.userData) {
        material.clippingPlanes = material.userData.__ac8OriginalClipping;
        delete material.userData.__ac8OriginalClipping;
        material.needsUpdate = true;
      }
    }
    clippedMaterials.clear();
    clippedGroup = null;
  }

  function applyClipToActiveGroup() {
    if (!activeGroup || clippedGroup === activeGroup) return;
    clearClip();
    clippedGroup = activeGroup;
    activeGroup.traverse(object => {
      if (!object.isMesh || !object.material) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material || clippedMaterials.has(material)) continue;
        if (!material.userData) material.userData = {};
        material.userData.__ac8OriginalClipping = material.clippingPlanes;
        material.clippingPlanes = [clipPlane];
        material.clipShadows = true;
        material.needsUpdate = true;
        clippedMaterials.add(material);
      }
    });
  }

  let scanTarget = null;

  function currentTarget() {
    return {position: root.position.clone(), half: root.scale.x};
  }

  function applyScanFrame() {
    if (!scanTarget) {
      scanFrame.position.set(0, 0, 0);
      scanFrame.scale.set(1, 1, 1);
      return;
    }
    const half = Math.max(root.scale.x, 1e-6);
    scanFrame.position.set(
      (scanTarget.position.x - root.position.x) / half,
      (scanTarget.position.y - root.position.y) / half,
      (scanTarget.position.z - root.position.z) / half
    );
    const k = scanTarget.half / half;
    scanFrame.scale.set(k, k, k);
  }

  function updateScanClip(scan) {
    if (!clippedGroup) return;
    const base = scanTarget || {position: root.position, half: root.scale.z};
    const zWorld = base.position.z + (-1 + 2 * scan) * base.half;
    // Keep the north side (already scanned) visible; the model grows southward.
    clipPlane.normal.set(0, 0, -1);
    clipPlane.constant = zWorld;
  }

  function findGroundMesh(group) {
    let ground = null;
    group.traverse(object => {
      if (!ground && object.isMesh && /Terrain_DEM|TianDiTu_Imagery/i.test(object.name)) ground = object;
    });
    return ground;
  }

  function groundHeightAt(group, center, box) {
    const ground = findGroundMesh(group);
    if (!ground) return box.min.y;
    group.updateMatrixWorld(true);
    const startY = box.max.y + Math.max(100, (box.max.y - box.min.y) + 100);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(center.x, startY, center.z),
      new THREE.Vector3(0, -1, 0)
    );
    const hits = ray.intersectObject(ground, false);
    if (hits.length) return hits[0].point.y;
    if (ground.geometry) {
      ground.geometry.computeBoundingBox();
      const bb = ground.geometry.boundingBox.clone().applyMatrix4(ground.matrixWorld);
      return (bb.min.y + bb.max.y) / 2;
    }
    return box.min.y;
  }

  function setProgress(next) {
    Object.assign(state, next);
    root.visible = hasModel && state.visible !== false;
    if (!root.visible) return;

    const ax = Math.max(0.0001, state.axes);
    axisX.scale.x = ax;
    axisZ.scale.z = ax;
    const orangeMix = smoothstep(0.05, 0.6, state.axes);
    setLineColor(axisX, CYAN.clone().lerp(ORANGE, orangeMix));

    // The central cross fades away once the square frame has formed.
    const axisFade = 1 - smoothstep(0.6, 0.98, state.square);
    axisLines.forEach((line, i) => { line.material.opacity = axisBaseOpacity[i] * axisFade; });
    axisX.visible = axisFade > 0.01;
    axisZ.visible = axisFade > 0.01;

    const perimeter = state.square * 4;
    edgeGroups.forEach((group, i) => {
      const local = easeOutCubic(clamp01(perimeter - i));
      const s = Math.max(0.0001, local);
      if (group.userData.axis === 'x') group.scale.x = s;
      else group.scale.z = s;
    });

    const gs = Math.max(0.0001, easeOutCubic(state.grid));
    gridGroup.scale.set(gs, 1, gs);
    gridGroup.visible = state.grid > 0.001;

    pillarGroups.forEach((group, i) => {
      const local = easeOutCubic(clamp01(state.box * 1.3 - i * 0.09));
      group.scale.y = Math.max(0.0001, local);
    });

    nMaterial.opacity = smoothstep(0.42, 0.95, Math.max(state.square, state.box));
    northTick.visible = nMaterial.opacity > 0.01;

    if (state.scan > 0 && state.scan < 1) {
      applyClipToActiveGroup();
      updateScanClip(state.scan);
      scanGroup.visible = true;
      scanGroup.position.z = -1 + 2 * state.scan;
      setScanAlpha(Math.pow(Math.sin(Math.PI * state.scan), 0.4));
    } else {
      // Keep a prepared clip (used to precompile the clipping shaders before
      // the scan); finishIntro()/syncToGroup() clear it explicitly.
      scanGroup.visible = false;
      setScanAlpha(0);
    }
  }

  function groupTarget(group) {
    if (!group) return null;
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1);
    // The square is always slightly larger than the model, like the Henan scene.
    const half = span * 0.54;
    const groundY = groundHeightAt(group, center, box);
    return {
      position: new THREE.Vector3(center.x, groundY + Math.max(0.5, span * 0.00005), center.z),
      half,
    };
  }

  function applyGroupTarget(target) {
    root.position.copy(target.position);
    root.scale.set(target.half, target.half, target.half);
  }

  function syncToGroup(group) {
    if (!group) {
      hasModel = false;
      root.visible = false;
      return;
    }
    if (clippedGroup && clippedGroup !== group) clearClip();
    const target = groupTarget(group);
    if (!target) {
      hasModel = false;
      root.visible = false;
      return;
    }
    activeGroup = group;
    applyGroupTarget(target);
    hasModel = true;
    root.visible = state.visible !== false || finished;
  }

  function animateToGroup(group, {duration = 700} = {}) {
    const target = groupTarget(group);
    if (!target) return Promise.resolve();
    const fromPos = root.position.clone();
    const fromHalf = root.scale.x;
    hasModel = true;
    root.visible = true;
    return new Promise(resolve => {
      const start = performance.now();
      const step = now => {
        const k = Math.min(1, (now - start) / duration);
        const e = easeInOutCubic(k);
        root.position.lerpVectors(fromPos, target.position, e);
        const half = fromHalf + (target.half - fromHalf) * e;
        root.scale.set(half, half, half);
        if (k < 1) {
          requestAnimationFrame(step);
        } else {
          applyGroupTarget(target);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  function attachToIntro() {
    const intro = document.getElementById('ac8-intro');
    if (!intro) return false;
    intro.appendChild(canvas);
    canvas.style.position = 'fixed';
    canvas.style.zIndex = '1';
    canvas.style.pointerEvents = 'none';
    resize();
    return true;
  }

  function attachToViewport() {
    if (canvas.parentElement !== viewport) viewport.appendChild(canvas);
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '3';
    canvas.style.pointerEvents = 'none';
    resize();
  }

  function resize() {
    if (!viewport) return;
    const introAttached = canvas.parentElement && canvas.parentElement.id === 'ac8-intro';
    const rect = viewport.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (!finished && !enteredMainScene) renderer.setSize(w, h, false);
    for (const m of materials) m.resolution.set(w, h);
    if (finished || enteredMainScene) return;
    if (introAttached) {
      canvas.style.left = rect.left + 'px';
      canvas.style.top = rect.top + 'px';
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    } else {
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    }
  }

  function setDepthTest(enabled) {
    for (const m of materials) m.depthTest = enabled;
    scanStripMaterial.depthTest = enabled;
    // The scan wall is a light effect, not the ground plane: keep it visible
    // above the city so the perpendicular divider is clearly readable.
    scanSheetMaterial.depthTest = false;
    nMaterial.depthTest = false;
  }

  function enterMainScene() {
    if (enteredMainScene) return;
    enteredMainScene = true;
    if (mainScene) {
      mainScene.add(root);
      setDepthTest(true);
      canvas.remove();
      // Release the auxiliary context after the intro is over; doing it here
      // synchronously would stall the first scan frame.
      window.setTimeout(() => {
        try {
          renderer.dispose();
          renderer.forceContextLoss?.();
        } catch {}
      }, 4000);
    } else {
      attachToViewport();
    }
  }

  function prepareScanClip() {
    if (!activeGroup) return;
    applyClipToActiveGroup();
    updateScanClip(0.0001);
  }

  function animateScan(from, to, duration, {keepClip, target = null}) {
    return new Promise(resolve => {
      scanTransition = true;
      scanTarget = target;
      applyScanFrame();
      scanSheetMaterial.depthTest = false;
      const start = performance.now();
      const step = now => {
        const k = Math.min(1, (now - start) / duration);
        const e = easeInOutCubic(k);
        const s = Math.min(0.9999, Math.max(0.0001, from + (to - from) * e));
        setProgress({scan: s});
        if (k < 1) {
          requestAnimationFrame(step);
        } else {
          if (keepClip) {
            scanGroup.visible = false;
            setScanAlpha(0);
          } else {
            clearClip();
            scanGroup.visible = false;
            setScanAlpha(0);
            scanSheetMaterial.depthTest = true;
            scanTarget = null;
            applyScanFrame();
          }
          scanTransition = false;
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  function playScanHide({duration = 750, target = null} = {}) {
    switching = true;
    return animateScan(1, 0, duration, {keepClip: true, target});
  }

  function playScanReveal({duration = 850} = {}) {
    return animateScan(0, 1, duration, {keepClip: false}).then(() => {
      switching = false;
    });
  }

  function endSwitchScan() {
    clearClip();
    scanGroup.visible = false;
    setScanAlpha(0);
    scanSheetMaterial.depthTest = true;
    scanTransition = false;
    switching = false;
    scanTarget = null;
    applyScanFrame();
  }

  function finishIntro() {
    if (finished) return;
    finished = true;
    clearClip();
    enterMainScene();
    // The transient scan wall must not float above the finished city.
    scanSheetMaterial.depthTest = true;
    setProgress({axes: 1, square: 1, grid: 1, box: 1, scan: 0, visible: true});
  }

  function update(dt) {
    if (!hasModel) return;
    // Keep the N readable and facing the camera at any zoom.
    const world = new THREE.Vector3();
    nSprite.getWorldPosition(world);
    const distance = camera.position.distanceTo(world);
    const local = (distance * 0.034) / Math.max(root.scale.x, 1e-6);
    nSprite.scale.set(local, local, 1);

  }

  function render() {
    if (finished || enteredMainScene) return;
    if (!hasModel || !root.visible) {
      renderer.clear();
      return;
    }
    renderer.render(scene, camera);
  }

  function project(local) {
    const v = local.clone();
    root.updateMatrixWorld(true);
    root.localToWorld(v);
    v.project(camera);
    const rect = (canvas.parentElement ? canvas.getBoundingClientRect() : viewport.getBoundingClientRect());
    return {
      x: rect.left + (v.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - v.y) * 0.5 * rect.height,
      z: v.z,
    };
  }

  function getScanScreenY() {
    if (!scanGroup.visible) return null;
    return project(new THREE.Vector3(0, 0.03, scanGroup.position.z)).y;
  }

  function getCenterScreen() {
    return project(new THREE.Vector3(0, 0.01, 0));
  }

  function getAxisScreenFull() {
    return {
      xMinus: project(new THREE.Vector3(-1, 0, 0)),
      xPlus: project(new THREE.Vector3(1, 0, 0)),
      zMinus: project(new THREE.Vector3(0, 0, -1)),
      zPlus: project(new THREE.Vector3(0, 0, 1)),
    };
  }

  const hud = {
    canvas,
    ready: false,
    get finished() { return finished; },
    syncToGroup,
    animateToGroup,
    setProgress,
    attachToIntro,
    attachToViewport,
    enterMainScene,
    prepareScanClip,
    getCurrentTarget: currentTarget,
    playScanHide,
    playScanReveal,
    endSwitchScan,
    finishIntro,
    resize,
    update,
    render,
    getScanScreenY,
    getCenterScreen,
    getAxisScreenFull,
    get finishedState() { return finished; },
    get inWorld() { return !!mainScene && root.parent === mainScene; },
    get debug() {
      return {
        inWorld: !!mainScene && root.parent === mainScene,
        enteredMainScene,
        half: root.scale.x,
        position: root.position.toArray(),
        lineDepth: materials[0]?.depthTest,
        gridDepth: gridGroup.children[0]?.material?.depthTest,
        nDepth: nMaterial.depthTest,
        corners: corners.map(([x, z]) => project(new THREE.Vector3(x, 0, z))),
        canvasAttached: !!canvas.parentElement,
      };
    },
  };

  // Resolve the current model before the intro starts.
  syncToGroup(getActiveGroup ? getActiveGroup() : null);
  const introEl = document.getElementById('ac8-intro');
  const canIntro = introEl && !introEl.classList.contains('is-done') && !window.__ac8IntroDone;
  const attachedToIntro = canIntro ? attachToIntro() : false;
  if (attachedToIntro) {
    // Compile the model clipping shaders while the intro veil still covers the
    // scene, so the first scan frame does not stall.
    applyClipToActiveGroup();
    updateScanClip(0.0001);
  } else {
    finishIntro();
  }
  hud.ready = hasModel;
  return hud;
}
