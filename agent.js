// The agent's door (agent.html): a pass screen, then a plain, readable dashboard for agents that use a browser.
// The pass lives in sessionStorage (this tab only) and goes out only as the Authorization header, never in a URL.
// Everything shown is text, escaped by the DOM; no draft page is ever rendered here. No publish button exists:
// publishing is the person's, on the table page.
(function () {
  "use strict";
  const API = window.REVIEW_ROOM_API;
  const RR = window.RR;
  const $ = (id) => document.getElementById(id);
  const pass = {
    get() { try { return sessionStorage.getItem("rr.agent.pass") || ""; } catch (e) { return ""; } },
    set(v) { try { v ? sessionStorage.setItem("rr.agent.pass", v) : sessionStorage.removeItem("rr.agent.pass"); } catch (e) { /* private window */ } },
  };
  let state = { me: null, table: null, projects: [], mine: [] };

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
      headers: { "content-type": "application/json", authorization: "Bearer " + pass.get() },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (opts.text) {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Something went wrong.");
      return res.text();
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showGate("That pass did not open a table. It may have been unharnessed, or the table's password changed."); throw new Error("not harnessed"); }
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
    return data;
  }

  // ---------- the pass screen ----------
  function showGate(msg) {
    pass.set("");
    $("room").hidden = true; $("me").hidden = true; $("gate").hidden = false;
    $("gate-error").textContent = msg || "";
    $("gate-pass").focus();
  }
  $("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("gate-pass").value.trim();
    if (!/^rra_[A-Za-z0-9_-]{43}$/.test(v)) { $("gate-error").textContent = "An agent pass starts with rra_ and is 47 characters long."; return; }
    pass.set(v); $("gate-pass").value = "";
    try { await start(); } catch (err) { if (err.message !== "not harnessed") $("gate-error").textContent = err.message; }
  });
  $("forget").addEventListener("click", () => showGate("Pass forgotten on this tab."));
  $("guide-link").href = API + "/agent.md";
  const wantTable = (new URLSearchParams(location.search).get("t") || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 61);
  if (wantTable) $("gate-table-link").href = "./?t=" + encodeURIComponent(wantTable);

  // ---------- the dashboard ----------
  async function start() {
    const me = await api("/agent/me");
    state.me = me;
    state.table = me.agent.table;
    const r = await api("/room");
    state.projects = r.projects || [];
    $("gate").hidden = true; $("me").hidden = false; $("room").hidden = false;
    $("me-name").textContent = me.agent.name; $("me-person").textContent = me.agent.person;
    $("table-name").textContent = state.table.title;
    document.title = `${state.table.title} · agent door`;
    $("me-line").replaceChildren(
      RR.mark(me.agent.name, "agent", me.agent.person), el("b", {}, me.agent.name), el("span", { class: "muted" }, `agent, for ${me.agent.person} · on the ${state.table.title} table · harnessed ${when(me.agent.harnessed_at)}`),
      el("span", { class: "muted small" }, `· ${me.used.writes_this_hour} of ${me.limits.writesPerHour} writes this hour · ${me.used.drafts_today} of ${me.limits.draftsPerDay} new drafts today`));
    renderProjects();
    renderMine(me.drafts || []);
    fillSelects();
  }
  function when(iso) {
    try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (e) { return iso; }
  }
  function itemLabel(slug) {
    for (const p of state.projects) { const i = p.items.find((x) => x.slug === slug); if (i) return `${i.round} · ${i.part}`; }
    return slug;
  }
  function specLine(p, i) {
    const base = (p.info || {}).spec || {}, own = i.spec || {};
    const spec = own.format && base.format && own.format !== base.format ? own : { ...base, ...own };
    return ["format", "aspect", "length"].filter((k) => spec[k]).map((k) => `${k} ${spec[k]}`).join(" · ");
  }

  // Each project as text: direction, rounds, open questions, then every item as a fold with its text, comments and a comment form.
  function renderProjects() {
    $("projects").replaceChildren(...state.projects.map((p) => {
      const info = p.info || {};
      const wrap = el("section", { class: "project", "aria-label": p.title });
      wrap.append(el("h3", {}, p.title, " ", el("span", { class: "muted" }, `(${p.slug})`)));
      if (info.lede) wrap.append(el("p", {}, info.lede));
      if ((info.cards || []).length) wrap.append(el("ul", { class: "can-list" }, info.cards.map((c) => el("li", {}, el("b", {}, c.label + ": "), c.text))));
      if ((info.rounds || []).length) wrap.append(el("ul", { class: "can-list" }, info.rounds.map((r) => el("li", {}, el("b", {}, r.name), ` (${r.status || "ready"}): ${r.summary || ""}`))));
      if ((info.asks || []).length) wrap.append(el("p", { class: "muted small" }, "Open questions: "), el("ul", { class: "can-list" }, info.asks.map((a) => el("li", {}, a))));
      for (const i of p.items) wrap.append(itemFold(p, i));
      if (!p.items.length) wrap.append(el("p", { class: "muted" }, "Nothing on this project yet."));
      return wrap;
    }));
  }
  function stateBadges(i) {
    const out = [];
    if (i.mine) out.push(el("span", { class: "badge team-only" }, i.published ? "your team draft" : "your team draft · team only"));
    else if (i.team) out.push(el("span", { class: "badge" }, `team draft by ${i.team}`));
    if ((i.states || []).some((s) => s.held)) out.push(el("span", { class: "badge held" }, "held for Anna"));
    return out;
  }
  function itemFold(p, i) {
    const inner = el("div", { class: "inner" });
    const d = el("details", { class: "item" },
      el("summary", {}, el("b", {}, `${i.round} · ${i.part}`), el("span", { class: "meta" }, `${i.slug} · v${i.version}${i.versions.length > 1 ? ` of ${i.versions.join(", ")}` : ""} · ${i.comments} comment${i.comments === 1 ? "" : "s"}${i.selects.length ? ` · ${i.selects.length} select${i.selects.length === 1 ? "" : "s"}` : ""}`), ...stateBadges(i)),
      inner);
    let loaded = false;
    d.addEventListener("toggle", async () => {
      if (!d.open || loaded) return;
      loaded = true;
      const meta = [specLine(p, i), i.note ? `what changed: ${i.note}` : "", i.based_on_slug ? `based on ${itemLabel(i.based_on_slug)} v${i.based_on_version}` : "", i.selects.length ? "selects: " + i.selects.map((s) => `${s.name} (v${s.draft_version}${s.note ? `, "${s.note}"` : ""})`).join("; ") : ""].filter(Boolean).join(" · ");
      const held = (i.states || []).filter((s) => s.held);
      inner.replaceChildren(
        meta ? el("p", { class: "meta" }, meta) : null,
        held.length ? el("p", { class: "meta" }, "Held for Anna: " + held.map((s) => `v${s.version}: ${s.reasons.join("; ")}`).join(" · ")) : null,
        el("div", { class: "acts" },
          el("button", { type: "button", class: "cf-btn", onclick: () => loadText(i, inner) }, "Read the text"),
          el("span", { class: "muted small" }, "the words a model reads: a script in full, an animatic's on-screen words, a shot list's rows")),
        el("h3", {}, "Comments"),
        el("ol", { class: "thread", id: `thread-${i.slug}` }, el("li", { class: "muted" }, "Loading…")),
        commentForm(i));
      loadComments(i);
    });
    return d;
  }
  async function loadText(i, inner) {
    const old = inner.querySelector("pre.text");
    if (old) { old.remove(); return; }
    try {
      const { draft } = await api(`/draft?slug=${encodeURIComponent(i.slug)}&version=${i.version}&text=1`);
      inner.insertBefore(el("pre", { class: "text", tabindex: "0" }, draft.feed_text || "(this item has no text version; it is visual only)"), inner.querySelector("h3"));
    } catch (err) { inner.insertBefore(el("p", { class: "error" }, err.message), inner.querySelector("h3")); }
  }
  function commentNode(c, kids) {
    const kind = c.author_kind === "castle" ? "castle" : c.author_kind === "agent" ? "agent" : "person";
    const linked = c.on_part ? ` · made on the ${c.on_part.toLowerCase()}` : "";
    return el("li", { class: kind + (c.on_part ? " linked" : "") },
      el("div", {}, c.shot != null ? el("span", { class: "shot-badge" }, `shot ${c.shot}`) : null,
        el("span", { class: "who" }, RR.mark(kind === "castle" ? "castle" : c.name, kind, c.agent_for), c.name,
          kind === "castle" ? el("span", { class: "for" }, "castle") : kind === "agent" ? el("span", { class: "for" }, `agent, for ${c.agent_for || "someone"}`) : null), " ",
        el("span", { class: "when" }, `#${c.id} · ${when(c.created_at)} · v${c.draft_version}${c.where_at ? " · at " + c.where_at : ""}${linked}`)),
      el("p", { class: "body" }, c.body),
      kids.length ? el("ol", { class: "replies" }, kids.map((k) => commentNode(k, []))) : null);
  }
  async function loadComments(i) {
    const list = $(`thread-${i.slug}`);
    try {
      const { comments } = await api(`/comments?slug=${encodeURIComponent(i.slug)}&linked=1`);
      const top = comments.filter((c) => !c.parent_id).reverse();
      list.replaceChildren(...(top.length ? top.map((c) => commentNode(c, comments.filter((k) => k.parent_id === c.id))) : [el("li", { class: "muted" }, "No comments yet.")]));
    } catch (err) { list.replaceChildren(el("li", { class: "error" }, err.message)); }
  }
  function commentForm(i) {
    const shot = el("input", { type: "number", id: `shot-${i.slug}`, min: "1", max: "999", inputmode: "numeric" });
    const where = el("input", { type: "text", id: `where-${i.slug}`, maxlength: "80", placeholder: "0:36" });
    const parent = el("input", { type: "number", id: `parent-${i.slug}`, min: "1", placeholder: "comment id, like 12" });
    const body = el("textarea", { id: `body-${i.slug}`, rows: "4", maxlength: "4000", required: true });
    const msg = el("span", { class: "status", role: "status" });
    const form = el("form", { class: "card", "aria-label": `comment on ${i.round} ${i.part}` },
      el("div", { class: "row" },
        el("label", { for: `shot-${i.slug}` }, "shot (optional)", shot),
        el("label", { for: `where-${i.slug}` }, "time (optional)", where),
        el("label", { for: `parent-${i.slug}` }, "replying to # (optional)", parent)),
      el("label", { for: `body-${i.slug}` }, `comment, as ${state.me.agent.name} (agent, for ${state.me.agent.person})`, body),
      el("div", { class: "acts" }, el("button", { type: "submit", class: "primary" }, "Post the comment"), msg));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button"); btn.disabled = true; msg.textContent = "Posting…";
      try {
        await api("/comments", { method: "POST", body: { slug: i.slug, version: i.version, body: body.value, where: where.value, shot: shot.value ? Number(shot.value) : undefined, parent_id: parent.value ? Number(parent.value) : undefined } });
        body.value = ""; where.value = ""; parent.value = ""; msg.textContent = "Posted.";
        await loadComments(i);
      } catch (err) { msg.textContent = err.message; }
      finally { btn.disabled = false; }
    });
    return form;
  }

  // ---------- the whole table as text ----------
  $("feed-btn").addEventListener("click", async () => {
    const pre = $("feed-text");
    if (!pre.hidden) { pre.hidden = true; $("feed-btn").textContent = "Show the whole table as text"; return; }
    $("feed-msg").textContent = "Loading…";
    try { pre.textContent = await api("/agent/feed.md", { text: true }); pre.hidden = false; $("feed-btn").textContent = "Hide the text"; $("feed-msg").textContent = ""; }
    catch (err) { $("feed-msg").textContent = err.message; }
  });

  // ---------- team drafts: new, and new versions of your own ----------
  function fillSelects() {
    $("new-project").replaceChildren(...state.projects.map((p) => el("option", { value: p.slug }, p.title)));
    const based = [el("option", { value: "" }, "nothing: from scratch")];
    for (const p of state.projects) for (const i of p.items) based.push(el("option", { value: `${p.slug}|${i.slug}|${i.version}` }, `${p.title}: ${i.round} · ${i.part} v${i.version}${i.team ? ` (team draft by ${i.team})` : ""}`));
    $("new-based").replaceChildren(...based);
    $("save-slug").replaceChildren(...(state.mine.length ? state.mine.map((d) => el("option", { value: d.slug }, `${d.slug}: ${d.title} (v${d.versions[d.versions.length - 1].version})`)) : [el("option", { value: "" }, "no team drafts of yours yet")]));
  }
  function renderMine(drafts) {
    state.mine = drafts;
    $("mine").replaceChildren(...(drafts.length ? drafts.map((d) => {
      const last = d.versions[d.versions.length - 1];
      const published = d.versions.filter((v) => v.published).map((v) => v.version);
      const held = d.versions.filter((v) => v.held);
      return el("li", {}, el("span", {}, el("b", {}, d.title), " ", el("span", { class: "meta" }, `${d.slug} · ${d.part} on ${d.project} · v${last.version}${d.based_on_slug ? ` · based on ${itemLabel(d.based_on_slug)} v${d.based_on_version}` : ""} · ${published.length ? `published: v${published.join(", v")}` : "team only"}${held.length ? ` · held for Anna: ${held.map((v) => `v${v.version} (${v.reasons.join("; ")})`).join(", ")}` : ""}`)));
    }) : [el("li", { class: "muted" }, "None yet. Make one above, or version up from a draft on the table.")]));
  }
  $("new-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("new-form").querySelector("button[type=submit]"), msg = $("new-msg");
    btn.disabled = true; msg.textContent = "Scanning and saving…";
    try {
      const based = $("new-based").value ? $("new-based").value.split("|") : null;
      const spec = {};
      if ($("new-format").value.trim()) spec.format = $("new-format").value.trim();
      if ($("new-aspect").value.trim()) spec.aspect = $("new-aspect").value.trim();
      if ($("new-length").value.trim()) spec.length = $("new-length").value.trim();
      const r = await api("/agent/drafts", { method: "POST", body: {
        project: based ? based[0] : $("new-project").value, part: $("new-part").value, title: $("new-title-in").value, kind: $("new-kind").value,
        content: $("new-content").value, note: $("new-note").value, spec, based_on: based ? { slug: based[1], version: Number(based[2]) } : undefined,
      } });
      msg.textContent = `Made ${r.slug} v1. ${r.next}`;
      $("new-content").value = ""; $("new-note").value = ""; $("new-title-in").value = "";
      await start();
    } catch (err) { msg.textContent = err.message; }
    finally { btn.disabled = false; }
  });
  $("save-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("save-form").querySelector("button[type=submit]"), msg = $("save-msg");
    if (!$("save-slug").value) { msg.textContent = "No team draft of yours to save into yet."; return; }
    btn.disabled = true; msg.textContent = "Scanning and saving…";
    try {
      // round 8: a save edits the draft in place and says which revision it started from (from /agent/me)
      const d = state.mine.find((x) => x.slug === $("save-slug").value);
      const r = await api("/agent/drafts/save", { method: "POST", body: { slug: $("save-slug").value, title: $("save-title").value || undefined, content: $("save-content").value, note: $("save-note").value, base_revision: d ? (d.revision || 0) : 0 } });
      msg.textContent = `Saved ${r.slug} v${r.version} (revision ${r.revision}). ${r.next}`;
      $("save-content").value = ""; $("save-note").value = ""; $("save-title").value = "";
      await start();
    } catch (err) { msg.textContent = err.message; }
    finally { btn.disabled = false; }
  });

  if (pass.get()) start().catch(() => {}); else showGate();
})();
