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
  let state = { projects: [], project: null, round: null, item: null, version: null, replyTo: null, table: null, cf: [], view: "item" };
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
    $("table-name").textContent = t || "";
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
    cfLoad(); renderCfButton(); loadReference(); refreshAttachPicker();
    const tabs = $("projects");
    tabs.hidden = state.projects.length < 2;
    tabs.replaceChildren(...state.projects.map((x) => el("button", { class: "tab", type: "button", "aria-selected": String(x.slug === slug), onclick: () => pickProject(x.slug) }, x.title)));
    const info = p.info || {};
    $("p-title").textContent = p.title;
    $("p-lede").textContent = info.lede || "";
    $("p-lede").hidden = !info.lede;
    $("p-cards").replaceChildren(...(info.cards || []).map((c) => el("div", {}, el("b", {}, c.label), c.text)));
    $("direction").hidden = !info.lede && !(info.cards || []).length;
    renderCfSheet(); loadReturns();
    const rs = rounds(p);
    const item = p.items.find((i) => i.slug === wantItem);
    const ready = rs.filter((r) => r.items.length);
    pickRound(item ? item.round : (ready.length ? ready[ready.length - 1].name : rs[0].name), wantItem);
  }

  function pickRound(name, wantItem) {
    const rs = rounds(state.project);
    const r = rs.find((x) => x.name === name) || rs[0];
    state.round = r.name;
    const starsFor = (sel) => sel.length ? el("span", { class: "stars", title: `select${sel.length === 1 ? "" : "s"}: ${sel.map((s) => s.name).join(", ")}`, "aria-label": `${sel.length} select${sel.length === 1 ? "" : "s"}` }, "★".repeat(Math.min(sel.length, 8))) : null;
    $("rounds").replaceChildren(...rs.map((x) => el("span", { class: "round-pick" }, el("button", {
      class: "tab" + (x.items.length ? "" : " is-waiting"), type: "button", role: "tab", "aria-selected": String(x.name === r.name), onclick: () => pickRound(x.name),
      title: x.items.length ? "" : (x.status === "building" ? "being built now" : "queued"),
    }, x.name), starsFor(x.items.flatMap((i) => i.selects)))));
    const ready = r.items.length > 0;
    const label = ready ? "" : r.status === "building" ? "being built now" : "queued";
    const changes = r.changes || [];
    const notes = el("details", { class: "changes-wrap", open: store.get("notes") === "open" ? true : false },
      el("summary", {}, `what changed`, el("span", { class: "muted" }, ` · ${changes.length}`)),
      el("ul", { class: "changes" }, changes.map((c) => el("li", {}, c))));
    notes.addEventListener("toggle", () => store.set("notes", notes.open ? "open" : ""));
    $("round-info").replaceChildren(
      el("div", { class: "meta" }, el("h2", {}, r.name), label ? el("span", { class: "status" }, label) : null),
      r.summary ? el("p", { class: "summary" }, r.summary) : null,
      changes.length ? notes : null,
    );
    document.querySelector(".work").hidden = false;
    if (!ready) {
      $("parts").replaceChildren(); $("version-wrap").hidden = true;
      document.querySelector(".selectbar").hidden = true; $("item-note").textContent = "";
      document.querySelector(".work-head").hidden = true;
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
    state.view = "item";
    renderParts(r, slug);
    showFrame();
    $("version-wrap").hidden = item.versions.length < 2;
    renderSpec(item);
    $("version").replaceChildren(...[...item.versions].reverse().map((v) => el("option", { value: v, selected: v === state.version }, `v${v}${v === item.version ? " (latest)" : ""}`)));
    document.querySelector(".selectbar").hidden = false;
    document.querySelector(".work-head").hidden = false;
    try { history.replaceState(null, "", "#" + slug); } catch (e) { /* file preview */ }
    renderSelects();
    renderCfButton();
    $("ref-attach").replaceChildren(...draftOptions(slug));
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
    // The version note earns its line only when there is more than one version and it says something the
    // round's summary doesn't already say (a v1 note usually repeats the round summary).
    const round = rounds(state.project).find((x) => x.name === state.round) || {};
    const fresh = d.note && (round.summary || "").trim().toLowerCase().replace(/[.\s]+$/, "") !== d.note.trim().toLowerCase().replace(/[.\s]+$/, "");
    $("item-note").textContent = fresh && item.versions.length > 1 ? `what changed in v${d.version}: ${d.note}` : "";
    const frame = el("iframe", { id: "frame", title: `${item.round} ${item.part}`, sandbox: "allow-scripts" });
    frame.srcdoc = d.content;
    $("frame-box").replaceChildren(frame);
  }
  $("version").addEventListener("change", (e) => pickItem(state.item.slug, Number(e.target.value)));

  // ---------- the pieces row: items, then questions and recipe ----------
  function renderParts(r, slug) {
    const info = state.project.info || {};
    const asks = info.asks || [];
    const recipe = roundRecipe(r);
    const aux = [];
    if (asks.length) aux.push(el("button", { class: "tab aux", type: "button", role: "tab", "aria-selected": String(state.view === "questions"), onclick: () => showText("questions") }, "questions", el("span", { class: "count" }, String(asks.length))));
    aux.push(el("button", { class: "tab aux", type: "button", role: "tab", "aria-selected": String(state.view === "recipe"), onclick: () => showText("recipe"), title: recipe.length ? "" : "how this draft was made: nothing recorded yet" }, "recipe"));
    $("parts").replaceChildren(...r.items.map((i) => el("button", {
      class: "tab", type: "button", role: "tab", "aria-selected": String(state.view === "item" && i.slug === slug), onclick: () => pickItem(i.slug),
      title: i.selects.length ? `select${i.selects.length === 1 ? "" : "s"}: ${i.selects.map((s) => s.name).join(", ")}` : "",
    }, i.part, i.selects.length ? el("span", { class: "stars inline", "aria-hidden": "true" }, "★".repeat(Math.min(i.selects.length, 8))) : null)),
    el("span", { class: "parts-gap", "aria-hidden": "true" }), ...aux);
  }
  function roundRecipe(r) {
    const v = r.recipe;
    return Array.isArray(v) ? v.filter(Boolean) : v ? [String(v)] : [];
  }
  function showFrame() {
    document.querySelector(".work").classList.remove("is-text");
    $("text-sheet").hidden = true; $("frame-box").hidden = false;
    document.querySelector(".comments").hidden = false;
    document.querySelector(".selectbar").hidden = false;
    $("item-spec").hidden = !$("item-spec").childElementCount;
    $("version-wrap").hidden = !state.item || state.item.versions.length < 2;
  }
  // questions and recipe show as a text sheet where the draft would be; no select, no comments column
  function showText(kind) {
    const r = rounds(state.project).find((x) => x.name === state.round);
    if (!r) return;
    state.view = kind;
    renderParts(r, state.item ? state.item.slug : null);
    const info = state.project.info || {};
    const body = kind === "questions"
      ? [el("h2", {}, "What we'd love your eyes on"), el("ul", {}, (info.asks || []).map((a) => el("li", {}, a)))]
      : [el("h2", {}, `${r.name} · how it was made`),
         ...(roundRecipe(r).length ? roundRecipe(r).map((t) => el("p", {}, t)) : [el("p", { class: "muted" }, "Nothing recorded for this draft yet. The recipe comes from the draft's own notes when it is posted.")])];
    $("text-sheet").replaceChildren(...body);
    $("text-sheet").hidden = false; $("frame-box").hidden = true;
    document.querySelector(".work").classList.add("is-text");
    document.querySelector(".comments").hidden = true;
    document.querySelector(".selectbar").hidden = true;
    $("item-spec").hidden = true; $("version-wrap").hidden = true;
  }
  // What the item is: the project's default spec with the item's own on top. Format and aspect ratio travel
  // with the item so the next version, or a requested edit, can use another one.
  function renderSpec(item) {
    // an item of a different format than the project's default (a text shot list on a video project) keeps only its own spec
    const base = (state.project.info || {}).spec || {}, own = item.spec || {};
    const spec = own.format && base.format && own.format !== base.format ? own : { ...base, ...own };
    const tags = ["format", "aspect", "length"].filter((k) => spec[k]).map((k) => el("span", { class: "tag", title: k }, spec[k]));
    $("item-spec").replaceChildren(...tags);
    $("item-spec").title = spec.note || "";
    $("item-spec").hidden = !tags.length;
  }

  // ---------- selects ----------
  function renderSelects() {
    const item = state.item; if (!item) return;
    const me = store.get("name");
    const mine = item.selects.find((s) => s.name === me);
    const btn = $("select-btn");
    btn.setAttribute("aria-pressed", String(!!mine));
    btn.textContent = mine ? "★ Your select · take it back" : "☆ Make this my select";
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
      pickRound(state.round, item.slug);
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
      (c.assets || []).length ? el("div", { class: "files" }, c.assets.map((a) => el("a", { href: a.url || "#", target: "_blank", rel: "noreferrer", download: a.filename, title: a.filename },
        a.kind === "image" && a.url ? el("img", { src: a.url, alt: a.filename }) : `${a.filename}`))) : null,
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
      const files = [...$("comment-files").files];
      const assetIds = [];
      for (const f of files) {
        $("comment-error").textContent = `Uploading ${f.name}…`;
        const r = await uploadAsset(f, { draft_slug: state.item.slug, note: "with a comment" });
        if (!r.held) assetIds.push(r.id);
      }
      $("comment-error").textContent = "";
      await api("/comments", { method: "POST", body: {
        slug: state.item.slug, version: state.version, name: store.get("name"),
        where: $("where").value, body: $("body").value, parent_id: state.replyTo ? state.replyTo.id : undefined,
        asset_ids: assetIds,
      } });
      $("body").value = ""; $("where").value = ""; $("comment-files").value = ""; setReply(null);
      await loadComments();
      if (files.length) loadReference();
    } catch (err) { $("comment-error").textContent = err.message; }
    finally { btn.disabled = false; }
  });

  // ---------- reference assets ----------
  // The file goes straight from the browser to Storage through a one-time signed address the server hands
  // out; then the server looks at the real first bytes before the file is listed. Nothing here renders a
  // file as a page: images, video and audio show through their own elements, everything else is a download.
  async function uploadAsset(file, opts = {}) {
    const name = store.get("name");
    const begin = await api("/assets/begin", { method: "POST", body: {
      project: state.project.slug, name, filename: file.name, mime: file.type || "application/octet-stream", bytes: file.size,
      draft_slug: opts.draft_slug || undefined, note: opts.note || undefined, origin: opts.origin || undefined,
    } });
    const put = await fetch(begin.upload_url, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file });
    if (!put.ok) throw new Error(`Upload of ${file.name} failed (${put.status}).`);
    return api("/assets/done", { method: "POST", body: { id: begin.id, name } });
  }
  function kindIcon(kind, filename) {
    const ext = (filename.match(/\.([a-z0-9]+)$/i) || [, kind])[1].toUpperCase();
    return el("span", { class: "icon" }, ext);
  }
  function assetThumb(a) {
    if (!a.url) return el("div", { class: "thumb" }, kindIcon(a.kind, a.filename));
    if (a.kind === "image" && !/\.(heic|heif|tiff?)$/i.test(a.filename)) return el("div", { class: "thumb" }, el("img", { src: a.url, alt: a.filename, loading: "lazy" }));
    if (a.kind === "video") return el("div", { class: "thumb" }, el("video", { src: a.url, controls: true, preload: "metadata", muted: true }));
    if (a.kind === "audio") return el("div", { class: "thumb" }, el("audio", { src: a.url, controls: true, preload: "metadata" }));
    return el("div", { class: "thumb" }, kindIcon(a.kind, a.filename));
  }
  function itemLabel(slug) {
    const i = state.project && state.project.items.find((x) => x.slug === slug);
    return i ? `${i.round} · ${i.part}` : slug;
  }
  let refAssets = [];
  function draftOptions(selected) {
    const opts = [el("option", { value: "", selected: !selected }, "the whole project")];
    for (const r of rounds(state.project)) for (const i of r.items) opts.push(el("option", { value: i.slug, selected: i.slug === selected }, `${i.round} · ${i.part}`));
    return opts;
  }
  function refreshAttachPicker() {
    const sel = $("ref-attach");
    const keep = sel.value || (state.item ? state.item.slug : "");
    sel.replaceChildren(...draftOptions(keep));
  }
  async function attachAsset(id, slug) {
    await api("/assets/attach", { method: "POST", body: { id, draft_slug: slug || null } });
    const a = refAssets.find((x) => x.id === id); if (a) a.draft_slug = slug || null;
    renderReference();
  }
  async function loadReference() {
    if (!state.project) return;
    try {
      const { assets } = await api(`/assets?project=${encodeURIComponent(state.project.slug)}`);
      refAssets = assets;
    } catch (err) { $("ref-grid").replaceChildren(el("p", { class: "error" }, err.message)); return; }
    renderReference(); renderCfSheet();
  }
  function renderReference() {
    const onlyThis = $("ref-this-item").checked && state.item;
    const list = onlyThis ? refAssets.filter((a) => a.draft_slug === state.item.slug) : refAssets;
    $("ref-count").textContent = refAssets.length ? `· ${list.length}${onlyThis ? ` of ${refAssets.length}` : ""}` : "";
    $("ref-grid").replaceChildren(...(list.length ? list.map((a) => el("div", { class: "ref-card" },
      assetThumb(a),
      el("div", { class: "meta" },
        el("b", {}, a.filename),
        el("span", {}, `${a.name} · ${when(a.created_at)} · ${Math.max(1, Math.round(a.bytes / 1024))} KB`),
        el("label", { class: "ref-on" }, "on ", el("select", { onchange: (e) => attachAsset(a.id, e.target.value).catch((err) => { $("ref-msg").textContent = err.message; }) }, ...draftOptions(a.draft_slug || ""))),
        a.comment_id ? el("span", {}, "with a comment") : null,
        a.origin === "return" ? el("span", {}, "came back with a carrierfile") : null,
        a.note ? el("span", {}, a.note) : null,
        a.url ? el("a", { href: a.url, download: a.filename, target: "_blank", rel: "noreferrer" }, "download") : null)))
      : [el("p", { class: "ref-empty" }, onlyThis ? "Nothing on this item yet." : "Nothing here yet. Be the first to drop something in.")]));
  }
  $("ref-this-item").addEventListener("change", renderReference);
  async function addReferenceFiles(files) {
    const msg = $("ref-msg");
    const note = $("ref-note").value;
    let done = 0, held = 0;
    for (const f of files) {
      msg.textContent = `Uploading ${f.name}…`;
      try {
        const r = await uploadAsset(f, { note, draft_slug: $("ref-attach").value || undefined });
        done += 1; if (r.held) held += 1;
      } catch (err) { msg.textContent = `${f.name}: ${err.message}`; await new Promise((r) => setTimeout(r, 1800)); }
    }
    msg.textContent = done ? `${done} file${done === 1 ? "" : "s"} added${held ? `, ${held} held for the castle to check first` : ""}.` : msg.textContent;
    $("ref-note").value = "";
    loadReference();
  }
  $("ref-pick").addEventListener("click", () => $("ref-files").click());
  $("ref-files").addEventListener("change", (e) => { addReferenceFiles([...e.target.files]); e.target.value = ""; });
  const drop = $("ref-drop");
  for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); });
  drop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) addReferenceFiles([...e.dataTransfer.files]); });

  // ---------- the project carrierfile ----------
  // Picked items are remembered per project on this browser. The file itself comes from the server, which
  // only includes published items on this table; the browser never assembles it from the drafts.
  function cfKey() { return "cf." + (state.project ? state.project.slug : ""); }
  function cfLoad() { try { state.cf = JSON.parse(store.get(cfKey()) || "[]"); } catch (e) { state.cf = []; } }
  function cfSave() { store.set(cfKey(), state.cf.length ? JSON.stringify(state.cf) : ""); renderCfButton(); renderCfSheet(); }
  function cfItems() { return state.cf.map((s) => state.project.items.find((i) => i.slug === s)).filter(Boolean); }
  function renderCfButton() {
    const n = state.project ? cfItems().length : 0;
    $("cf-count").hidden = !n; $("cf-count").textContent = n;
    const add = $("cf-add");
    if (state.item) {
      const on = state.cf.includes(state.item.slug);
      add.setAttribute("aria-pressed", String(on));
      add.textContent = on ? "✓ in the carrierfile" : "＋ carrierfile";
    }
  }
  $("cf-add").addEventListener("click", () => {
    if (!state.item) return;
    const slug = state.item.slug;
    state.cf = state.cf.includes(slug) ? state.cf.filter((s) => s !== slug) : [...state.cf, slug];
    cfSave();
  });
  function renderCfSheet() {
    if (!state.project) return;
    const items = cfItems();
    $("cf-n").textContent = items.length ? `· ${items.length}` : "";
    $("cf-items").replaceChildren(...(items.length ? items.map((i) => el("li", {},
      el("span", {}, `${i.round} · ${i.part}`, " ", el("span", { class: "meta" }, `v${i.version}`)),
      el("button", { type: "button", class: "link small", onclick: () => { state.cf = state.cf.filter((s) => s !== i.slug); cfSave(); renderCfSheet(); } }, "remove")))
      : [el("li", { class: "muted" }, "Nothing picked yet. Press “＋ Carrierfile” on any item.")]));
    $("cf-copy").disabled = $("cf-download").disabled = $("cf-package").disabled = !items.length;
    $("cf-msg").textContent = "";
    $("cf-sheet-sub").textContent = `· ${items.length} draft${items.length === 1 ? "" : "s"} picked · ${refAssets.length} reference file${refAssets.length === 1 ? "" : "s"}`;
  }
  function setCfSheet(open) {
    $("cf-body").hidden = !open;
    $("cf-toggle").textContent = open ? "hide" : "show";
    $("cf-toggle").setAttribute("aria-expanded", String(open));
    store.set("cfsheet", open ? "" : "closed");
  }
  $("cf-toggle").addEventListener("click", () => setCfSheet($("cf-body").hidden));
  setCfSheet(store.get("cfsheet") !== "closed");
  async function cfFetch() {
    const q = `slugs=${encodeURIComponent(state.cf.join(","))}&comments=${$("cf-comments").checked ? 1 : 0}&name=${encodeURIComponent(store.get("name"))}`;
    const res = await fetch(`${API}/carrierfile.md?${q}`, { headers: { authorization: "Bearer " + store.get("token") } });
    if (res.status === 401) { showGate("Please sign in again."); throw new Error("signed out"); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not make the carrierfile.");
    return res.text();
  }
  function cfFilename() {
    const d = new Date().toISOString().slice(0, 10);
    return `${state.project.slug}-carrierfile-${d}.md`;
  }
  $("cf-open").addEventListener("click", () => { if (!state.project) return; setCfSheet(true); renderCfSheet(); loadReturns(); $("cf-sheet").scrollIntoView({ behavior: "smooth", block: "start" }); });
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
  $("cf-clear").addEventListener("click", () => { state.cf = []; cfSave(); renderCfSheet(); });
  function jszip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise((resolve, reject) => {
      const s = el("script", { src: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", onload: () => resolve(window.JSZip), onerror: () => reject(new Error("Could not load the zip helper.")) });
      document.head.append(s);
    });
  }
  $("cf-package").addEventListener("click", async () => {
    const msg = $("cf-msg");
    try {
      msg.textContent = "Making the package…";
      const [JSZip, md] = await Promise.all([jszip(), cfFetch()]);
      const zip = new JSZip();
      zip.file("carrierfile.md", md);
      const { assets } = await api(`/assets?project=${encodeURIComponent(state.project.slug)}`);
      let n = 0;
      for (const a of assets) {
        if (!a.url) continue;
        msg.textContent = `Adding ${a.filename} (${n + 1} of ${assets.length})…`;
        const res = await fetch(a.url); if (!res.ok) continue;
        zip.file(`assets/${a.id}-${a.filename}`, await res.blob()); n += 1;
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const name = cfFilename().replace(/\.md$/, "-package.zip");
      const link = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(link); link.click(); link.remove();
      msg.textContent = `Saved ${name}: the carrierfile and ${n} reference file${n === 1 ? "" : "s"}.`;
    } catch (err) { msg.textContent = err.message; }
  });

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
    const extras = [];
    try {
      if (file && /\.zip$/i.test(file.name)) {
        msg.textContent = "Opening the package…";
        const JSZip = await jszip();
        const zip = await JSZip.loadAsync(file);
        let mdName = null;
        for (const [path, entry] of Object.entries(zip.files)) {
          if (entry.dir || /(^|\/)\./.test(path)) continue;
          const base = path.split("/").pop();
          if (/\.(md|txt|markdown)$/i.test(base) && !mdName) {
            const textContent = await entry.async("string");
            if (/^\s*CARRIERFILE\//.test(textContent)) { content = textContent; filename = base; mdName = path; continue; }
          }
          const blob = await entry.async("blob");
          if (blob.size > 0) extras.push(new File([blob], base, { type: "" }));
        }
        if (!mdName) throw new Error("No carrierfile in that package (a .md starting with CARRIERFILE/).");
      } else if (file) {
        if (file.size > 2_000_000) throw new Error("That file is over 2 MB. Send the text, not images.");
        content = await file.text(); filename = file.name;
      }
      if (!content.trim()) throw new Error("Pick a file or paste the text first.");
      btn.disabled = true; msg.textContent = "Scanning and sending…";
      const r = await api("/returns", { method: "POST", body: { project: state.project.slug, name: store.get("name"), note: $("cf-note").value, filename, content } });
      $("cf-file").value = ""; $("cf-paste").value = ""; $("cf-note").value = "";
      let added = 0, refused = [];
      for (const f of extras) {
        msg.textContent = `Adding ${f.name} to the reference area…`;
        try { await uploadAsset(f, { origin: "return", note: `came back with ${filename}` }); added += 1; }
        catch (err) { refused.push(`${f.name}: ${err.message}`); }
      }
      msg.textContent = (r.held
        ? "Received, and held for the castle to look at first: " + (r.scan.flags || []).join("; ") + "."
        : "Received. The castle will read it and work from it.")
        + (added ? ` ${added} reference file${added === 1 ? "" : "s"} added.` : "") + (refused.length ? ` Not added: ${refused.join("; ")}` : "");
      state.project.returns = (state.project.returns || 0) + 1;
      loadReturns(); if (added) loadReference();
    } catch (err) { msg.textContent = err.message; }
    finally { btn.disabled = false; }
  });

  if (store.get("token")) start().catch(() => {}); else showGate();
})();
