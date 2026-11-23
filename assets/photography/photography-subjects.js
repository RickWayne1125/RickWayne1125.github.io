/*
 * /photography/ — the four subjects.
 *
 * Journeys are collections someone made; subjects are not. Each subject gathers, from every journey, the photographs
 * that were sorted into it, and shows them in its own way:
 *   food       a round table with a turntable: every photograph is a dish on a plate; turning the table serves the next
 *   landscape  the viewfinder of an old camera: the shutter closes, the film is wound on, the next view is there
 *   people     a slide projector: the slide drops out, the tray clicks round, the next one is thrown on the wall
 *   animals    a field notebook: the photograph taped to the right page, where and when written on the left
 *
 * window.PhotographySubjects = { mini(c, api), view(c, ci, api) }. `api` is what photography.js lends: h, pic, btn,
 * textBlock, dotted, openFull, photoAt, vTilt, REDUCED. A view returns { el, anchor, focus(), ready() } like the views
 * of the journeys do. Everything here is plain elements and CSS 3D transforms.
 */
(() => {
  "use strict";
  const icon = (markup) => {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  };
  const FORK =
    '<svg class="cut fork" viewBox="0 0 30 190" aria-hidden="true"><path d="M5 4v44c0 9 5 14 8 16l-2 116c0 8 8 8 8 0l-2-116c3-2 8-7 8-16V4h-4v40h-3V4h-4v40h-3V4z"/></svg>';
  const KNIFE =
    '<svg class="cut knife" viewBox="0 0 30 190" aria-hidden="true"><path d="M13 4c9 6 13 30 11 70l-7 4-2 104c0 8-8 8-8 0l3-104z"/></svg>';
  const STICKS = '<svg class="cut sticks" viewBox="0 0 34 210" aria-hidden="true"><path d="M6 4h6l2 200H8z"/><path d="M22 4h6l-4 200h-6z"/></svg>';

  // the text column every subject has: title and note, the controls, the caption and where the photograph is from
  function scaffold(c, api, cls, tip, loop) {
    const { h, btn } = api;
    const n = c.photos.length;
    const counter = h("span", { class: "count", "aria-live": "polite" });
    const cap = h("p", { class: "cap" });
    const src = h("p", { class: "src" });
    const bPrev = btn("‹", "Previous photograph", "round");
    const bNext = btn("›", "Next photograph", "round");
    const bFull = btn("Full size", "Open this photograph full size");
    const text = api.textBlock(c);
    text.append(h("div", { class: "ctl" }, bPrev, counter, bNext, bFull), cap, src, h("p", { class: "tip", text: tip }));
    const stage = h("div", { class: "stage" });
    const el = h("div", { class: `v-kind v-subject ${cls} wrap duo` }, text, stage);
    const say = (i) => {
      const p = c.photos[i];
      counter.textContent = `${i + 1} / ${n}`;
      cap.textContent = p.caption;
      src.textContent = api.dotted(p.place, p.from, p.when);
      bPrev.disabled = !loop && i === 0;
      bNext.disabled = !loop && i === n - 1;
    };
    // arrow keys step through the photographs, Enter opens the current one
    const keys = (target, go, open) =>
      target.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (d) {
          e.preventDefault();
          go(d);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    // a sideways drag across the object steps too; the click that would follow it is swallowed
    const swipe = (go) => {
      let x0 = 0;
      let y0 = 0;
      let on = false;
      let swiped = false;
      stage.addEventListener("pointerdown", (e) => {
        on = e.isPrimary;
        x0 = e.clientX;
        y0 = e.clientY;
        swiped = false;
      });
      stage.addEventListener("pointerup", (e) => {
        if (!on) return;
        on = false;
        const dx = e.clientX - x0;
        if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(e.clientY - y0) * 1.4) return;
        swiped = true;
        setTimeout(() => (swiped = false), 350);
        go(dx < 0 ? 1 : -1);
      });
      stage.addEventListener("pointercancel", () => (on = false));
      stage.addEventListener(
        "click",
        (e) => {
          if (!swiped) return;
          swiped = false;
          e.stopPropagation();
          e.preventDefault();
        },
        true
      );
    };
    return { el, stage, n, bPrev, bNext, bFull, say, keys, swipe };
  }
  const photoIn = (api, c, fi, size) => {
    const img = api.pic(c, fi, size || "preview", null, true);
    img.load();
    return img;
  };

  /* ---------- food: the table ---------- */
  function viewTable(c, ci, api) {
    const { h } = api;
    const s = scaffold(c, api, "v-table", "Turn the table, or tap a dish to bring it round", true);
    const n = s.n;
    const m = Math.min(n, 8); // plates on the table at once
    const step = 360 / m;
    let cur = 0; // the photograph in front
    let front = 0; // the plate in front
    let turn = 0;
    const susan = h("div", { class: "tb-susan" });
    const plates = [];
    const fill = (j, fi) => {
      plates[j].firstChild.replaceChildren(photoIn(api, c, fi));
      plates[j].dataset.fi = String(fi);
    };
    for (let j = 0; j < m; j++) {
      const plate = h(
        "button",
        { class: "plate", type: "button", tabindex: "-1", style: `--a:${(-j * step).toFixed(2)}deg` },
        h("span", { class: "dish" })
      );
      plates.push(plate);
      susan.append(plate);
      // with more photographs than plates, the plates behind the front one hold the ones just before and after it
      fill(j, n <= m ? j : j <= 4 ? j : (j - m + n) % n);
      plate.addEventListener("click", () => {
        const r = (j - front + m) % m;
        if (!r) api.openFull(ci, cur);
        else go(r <= m / 2 ? r : r - m);
      });
    }
    const top = h("div", {
      class: "tb-top",
      tabindex: "0",
      role: "group",
      "aria-label": `A table with ${n} dishes. The arrow keys turn it; Enter opens the dish in front.`,
    });
    top.append(susan, icon(FORK), icon(KNIFE), icon(STICKS), h("i", { class: "tb-cup" }));
    const pose = h("div", { class: "tb-pose" }, top);
    const tilt = h("div", { class: "tilt" }, pose);
    s.stage.append(h("div", { class: "enter" }, tilt));
    function paint() {
      susan.style.setProperty("--turn", `${turn}deg`);
      plates.forEach((p, j) => p.classList.toggle("front", j === front));
      s.say(cur);
      api.photoAt(ci, cur);
    }
    function go(d) {
      const sgn = Math.sign(d);
      for (let t = 0; t < Math.abs(d); t++) {
        front = (front + sgn + m) % m;
        cur = (cur + sgn + n) % n;
        turn += sgn * step;
        // the plate that has just gone to the far side of the table is given the photograph that comes after the others
        if (n > m) {
          if (sgn > 0) fill((front + 4) % m, (cur + 4) % n);
          else fill((front + 5) % m, (cur - 3 + n) % n);
        }
      }
      paint();
    }
    s.bPrev.addEventListener("click", () => go(-1));
    s.bNext.addEventListener("click", () => go(1));
    s.bFull.addEventListener("click", () => api.openFull(ci, cur));
    s.keys(top, go, () => api.openFull(ci, cur));
    s.swipe(go);
    api.vTilt(tilt, s.stage, { ax: 5, ay: 4 });
    return { el: s.el, anchor: top, focus: () => top.focus({ preventScroll: true }), ready: paint };
  }

  /* ---------- landscape: the viewfinder ---------- */
  function viewFinder(c, ci, api) {
    const { h } = api;
    const s = scaffold(c, api, "v-finder", "Every step fires the shutter and winds the film on");
    let i = 0;
    let busy = false;
    const pic = h("span", { class: "vf-pic" });
    const glass = h(
      "button",
      {
        class: "vf-glass",
        type: "button",
        "aria-label": `A camera's viewfinder showing ${s.n} landscapes. The arrow keys move through them; Enter opens this one full size.`,
      },
      pic,
      h("i", { class: "vf-lines" }),
      h("i", { class: "vf-patch" }),
      h("i", { class: "vf-blade a" }),
      h("i", { class: "vf-blade b" })
    );
    const frameNo = h("span", { class: "vf-count" });
    const lever = h("i", { class: "vf-lever" });
    const needle = h("i");
    const body = h(
      "div",
      { class: "vf-body" },
      h("div", { class: "vf-top" }, h("i", { class: "vf-dial" }), h("i", { class: "vf-shoe" }), frameNo, lever),
      glass,
      h("div", { class: "vf-foot" }, h("span", { class: "vf-scale" }, needle), h("span", { class: "vf-brand", text: "RW · 35 mm" }))
    );
    const tilt = h("div", { class: "tilt" }, body);
    s.stage.append(h("div", { class: "enter" }, tilt));
    function put() {
      pic.replaceChildren(photoIn(api, c, i));
      frameNo.textContent = String(i + 1).padStart(2, "0");
      // the meter settles somewhere else for every frame
      needle.style.setProperty("--n", String(((i * 37) % 70) - 35));
      s.say(i);
      api.photoAt(ci, i);
    }
    function go(d) {
      const j = i + d;
      if (busy || j < 0 || j >= s.n) return;
      i = j;
      if (api.REDUCED) return put();
      busy = true;
      glass.classList.add("shut");
      setTimeout(() => {
        put();
        lever.classList.add("wind");
      }, 170);
      setTimeout(() => glass.classList.remove("shut"), 300);
      setTimeout(() => {
        lever.classList.remove("wind");
        busy = false;
      }, 640);
    }
    glass.addEventListener("click", () => api.openFull(ci, i));
    s.bPrev.addEventListener("click", () => go(-1));
    s.bNext.addEventListener("click", () => go(1));
    s.bFull.addEventListener("click", () => api.openFull(ci, i));
    s.keys(glass, go, () => api.openFull(ci, i));
    s.swipe(go);
    api.vTilt(tilt, s.stage, { ax: 6, ay: 5 });
    return { el: s.el, anchor: body, focus: () => glass.focus({ preventScroll: true }), ready: put };
  }

  /* ---------- people: the slide projector ---------- */
  function viewProjector(c, ci, api) {
    const { h } = api;
    const s = scaffold(c, api, "v-proj", "One slide at a time, the way they used to be shown");
    let i = 0;
    let busy = false;
    let notch = 0;
    const pic = h("span", { class: "pj-pic" });
    const slide = h(
      "button",
      {
        class: "pj-slide",
        type: "button",
        "aria-label": `A slide show of ${s.n} photographs. The arrow keys change the slide; Enter opens this one full size.`,
      },
      pic
    );
    const tray = h("i", { class: "pj-tray" });
    const box = h("div", { class: "pj-box" }, tray, h("i", { class: "pj-lens" }), h("i", { class: "pj-foot" }));
    const room = h("div", { class: "pj-room" }, h("div", { class: "pj-screen" }, slide), h("i", { class: "pj-beam" }), box);
    const tilt = h("div", { class: "tilt" }, room);
    s.stage.append(h("div", { class: "enter" }, tilt));
    function put() {
      pic.replaceChildren(photoIn(api, c, i));
      s.say(i);
      api.photoAt(ci, i);
    }
    function go(d) {
      const j = i + d;
      if (busy || j < 0 || j >= s.n) return;
      i = j;
      notch += d;
      tray.style.setProperty("--turn", `${notch * 9}deg`);
      if (api.REDUCED) return put();
      busy = true;
      slide.dataset.dir = d > 0 ? "next" : "prev";
      slide.classList.add("out");
      setTimeout(() => {
        put();
        slide.classList.remove("out");
        slide.classList.add("in");
      }, 190);
      setTimeout(() => {
        slide.classList.remove("in");
        busy = false;
      }, 470);
    }
    slide.addEventListener("click", () => api.openFull(ci, i));
    s.bPrev.addEventListener("click", () => go(-1));
    s.bNext.addEventListener("click", () => go(1));
    s.bFull.addEventListener("click", () => api.openFull(ci, i));
    s.keys(slide, go, () => api.openFull(ci, i));
    s.swipe(go);
    api.vTilt(tilt, s.stage, { ax: 5, ay: 4 });
    return { el: s.el, anchor: room, focus: () => slide.focus({ preventScroll: true }), ready: put };
  }

  /* ---------- animals: the field notebook ---------- */
  function viewNotebook(c, ci, api) {
    const { h } = api;
    const s = scaffold(c, api, "v-note", "Turn the page for the next entry");
    let i = 0;
    let busy = false;
    // the left page: what was seen, where and when, as if written down on the spot
    const notes = (fi) => {
      const p = c.photos[fi];
      return [
        h("p", { class: "nb-no", text: `No. ${String(fi + 1).padStart(2, "0")}` }),
        h("p", { class: "nb-what", text: p.caption || p.alt || "" }),
        h("p", { class: "nb-line", text: p.place || "" }),
        h("p", { class: "nb-line", text: api.dotted(p.from, p.when) }),
        p.coords ? h("p", { class: "nb-line small", text: api.fmtCoords(p.coords) }) : null,
      ];
    };
    // the right page: the photograph, taped in a little askew
    const taped = (fi) => [
      h(
        "span",
        { class: "nb-photo", style: `--r:${(((fi * 53) % 7) - 3) * 0.7}deg` },
        photoIn(api, c, fi),
        h("i", { class: "tape a" }),
        h("i", { class: "tape b" })
      ),
    ];
    const left = h("div", { class: "nb-page left" });
    const right = h("button", {
      class: "nb-page right",
      type: "button",
      "aria-label": `A field notebook with ${s.n} entries. The arrow keys turn the pages; Enter opens this photograph full size.`,
    });
    const front = h("div", { class: "nb-face front" });
    const back = h("div", { class: "nb-face back" });
    const leaf = h("div", { class: "nb-leaf", hidden: "" }, front, back);
    const book = h("div", { class: "nb-book" }, left, right, leaf, h("i", { class: "nb-spine" }));
    const pose = h("div", { class: "nb-pose" }, book, h("i", { class: "nb-pencil" }));
    const tilt = h("div", { class: "tilt" }, pose);
    s.stage.append(h("div", { class: "enter" }, tilt));
    const settle = () => {
      left.replaceChildren(...notes(i).filter(Boolean));
      right.replaceChildren(...taped(i));
      s.say(i);
      api.photoAt(ci, i);
    };
    function go(d) {
      const j = i + d;
      if (busy || j < 0 || j >= s.n) return;
      if (api.REDUCED) {
        i = j;
        return settle();
      }
      busy = true;
      // One leaf turns over the spine. Going on, it carries the old photograph away and brings the new notes; going
      // back, the other way round. The page it uncovers already shows what belongs there.
      front.replaceChildren(...taped(d > 0 ? i : j));
      back.replaceChildren(...notes(d > 0 ? j : i).filter(Boolean));
      leaf.classList.toggle("turned", d < 0);
      leaf.hidden = false;
      if (d > 0) right.replaceChildren(...taped(j));
      else left.replaceChildren(...notes(j).filter(Boolean));
      i = j;
      s.say(i);
      api.photoAt(ci, i);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          leaf.classList.add("go");
          leaf.classList.toggle("turned", d > 0);
        })
      );
      setTimeout(() => {
        settle();
        leaf.hidden = true;
        leaf.classList.remove("go", "turned");
        busy = false;
      }, 760);
    }
    right.addEventListener("click", () => api.openFull(ci, i));
    s.bPrev.addEventListener("click", () => go(-1));
    s.bNext.addEventListener("click", () => go(1));
    s.bFull.addEventListener("click", () => api.openFull(ci, i));
    s.keys(right, go, () => api.openFull(ci, i));
    s.swipe(go);
    api.vTilt(tilt, s.stage, { ax: 5, ay: 4 });
    return { el: s.el, anchor: book, focus: () => right.focus({ preventScroll: true }), ready: settle };
  }

  /* ---------- the small objects in the grid ---------- */
  function mini(c, api) {
    const { h, pic } = api;
    const imgs = [];
    const P = (fi) => {
      const img = pic(c, Math.min(fi, c.photos.length - 1), "thumb");
      imgs.push(img);
      return img;
    };
    if (c.kind === "table") {
      const k = Math.min(c.photos.length, 4);
      const top = h(
        "div",
        { class: "tb-top" },
        h(
          "div",
          { class: "tb-susan" },
          Array.from({ length: k }, (_, j) =>
            h("span", { class: `plate${j ? "" : " front"}`, style: `--a:${(-j * (360 / k)).toFixed(1)}deg` }, h("span", { class: "dish" }, P(j)))
          )
        )
      );
      top.append(icon(FORK), icon(KNIFE), icon(STICKS));
      return { el: h("div", { class: "obj mini-table" }, h("div", { class: "tb-pose" }, top)), imgs };
    }
    if (c.kind === "finder")
      return {
        el: h(
          "div",
          { class: "obj mini-finder" },
          h(
            "div",
            { class: "vf-body" },
            h(
              "div",
              { class: "vf-top" },
              h("i", { class: "vf-dial" }),
              h("i", { class: "vf-shoe" }),
              h("span", { class: "vf-count", text: String(c.photos.length).padStart(2, "0") }),
              h("i", { class: "vf-lever" })
            ),
            h(
              "div",
              { class: "vf-glass" },
              h("span", { class: "vf-pic" }, P(0)),
              h("i", { class: "vf-lines" }),
              h("i", { class: "vf-blade a" }),
              h("i", { class: "vf-blade b" })
            ),
            h("div", { class: "vf-foot" }, h("span", { class: "vf-scale" }, h("i")), h("span", { class: "vf-brand", text: "RW · 35 mm" }))
          )
        ),
        imgs,
      };
    if (c.kind === "projector")
      return {
        el: h(
          "div",
          { class: "obj mini-proj" },
          h(
            "div",
            { class: "pj-room" },
            h("div", { class: "pj-screen" }, h("div", { class: "pj-slide" }, h("span", { class: "pj-pic" }, P(0)))),
            h("i", { class: "pj-beam" }),
            h("div", { class: "pj-box" }, h("i", { class: "pj-tray" }), h("i", { class: "pj-lens" }), h("i", { class: "pj-foot" }))
          )
        ),
        imgs,
      };
    const p = c.photos[0];
    return {
      el: h(
        "div",
        { class: "obj mini-note" },
        h(
          "div",
          { class: "nb-pose" },
          h(
            "div",
            { class: "nb-book" },
            h(
              "div",
              { class: "nb-page left" },
              h("p", { class: "nb-no", text: "No. 01" }),
              h("p", { class: "nb-what", text: p.caption || "" }),
              h("p", { class: "nb-line", text: p.place || "" })
            ),
            h(
              "div",
              { class: "nb-page right" },
              h("span", { class: "nb-photo", style: "--r:-2deg" }, P(0), h("i", { class: "tape a" }), h("i", { class: "tape b" }))
            ),
            h("i", { class: "nb-spine" })
          ),
          h("i", { class: "nb-pencil" })
        )
      ),
      imgs,
    };
  }

  const VIEWS = { table: viewTable, finder: viewFinder, projector: viewProjector, notebook: viewNotebook };
  window.PhotographySubjects = { mini, view: (c, ci, api) => VIEWS[c.kind](c, ci, api) };
})();
