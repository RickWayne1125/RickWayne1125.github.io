/*
 * /photography/ — the four subjects in WebGL (three.js r128), built on the pieces photography-gl.js lends.
 *
 * photography-subjects.js draws each subject's object with elements and CSS 3D transforms. When WebGL is on, the same
 * views hand their state to this file, which models the objects as meshes:
 *   food       a round wooden table on a pedestal, a glass turntable with porcelain plates, cutlery, chopsticks, cups
 *   landscape  a rangefinder camera seen from the back: chrome top plate, leatherette, the view in its window, a
 *              focal-plane shutter that closes, a wind lever that swings out, a frame counter and a light meter
 *   people     a carousel slide projector on the floor throwing the photograph on a screen, its tray full of slides
 *   animals    a cloth-bound field notebook lying open, a print taped to the right page, notes on the left, a pencil
 * The grid gets small versions of the same four.
 *
 * Units and conventions are photography-gl.js's: CSS pixels, y up. Objects that lie on the desk are modelled with z
 * pointing up out of the desk, then posed. Every surface that shows a photograph is unlit, so it keeps the colours of
 * its file; nothing is laid over a photograph but the thin frame lines of the viewfinder and the tape at the corners
 * of the taped print.
 *
 * window.PhotographySubjectsGL = { table, finder, projector, notebook }, each (opts) → { el, …, setTheme, destroy }.
 */
(() => {
  "use strict";
  const GL = window.PhotographyGL;
  if (!GL || !GL.kit) return;
  const K = GL.kit;
  const { THREE, REDUCED, DEG, clamp, lerp, inOut, outCubic, lin } = K;
  const TAU = Math.PI * 2;

  /* ---------- shapes, materials, textures ---------- */
  // a rounded rectangle centred on the origin; r is one radius or [top-left, top-right, bottom-right, bottom-left]
  function rr(w, h, r) {
    const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
    const s = new THREE.Shape();
    const x = -w / 2;
    const y = -h / 2;
    s.moveTo(x + bl, y);
    s.lineTo(x + w - br, y);
    if (br) s.quadraticCurveTo(x + w, y, x + w, y + br);
    s.lineTo(x + w, y + h - tr);
    if (tr) s.quadraticCurveTo(x + w, y + h, x + w - tr, y + h);
    s.lineTo(x + tl, y + h);
    if (tl) s.quadraticCurveTo(x, y + h, x, y + h - tl);
    s.lineTo(x, y + bl);
    if (bl) s.quadraticCurveTo(x, y, x + bl, y);
    return s;
  }
  // a slab w × h with rounded corners, from z = 0 to z = d, its edges softened by a bevel b; `hole` cuts a window
  function slab(w, h, d, r, b = 2, hole = null) {
    const radii = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.max(0, v - b));
    const shape = rr(w - b * 2, h - b * 2, radii);
    if (hole) shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.2, d - b * 2),
      bevelEnabled: b > 0,
      bevelThickness: b,
      bevelSize: b,
      bevelSegments: 3,
      curveSegments: 12,
    });
    g.translate(0, 0, b);
    return g;
  }
  const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color: lin(color), roughness: 0.6, metalness: 0 }, o || {}));
  const axisZ = (g) => g.rotateX(Math.PI / 2); // a cylinder or lathe standing on the desk
  function castShadows(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !o.userData.noCast;
      o.receiveShadow = !o.userData.noReceive;
    });
  }
  // seeded random numbers, so every texture comes out the same each time
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // a repeating texture painted on a canvas (used as bump maps: only its brightness matters)
  function tile(size, paint, rx, ry = rx) {
    const c = K.makeCanvas(size, size);
    paint(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    return t;
  }
  const pebble = (x, n) => {
    const r = rng(7);
    x.fillStyle = "#808080";
    x.fillRect(0, 0, n, n);
    for (let i = 0; i < 2400; i++) {
      const v = (70 + r() * 130) | 0;
      x.fillStyle = `rgb(${v},${v},${v})`;
      x.beginPath();
      x.arc(r() * n, r() * n, 1 + r() * 2.4, 0, TAU);
      x.fill();
    }
  };
  const linen = (x, n) => {
    const r = rng(3);
    x.fillStyle = "#808080";
    x.fillRect(0, 0, n, n);
    for (let i = 0; i < n; i += 2) {
      x.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`;
      x.fillRect(0, i, n, 1);
      x.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.2})`;
      x.fillRect(i, 0, 1, n);
    }
  };
  // a texture cut to `aspect` the way CSS object-fit: cover cuts a photograph
  function crop(t, r, aspect) {
    t.repeat.set(1, 1);
    t.offset.set(0, 0);
    if (r > aspect) {
      t.repeat.x = aspect / r;
      t.offset.x = (1 - t.repeat.x) / 2;
    } else {
      t.repeat.y = r / aspect;
      t.offset.y = (1 - t.repeat.y) / 2;
    }
  }
  /*
   * A surface that shows a photograph, unlit. `aspect` crops it like object-fit: cover (0: shown whole); `onRatio` hears
   * the photograph's proportions once it is in. Until then it is a plain grey card.
   */
  function photoSurface(geometry, aspect, kick, onRatio) {
    const m = K.photoMaterial(null);
    m.color.copy(lin("#d9d6cf"));
    const mesh = new THREE.Mesh(geometry, m);
    mesh.userData.noCast = true;
    mesh.userData.noReceive = true;
    let want = null;
    mesh.show = (img) => {
      if (!img || img === want) return;
      want = img;
      const fill = () => {
        if (want !== img || !K.loaded(img)) return;
        const t = K.texture(img);
        const r = img.naturalWidth / img.naturalHeight;
        if (aspect) crop(t, r, aspect);
        if (m.map) m.map.dispose();
        m.map = t;
        m.color.set(0xffffff);
        m.needsUpdate = true;
        if (onRatio) onRatio(r);
        if (kick) kick();
      };
      if (K.loaded(img)) fill();
      else img.addEventListener("load", fill, { once: true });
    };
    return mesh;
  }
  // text drawn on a transparent canvas, as a plane `h` units tall
  function label(text, { h, font, color, w = 512, px = 64 }) {
    const c = K.makeCanvas(w, px * 1.4);
    const x = c.getContext("2d");
    x.font = font.replace("{px}", px + "px");
    x.fillStyle = color;
    x.textAlign = "center";
    x.textBaseline = "middle";
    K.spaced(x, px * 0.08);
    x.fillText(text, w / 2, c.height / 2);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry((h * c.width) / c.height, h),
      new THREE.MeshBasicMaterial({ map: K.texture(c), transparent: true, depthWrite: false })
    );
    mesh.userData.noCast = true;
    mesh.userData.noReceive = true;
    return mesh;
  }
  // which of `list` (or their parts) is under the pointer: the nearest object carrying userData.j
  function picker(base, list) {
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector2();
    return (e) => {
      const p = base.point(e);
      v.set(p.nx, p.ny);
      ray.setFromCamera(v, base.camera);
      for (const hit of ray.intersectObjects(list(), true)) {
        let o = hit.object;
        while (o && o.userData.j === undefined) o = o.parent;
        if (o) return o;
      }
      return null;
    };
  }
  // the canvas stands in for the object for keyboards and screen readers
  function a11y(base, kind, text) {
    const el = base.canvas;
    el.tabIndex = 0;
    el.setAttribute("role", "group");
    el.setAttribute("aria-roledescription", kind);
    el.setAttribute("aria-label", text);
    el.style.touchAction = "pan-y";
  }
  function clickable(base, list, onHit) {
    const pick = picker(base, list);
    base.canvas.addEventListener("click", (e) => {
      const o = pick(e);
      if (o) onHit(o);
    });
    base.canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      base.canvas.style.cursor = pick(e) ? "pointer" : "";
    });
  }

  /* ---------- food: the table ---------- */
  function paintWood(cv) {
    const x = cv.getContext("2d");
    const n = cv.width;
    const r = rng(11);
    const g = x.createLinearGradient(0, 0, n, n);
    g.addColorStop(0, "#bb8b5a");
    g.addColorStop(0.5, "#a4744a");
    g.addColorStop(1, "#8b5d37");
    x.fillStyle = g;
    x.fillRect(0, 0, n, n);
    for (let i = 0; i < 240; i++) {
      const y0 = r() * n;
      const amp = 3 + r() * 10;
      const f = 0.003 + r() * 0.008;
      const ph = r() * TAU;
      x.strokeStyle = r() < 0.72 ? `rgba(72,40,18,${0.05 + r() * 0.13})` : `rgba(232,190,140,${0.05 + r() * 0.1})`;
      x.lineWidth = 0.8 + r() * 2.6;
      x.beginPath();
      for (let px = 0; px <= n; px += 12) {
        const py = y0 + Math.sin(px * f + ph) * amp + Math.sin(px * f * 2.7 + ph * 2) * amp * 0.35;
        if (px) x.lineTo(px, py);
        else x.moveTo(px, py);
      }
      x.stroke();
    }
    // the joints between the planks
    x.strokeStyle = "rgba(48,26,10,0.4)";
    x.lineWidth = 2;
    for (let k = 1; k < 5; k++) {
      x.beginPath();
      x.moveTo(0, (k * n) / 5);
      x.lineTo(n, (k * n) / 5);
      x.stroke();
    }
  }
  // a porcelain plate of radius pr: foot ring, well, rising rim; its well is flat out to 0.6 pr
  function plateGeometry(pr) {
    const k = pr / 100;
    const pts = [
      [0, 1.5],
      [40, 1.5],
      [44, 0],
      [50, 0],
      [58, 2.6],
      [64, 3.2],
      [86, 6.6],
      [100, 9.4],
      [100.4, 10.6],
      [98.4, 11.2],
      [85, 8.6],
      [64, 5.6],
      [60, 5.2],
      [0, 5.2],
    ].map(([a, b]) => new THREE.Vector2(Math.max(0.01, a * k), b * k));
    return axisZ(new THREE.LatheGeometry(pts, 96));
  }
  // a small dish or cup with something in it
  function bowl(r, h, inner, env) {
    const k = r / 30;
    const pts = [
      [0, 0],
      [16, 0],
      [18, 1.4],
      [27, h * 0.55],
      [30, h],
      [28.6, h + 0.4],
      [25, h * 0.6],
      [16, 2.6],
      [0, 2.6],
    ].map(([a, b]) => new THREE.Vector2(Math.max(0.01, a * k), b * k));
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(
        axisZ(new THREE.LatheGeometry(pts, 64)),
        mat("#f4f1ea", { roughness: 0.2, envMap: env, envMapIntensity: 0.7, side: THREE.DoubleSide })
      )
    );
    const liquid = new THREE.Mesh(new THREE.CircleGeometry(20.5 * k, 48), mat(inner, { roughness: 0.06, envMap: env, envMapIntensity: 1.1 }));
    liquid.position.z = h * 0.5 * k;
    liquid.userData.noCast = true;
    g.add(liquid);
    return g;
  }
  function fork(len, metal) {
    const k = len / 190;
    const g = new THREE.Group();
    const part = (w, h, d, r, b, y, x = 0) => {
      const m = new THREE.Mesh(slab(w * k, h * k, d * k, Array.isArray(r) ? r.map((v) => v * k) : r * k, b * k), metal);
      m.position.set(x * k, y * k, 0);
      g.add(m);
    };
    part(11, 112, 2.6, 5, 0.8, -36);
    part(8, 30, 2.2, 3, 0.6, 34);
    part(26, 22, 2, [2, 2, 9, 9], 0.6, 56);
    for (let t = 0; t < 4; t++) part(4, 40, 1.8, 1.5, 0.5, 84, -9.75 + t * 6.5);
    return g;
  }
  function knife(len, metal) {
    const k = len / 190;
    const g = new THREE.Group();
    const handle = new THREE.Mesh(slab(13 * k, 100 * k, 3.2 * k, 6 * k, 1 * k), metal);
    handle.position.y = -42 * k;
    const s = new THREE.Shape();
    s.moveTo(-5.5 * k, 6 * k);
    s.lineTo(5.5 * k, 6 * k);
    s.lineTo(5.5 * k, 74 * k);
    s.quadraticCurveTo(5 * k, 92 * k, -1 * k, 96 * k);
    s.quadraticCurveTo(-5.5 * k, 90 * k, -5.5 * k, 70 * k);
    s.lineTo(-5.5 * k, 6 * k);
    const blade = new THREE.Mesh(
      new THREE.ExtrudeGeometry(s, { depth: 1.2 * k, bevelEnabled: true, bevelThickness: 0.3 * k, bevelSize: 0.3 * k, bevelSegments: 2 }),
      metal
    );
    blade.position.set(0, 2 * k, 0.3 * k);
    g.add(handle, blade);
    return g;
  }
  function chopsticks(len, env) {
    const g = new THREE.Group();
    const lacquer = mat("#3a1c16", { roughness: 0.26, envMap: env, envMapIntensity: 0.85 });
    const restY = len * 0.3;
    const lift = Math.atan2(6, restY + len / 2);
    for (const dx of [-4.6, 4.6]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.6, len, 10), lacquer);
      s.rotation.x = lift;
      s.position.set(dx, 0, 2.6 + Math.sin(lift) * (len / 2));
      g.add(s);
    }
    const rest = new THREE.Mesh(slab(28, 9, 6, 4, 1.5), mat("#e9e4da", { roughness: 0.24, envMap: env, envMapIntensity: 0.6 }));
    rest.position.set(0, restY, 0);
    g.add(rest);
    return g;
  }
  /*
   * The table, radius R, top surface at z = 0. m plates stand on the turntable; plate j holds photograph fills[j].
   * setTurn() turns the turntable the way the CSS version's --turn does; the plate in front rises a little.
   */
  function tableModel({ R, m, env, imgFor, kick }) {
    const root = new THREE.Group();
    const T = R * 0.085;
    const cv = K.makeCanvas(1024, 1024);
    paintWood(cv);
    const topMat = mat("#ffffff", { map: K.texture(cv), roughness: 0.36, envMap: env, envMapIntensity: 0.5 });
    const edge = mat("#5e3b1f", { roughness: 0.44, envMap: env, envMapIntensity: 0.45 });
    const r0 = R - T / 2;
    const top = new THREE.Mesh(axisZ(new THREE.CylinderGeometry(r0, r0, T, 128, 1)), [edge, topMat, edge]);
    top.position.z = -T / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r0, T / 2, 14, 160), edge);
    rim.position.z = -T / 2;
    const stem = new THREE.Mesh(axisZ(new THREE.CylinderGeometry(R * 0.07, R * 0.09, R * 0.5, 32)), edge);
    stem.position.z = -T - R * 0.25;
    const foot = new THREE.Mesh(axisZ(new THREE.CylinderGeometry(R * 0.34, R * 0.36, R * 0.04, 64)), edge);
    foot.position.z = -T - R * 0.52;
    root.add(top, rim, stem, foot);

    // the turntable: a disc of glass on a steel bearing
    const rs = R * 0.68;
    const hub = new THREE.Mesh(
      axisZ(new THREE.CylinderGeometry(rs * 0.14, rs * 0.16, 5, 48)),
      mat("#c4c7cc", { metalness: 0.3, roughness: 0.4, envMap: env })
    );
    hub.position.z = 2.5;
    const susan = new THREE.Group();
    susan.position.z = 7;
    const glass = new THREE.Mesh(
      axisZ(new THREE.CylinderGeometry(rs, rs, 5, 128)),
      mat("#ffffff", { roughness: 0.04, transparent: true, opacity: 0.2, envMap: env, envMapIntensity: 1.5, depthWrite: false })
    );
    glass.userData.noCast = true;
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(rs, 2.5, 8, 160),
      mat("#dde7e8", { roughness: 0.08, transparent: true, opacity: 0.55, envMap: env, envMapIntensity: 1.6 })
    );
    lip.userData.noCast = true;
    susan.add(glass, lip);
    root.add(hub, susan);

    // plates, as large as fit side by side on the turntable
    const pr = m === 1 ? rs * 0.5 : m === 2 ? rs * 0.4 : Math.min(rs * 0.36, rs * Math.sin(Math.PI / m) * 0.62);
    const rp = m === 1 ? 0 : rs - pr - R * 0.03;
    const plateGeo = plateGeometry(pr);
    const porcelain = mat("#f6f4ef", { roughness: 0.2, envMap: env, envMapIntensity: 0.7, side: THREE.DoubleSide });
    const dishGeo = new THREE.CircleGeometry(pr * 0.6, 72);
    const plates = [];
    for (let j = 0; j < m; j++) {
      const a = (j * TAU) / m;
      const p = new THREE.Group();
      p.position.set(rp * Math.sin(a), -rp * Math.cos(a), 2.5);
      p.rotation.z = a; // upright when it has been turned to the front
      const dish = photoSurface(dishGeo, 1, kick);
      dish.position.z = pr * 0.052 + 0.3;
      p.add(new THREE.Mesh(plateGeo, porcelain), dish);
      p.dish = dish;
      p.lift = j === 0 ? 1 : 0;
      p.userData.j = j;
      susan.add(p);
      plates.push(p);
    }

    // the rest of the setting, round the edge of the table
    const metal = mat("#d6d8dc", { metalness: 1, roughness: 0.24, envMap: env, envMapIntensity: 1 });
    const ring = (rs + R) / 2;
    const set = (obj, phi, turn) => {
      obj.position.set(ring * Math.sin(phi), -ring * Math.cos(phi), 0.1);
      obj.rotation.z = phi + turn;
      root.add(obj);
    };
    set(fork(R * 0.5, metal), -30 * DEG, Math.PI / 2);
    set(knife(R * 0.5, metal), 30 * DEG, -Math.PI / 2);
    set(chopsticks(R * 0.66, env), 72 * DEG, -Math.PI / 2);
    set(bowl(R * 0.085, 7, "#2a1407", env), -70 * DEG, 0);
    set(bowl(R * 0.07, 16, "#a36b22", env), -144 * DEG, 0);
    set(bowl(R * 0.07, 16, "#a36b22", env), 142 * DEG, 0);

    const st = { from: 0, to: 0, t0: -1e9, front: 0 };
    let fills = [];
    return {
      root,
      susan,
      plates,
      fill(next) {
        next.forEach((fi, j) => {
          if (plates[j] && fills[j] !== fi) plates[j].dish.show(imgFor(fi));
        });
        fills = next.slice();
      },
      setTurn(deg, front, now) {
        st.from = susan.rotation.z;
        st.to = -deg * DEG;
        st.t0 = now;
        st.front = front;
      },
      update(now) {
        const u = REDUCED ? 1 : clamp((now - st.t0) / 850, 0, 1);
        susan.rotation.z = lerp(st.from, st.to, inOut(u));
        let moving = u < 1;
        for (const p of plates) {
          const want = p.userData.j === st.front ? 1 : 0;
          p.lift += (want - p.lift) * (REDUCED ? 1 : 0.12);
          if (Math.abs(want - p.lift) > 0.004) moving = true;
          p.position.z = 2.5 + p.lift * 3;
          p.scale.setScalar(1 + p.lift * 0.06);
        }
        return moving;
      },
    };
  }

  /* ---------- landscape: the camera ---------- */
  // a rangefinder camera of width W lying on its front, its back (and the window with the view) facing up
  function finderModel({ W, env, imgFor, kick }) {
    const root = new THREE.Group();
    const cam = new THREE.Group();
    cam.scale.setScalar(W / 560);
    root.add(cam);
    const H = 440;
    const D = 78;
    const TOP = 64;
    const leather = mat("#1e1f23", { roughness: 0.86, bumpMap: tile(256, pebble, 1 / 44), bumpScale: 0.9, envMap: env, envMapIntensity: 0.3 });
    const chrome = mat("#d4d6db", { metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 1.05 });
    const knurl = tile(
      32,
      (x, n) => {
        x.fillStyle = "#fff";
        x.fillRect(0, 0, n, n);
        x.fillStyle = "#000";
        x.fillRect(0, 0, n / 2, n);
      },
      64,
      1
    );
    const knurled = mat("#d4d6db", { metalness: 1, roughness: 0.34, envMap: env, envMapIntensity: 1, bumpMap: knurl, bumpScale: 1.2 });
    const black = mat("#111214", { roughness: 0.32, metalness: 0.25, envMap: env, envMapIntensity: 0.8 });
    const lower = new THREE.Mesh(slab(560, H - TOP, D, [0, 0, 36, 36], 4), leather);
    lower.position.y = -TOP / 2;
    const upper = new THREE.Mesh(slab(560, TOP, D + 2, [36, 36, 0, 0], 4), chrome);
    upper.position.set(0, (H - TOP) / 2, -1);
    cam.add(lower, upper);

    // the window: a black bezel round the view
    const GW = 496;
    const GH = 310;
    const GY = -12;
    const bezel = new THREE.Mesh(slab(GW + 22, GH + 22, 6, 14, 1.5, rr(GW, GH, 5)), black);
    bezel.position.set(0, GY, D - 2);
    const photo = photoSurface(new THREE.PlaneGeometry(GW, GH), GW / GH, kick);
    photo.position.set(0, GY, D + 0.3);
    photo.userData.j = 0;
    cam.add(bezel, photo);
    // bright frame lines at the corners
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    const fx = GW * 0.43;
    const fy = GH * 0.4;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const a = new THREE.Mesh(new THREE.PlaneGeometry(26, 1.6), lineMat);
        a.position.set(sx * (fx - 13), GY + sy * fy, D + 0.8);
        const b = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 26), lineMat);
        b.position.set(sx * fx, GY + sy * (fy - 13), D + 0.8);
        a.userData.noCast = b.userData.noCast = true;
        cam.add(a, b);
      }
    // the shutter: two blinds that meet in the middle
    const bladeMat = mat("#1a1b1f", { metalness: 0.55, roughness: 0.4, envMap: env, envMapIntensity: 0.6 });
    const bh = GH / 2 + 1;
    const gT = new THREE.BoxGeometry(GW, bh, 1).translate(0, -bh / 2, 0);
    const gB = new THREE.BoxGeometry(GW, bh, 1).translate(0, bh / 2, 0);
    const bladeT = new THREE.Mesh(gT, bladeMat);
    bladeT.position.set(0, GY + GH / 2, D + 1.6);
    const bladeB = new THREE.Mesh(gB, bladeMat);
    bladeB.position.set(0, GY - GH / 2, D + 1.6);
    cam.add(bladeT, bladeB);
    const blades = (v) => {
      const s = Math.max(0.001, v);
      bladeT.scale.y = bladeB.scale.y = s;
      bladeT.visible = bladeB.visible = v > 0.002;
    };
    blades(0);

    // on the top edge: rewind knob, accessory shoe, speed dial, release and the wind lever round it
    const yTop = H / 2;
    const knob = (r, h, m, x, y) => {
      const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), m);
      o.position.set(x, y, D * 0.5);
      cam.add(o);
      return o;
    };
    knob(24, 14, knurled, -196, yTop + 7).material = [knurled, chrome, chrome];
    knob(15, 9, chrome, -196, yTop + 18);
    const shoe = new THREE.Mesh(slab(58, 8, 44, 3, 1), chrome);
    shoe.position.set(-12, yTop + 4, D * 0.5 - 22);
    cam.add(shoe);
    knob(30, 16, knurled, 112, yTop + 8).material = [knurled, chrome, chrome];
    knob(9, 12, chrome, 196, yTop + 6);
    const lever = new THREE.Group();
    lever.position.set(196, yTop + 14, D * 0.5);
    // a flat blade, rounded at the ends, lying over the top plate
    const arm = new THREE.Mesh(
      slab(86, 12, 5, 6, 1)
        .rotateX(-Math.PI / 2)
        .translate(-43, -2.5, 0),
      chrome
    );
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 9, 24), black);
    thumb.position.set(-84, 3, 0);
    lever.add(arm, thumb);
    cam.add(lever);
    // strap lugs
    for (const sx of [-1, 1]) {
      const lug = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 12, 20).rotateZ(Math.PI / 2), chrome);
      lug.position.set(sx * 284, 130, D * 0.5);
      cam.add(lug);
    }
    // on the back of the top plate: eyepiece, frame counter, the name
    const eye = new THREE.Mesh(slab(46, 34, 7, 9, 2), black);
    eye.position.set(-186, 188, D);
    const eyeGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 20),
      mat("#07090c", { roughness: 0.04, metalness: 0.4, envMap: env, envMapIntensity: 1.6 })
    );
    eyeGlass.position.set(-186, 188, D + 7.1);
    eyeGlass.userData.noCast = true;
    const ctr = K.makeCanvas(96, 96);
    const ctrTex = K.texture(ctr);
    const ctrFace = new THREE.Mesh(new THREE.CircleGeometry(12, 40), new THREE.MeshBasicMaterial({ map: ctrTex }));
    ctrFace.position.set(112, 188, D + 1.7);
    ctrFace.userData.noCast = true;
    const ctrRing = new THREE.Mesh(new THREE.TorusGeometry(13.5, 1.6, 10, 40), chrome);
    ctrRing.position.set(112, 188, D + 1.4);
    const name = label("RW · 35 mm", { h: 15, font: "600 {px} 'DM Mono', ui-monospace, monospace", color: "rgba(36,38,44,0.82)" });
    name.position.set(-30, 188, D + 1.15);
    cam.add(eye, eyeGlass, ctrFace, ctrRing, name);
    const paintCounter = (no) => {
      const x = ctr.getContext("2d");
      x.fillStyle = "#101114";
      x.fillRect(0, 0, 96, 96);
      x.fillStyle = "#f2efe6";
      x.font = "500 46px 'DM Mono', ui-monospace, monospace";
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText(String(no).padStart(2, "0"), 48, 51);
      ctrTex.needsUpdate = true;
    };
    // the light meter in the bottom band: a scale and a needle that settles
    const meterWin = new THREE.Mesh(slab(132, 26, 4, 5, 1), black);
    meterWin.position.set(-150, -197, D - 1);
    const sc = K.makeCanvas(256, 48);
    {
      const x = sc.getContext("2d");
      x.fillStyle = "#0e0f12";
      x.fillRect(0, 0, 256, 48);
      x.fillStyle = "#e9e5da";
      for (let i = 0; i <= 20; i++) x.fillRect(24 + i * 10.4, i % 5 ? 30 : 22, 1.6, i % 5 ? 10 : 18);
      x.font = "600 18px 'DM Mono', monospace";
      x.textAlign = "center";
      x.fillText("−", 24, 16);
      x.fillText("+", 232, 16);
      x.fillStyle = "#e0452a";
      x.beginPath();
      x.arc(128, 10, 4, 0, TAU);
      x.fill();
    }
    const scaleFace = new THREE.Mesh(new THREE.PlaneGeometry(120, 22), new THREE.MeshBasicMaterial({ map: K.texture(sc) }));
    scaleFace.position.set(-150, -197, D + 3.1);
    scaleFace.userData.noCast = true;
    const needle = new THREE.Mesh(new THREE.BoxGeometry(1.4, 17, 0.6).translate(0, 8.5, 0), new THREE.MeshBasicMaterial({ color: 0xe0452a }));
    needle.position.set(-150, -208, D + 3.6);
    needle.userData.noCast = true;
    cam.add(meterWin, scaleFace, needle);

    const st = { shut: -1e9, needle: 0, needleTo: 0 };
    return {
      root,
      photo,
      blades,
      lever,
      counter: paintCounter,
      show(i) {
        photo.show(imgFor(i));
        paintCounter(i + 1);
        st.needleTo = (((i * 37) % 70) - 35) * DEG;
      },
      shutter(now) {
        st.shut = now;
      },
      // the shutter closes in 170 ms and is open again by 300; the lever swings out and back until 640
      update(now) {
        const t = now - st.shut;
        let b = 0;
        let wind = 0;
        if (t >= 0 && t < 700) {
          b = t < 170 ? inOut(t / 170) : t < 300 ? 1 - inOut((t - 170) / 130) : 0;
          wind = t >= 170 && t < 640 ? Math.sin(((t - 170) / 470) * Math.PI) : 0;
        }
        blades(b);
        lever.rotation.y = (10 + 78 * wind) * DEG;
        st.needle += (st.needleTo - st.needle) * (REDUCED ? 1 : 0.14);
        needle.rotation.z = -st.needle;
        return (t >= 0 && t < 700) || Math.abs(st.needleTo - st.needle) > 0.002;
      },
    };
  }

  /* ---------- people: the projector ---------- */
  const BEAM_V =
    "attribute float a;\nvarying float vA;\nvoid main() {\n\tvA = a;\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}";
  const BEAM_F = "uniform vec3 uC;\nuniform float uO;\nvarying float vA;\nvoid main() {\n\tgl_FragColor = vec4( uC, uO * pow( vA, 1.8 ) );\n}";
  // a room PW wide: a screen on the wall, a carousel projector on the floor throwing the photograph on it
  function projectorModel({ PW, env, imgFor, kick }) {
    const k = PW / 580;
    const root = new THREE.Group();
    const room = new THREE.Group();
    room.scale.setScalar(k);
    root.add(room);
    const steel = mat("#3a3c41", { metalness: 0.6, roughness: 0.35, envMap: env, envMapIntensity: 0.8 });

    // the screen
    const SW = 560;
    const SH = 350;
    const SY = 70;
    const SZ = -150;
    const screen = new THREE.Group();
    screen.position.set(0, SY, SZ);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), mat("#f2f1ec", { roughness: 0.95 }));
    const border = new THREE.Mesh(new THREE.PlaneGeometry(SW + 14, SH + 14), mat("#16171a", { roughness: 0.8 }));
    border.position.z = -0.6;
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, SW + 40, 32).rotateZ(Math.PI / 2), steel);
    roller.position.set(0, SH / 2 + 17, 2);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, SW + 10, 16).rotateZ(Math.PI / 2), steel);
    bar.position.set(0, -SH / 2 - 9, 1.5);
    screen.add(border, cloth, roller, bar);
    // the screen hangs on the wall: it throws no shadow on the floor in front of it
    for (const o of [border, cloth, roller, bar]) o.userData.noCast = true;
    room.add(screen);
    // the picture: drawn last and over everything, so the beam never lies across it
    const MW = SW - 40;
    const MH = SH - 34;
    const pic = { w: MW, h: MW / 1.5 };
    const photo = photoSurface(new THREE.PlaneGeometry(1, 1), 0, kick, (r) => fit(r));
    photo.material.transparent = true;
    photo.material.depthTest = false;
    photo.renderOrder = 10;
    photo.position.z = 0.5;
    photo.userData.j = 0;
    screen.add(photo);

    // the projector
    const proj = new THREE.Group();
    proj.position.set(176, -214, 116);
    proj.rotation.y = 26 * DEG; // its lens on the middle of the screen
    room.add(proj);
    const plastic = mat("#c9c2b3", { roughness: 0.48, envMap: env, envMapIntensity: 0.45 });
    const dark = mat("#2a2a2d", { roughness: 0.42, envMap: env, envMapIntensity: 0.5, side: THREE.DoubleSide });
    const chrome = mat("#cfd1d6", { metalness: 1, roughness: 0.3, envMap: env });
    const BW = 210;
    const BH = 74;
    const BD = 160;
    const body = new THREE.Mesh(slab(BW, BH, BD, 12, 4), plastic);
    body.position.set(0, BH / 2 + 8, -BD / 2);
    proj.add(body);
    for (const [fx, fz] of [
      [-80, 58],
      [80, 58],
      [0, -62],
    ]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 8, 20), dark);
      foot.position.set(fx, 4, fz);
      proj.add(foot);
    }
    // the carousel tray: a ring of forty slots, every one but the gate holding a slide
    const tray = new THREE.Group();
    tray.position.y = BH + 8;
    const ringPts = [
      [30, 0],
      [96, 0],
      [98, 2],
      [98, 24],
      [95, 27],
      [33, 27],
      [30, 24],
      [30, 0],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    tray.add(new THREE.Mesh(new THREE.LatheGeometry(ringPts, 96), dark));
    const slides = new THREE.InstancedMesh(new THREE.BoxGeometry(26, 22, 2.4), mat("#ece8de", { roughness: 0.6 }), 39);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    for (let s = 0, n = 0; s < 40; s++) {
      if (s === 30) continue; // the gate, over the lens
      const a = (s / 40) * TAU;
      e.set(0, -a, 0);
      q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(64 * Math.cos(a), 21, 64 * Math.sin(a)), q, one);
      slides.setMatrixAt(n++, mtx);
    }
    tray.add(slides);
    const hubC = new THREE.Mesh(new THREE.CylinderGeometry(27, 29, 30, 40), dark);
    hubC.position.y = 15;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(15, 16, 6, 40), chrome);
    cap.position.y = 33;
    tray.add(hubC, cap);
    proj.add(tray);
    // lens, knobs, the grille and switch on the back
    const lensY = BH / 2 + 14;
    const barrel = new THREE.Mesh(axisZ(new THREE.CylinderGeometry(19, 19, 60, 40)), dark);
    barrel.position.set(0, lensY, -BD / 2 - 30);
    const lensRing = new THREE.Mesh(axisZ(new THREE.CylinderGeometry(21, 21, 8, 40)), chrome);
    lensRing.position.set(0, lensY, -BD / 2 - 58);
    const focus = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 10, 28).rotateZ(Math.PI / 2), dark);
    focus.position.set(BW / 2 + 5, 46, -40);
    const gc = K.makeCanvas(256, 64);
    {
      const x = gc.getContext("2d");
      x.fillStyle = "#cfc8b9";
      x.fillRect(0, 0, 256, 64);
      x.fillStyle = "#3b3936";
      for (let i = 0; i < 14; i++) x.fillRect(10 + i * 17.6, 10, 9, 44);
    }
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(150, 36), mat("#ffffff", { map: K.texture(gc), roughness: 0.7 }));
    grille.position.set(-12, 44, BD / 2 + 0.4);
    grille.userData.noCast = true;
    const sw = new THREE.Mesh(slab(14, 9, 6, 2, 1), mat("#b3322a", { roughness: 0.4 }));
    sw.position.set(78, 44, BD / 2);
    proj.add(barrel, lensRing, focus, grille, sw);

    // the beam: light from the lens to the picture, strongest at the lens and gone well before the screen
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    beamGeo.setAttribute("a", new THREE.BufferAttribute(new Float32Array(24), 1));
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(1, 0.88, 0.66) }, uO: { value: 0.26 } },
      vertexShader: BEAM_V,
      fragmentShader: BEAM_F,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.renderOrder = 5;
    beam.userData.noCast = true;
    beam.userData.noReceive = true;
    beam.frustumCulled = false;
    room.add(beam);
    const tip = new THREE.Vector3(0, lensY, -BD / 2 - 62).applyAxisAngle(new THREE.Vector3(0, 1, 0), proj.rotation.y).add(proj.position);
    function fit(r) {
      pic.w = MW;
      pic.h = MW / r;
      if (pic.h > MH) {
        pic.h = MH;
        pic.w = MH * r;
      }
      photo.scale.set(pic.w, pic.h, 1);
      const near = [
        [-11, -11],
        [11, -11],
        [11, 11],
        [-11, 11],
      ].map(([x, y]) => [tip.x + x, tip.y + y, tip.z]);
      const far = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => [(x * pic.w) / 2, SY + (y * pic.h) / 2, SZ + 0.4]);
      const p = beamGeo.attributes.position;
      const a = beamGeo.attributes.a;
      let v = 0;
      const put = (xyz, al) => {
        p.setXYZ(v, xyz[0], xyz[1], xyz[2]);
        a.setX(v++, al);
      };
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        put(near[i], 1);
        put(near[j], 1);
        put(far[j], 0);
        put(near[i], 1);
        put(far[j], 0);
        put(far[i], 0);
      }
      p.needsUpdate = true;
      a.needsUpdate = true;
    }
    fit(1.5);

    const st = { trayFrom: 0, trayTo: 0, trayT: -1e9, outT: -1e9, inT: -1e9, dir: 1 };
    return {
      root,
      room,
      tray,
      beam,
      photo,
      floorY: -214 * k,
      show(i, now, animate) {
        photo.show(imgFor(i));
        if (animate) st.inT = now;
        else st.outT = st.inT = -1e9;
      },
      // the slide drops out and the tray clicks round; show() brings the next one in
      change(d, now) {
        st.trayFrom = tray.rotation.y;
        st.trayTo -= d * 9 * DEG;
        st.trayT = now;
        st.outT = now;
        st.dir = d;
      },
      update(now) {
        const ut = REDUCED ? 1 : clamp((now - st.trayT) / 300, 0, 1);
        tray.rotation.y = lerp(st.trayFrom, st.trayTo, inOut(ut));
        let o = 1;
        let dx = 0;
        let moving = ut < 1;
        if (st.outT > st.inT) {
          const u = clamp((now - st.outT) / 190, 0, 1);
          o = 1 - u;
          dx = -st.dir * 26 * u;
          moving = true;
        } else if (now - st.inT < 300) {
          const u = clamp((now - st.inT) / 280, 0, 1);
          o = u;
          dx = st.dir * 26 * (1 - outCubic(u));
          moving = true;
        }
        photo.material.opacity = o;
        photo.position.x = dx;
        beamMat.uniforms.uO.value = 0.26 * (0.3 + 0.7 * o);
        return moving;
      },
    };
  }

  /* ---------- animals: the notebook ---------- */
  // a field notebook NW wide lying open on the desk; pages are canvases (paper, notes, the taped print) drawn unlit
  function notebookModel({ NW, env, theme, c, imgFor, text, kick, S = 2.4 }) {
    const root = new THREE.Group();
    const book = new THREE.Group();
    book.scale.setScalar(NW / 600);
    root.add(book);
    const PW = 284;
    const PH = 405;
    const CW = 298;
    const CH = 423;
    // the surface of the pages: down into the fold at the spine, up over the first few millimetres, then nearly flat
    const zAt = (u) => 4.2 + 9 * (1 - Math.pow(1 - Math.min(u / 34, 1), 2)) - 1.4 * (u / PW);

    const cloth = mat("#3e4d3b", { roughness: 0.92, bumpMap: tile(64, linen, 1 / 9), bumpScale: 0.5, envMap: env, envMapIntensity: 0.2 });
    const coverL = new THREE.Mesh(slab(CW, CH, 3, [9, 0, 0, 9], 0.8), cloth);
    coverL.position.x = -CW / 2 - 1;
    const coverR = new THREE.Mesh(slab(CW, CH, 3, [0, 9, 9, 0], 0.8), cloth);
    coverR.position.x = CW / 2 + 1;
    const spine = new THREE.Mesh(new THREE.BoxGeometry(6, CH, 2.4), cloth);
    spine.position.z = 1.2;
    book.add(coverL, coverR, spine);
    // the blocks of pages, their tops following zAt
    const paperEdge = mat("#ece5d2", { roughness: 0.92, side: THREE.DoubleSide });
    const blockGeo = (sign) => {
      const s = new THREE.Shape();
      s.moveTo(0, 3);
      s.lineTo(PW, 3);
      for (let i = 24; i >= 0; i--) {
        const u = (i / 24) * PW;
        s.lineTo(u, zAt(u) - 0.2);
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: PH, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(Math.PI / 2);
      g.translate(0, PH / 2, 0);
      if (sign < 0) g.scale(-1, 1, 1);
      return g;
    };
    book.add(new THREE.Mesh(blockGeo(1), paperEdge), new THREE.Mesh(blockGeo(-1), paperEdge));
    const pageGeo = (sign) => {
      const g = new THREE.PlaneGeometry(PW, PH, 28, 1);
      const p = g.attributes.position;
      const uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) + PW / 2;
        p.setXYZ(i, sign * u, p.getY(i), zAt(u) + 0.05);
        if (sign < 0) uv.setX(i, 1 - uv.getX(i));
      }
      g.computeVertexNormals();
      return g;
    };
    const W = Math.round(PW * S);
    const H = Math.round(PH * S);
    const canvases = { left: K.makeCanvas(W, H), right: K.makeCanvas(W, H), front: K.makeCanvas(W, H), back: K.makeCanvas(W, H) };
    const tex = {};
    for (const n in canvases) tex[n] = K.texture(canvases[n]);
    tex.back.wrapS = THREE.RepeatWrapping;
    tex.back.repeat.x = -1;
    tex.back.offset.x = 1;
    const pageL = new THREE.Mesh(pageGeo(-1), K.photoMaterial(tex.left, { side: THREE.DoubleSide }));
    const pageR = new THREE.Mesh(pageGeo(1), K.photoMaterial(tex.right, { side: THREE.DoubleSide }));
    pageL.userData.noCast = pageR.userData.noCast = true;
    pageR.userData.j = 0;
    book.add(pageL, pageR);
    // shadows (of the pencil, of a turning leaf) fall on the pages through transparent copies of them
    const catchers = [K.shadowCatcher(pageL.geometry, theme), K.shadowCatcher(pageR.geometry, theme)];
    book.add(...catchers);

    // the leaf that turns: front and back share one surface, bent every frame
    const leafGeo = new THREE.PlaneGeometry(PW, PH, 30, 1);
    const leafF = new THREE.Mesh(leafGeo, K.photoMaterial(tex.front, { bend: 0.35, side: THREE.FrontSide }));
    const leafB = new THREE.Mesh(leafGeo, K.photoMaterial(tex.back, { bend: 0.35, side: THREE.BackSide }));
    leafF.userData.noReceive = leafB.userData.noReceive = true;
    const leaf = new THREE.Group();
    leaf.add(leafF, leafB);
    leaf.visible = false;
    book.add(leaf);
    const pts = Array.from({ length: 31 }, () => [0, 0]);
    // theta 0: lying on the right; π: on the left. The free edge lags behind (curl), and near either end the leaf
    // settles into the shape of the page it lands on.
    function bendLeaf(theta, dir) {
      const curl = -dir * 0.9 * Math.sin(theta);
      const du = PW / 30;
      let px = 0;
      let pz = zAt(0) + 0.4;
      pts[0] = [px, pz];
      for (let i = 1; i <= 30; i++) {
        const u = i / 30;
        const phi = theta + curl * u * u;
        px += Math.cos(phi) * du;
        pz += Math.sin(phi) * du;
        pts[i] = [px, pz];
      }
      const wR = clamp(1 - theta / 0.35, 0, 1);
      const wL = clamp(1 - (Math.PI - theta) / 0.35, 0, 1);
      const p = leafGeo.attributes.position;
      for (let i = 0; i <= 30; i++) {
        const u = (i / 30) * PW;
        let [x, z] = pts[i];
        if (wR) {
          x = lerp(x, u, wR);
          z = lerp(z, zAt(u) + 0.4, wR);
        }
        if (wL) {
          x = lerp(x, -u, wL);
          z = lerp(z, zAt(u) + 0.4, wL);
        }
        p.setXYZ(i, x, PH / 2, z);
        p.setXYZ(i + 31, x, -PH / 2, z);
      }
      p.needsUpdate = true;
      leafGeo.computeVertexNormals();
      leafGeo.computeBoundingSphere();
    }

    // a pencil, an elastic band and a ribbon
    const pencil = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.2, 150, 6),
      mat("#e3b23c", { roughness: 0.42, envMap: env, envMapIntensity: 0.45 })
    );
    shaft.rotation.y = Math.PI / 6;
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 12, 24), mat("#c9b27a", { metalness: 1, roughness: 0.32, envMap: env }));
    ferrule.position.y = -81;
    const eraser = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 10, 24), mat("#d9867f", { roughness: 0.85 }));
    eraser.position.y = -92;
    const wood = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 5.2, 18, 24), mat("#e2c495", { roughness: 0.8 }));
    wood.position.y = 84;
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 1.6, 4.6, 12), mat("#2b2b2e", { roughness: 0.4, metalness: 0.3 }));
    lead.position.y = 95.3;
    pencil.add(shaft, ferrule, eraser, wood, lead);
    pencil.position.set(CW + 44, -26, 5.4);
    pencil.rotation.z = 10 * DEG;
    const band = new THREE.Mesh(new THREE.BoxGeometry(5, CH + 2, 1.6), mat("#1e221f", { roughness: 0.7 }));
    band.position.set(CW - 6, 0, 3.8);
    const ribbonMat = mat("#8b2d28", { roughness: 0.66, side: THREE.DoubleSide });
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(6, PH * 0.9), ribbonMat);
    ribbon.position.set(6, -PH * 0.05, zAt(9) + 0.6);
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(6, 40), ribbonMat);
    tail.position.set(8, -PH / 2 - 16, 4);
    tail.rotation.x = 0.32;
    book.add(pencil, band, ribbon, tail);

    /* the pages */
    function paper(x, spineLeft) {
      const w = x.canvas.width;
      const h = x.canvas.height;
      x.fillStyle = "#f4eedd";
      x.fillRect(0, 0, w, h);
      x.strokeStyle = "rgba(70,110,140,0.15)";
      x.lineWidth = Math.max(1, S * 0.5);
      const sq = 13 * S;
      for (let gx = sq; gx < w; gx += sq) {
        x.beginPath();
        x.moveTo(gx, 0);
        x.lineTo(gx, h);
        x.stroke();
      }
      for (let gy = sq; gy < h; gy += sq) {
        x.beginPath();
        x.moveTo(0, gy);
        x.lineTo(w, gy);
        x.stroke();
      }
      const g = x.createLinearGradient(spineLeft ? 0 : w, 0, spineLeft ? 36 * S : w - 36 * S, 0);
      g.addColorStop(0, "rgba(60,45,20,0.2)");
      g.addColorStop(1, "rgba(60,45,20,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }
    const hand = (px, weight = 500) => `${weight} ${px * S}px Caveat, "Segoe Script", "Bradley Hand", cursive`;
    function drawNotes(cv, fi) {
      const x = cv.getContext("2d");
      paper(x, false);
      const t = text(fi);
      const L = 30 * S;
      const maxW = cv.width - L - 30 * S;
      let y = 62 * S;
      x.fillStyle = "#283754";
      x.textBaseline = "alphabetic";
      x.font = hand(30, 700);
      x.fillText(t.no, L, y);
      x.fillRect(L, y + 8 * S, x.measureText(t.no).width, 1.2 * S);
      y += 50 * S;
      x.font = hand(33);
      for (const line of K.wrapText(x, t.what, maxW).slice(0, 5)) {
        x.fillText(line, L, y);
        y += 33 * S;
      }
      y += 10 * S;
      x.font = hand(25);
      for (const s of [t.place, t.line])
        if (s)
          for (const line of K.wrapText(x, s, maxW).slice(0, 2)) {
            x.fillText(line, L, y);
            y += 27 * S;
          }
      if (t.small) {
        x.font = `400 ${12 * S}px "DM Mono", ui-monospace, monospace`;
        x.fillText(t.small, L, y + 10 * S);
      }
    }
    function tape(x, cx, cy, deg) {
      x.save();
      x.translate(cx, cy);
      x.rotate(deg * DEG);
      const tw = 62 * S;
      const th = 19 * S;
      x.fillStyle = "rgba(234,225,193,0.8)";
      x.beginPath();
      x.moveTo(-tw / 2, -th / 2);
      x.lineTo(tw / 2, -th / 2);
      for (let q = 1; q <= 4; q++) x.lineTo(tw / 2 + (q % 2 ? -2.2 * S : 0), -th / 2 + (th * q) / 4);
      x.lineTo(-tw / 2, th / 2);
      for (let q = 3; q >= 0; q--) x.lineTo(-tw / 2 + (q % 2 ? 2.2 * S : 0), -th / 2 + (th * q) / 4);
      x.closePath();
      x.fill();
      x.restore();
    }
    function drawTaped(cv, fi) {
      const x = cv.getContext("2d");
      paper(x, true);
      const img = imgFor(fi);
      const ok = K.loaded(img);
      const r = ok ? img.naturalWidth / img.naturalHeight : c.photos[fi].ratio || 1.5;
      let pw = 222 * S;
      let ph = pw / r;
      if (ph > 292 * S) {
        ph = 292 * S;
        pw = ph * r;
      }
      const b = 7 * S;
      x.save();
      x.translate(cv.width / 2 + 6 * S, cv.height / 2 - 4 * S);
      x.rotate(((((fi * 53) % 7) - 3) * 0.7 * Math.PI) / 180);
      x.shadowColor = "rgba(40,30,10,0.3)";
      x.shadowBlur = 10 * S;
      x.shadowOffsetY = 3 * S;
      x.fillStyle = "#fbfaf6";
      x.fillRect(-pw / 2 - b, -ph / 2 - b, pw + b * 2, ph + b * 2);
      x.shadowColor = "rgba(0,0,0,0)";
      if (ok) K.cover(x, img, -pw / 2, -ph / 2, pw, ph);
      else {
        x.fillStyle = "#d9d6cf";
        x.fillRect(-pw / 2, -ph / 2, pw, ph);
      }
      tape(x, -pw / 2 - b + 5 * S, -ph / 2 - b + 5 * S, -38);
      tape(x, pw / 2 + b - 5 * S, ph / 2 + b - 5 * S, -38);
      x.restore();
    }
    // what each canvas shows, so it can be painted again when a photograph or the handwriting font arrives
    const shows = {};
    const paint = (n, kind, fi) => {
      shows[n] = [kind, fi];
      (kind === "notes" ? drawNotes : drawTaped)(canvases[n], fi);
      tex[n].needsUpdate = true;
      if (kind === "taped") {
        const img = imgFor(fi);
        if (!K.loaded(img))
          img.addEventListener(
            "load",
            () => {
              if (shows[n] && shows[n][0] === "taped" && shows[n][1] === fi) paint(n, "taped", fi);
              if (kick) kick();
            },
            { once: true }
          );
      }
    };
    const repaint = () => {
      for (const n in shows) paint(n, ...shows[n]);
      if (kick) kick();
    };
    if (document.fonts && document.fonts.load) document.fonts.load(hand(30)).then(repaint, () => {});

    const st = { t0: -1e9, dir: 1, on: false };
    return {
      root,
      pageR,
      pages(leftFi, rightFi) {
        paint("left", "notes", leftFi);
        paint("right", "taped", rightFi);
      },
      // one leaf goes over: forward it carries the print `frontFi` away and brings the notes `backFi`
      turn(d, frontFi, backFi, now) {
        paint("front", "taped", frontFi);
        paint("back", "notes", backFi);
        st.t0 = now;
        st.dir = d;
        st.on = true;
        leaf.visible = true;
        bendLeaf(d > 0 ? 0 : Math.PI, d);
      },
      // a leaf held up at angle theta (the grid's hover)
      hold(theta, frontFi, backFi) {
        if (!shows.front || shows.front[1] !== frontFi) paint("front", "taped", frontFi);
        if (!shows.back || shows.back[1] !== backFi) paint("back", "notes", backFi);
        leaf.visible = theta > 0.01;
        if (leaf.visible) bendLeaf(theta, 1);
      },
      setTheme(next) {
        for (const m of catchers) m.material.opacity = next === "dark" ? 0.5 : 0.38;
      },
      refresh: repaint,
      update(now) {
        if (!st.on) return false;
        const u = REDUCED ? 1 : clamp((now - st.t0) / 760, 0, 1);
        const e = inOut(u);
        bendLeaf(st.dir > 0 ? Math.PI * e : Math.PI * (1 - e), st.dir);
        if (u >= 1) {
          st.on = false;
          leaf.visible = false;
        }
        return true;
      },
    };
  }

  /* ---------- the opened subjects ---------- */
  function table({ stage, c, m, imgFor, theme, size, onPick }) {
    const base = K.viewerBase(stage, theme, { x: 0.22, y: 0.16 });
    base.state.tiltX = 5;
    base.state.tiltY = 4;
    base.pose.rotation.set(-47 * DEG, 0, 6 * DEG);
    const R = Math.max(120, size() * 0.43);
    const t = tableModel({ R, m, env: base.env, imgFor, kick: base.kick });
    castShadows(t.root);
    base.tilt.add(t.root);
    base.desk.position.z = -R * 0.62;
    a11y(base, "table", `A table with ${c.photos.length} dishes. The arrow keys turn it; Enter opens the dish in front.`);
    clickable(
      base,
      () => t.plates,
      (o) => onPick(o.userData.j)
    );
    base.setFrame((now) => t.update(now));
    return {
      el: base.canvas,
      paint(turn, front, fills) {
        t.fill(fills);
        t.setTurn(turn, front, performance.now());
        base.kick();
      },
      setTheme: base.setTheme,
      destroy: base.destroy,
    };
  }
  function finder({ stage, c, imgFor, theme, size, onFull }) {
    const base = K.viewerBase(stage, theme, { x: 0.22, y: 0.16 });
    base.state.tiltX = 6;
    base.state.tiltY = 5;
    base.pose.rotation.set(-8 * DEG, -13 * DEG, 1.5 * DEG);
    const f = finderModel({ W: Math.max(240, size() * 0.86), env: base.env, imgFor, kick: base.kick });
    castShadows(f.root);
    f.root.position.y = -10;
    base.tilt.add(f.root);
    base.desk.position.z = -1;
    a11y(
      base,
      "camera",
      `A camera's viewfinder showing ${c.photos.length} landscapes. The arrow keys move through them; Enter opens this one full size.`
    );
    clickable(base, () => [f.photo], onFull);
    base.setFrame((now) => f.update(now));
    return {
      el: base.canvas,
      show(i) {
        f.show(i);
        base.kick();
      },
      shutter() {
        f.shutter(performance.now());
        base.kick();
      },
      setTheme: base.setTheme,
      destroy: base.destroy,
    };
  }
  function projector({ stage, c, imgFor, theme, size, onFull }) {
    const base = K.viewerBase(stage, theme, { x: 0.22, y: 0.16 });
    base.state.tiltX = 5;
    base.state.tiltY = 4;
    base.pose.rotation.set(9 * DEG, -14 * DEG, 0); // seen from a little above, so the tray on top shows
    const p = projectorModel({ PW: Math.max(260, size() * 0.8), env: base.env, imgFor, kick: base.kick });
    p.root.position.y = 12;
    castShadows(p.root);
    base.tilt.add(p.root);
    // the desk becomes the floor the projector stands on
    base.desk.rotation.x = -Math.PI / 2;
    base.desk.position.set(0, p.floorY + p.root.position.y, 0);
    a11y(base, "slide projector", `A slide show of ${c.photos.length} photographs. The arrow keys change the slide; Enter opens this one full size.`);
    clickable(base, () => [p.photo], onFull);
    base.setFrame((now) => p.update(now));
    return {
      el: base.canvas,
      show(i, animate) {
        p.show(i, performance.now(), animate);
        base.kick();
      },
      change(d) {
        p.change(d, performance.now());
        base.kick();
      },
      setTheme: base.setTheme,
      destroy: base.destroy,
    };
  }
  function notebook({ stage, c, imgFor, text, theme, size, onFull }) {
    const base = K.viewerBase(stage, theme, { x: 0.22, y: 0.16 });
    base.state.tiltX = 5;
    base.state.tiltY = 4;
    base.pose.rotation.set(-34 * DEG, 0, 5 * DEG);
    const nb = notebookModel({ NW: Math.max(260, size() * 0.9), env: base.env, theme, c, imgFor, text, kick: base.kick });
    castShadows(nb.root);
    base.tilt.add(nb.root);
    base.desk.position.z = -0.5;
    a11y(base, "notebook", `A field notebook with ${c.photos.length} entries. The arrow keys turn the pages; Enter opens this photograph full size.`);
    clickable(base, () => [nb.pageR], onFull);
    base.setFrame((now) => nb.update(now));
    return {
      el: base.canvas,
      pages(l, r) {
        nb.pages(l, r);
        base.kick();
      },
      turn(d, frontFi, backFi) {
        nb.turn(d, frontFi, backFi, performance.now());
        base.kick();
      },
      setTheme(t) {
        base.setTheme(t);
        nb.setTheme(t);
      },
      refresh: nb.refresh,
      destroy: base.destroy,
    };
  }

  /* ---------- the grid: small versions, drawn by photography-gl.js's grid into each cell ---------- */
  const plainText = (c) => (fi) => {
    const p = c.photos[fi];
    return {
      no: `No. ${String(fi + 1).padStart(2, "0")}`,
      what: p.caption || p.alt || "",
      place: p.place || "",
      line: [p.from, p.when].filter(Boolean).join(" · "),
      small: "",
    };
  };
  Object.assign(GL.cells, {
    table(spec, env, kick) {
      const { c, imgs } = spec;
      const m = Math.min(c.photos.length, 4);
      const R = 172;
      const t = tableModel({ R, m, env, imgFor: (fi) => imgs[Math.min(fi, imgs.length - 1)], kick });
      t.fill(Array.from({ length: m }, (_, j) => j));
      const pose = new THREE.Group();
      pose.rotation.set(-54 * DEG, 0, 6 * DEG);
      pose.position.y = 16;
      pose.add(t.root);
      const shadow = K.blob(R * 2.6, R * 2.4);
      shadow.position.z = -R * 0.6;
      t.root.add(shadow);
      return {
        root: pose,
        shadow,
        ready: () => K.loaded(imgs[0]),
        refresh() {},
        update(time, hot, phase) {
          const idle = REDUCED ? 0 : K.pulse(time + phase, 9, 0.62, 0.74, 0.9);
          t.susan.rotation.z = -(hot * (TAU / m) * 0.5 + idle * 0.22);
        },
      };
    },
    finder(spec, env, kick) {
      const { c, imgs } = spec;
      const f = finderModel({ W: 316, env, imgFor: () => imgs[0], kick });
      f.show(0);
      f.counter(c.photos.length);
      const pose = new THREE.Group();
      pose.rotation.set(-10 * DEG, -20 * DEG, 2 * DEG);
      pose.add(f.root);
      const shadow = K.blob(316 * 1.3, 316 * 1.05);
      shadow.position.set(16, -26, -3);
      pose.add(shadow);
      return {
        root: pose,
        shadow,
        ready: () => K.loaded(imgs[0]),
        refresh() {},
        update(time, hot, phase) {
          // now and then the shutter fires; pointing at it winds the lever
          const blink = REDUCED ? 0 : K.pulse(time + phase, 8, 0.9, 0.915, 0.93);
          f.blades(blink);
          f.lever.rotation.y = (10 + 78 * hot) * DEG;
        },
      };
    },
    projector(spec, env, kick) {
      const { imgs } = spec;
      const p = projectorModel({ PW: 330, env, imgFor: () => imgs[0], kick });
      p.show(0, 0, false);
      const pose = new THREE.Group();
      pose.rotation.set(-6 * DEG, -16 * DEG, 0);
      pose.position.y = 6;
      pose.add(p.root);
      const shadow = K.blob(250, 210);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(182, -213, 116);
      p.room.add(shadow);
      return {
        root: pose,
        shadow,
        ready: () => K.loaded(imgs[0]),
        refresh() {},
        update(time, hot, phase) {
          const idle = REDUCED ? 0 : K.pulse(time + phase, 10, 0.7, 0.76, 0.9);
          p.tray.rotation.y = -(idle * 9 + hot * 18) * DEG;
          p.beam.material.uniforms.uO.value = 0.12 + 0.08 * hot;
        },
      };
    },
    notebook(spec, env, kick) {
      const { c, imgs } = spec;
      const nb = notebookModel({ NW: 326, env, theme: null, c, imgFor: () => imgs[0], text: plainText(c), kick, S: 1.6 });
      nb.pages(0, 0);
      const pose = new THREE.Group();
      pose.rotation.set(-40 * DEG, 0, 5 * DEG);
      pose.position.set(-8, 8, 0);
      pose.add(nb.root);
      const shadow = K.blob(326 * 1.3, 230 * 1.4);
      shadow.position.set(8, -10, -1);
      nb.root.add(shadow);
      return {
        root: pose,
        shadow,
        ready: () => K.loaded(imgs[0]),
        refresh: nb.refresh,
        update(time, hot, phase) {
          const idle = REDUCED ? 0 : K.pulse(time + phase, 9, 0.66, 0.78, 0.9);
          nb.hold(idle * 0.28 + hot * 0.9, 0, 0);
        },
      };
    },
  });

  window.PhotographySubjectsGL = { table, finder, projector, notebook };
})();
