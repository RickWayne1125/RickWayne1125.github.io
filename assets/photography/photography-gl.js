/*
 * /photography/ — optional WebGL layer (three.js r128, loaded by the layout before this file).
 *
 * photography.js builds every object out of plain elements with CSS 3D transforms and works on its own. When WebGL
 * and three.js are available it hands the same collections to this file, which draws the objects as real meshes:
 * a round canister with a wrapped label, an album whose pages bend as they turn, prints that cast shadows.
 * Sizes, poses and timings mirror the CSS version so the two can be swapped per object.
 *
 * Units are CSS pixels. CSS axes are x right, y down; three.js has y up, so y, rotateX and rotateZ change sign.
 * Photographs are drawn from the <img> elements photography.js already loaded, which therefore must be CORS-clean.
 */
(() => {
  "use strict";

  const THREE = window.THREE;
  if (!THREE || !THREE.WebGLRenderer) return;
  try {
    const test = document.createElement("canvas");
    if (!(test.getContext("webgl2") || test.getContext("webgl"))) return;
  } catch (err) {
    return;
  }

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const outCubic = (t) => 1 - Math.pow(1 - t, 3);
  const pad2 = (n) => String(n).padStart(2, "0");
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  /* ---------- small helpers ---------- */
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(w));
    c.height = Math.max(2, Math.round(h));
    return c;
  }
  function texture(src) {
    const t = src.tagName === "CANVAS" ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }
  const loaded = (img) => !!img && img.complete && img.naturalWidth > 0;
  // run fn now if the image is in, and again whenever it loads
  function whenLoaded(img, fn) {
    if (!img) return;
    if (loaded(img)) fn();
    img.addEventListener("load", fn);
  }
  function cover(ctx, img, x, y, w, h) {
    const ir = img.naturalWidth / img.naturalHeight;
    const r = w / h;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (ir > r) sw = sh * r;
    else sh = sw / r;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  }
  function roundRect(ctx, x, y, w, h, r) {
    const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.arcTo(x + w, y, x + w, y + h, tr);
    ctx.arcTo(x + w, y + h, x, y + h, br);
    ctx.arcTo(x, y + h, x, y, bl);
    ctx.arcTo(x, y, x + w, y, tl);
    ctx.closePath();
  }
  function wrapText(ctx, text, maxW) {
    const lines = [];
    let line = "";
    for (const word of String(text || "").split(/\s+/)) {
      const next = line ? line + " " + word : word;
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  const spaced = (ctx, px) => {
    if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px";
  };
  // 1 while a looping effect is "up": rises between a and b, holds until c, falls by the end of the period
  function pulse(t, period, a, b, c) {
    const u = (((t / period) % 1) + 1) % 1;
    if (u < a) return 0;
    if (u < b) return inOut((u - a) / (b - a));
    if (u < c) return 1;
    return 1 - inOut((u - c) / (1 - c));
  }

  let blobTex = null;
  // a soft dark ellipse standing in for a contact shadow
  function blob(w, h) {
    if (!blobTex) {
      const c = makeCanvas(128, 128);
      const x = c.getContext("2d");
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.55, "rgba(0,0,0,.42)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, 128, 128);
      blobTex = new THREE.CanvasTexture(c);
    }
    return new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.5 })
    );
  }
  let weaveTex = null;
  function weave() {
    if (!weaveTex) {
      const c = makeCanvas(64, 64);
      const x = c.getContext("2d");
      const d = x.createImageData(64, 64);
      for (let i = 0; i < d.data.length; i += 4) {
        const col = (i / 4) % 64;
        const row = Math.floor(i / 4 / 64);
        const v = 118 + (row % 3 === 0 ? 46 : 0) - (col % 3 === 0 ? 34 : 0) + Math.random() * 36;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 255;
      }
      x.putImageData(d, 0, 0);
      weaveTex = new THREE.CanvasTexture(c);
      weaveTex.wrapS = weaveTex.wrapT = THREE.RepeatWrapping;
    }
    return weaveTex;
  }
  function stripes(a, b, vertical) {
    const c = makeCanvas(vertical ? 6 : 2, vertical ? 2 : 6);
    const x = c.getContext("2d");
    x.fillStyle = a;
    x.fillRect(0, 0, 6, 6);
    x.fillStyle = b;
    if (vertical) x.fillRect(3, 0, 3, 2);
    else x.fillRect(0, 3, 2, 3);
    const t = texture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  function makeRenderer(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputEncoding = THREE.sRGBEncoding;
    r.setClearColor(0x000000, 0);
    return r;
  }
  // a small studio of bright panels, pre-filtered into an environment map so metal and foil have something to reflect
  function makeEnv(renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const sc = new THREE.Scene();
    const shell = new THREE.SphereGeometry(60, 16, 8);
    sc.add(new THREE.Mesh(shell, new THREE.MeshBasicMaterial({ color: 0x2c3038, side: THREE.BackSide })));
    const panel = (x, y, z, w, h, color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      sc.add(m);
    };
    panel(-34, 30, 26, 46, 30, 0xffffff);
    panel(36, 8, 30, 18, 46, 0xc4d2ff);
    panel(0, -34, 12, 60, 16, 0x5a4a3a);
    panel(0, 40, -20, 70, 20, 0x9aa4b8);
    const env = pm.fromScene(sc, 0.03).texture;
    pm.dispose();
    shell.dispose();
    return env;
  }
  function addLights(scene) {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d919c, 0.6);
    const key = new THREE.DirectionalLight(0xffffff, 0.62);
    key.position.set(-420, 640, 900);
    scene.add(hemi, key);
    return {
      key,
      // the light theme is a brighter room with softer shadows
      setTheme(theme) {
        hemi.intensity = theme === "light" ? 0.72 : 0.58;
        key.intensity = theme === "light" ? 0.52 : 0.64;
      },
    };
  }
  function disposeTree(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k of ["map", "roughnessMap", "metalnessMap", "bumpMap"]) if (m[k] && m[k] !== blobTex && m[k] !== weaveTex) m[k].dispose();
        m.dispose();
      }
    });
  }

  /* ---------- canvases the meshes are textured with ---------- */
  const FILM = "#1e1713";
  const AMBER = "#e9a43f";
  // same proportions as the CSS film: eight perforations to a 3:2 frame
  function filmMetrics(fh, gap) {
    const pitch = (fh * 1.5 + gap) / 8;
    const hole = pitch * 0.4167;
    const rebate = hole + 25;
    return { fh, gap, pitch, hole, rebate, H: fh + rebate * 2 };
  }
  // a short length of film: frames from left to right, then a blank tongue
  function drawFilm(cv, S, m, c, frames, W) {
    const x = cv.getContext("2d");
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, cv.width, cv.height);
    x.setTransform(S, 0, 0, S, 0, 0);
    x.fillStyle = FILM;
    roundRect(x, 0, 0, W, m.H, [0, 12, 12, 0]);
    x.fill();
    for (const top of [true, false]) {
      const g = x.createLinearGradient(0, top ? 0 : m.H, 0, top ? m.rebate * 0.7 : m.H - m.rebate * 0.7);
      g.addColorStop(0, "rgba(255,222,180,.14)");
      g.addColorStop(1, "rgba(255,222,180,0)");
      x.fillStyle = g;
      x.fillRect(0, top ? 0 : m.H - m.rebate, W, m.rebate);
    }
    x.globalCompositeOperation = "destination-out";
    for (let px = 0; px < W; px += m.pitch) {
      for (const y of [17, m.H - 17 - m.hole]) {
        roundRect(x, px + m.pitch * 0.21, y, m.pitch * 0.58, m.hole, m.hole * 0.2);
        x.fill();
      }
    }
    x.globalCompositeOperation = "source-over";
    let fx = 0;
    for (const f of frames) {
      const fw = m.fh * f.ratio;
      x.save();
      roundRect(x, fx, m.rebate, fw, m.fh, 3);
      x.clip();
      x.fillStyle = "#14161c";
      x.fillRect(fx, m.rebate, fw, m.fh);
      if (loaded(f.img)) cover(x, f.img, fx, m.rebate, fw, m.fh);
      x.restore();
      x.fillStyle = AMBER;
      x.font = '500 8.5px "DM Mono", monospace';
      spaced(x, 1.2);
      x.textBaseline = "alphabetic";
      x.textAlign = "left";
      x.fillText(c.film.toUpperCase(), fx + 1, m.rebate - m.hole - 14);
      x.fillText(String(f.no), fx + 1, m.rebate + m.fh + m.hole + 20);
      if (f.ratio >= 1) {
        x.fillText(f.no + "A", fx + fw / 2, m.rebate + m.fh + m.hole + 20);
        x.textAlign = "right";
        x.fillText(c.pin.toUpperCase(), fx + fw - 1, m.rebate - m.hole - 14);
      }
      spaced(x, 0);
      fx += fw + m.gap;
    }
  }
  const SERIF = 'Fraunces, "Iowan Old Style", Georgia, serif';
  const MONO = '"DM Mono", ui-monospace, Menlo, monospace';
  // mode "color" is what you see; mode "rm" paints roughness in green and metalness in blue, so the foil shines
  function drawCover(cv, S, w, h, pw, c, img, mode) {
    const x = cv.getContext("2d");
    x.setTransform(S, 0, 0, S, 0, 0);
    const L = c.look;
    const rm = mode === "rm";
    const FOIL = "rgb(0,112,150)";
    x.fillStyle = rm ? "rgb(0,236,0)" : L.cover;
    x.fillRect(0, 0, w, h);
    if (!rm) {
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "rgba(255,255,255,.1)");
      g.addColorStop(1, "rgba(0,0,0,.24)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.fillStyle = "rgba(0,0,0,.17)";
      x.fillRect(0, 0, pw * 0.1, h);
      x.fillStyle = "rgba(255,255,255,.08)";
      x.fillRect(pw * 0.1, 0, 1, h);
    }
    x.strokeStyle = rm ? FOIL : hexA(L.foil, 0.55);
    x.lineWidth = 1;
    x.strokeRect(w * 0.15, h * 0.055, w * 0.795, h * 0.89);

    const cw = w * 0.76;
    const cx = w * 0.16 + cw / 2;
    const gap = pw * 0.045;
    const smSize = pw * 0.036;
    const tSize = pw * 0.118;
    x.font = `italic 400 ${tSize}px ${SERIF}`;
    const title = wrapText(x, c.title, cw).slice(0, 3);
    const plateW = cw * 0.68;
    const plateH = plateW / 1.5;
    const total = smSize * 1.3 * 2 + title.length * tSize * 1.05 + plateH + gap * 3;
    let y = (h - total) / 2;
    const small = (text) => {
      x.font = `500 ${smSize}px ${MONO}`;
      spaced(x, smSize * 0.24);
      x.fillStyle = rm ? FOIL : L.foil;
      x.textAlign = "center";
      x.textBaseline = "top";
      x.fillText(String(text).toUpperCase(), cx, y);
      spaced(x, 0);
      y += smSize * 1.3 + gap;
    };
    small(c.pin);
    x.font = `italic 400 ${tSize}px ${SERIF}`;
    x.textAlign = "center";
    x.textBaseline = "top";
    if (rm) x.fillStyle = FOIL;
    else {
      const g = x.createLinearGradient(cx - cw / 2, 0, cx + cw / 2, 0);
      g.addColorStop(0, L.foil2 || L.foil);
      g.addColorStop(0.38, L.foil);
      g.addColorStop(0.62, L.foil2 || L.foil);
      g.addColorStop(1, L.foil);
      x.fillStyle = g;
    }
    for (const line of title) {
      x.fillText(line, cx, y);
      y += tSize * 1.05;
    }
    y += gap;
    if (rm) {
      x.fillStyle = "rgb(0,110,0)";
      x.fillRect(cx - plateW / 2, y, plateW, plateH);
    } else {
      x.fillStyle = "rgba(0,0,0,.3)";
      x.fillRect(cx - plateW / 2 - 3, y - 3, plateW + 6, plateH + 6);
      if (loaded(img)) cover(x, img, cx - plateW / 2, y, plateW, plateH);
    }
    y += plateH + gap;
    small(c.date);
  }
  function paperBase(x, w, h, L, spineLeft) {
    x.fillStyle = L.paper;
    x.fillRect(0, 0, w, h);
    const g = x.createLinearGradient(spineLeft ? 0 : w, 0, spineLeft ? 22 : w - 22, 0);
    g.addColorStop(0, "rgba(0,0,0,.3)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(spineLeft ? 0 : w - 22, 0, 22, h);
  }
  // the right-hand page: a mounted photograph with corner tabs, its caption and the page number
  function drawPage(cv, S, w, h, c, fi, img, ratio, tiltDeg) {
    const x = cv.getContext("2d");
    x.setTransform(S, 0, 0, S, 0, 0);
    const L = c.look;
    paperBase(x, w, h, L, true);
    const mw = Math.min(w * 0.84, h * 0.62 * ratio);
    const mh = mw / ratio;
    x.save();
    x.translate(w / 2, h * 0.44);
    x.rotate(tiltDeg * DEG);
    x.shadowColor = "rgba(0,0,0,.45)";
    x.shadowBlur = 8 * S;
    x.shadowOffsetY = 2 * S;
    x.fillStyle = "#1b1b1d";
    x.fillRect(-mw / 2, -mh / 2, mw, mh);
    x.shadowColor = "transparent";
    if (loaded(img)) cover(x, img, -mw / 2, -mh / 2, mw, mh);
    x.fillStyle = L.corner || L.ink;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const px = (sx * mw) / 2 + sx * 4;
      const py = (sy * mh) / 2 + sy * 4;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px - sx * 15, py);
      x.lineTo(px, py - sy * 15);
      x.closePath();
      x.fill();
    }
    x.restore();
    x.fillStyle = L.ink;
    x.textAlign = "center";
    x.textBaseline = "alphabetic";
    const cap = w * 0.053;
    x.font = `italic 400 ${cap}px ${SERIF}`;
    const lines = wrapText(x, c.photos[fi].caption, w * 0.82).slice(0, 3);
    lines.forEach((line, i) => x.fillText(line, w / 2, h * 0.93 - (lines.length - 1 - i) * cap * 1.3));
    x.globalAlpha = 0.6;
    x.font = `500 ${w * 0.034}px ${MONO}`;
    x.textAlign = "right";
    x.fillText(pad2(fi + 1), w * 0.95, h * 0.965);
    x.globalAlpha = 1;
  }
  // the back of a leaf, seen on the left once it is turned: a large number and the caption of the photograph beside it
  function drawBack(cv, S, w, h, c, fi) {
    const x = cv.getContext("2d");
    x.setTransform(S, 0, 0, S, 0, 0);
    const L = c.look;
    paperBase(x, w, h, L, false);
    if (fi >= c.photos.length - 1) return;
    x.fillStyle = L.ink;
    x.globalAlpha = 0.16;
    x.font = `300 ${w * 0.3}px ${SERIF}`;
    x.textAlign = "left";
    x.textBaseline = "top";
    x.fillText(pad2(fi + 2), w * 0.08, h * 0.04);
    x.globalAlpha = 1;
    const size = w * 0.066;
    x.font = `italic 400 ${size}px ${SERIF}`;
    x.textBaseline = "alphabetic";
    const lines = wrapText(x, c.photos[fi + 1].caption || c.place, w * 0.8).slice(0, 5);
    lines.forEach((line, i) => x.fillText(line, w * 0.09, h * 0.91 - (lines.length - 1 - i) * size * 1.35));
  }
  function drawEndpaper(cv, S, w, h, pw, c) {
    const x = cv.getContext("2d");
    x.setTransform(S, 0, 0, S, 0, 0);
    const L = c.look;
    x.fillStyle = L.paper;
    x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(0,0,0,.05)";
    x.fillRect(0, 0, w, h);
    x.fillStyle = L.ink;
    x.textAlign = "left";
    x.textBaseline = "alphabetic";
    const m = w * 0.12;
    let y = h - m;
    x.globalAlpha = 0.7;
    x.font = `400 ${pw * 0.034}px ${MONO}`;
    spaced(x, pw * 0.004);
    const meta = wrapText(x, [c.place, c.date, `${c.photos.length} photographs`].filter(Boolean).join(" · ").toUpperCase(), w - m * 2);
    for (let i = meta.length - 1; i >= 0; i--) {
      x.fillText(meta[i], m, y);
      y -= pw * 0.034 * 1.5;
    }
    spaced(x, 0);
    x.globalAlpha = 1;
    y -= pw * 0.02;
    x.font = `italic 400 ${pw * 0.056}px ${SERIF}`;
    const note = wrapText(x, c.note, w - m * 2);
    for (let i = note.length - 1; i >= 0; i--) {
      x.fillText(note[i], m, y);
      y -= pw * 0.056 * 1.35;
    }
    y -= pw * 0.02;
    x.font = `400 ${pw * 0.1}px ${SERIF}`;
    const title = wrapText(x, c.title, w - m * 2);
    for (let i = title.length - 1; i >= 0; i--) {
      x.fillText(title[i], m, y);
      y -= pw * 0.1 * 1.05;
    }
  }

  /* ---------- meshes ---------- */
  // 35mm cartridge standing on its end, 184 wide and 312 tall like the CSS one; `label` is the canvas photography.js drew
  const LABEL_FRONT = 0.14; // where on the label the camera looks when the film has not been pulled
  function canisterMesh(label, env) {
    const R = 92;
    const H = 312;
    const g = new THREE.Group();
    const map = texture(label);
    map.wrapS = THREE.RepeatWrapping;
    map.offset.x = LABEL_FRONT;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H, 72, 1, true),
      new THREE.MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.12, envMap: env, envMapIntensity: 0.55 })
    );
    const metal = new THREE.MeshStandardMaterial({ color: lin("#c6c9cf"), roughness: 0.3, metalness: 1, envMap: env, envMapIntensity: 1.15 });
    const dark = new THREE.MeshStandardMaterial({ color: lin("#121214"), roughness: 0.9 });
    const cap = new THREE.CylinderGeometry(R + 1.6, R + 1.6, 12, 72);
    const top = new THREE.Mesh(cap, metal);
    top.position.y = H / 2 - 4;
    const bottom = new THREE.Mesh(cap, metal);
    bottom.position.y = -H / 2 + 4;
    const well = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.62, 48),
      new THREE.MeshStandardMaterial({ color: lin("#8a8d94"), roughness: 0.45, metalness: 1, envMap: env })
    );
    well.rotation.x = -90 * DEG;
    well.position.y = H / 2 + 2.2;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 20, 40), metal);
    knob.position.y = H / 2 + 12;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(9, 24), dark);
    hole.rotation.x = -90 * DEG;
    hole.position.y = H / 2 + 22.2;
    const lip = new THREE.Mesh(new THREE.BoxGeometry(34, H * 0.92, 16), dark);
    lip.position.set(R + 8, 0, 6);
    g.add(body, top, bottom, well, knob, hole, lip);
    // pulling film turns the spool: slide the label around the body
    g.spin = (px) => {
      map.offset.x = LABEL_FRONT - px / (2 * Math.PI * R);
    };
    g.relabel = () => {
      map.needsUpdate = true;
    };
    return g;
  }
  function clothMaterial(color, env) {
    const bump = weave();
    return new THREE.MeshStandardMaterial({ color: lin(color), roughness: 0.92, bumpMap: bump, bumpScale: 0.5, envMap: env, envMapIntensity: 0.2 });
  }
  // the parts of an album that do not move: back cover, spine and the block of pages
  function albumShell(c, env, d, topMaterial) {
    const { pw, ph, bd } = d;
    const L = c.look;
    const g = new THREE.Group();
    const cloth = clothMaterial(L.cover, env);
    const paper = new THREE.MeshStandardMaterial({ color: lin(L.paper), roughness: 0.9 });
    const fore = new THREE.MeshStandardMaterial({ map: stripes(L.e1 || L.paper, L.e2 || L.paper, true), roughness: 0.9 });
    fore.map.repeat.set(bd / 3, 1);
    const head = new THREE.MeshStandardMaterial({ map: stripes(L.e1 || L.paper, L.e2 || L.paper, false), roughness: 0.9 });
    head.map.repeat.set(1, bd / 3);
    const block = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, bd), [fore, cloth, head, head, topMaterial || paper, paper]);
    block.position.set(pw / 2, 0, -bd / 2 - 0.4);
    const back = new THREE.Mesh(new THREE.BoxGeometry(pw + 7, ph + 12, 2.4), cloth);
    back.position.set((pw + 7) / 2, 0, -bd - 1.6);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(2.4, ph + 12, bd + 5.4), cloth);
    spine.position.set(-1.2, 0, -bd / 2 - 0.4);
    g.add(block, back, spine);
    g.block = block;
    return g;
  }
  // the front cover hangs from a pivot on the spine; rotation.y = 0 is closed, -180° lies open on the left
  function albumCover(c, env, d, img, onChange) {
    const { pw, ph } = d;
    const w = pw + 7;
    const h = ph + 12;
    const S = 2.4;
    const colour = makeCanvas(w * S, h * S);
    const rm = makeCanvas(w * S, h * S);
    const inside = makeCanvas(w * S, h * S);
    const map = texture(colour);
    const rmap = new THREE.CanvasTexture(rm);
    const front = new THREE.MeshStandardMaterial({
      map,
      roughnessMap: rmap,
      metalnessMap: rmap,
      roughness: 1,
      metalness: 1,
      envMap: env,
      envMapIntensity: 1.2,
      bumpMap: weave(),
      bumpScale: 0.35,
    });
    front.bumpMap.repeat.set(18, 22);
    const end = new THREE.MeshStandardMaterial({ map: texture(inside), roughness: 0.9 });
    const cloth = clothMaterial(c.look.cover, env);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.4), [cloth, cloth, cloth, cloth, front, end]);
    mesh.position.set(w / 2, 0, 0);
    const pivot = new THREE.Group();
    pivot.position.z = 1.4;
    pivot.add(mesh);
    const paint = () => {
      drawCover(colour, S, w, h, pw, c, img, "color");
      drawCover(rm, S, w, h, pw, c, img, "rm");
      drawEndpaper(inside, S, w, h, pw, c);
      map.needsUpdate = rmap.needsUpdate = end.map.needsUpdate = true;
      if (onChange) onChange();
    };
    paint();
    whenLoaded(img, paint);
    pivot.mesh = mesh;
    pivot.repaint = paint;
    return pivot;
  }
  function printMesh(c, img, prw, env) {
    const g = new THREE.Group();
    const paper = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: lin(c.look.border), roughness: 0.62, envMap: env, envMapIntensity: 0.25 })
    );
    const photoMat = new THREE.MeshStandardMaterial({ color: lin("#d9d6cf"), roughness: 0.5, envMap: env, envMapIntensity: 0.35 });
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), photoMat);
    g.add(paper, photo);
    g.paper = paper;
    // the long edge of every print is prw, like the CSS version
    g.shape = (ratio) => {
      const w = prw * Math.min(1, ratio);
      const h = w / ratio;
      const b = prw * 0.03;
      paper.scale.set(w + b * 2, h + b * 2, 0.9);
      photo.scale.set(w, h, 1);
      photo.position.z = 0.5;
      g.w = w + b * 2;
    };
    g.fill = () => {
      if (!loaded(img) || photoMat.map) return false;
      photoMat.map = texture(img);
      photoMat.color.set(0xffffff);
      photoMat.needsUpdate = true;
      g.shape(img.naturalWidth / img.naturalHeight);
      return true;
    };
    return g;
  }

  /* ---------- the grid: one canvas over the page, each cell drawn into its own rectangle ---------- */
  const DIST = 1300; // camera distance for the 400 × 368 box a cell's object is designed in
  const MARGIN = 0.16; // each cell is drawn a little beyond its box so nothing is cut at the edge

  function rollCell(spec, env, kick) {
    const { c, imgs, label } = spec;
    const m = filmMetrics(112, 8);
    const pose = new THREE.Group();
    pose.rotation.set(-6 * DEG, -16 * DEG, 0);
    const can = canisterMesh(label, env);
    can.scale.setScalar(0.6);
    can.position.x = -140;
    can.rotation.x = 10 * DEG;
    const shadow = blob(250, 70);
    shadow.rotation.x = -90 * DEG;
    shadow.position.set(-140, -96, 0);
    const S = 2;
    let film = null;
    let cv = null;
    // frames nearest the canister first, so photograph 1 is the one furthest out
    const order = c.photos.length > 1 ? [1, 0] : [0];
    function rebuild() {
      const frames = order.map((fi) => ({ img: imgs[fi], ratio: c.photos[fi].ratio || 1.5, no: fi + 1 }));
      const W = frames.reduce((a, f) => a + m.fh * f.ratio + m.gap, 0) - m.gap + 44;
      if (!cv || Math.abs(cv.width - W * S) > 2) {
        if (film) {
          pose.remove(film);
          disposeTree(film);
        }
        cv = makeCanvas(W * S, m.H * S);
        film = new THREE.Mesh(
          new THREE.PlaneGeometry(W, m.H),
          new THREE.MeshBasicMaterial({ map: texture(cv), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
        );
        film.W = W;
        pose.add(film);
      }
      drawFilm(cv, S, m, c, frames, W);
      film.material.map.needsUpdate = true;
      kick();
    }
    rebuild();
    order.forEach((fi) => imgs[fi] && imgs[fi].addEventListener("load", rebuild));
    pose.add(shadow, can);
    return {
      root: pose,
      ready: () => loaded(imgs[0]),
      shadow,
      refresh() {
        can.relabel();
        rebuild();
      },
      update(t, hot, phase) {
        const pull = lerp(REDUCED ? 0 : 16 * pulse(t + phase, 8, 0.68, 0.8, 0.88), 50, hot);
        film.position.set(-190 + film.W / 2 + pull, 0, -1);
        can.spin(-64 * hot);
      },
    };
  }
  function albumCell(spec, env, kick) {
    const { c, imgs } = spec;
    const d = { pw: 228, ph: 288, bd: 22 };
    const S = 2.2;
    const pageCv = makeCanvas(d.pw * S, d.ph * S);
    const pageMat = new THREE.MeshStandardMaterial({ map: texture(pageCv), roughness: 0.88 });
    const pose = new THREE.Group();
    pose.rotation.set(-15 * DEG, -27 * DEG, 3 * DEG);
    const book = new THREE.Group();
    book.position.x = -d.pw / 2; // the closed block sits centred
    const cover = albumCover(c, env, d, imgs[0], kick);
    const paintPage = () => {
      drawPage(pageCv, S, d.pw, d.ph, c, 0, imgs[0], c.photos[0].ratio || 1.5, 0.6);
      pageMat.map.needsUpdate = true;
      kick();
    };
    paintPage();
    whenLoaded(imgs[0], paintPage);
    const shadow = blob(d.pw * 1.55, d.ph * 1.3);
    shadow.position.set(d.pw / 2 + 10, -22, -d.bd - 10);
    book.add(albumShell(c, env, d, pageMat), cover, shadow);
    pose.add(book);
    return {
      root: pose,
      ready: () => loaded(imgs[0]),
      shadow,
      refresh() {
        cover.repaint();
        paintPage();
      },
      update(t, hot, phase) {
        const peek = REDUCED ? 0 : 20 * pulse(t + phase, 9, 0.66, 0.78, 0.88);
        cover.rotation.y = -lerp(peek, 52, hot) * DEG;
      },
    };
  }
  function printsCell(spec, env, kick) {
    const { c, imgs, pile } = spec;
    const prw = 266;
    const pose = new THREE.Group();
    pose.rotation.set(-22 * DEG, 0, 5 * DEG);
    const prints = pile.map((p, i) => {
      const g = printMesh(c, imgs[i], prw, env);
      g.shape(c.photos[i].ratio || 1.5);
      whenLoaded(imgs[i], () => {
        g.fill();
        kick();
      });
      pose.add(g);
      return g;
    });
    const shadow = blob(prw * 1.5, prw * 1.05);
    shadow.position.set(8, -18, -4);
    pose.add(shadow);
    return {
      root: pose,
      ready: () => loaded(imgs[0]),
      shadow,
      refresh() {},
      update(t, hot, phase) {
        const f = lerp(REDUCED ? 0 : 0.4 * pulse(t + phase, 8.5, 0.7, 0.8, 0.9), 1, hot);
        prints.forEach((g, i) => {
          const p = pile[i];
          g.position.set(p.x + f * i * 24, -(p.y - f * i * 6), p.z);
          g.rotation.z = -(p.r + f * i * 2.6) * DEG;
        });
      },
    };
  }

  function grid({ host }) {
    const canvas = document.createElement("canvas");
    canvas.className = "gl-grid";
    canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    const renderer = makeRenderer(canvas);
    renderer.autoClear = false;
    const env = makeEnv(renderer);
    const views = [];
    let raf = 0;
    let paused = false;
    let theme = "dark";
    let W = 0;
    let H = 0;
    function resize() {
      W = document.documentElement.clientWidth;
      H = window.innerHeight;
      renderer.setSize(W, H, false);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
    }
    function frame(now) {
      raf = 0;
      if (paused) return;
      const t = now / 1000;
      // the canvas rides along with the page, so it stays put between frames while scrolling
      canvas.style.transform = `translate3d(0,${(-host.getBoundingClientRect().top).toFixed(1)}px,0)`;
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.setScissorTest(true);
      let drew = false;
      for (const v of views) {
        if (!v.on) {
          if (!v.obj.ready()) continue;
          v.on = true;
          v.spec.onReady();
        }
        const b = v.spec.stage.getBoundingClientRect();
        if (b.width < 2 || b.bottom < -80 || b.top > H + 80) continue;
        drew = true;
        const hotNow = v.spec.hot() ? 1 : 0;
        v.hot += (hotNow - v.hot) * 0.11;
        v.obj.update(t, v.hot, v.phase);
        const tilt = v.spec.tilt;
        v.tilt.rotation.x = -(-tilt.py * tilt.ay + tilt.sc * tilt.sy) * DEG;
        v.tilt.rotation.y = (tilt.px * tilt.ax + tilt.sc * tilt.sx) * DEG;
        if (!REDUCED) {
          const u = ((t + v.phase * 0.77) / 7.5) * Math.PI * 2;
          v.float.position.y = 4 - 4 * Math.cos(u);
          v.float.rotation.z = -0.35 * DEG * (1 - Math.cos(u));
        }
        const mx = b.width * MARGIN;
        const my = b.height * MARGIN;
        const x = b.left - mx;
        const y = H - b.bottom - my;
        const w = b.width + mx * 2;
        const h = b.height + my * 2;
        renderer.setViewport(x, y, w, h);
        renderer.setScissor(x, y, w, h);
        v.camera.aspect = w / h;
        v.camera.updateProjectionMatrix();
        renderer.clearDepth();
        renderer.render(v.scene, v.camera);
      }
      if (drew && !REDUCED) kick();
    }
    function kick() {
      if (!raf && !paused) raf = requestAnimationFrame(frame);
    }
    resize();
    addEventListener("resize", () => {
      resize();
      kick();
    });
    addEventListener("scroll", kick, { passive: true });
    document.addEventListener("pointermove", kick, { passive: true });
    return {
      // spec: { stage, c, imgs, label?, pile?, tilt, hot(), index, onReady() }
      add(spec) {
        const scene = new THREE.Scene();
        const lights = addLights(scene);
        lights.setTheme(theme);
        const camera = new THREE.PerspectiveCamera(2 * Math.atan((184 * (1 + MARGIN * 2)) / DIST) * (180 / Math.PI), 1, 200, 4000);
        camera.position.z = DIST;
        const float = new THREE.Group();
        const tilt = new THREE.Group();
        const obj = (spec.c.kind === "roll" ? rollCell : spec.c.kind === "album" ? albumCell : printsCell)(spec, env, kick);
        tilt.add(obj.root);
        float.add(tilt);
        scene.add(float);
        const v = { spec, scene, camera, float, tilt, obj, lights, hot: 0, on: false, phase: spec.index * 1.7 };
        obj.shadow.material.opacity = theme === "light" ? 0.3 : 0.55;
        views.push(v);
        for (const img of spec.imgs) if (img) img.addEventListener("load", kick);
        kick();
      },
      setTheme(next) {
        theme = next;
        for (const v of views) {
          v.lights.setTheme(theme);
          v.obj.shadow.material.opacity = theme === "light" ? 0.3 : 0.55;
        }
        kick();
      },
      // fonts arrived: text drawn on canvases needs painting again
      refresh() {
        for (const v of views) v.obj.refresh();
        kick();
      },
      pause(on) {
        paused = on;
        if (on) {
          renderer.setScissorTest(false);
          renderer.clear();
        } else kick();
      },
      kick,
    };
  }

  /* ---------- an opened collection: one canvas inside the dialog ---------- */
  const VIEW_DIST = 1500; // matches the CSS `perspective` of the stage

  // Common plumbing: a canvas laid over `stage` (and beyond it by `grow`), a camera that makes 1 unit = 1 CSS pixel
  // at the object's depth, a render loop that only runs while something moves, and real shadows.
  function viewerBase(stage, theme, grow) {
    const canvas = document.createElement("canvas");
    canvas.className = "gl-view";
    canvas.style.cssText = `position:absolute;left:${-grow.x * 100}%;top:${-grow.y * 100}%;width:${100 + grow.x * 200}%;height:${100 + grow.y * 200}%`;
    stage.append(canvas);
    const renderer = makeRenderer(canvas);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const env = makeEnv(renderer);
    const scene = new THREE.Scene();
    const lights = addLights(scene);
    lights.setTheme(theme);
    const key = lights.key;
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -620;
    key.shadow.camera.right = key.shadow.camera.top = 620;
    key.shadow.camera.near = 200;
    key.shadow.camera.far = 2400;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.8;
    key.shadow.radius = 5;
    const camera = new THREE.PerspectiveCamera(30, 1, 200, 5000);
    camera.position.z = VIEW_DIST;
    const enter = new THREE.Group(); // the arrival animation
    const float = new THREE.Group();
    const pose = new THREE.Group();
    const tilt = new THREE.Group();
    pose.add(tilt);
    float.add(pose);
    enter.add(float);
    scene.add(enter);
    // the desk: invisible apart from the shadows that fall on it
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.ShadowMaterial({ opacity: theme === "light" ? 0.2 : 0.42 }));
    desk.receiveShadow = true;
    tilt.add(desk);
    const state = { t0: performance.now(), entered: REDUCED ? 1 : 0, w: 1, h: 1, alive: true, raf: 0, hold: 0 };
    const tiltTarget = { x: 0, y: 0, px: 0, py: 0 };
    let onFrame = () => false;
    function resize() {
      state.w = canvas.clientWidth || 1;
      state.h = canvas.clientHeight || 1;
      renderer.setSize(state.w, state.h, false);
      camera.aspect = state.w / state.h;
      camera.fov = 2 * Math.atan(state.h / 2 / VIEW_DIST) * (180 / Math.PI);
      camera.updateProjectionMatrix();
      kick();
    }
    function frame(now) {
      state.raf = 0;
      if (!state.alive) return;
      const t = (now - state.t0) / 1000;
      let moving = false;
      if (state.entered < 1) {
        state.entered = Math.min(1, t / 1.1);
        moving = true;
      }
      const e = 1 - outCubic(state.entered);
      enter.position.y = -50 * e;
      enter.rotation.set(-18 * DEG * e, 16 * DEG * e, 0);
      enter.scale.setScalar(1 - 0.1 * e);
      if (!REDUCED) {
        const u = (t / 7.5) * Math.PI * 2;
        float.position.y = 4 - 4 * Math.cos(u);
        float.rotation.z = -0.35 * DEG * (1 - Math.cos(u));
      }
      tiltTarget.px += (tiltTarget.x - tiltTarget.px) * 0.12;
      tiltTarget.py += (tiltTarget.y - tiltTarget.py) * 0.12;
      tilt.rotation.set(tiltTarget.py * state.tiltY * DEG, tiltTarget.px * state.tiltX * DEG, 0);
      if (Math.abs(tiltTarget.x - tiltTarget.px) + Math.abs(tiltTarget.y - tiltTarget.py) > 0.004) moving = true;
      if (onFrame(now, t)) moving = true;
      renderer.render(scene, camera);
      // the gentle float keeps the loop alive unless motion is reduced
      if (moving || !REDUCED) kick();
    }
    function kick() {
      if (!state.raf && state.alive) state.raf = requestAnimationFrame(frame);
    }
    state.tiltX = 8;
    state.tiltY = 6;
    stage.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || REDUCED) return;
      const b = stage.getBoundingClientRect();
      tiltTarget.x = clamp(((e.clientX - b.left) / b.width - 0.5) * 2, -1, 1);
      tiltTarget.y = clamp(((e.clientY - b.top) / b.height - 0.5) * 2, -1, 1);
      kick();
    });
    stage.addEventListener("pointerleave", () => {
      tiltTarget.x = tiltTarget.y = 0;
      kick();
    });
    const ro = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas);
    resize();
    return {
      canvas,
      renderer,
      env,
      scene,
      camera,
      pose,
      tilt,
      desk,
      state,
      kick,
      setFrame(fn) {
        onFrame = fn;
      },
      // pointer position in the scene's units, measured from the middle of the canvas
      point(e) {
        const b = canvas.getBoundingClientRect();
        return {
          x: e.clientX - b.left - b.width / 2,
          y: -(e.clientY - b.top - b.height / 2),
          nx: ((e.clientX - b.left) / b.width) * 2 - 1,
          ny: -((e.clientY - b.top) / b.height) * 2 + 1,
        };
      },
      setTheme(next) {
        lights.setTheme(next);
        desk.material.opacity = next === "light" ? 0.2 : 0.42;
        kick();
      },
      destroy() {
        state.alive = false;
        cancelAnimationFrame(state.raf);
        if (ro) ro.disconnect();
        disposeTree(scene);
        env.dispose();
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        canvas.remove();
      },
    };
  }

  /*
   * Album. `set(open, pos)` is called by photography.js whenever its state changes; clicks and swipes are reported
   * back through onNext / onPrev. Leaves turn on the spine and bend while they are in the air.
   */
  function album({ stage, c, cover: coverImg, imgs, dims, theme, shift, onNext, onPrev }) {
    const d = dims;
    const n = c.photos.length;
    const base = viewerBase(stage, theme, { x: 0.3, y: 0.12 });
    const { pose, tilt, env, kick } = base;
    base.canvas.tabIndex = 0;
    base.canvas.setAttribute("role", "group");
    base.canvas.setAttribute("aria-roledescription", "photo album");
    base.canvas.setAttribute("aria-label", `Album of ${n} photographs. Enter opens it; the arrow keys turn pages.`);
    base.canvas.style.touchAction = "pan-y";
    base.canvas.style.cursor = "pointer";
    const book = new THREE.Group();
    const shell = albumShell(c, env, d);
    shell.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    const cover = albumCover(c, env, d, coverImg, kick);
    cover.mesh.castShadow = cover.mesh.receiveShadow = true;
    shell.position.z = -n * 0.7 - 0.4; // the loose leaves lie on top of the block
    book.add(shell, cover);
    tilt.add(book);
    base.desk.position.z = -d.bd - n * 0.7 - 5;

    const SEG = 18;
    const S = 2.2;
    const leaves = imgs.map((img, fi) => {
      const geo = new THREE.PlaneGeometry(d.pw, d.ph, SEG, 1);
      const fcv = makeCanvas(d.pw * S, d.ph * S);
      const bcv = makeCanvas(d.pw * S, d.ph * S);
      const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture(fcv), roughness: 0.88, side: THREE.FrontSide }));
      const backMap = texture(bcv);
      backMap.wrapS = THREE.RepeatWrapping;
      backMap.repeat.x = -1; // read from behind
      const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: backMap, roughness: 0.88, side: THREE.BackSide }));
      front.receiveShadow = back.receiveShadow = true;
      book.add(front, back);
      const mr = (((fi * 7919) % 26) - 13) / 10; // a slight, fixed tilt per mount
      const leaf = { fi, geo, front, back, f: 0, from: 0, to: 0, start: 0, dur: 1, drawn: false };
      const paint = () => {
        drawPage(fcv, S, d.pw, d.ph, c, fi, img, c.photos[fi].ratio || 1.5, mr);
        drawBack(bcv, S, d.pw, d.ph, c, fi);
        front.material.map.needsUpdate = backMap.needsUpdate = true;
        kick();
      };
      paint();
      whenLoaded(img, paint);
      leaf.paint = paint;
      shape(leaf);
      return leaf;
    });
    // lay a leaf out along a curve: flat on the right at f = 0, flat on the left at f = 1, arched in between
    function shape(leaf) {
      const f = leaf.f;
      const pos = leaf.geo.attributes.position;
      const arch = Math.sin(Math.PI * f) * 1.05;
      const z0 = lerp(-leaf.fi * 0.7 - 0.3, leaf.fi * 0.7 + 3.2, f);
      let x = 0;
      let z = 0;
      const step = d.pw / SEG;
      for (let i = 0; i <= SEG; i++) {
        if (i > 0) {
          const s = (i - 0.5) / SEG;
          const a = Math.PI * f + arch * (s - 0.5);
          x += Math.cos(a) * step;
          z += Math.sin(a) * step;
        }
        pos.setXYZ(i, x, d.ph / 2, z0 + z);
        pos.setXYZ(i + SEG + 1, x, -d.ph / 2, z0 + z);
      }
      pos.needsUpdate = true;
      leaf.geo.computeVertexNormals();
      leaf.geo.computeBoundingSphere();
    }

    let open = false;
    let poseT = REDUCED ? 1 : 0; // 0 = closed pose, 1 = open pose
    let poseFrom = 0;
    let poseTo = 0;
    let poseStart = 0;
    let coverF = 0;
    let coverFrom = 0;
    let coverTo = 0;
    let coverStart = 0;
    function applyPose() {
      const k = inOut(poseT);
      pose.position.x = lerp(-d.pw / 2, shift(), k);
      pose.rotation.set(-lerp(17, 9, k) * DEG, -lerp(27, 0, k) * DEG, lerp(3, 0, k) * DEG);
    }
    applyPose();
    base.setFrame((now) => {
      let moving = false;
      if (poseT !== poseTo) {
        const u = clamp((now - poseStart) / 1150, 0, 1);
        poseT = REDUCED ? poseTo : lerp(poseFrom, poseTo, u);
        if (u >= 1) poseT = poseTo;
        moving = true;
      }
      applyPose();
      if (coverF !== coverTo) {
        const u = clamp((now - coverStart) / 1250, 0, 1);
        coverF = REDUCED || u >= 1 ? coverTo : lerp(coverFrom, coverTo, inOut(u));
        moving = true;
      }
      cover.rotation.y = -Math.PI * coverF;
      for (const leaf of leaves) {
        if (leaf.f === leaf.to) {
          if (leaf.front.castShadow) leaf.front.castShadow = leaf.back.castShadow = false;
          continue;
        }
        const u = clamp((now - leaf.start) / (leaf.dur * 1000), 0, 1);
        leaf.f = REDUCED || u >= 1 ? leaf.to : lerp(leaf.from, leaf.to, inOut(u));
        // only a leaf in the air casts a shadow; resting leaves lie too close together for a clean one
        leaf.front.castShadow = leaf.back.castShadow = leaf.f !== leaf.to;
        shape(leaf);
        moving = true;
      }
      return moving;
    });
    function set(nextOpen, pos) {
      const now = performance.now();
      if (nextOpen !== open) {
        open = nextOpen;
        poseFrom = poseT;
        poseTo = open ? 1 : 0;
        poseStart = now;
        coverFrom = coverF;
        coverTo = open ? 1 : 0;
        coverStart = now;
      }
      leaves.forEach((leaf, i) => {
        const to = open && i < pos ? 1 : 0;
        if (to === leaf.to) return;
        leaf.from = leaf.f;
        leaf.to = to;
        leaf.start = now;
        leaf.dur = 1;
      });
      kick();
    }
    // which side of the spine was touched decides the direction
    let sx = null;
    let swiped = false;
    const spineX = () => {
      const p = new THREE.Vector3(0, 0, 0);
      book.localToWorld(p);
      p.project(base.camera);
      return p.x;
    };
    base.canvas.addEventListener("pointerdown", (e) => {
      sx = e.clientX;
      swiped = false;
    });
    base.canvas.addEventListener("pointerup", (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      sx = null;
      if (Math.abs(dx) <= 40) return;
      swiped = true;
      if (dx < 0) onNext();
      else onPrev();
    });
    base.canvas.addEventListener("pointercancel", () => {
      sx = null;
    });
    base.canvas.addEventListener("click", (e) => {
      if (swiped) {
        swiped = false;
        return;
      }
      if (open && base.point(e).nx < spineX()) onPrev();
      else onNext();
    });
    base.canvas.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      }
    });
    return {
      el: base.canvas,
      set,
      setTheme: base.setTheme,
      refresh() {
        cover.repaint();
        leaves.forEach((l) => l.paint());
      },
      destroy: base.destroy,
    };
  }

  /*
   * Pile of prints. It owns the order of the pile; photography.js asks it to deal and is told which print is on top.
   */
  function prints({ stage, c, imgs, prw, theme, onChange, onFull }) {
    const n = c.photos.length;
    const base = viewerBase(stage, theme, { x: 0.45, y: 0.12 });
    const { pose, tilt, env, kick } = base;
    base.state.tiltX = 9;
    base.state.tiltY = 7;
    pose.rotation.set(-21 * DEG, 0, 4 * DEG);
    base.canvas.tabIndex = 0;
    base.canvas.setAttribute("role", "group");
    base.canvas.setAttribute("aria-roledescription", "pile of prints");
    base.canvas.setAttribute("aria-label", `Pile of ${n} prints. The arrow keys move through them; Enter opens the top print full size.`);
    base.canvas.style.touchAction = "pan-y";
    base.desk.position.z = -1.5;
    const size = prw();
    // the same pseudo-random scatter as the CSS pile
    let seed = 0;
    for (const ch of c.id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
    seed = (seed + 99) >>> 0;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const cards = imgs.map((img, i) => {
      const g = printMesh(c, img, size, env);
      g.shape(c.photos[i].ratio || 1.5);
      g.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      g.rotation.order = "ZYX";
      g.rot = i ? (rnd() - 0.5) * 13 : -2;
      g.dx = i ? (rnd() - 0.5) * 28 : 0;
      g.dy = i ? (rnd() - 0.5) * 20 : 0;
      g.cur = null; // current pose {x, y, z, r, ry}
      g.anim = null;
      whenLoaded(img, () => {
        g.fill();
        kick();
      });
      tilt.add(g);
      return g;
    });
    let order = cards.map((_, i) => i); // order[0] is on top
    let fan = false;
    let busy = false;
    let drag = null;
    // where card i rests when it is p-th from the top (CSS coordinates: y down, degrees)
    const rest = (i, p, o = {}) => {
      const g = cards[i];
      const f = fan ? Math.min(p, 6) : 0;
      return {
        x: g.dx + f * 22 + (o.x || 0),
        y: g.dy - f * 5 + (o.y || 0),
        z: (n - 1 - p) * 2.6 + (o.z || 0),
        r: g.rot + f * 2.2 + (o.r || 0),
        ry: o.ry || 0,
      };
    };
    const put = (g, p) => {
      g.cur = p;
      g.position.set(p.x, -p.y, p.z + 0.6);
      g.rotation.set(0, p.ry * DEG, -p.r * DEG);
    };
    const mix = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), r: lerp(a.r, b.r, t), ry: lerp(a.ry, b.ry, t) });
    function settle(ms = 600) {
      const now = performance.now();
      order.forEach((i, p) => {
        const g = cards[i];
        if (g.anim && g.anim.keys.length > 2) return; // being dealt
        g.anim = { keys: [g.cur, rest(i, p)], at: [0, 1], start: now, dur: ms, ease: outCubic };
      });
      kick();
    }
    order.forEach((i, p) => put(cards[i], rest(i, p)));
    base.setFrame((now) => {
      let moving = false;
      for (const g of cards) {
        const a = g.anim;
        if (!a) continue;
        const u = REDUCED ? 1 : clamp((now - a.start) / a.dur, 0, 1);
        const e = a.ease(u);
        let k = a.at.length - 2;
        for (let j = 0; j < a.at.length - 1; j++) {
          if (e <= a.at[j + 1]) {
            k = j;
            break;
          }
        }
        put(g, mix(a.keys[k], a.keys[k + 1], (e - a.at[k]) / (a.at[k + 1] - a.at[k] || 1)));
        if (u >= 1) {
          g.anim = null;
          if (a.done) a.done();
        } else moving = true;
      }
      return moving;
    });
    // the dealt print lifts, swings out to the side, drops to the desk and slides back under the pile
    function deal(dir, side = 1) {
      if (busy || n < 2) return;
      busy = true;
      const i = dir > 0 ? order[0] : order[n - 1];
      const g = cards[i];
      const w = g.w * 1.06 * side;
      if (dir > 0) order.push(order.shift());
      else order.unshift(order.pop());
      const hi = rest(i, n - 1, { x: w, y: -26, z: n * 2.6 + 64, r: 13 * side, ry: -16 * side });
      const lo = rest(i, n - 1, { x: w, y: -8, r: 8 * side });
      const done = () => {
        busy = false;
      };
      g.anim =
        dir > 0
          ? { keys: [g.cur, hi, lo, rest(i, n - 1)], at: [0, 0.36, 0.6, 1], start: performance.now(), dur: 880, ease: inOut, done }
          : { keys: [g.cur, lo, hi, rest(i, 0)], at: [0, 0.36, 0.62, 1], start: performance.now(), dur: 880, ease: inOut, done };
      settle();
      onChange(order[0], [order[0], order[1], order[2], order[n - 1]]);
    }
    const ray = new THREE.Raycaster();
    const onTop = (e) => {
      const p = base.point(e);
      ray.setFromCamera({ x: p.nx, y: p.ny }, base.camera);
      return ray.intersectObject(cards[order[0]], true).length > 0;
    };
    base.canvas.addEventListener("pointerdown", (e) => {
      if (busy || e.button > 0 || !onTop(e)) return;
      drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false, g: cards[order[0]] };
      try {
        base.canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* the pointer is already gone */
      }
    });
    base.canvas.addEventListener("pointermove", (e) => {
      base.canvas.style.cursor = drag ? "grabbing" : onTop(e) ? "grab" : "";
      if (!drag) return;
      drag.dx = e.clientX - drag.x;
      drag.dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(drag.dx, drag.dy) > 7) drag.moved = true;
      if (!drag.moved) return;
      drag.g.anim = null;
      put(drag.g, rest(order[0], 0, { x: drag.dx, y: drag.dy, z: 50, r: drag.dx * 0.04, ry: clamp(drag.dx * 0.05, -16, 16) }));
      kick();
    });
    const drop = (e) => {
      if (!drag) return;
      const dgd = drag;
      drag = null;
      if (!dgd.moved) {
        if (e.type === "pointerup") deal(1);
      } else if (Math.hypot(dgd.dx, dgd.dy) > 90) deal(1, dgd.dx < 0 ? -1 : 1);
      else settle(450);
    };
    base.canvas.addEventListener("pointerup", drop);
    base.canvas.addEventListener("pointercancel", drop);
    base.canvas.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        deal(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        deal(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onFull(order[0]);
      }
    });
    stage.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      fan = true;
      if (!busy && !drag) settle();
    });
    stage.addEventListener("pointerleave", () => {
      fan = false;
      if (!busy && !drag) settle();
    });
    onChange(order[0], [order[0], order[1], order[2], order[n - 1]]);
    return {
      el: base.canvas,
      deal,
      top: () => order[0],
      setTheme: base.setTheme,
      refresh() {},
      destroy: base.destroy,
    };
  }

  // The canister of an opened roll: a small canvas placed where the CSS canister was. The film itself stays in the page.
  function canister({ host, label, k, theme }) {
    const canvas = document.createElement("canvas");
    canvas.className = "gl-can";
    canvas.setAttribute("aria-hidden", "true");
    const w = 330 * k;
    const h = 500 * k;
    canvas.style.cssText = `position:absolute;left:${-w / 2}px;top:${-h / 2}px;width:${w}px;height:${h}px;pointer-events:none`;
    host.append(canvas);
    const renderer = makeRenderer(canvas);
    renderer.setSize(w, h, false);
    const env = makeEnv(renderer);
    const scene = new THREE.Scene();
    const lights = addLights(scene);
    lights.setTheme(theme);
    const camera = new THREE.PerspectiveCamera(2 * Math.atan(h / 2 / VIEW_DIST) * (180 / Math.PI), w / h, 200, 4000);
    camera.position.z = VIEW_DIST;
    const can = canisterMesh(label, env);
    can.scale.setScalar(k);
    can.rotation.set(10 * DEG, -8 * DEG, 0);
    const shadow = blob(300 * k, 80 * k);
    shadow.rotation.x = -90 * DEG;
    shadow.position.y = -158 * k;
    shadow.material.opacity = theme === "light" ? 0.3 : 0.55;
    scene.add(can, shadow);
    let raf = 0;
    let alive = true;
    const draw = () => {
      raf = 0;
      if (alive) renderer.render(scene, camera);
    };
    const kick = () => {
      if (!raf && alive) raf = requestAnimationFrame(draw);
    };
    kick();
    return {
      el: canvas,
      spin(px) {
        can.spin(px);
        kick();
      },
      refresh() {
        can.relabel();
        kick();
      },
      setTheme(next) {
        lights.setTheme(next);
        shadow.material.opacity = next === "light" ? 0.3 : 0.55;
        kick();
      },
      destroy() {
        alive = false;
        cancelAnimationFrame(raf);
        disposeTree(scene);
        env.dispose();
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        canvas.remove();
      },
    };
  }

  window.PhotographyGL = { grid, album, prints, canister };
})();
