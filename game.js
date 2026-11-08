/* METRO DASH 3D — premium endless runner (three.js r128)
   Live day/night cycle synced to the real clock, missions, power-ups,
   daily reward streak, combo multiplier, synthesized sound. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const LANES = [-2.6, 0, 2.6];
  const GRAVITY = -42, JUMP_V = 15, SUPER_JUMP_V = 22;
  const START_SPEED = 16, MAX_SPEED = 46, ACCEL = 0.35;
  const SPAWN_AHEAD = 160, DESPAWN_BEHIND = 20;

  // ---------- persistent save ----------
  const SAVE_KEY = "metrodash_save_v1";
  const today = () => new Date().toISOString().slice(0, 10);
  let save = { best: 0, bank: 0, lastDaily: "", streak: 0, missionDay: "", missions: [], sound: true };
  try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || "{}")); } catch (e) {}
  const persist = () => localStorage.setItem(SAVE_KEY, JSON.stringify(save));

  const MISSION_POOL = [
    { id: "coins", text: "Collect {n} coins in one run", n: [100, 200, 350] },
    { id: "dist", text: "Run {n} m in one run", n: [500, 1000, 2000] },
    { id: "jumps", text: "Jump {n} times", n: [20, 40, 60] },
    { id: "rolls", text: "Roll {n} times", n: [10, 20, 35] },
    { id: "powers", text: "Grab {n} power-ups", n: [2, 4, 6] },
    { id: "score", text: "Score {n} points", n: [5000, 15000, 40000] },
  ];
  function rollMissions() {
    if (save.missionDay === today() && save.missions.length) return;
    const pool = [...MISSION_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
    save.missions = pool.map((m) => {
      const n = m.n[Math.floor(Math.random() * m.n.length)];
      return { id: m.id, text: m.text.replace("{n}", n), n, done: false };
    });
    save.missionDay = today(); persist();
  }
  function renderMissions(el) {
    el.innerHTML = save.missions.map((m) =>
      `<div class="mission ${m.done ? "done" : ""}"><span>${m.text}</span><b>${m.done ? "✓" : "+250"}</b></div>`).join("");
  }

  // ---------- audio ----------
  let actx = null;
  function beep(freq, dur, type = "sine", vol = 0.15, slide = 0) {
    if (!save.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), actx.currentTime + dur);
      g.gain.setValueAtTime(vol, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
    } catch (e) {}
  }
  const sfx = {
    coin: () => { beep(1320, 0.08, "square", 0.05); setTimeout(() => beep(1760, 0.1, "square", 0.05), 50); },
    jump: () => beep(300, 0.2, "triangle", 0.12, 400),
    roll: () => beep(200, 0.18, "sawtooth", 0.06, -120),
    power: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.12, "square", 0.06), i * 70)),
    crash: () => { beep(120, 0.5, "sawtooth", 0.2, -80); beep(60, 0.6, "square", 0.15); },
    lane: () => beep(500, 0.05, "sine", 0.05, 120),
  };

  // ---------- three setup ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  $("game").appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9fd8ff, 40, 170);
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 6.5, 10);

  const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x5a4030, 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 25, bottom: -25, near: 1, far: 80 });
  scene.add(sun); scene.add(sun.target);

  // sky dome with gradient shader
  const skyUni = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUni,
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.2,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0);} ",
  }));
  scene.add(sky);
  // stars
  const starGeo = new THREE.BufferGeometry(); const sp = [];
  for (let i = 0; i < 900; i++) { const t = Math.random() * Math.PI * 2, p = Math.random() * 1.3; sp.push(Math.cos(t) * Math.cos(p) * 280, Math.sin(p) * 280 + 10, Math.sin(t) * Math.cos(p) * 280); }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, transparent: true, fog: false }));
  scene.add(stars);
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff1b0, fog: false }));
  const moonDisc = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
  scene.add(sunDisc, moonDisc);

  // ---------- textures ----------
  function canvasTex(w, h, draw, rx = 1, ry = 1) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }
  const gravelTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#6d6258"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { const v = 70 + Math.random() * 80; g.fillStyle = `rgb(${v},${v - 8},${v - 16})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  }, 2, 30);
  const sleeperTex = canvasTex(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) { g.fillStyle = "#5a3b22"; g.fillRect(0, y, w, 14); g.fillStyle = "#4a2f1a"; g.fillRect(0, y + 10, w, 4); }
  }, 1, 40);
  const wallTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#b9775a"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < w; x += 32) { g.fillStyle = `hsl(${12 + Math.random() * 10},45%,${40 + Math.random() * 12}%)`; g.fillRect(x + 1, y + 1, 30, 14); }
    const cols = ["#ff4f8b", "#2ee6ff", "#ffd23f", "#7dff9a"]; g.font = "bold 46px sans-serif";
    for (let i = 0; i < 3; i++) { g.fillStyle = cols[i % 4]; g.save(); g.translate(30 + i * 70, 120 + Math.random() * 80); g.rotate(-0.2); g.fillText(["WOW", "RUN", "GO!"][i], 0, 0); g.restore(); }
  }, 30, 1);
  const trainTex = (base) => canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(0, 30, w, 10); g.fillRect(0, 200, w, 6);
    g.fillStyle = "#1c2a3a"; for (let y = 60; y < 180; y += 40) g.fillRect(14, y, w - 28, 26);
    g.fillStyle = "rgba(255,255,255,.25)"; for (let y = 60; y < 180; y += 40) g.fillRect(16, y + 2, 20, 8);
  });

  // ---------- world ----------
  const world = new THREE.Group(); scene.add(world);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 600), new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.z = -250; ground.receiveShadow = true; scene.add(ground);
  const sleepers = new THREE.Group();
  const railMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.9, roughness: 0.3 });
  LANES.forEach((x) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 600), new THREE.MeshStandardMaterial({ map: sleeperTex, transparent: true, roughness: 0.9 }));
    s.rotation.x = -Math.PI / 2; s.position.set(x, 0.02, -250); s.receiveShadow = true; sleepers.add(s);
    [-0.7, 0.7].forEach((o) => { const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 600), railMat); r.position.set(x + o, 0.08, -250); r.receiveShadow = true; sleepers.add(r); });
  });
  scene.add(sleepers);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
  [-1, 1].forEach((side) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 7, 600), wallMat);
    wall.position.set(side * 5.5, 3.5, -250); wall.receiveShadow = true; scene.add(wall);
    const side2 = new THREE.Mesh(new THREE.PlaneGeometry(200, 600), new THREE.MeshStandardMaterial({ color: 0x5f8a4a, roughness: 1 }));
    side2.rotation.x = -Math.PI / 2; side2.position.set(side * 105, 7, -250); scene.add(side2);
  });
  const textures = [gravelTex, sleeperTex, wallTex];

  // city skyline + lamps (recycled)
  const deco = [];
  const bColors = [0x3d4a6b, 0x6b4a7a, 0x2f5f6f, 0x7a5a3d, 0x4a6b55];
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  for (let i = 0; i < 40; i++) {
    const side = i % 2 ? 1 : -1, h = 10 + Math.random() * 30, w = 6 + Math.random() * 6;
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color: bColors[i % 5], roughness: 0.8 }));
    body.position.y = h / 2; b.add(body);
    const wins = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, h * 0.85), winMat.clone());
    wins.position.set(-side * (w / 2 + 0.01), h / 2, 0); wins.rotation.y = -side * Math.PI / 2; wins.material.transparent = true; b.add(wins);
    b.userData.wins = wins;
    b.position.set(side * (12 + Math.random() * 14), 7, -i * 9); scene.add(b); deco.push(b);
  }
  const lamps = [];
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x333a44, metalness: 0.6 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1, g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6), lampMat); pole.position.y = 10; g.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3), bulbMat); bulb.position.set(-side * 0.6, 13, 0); g.add(bulb);
    const pl = new THREE.PointLight(0xffc870, 0, 14); pl.position.copy(bulb.position); g.add(pl); g.userData.light = pl;
    g.position.set(side * 5.5, 0, -i * 25); scene.add(g); lamps.push(g);
  }

  // ---------- player ----------
  const player = new THREE.Group(); scene.add(player);
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c09a, roughness: 0.7 });
  const hoodie = new THREE.MeshStandardMaterial({ color: 0xff4f8b, roughness: 0.6 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x2a4a8a, roughness: 0.8 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2ee6ff, roughness: 0.5 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const body = new THREE.Group(); player.add(body);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.55), hoodie); torso.position.y = 1.55; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 16), skin); head.position.y = 2.38; body.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), capMat); cap.position.y = 2.45; body.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.4), capMat); brim.position.set(0, 2.5, -0.35); body.add(brim);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.3), new THREE.MeshStandardMaterial({ color: 0xffd23f })); bag.position.set(0, 1.6, 0.4); body.add(bag);
  function limb(mat, w, h, x, y) { const p = new THREE.Group(); p.position.set(x, y, 0); const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat); m.position.y = -h / 2; m.castShadow = true; p.add(m); body.add(p); return p; }
  const armL = limb(hoodie, 0.25, 0.85, -0.58, 2.0), armR = limb(hoodie, 0.25, 0.85, 0.58, 2.0);
  const legL = limb(jeans, 0.32, 1.0, -0.22, 1.05), legR = limb(jeans, 0.32, 1.0, 0.22, 1.05);
  [legL, legR].forEach((l) => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.5), shoe); s.position.set(0, -1.0, -0.08); l.add(s); });
  body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  body.rotation.y = Math.PI;
  // magnet aura / shield
  const aura = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0x2ee6ff, transparent: true, opacity: 0.18, depthWrite: false }));
  aura.position.y = 1.4; aura.visible = false; player.add(aura);

  // chaser (inspector + dog)
  const chaser = new THREE.Group(); scene.add(chaser);
  const cBody = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 0.7), new THREE.MeshStandardMaterial({ color: 0x334466 })); cBody.position.y = 1.4;
  const cHead = new THREE.Mesh(new THREE.SphereGeometry(0.4), skin); cHead.position.y = 2.5;
  const cHat = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25), new THREE.MeshStandardMaterial({ color: 0x1a2233 })); cHat.position.y = 2.85;
  const dog = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.1), new THREE.MeshStandardMaterial({ color: 0x8a5a2b })); dog.position.set(1, 0.5, 0);
  chaser.add(cBody, cHead, cHat, dog); chaser.traverse((o) => o.isMesh && (o.castShadow = true));

  // ---------- pooled entities ----------
  const trainColors = ["#e8463a", "#2f7de1", "#f2b632", "#39b36b", "#9a55d6"];
  const trainMats = trainColors.map((c) => new THREE.MeshStandardMaterial({ map: trainTex(c), roughness: 0.4, metalness: 0.3 }));
  const trainFront = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.3, metalness: 0.5 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24);
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 1, roughness: 0.2, emissive: 0x6a4a00 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe8463a, roughness: 0.5 });

  const entities = []; // {mesh,type,lane,z,len,moving,...}
  function addEntity(e) { scene.add(e.mesh); entities.push(e); return e; }

  function makeTrain(lane, z, len, moving) {
    const g = new THREE.Group();
    const m = trainMats[Math.floor(Math.random() * trainMats.length)];
    const car = new THREE.Mesh(new THREE.BoxGeometry(2.3, 3.2, len), m); car.position.y = 1.75; g.add(car);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, len, 16, 1, false, 0, Math.PI), m); roof.rotation.set(Math.PI / 2, Math.PI / 2, 0); roof.rotation.z = Math.PI / 2; roof.position.y = 3.35; roof.scale.set(1, 1, 0.3); g.add(roof);
    const front = new THREE.Mesh(new THREE.BoxGeometry(2.32, 1.4, 0.1), trainFront); front.position.set(0, 2.4, len / 2 + 0.01); g.add(front);
    [-0.7, 0.7].forEach((x) => { const h = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), headMat); h.position.set(x, 1.1, len / 2 + 0.06); g.add(h); });
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(LANES[lane], 0, z);
    return addEntity({ mesh: g, type: "train", lane, z, len, moving, h: 3.6 });
  }
  function makeRamp(lane, z) {
    const g = new THREE.Group(); const len = 6;
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, 3.6); shape.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false });
    const r = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a95a5, metalness: 0.6, roughness: 0.4 }));
    r.rotation.y = Math.PI / 2; r.position.set(-1.1, 0, len / 2); r.castShadow = r.receiveShadow = true; g.add(r);
    g.position.set(LANES[lane], 0, z);
    return addEntity({ mesh: g, type: "ramp", lane, z, len, h: 3.6 });
  }
  function makeBarrier(lane, z, kind) { // kind: low (jump) | high (roll)
    const g = new THREE.Group();
    if (kind === "low") {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.25), stripeMat); bar.position.y = 0.9; g.add(bar);
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 0.26), barrierMat); bar2.position.y = 0.9; g.add(bar2);
      [-1, 1].forEach((x) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1, 0.15), barrierMat); l.position.set(x, 0.5, 0); g.add(l); });
    } else {
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.3), stripeMat); top.position.y = 2.6; g.add(top);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.32), barrierMat); sign.position.y = 2.6; g.add(sign);
      [-1.15, 1.15].forEach((x) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.1, 0.15), barrierMat); l.position.set(x, 1.55, 0); g.add(l); });
    }
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    g.position.set(LANES[lane], 0, z);
    return addEntity({ mesh: g, type: kind, lane, z, len: 0.6 });
  }
  function makeCoin(lane, z, y) {
    const c = new THREE.Mesh(coinGeo, coinMat); c.rotation.z = Math.PI / 2; c.castShadow = true;
    c.position.set(LANES[lane], y, z);
    return addEntity({ mesh: c, type: "coin", lane, z, baseY: y });
  }
  const POWERS = {
    magnet: { color: 0xff3355, label: "🧲 MAGNET", dur: 10 },
    boots: { color: 0x7dff9a, label: "👟 SUPER JUMP", dur: 10 },
    x2: { color: 0x2ee6ff, label: "✖2 MULTIPLIER", dur: 12 },
    shield: { color: 0xffd23f, label: "🛡 SHIELD", dur: 8 },
  };
  function makePower(lane, z, kind, y = 1.2) {
    const g = new THREE.Group();
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshStandardMaterial({ color: POWERS[kind].color, emissive: POWERS[kind].color, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.2 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    g.add(orb, ring); g.position.set(LANES[lane], y, z);
    return addEntity({ mesh: g, type: "power", kind, lane, z, baseY: y });
  }
  function removeEntity(i) {
    const e = entities[i]; scene.remove(e.mesh);
    e.mesh.traverse((o) => { if (o.geometry && o.geometry !== coinGeo) o.geometry.dispose(); });
    entities.splice(i, 1);
  }

  // ---------- level generator ----------
  let nextSpawnZ = -30;
  function coinLine(lane, z0, n, y = 1.0, arc = false) {
    for (let i = 0; i < n; i++) {
      const yy = arc ? y + Math.sin((i / (n - 1)) * Math.PI) * 3 : y;
      makeCoin(lane, z0 - i * 2.2, yy);
    }
  }
  function spawnChunk() {
    const z = nextSpawnZ;
    const difficulty = Math.min(1, state.dist / 3000);
    const pattern = Math.random();
    const free = [0, 1, 2].sort(() => Math.random() - 0.5);
    if (pattern < 0.3) {
      // trains in two lanes, ramp maybe
      const len = 14 + Math.random() * 14;
      makeTrain(free[0], z - len / 2, len, Math.random() < 0.25 + difficulty * 0.3);
      if (Math.random() < 0.6) {
        makeRamp(free[1], z + 3); makeTrain(free[1], z - 3 - len / 2, len, false);
        coinLine(free[1], z - 4, Math.floor(len / 2.2), 4.6);
      } else coinLine(free[1], z, 8);
      if (Math.random() < 0.3 + difficulty * 0.4) makeBarrier(free[2], z - 6, Math.random() < 0.5 ? "low" : "high");
      else coinLine(free[2], z, 6);
      nextSpawnZ -= len + 14;
    } else if (pattern < 0.6) {
      // barrier row with one gap
      const kinds = ["low", "high"];
      free.forEach((l, i) => { if (i < 2 || Math.random() < difficulty * 0.5) makeBarrier(l, z, kinds[Math.floor(Math.random() * 2)]); });
      coinLine(free[2], z + 6, 6, 1.0);
      coinLine(free[0], z + 4, 6, 1.0, true);
      nextSpawnZ -= 22;
    } else if (pattern < 0.82) {
      // zigzag coins + single obstacles
      for (let i = 0; i < 3; i++) {
        const l = Math.floor(Math.random() * 3);
        makeBarrier(l, z - i * 10, Math.random() < 0.5 ? "low" : "high");
        coinLine((l + 1) % 3, z - i * 10 + 3, 4);
      }
      nextSpawnZ -= 34;
    } else {
      // power-up bonus stretch
      const kinds = Object.keys(POWERS);
      makePower(free[0], z, kinds[Math.floor(Math.random() * kinds.length)]);
      coinLine(free[1], z, 10); coinLine(free[2], z - 4, 8, 1.0, true);
      nextSpawnZ -= 26;
    }
  }

  // ---------- game state ----------
  const state = {
    running: false, paused: false, speed: START_SPEED, dist: 0, coins: 0, score: 0,
    lane: 1, x: 0, y: 0, vy: 0, rolling: 0, onTop: false, jumps: 0, rolls: 0, powersTaken: 0,
    powers: {}, stumble: 0, dead: false, deadT: 0, time: 0,
  };
  function resetRun() {
    for (let i = entities.length - 1; i >= 0; i--) removeEntity(i);
    Object.assign(state, { running: true, paused: false, speed: START_SPEED, dist: 0, coins: 0, score: 0, lane: 1, x: 0, y: 0, vy: 0, rolling: 0, jumps: 0, rolls: 0, powersTaken: 0, powers: {}, stumble: 0, dead: false, deadT: 0 });
    player.position.set(0, 0, 0); body.rotation.set(0, Math.PI, 0); body.scale.set(1, 1, 1);
    nextSpawnZ = -50; while (nextSpawnZ > -SPAWN_AHEAD) spawnChunk();
  }

  // ---------- input ----------
  function move(dir) { if (!state.running || state.dead) return; const n = Math.max(0, Math.min(2, state.lane + dir)); if (n !== state.lane) { state.lane = n; sfx.lane(); } else stumble(); }
  function jump() {
    if (!state.running || state.dead) return;
    if (state.y <= groundHeight() + 0.01) { state.vy = state.powers.boots ? SUPER_JUMP_V : JUMP_V; state.rolling = 0; state.jumps++; sfx.jump(); }
  }
  function roll() {
    if (!state.running || state.dead) return;
    state.rolling = 0.7; state.rolls++; if (state.y > groundHeight() + 0.01) state.vy = -30; sfx.roll();
  }
  function stumble() { if (state.stumble > 0) { crash(); return; } state.stumble = 3; flash("Careful!"); }
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "a") move(-1);
    else if (k === "ArrowRight" || k === "d") move(1);
    else if (k === "ArrowUp" || k === "w" || k === " ") jump();
    else if (k === "ArrowDown" || k === "s") roll();
    else if (k === "p" || k === "Escape") togglePause();
  });
  let ts = null;
  addEventListener("touchstart", (e) => { ts = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  addEventListener("touchend", (e) => {
    if (!ts) return; const t = e.changedTouches[0]; const dx = t.clientX - ts.x, dy = t.clientY - ts.y; ts = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 25) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1); else dy < 0 ? jump() : roll();
  });

  // ---------- day/night cycle (real clock based, 1 real hour = 1 game day while playing) ----------
  const C = (h) => new THREE.Color(h);
  const SKY = [ // [hour, top, bottom, fog, sunInt, hemiInt]
    [0, C(0x050818), C(0x1a1840), C(0x141634), 0.15, 0.35],
    [5, C(0x1a2050), C(0xff8a5c), C(0x7a5070), 0.4, 0.5],
    [7, C(0x4aa8ff), C(0xffd0a0), C(0xbfd8f0), 1.0, 0.8],
    [12, C(0x2a8cff), C(0xbfe6ff), C(0x9fd8ff), 1.3, 0.95],
    [17, C(0x3a78d8), C(0xffc08a), C(0xe8b890), 1.0, 0.8],
    [19, C(0x2a1a5a), C(0xff5a6a), C(0x8a4a6a), 0.5, 0.55],
    [21, C(0x0a0c2a), C(0x2a2060), C(0x201a40), 0.2, 0.4],
    [24, C(0x050818), C(0x1a1840), C(0x141634), 0.15, 0.35],
  ];
  let gameHour = new Date().getHours() + new Date().getMinutes() / 60;
  function applySky(hour) {
    let a = SKY[0], b = SKY[1];
    for (let i = 0; i < SKY.length - 1; i++) if (hour >= SKY[i][0] && hour < SKY[i + 1][0]) { a = SKY[i]; b = SKY[i + 1]; }
    const t = (hour - a[0]) / (b[0] - a[0]);
    skyUni.top.value.copy(a[1]).lerp(b[1], t); skyUni.bottom.value.copy(a[2]).lerp(b[2], t);
    scene.fog.color.copy(a[3]).lerp(b[3], t); renderer.setClearColor(scene.fog.color);
    sun.intensity = a[4] + (b[4] - a[4]) * t; hemi.intensity = a[5] + (b[5] - a[5]) * t;
    const ang = ((hour - 6) / 24) * Math.PI * 2;
    sunDisc.position.set(Math.cos(ang) * -200, Math.sin(ang) * 160, -200);
    moonDisc.position.set(Math.cos(ang) * 200, -Math.sin(ang) * 160, -200);
    const night = Math.max(0, Math.min(1, (0.6 - sun.intensity) / 0.45));
    stars.material.opacity = night; stars.visible = night > 0.02;
    sun.color.setHSL(0.1, 0.6, 0.5 + sun.intensity * 0.25);
    lamps.forEach((l) => (l.userData.light.intensity = night * 2.2));
    bulbMat.color.setScalar(0.5 + night * 0.5);
    deco.forEach((d) => (d.userData.wins.material.opacity = 0.1 + night * 0.9));
    const hh = Math.floor(hour) % 24, mm = Math.floor((hour % 1) * 60);
    $("clock").textContent = `${night > 0.5 ? "🌙" : "☀"} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  // ---------- helpers ----------
  function groundHeight() {
    // standing on a train roof / ramp?
    let h = 0; const px = state.x;
    for (const e of entities) {
      if (Math.abs(LANES[e.lane] - px) > 1.0) continue;
      if (e.type === "train" && Math.abs(e.z) < e.len / 2) h = Math.max(h, e.h);
      if (e.type === "ramp" && Math.abs(e.z) < e.len / 2) h = Math.max(h, ((e.len / 2 - e.z) / e.len) * e.h);
    }
    return h;
  }
  function multiplier() { return (1 + Math.floor(state.dist / 500)) * (state.powers.x2 ? 2 : 1); }
  let toastT = 0;
  function flash(txt) { const t = $("toast"); t.textContent = txt; t.classList.add("show"); toastT = 1.2; }
  function renderPowers() {
    $("powers").innerHTML = Object.entries(state.powers).map(([k, v]) => `<div class="pw">${POWERS[k].label} ${Math.ceil(v)}s</div>`).join("");
  }
  function crash() {
    if (state.powers.shield) { delete state.powers.shield; flash("🛡 Saved!"); sfx.power(); state.stumble = 1; return true; }
    state.dead = true; sfx.crash(); return false;
  }

  // ---------- particles ----------
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.08, 6, 4);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe680 });
  function burst(pos, n = 8) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(sparkGeo, sparkMat); s.position.copy(pos);
      s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 6, (Math.random() - 0.5) * 6); s.userData.life = 0.5;
      scene.add(s); sparks.push(s);
    }
  }

  // ---------- main loop ----------
  const clock = new THREE.Clock();
  let animT = 0;
  function update(dt) {
    state.time += dt;
    // day/night: when idle follow real clock; while playing, 1 real minute = 1 game hour (sunsets every run!)
    if (state.running && !state.dead) gameHour = (gameHour + dt / 60) % 24;
    else { const d = new Date(); const real = d.getHours() + d.getMinutes() / 60; gameHour += ((real - gameHour + 36) % 24 - 12) * Math.min(1, dt); gameHour = (gameHour + 24) % 24; }
    applySky(gameHour);

    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").classList.remove("show"); }

    const move = state.running && !state.dead && !state.paused ? state.speed * dt : (state.running ? 0 : 6 * dt);
    // scroll textures for motion
    gravelTex.offset.y += move / 20; sleeperTex.offset.y += move / 15; wallTex.offset.x -= move / 20;
    deco.forEach((d) => { d.position.z += move * 0.6; if (d.position.z > 20) d.position.z -= 360; });
    lamps.forEach((l) => { l.position.z += move; if (l.position.z > 20) l.position.z -= 300; });

    if (!state.running || state.paused) {
      animT += dt * 6; animateRunner(0.6); return;
    }
    if (state.dead) {
      state.deadT += dt; body.rotation.x = Math.min(1.4, state.deadT * 4);
      chaser.position.lerp(new THREE.Vector3(state.x, 0, 2), dt * 3);
      if (state.deadT > 1.3) gameOver();
      return;
    }

    state.speed = Math.min(MAX_SPEED, state.speed + ACCEL * dt);
    state.dist += move;
    state.score += move * multiplier();

    // entities scroll toward the player
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      e.z += move + (e.moving ? state.speed * 0.6 * dt : 0);
      e.mesh.position.z = e.z;
      if (e.type === "coin") {
        e.mesh.rotation.y += dt * 5;
        if (state.powers.magnet && e.z > -25 && e.z < 2) {
          e.mesh.position.x += (state.x - e.mesh.position.x) * Math.min(1, dt * 10);
          e.mesh.position.y += (state.y + 1.2 - e.mesh.position.y) * Math.min(1, dt * 10);
          e.z += (0 - e.z) * Math.min(1, dt * 8); e.mesh.position.z = e.z;
        }
      }
      if (e.type === "power") { e.mesh.rotation.y += dt * 2; e.mesh.position.y = e.baseY + Math.sin(state.time * 4) * 0.2; }
      if (e.z > DESPAWN_BEHIND) removeEntity(i);
    }
    nextSpawnZ += move;
    while (nextSpawnZ > -SPAWN_AHEAD) spawnChunk();

    // lateral motion
    state.x += (LANES[state.lane] - state.x) * Math.min(1, dt * 14);
    // vertical
    const gh = groundHeight();
    state.vy += GRAVITY * dt; state.y += state.vy * dt;
    if (state.y <= gh) {
      if (gh - state.y > 1.2 && state.vy <= 0) {
        // hit the front face of something tall
      }
      state.y = gh; state.vy = 0;
    }
    if (state.rolling > 0) state.rolling -= dt;
    if (state.stumble > 0) state.stumble -= dt;

    // collisions
    const px = state.x, py = state.y, ph = state.rolling > 0 ? 0.9 : 2.4;
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      const ex = e.type === "coin" ? e.mesh.position.x : LANES[e.lane];
      if (Math.abs(ex - px) > 1.1) continue;
      if (e.type === "coin") {
        if (Math.abs(e.z) < 1.0 && Math.abs(e.mesh.position.y - (py + 1)) < 1.6) {
          state.coins += state.powers.x2 ? 2 : 1; state.score += 10 * multiplier(); burst(e.mesh.position, 5); sfx.coin(); removeEntity(i);
        }
      } else if (e.type === "power") {
        if (Math.abs(e.z) < 1.2 && Math.abs(e.mesh.position.y - (py + 1)) < 1.8) {
          state.powers[e.kind] = POWERS[e.kind].dur; state.powersTaken++; flash(POWERS[e.kind].label); sfx.power(); burst(e.mesh.position, 14); removeEntity(i);
        }
      } else if (e.type === "low") {
        if (Math.abs(e.z) < 0.6 && py < 1.1) { if (crash()) removeEntity(i); }
      } else if (e.type === "high") {
        if (Math.abs(e.z) < 0.6 && py + ph > 1.9 && state.rolling <= 0) { if (crash()) removeEntity(i); }
      } else if (e.type === "train") {
        const front = e.z + e.len / 2;
        if (front > -0.4 && front < 0.9 && py < e.h - 0.5) {
          if (Math.abs(LANES[e.lane] - px) < 0.6) { if (crash()) removeEntity(i); }
          else { state.lane = state.x < LANES[e.lane] ? Math.max(0, e.lane - 1) : Math.min(2, e.lane + 1); stumble(); }
        }
      }
      if (state.dead) break;
    }

    // power timers
    for (const k in state.powers) { state.powers[k] -= dt; if (state.powers[k] <= 0) delete state.powers[k]; }
    aura.visible = !!(state.powers.magnet || state.powers.shield);
    aura.material.color.set(state.powers.shield ? 0xffd23f : 0xff3355);
    aura.scale.setScalar(1 + Math.sin(state.time * 6) * 0.05);

    // chaser distance
    const cz = state.stumble > 0 ? 3 : 12;
    chaser.position.lerp(new THREE.Vector3(state.x, 0, cz), dt * 2);

    animT += dt * state.speed * 0.5;
    animateRunner(1);

    // HUD
    $("coins").textContent = state.coins;
    $("score").textContent = Math.floor(state.score).toLocaleString();
    $("mult").textContent = "x" + multiplier();
    renderPowers();
    checkMissions(false);
  }
  function animateRunner(k) {
    player.position.set(state.x, state.y, 0);
    const airborne = state.y > groundHeight() + 0.05;
    const s = Math.sin(animT) * k;
    if (state.rolling > 0) { body.scale.y += (0.5 - body.scale.y) * 0.4; body.rotation.x = 0; }
    else { body.scale.y += (1 - body.scale.y) * 0.3; }
    armL.rotation.x = s * 1.1; armR.rotation.x = -s * 1.1;
    legL.rotation.x = airborne ? -0.6 : -s * 1.0; legR.rotation.x = airborne ? 0.3 : s * 1.0;
    body.position.y = airborne ? 0 : Math.abs(Math.cos(animT)) * 0.12 * k;
    body.rotation.z = (LANES[state.lane] - state.x) * -0.08;
    // chaser legs bob
    chaser.position.y = Math.abs(Math.sin(animT * 1.1)) * 0.15;
  }
  function updateCamera(dt) {
    const tx = state.x * 0.6, ty = 6 + state.y * 0.7, tz = 10;
    camera.position.x += (tx - camera.position.x) * Math.min(1, dt * 5);
    camera.position.y += (ty - camera.position.y) * Math.min(1, dt * 4);
    camera.position.z = tz;
    const fov = 62 + (state.speed - START_SPEED) * 0.25;
    camera.fov += (fov - camera.fov) * dt * 2; camera.updateProjectionMatrix();
    camera.lookAt(state.x * 0.4, 1.8 + state.y * 0.5, -12);
    sun.position.set(camera.position.x + 8, 20, 8); sun.target.position.set(camera.position.x, 0, -10);
    sky.position.copy(camera.position); stars.position.copy(camera.position);
  }
  function loop() {
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt); updateCamera(dt);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.userData.life -= dt; s.userData.v.y -= 20 * dt; s.position.addScaledVector(s.userData.v, dt);
      s.scale.setScalar(Math.max(0.01, s.userData.life * 2));
      if (s.userData.life <= 0) { scene.remove(s); sparks.splice(i, 1); }
    }
    renderer.render(scene, camera);
    if (!document.body.dataset.ready) document.body.dataset.ready = "1";
    requestAnimationFrame(loop);
  }

  // ---------- missions / UI flow ----------
  function checkMissions(final) {
    const vals = { coins: state.coins, dist: state.dist, jumps: state.jumps, rolls: state.rolls, powers: state.powersTaken, score: state.score };
    save.missions.forEach((m) => {
      if (!m.done && vals[m.id] >= m.n) { m.done = true; save.bank += 250; flash("🎯 Mission complete! +250"); sfx.power(); persist(); }
    });
  }
  function refreshMenu() {
    rollMissions();
    $("best").textContent = Math.floor(save.best).toLocaleString();
    $("bank").textContent = save.bank.toLocaleString();
    $("streak").textContent = save.streak ? `🔥 ${save.streak}-day streak — come back tomorrow for more!` : "Come back every day for bigger rewards!";
    $("daily").disabled = save.lastDaily === today();
    $("daily").textContent = save.lastDaily === today() ? "✅ Reward claimed" : "🎁 Daily Reward";
    $("sound").textContent = save.sound ? "🔊 Sound On" : "🔇 Sound Off";
    renderMissions($("missions"));
  }
  function start() {
    $("menu").classList.add("hidden"); $("over").classList.add("hidden");
    $("hud").style.display = "flex"; $("pauseBtn").style.display = "block";
    resetRun(); flash("GO!");
  }
  function gameOver() {
    state.running = false;
    save.bank += state.coins;
    const isBest = state.score > save.best; if (isBest) save.best = state.score; persist();
    $("final").textContent = Math.floor(state.score).toLocaleString();
    $("fcoins").textContent = state.coins; $("fdist").textContent = Math.floor(state.dist) + " m";
    $("fbest").textContent = (isBest ? "🏆 NEW! " : "") + Math.floor(save.best).toLocaleString();
    renderMissions($("missions2"));
    $("hud").style.display = "none"; $("pauseBtn").style.display = "none"; $("powers").innerHTML = "";
    $("over").classList.remove("hidden");
  }
  function togglePause() {
    if (!state.running || state.dead) return;
    state.paused = !state.paused; $("pauseBtn").textContent = state.paused ? "▶" : "❚❚";
    if (state.paused) flash("PAUSED"); else clock.getDelta();
  }
  $("play").onclick = start; $("again").onclick = start;
  $("home").onclick = () => { $("over").classList.add("hidden"); $("menu").classList.remove("hidden"); for (let i = entities.length - 1; i >= 0; i--) removeEntity(i); refreshMenu(); };
  $("pauseBtn").onclick = togglePause;
  $("sound").onclick = () => { save.sound = !save.sound; persist(); refreshMenu(); };
  $("daily").onclick = () => {
    if (save.lastDaily === today()) return;
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    save.streak = save.lastDaily === y ? save.streak + 1 : 1;
    const reward = 100 * Math.min(save.streak, 7);
    save.bank += reward; save.lastDaily = today(); persist(); sfx.power(); flash(`🎁 +${reward} coins!`); refreshMenu();
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden && state.running && !state.paused) togglePause(); });
  addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  refreshMenu();
  loop();
  window.__game = { state, start };
})();
