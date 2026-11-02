// Carrierfile Review Table page. Holds no drafts and no password: everything comes from the
// review-room function after a table's password is checked there. The room is a set of client tables;
// a person signs in to one table (the link may name it: ?t=slug) and sees only that table's published
// items. Drafts play in a sandboxed frame with no same-origin access, so a draft's code cannot read the
// sign-in kept here.
(function () {
  "use strict";
  const API = window.REVIEW_ROOM_API;
  const PART_ORDER = ["Animatic", "Script", "Shot list"];
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem("rr." + k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { v ? localStorage.setItem("rr." + k, v) : localStorage.removeItem("rr." + k); } catch (e) { /* private window */ } },
  };
  let state = { projects: [], project: null, round: null, item: null, version: null, replyTo: null, table: null, cf: [] };
  const wantTable = (new URLSearchParams(location.search).get("t") || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 61);
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
    store.set("token", ""); store.set("table", ""); showTable();
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
      const r = await api("/login", { method: "POST", body: { password: $("gate-password").value, table: wantTable || undefined } });
      store.set("token", r.token); store.set("name", name);
      if (r.table) store.set("table", r.table.title);
      $("gate-password").value = "";
      await start();
    } catch (err) { $("gate-error").textContent = err.message; }
    finally { btn.disabled = false; }
  });
  $("sign-out").addEventListener("click", () => showGate("Signed out."));
  // The Direction block folds away once you know it; the choice is remembered on this browser.
  function setDirection(open) {
    $("direction-body").hidden = !open;
    $("direction-toggle").textContent = open ? "hide" : "show";
    $("direction-toggle").setAttribute("aria-expanded", String(open));
    store.set("direction", open ? "" : "closed");
  }
  $("direction-toggle").addEventListener("click", () => setDirection($("direction-body").hidden));
  setDirection(store.get("direction") !== "closed");
  $("change-name").addEventListener("click", () => {
    const n = (prompt("Name on your comments:", store.get("name")) || "").trim().slice(0, 60);
    if (n) { store.set("name", n); $("me-name").textContent = n; renderSelects(); }
  });

  // ---------- room ----------
  function showTable() {
    const t = store.get("table");
    $("table-name").textContent = t ? " · " + t : "";
    document.title = t ? `${t} · Carrierfile Review Table` : "Carrierfile Review Table";
  }

  async function start() {
    if (!store.get("name")) { showGate(); return; }
    const r = await api("/room");
    state.projects = r.projects || [];
    state.table = r.table || null;
    if (state.table) store.set("table", state.table.title);
    showTable();
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
    cfLoad(); renderCfButton();
    const tabs = $("projects");
    tabs.hidden = state.projects.length < 2;
    tabs.replaceChildren(...state.projects.map((x) => el("button", { class: "tab", type: "button", "aria-selected": String(x.slug === slug), onclick: () => pickProject(x.slug) }, x.title)));
    const info = p.info || {};
    $("p-title").textContent = p.title;
    $("p-lede").textContent = info.lede || "";
    $("p-lede").hidden = !info.lede;
    $("p-cards").replaceChildren(...(info.cards || []).map((c) => el("div", {}, el("b", {}, c.label), c.text)));
    $("direction").hidden = !info.lede && !(info.cards || []).length;
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
    const changes = r.changes || [];
    const notes = el("details", { class: "changes-wrap", open: store.get("notes") === "open" ? true : false },
      el("summary", {}, `What changed in ${r.name}`, el("span", { class: "muted" }, ` · ${changes.length}`)),
      el("ul", { class: "changes" }, changes.map((c) => el("li", {}, c))));
    notes.addEventListener("toggle", () => store.set("notes", notes.open ? "open" : ""));
    $("round-info").replaceChildren(
      el("div", { class: "meta" },
        el("span", { class: "status" + (ready ? " ready" : "") }, label),
        r.summary ? el("p", { class: "summary" }, r.summary) : null),
      changes.length ? notes : null,
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
    renderCfButton();
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

  // ---------- the project carrierfile ----------
  // Picked items are remembered per project on this browser. The file itself comes from the server, which
  // only includes published items on this table; the browser never assembles it from the drafts.
  function cfKey() { return "cf." + (state.project ? state.project.slug : ""); }
  function cfLoad() { try { state.cf = JSON.parse(store.get(cfKey()) || "[]"); } catch (e) { state.cf = []; } }
  function cfSave() { store.set(cfKey(), state.cf.length ? JSON.stringify(state.cf) : ""); renderCfButton(); }
  function cfItems() { return state.cf.map((s) => state.project.items.find((i) => i.slug === s)).filter(Boolean); }
  function renderCfButton() {
    const n = state.project ? cfItems().length : 0;
    $("cf-count").hidden = !n; $("cf-count").textContent = n;
    const add = $("cf-add");
    if (state.item) {
      const on = state.cf.includes(state.item.slug);
      add.setAttribute("aria-pressed", String(on));
      add.textContent = on ? "✓ In the carrierfile" : "＋ Carrierfile";
    }
  }
  $("cf-add").addEventListener("click", () => {
    if (!state.item) return;
    const slug = state.item.slug;
    state.cf = state.cf.includes(slug) ? state.cf.filter((s) => s !== slug) : [...state.cf, slug];
    cfSave();
  });
  function renderCfDialog() {
    const items = cfItems();
    $("cf-n").textContent = items.length ? `· ${items.length}` : "";
    $("cf-items").replaceChildren(...(items.length ? items.map((i) => el("li", {},
      el("span", {}, `${i.round} · ${i.part}`, " ", el("span", { class: "meta" }, `v${i.version}`)),
      el("button", { type: "button", class: "link small", onclick: () => { state.cf = state.cf.filter((s) => s !== i.slug); cfSave(); renderCfDialog(); } }, "remove")))
      : [el("li", { class: "muted" }, "Nothing picked yet. Press “＋ Carrierfile” on any item.")]));
    $("cf-copy").disabled = $("cf-download").disabled = !items.length;
    $("cf-msg").textContent = "";
  }
  async function cfFetch() {
    const q = `slugs=${encodeURIComponent(state.cf.join(","))}&comments=${$("cf-comments").checked ? 1 : 0}&name=${encodeURIComponent(store.get("name"))}`;
    const res = await fetch(`${API}/carrierfile.md?${q}`, { headers: { authorization: "Bearer " + store.get("token") } });
    if (res.status === 401) { $("cf-dialog").close(); showGate("Please sign in again."); throw new Error("signed out"); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not make the carrierfile.");
    return res.text();
  }
  function cfFilename() {
    const d = new Date().toISOString().slice(0, 10);
    return `${state.project.slug}-carrierfile-${d}.md`;
  }
  $("cf-open").addEventListener("click", () => { if (!state.project) return; renderCfDialog(); loadReturns(); $("cf-dialog").showModal(); });
  $("cf-copy").addEventListener("click", async () => {
    $("cf-msg").textContent = "Making it…";
    try { await navigator.clipboard.writeText(await cfFetch()); $("cf-msg").textContent = "Copied. Paste it into a new conversation and type “unpack”."; }
    catch (err) { $("cf-msg").textContent = err.message; }
  });
  $("cf-download").addEventListener("click", async () => {
    $("cf-msg").textContent = "Making it…";
    try {
      const blob = new Blob([await cfFetch()], { type: "text/markdown" });
      const a = el("a", { href: URL.createObjectURL(blob), download: cfFilename() }); document.body.append(a); a.click(); a.remove();
      $("cf-msg").textContent = `Saved as ${cfFilename()}.`;
    } catch (err) { $("cf-msg").textContent = err.message; }
  });
  $("cf-clear").addEventListener("click", () => { state.cf = []; cfSave(); renderCfDialog(); });

  // sending a worked carrierfile back
  async function loadReturns() {
    try {
      const { returns } = await api(`/returns?project=${encodeURIComponent(state.project.slug)}`);
      $("cf-returns-n").textContent = returns.length ? `· ${returns.length}` : "";
      $("cf-returns").replaceChildren(...(returns.length ? returns.map((r) => el("li", {},
        el("span", {}, el("span", { class: "who" }, r.name), " ", el("span", { class: "meta" }, `${when(r.created_at)} · ${r.filename}${r.note ? " · " + r.note : ""}`)),
        el("button", { type: "button", class: "link small", onclick: () => downloadReturn(r) }, "download")))
        : [el("li", { class: "muted" }, "Nothing sent back yet.")]));
    } catch (err) { $("cf-returns").replaceChildren(el("li", { class: "error" }, err.message)); }
  }
  async function downloadReturn(r) {
    const { returns } = await api(`/returns?project=${encodeURIComponent(state.project.slug)}&full=1`);
    const full = returns.find((x) => x.id === r.id); if (!full) return;
    const a = el("a", { href: URL.createObjectURL(new Blob([full.content], { type: "text/markdown" })), download: full.filename }); document.body.append(a); a.click(); a.remove();
  }
  $("cf-return-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("cf-return-msg"), btn = e.submitter || $("cf-return-form").querySelector("button[type=submit]");
    const file = $("cf-file").files[0];
    let content = $("cf-paste").value, filename = `returned-${cfFilename()}`;
    try {
      if (file) {
        if (file.size > 2_000_000) throw new Error("That file is over 2 MB. Send the text, not images.");
        content = await file.text(); filename = file.name;
      }
      if (!content.trim()) throw new Error("Pick a file or paste the text first.");
      btn.disabled = true; msg.textContent = "Scanning and sending…";
      const r = await api("/returns", { method: "POST", body: { project: state.project.slug, name: store.get("name"), note: $("cf-note").value, filename, content } });
      $("cf-file").value = ""; $("cf-paste").value = ""; $("cf-note").value = "";
      msg.textContent = r.held
        ? "Received, and held for the castle to look at first: " + (r.scan.flags || []).join("; ") + "."
        : "Received. The castle will read it and work from it.";
      state.project.returns = (state.project.returns || 0) + 1;
      loadReturns();
    } catch (err) { msg.textContent = err.message; }
    finally { btn.disabled = false; }
  });

  if (store.get("token")) start().catch(() => {}); else showGate();
})();
