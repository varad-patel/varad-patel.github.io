// 365 projects gallery. Plain JavaScript, no dependencies. Data comes from challenge-data.js.
(() => {
  "use strict";

  const D = window.CHALLENGE;
  const $ = (id) => document.getElementById(id);
  const MS_DAY = 86400000;
  const UPCOMING_PREVIEW = 14;

  const toDate = (iso) => new Date(iso + "T00:00:00Z");
  const longDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
  const fmt = (iso) => longDate.format(toDate(iso)).replace(",", "");
  const fmtShort = (iso) => shortDate.format(toDate(iso));

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const projects = D.projects;
  const byId = new Map(projects.map((p) => [p.id, p]));
  const sectionOf = (p) => D.sections.find((s) => s.id === p.section);
  const isBuilt = (p) => Boolean(p.built);
  const built = projects.filter(isBuilt);

  const state = { section: null, query: "", expanded: false };

  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid);
    return node;
  };

  const codeUrl = (p) => `${D.repo}/tree/${D.branch}/365projects/${p.id}`;
  // Built projects open in a new tab at 365projects/<N>/.
  const openLink = (p, attrs, ...kids) => el("a", { href: p.url, target: "_blank", rel: "noopener", ...attrs }, ...kids);
  const dataLine = (p) => ((p.sources || []).length ? `Data: ${p.sources.join(", ")}` : "No external data: computed in your browser");

  const matches = (p) => {
    if (state.section && p.section !== state.section) return false;
    if (!state.query) return true;
    const hay = [p.title, p.desc, p.concept, p.skills, p.question, p.finding, (p.sources || []).join(" ")].join(" ").toLowerCase();
    return state.query.split(/\s+/).every((word) => hay.includes(word));
  };

  /* ---------- status sentence ---------- */
  function renderStatus() {
    const next = projects.find((p) => !isBuilt(p));
    const startVerb = todayIso >= D.start ? "was" : "is";
    const parts = [
      el("strong", { text: `${built.length} of ${projects.length}` }),
      ` projects are built. Day 1 ${startVerb} ${fmt(D.start)}.`,
    ];
    const last = D.projects[D.projects.length - 1].date;
    if (todayIso >= D.start && todayIso <= last) {
      const dayNo = Math.round((toDate(todayIso) - toDate(D.start)) / MS_DAY) + 1;
      parts.push(` Today is day ${dayNo}.`);
    }
    if (next) parts.push(` Next up is ${next.title}, scheduled for ${fmt(next.date)}.`);
    $("status").replaceChildren(...parts.map((x) => (typeof x === "string" ? document.createTextNode(x) : x)));
  }

  /* ---------- year calendar ---------- */
  function renderYear() {
    const first = toDate(D.start);
    const offset = (first.getUTCDay() + 6) % 7; // Monday = row 0
    const cells = $("cells");
    const months = $("months");
    cells.replaceChildren();
    months.replaceChildren();

    projects.forEach((p, i) => {
      const col = Math.floor((i + offset) / 7);
      const d = toDate(p.date);
      const btn = el("button", {
        class: `cell s${p.section}${isBuilt(p) ? " done" : ""}${p.date === todayIso ? " today" : ""}`,
        type: "button",
        tabindex: "-1",
        "data-id": p.id,
        style: `--col:${col};${i === 0 ? `grid-row-start:${offset + 1};` : ""}`,
      });
      cells.append(btn);
      if (i === 0 || d.getUTCDate() === 1) {
        // Skip a label that would collide with the previous one (first partial month).
        const label = el("span", { text: monthName.format(d), style: `grid-column:${col + 1}` });
        if (i === 0 && d.getUTCDate() > 20) label.textContent = "";
        months.append(label);
      }
    });

    $("year").setAttribute(
      "aria-label",
      `Calendar from ${fmt(D.start)} to ${fmt(projects[projects.length - 1].date)}. ${built.length} of ${projects.length} projects built. Use the project list below to open one.`
    );
  }

  function paintYearFilter() {
    document.querySelectorAll(".cell").forEach((cell) => {
      const p = byId.get(Number(cell.dataset.id));
      cell.classList.toggle("dim", !matches(p));
    });
  }

  /* ---------- tooltip ---------- */
  function wireTooltip() {
    const tip = $("tip");
    const block = document.querySelector(".year-block");
    const show = (cell) => {
      const p = byId.get(Number(cell.dataset.id));
      tip.replaceChildren(
        el("b", { text: p.title }),
        el("span", { text: `Day ${p.id}, ${fmt(p.date)}${isBuilt(p) ? "" : ", scheduled"}` })
      );
      tip.classList.add("on");
      const c = cell.getBoundingClientRect();
      const b = block.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let left = c.left - b.left + c.width / 2 - w / 2;
      left = Math.max(0, Math.min(left, b.width - w));
      let top = c.top - b.top - h - 8;
      if (top < 0) top = c.bottom - b.top + 8;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    const cellsEl = $("cells");
    cellsEl.addEventListener("pointerover", (e) => {
      const cell = e.target.closest(".cell");
      if (cell) show(cell);
    });
    cellsEl.addEventListener("pointerleave", () => tip.classList.remove("on"));
    cellsEl.addEventListener("click", (e) => {
      const cell = e.target.closest(".cell");
      if (cell) openDetail(Number(cell.dataset.id));
    });
    $("year").addEventListener("scroll", () => tip.classList.remove("on"), { passive: true });
  }

  /* ---------- section legend / filter ---------- */
  function renderSections() {
    const wrap = $("sections");
    wrap.replaceChildren(
      ...D.sections.map((s) => {
        const total = s.last - s.first + 1;
        const done = built.filter((p) => p.section === s.id).length;
        return el(
          "button",
          { class: `sec s${s.id}`, type: "button", "aria-pressed": String(state.section === s.id), "data-section": s.id },
          el("strong", { text: s.name }),
          el("span", { text: `Days ${s.first} to ${s.last}` }),
          el("span", { text: `${done} of ${total} built` })
        );
      })
    );
    wrap.onclick = (e) => {
      const btn = e.target.closest(".sec");
      if (!btn) return;
      const id = Number(btn.dataset.section);
      state.section = state.section === id ? null : id;
      update();
    };
  }

  /* ---------- gallery ---------- */
  function plate(p) {
    const s = sectionOf(p);
    return el(
      "article",
      { class: `plate s${p.section}` },
      openLink(
        p,
        { class: "shot", "aria-label": `Open ${p.title} in a new tab` },
        el("img", { src: p.img, alt: `Screenshot of ${p.title}`, width: 1200, height: 793, loading: "lazy" })
      ),
      el("p", { class: "meta" }, el("span", { class: "day", text: `Day ${p.id}` }), el("span", { text: fmt(p.date) })),
      el("h3", { text: p.title }),
      el("p", { class: "q", text: p.question }),
      p.finding ? el("p", { class: "f", text: p.finding }) : null,
      el("p", { class: "src", text: `${s.name}. ${p.concept}. ${dataLine(p)}.` }),
      el(
        "div",
        { class: "actions" },
        openLink(p, { class: "btn primary", text: "Open the tool" }),
        el("button", { class: "btn", type: "button", "data-open": p.id, text: "Details" })
      )
    );
  }

  function renderGallery() {
    const shown = built.filter(matches);
    $("plates").replaceChildren(...shown.map(plate));
    $("built-count").textContent = shown.length === built.length ? `${built.length}` : `${shown.length} of ${built.length}`;
    const empty = $("empty");
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      const scope = state.section ? " in this section" : "";
      empty.textContent = state.query
        ? `No built project matches "${state.query}"${scope}. Check the list below, since the match may be scheduled for later.`
        : "Nothing is built in this section yet. The scheduled projects are listed below.";
    }
  }

  /* ---------- coming up ---------- */
  function renderComing() {
    const rest = projects.filter((p) => !isBuilt(p) && matches(p));
    const filtering = Boolean(state.section || state.query);
    const limit = filtering || state.expanded ? rest.length : UPCOMING_PREVIEW;
    const items = rest.slice(0, limit);
    $("rows").replaceChildren(
      ...items.map((p) =>
        el(
          "li",
          { class: `s${p.section}` },
          el("span", { class: "when", text: fmt(p.date) }),
          el("span", { class: "num", text: `#${p.id}` }),
          el(
            "div",
            { class: "what" },
            el("button", { type: "button", "data-open": p.id, text: p.title }),
            el("p", { text: p.desc })
          )
        )
      )
    );
    $("coming-count").textContent = `${rest.length}`;
    const more = $("more");
    const hidden = rest.length - items.length;
    more.hidden = hidden <= 0;
    more.textContent = `Show the other ${hidden}`;
    if (!rest.length) $("rows").append(el("li", { class: "s1" }, el("span", { class: "what" }, el("p", { text: "Nothing scheduled matches." }))));
  }

  /* ---------- detail dialog ---------- */
  const dlg = $("detail");

  function openDetail(id, { updateHash = true } = {}) {
    const p = byId.get(id);
    if (!p) return;
    const s = sectionOf(p);
    dlg.className = `detail s${p.section}`;
    $("d-title").textContent = p.title;
    $("d-eyebrow").replaceChildren(
      el("span", { class: "day", text: `Day ${p.id}` }),
      el("span", { text: s.name }),
      el("span", { text: fmt(p.date) })
    );

    $("d-layout").classList.toggle("no-fig", !isBuilt(p));
    if (isBuilt(p)) {
      $("d-img").src = p.img;
      $("d-img").alt = `Screenshot of ${p.title}`;
    }

    const rows = [];
    const add = (term, text) => text && rows.push(el("div", {}, el("dt", { text: term }), el("dd", { text })));
    if (isBuilt(p)) {
      add("What you can do", p.desc);
      add("The question", p.question);
      add("One finding", p.finding);
      add("What it cannot tell you", p.limit);
      add("Concept", p.concept);
      add("Method", p.skills);
      add("Data", dataLine(p).replace(/^Data: /, ""));
      const ahead = p.built < p.date ? `Built ahead of schedule on ${fmt(p.built)}.` : `Built on ${fmt(p.built)}.`;
      add("Schedule", `Day ${p.id} falls on ${fmt(p.date)}. ${ahead}`);
    } else {
      add("The idea", p.desc);
      add("Concept", p.concept);
      add("Method", p.skills);
      add("Schedule", `Not started. Scheduled for ${fmt(p.date)}.`);
    }
    $("d-list").replaceChildren(...rows);

    $("d-actions").replaceChildren(
      ...(isBuilt(p)
        ? [
            openLink(p, { class: "btn primary", text: "Open the tool" }),
            el("a", { class: "btn", href: codeUrl(p), target: "_blank", rel: "noopener", text: "View code" }),
          ]
        : [])
    );

    if (updateHash) history.replaceState(null, "", `#${String(id).padStart(3, "0")}`);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }

  function closeDetail() {
    if (dlg.open) dlg.close();
  }
  dlg.addEventListener("close", () => history.replaceState(null, "", location.pathname + location.search));
  $("d-close").addEventListener("click", closeDetail);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) closeDetail(); // click on the backdrop
  });

  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-open]");
    if (opener) openDetail(Number(opener.dataset.open));
  });

  function openFromHash() {
    const id = Number(location.hash.replace("#", ""));
    if (id) openDetail(id, { updateHash: false });
  }
  window.addEventListener("hashchange", openFromHash);

  /* ---------- wiring ---------- */
  function update() {
    document.querySelectorAll(".sec").forEach((b) => b.setAttribute("aria-pressed", String(state.section === Number(b.dataset.section))));
    renderGallery();
    renderComing();
    paintYearFilter();
  }

  $("q").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    update();
  });
  $("more").addEventListener("click", () => {
    state.expanded = true;
    renderComing();
  });
  $("repo-link").href = D.repo;

  renderStatus();
  renderYear();
  wireTooltip();
  renderSections();
  update();
  openFromHash();
})();
