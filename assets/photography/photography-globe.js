/*
 * /photography/ — the globe under the page.
 *
 * Draws the world as a ball on a 2D canvas (an orthographic view; d3-geo cuts the shapes at the horizon) and, for an
 * opened collection, its route: arcs between the places the photographs were taken and a marker on the current one.
 * The world is drawn as shapes, not as a picture, so it stays sharp at any zoom, and it needs no WebGL.
 *
 *   const globe = PhotographyGlobe.create({ canvas, root });
 *   globe.draw(view, scene, now)
 *     view  = { lam, phi, R, cx, cy }   the place facing the viewer (degrees), the disc's radius and centre (CSS px)
 *     scene = { route, pos, born, hop, still }   see drawRoute
 *   globe.project(view, lat, lng)  ->  [x, y, facing the viewer?]
 *   globe.makeRoute(stops, order, loose)  ->  the route in the form draw() wants
 *   globe.bounds(route, lam, phi)  ->  the box the route fills on the disc when that place faces the viewer
 *
 * The outlines come from the files named by the canvas's data-world (coarse) and data-world-detail (finer, fetched
 * when the view gets close). Without d3-geo and topojson-client window.PhotographyGlobe stays undefined and the page
 * goes on without a map.
 */
(() => {
  "use strict";
  const d3 = window.d3;
  const topojson = window.topojson;
  if (!d3 || !d3.geoOrthographic || !topojson || !topojson.feature) return;

  const RAD = Math.PI / 180;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const unit = (lat, lng) => {
    const k = Math.cos(lat * RAD);
    return [k * Math.cos(lng * RAD), k * Math.sin(lng * RAD), Math.sin(lat * RAD)];
  };
  const angle = (a, b) => Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
  // the point a fraction t of the way from a to b along the great circle through them
  function along(a, b, t, th) {
    if (th < 1e-7) return a;
    const s = Math.sin(th);
    const p = Math.sin((1 - t) * th) / s;
    const q = Math.sin(t * th) / s;
    return [a[0] * p + b[0] * q, a[1] * p + b[1] * q, a[2] * p + b[2] * q];
  }
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  // each country with where it is and how far it reaches, so that the ones out of view are not even projected
  function prepare(topology) {
    return topojson.feature(topology, topology.objects.countries).features.map((f) => {
      const [lng, lat] = d3.geoCentroid(f);
      const c = unit(lat, lng);
      let r = 0;
      const g = f.geometry;
      const polys = !g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys)
        for (const p of poly[0]) {
          const a = angle(c, unit(p[1], p[0]));
          if (a > r) r = a;
        }
      return { f, id: String(f.id), c, r, on: false };
    });
  }

  function create({ canvas, root }) {
    const ctx = canvas.getContext("2d");
    const proj = d3.geoOrthographic().clipAngle(90).precision(0.5);
    const path = d3.geoPath(proj, ctx);
    const lines = { wide: d3.geoGraticule().step([30, 15])() };
    const urls = { lo: canvas.dataset.world || "", hi: canvas.dataset.worldDetail || "" };
    let W = 1;
    let H = 1;
    let dpr = 1;
    let lo = null;
    let hi = null;
    let hiAsked = false;
    let places = [];
    let C = {};
    let font = "sans-serif";
    let changed = () => {};

    // colours arrive from the stylesheet in whatever notation it uses; gradients need them with a set opacity
    const probe = document.createElement("canvas").getContext("2d");
    const memo = new Map();
    function rgba(color, alpha) {
      const key = color + "|" + alpha;
      if (memo.has(key)) return memo.get(key);
      probe.fillStyle = "#000";
      probe.fillStyle = color;
      const s = String(probe.fillStyle);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 1;
      if (s[0] === "#") {
        r = parseInt(s.slice(1, 3), 16);
        g = parseInt(s.slice(3, 5), 16);
        b = parseInt(s.slice(5, 7), 16);
      } else {
        const m = (s.match(/[\d.]+/g) || []).map(Number);
        [r, g, b] = m;
        if (m.length > 3) a = m[3];
      }
      const out = `rgba(${r},${g},${b},${+(a * alpha).toFixed(3)})`;
      memo.set(key, out);
      return out;
    }

    function setTheme() {
      const css = getComputedStyle(root);
      const v = (k) => css.getPropertyValue(k).trim();
      C = {
        land: v("--land"),
        landOn: v("--land-on"),
        coast: v("--coast"),
        grid: v("--grid-line"),
        accent: v("--accent"),
        glow: v("--accent-glow"),
        ink: v("--ink"),
        muted: v("--muted"),
        bg: v("--bg"),
        oceanA: v("--ocean-a"),
        oceanB: v("--ocean-b"),
        halo: v("--halo"),
        shade: v("--globe-shade"),
        shine: v("--globe-shine"),
      };
      font = v("--sans") || "sans-serif";
    }
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth || 1;
      H = canvas.clientHeight || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      // shapes are cut at the window's edge: a close view would otherwise hand the canvas corners millions of
      // pixels away
      proj.clipExtent([
        [-60, -60],
        [W + 60, H + 60],
      ]);
    }

    // the countries that hold one of the places are tinted
    function mark() {
      if (!lo) return;
      const ids = new Set();
      for (const [lat, lng] of places) {
        const u = unit(lat, lng);
        const hit = lo.find((it) => angle(it.c, u) <= it.r + 0.01 && d3.geoContains(it.f, [lng, lat]));
        if (hit) ids.add(hit.id);
      }
      for (const list of [lo, hi]) if (list) for (const it of list) it.on = ids.has(it.id);
    }
    const load = (url) =>
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        })
        .then(prepare);
    const ready = urls.lo
      ? load(urls.lo)
          .then((list) => {
            lo = list;
            mark();
            changed();
          })
          .catch(() => {
            lo = null;
          })
      : Promise.resolve();
    function wantDetail() {
      if (hiAsked || !urls.hi) return;
      hiAsked = true;
      load(urls.hi)
        .then((list) => {
          hi = list;
          mark();
          changed();
        })
        .catch(() => {
          /* the coarse outlines stay */
        });
    }

    /* ---------- where things land on the canvas ---------- */
    // rows: to the right, up, towards the viewer
    function basis(v) {
      const l = v.lam * RAD;
      const p = v.phi * RAD;
      const sl = Math.sin(l);
      const cl = Math.cos(l);
      const sp = Math.sin(p);
      const cp = Math.cos(p);
      return [-sl, cl, 0, -cl * sp, -sl * sp, cp, cl * cp, sl * cp, sp];
    }
    // u: a point on the unit ball, lift: how far above the surface it floats (in radii). The third value says
    // whether it can be seen: on the near side, or high enough to show past the edge of the disc.
    function place(m, v, u, lift) {
      const x = m[0] * u[0] + m[1] * u[1];
      const y = m[3] * u[0] + m[4] * u[1] + m[5] * u[2];
      const z = m[6] * u[0] + m[7] * u[1] + m[8] * u[2];
      const k = 1 + lift;
      return [v.cx + v.R * k * x, v.cy - v.R * k * y, z >= 0 || (x * x + y * y) * k * k >= 1];
    }
    const project = (v, lat, lng) => place(basis(v), v, unit(lat, lng), 0);

    /* ---------- the ball ---------- */
    function draw(v, s, now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!lo || !(v.R > 0)) return;
      const { cx, cy, R } = v;
      proj.rotate([-v.lam, -v.phi]).scale(R).translate([cx, cy]);
      const disc = () => {
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
      };
      // the air around it
      let g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.14);
      g.addColorStop(0, C.halo);
      g.addColorStop(1, rgba(C.halo, 0));
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.14, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();
      // the sea, lighter where the light falls
      g = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.05, cx, cy, R);
      g.addColorStop(0, C.oceanA);
      g.addColorStop(1, C.oceanB);
      disc();
      ctx.fillStyle = g;
      ctx.fill();
      // what part of the ball is in the window: around the point under the window's middle, when the disc is much
      // larger than the window; otherwise the whole near side
      if (R > 900) wantDetail();
      const list = R > 1300 && hi ? hi : lo;
      let centre = unit(v.phi, v.lam);
      const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
      let cap = far >= R ? Math.PI / 2 : Math.asin(far / R);
      const mx = (W / 2 - cx) / R;
      const my = (cy - H / 2) / R;
      if (mx * mx + my * my < 0.8) {
        const mz = Math.sqrt(1 - mx * mx - my * my);
        const b = basis(v);
        const around = Math.hypot(W, H) / 2 / (R * mz);
        if (around < cap) {
          centre = [b[0] * mx + b[3] * my + b[6] * mz, b[1] * mx + b[4] * my + b[7] * mz, b[2] * mx + b[5] * my + b[8] * mz];
          cap = around;
        }
      }
      // meridians and parallels: the usual ones from afar; up close, finer ones around what is in view, spaced
      // to stay a few hundred pixels apart
      ctx.beginPath();
      if (R <= 2600 || cap > 0.6) path(lines.wide);
      else {
        const step = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01].find((d) => d * RAD * R < 420) || 0.01;
        const lat = Math.asin(clamp(centre[2], -1, 1)) / RAD;
        const lng = Math.atan2(centre[1], centre[0]) / RAD;
        const a = Math.min(cap / RAD + step, 60);
        const al = Math.min(a / Math.max(Math.cos(lat * RAD), 0.2), 170);
        const snap = (x) => Math.floor(x / step) * step;
        path(
          d3
            .geoGraticule()
            .extent([
              [snap(lng - al), Math.max(snap(lat - a), -85)],
              [snap(lng + al) + step, Math.min(snap(lat + a) + step, 85)],
            ])
            .step([step, step])
            .precision(step / 4)()
        );
      }
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = C.grid;
      ctx.stroke();
      // the land: only what can be in view is projected
      ctx.lineWidth = 0.7;
      ctx.lineJoin = "round";
      ctx.strokeStyle = C.coast;
      for (const on of [false, true]) {
        // the tinted countries go last, so that their outlines lie on top
        let any = false;
        ctx.beginPath();
        for (const it of list) {
          if (it.on !== on || angle(centre, it.c) > cap + it.r + 0.02) continue;
          path(it.f);
          any = true;
        }
        if (!any) continue;
        ctx.fillStyle = on ? C.landOn : C.land;
        ctx.fill();
        ctx.stroke();
      }
      // shade towards the edge and a little shine make the disc a ball
      g = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R);
      g.addColorStop(0, rgba(C.shade, 0));
      g.addColorStop(1, C.shade);
      disc();
      ctx.fillStyle = g;
      ctx.fill();
      g = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.5, 0, cx - R * 0.45, cy - R * 0.5, R * 0.95);
      g.addColorStop(0, C.shine);
      g.addColorStop(1, rgba(C.shine, 0));
      disc();
      ctx.fillStyle = g;
      ctx.fill();
      disc();
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.coast;
      ctx.stroke();
      if (s && s.route) drawRoute(v, s, now);
    }

    /* ---------- the route of the opened collection ---------- */
    // stops: [{ lat, lng, label }], order: the stops in the order the photographs visit them (a stop may come back).
    // Every leg is an arc that rises above the surface, the higher the longer it is. A loose route has no legs:
    // its stops are places that do not make a journey.
    function makeRoute(stops, order, loose) {
      const S = stops.map((p) => Object.assign({}, p, { u: unit(p.lat, p.lng) }));
      const legs = [];
      for (let i = 1; !loose && i < order.length; i++) {
        const a = S[order[i - 1]].u;
        const b = S[order[i]].u;
        const th = angle(a, b);
        const n = clamp(Math.ceil(th / (1.5 * RAD)), 14, 80);
        const peak = clamp(th * 0.5, 0.002, 0.42);
        const pts = [];
        for (let k = 0; k <= n; k++) pts.push([along(a, b, k / n, th), peak * Math.sin((Math.PI * k) / n)]);
        legs.push({ pts, th });
      }
      // when each stop is first reached
      const first = S.map((_, k) => order.indexOf(k));
      return { stops: S, order, legs, first, loose: !!loose };
    }
    // The box the route fills on the disc (stops and arcs) when (lam, phi) faces the viewer: in radii, from the
    // disc's centre, y downwards as on screen. Null when part of it is on the far side.
    function bounds(r, lam, phi) {
      const m = basis({ lam, phi });
      const one = { cx: 0, cy: 0, R: 1 };
      const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      let hidden = false;
      const add = (u, lift) => {
        const p = place(m, one, u, lift);
        if (m[6] * u[0] + m[7] * u[1] + m[8] * u[2] < 0.05) hidden = true;
        b.x0 = Math.min(b.x0, p[0]);
        b.x1 = Math.max(b.x1, p[0]);
        b.y0 = Math.min(b.y0, p[1]);
        b.y1 = Math.max(b.y1, p[1]);
      };
      for (const s of r.stops) add(s.u, 0);
      for (const leg of r.legs) for (const p of leg.pts) add(p[0], p[1]);
      return hidden || !Number.isFinite(b.x0) ? null : b;
    }

    // part of a leg, from t0 to t1 of its length, as a line on the canvas; lifted or flat on the ground
    function trace(m, v, leg, t0, t1, lifted) {
      const n = leg.pts.length - 1;
      const a = t0 * n;
      const b = t1 * n;
      let pen = false;
      let last = null;
      for (let k = Math.floor(a); k <= Math.ceil(b); k++) {
        const kk = clamp(k, a, b);
        const i = Math.min(n - 1, Math.floor(kk));
        const f = kk - i;
        const p = leg.pts[i];
        const q = leg.pts[i + 1];
        const u = [p[0][0] + (q[0][0] - p[0][0]) * f, p[0][1] + (q[0][1] - p[0][1]) * f, p[0][2] + (q[0][2] - p[0][2]) * f];
        const at = place(m, v, u, lifted ? p[1] + (q[1] - p[1]) * f : 0);
        if (!at[2]) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(at[0], at[1]);
        else {
          ctx.moveTo(at[0], at[1]);
          pen = true;
        }
        last = at;
      }
      return last;
    }

    /*
     * scene.route  from makeRoute
     * scene.pos    where along route.order the current photograph is (-1: none, the whole route is shown evenly)
     * scene.born   when the collection was opened; the legs draw themselves in from then on
     * scene.hop    { leg, dir, t0 }: the photograph just moved one stop along this leg; a spark runs along it
     * scene.still  no animation (reduced motion)
     */
    function drawRoute(v, s, now) {
      const r = s.route;
      const m = basis(v);
      const n = r.legs.length;
      const per = r.loose ? 130 : clamp(2000 / Math.max(n, 1), 110, 460);
      const grown = s.still ? Infinity : (now - s.born - 420) / per; // legs drawn so far, the last one partly
      const frac = (i) => clamp(grown - i, 0, 1);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // the ground track under every arc gives the eye its height
      ctx.beginPath();
      for (let i = 0; i < n; i++) if (frac(i) > 0) trace(m, v, r.legs[i], 0, frac(i), false);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.ink, 0.16);
      ctx.stroke();

      // legs still ahead of the current photograph: faint and dashed
      const ahead = (i) => s.pos >= 0 && i >= s.pos;
      ctx.beginPath();
      for (let i = 0; i < n; i++) if (ahead(i) && frac(i) > 0) trace(m, v, r.legs[i], 0, frac(i), true);
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(C.accent, 0.8);
      ctx.stroke();
      ctx.setLineDash([]);

      // legs already travelled: solid, with a glow
      ctx.beginPath();
      for (let i = 0; i < n; i++) if (!ahead(i) && frac(i) > 0) trace(m, v, r.legs[i], 0, frac(i), true);
      ctx.shadowColor = C.glow;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = C.accent;
      ctx.stroke();

      // a spark along the leg just taken
      if (s.hop && !s.still && r.legs[s.hop.leg]) {
        const t = (now - s.hop.t0) / 900;
        if (t >= 0 && t < 1) {
          const e = ease(t);
          const head = s.hop.dir > 0 ? e : 1 - e;
          const tail = s.hop.dir > 0 ? Math.max(0, head - 0.22) : Math.min(1, head + 0.22);
          ctx.beginPath();
          trace(m, v, r.legs[s.hop.leg], Math.min(head, tail), Math.max(head, tail), true);
          ctx.lineWidth = 3.4;
          ctx.strokeStyle = C.accent;
          ctx.shadowBlur = 16;
          ctx.stroke();
          const tip = (() => {
            ctx.beginPath();
            return trace(m, v, r.legs[s.hop.leg], head, head, true);
          })();
          if (tip) {
            ctx.beginPath();
            ctx.arc(tip[0], tip[1], 3.6, 0, TAU);
            ctx.fillStyle = C.accent;
            ctx.fill();
          }
        }
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      // the stops
      const cur = s.pos >= 0 ? r.order[s.pos] : -1;
      const few = r.stops.length <= 10;
      const names = []; // drawn after every dot, so that none lies under a dot or over another name
      ctx.textBaseline = "middle";
      r.stops.forEach((p, k) => {
        if (k !== r.order[0] && grown < r.first[k]) return; // its leg has not reached it yet
        const at = place(m, v, p.u, 0);
        if (!at[2]) return;
        const [x, y] = at;
        const seen = r.loose || s.pos < 0 || r.first[k] <= s.pos;
        if (k === cur) {
          if (!s.still)
            for (const off of [0, 0.5]) {
              const ph = (now / 2000 + off) % 1;
              ctx.beginPath();
              ctx.arc(x, y, 6 + 26 * ph, 0, TAU);
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = rgba(C.accent, 0.7 * (1 - ph));
              ctx.stroke();
            }
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, TAU);
          ctx.fillStyle = rgba(C.accent, 0.2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, 5.5, 0, TAU);
          ctx.fillStyle = C.accent;
          ctx.shadowColor = C.glow;
          ctx.shadowBlur = 14;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          ctx.beginPath();
          ctx.arc(x, y, 1.9, 0, TAU);
          ctx.fillStyle = C.bg;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, 3.4, 0, TAU);
          ctx.fillStyle = seen ? C.accent : C.bg;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = seen ? C.bg : C.accent;
          ctx.stroke();
        }
        if (p.label && (k === cur || few)) names.push({ k, x, y, text: p.label });
      });
      // the current stop's name comes first and always shows; another is left out where it would run into a name
      // already placed or into the current stop's marker
      const taken = [];
      const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
      names.sort((a, b) => (b.k === cur) - (a.k === cur));
      for (const nm of names) {
        const on = nm.k === cur;
        ctx.font = `${on ? 600 : 500} ${on ? 13 : 11.5}px ${font}`;
        const lx = nm.x + (on ? 17 : 9);
        const box = [lx - 3, nm.y - 9, lx + ctx.measureText(nm.text).width + 3, nm.y + 9];
        if (on) taken.push([nm.x - 15, nm.y - 15, nm.x + 15, nm.y + 15]);
        else if (taken.some((t) => hit(box, t))) continue;
        taken.push(box);
        ctx.lineWidth = 4;
        ctx.strokeStyle = rgba(C.bg, 0.85);
        ctx.fillStyle = on ? C.ink : C.muted;
        ctx.strokeText(nm.text, lx, nm.y);
        ctx.fillText(nm.text, lx, nm.y);
      }
    }

    setTheme();
    resize();
    return {
      ready,
      has: () => !!lo,
      resize,
      setTheme,
      draw,
      project,
      makeRoute,
      bounds,
      setPlaces(list) {
        places = list;
        mark();
      },
      onChange(fn) {
        changed = fn;
      },
    };
  }

  window.PhotographyGlobe = { create };
})();
