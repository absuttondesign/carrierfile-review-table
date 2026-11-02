// Carrierfile Review Table page. Holds no drafts and no password: everything comes from the
// review-room function after the shared password is checked there. Drafts play in a sandboxed frame
// with no same-origin access, so a draft's code cannot read the sign-in kept here.
(function () {
  "use strict";
  const API = window.REVIEW_ROOM_API;
  const PART_ORDER = ["Animatic", "Script", "Shot list"];
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem("rr." + k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { v ? localStorage.setItem("rr." + k, v) : localStorage.removeItem("rr." + k); } catch (e) { /* private window */ } },
  };
  let state = { projects: [], project: null, round: null, item: null, version: null, replyTo: null };
  const contentCache = new Map();

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      method: opts.method || "GET",
      headers: { "content-type": "application/json", ...(store.get("token") ? { authorization: "Bearer " + store.get("token") } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/login") { showGate("Please sign in again."); throw new Error("signed out"); }
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
    return data;
  }

  // ---------- sign in ----------
  function showGate(msg) {
    store.set("token", "");
    $("room").hidden = true; $("me").hidden = true; $("empty").hidden = true; $("gate").hidden = false;
    $("gate-name").value = store.get("name");
    $("gate-error").textContent = msg || "";
    $("gate-password").focus();
  }
  $("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("gate-form").querySelector("button");
    const name = $("gate-name").value.trim();
    if (!name) { $("gate-error").textContent = "Add your name."; return; }
    btn.disabled = true; $("gate-error").textContent = "";
    try {
      const r = await api("/login", { method: "POST", body: { password: $("gate-password").value } });
      store.set("token", r.token); store.set("name", name);
      $("gate-password").value = "";
      await start();
    } catch (err) { $("gate-error").textContent = err.message; }
    finally { btn.disabled = false; }
  });
  $("sign-out").addEventListener("click", () => showGate("Signed out."));
  $("change-name").addEventListener("click", () => {
    const n = (prompt("Name on your comments:", store.get("name")) || "").trim().slice(0, 60);
    if (n) { store.set("name", n); $("me-name").textContent = n; renderSelects(); }
  });

  // ---------- room ----------
  async function start() {
    if (!store.get("name")) { showGate(); return; }
    const r = await api("/room");
    state.projects = r.projects || [];
    $("gate").hidden = true; $("me").hidden = false; $("me-name").textContent = store.get("name");
    if (!state.projects.length) { $("empty").hidden = false; return; }
    $("room").hidden = false;
    const want = decodeURIComponent((location.hash || "").slice(1));
    const byItem = state.projects.find((p) => p.items.some((i) => i.slug === want));
    pickProject((byItem || state.projects.find((p) => p.slug === want) || state.projects[0]).slug, want);
  }

  function rounds(p) {
    const info = (p.info && p.info.rounds) || [];
    const names = info.map((r) => r.name);
    for (const i of p.items) if (!names.includes(i.round)) names.push(i.round);
    return names.map((n) => ({ name: n, ...(info.find((r) => r.name === n) || {}), items: itemsOf(p, n) }));
  }
  function itemsOf(p, round) {
    const rank = (part) => { const k = PART_ORDER.indexOf(part); return k < 0 ? 99 : k; };
    return p.items.filter((i) => i.round === round).sort((a, b) => rank(a.part) - rank(b.part) || a.part.localeCompare(b.part));
  }

  function pickProject(slug, wantItem) {
    const p = state.projects.find((x) => x.slug === slug);
    state.project = p;
    const tabs = $("projects");
    tabs.hidden = state.projects.length < 2;
    tabs.replaceChildren(...state.projects.map((x) => el("button", { class: "tab", type: "button", "aria-selected": String(x.slug === slug), onclick: () => pickProject(x.slug) }, x.title)));
    const info = p.info || {};
    $("p-title").textContent = p.title;
    $("p-lede").textContent = info.lede || "";
    $("p-cards").replaceChildren(...(info.cards || []).map((c) => el("div", {}, el("b", {}, c.label), c.text)));
    const asks = info.asks || [];
    $("p-asks").hidden = !asks.length;
    $("p-asks").querySelector("ul").replaceChildren(...asks.map((a) => el("li", {}, a)));
    $("p-foot").textContent = info.foot || "";
    const rs = rounds(p);
    const item = p.items.find((i) => i.slug === wantItem);
    const ready = rs.filter((r) => r.items.length);
    pickRound(item ? item.round : (ready.length ? ready[ready.length - 1].name : rs[0].name), wantItem);
  }

  function pickRound(name, wantItem) {
    const rs = rounds(state.project);
    const r = rs.find((x) => x.name === name) || rs[0];
    state.round = r.name;
    $("rounds").replaceChildren(...rs.map((x) => el("button", {
      class: "tab", type: "button", role: "tab", "aria-selected": String(x.name === r.name), onclick: () => pickRound(x.name),
    }, el("span", { class: "dot" + (x.items.length ? " ready" : ""), "aria-hidden": "true" }), x.name)));
    const ready = r.items.length > 0;
    const label = ready ? "Ready to look at" : r.status === "building" ? "Being built now" : "Queued";
    $("round-info").replaceChildren(
      el("div", { class: "meta" }, el("h2", {}, r.name), el("span", { class: "status" + (ready ? " ready" : "") }, label)),
      r.summary ? el("p", {}, r.summary) : null,
      (r.changes || []).length ? el("ul", { class: "changes" }, r.changes.map((c) => el("li", {}, c))) : null,
    );
    document.querySelector(".work").hidden = false;
    if (!ready) {
      $("parts").replaceChildren(); $("version-wrap").hidden = true;
      document.querySelector(".selectbar").hidden = true; $("item-note").textContent = "";
      $("frame-box").replaceChildren(el("div", { class: "pending" }, `${r.name} is ${r.status === "building" ? "being built" : "waiting its turn"}. It will appear here when it lands.`));
      document.querySelector(".comments").hidden = true;
      state.item = null;
      return;
    }
    document.querySelector(".comments").hidden = false;
    const item = r.items.find((i) => i.slug === wantItem) || r.items[0];
    pickItem(item.slug);
  }

  async function pickItem(slug, version) {
    const r = rounds(state.project).find((x) => x.name === state.round);
    const item = r.items.find((i) => i.slug === slug);
    state.item = item; state.version = version || item.version; state.replyTo = null;
    $("parts").replaceChildren(...r.items.map((i) => el("button", {
      class: "tab", type: "button", role: "tab", "aria-selected": String(i.slug === slug), onclick: () => pickItem(i.slug),
    }, i.part)));
    $("version-wrap").hidden = item.versions.length < 2;
    $("version").replaceChildren(...[...item.versions].reverse().map((v) => el("option", { value: v, selected: v === state.version }, `v${v}${v === item.version ? " (latest)" : ""}`)));
    document.querySelector(".selectbar").hidden = false;
    try { history.replaceState(null, "", "#" + slug); } catch (e) { /* file preview */ }
    renderSelects();
    $("comments-on").textContent = `on ${item.round} ${item.part}`;
    setReply(null);
    loadComments();
    const key = slug + "@" + state.version;
    let d = contentCache.get(key);
    if (!d) {
      $("frame-box").replaceChildren(el("div", { class: "pending" }, "Loading…"));
      try { d = (await api(`/draft?slug=${encodeURIComponent(slug)}&version=${state.version}`)).draft; contentCache.set(key, d); }
      catch (err) { $("frame-box").replaceChildren(el("div", { class: "pending" }, err.message)); return; }
    }
    if (state.item !== item) return;
    $("item-note").textContent = d.note ? `What changed in v${d.version}: ${d.note}` : "";
    const frame = el("iframe", { id: "frame", title: `${item.round} ${item.part}`, sandbox: "allow-scripts" });
    frame.srcdoc = d.content;
    $("frame-box").replaceChildren(frame);
  }
  $("version").addEventListener("change", (e) => pickItem(state.item.slug, Number(e.target.value)));

  // ---------- selects ----------
  function renderSelects() {
    const item = state.item; if (!item) return;
    const me = store.get("name");
    const mine = item.selects.find((s) => s.name === me);
    const btn = $("select-btn");
    btn.setAttribute("aria-pressed", String(!!mine));
    btn.textContent = mine ? "★ My select (take back)" : "☆ Make this my select";
    if (document.activeElement !== $("select-note")) $("select-note").value = mine ? (mine.note || "") : "";
    $("select-list").textContent = item.selects.length
      ? "Selects: " + item.selects.map((s) => s.name + (s.note ? ` ("${s.note}")` : "") + (s.draft_version !== item.version ? ` on v${s.draft_version}` : "")).join(", ")
      : "No selects yet.";
  }
  $("select-btn").addEventListener("click", async () => {
    const item = state.item, me = store.get("name");
    const mine = item.selects.some((s) => s.name === me);
    const btn = $("select-btn"); btn.disabled = true;
    try {
      if (mine) {
        await api("/selects", { method: "POST", body: { slug: item.slug, name: me, remove: true } });
        item.selects = item.selects.filter((s) => s.name !== me);
      } else {
        const r = await api("/selects", { method: "POST", body: { slug: item.slug, version: state.version, name: me, note: $("select-note").value } });
        item.selects = [...item.selects.filter((s) => s.name !== me), r.select];
      }
      renderSelects();
    } catch (err) { $("select-list").textContent = err.message; }
    finally { btn.disabled = false; }
  });

  // ---------- comments ----------
  function when(iso) {
    try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (e) { return iso; }
  }
  function commentNode(c, kids) {
    return el("li", { class: c.author_kind === "castle" ? "castle" : "" },
      el("div", {}, el("span", { class: "who" }, c.name + (c.author_kind === "castle" ? " (castle)" : "")), " ",
        el("span", { class: "when" }, `${when(c.created_at)} · v${c.draft_version}${c.where_at ? " · at " + c.where_at : ""}`)),
      el("p", { class: "body" }, c.body),
      c.parent_id ? null : el("button", { type: "button", class: "link small", onclick: () => setReply(c) }, "reply"),
      kids.length ? el("ol", { class: "replies" }, kids.map((k) => commentNode(k, []))) : null);
  }
  async function loadComments() {
    const item = state.item;
    const list = $("comment-list");
    try {
      const { comments } = await api(`/comments?slug=${encodeURIComponent(item.slug)}`);
      if (state.item !== item) return;
      item.comments = comments.length;
      const top = comments.filter((c) => !c.parent_id).reverse();
      list.replaceChildren(...(top.length ? top.map((c) => commentNode(c, comments.filter((k) => k.parent_id === c.id))) : [el("li", { class: "muted" }, "No comments yet. Start with the time, like \"0:36, the words feel too slow.\"")]));
    } catch (err) { list.replaceChildren(el("li", { class: "error" }, err.message)); }
  }
  function setReply(c) {
    state.replyTo = c;
    $("reply-to").hidden = !c;
    $("reply-to").replaceChildren(...(c ? [`Replying to ${c.name}. `, el("button", { type: "button", class: "link", onclick: () => setReply(null) }, "cancel")] : []));
    if (c) $("body").focus();
  }
  $("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("comment-form").querySelector("button[type=submit]");
    btn.disabled = true; $("comment-error").textContent = "";
    try {
      await api("/comments", { method: "POST", body: {
        slug: state.item.slug, version: state.version, name: store.get("name"),
        where: $("where").value, body: $("body").value, parent_id: state.replyTo ? state.replyTo.id : undefined,
      } });
      $("body").value = ""; $("where").value = ""; setReply(null);
      await loadComments();
    } catch (err) { $("comment-error").textContent = err.message; }
    finally { btn.disabled = false; }
  });

  if (store.get("token")) start().catch(() => {}); else showGate();
})();
