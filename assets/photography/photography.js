/*
 * /photography/ — collections from _data/photography.yml shown as 3D objects on a map.
 *
 * The layout embeds the data as JSON (#ph-data). Each collection becomes a grid cell (a film roll, an album or a pile
 * of prints) and a pin on the map canvas behind the page. Opening a collection flies the map to its coordinates and
 * shows the full object in a dialog. Browsing uses the `preview` files; the `full` file is only requested when a
 * photograph is opened at full size.
 *
 * Every object is first built from plain elements with CSS 3D transforms. Where WebGL is available and the image host
 * allows cross-origin use of its files, photography-gl.js then draws the same objects as real meshes in their place.
 * Add ?gl=0 to the address to stay with the CSS version.
 */
(() => {
  "use strict";

  const dataEl = document.getElementById("ph-data");
  if (!dataEl) return;
  let DATA = {};
  try {
    DATA = JSON.parse(dataEl.textContent) || {};
  } catch (err) {
    DATA = {};
  }

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SMOOTH = REDUCED ? "auto" : "smooth";
  const root = document.documentElement;
  const $ = (s, from = document) => from.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = (n) => String(n).padStart(2, "0");
  // h("div", { class: "a", text: "b" }, child, [children]) -> element
  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    }
    n.append(...kids.flat(2).filter((x) => x != null && x !== false));
    return n;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hashStr = (s) => {
    let x = 2166136261;
    for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
    return x >>> 0;
  };

  /* ---------- light and dark ---------- */
  // The setting lives in localStorage under the same key the rest of the site uses, so the choice carries across pages.
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const themeWatchers = [];
  const themeSetting = () => {
    try {
      return localStorage.getItem("theme") || root.getAttribute("data-theme-setting") || "system";
    } catch (err) {
      return root.getAttribute("data-theme-setting") || "system";
    }
  };
  const currentTheme = () => {
    const a = root.getAttribute("data-theme");
    return a === "light" || a === "dark" ? a : darkQuery.matches ? "dark" : "light";
  };
  function setThemeSetting(setting) {
    try {
      localStorage.setItem("theme", setting);
    } catch (err) {
      /* storage is unavailable; the choice lasts for this visit */
    }
    root.setAttribute("data-theme-setting", setting);
    root.setAttribute("data-theme", setting === "system" ? (darkQuery.matches ? "dark" : "light") : setting);
  }
  let lastTheme = currentTheme();
  function themeMaybeChanged() {
    const now = currentTheme();
    const toggle = $("#theme-toggle");
    if (toggle) {
      const setting = themeSetting();
      const label = setting === "system" ? "auto" : setting;
      toggle.textContent = label;
      toggle.dataset.setting = setting;
      toggle.setAttribute("aria-label", `Colour theme: ${label}. Change theme.`);
    }
    if (now === lastTheme) return;
    lastTheme = now;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
    themeWatchers.forEach((fn) => fn(now));
  }
  darkQuery.addEventListener("change", () => {
    if (root.hasAttribute("data-theme-setting") && themeSetting() === "system") root.setAttribute("data-theme", darkQuery.matches ? "dark" : "light");
    themeMaybeChanged();
  });
  new MutationObserver(themeMaybeChanged).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  const toggleEl = $("#theme-toggle");
  if (toggleEl) {
    // same order as the switch on the other pages: system, light, dark
    toggleEl.addEventListener("click", () => {
      const s = themeSetting();
      setThemeSetting(s === "system" ? "light" : s === "light" ? "dark" : "system");
      themeMaybeChanged();
    });
  }
  themeMaybeChanged();

  /* ---------- data ---------- */
  const HOST = String(DATA.host || "").replace(/\/+$/, "");
  const fileUrl = (p) => (!p ? "" : /^(https?:)?\/\//.test(p) ? p : (HOST ? HOST + "/" : "") + String(p).replace(/^\/+/, ""));
  const slug = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const KIND = { roll: "35mm roll", album: "Album", prints: "Loose prints" };
  // default colours, taken in turn so two collections of the same kind do not look alike
  const LOOKS = {
    roll: [
      { label: ["#e9a43f", "#17130e"] },
      { label: ["#ff4f8b", "#12101c"] },
      { label: ["#4fc4b4", "#0e1716"] },
      { label: ["#e8583a", "#170f0c"] },
    ],
    album: [
      { cover: "#a5482f", paper: "#efe7d6", ink: "#2b2219", foil: "#f6e3b4", foil2: "#c2924f", corner: "#3a2d20", e1: "#ebe4d3", e2: "#c8bfab" },
      { cover: "#43264a", paper: "#19181c", ink: "#e9e2d4", foil: "#f3cdb8", foil2: "#b47e66", corner: "#d8cfbd", e1: "#2c2a30", e2: "#121114" },
      { cover: "#27473c", paper: "#efe7d6", ink: "#2b2219", foil: "#f1e2b6", foil2: "#b99a55", corner: "#3a2d20", e1: "#ebe4d3", e2: "#c8bfab" },
      { cover: "#1f2d4d", paper: "#19181c", ink: "#e9e2d4", foil: "#e6d3a8", foil2: "#a8905c", corner: "#d8cfbd", e1: "#2c2a30", e2: "#121114" },
    ],
    prints: [{ border: "#f2efe8" }, { border: "#f4f6f8" }],
  };
  const seen = { roll: 0, album: 0, prints: 0 };
  const COLS = (Array.isArray(DATA.collections) ? DATA.collections : [])
    .map((c, i) => {
      if (!c || !Array.isArray(c.photos)) return null;
      const kind = c.kind === "stack" ? "prints" : KIND[c.kind] ? c.kind : "roll";
      const photos = c.photos
        .map((p) => (typeof p === "string" ? { full: p } : p))
        .filter((p) => p && (p.full || p.preview))
        .map((p) => ({
          full: fileUrl(p.full || p.preview),
          preview: fileUrl(p.preview || p.full),
          thumb: fileUrl(p.thumb || p.preview || p.full),
          alt: p.alt || "",
          caption: p.caption || "",
          ratio: p.width > 0 && p.height > 0 ? p.width / p.height : 0,
        }));
      if (!photos.length) return null;
      const place = c.place || "";
      const defaults = LOOKS[kind][seen[kind]++ % LOOKS[kind].length];
      const coords =
        Array.isArray(c.coords) && c.coords.length === 2 && c.coords.every((v) => typeof v === "number" && isFinite(v)) ? c.coords : null;
      return {
        id: slug(c.id || c.title) || "collection-" + (i + 1),
        kind,
        title: c.title || "Untitled",
        place,
        pin: c.pin || place.split(",")[0] || c.title || "",
        country: String(c.country || "").toUpperCase(),
        region: c.region || "",
        date: c.date || "",
        coords,
        note: c.note || "",
        film: c.film || "RW 400",
        look: Object.assign({}, defaults, c.look || {}),
        photos,
      };
    })
    .filter(Boolean);

  const ratio = (p) => p.ratio || 1.5;
  const fmtCoords = ([lat, lng]) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;
  const dotted = (...parts) => parts.filter(Boolean).join(" · ");
  const count = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const lookVars = (c) => {
    const L = c.look;
    if (c.kind === "album")
      return `--cover:${L.cover};--paper:${L.paper};--page-ink:${L.ink};--foil:${L.foil};--foil2:${L.foil2 || L.foil};--corner:${
        L.corner || L.ink
      };--e1:${L.e1 || L.paper};--e2:${L.e2 || L.paper}`;
    return c.kind === "prints" ? `--border:${L.border}` : "";
  };

  /* ---------- WebGL, if it can be used ---------- */
  const GL = /[?&]gl=0\b/.test(location.search) ? null : window.PhotographyGL || null;
  // set once at start-up: true when photography-gl.js is present and the photographs may be drawn into textures
  let useGL = false;
  let glGrid = null;
  let active = null; // the opened collection's view: { setTheme, refresh, destroy }
  // WebGL may only read images served with cross-origin permission; ask for the first one that way and see
  function probeGL() {
    const first = COLS.length ? COLS[0].photos[0].thumb : "";
    if (!GL || !first) return Promise.resolve(false);
    try {
      if (new URL(first, location.href).origin === location.origin) return Promise.resolve(true);
    } catch (err) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const im = new Image();
      const timer = setTimeout(() => resolve(false), 2500);
      const done = (ok) => {
        clearTimeout(timer);
        resolve(ok);
      };
      im.crossOrigin = "anonymous";
      im.onload = () => done(true);
      im.onerror = () => done(false);
      im.src = first;
    });
  }

  /*
   * An <img> for photograph `fi` at one of the sizes thumb | preview | full.
   * `box` is the element whose shape follows the photograph: it gets --ar (width / height) and the class "p" for
   * portrait, from the data first and from the real file once it has loaded.
   * With lazy = true nothing is requested until img.load() is called.
   */
  function pic(c, fi, size, box, lazy) {
    const p = c.photos[fi];
    const img = h("img", { alt: "", decoding: "async", draggable: "false" });
    if (useGL) img.crossOrigin = "anonymous";
    const shape = () => {
      if (!box) return;
      box.style.setProperty("--ar", ratio(p).toFixed(4));
      box.classList.toggle("p", ratio(p) < 1);
    };
    img.addEventListener("load", () => {
      if (img.naturalWidth && img.naturalHeight) p.ratio = img.naturalWidth / img.naturalHeight;
      img.classList.add("ready");
      shape();
    });
    // a dropped connection should not leave a hole: ask once more
    let retried = false;
    img.addEventListener("error", () => {
      if (retried) return;
      retried = true;
      setTimeout(() => {
        img.removeAttribute("src");
        img.src = p[size];
      }, 1500);
    });
    img.load = () => {
      if (!img.getAttribute("src")) img.src = p[size];
    };
    shape();
    if (!lazy) img.load();
    return img;
  }

  /* ---------- shared pieces of the three objects ---------- */
  const CAN = { N: 24, R: 92, H: 312 };
  CAN.w = 2 * CAN.R * Math.tan(Math.PI / CAN.N);
  CAN.LW = CAN.N * CAN.w;
  const labels = []; // every label canvas, so they can be painted again once the web fonts are in
  function vgrad(ctx, y0, y1, stops) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    for (const [p, col] of stops) g.addColorStop(p, col);
    return g;
  }
  // the canister label: wrapped around the cylinder as a background image (CSS) or a texture (WebGL)
  function paintLabel(cv, c) {
    const W = cv.width;
    const H = cv.height;
    const x = cv.getContext("2d");
    const [a, b] = c.look.label;
    x.fillStyle = b;
    x.fillRect(0, 0, W, H);
    x.fillStyle = a;
    x.fillRect(0, H * 0.16, W, H * 0.43);
    x.fillRect(0, H * 0.655, W, H * 0.012);
    x.fillRect(0, H * 0.685, W, H * 0.012);
    for (let k = 0; k < 2; k++) {
      const ox = (k * W) / 2 + W * 0.035;
      x.fillStyle = b;
      x.textBaseline = "alphabetic";
      x.font = `700 ${H * 0.2}px Archivo, Arial, sans-serif`;
      x.fillText(c.film.toUpperCase(), ox, H * 0.42, W * 0.33);
      x.font = `500 ${H * 0.052}px "DM Mono", monospace`;
      x.fillText(`135 · ${c.photos.length} EXP`, ox, H * 0.525, W * 0.33);
      x.fillStyle = a;
      x.fillText(c.title.toUpperCase(), ox, H * 0.79, W * 0.44);
      x.fillText(dotted(c.pin, c.date).toUpperCase(), ox, H * 0.86, W * 0.44);
      const bits = hashStr(c.id + k);
      const dx = ox + W * 0.385;
      for (let j = 0; j < 12; j++) {
        x.fillStyle = (bits >> j) & 1 ? "#cfd2d8" : "#0b0b0c";
        x.fillRect(dx + (j % 2) * H * 0.046, H * 0.17 + Math.floor(j / 2) * H * 0.07, H * 0.046, H * 0.07);
      }
    }
    for (const y of [0, H * 0.925]) {
      x.fillStyle = vgrad(x, y, y + H * 0.075, [
        [0, "#e3e5e9"],
        [0.5, "#8f9299"],
        [1, "#c8cace"],
      ]);
      x.fillRect(0, y, W, H * 0.075);
    }
    x.fillStyle = "rgba(0,0,0,.45)";
    x.fillRect(0, H * 0.075, W, H * 0.006);
    x.fillRect(0, H * 0.919, W, H * 0.006);
  }
  // `after` runs whenever the label has been (re)painted
  function labelCanvas(c, after) {
    const cv = document.createElement("canvas");
    cv.width = Math.round(CAN.LW * 2);
    cv.height = CAN.H * 2;
    paintLabel(cv, c);
    labels.push({ cv, c, after });
    return cv;
  }
  // the CSS canister: 24 flat facets around a cylinder, the label spread across them
  function buildCanister(c) {
    const body = h("div", { class: "can-body", style: `--lw:${CAN.LW.toFixed(2)}px` });
    const cv = labelCanvas(c, () => body.isConnected && body.style.setProperty("--label", `url(${cv.toDataURL()})`));
    body.style.setProperty("--label", `url(${cv.toDataURL()})`);
    // baked lighting: each facet is darkened by how far it faces away from a light at the upper left
    const shade = (th) => {
      const cos = Math.cos(((th + 38) * Math.PI) / 180);
      const spec = Math.abs(th + 38) < 9;
      return `rgba(${spec ? "255,255,255" : "0,0,0"},${spec ? 0.17 : clamp(0.5 * (1 - cos), 0, 0.82).toFixed(3)})`;
    };
    const facet = (th, fw, r, extra) =>
      h("i", {
        style: `width:${(fw + 0.7).toFixed(2)}px;margin-left:${(-fw / 2).toFixed(2)}px;transform:rotateY(${th}deg) translateZ(${r}px);--sh:${shade(
          th
        )}${extra}`,
      });
    for (let k = 0; k < CAN.N; k++) body.append(facet(((k + 0.5) * 360) / CAN.N - 180, CAN.w, CAN.R, `;--o:${(-k * CAN.w).toFixed(2)}px`));
    const knob = h("div", { class: "can-knob" });
    const kn = 12;
    const kr = 30;
    const kw = 2 * kr * Math.tan(Math.PI / kn);
    for (let k = 0; k < kn; k++) knob.append(facet(((k + 0.5) * 360) / kn - 180, kw, kr, ""));
    knob.append(h("b"));
    const el = h(
      "div",
      { class: "can", "aria-hidden": "true" },
      h("div", { class: "can-3d" }, h("div", { class: "can-shadow" }), body, h("div", { class: "can-top" }), knob, h("div", { class: "can-lip" }))
    );
    return { el, body };
  }
  // text on canvases is first drawn with fallback fonts; draw it again once the web fonts are in
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      for (const l of labels) {
        paintLabel(l.cv, l.c);
        if (l.after) l.after();
      }
      if (glGrid) glGrid.refresh();
      if (active && active.refresh) active.refresh();
    });
  }

  const edges = (c, fi) => [
    h("span", { class: "edge t l", "aria-hidden": "true", text: c.film }),
    h("span", { class: "edge t r", "aria-hidden": "true", text: c.pin }),
    h("span", { class: "edge b l", "aria-hidden": "true", text: String(fi + 1) }),
    h("span", { class: "edge b c", "aria-hidden": "true", text: `${fi + 1}A` }),
  ];
  const coverLeaf = (c, size) =>
    h(
      "div",
      { class: "leaf cover", style: "--i:-1" },
      h(
        "div",
        { class: "face front" },
        h("span", { class: "foil-sm", text: c.pin }),
        h("span", { class: "foil", text: c.title }),
        h("div", { class: "plate" }, pic(c, 0, size)),
        h("span", { class: "foil-sm", text: c.date })
      ),
      h(
        "div",
        { class: "face back" },
        h("p", { class: "end-title", text: c.title }),
        h("p", { class: "end-note", text: c.note }),
        h("p", { class: "end-meta", text: dotted(c.place, c.date, `${c.photos.length} photographs`) })
      )
    );
  function pageLeaf(c, fi, size, rnd, lazy) {
    const n = c.photos.length;
    const mount = h("div", { class: "mount", style: `--mr:${((rnd() - 0.5) * 2.6).toFixed(2)}deg` });
    const img = pic(c, fi, size, mount, lazy);
    mount.append(img, h("i"), h("i"), h("i"), h("i"));
    const leaf = h(
      "div",
      { class: "leaf", style: `--i:${fi}` },
      h(
        "div",
        { class: "face front" },
        mount,
        h("p", { class: "page-cap", text: c.photos[fi].caption }),
        h("span", { class: "page-no", text: pad2(fi + 1) })
      ),
      h(
        "div",
        { class: "face back" },
        fi < n - 1
          ? [h("span", { class: "back-no", text: pad2(fi + 2) }), h("p", { class: "back-cap", text: c.photos[fi + 1].caption || c.place })]
          : null
      )
    );
    leaf.img = img;
    return leaf;
  }
  const bookShell = (...leaves) => [
    h("div", { class: "book-back" }),
    h("div", { class: "book-edge r" }),
    h("div", { class: "book-edge b" }),
    ...leaves,
  ];

  /* ---------- the map under the page ---------- */
  const WORLD = window.__phWorld || null;
  const MAPW = 900;
  const MAPH = 440.706;
  const K0 = 3; // canvas pixels per map unit
  // Miller projection centred on 11.5°E, matching the world outline data; returns map units (900 wide).
  function mapXY([lat, lng]) {
    const R = 6381372;
    const RAD = Math.PI / 180;
    const x0 = -20004297.15;
    const x1 = 20026572.39;
    const y0 = -12671671.12;
    const y1 = 6930392.03;
    let l = lng - 11.5;
    if (l < -180) l += 360;
    return [((R * l * RAD - x0) / (x1 - x0)) * MAPW, (((-R * Math.log(Math.tan((45 + 0.4 * lat) * RAD))) / 0.8 - y0) / (y1 - y0)) * MAPH];
  }
  const PTS = COLS.map((c) => (c.coords ? mapXY(c.coords) : null));
  const backdrop = $("#backdrop");
  const bdMap = $("#bd-map");
  const mapWin = $("#map-win");
  const worldPaths = WORLD && WORLD.paths && window.Path2D ? Object.entries(WORLD.paths).map(([code, p]) => [code, new Path2D(p.path)]) : [];
  // painted again whenever the theme changes: the colours come from the stylesheet
  function drawWorld() {
    const ctx = bdMap.getContext("2d");
    const css = getComputedStyle(root);
    const v = (k) => css.getPropertyValue(k).trim();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bdMap.width, bdMap.height);
    ctx.setTransform(K0, 0, 0, K0, 0, 0);
    ctx.lineWidth = 0.3;
    ctx.strokeStyle = v("--grid-line");
    ctx.beginPath();
    for (let lng = -150; lng <= 180; lng += 30) {
      const x = mapXY([0, lng])[0];
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAPH);
    }
    for (let lat = -45; lat <= 75; lat += 15) {
      const y = mapXY([lat, 0])[1];
      ctx.moveTo(0, y);
      ctx.lineTo(MAPW, y);
    }
    ctx.stroke();
    const on = new Set(COLS.map((c) => c.country).filter(Boolean));
    ctx.lineWidth = 0.35;
    ctx.lineJoin = "round";
    ctx.strokeStyle = v("--coast");
    for (const [code, path] of worldPaths) {
      ctx.fillStyle = on.has(code) ? v("--land-on") : v("--land");
      ctx.fill(path);
      ctx.stroke(path);
    }
  }
  drawWorld();
  const pins = COLS.map((c, i) => {
    if (!PTS[i]) return null;
    const p = h(
      "button",
      { class: "pin", type: "button", "aria-label": `${dotted(c.title, c.place)}. Open this collection.` },
      h("b"),
      h("b"),
      h("b"),
      h("i"),
      h("span", { text: c.pin })
    );
    p.addEventListener("click", () => openCollection(i));
    backdrop.append(p);
    return p;
  });

  /* ---------- motion: one loop drives the map camera and every tilting object ---------- */
  const tilts = new Set();
  // `el` leans towards the pointer while it is over `zone`; sx / sy add a lean that follows the scroll position
  function addTilt(el, zone, o) {
    const t = Object.assign({ el, zone, px: 0, py: 0, tx: 0, ty: 0, sc: 0, ax: 8, ay: 6, sx: 0, sy: 0 }, o);
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || REDUCED) return;
      const b = zone.getBoundingClientRect();
      t.tx = clamp(((e.clientX - b.left) / b.width - 0.5) * 2, -1, 1);
      t.ty = clamp(((e.clientY - b.top) / b.height - 0.5) * 2, -1, 1);
      kick();
    });
    zone.addEventListener("pointerleave", () => {
      t.tx = t.ty = 0;
      kick();
    });
    tilts.add(t);
    return t;
  }
  // camera: a point on screen is (map point - m) * s + a
  const cam = { ls: 0, mx: 450, my: 200, ax: 0, ay: 0, ready: false };
  let target = null;
  let modeKey = "";
  let raf = 0;
  let scrollDirty = true;
  let openIdx = -1;
  let vAnchor = null;
  const cells = [];
  const hiddenCell = (i) => !!cells[i] && cells[i].hidden;
  function computeTarget() {
    const vw = root.clientWidth;
    const vh = innerHeight;
    // an open collection: its place sits under the object
    if (openIdx >= 0 && vAnchor && PTS[openIdx]) {
      const a = vAnchor.getBoundingClientRect();
      return {
        key: "open",
        idx: openIdx,
        s: clamp(vw / 250, 3.3, 5.2),
        mx: PTS[openIdx][0],
        my: PTS[openIdx][1],
        ax: a.left + a.width / 2,
        ay: clamp(a.top + a.height / 2, vh * 0.3, vh * 0.7),
      };
    }
    const win = mapWin.getBoundingClientRect();
    // while the hero is on screen: every visible pin fits inside the viewfinder
    if (openIdx < 0 && win.bottom > vh * 0.28) {
      const vis = COLS.map((c, i) => i).filter((i) => PTS[i] && !hiddenCell(i));
      if (!vis.length)
        return {
          key: "over",
          idx: -1,
          s: Math.min(win.width / MAPW, win.height / 330),
          mx: 450,
          my: 190,
          ax: win.left + win.width / 2,
          ay: win.top + win.height / 2,
          vis,
        };
      const xs = vis.map((i) => PTS[i][0]);
      const ys = vis.map((i) => PTS[i][1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      return {
        key: "over",
        idx: -1,
        s: clamp(Math.min(win.width / (x1 - x0 + 150), (win.height - 30) / (y1 - y0 + 70)), 0.25, 3.2),
        mx: (x0 + x1) / 2 + 14,
        my: (y0 + y1) / 2,
        ax: win.left + win.width / 2,
        ay: win.top + win.height / 2 - 8,
        vis,
      };
    }
    // further down the page: the whole world, dimmed, behind the grid
    return { key: "wide", idx: -1, s: Math.max(vw / MAPW, vh / MAPH) * 1.04, mx: 450, my: 205, ax: vw / 2, ay: vh / 2 };
  }
  function applyMode(T) {
    const key = T.key + T.idx + (T.vis ? T.vis.join("") : "");
    if (key === modeKey) return;
    modeKey = key;
    backdrop.dataset.mode = T.key;
    pins.forEach((p, i) => {
      if (!p) return;
      p.hidden = hiddenCell(i);
      p.classList.toggle("active", T.idx === i);
      p.classList.toggle("dim", T.idx >= 0 && T.idx !== i);
    });
    if (T.key !== "over") return;
    // each label takes the first free spot around its pin: right, left, above, below
    const vw = root.clientWidth;
    const at = (i) => [(PTS[i][0] - T.mx) * T.s + T.ax, (PTS[i][1] - T.my) * T.s + T.ay];
    const dots = T.vis.map((i) => {
      const [x, y] = at(i);
      return [x - 8, y - 7, x + 8, y + 7, i];
    });
    const placed = [];
    const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    [...T.vis]
      .sort((a, b) => at(b)[0] - at(a)[0])
      .forEach((i) => {
        const [x, y] = at(i);
        const w = (pins[i].lastElementChild.offsetWidth || COLS[i].pin.length * 7) + 4;
        const spots = {
          right: [x + 13, y - 7, x + 17 + w, y + 7],
          left: [x - 17 - w, y - 7, x - 13, y + 7],
          above: [x - w / 2, y - 29, x + w / 2, y - 12],
          below: [x - w / 2, y + 12, x + w / 2, y + 29],
        };
        const free = (b) => b[0] > 4 && b[2] < vw - 4 && !placed.some((p) => hit(b, p)) && !dots.some((d) => d[4] !== i && hit(b, d));
        const side = Object.keys(spots).find((k) => free(spots[k])) || "right";
        placed.push(spots[side]);
        for (const k of ["left", "above", "below"]) pins[i].classList.toggle(k, k === side);
      });
  }
  function frame() {
    raf = 0;
    const vh = innerHeight;
    let moving = false;
    for (const t of tilts) {
      if (scrollDirty && (t.sx || t.sy)) {
        const b = t.zone.getBoundingClientRect();
        t.sc = REDUCED ? 0 : clamp(((b.top + b.bottom) / 2 - vh / 2) / (vh * 0.6), -1, 1);
      }
      t.px += (t.tx - t.px) * 0.12;
      t.py += (t.ty - t.py) * 0.12;
      t.el.style.setProperty("--tx", (t.px * t.ax + t.sc * t.sx).toFixed(2));
      t.el.style.setProperty("--ty", (-t.py * t.ay + t.sc * t.sy).toFixed(2));
      if (Math.abs(t.tx - t.px) + Math.abs(t.ty - t.py) > 0.004) moving = true;
    }
    scrollDirty = false;
    const T = target || (target = computeTarget());
    applyMode(T);
    const ls = Math.log(T.s);
    if (!cam.ready || REDUCED) {
      Object.assign(cam, { ls, mx: T.mx, my: T.my, ax: T.ax, ay: T.ay, ready: true });
    } else {
      // the map point eases slowly (the flight); the screen anchor follows quickly (scrolling)
      const k = 0.075;
      const ka = 0.24;
      cam.ls += (ls - cam.ls) * k;
      cam.mx += (T.mx - cam.mx) * k;
      cam.my += (T.my - cam.my) * k;
      cam.ax += (T.ax - cam.ax) * ka;
      cam.ay += (T.ay - cam.ay) * ka;
    }
    const s = Math.exp(cam.ls);
    bdMap.style.transform = `translate3d(${(cam.ax - cam.mx * s).toFixed(2)}px,${(cam.ay - cam.my * s).toFixed(2)}px,0) scale(${(s / K0).toFixed(
      5
    )})`;
    pins.forEach((p, i) => {
      if (p)
        p.style.transform = `translate3d(${((PTS[i][0] - cam.mx) * s + cam.ax).toFixed(1)}px,${((PTS[i][1] - cam.my) * s + cam.ay).toFixed(1)}px,0)`;
    });
    if (
      Math.abs(ls - cam.ls) > 0.002 ||
      (Math.abs(T.mx - cam.mx) + Math.abs(T.my - cam.my)) * s > 0.4 ||
      Math.abs(T.ax - cam.ax) + Math.abs(T.ay - cam.ay) > 0.4
    )
      moving = true;
    if (moving) kick();
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  const moved = () => {
    target = null;
    scrollDirty = true;
    kick();
  };
  addEventListener("scroll", moved, { passive: true });
  addEventListener("resize", () => {
    modeKey = "";
    setPad();
    fitGrid();
    moved();
  });
  themeWatchers.push((theme) => {
    drawWorld();
    if (glGrid) glGrid.setTheme(theme);
    if (active && active.setTheme) active.setTheme(theme);
  });

  /* ---------- the grid ---------- */
  const grid = $("#grid");
  const chipsEl = $("#chips");
  // each builder returns the CSS object plus what the WebGL version needs: the <img>s by photograph number
  function miniRoll(c) {
    const film = h("div", { class: "film" });
    const imgs = [];
    // the frame nearest the canister is listed first, so frame 1 is the one furthest out
    for (const fi of c.photos.length > 1 ? [1, 0] : [0]) {
      const frame = h("div", { class: "frame" }, edges(c, fi));
      imgs[fi] = pic(c, fi, "thumb", frame);
      frame.prepend(imgs[fi]);
      film.append(frame);
    }
    return { el: h("div", { class: "obj mini-roll" }, h("div", { class: "leader" }, film), buildCanister(c).el), imgs };
  }
  function miniAlbum(c) {
    const leaf = pageLeaf(c, 0, "thumb", rng(hashStr(c.id) + 7));
    return { el: h("div", { class: "obj mini-book" }, h("div", { class: "book" }, bookShell(leaf, coverLeaf(c, "thumb")))), imgs: [leaf.img] };
  }
  function miniPrints(c) {
    const rnd = rng(hashStr(c.id) + 99);
    const m = Math.min(5, c.photos.length);
    const prints = [];
    const imgs = [];
    const pile = [];
    for (let p = 0; p < m; p++) {
      const pos = { r: p ? (rnd() - 0.5) * 13 : -2, x: p ? (rnd() - 0.5) * 26 : 0, y: p ? (rnd() - 0.5) * 18 : 0, z: (m - 1 - p) * 2.6 };
      const print = h("div", {
        class: "print",
        style: `--p:${p};--x:${pos.x.toFixed(1)}px;--y:${pos.y.toFixed(1)}px;--z:${pos.z.toFixed(1)}px;--r:${pos.r.toFixed(2)}deg`,
      });
      imgs[p] = pic(c, p, "thumb", print);
      print.append(imgs[p]);
      prints.push(print);
      pile.push(pos);
    }
    return { el: h("div", { class: "obj mini-pile" }, prints.reverse()), imgs, pile };
  }
  function buildGrid() {
    if (useGL) {
      try {
        glGrid = GL.grid({ host: $(".page") });
        glGrid.setTheme(currentTheme());
      } catch (err) {
        glGrid = null;
      }
    }
    COLS.forEach((c, i) => {
      const n = c.photos.length;
      const mini = (c.kind === "roll" ? miniRoll : c.kind === "album" ? miniAlbum : miniPrints)(c);
      const tiltEl = h("div", { class: "tilt" }, mini.el);
      const stage = h(
        "div",
        { class: "cell-stage", "aria-hidden": "true" },
        h("div", { class: "fit" }, h("div", { class: "float", style: `animation-delay:${(-i * 1.3).toFixed(1)}s` }, tiltEl))
      );
      const hit = h("button", {
        class: "cell-hit",
        type: "button",
        "aria-label": `Open ${dotted(c.title + ": " + KIND[c.kind], `${n} photographs`, c.place, c.date)}`,
      });
      const cell = h(
        "article",
        { class: "cell", style: `--n:${i};--d:${(-i * 1.7).toFixed(1)}s;${lookVars(c)}` },
        stage,
        h(
          "div",
          { class: "cell-text" },
          h("p", { class: "kicker", text: `${KIND[c.kind]} · ${n}` }),
          h("h3", { text: c.title }),
          h("p", { class: "cell-meta", text: dotted(c.place, c.date) })
        ),
        hit
      );
      hit.addEventListener("click", () => openCollection(i));
      for (const [ev, on] of [
        ["pointerenter", true],
        ["pointerleave", false],
        ["focusin", true],
        ["focusout", false],
      ])
        cell.addEventListener(ev, () => pins[i] && pins[i].classList.toggle("hot", on));
      const tilt = addTilt(tiltEl, cell, { ax: 10, ay: 8, sx: -3, sy: 6 });
      cells.push(cell);
      grid.append(cell);
      if (!glGrid) return;
      // the WebGL object takes over the cell once its first photograph is in; until then the CSS one shows
      try {
        glGrid.add({
          stage,
          c,
          imgs: mini.imgs,
          pile: mini.pile,
          label: c.kind === "roll" ? labelCanvas(c) : null,
          tilt,
          hot: () => cell.matches(":hover, :focus-within"),
          index: i,
          onReady: () => cell.classList.add("gl-on"),
        });
      } catch (err) {
        /* this cell keeps its CSS object */
      }
    });
  }
  // objects are built for a 400px-wide cell and scaled to whatever the grid gives them
  function fitGrid() {
    const c = cells.find((x) => !x.hidden);
    if (c && c.clientWidth) grid.style.setProperty("--k", (c.clientWidth / 400).toFixed(4));
  }
  function buildChrome() {
    const years = COLS.map((c) => +(String(c.date).match(/\d{4}/) || [])[0]).filter(Boolean);
    $("#stats").textContent = dotted(
      count(COLS.length, "collection"),
      COLS.length
        ? count(
            COLS.reduce((a, c) => a + c.photos.length, 0),
            "photograph"
          )
        : "",
      years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : ""
    );
    $("#empty").hidden = COLS.length > 0;
    $("#map-hint").hidden = !pins.some(Boolean);
    const regions = [...new Set(COLS.map((c) => c.region).filter(Boolean))];
    if (regions.length < 2) {
      chipsEl.hidden = true;
      return;
    }
    const chip = (label, value, n) =>
      h(
        "button",
        { class: "chip", type: "button", "data-region": value, "aria-pressed": String(value === "") },
        label,
        h("span", { class: "chip-n", text: String(n) })
      );
    chipsEl.append(chip("All", "", COLS.length), ...regions.map((g) => chip(g, g, COLS.filter((c) => c.region === g).length)));
    chipsEl.addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      for (const other of chipsEl.children) other.setAttribute("aria-pressed", String(other === b));
      COLS.forEach((c, i) => {
        cells[i].hidden = b.dataset.region !== "" && c.region !== b.dataset.region;
      });
      modeKey = "";
      fitGrid();
      moved();
      if (glGrid) glGrid.kick();
    });
  }
  function setPad() {
    const w = $(".wrap");
    const left = w.getBoundingClientRect().left + (parseFloat(getComputedStyle(w).paddingLeft) || 16);
    root.style.setProperty("--pad", Math.round(left) + "px");
  }

  /* ---------- an opened collection ---------- */
  const viewer = $("#viewer");
  const vBody = $("#v-body");
  let vTilts = [];
  const btn = (label, aria, cls) => h("button", { class: "btn" + (cls ? " " + cls : ""), type: "button", "aria-label": aria }, label);
  const textBlock = (c) =>
    h(
      "div",
      { class: "v-text" },
      h("p", { class: "kicker", text: dotted(KIND[c.kind], c.coords && fmtCoords(c.coords)) }),
      h("h2", { id: "v-title", text: c.title }),
      h(
        "p",
        { class: "meta" },
        c.place && h("span", { text: c.place }),
        c.date && h("span", { text: c.date }),
        h("span", { text: count(c.photos.length, "photograph") })
      ),
      c.note && h("p", { class: "note", text: c.note })
    );
  const vTilt = (el, zone, o) => vTilts.push(addTilt(el, zone, o));
  const cssPx = (el, name) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;
  /*
   * Each view returns { el, anchor, focus(), mount(), ready(), setTheme, refresh, destroy }.
   * mount() runs once `el` is in the document, which is when sizes can be measured and a WebGL canvas created.
   */

  function viewRoll(c, ci) {
    const n = c.photos.length;
    const film = h("div", { class: "film" });
    const frames = c.photos.map((p, fi) => {
      const f = h(
        "button",
        {
          class: "frame",
          type: "button",
          tabindex: fi ? "-1" : "0",
          "aria-label": `Frame ${fi + 1} of ${n}${p.caption || p.alt ? ": " + (p.caption || p.alt) : ""}. Open full size.`,
        },
        edges(c, fi)
      );
      const img = pic(c, fi, "preview", f, true);
      img.loading = "lazy"; // frames further along the roll load as they come near
      img.load();
      f.prepend(img);
      f.addEventListener("click", () => openFull(ci, fi));
      film.append(f);
      return f;
    });
    const can = buildCanister(c);
    const strip = h("div", { class: "strip", role: "group", "aria-label": `${n} photographs on a roll. Arrow keys move between frames.` }, film);
    const out = h("b", { text: "1" });
    const back = btn("‹", "Wind the film back", "round");
    const fwd = btn("›", "Pull more film out", "round");
    const tilt = h("div", { class: "tilt roll-3d" }, strip, can.el);
    const stage = h("div", { class: "roll-stage" }, h("div", { class: "enter" }, tilt));
    const el = h(
      "div",
      { class: "v-kind v-roll" },
      h(
        "div",
        { class: "wrap v-head" },
        textBlock(c),
        h("div", { class: "ctl" }, h("span", { class: "count", "aria-hidden": "true" }, out, ` / ${n}`), back, fwd)
      ),
      stage
    );
    let glCan = null; // the WebGL canister, when there is one; the film itself always stays in the page
    const startPad = () => parseFloat(getComputedStyle(strip).scrollPaddingLeft) || 0;
    let raf2 = 0;
    function update() {
      raf2 = 0;
      // the strip runs past the right edge of the screen, so only part of its width counts as visible
      const L = strip.scrollLeft + startPad() - 24;
      const R = strip.scrollLeft + strip.clientWidth - stage.clientWidth * 0.24;
      let a = -1;
      let b = -1;
      let best = 0;
      let bestV = -1;
      frames.forEach((f, i) => {
        const l = f.offsetLeft;
        const w = f.offsetWidth;
        const v = Math.min(l + w, R) - Math.max(l, L);
        if (v > bestV) {
          bestV = v;
          best = i;
        }
        if (v >= w * 0.6) {
          if (a < 0) a = i;
          b = i;
        }
      });
      if (a < 0) a = b = best;
      out.textContent = a === b ? String(a + 1) : `${a + 1}–${b + 1}`;
      back.disabled = strip.scrollLeft <= 1;
      fwd.disabled = strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1;
      // pulling film turns the spool
      const spin = -strip.scrollLeft * 0.45;
      can.body.style.setProperty("--spin", spin.toFixed(1) + "px");
      if (glCan) glCan.spin(spin);
    }
    strip.addEventListener(
      "scroll",
      () => {
        if (!raf2) raf2 = requestAnimationFrame(update);
      },
      { passive: true }
    );
    for (const [b, d] of [
      [back, -1],
      [fwd, 1],
    ])
      b.addEventListener("click", () => strip.scrollBy({ left: d * Math.max(220, stage.clientWidth * 0.55), behavior: SMOOTH }));
    strip.addEventListener("keydown", (e) => {
      const i = frames.indexOf(document.activeElement);
      if (i < 0) return;
      const j =
        e.key === "ArrowRight"
          ? Math.min(n - 1, i + 1)
          : e.key === "ArrowLeft"
            ? Math.max(0, i - 1)
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? n - 1
                : -1;
      if (j < 0) return;
      e.preventDefault();
      if (j === i) return;
      frames[i].tabIndex = -1;
      frames[j].tabIndex = 0;
      frames[j].focus({ preventScroll: true });
      strip.scrollTo({ left: frames[j].offsetLeft - startPad(), behavior: SMOOTH });
    });
    // drag the film with a mouse; touch and trackpads scroll it natively
    let down = null;
    let dragged = false;
    strip.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = { x: e.clientX, left: strip.scrollLeft, id: e.pointerId };
      dragged = false;
    });
    strip.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (!dragged && Math.abs(dx) > 6) {
        dragged = true;
        strip.classList.add("dragging");
        try {
          strip.setPointerCapture(down.id);
        } catch (err) {
          /* the pointer is already gone */
        }
      }
      if (dragged) strip.scrollLeft = down.left - dx;
    });
    const release = () => {
      if (down && dragged) strip.classList.remove("dragging");
      down = null;
    };
    strip.addEventListener("pointerup", release);
    strip.addEventListener("pointercancel", release);
    strip.addEventListener(
      "click",
      (e) => {
        if (!dragged) return;
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
      },
      true
    );
    vTilt(tilt, stage, { ax: 3.5, ay: 2.5 });
    return {
      el,
      anchor: can.el,
      focus: () => frames[0].focus({ preventScroll: true }),
      mount() {
        if (!useGL) return;
        try {
          glCan = GL.canister({
            host: can.el,
            label: labelCanvas(c, () => glCan && glCan.refresh()),
            k: cssPx(el, "--can-k") || 1,
            theme: currentTheme(),
          });
          can.el.classList.add("gl-on");
        } catch (err) {
          glCan = null;
        }
      },
      ready: update,
      setTheme: (t) => glCan && glCan.setTheme(t),
      refresh: () => glCan && glCan.refresh(),
      destroy: () => glCan && glCan.destroy(),
    };
  }

  function viewAlbum(c, ci) {
    const n = c.photos.length;
    const counter = h("span", { class: "count", "aria-live": "polite" });
    const cap = h("p", { class: "cap" });
    const bOpen = btn("Open album");
    const bPrev = btn("‹", "Previous page", "round");
    const bNext = btn("›", "Next page", "round");
    const bFull = btn("Full size", "Open this photograph full size");
    const stage = h("div", { class: "stage" });
    const text = textBlock(c);
    text.append(
      h("div", { class: "ctl" }, bOpen, bPrev, counter, bNext, bFull),
      cap,
      h("p", { class: "tip", text: "Tap the right page to turn it, the left page to go back" })
    );
    const el = h("div", { class: "v-kind v-album wrap duo", style: lookVars(c) }, text, stage);
    let open = false;
    let pos = 0;
    let book = null; // whichever version draws the album: { focusEl, set(open, pos), load(i), ... }

    function sync() {
      stage.classList.toggle("is-open", open);
      // only the pages around the open one are fetched
      for (let i = pos - 1; i <= pos + 2; i++) book.load(i);
      book.set(open, pos);
      counter.textContent = open ? `${pos + 1} / ${n}` : count(n, "page");
      cap.textContent = open ? c.photos[pos].caption : "";
      bOpen.textContent = open ? "Close album" : "Open album";
      bPrev.disabled = !open || pos === 0;
      bNext.disabled = open && pos === n - 1;
      bFull.disabled = !open;
    }
    const next = () => {
      if (!open) open = true;
      else if (pos < n - 1) pos++;
      else return;
      sync();
    };
    const prev = () => {
      if (!open) return;
      if (pos > 0) pos--;
      else open = false;
      sync();
    };
    bOpen.addEventListener("click", () => {
      open = !open;
      sync();
    });
    bPrev.addEventListener("click", prev);
    bNext.addEventListener("click", next);
    bFull.addEventListener("click", () => openFull(ci, pos));

    // the CSS album: a cover and leaves that are separate elements turning on the spine
    function cssBook() {
      const rnd = rng(hashStr(c.id) + 7);
      const cover = coverLeaf(c, "preview");
      const leaves = c.photos.map((p, fi) => pageLeaf(c, fi, "preview", rnd, true));
      const node = h(
        "div",
        {
          class: "book",
          tabindex: "0",
          role: "group",
          "aria-roledescription": "photo album",
          "aria-label": `Album of ${n} photographs. Enter opens it; the arrow keys turn pages.`,
        },
        bookShell(...[...leaves].reverse(), cover)
      );
      const tilt = h("div", { class: "tilt" }, node);
      stage.append(h("div", { class: "enter" }, h("div", { class: "float" }, h("div", { class: "pose book-pose" }, tilt))));
      let swiped = false;
      let sx = null;
      node.addEventListener("click", (e) => {
        if (swiped) {
          swiped = false;
          return;
        }
        const leaf = e.target.closest(".leaf");
        if (open && leaf && leaf.classList.contains("flipped")) prev();
        else next();
      });
      node.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          next();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          prev();
        }
      });
      node.addEventListener("pointerdown", (e) => {
        sx = e.clientX;
        swiped = false;
      });
      node.addEventListener("pointerup", (e) => {
        if (sx === null) return;
        const dx = e.clientX - sx;
        sx = null;
        if (Math.abs(dx) <= 40) return;
        swiped = true;
        if (dx < 0) next();
        else prev();
      });
      node.addEventListener("pointercancel", () => {
        sx = null;
      });
      vTilt(tilt, stage, { ax: 8, ay: 6 });
      return {
        focusEl: node,
        load: (i) => leaves[i] && leaves[i].img.load(),
        set(isOpen, at) {
          cover.classList.toggle("flipped", isOpen);
          leaves.forEach((l, i) => l.classList.toggle("flipped", isOpen && i < at));
        },
      };
    }
    // the WebGL album: photography-gl.js draws it from the same photographs
    function glBook() {
      const imgs = c.photos.map((p, fi) => pic(c, fi, "preview", null, true));
      const narrow = matchMedia("(max-width: 860px)");
      const dims = { pw: cssPx(el, "--pw"), ph: cssPx(el, "--ph"), bd: cssPx(el, "--bd") };
      const g = GL.album({
        stage,
        c,
        cover: pic(c, 0, "preview"),
        imgs,
        dims,
        theme: currentTheme(),
        shift: () => (narrow.matches ? -dims.pw / 2 + 6 : 0),
        onNext: next,
        onPrev: prev,
      });
      return { focusEl: g.el, load: (i) => imgs[i] && imgs[i].load(), set: g.set, setTheme: g.setTheme, refresh: g.refresh, destroy: g.destroy };
    }
    return {
      el,
      anchor: stage,
      focus: () => book && book.focusEl.focus({ preventScroll: true }),
      mount() {
        if (useGL) {
          try {
            book = glBook();
          } catch (err) {
            book = null;
          }
        }
        if (!book) book = cssBook();
        sync();
      },
      // the album opens itself shortly after it arrives
      ready() {
        const openUp = () => {
          if (!el.isConnected || open) return;
          open = true;
          sync();
        };
        if (REDUCED) openUp();
        else setTimeout(openUp, 900);
      },
      setTheme: (t) => book && book.setTheme && book.setTheme(t),
      refresh: () => book && book.refresh && book.refresh(),
      destroy: () => book && book.destroy && book.destroy(),
    };
  }

  function viewPrints(c, ci) {
    const n = c.photos.length;
    const counter = h("span", { class: "count", "aria-live": "polite" });
    const cap = h("p", { class: "cap" });
    const bPrev = btn("‹", "Bring the previous print back", "round");
    const bNext = btn("›", "Move the top print to the bottom", "round");
    const bFull = btn("Full size", "Open the top print full size");
    const stage = h("div", { class: "stage" });
    const text = textBlock(c);
    text.append(h("div", { class: "ctl" }, bPrev, counter, bNext, bFull), cap, h("p", { class: "tip", text: "Tap the top print, or drag it away" }));
    const el = h("div", { class: "v-kind v-stack wrap duo", style: lookVars(c) }, text, stage);
    // every print gets an <img>; only the top few, and the one that would come back from the bottom, are fetched
    const boxes = c.photos.map(() => h("div", { class: "print" }));
    const imgs = c.photos.map((p, fi) => pic(c, fi, "preview", boxes[fi], true));
    let pileView = null; // whichever version draws the pile: { focusEl, deal(dir), top() }
    const onChange = (top, wanted) => {
      counter.textContent = `${top + 1} / ${n}`;
      cap.textContent = c.photos[top].caption;
      wanted.forEach((j) => j != null && imgs[j].load());
    };
    bPrev.addEventListener("click", () => pileView.deal(-1));
    bNext.addEventListener("click", () => pileView.deal(1));
    bFull.addEventListener("click", () => openFull(ci, pileView.top()));

    function cssPile() {
      const rnd = rng(hashStr(c.id) + 99);
      const prints = boxes.map((e, fi) => {
        e.append(imgs[fi]);
        e.rot = fi ? (rnd() - 0.5) * 13 : -2;
        e.dx = fi ? (rnd() - 0.5) * 28 : 0;
        e.dy = fi ? (rnd() - 0.5) * 20 : 0;
        return e;
      });
      const pile = h(
        "div",
        {
          class: "pile",
          tabindex: "0",
          role: "group",
          "aria-roledescription": "pile of prints",
          "aria-label": `Pile of ${n} prints. The arrow keys move through them; Enter opens the top print full size.`,
        },
        [...prints].reverse()
      );
      const tilt = h("div", { class: "tilt" }, pile);
      stage.append(h("div", { class: "enter" }, h("div", { class: "float" }, h("div", { class: "pose pile-pose" }, tilt))));
      let order = prints.map((_, i) => i); // order[0] is the print on top
      let fan = false;
      let busy = false;
      let drag = null;
      // where print i sits when it is p-th from the top; `o` adds an offset on top of that
      const pose = (i, p, o = {}) => {
        const e = prints[i];
        const f = fan ? Math.min(p, 6) : 0;
        const x = e.dx + f * 22 + (o.x || 0);
        const y = e.dy - f * 5 + (o.y || 0);
        const z = (n - 1 - p) * 2.6 + (o.z || 0);
        return `translate(-50%,-50%) translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,${z.toFixed(1)}px) rotateZ(${(
          e.rot +
          f * 2.2 +
          (o.r || 0)
        ).toFixed(2)}deg) rotateY(${(o.ry || 0).toFixed(1)}deg)`;
      };
      const layout = () =>
        order.forEach((i, p) => {
          prints[i].style.transform = pose(i, p);
          prints[i].classList.toggle("top", p === 0);
        });
      const tell = () => onChange(order[0], [order[0], order[1], order[2], order[n - 1]]);
      // the dealt print lifts, swings out to the side, drops to the desk and slides back under the pile
      function deal(dir, from, side = 1) {
        if (busy || n < 2) return;
        busy = true;
        const i = dir > 0 ? order[0] : order[n - 1];
        const e = prints[i];
        const w = e.offsetWidth * 1.06 * side;
        const start = from || pose(i, dir > 0 ? 0 : n - 1);
        if (dir > 0) order.push(order.shift());
        else order.unshift(order.pop());
        const hi = pose(i, n - 1, { x: w, y: -26, z: n * 2.6 + 64, r: 13 * side, ry: -16 * side });
        const lo = pose(i, n - 1, { x: w, y: -8, r: 8 * side });
        layout();
        tell();
        const kf =
          dir > 0
            ? [{ transform: start }, { transform: hi, offset: 0.36 }, { transform: lo, offset: 0.6 }, { transform: pose(i, n - 1) }]
            : [{ transform: start }, { transform: lo, offset: 0.36 }, { transform: hi, offset: 0.62 }, { transform: pose(i, 0) }];
        const done = () => {
          busy = false;
        };
        if (!e.animate) return done();
        const a = e.animate(kf, { duration: REDUCED ? 1 : 880, easing: "cubic-bezier(.45,.05,.3,1)" });
        a.onfinish = a.oncancel = done;
      }
      pile.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          deal(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          deal(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          openFull(ci, order[0]);
        }
      });
      pile.addEventListener("pointerdown", (e) => {
        const top = prints[order[0]];
        if (busy || e.button > 0 || !top.contains(e.target)) return;
        drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false, el: top };
        try {
          top.setPointerCapture(e.pointerId);
        } catch (err) {
          /* the pointer is already gone */
        }
      });
      pile.addEventListener("pointermove", (e) => {
        if (!drag) return;
        drag.dx = e.clientX - drag.x;
        drag.dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(drag.dx, drag.dy) > 7) {
          drag.moved = true;
          drag.el.style.transition = "none";
        }
        if (drag.moved)
          drag.el.style.transform = pose(order[0], 0, { x: drag.dx, y: drag.dy, z: 50, r: drag.dx * 0.04, ry: clamp(drag.dx * 0.05, -16, 16) });
      });
      const drop = (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        d.el.style.transition = "";
        if (!d.moved) {
          if (e.type === "pointerup") deal(1);
        } else if (Math.hypot(d.dx, d.dy) > 90) {
          deal(1, d.el.style.transform, d.dx < 0 ? -1 : 1);
        } else {
          layout();
        }
      };
      pile.addEventListener("pointerup", drop);
      pile.addEventListener("pointercancel", drop);
      stage.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        fan = true;
        if (!busy && !drag) layout();
      });
      stage.addEventListener("pointerleave", () => {
        fan = false;
        if (!busy && !drag) layout();
      });
      layout();
      tell();
      vTilt(tilt, stage, { ax: 9, ay: 7 });
      return { focusEl: pile, deal: (dir) => deal(dir), top: () => order[0] };
    }
    function glPile() {
      const g = GL.prints({ stage, c, imgs, prw: () => cssPx(el, "--prw"), theme: currentTheme(), onChange, onFull: (i) => openFull(ci, i) });
      return { focusEl: g.el, deal: g.deal, top: g.top, setTheme: g.setTheme, refresh: g.refresh, destroy: g.destroy };
    }
    return {
      el,
      anchor: stage,
      focus: () => pileView && pileView.focusEl.focus({ preventScroll: true }),
      mount() {
        if (useGL) {
          try {
            pileView = glPile();
          } catch (err) {
            pileView = null;
          }
        }
        if (!pileView) pileView = cssPile();
      },
      setTheme: (t) => pileView && pileView.setTheme && pileView.setTheme(t),
      refresh: () => pileView && pileView.refresh && pileView.refresh(),
      destroy: () => pileView && pileView.destroy && pileView.destroy(),
    };
  }

  const setHash = (id) => {
    try {
      history.replaceState(null, "", id ? "#" + id : location.pathname + location.search);
    } catch (err) {
      /* history is unavailable, e.g. in a sandboxed frame */
    }
  };
  function closeView() {
    vTilts.forEach((t) => tilts.delete(t));
    vTilts = [];
    if (active && active.destroy) active.destroy();
    active = null;
  }
  function openCollection(i) {
    const c = COLS[i];
    closeView();
    const v = (c.kind === "roll" ? viewRoll : c.kind === "album" ? viewAlbum : viewPrints)(c, i);
    vBody.replaceChildren(v.el);
    openIdx = i;
    vAnchor = v.anchor;
    active = v;
    root.classList.add("v-open");
    if (glGrid) glGrid.pause(true);
    if (!viewer.open) viewer.showModal();
    viewer.scrollTop = 0;
    if (v.mount) v.mount();
    v.focus();
    setHash(c.id);
    moved();
    // two frames later the object has been laid out in its starting pose and can animate in
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        v.el.classList.add("in");
        if (v.ready) v.ready();
        moved();
      })
    );
  }
  $("#v-close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("scroll", moved, { passive: true });
  viewer.addEventListener("close", () => {
    root.classList.remove("v-open");
    openIdx = -1;
    vAnchor = null;
    closeView();
    vBody.replaceChildren();
    if (glGrid) glGrid.pause(false);
    setHash("");
    moved();
  });
  // /photography/#collection-id opens that collection
  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const i = id ? COLS.findIndex((c) => c.id === id) : -1;
    if (i >= 0 && i !== openIdx) openCollection(i);
  }
  addEventListener("hashchange", openFromHash);

  /* ---------- one photograph at full size ---------- */
  const lb = $("#lb");
  const lbImg = $("#lb-img");
  const lbUrl = $("#lb-url");
  const lbCopy = $("#lb-copy");
  const lbStage = $("#lb-stage");
  const lbStatus = $("#lb-status");
  let cur = null;
  let loadToken = 0;
  function showFull() {
    const c = COLS[cur.ci];
    const n = c.photos.length;
    const p = c.photos[cur.fi];
    const token = ++loadToken;
    // the preview is already in the cache, so it shows at once while the full-size file downloads
    lbImg.src = p.preview;
    lbImg.alt = p.alt || p.caption || `${c.title}, photograph ${cur.fi + 1}`;
    lbStatus.textContent = "· loading";
    const big = new Image();
    big.onload = () => {
      if (token !== loadToken) return;
      lbImg.src = p.full;
      lbStatus.textContent = `· ${big.naturalWidth} × ${big.naturalHeight}`;
    };
    big.onerror = () => {
      if (token === loadToken) lbStatus.textContent = "· full-size file unavailable";
    };
    big.src = p.full;
    $("#lb-roll").textContent = c.title;
    $("#lb-pos").textContent = `${cur.fi + 1} / ${n}`;
    $("#lb-cap").textContent = p.caption;
    $("#lb-place").textContent = dotted(c.place, c.date);
    lbUrl.value = new URL(p.full, location.href).href;
    $("#lb-open").href = p.full;
    $("#lb-prev").disabled = cur.fi === 0;
    $("#lb-next").disabled = cur.fi === n - 1;
  }
  function openFull(ci, fi) {
    cur = { ci, fi };
    showFull();
    if (lb.open) return;
    lb.showModal();
    root.classList.add("lb-open");
  }
  function stepFull(d) {
    const j = cur.fi + d;
    if (j < 0 || j >= COLS[cur.ci].photos.length) return;
    cur.fi = j;
    showFull();
  }
  $("#lb-prev").addEventListener("click", () => stepFull(-1));
  $("#lb-next").addEventListener("click", () => stepFull(1));
  $("#lb-close").addEventListener("click", () => lb.close());
  lbStage.addEventListener("click", (e) => {
    if (e.target === lbStage) lb.close();
  });
  lb.addEventListener("keydown", (e) => {
    if (e.target === lbUrl) return;
    if (e.key === "ArrowRight") stepFull(1);
    else if (e.key === "ArrowLeft") stepFull(-1);
  });
  let touchX = null;
  let touchY = null;
  lbStage.addEventListener(
    "touchstart",
    (e) => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    },
    { passive: true }
  );
  lbStage.addEventListener(
    "touchend",
    (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      touchX = null;
      if (Math.abs(dx) > 48 && Math.abs(dy) < 60) stepFull(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
  lb.addEventListener("close", () => {
    root.classList.remove("lb-open");
    loadToken++;
    lbImg.removeAttribute("src");
  });
  let copyTimer = 0;
  lbCopy.addEventListener("click", async () => {
    let label = "Copied";
    try {
      await navigator.clipboard.writeText(lbUrl.value);
    } catch (err) {
      lbUrl.focus();
      lbUrl.select();
      label = "Selected";
    }
    lbCopy.textContent = label;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      lbCopy.textContent = "Copy link";
    }, 1800);
  });

  /* ---------- start ---------- */
  setPad();
  kick();
  // the grid waits for one answer: can the photographs be used as WebGL textures?
  probeGL().then((ok) => {
    useGL = ok;
    root.dataset.render = ok ? "webgl" : "css";
    buildGrid();
    buildChrome();
    if ("ResizeObserver" in window)
      new ResizeObserver(() => {
        fitGrid();
        modeKey = "";
        moved();
      }).observe(grid);
    fitGrid();
    modeKey = "";
    moved();
    openFromHash();
  });
})();
