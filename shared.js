// shared.js: small helpers both pages (the table and the agent door) use. No network, no state.
//  - marks: a round mark with a commenter's initials in a color picked from their name (stable), a square mark
//    for an agent in its person's color, the Carrierfile mark for castle replies (Anna, 11/2: "different
//    people's comments are diff colors or theres a little icon"). Names stay text; the color is never the only signal.
//  - themes: a table's look as data: blank (the shell's paper and ink), the swai preset, or a few hex colors
//    with a contrast check for the text on them.
//  - ago(): "2 min ago" words for last-seen times.
//  - round 8: the edit icon's state and note, the title menu's entries, the editor's plain-text markdown preview.
//  - 11/6: reference ratings (love / maybe / pass) and the reference grid's filters.
// tests-next/shared_test.js runs the pure parts under node.
(function (root) {
  "use strict";
  // Ten colors that carry white initials at 4.5:1 or better and sit well on the white sheets and the dark bar.
  const PALETTE = ["#2b3fa8", "#8a2d6b", "#1f6e52", "#a3481a", "#5a1f8a", "#1d6494", "#a3272f", "#4a6b1f", "#6b4b1a", "#3b3b8c"];
  const CASTLE_INK = "#111111";

  function hashName(name) {
    let h = 5381;
    for (const ch of String(name || "").trim().toLowerCase()) h = (Math.imul(h, 33) ^ ch.codePointAt(0)) >>> 0;
    return h;
  }
  function colorFor(name) { return PALETTE[hashName(name) % PALETTE.length]; }
  function initials(name) {
    const words = String(name || "").trim().split(/[\s._'-]+/).filter(Boolean);
    if (!words.length) return "?";
    const first = [...words[0]][0] || "?";
    const last = words.length > 1 ? ([...words[words.length - 1]][0] || "") : "";
    return (first + last).toUpperCase();
  }
  // kind: "person" (default) | "agent" (square, in the person's color) | "castle" (the Carrierfile mark)
  function mark(name, kind, person) {
    const span = root.document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    if (kind === "castle") {
      span.className = "mark castle"; span.style.background = CASTLE_INK; span.textContent = "cf"; span.title = "the castle";
      return span;
    }
    const owner = kind === "agent" ? (person || name) : name;
    span.className = "mark" + (kind === "agent" ? " agent" : "");
    span.style.background = colorFor(owner);
    span.textContent = initials(name);
    span.title = kind === "agent" ? `${name}, an agent for ${person || "someone on the table"}` : name;
    return span;
  }

  // ---- who's here (round 7): the row of marks top right ----
  // here: the server's list, most recent first. Up to max marks, then "+N"; your own mark says "you".
  function hereTitle(h) {
    if (h.you) return "you, here now";
    return h.kind === "agent" ? `${h.name}, agent for ${h.person_name || "someone on the table"}` : `${h.name}, here now`;
  }
  function herePlan(here, max) {
    const list = Array.isArray(here) ? here : [];
    const n = max || 6;
    const shown = list.slice(0, n).map((h) => ({ kind: h.kind === "agent" ? "agent" : "person", name: h.name, person: h.person_name || "", colorKey: h.color_key || h.name, you: !!h.you, title: hereTitle(h) }));
    return { shown, extra: Math.max(0, list.length - n), label: list.length ? `${list.length} here` : "" };
  }

  // ---- color math (same formula as lib.ts on the server) ----
  const HEX = /^#[0-9a-f]{6}$/i;
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function textOn(bg, wanted) {
    wanted = wanted || "#111111";
    if (contrast(bg, wanted) >= 4.5) return wanted;
    return contrast(bg, "#111111") >= contrast(bg, "#ffffff") ? "#111111" : "#ffffff";
  }
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  // a light tint of a color for the sheet behind the cards: mostly white, a little of the color
  function tint(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(255 - (255 - c) * amount);
    return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("");
  }

  // ---- themes ----
  const SWAI = {
    "--bg": "#f6f4f8", "--surface": "#fff", "--fg": "#1c1830", "--muted": "#625c74", "--line": "#e2dcea", "--tline": "rgba(90,31,138,.22)",
    "--v2": "#251E72", "--v3": "#440D6C", "--v4": "#73055D", "--accent": "#5a1f8a", "--accent-ink": "#fff", "--castle": "#f0e8f8",
  };
  const TOKEN_KEYS = Object.keys(SWAI);
  // The CSS custom properties a theme sets on the client card. {} = blank (the stylesheet's own paper and ink).
  function themeTokens(theme) {
    if (!theme || typeof theme !== "object") return {};
    if (theme.preset === "swai") return { ...SWAI };
    if (theme.preset || !theme.colors) return {};
    const c = theme.colors;
    const ok = (v) => typeof v === "string" && HEX.test(v);
    const out = {};
    const card = ok(c.card) ? c.card.toLowerCase() : "#ffffff";
    const ink = textOn(card, ok(c.ink) ? c.ink.toLowerCase() : "#111111");   // the wanted ink, unless it fails on the card
    const accent = ok(c.accent) ? c.accent.toLowerCase() : ink;
    out["--surface"] = card;
    out["--bg"] = luminance(card) > 0.5 ? tint(accent, 0.06) : card;
    out["--fg"] = ink;
    out["--muted"] = rgba(ink, 0.68);
    out["--line"] = rgba(ink, 0.14);
    out["--tline"] = rgba(accent, 0.28);
    out["--accent"] = accent;
    out["--accent-ink"] = textOn(accent, "#ffffff");
    out["--castle"] = luminance(card) > 0.5 ? tint(accent, 0.1) : rgba(ink, 0.08);
    const band = Array.isArray(c.band) ? c.band.filter(ok).map((x) => x.toLowerCase()) : ok(c.band) ? [c.band.toLowerCase()] : [accent];
    const b = band.length ? band : [accent];
    out["--v2"] = b[0]; out["--v3"] = b[1] || b[0]; out["--v4"] = b[2] || b[1] || b[0];
    return out;
  }
  function themeName(theme) {
    if (!theme || typeof theme !== "object") return "blank";
    if (theme.preset) return theme.preset;
    return theme.colors ? "custom" : "blank";
  }
  // Put a theme on the client card: set the tokens for swai or custom, clear them for blank.
  function applyTheme(theme, el) {
    if (!el) return;
    const tokens = themeTokens(theme);
    for (const k of TOKEN_KEYS) { if (tokens[k]) el.style.setProperty(k, tokens[k]); else el.style.removeProperty(k); }
    el.dataset.theme = themeName(theme);
  }

  // ---- round 8: the edit icon, the title menu, the editor's preview ----
  // item: what /room gives (sharing, can, kind, owner_name, states for the owner side). No network here.
  const SHARING_WORDS = { just_me: "Just me", read_only: "Read only", open: "Open to edit" };
  // The pencil: "edit" when you can edit here, "locked" (gray, with a small lock) when you can't, with the note the
  // hover or focus shows. HTML items are edited by agents through the API, so a person sees the lock with that note.
  function editIcon(item) {
    const can = (item && item.can) || {};
    const owner = (item && item.owner_name) || "Its owner";
    const sharing = (item && item.sharing) || "read_only";
    if (can.edit && item.kind === "html") return { state: "locked", note: "Your agent can edit this; people edit text items here." };
    if (can.edit) {
      if (sharing === "open") return { state: "edit", note: `Open to edit. Anyone on this table can edit. Changes save as you go and ${owner} can see who changed what.` };
      if (sharing === "just_me") return { state: "edit", note: "Just you. Only you and your agents can see this." };
      return { state: "edit", note: "Read only for the table. Your edits stay with your side until you publish the changes." };
    }
    if (sharing === "read_only") return { state: "locked", note: `Read only. ${owner} would love your comments. You can comment, or make your own copy to edit.` };
    return { state: "locked", note: "You can read this, not edit it." };
  }
  // Does the owner side have unpublished changes above the published version? (states come only to the owner side)
  function hasChanges(item) {
    const st = (item && item.states) || [];
    const pub = st.filter((s) => s.published).map((s) => s.version);
    if (!pub.length) return false;
    const top = Math.max(...pub);
    return st.some((s) => !s.published && s.version > top);
  }
  // The title menu, top to bottom. Each entry: {id, label, enabled, reason} (reason: the hover when grayed), or
  // {heading} / {separator}. Sharing entries are radios ({radio: true, checked}).
  function menuPlan(item) {
    const can = (item && item.can) || {};
    const owner = (item && item.owner_name) || "its owner";
    const sharing = (item && item.sharing) || "read_only";
    const notOwner = `Only ${owner} can do this.`;
    const notEditor = sharing === "read_only" ? "Read only: make your own copy to edit." : "You can't edit this.";
    const out = [
      { id: "history", label: "Show version history", enabled: true, reason: "" },
      { id: "version", label: "Save a version", enabled: !!can.save_version, reason: notEditor },
      { id: "copy", label: "Make my own copy", enabled: !!can.copy, reason: "You can't copy this." },
      { id: "rename", label: "Rename", enabled: !!can.edit, reason: notEditor },
      { separator: true }, { heading: "Sharing" },
    ];
    for (const s of ["just_me", "read_only", "open"]) out.push({ id: "sharing:" + s, label: SHARING_WORDS[s], radio: true, checked: sharing === s, enabled: !!can.sharing, reason: notOwner });
    out.push({ separator: true });
    if (sharing === "just_me") out.push({ id: "publish", label: "Publish", enabled: !!can.publish, reason: notOwner });
    else {
      if (hasChanges(item)) out.push({ id: "publish_changes", label: "Publish changes", enabled: !!can.publish, reason: notOwner });
      out.push({ id: "takeback", label: "Take back", enabled: !!can.publish, reason: notOwner });
    }
    out.push({ id: "remove", label: "Remove from table", enabled: !!can.publish && sharing !== "just_me", reason: sharing === "just_me" ? "It isn't on the table: just you." : notOwner });
    return out;
  }
  // The editor's preview: markdown read as plain blocks (headings, list items, paragraphs). Text only: the page turns
  // each block into a text node, never HTML.
  function mdBlocks(src) {
    const out = [];
    let para = [], list = null;
    const flush = () => { if (para.length) { out.push({ tag: "p", text: para.join(" ") }); para = []; } if (list) { out.push({ tag: "ul", items: list }); list = null; } };
    for (const raw of String(src || "").split("\n")) {
      const line = raw.trim();
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      const li = line.match(/^[-*+]\s+(.*)$/) || line.match(/^\d+[.)]\s+(.*)$/);
      if (!line) flush();
      else if (h) { flush(); out.push({ tag: "h" + Math.min(5, h[1].length + 2), text: h[2] }); }
      else if (li) { if (para.length) { out.push({ tag: "p", text: para.join(" ") }); para = []; } (list = list || []).push(li[1]); }
      else { if (list) { out.push({ tag: "ul", items: list }); list = null; } para.push(line); }
    }
    flush();
    return out;
  }

  // ---- reference ratings (11/6): love / maybe / pass on a reference file, people only ----
  // ratings: what /assets gives on each file, [{name, value, color_key, mine}]. The same rules as lib.ts on the server.
  const RATINGS = ["love", "maybe", "pass"];
  const RATING_WORDS = { love: "love", maybe: "maybe", pass: "pass" };
  // The function that is live today sends no ratings and no comment counts: the page keeps those controls hidden until
  // every file it was given carries both (an empty list says nothing either way).
  function ratingsReady(assets) {
    const list = Array.isArray(assets) ? assets : [];
    return list.length > 0 && list.every((a) => a && Array.isArray(a.ratings) && typeof a.comments === "number");
  }
  function myRating(a) {
    const r = ((a && a.ratings) || []).find((x) => x.mine);
    return r ? r.value : null;
  }
  // Tapping your current rating clears it; tapping another one sets that.
  function nextRating(current, tapped) { return current === tapped ? null : tapped; }
  // The grid's filters: all, loved_by_all (everyone who has rated any of these files loved this one), loved_by_me,
  // needs_look (no rating from me yet).
  const REF_FILTERS = [
    { id: "all", label: "All" }, { id: "loved_by_all", label: "Loved by everyone" },
    { id: "loved_by_me", label: "Loved by me" }, { id: "needs_look", label: "Needs a look" },
  ];
  function refFilter(assets, filter) {
    const list = Array.isArray(assets) ? assets : [];
    const rs = (a) => (a && a.ratings) || [];
    if (filter === "loved_by_me") return list.filter((a) => rs(a).some((r) => r.mine && r.value === "love"));
    if (filter === "needs_look") return list.filter((a) => !rs(a).some((r) => r.mine));
    if (filter === "loved_by_all") {
      const raters = new Set(list.flatMap((a) => rs(a).map((r) => r.name)));
      if (!raters.size) return [];
      return list.filter((a) => [...raters].every((n) => rs(a).some((r) => r.name === n && r.value === "love")));
    }
    return list;
  }
  // The words under a card's rating buttons: "Natalie loves this · Anna: maybe".
  function ratingTitle(r) { return r.value === "love" ? `${r.name} loves this` : `${r.name}: ${r.value}`; }

  function ago(iso, now) {
    if (!iso) return "not yet";
    const s = Math.max(0, Math.round(((now || Date.now()) - new Date(iso).getTime()) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  const RR = { PALETTE, colorFor, initials, mark, hereTitle, herePlan, luminance, contrast, textOn, themeTokens, themeName, applyTheme, ago, SWAI, SHARING_WORDS, editIcon, hasChanges, menuPlan, mdBlocks,
    RATINGS, RATING_WORDS, ratingsReady, myRating, nextRating, REF_FILTERS, refFilter, ratingTitle };
  root.RR = RR;
  if (typeof module !== "undefined" && module.exports) module.exports = RR;
})(typeof window !== "undefined" ? window : globalThis);
