// The Cut: an edit list (EDL) over a project's reference videos (card cfai-rt-cut-timeline-001, 2026-11-06).
// A Cut is a markdown draft: a short human header, then one fenced json block. Order in "clips" is order on the
// timeline; a clip's length is out - in, in seconds of its source file. The reference files are never touched:
// a Cut only names them by asset_id. Pure logic, no DOM, no network: the page (window.Cut) and node tests
// (module.exports) use the same code. Every change returns a new doc; nothing here mutates what it is given.
(function (root) {
  "use strict";
  const MIN = 0.2;          // the shortest clip, in seconds
  const ADD_LEN = 5;        // a clip added from the tray: in 0, out min(duration, 5)
  const FENCE = "```";
  const BLOCK = /(^|\n)```json[ \t]*\n([\s\S]*?)\n```[ \t]*(?=\n|$)/i;

  const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const round = (v) => Math.round(v * 1000) / 1000;
  const known = (d) => typeof d === "number" && isFinite(d) && d > 0;

  // The header a new Cut starts with. Plain words for a person or an agent reading the draft as text.
  function header(title) {
    return [
      `# ${String(title || "Cut").trim() || "Cut"}`,
      "",
      "A Cut: an edit list over this project's reference videos. The Review Table opens it in the Cut editor.",
      "Clips play in the order listed; each plays its file from `in` to `out` (seconds). The files themselves are never changed.",
      "Agents: edit the json below and keep everything else; `asset_id` is a reference file's id.",
      "",
      "",
    ].join("\n");   // the same words as rr.py's CUT_HEADER, so a castle-made cut and a page-made one read alike
  }

  // An empty Cut's whole text.
  function empty(title, aspect) {
    return serialise({ before: header(title), after: "\n", aspect: aspect || "16:9", clips: [], extra: { format: "cut" } });
  }

  // text -> { ok: true, doc } | { ok: false, error }. A doc is { before, after, aspect, clips, extra }: before and
  // after are the text around the json block (kept as written), extra any other keys an agent put in the json.
  function parse(text) {
    const src = String(text == null ? "" : text);
    const m = src.match(BLOCK);
    if (!m) return { ok: false, error: "There is no ```json edit list in this cut." };
    let data;
    try { data = JSON.parse(m[2]); } catch (err) { return { ok: false, error: `The edit list is not valid json (${err.message}).` }; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "The edit list should be a json object with a clips list." };
    if (data.clips != null && !Array.isArray(data.clips)) return { ok: false, error: "clips should be a list." };
    const start = m.index + m[1].length;
    const clips = [];
    const ids = new Set();
    for (const [i, c] of (data.clips || []).entries()) {
      if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: `Clip ${i + 1} is not an object.` };
      if (c.asset_id == null || c.asset_id === "") return { ok: false, error: `Clip ${i + 1} has no asset_id.` };
      const a = num(c.in), b = num(c.out);
      if (!isFinite(a) || !isFinite(b)) return { ok: false, error: `Clip ${i + 1} needs numbers for in and out.` };
      let id = typeof c.id === "string" && c.id.trim() ? c.id.trim() : "";
      if (!id || ids.has(id)) id = nextId({ clips }, ids);
      ids.add(id);
      const inS = Math.max(0, a);
      clips.push({ ...c, id, in: round(inS), out: round(Math.max(b, inS + MIN)) });
    }
    const { aspect, clips: _c, ...extra } = data;
    return {
      ok: true,
      doc: { before: src.slice(0, start), after: src.slice(start + m[0].length - m[1].length), aspect: typeof aspect === "string" && aspect ? aspect : "16:9", clips, extra },
    };
  }

  // doc -> text. The json is one clip per line so a diff or an agent reading it sees one change per line.
  function serialise(doc) {
    const { clips: _c, aspect: _a, format, ...rest } = doc.extra || {};
    const top = Object.entries({ ...(format != null ? { format } : {}), aspect: doc.aspect || "16:9", ...rest }).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    const clips = (doc.clips || []).map((c) => "    " + JSON.stringify(c));
    const json = ["{", ...top.map((l) => l + ","), clips.length ? `  "clips": [\n${clips.join(",\n")}\n  ]` : `  "clips": []`, "}"].join("\n");
    const before = doc.before == null ? header("Cut") : doc.before;
    const after = doc.after == null ? "\n" : doc.after;
    return `${before}${FENCE}json\n${json}\n${FENCE}${after}`;
  }

  function nextId(doc, taken) {
    const used = taken || new Set((doc.clips || []).map((c) => c.id));
    let n = (doc.clips || []).length + 1;
    while (used.has("c" + n)) n += 1;
    return "c" + n;
  }
  const indexOf = (doc, id) => doc.clips.findIndex((c) => c.id === id);
  const withClips = (doc, clips) => ({ ...doc, clips });
  const len = (c) => Math.max(0, num(c.out) - num(c.in));

  // move the clip at index from to index to (to is the index it ends up at)
  function reorder(doc, from, to) {
    const n = doc.clips.length;
    if (from < 0 || from >= n) return doc;
    const t = Math.max(0, Math.min(n - 1, to));
    if (t === from) return doc;
    const clips = doc.clips.slice();
    const [c] = clips.splice(from, 1);
    clips.splice(t, 0, c);
    return withClips(doc, clips);
  }

  // clamp in/out to the source: 0 <= in, out <= duration (when known), out - in >= MIN (or the whole file if shorter)
  function clamp(inS, outS, duration) {
    const d = known(duration) ? duration : Infinity;
    if (d <= MIN) return { in: 0, out: round(d) };
    let a = Math.max(0, Math.min(isFinite(inS) ? inS : 0, d - MIN));
    let b = Math.min(d, Math.max(isFinite(outS) ? outS : a + MIN, a + MIN));
    return { in: round(a), out: round(b) };
  }
  // trim one clip. patch {in} moves the left edge (out stays), {out} the right edge (in stays), both sets both.
  function trim(doc, id, patch, duration) {
    const i = indexOf(doc, id);
    if (i < 0) return doc;
    const c = doc.clips[i];
    const d = known(duration) ? duration : Infinity;
    let t;
    if (patch.in != null && patch.out == null) {
      const v = num(patch.in);
      t = { in: round(Math.max(0, Math.min(isFinite(v) ? v : c.in, c.out - MIN, d - MIN))), out: c.out };
      if (t.out > d) t = clamp(t.in, t.out, duration);
    } else if (patch.out != null && patch.in == null) {
      const v = num(patch.out);
      t = { in: c.in, out: round(Math.min(d, Math.max(isFinite(v) ? v : c.out, c.in + MIN))) };
      if (t.out - t.in < MIN) t = clamp(t.in, t.out, duration);
    } else t = clamp(num(patch.in), num(patch.out), duration);
    const clips = doc.clips.slice();
    clips[i] = { ...c, ...t };
    return withClips(doc, clips);
  }

  // a clip from a reference file: in 0, out min(duration, 5); at = where it goes (default: the end)
  function add(doc, asset, duration, at) {
    const id = nextId(doc);
    const assetId = asset && typeof asset === "object" ? asset.id : asset;
    const label = asset && typeof asset === "object" && asset.filename ? String(asset.filename).replace(/\.[a-z0-9]+$/i, "").slice(0, 80) : "";
    const clip = { id, asset_id: assetId, in: 0, out: round(known(duration) ? Math.min(duration, ADD_LEN) : ADD_LEN) };
    if (label) clip.label = label;
    const clips = doc.clips.slice();
    const k = at == null ? clips.length : Math.max(0, Math.min(clips.length, at));
    clips.splice(k, 0, clip);
    return { doc: withClips(doc, clips), id };
  }

  function duplicate(doc, id) {
    const i = indexOf(doc, id);
    if (i < 0) return { doc, id: null };
    const nid = nextId(doc);
    const clips = doc.clips.slice();
    clips.splice(i + 1, 0, { ...doc.clips[i], id: nid });
    return { doc: withClips(doc, clips), id: nid };
  }

  function remove(doc, id) {
    return withClips(doc, doc.clips.filter((c) => c.id !== id));
  }

  // set a clip's text fields (shot, label); an empty value takes the field off
  function setField(doc, id, key, value) {
    if (key !== "shot" && key !== "label") return doc;
    const i = indexOf(doc, id);
    if (i < 0) return doc;
    const c = { ...doc.clips[i] };
    const v = String(value == null ? "" : value).trim().slice(0, key === "shot" ? 20 : 80);
    if (v) c[key] = v; else delete c[key];
    const clips = doc.clips.slice();
    clips[i] = c;
    return withClips(doc, clips);
  }

  function total(doc) {
    return round(doc.clips.reduce((s, c) => s + len(c), 0));
  }
  // where clip i starts on the timeline
  function startOf(doc, i) {
    let s = 0;
    for (let k = 0; k < i && k < doc.clips.length; k++) s += len(doc.clips[k]);
    return round(s);
  }
  // timeline time -> { index, source }: which clip is on screen and the time in its file. Past the end: the last frame.
  function at(doc, t) {
    const n = doc.clips.length;
    if (!n) return null;
    let s = 0;
    const tt = Math.max(0, num(t) || 0);
    for (let i = 0; i < n; i++) {
      const l = len(doc.clips[i]);
      if (tt < s + l) return { index: i, source: round(doc.clips[i].in + (tt - s)) };
      s += l;
    }
    const last = doc.clips[n - 1];
    return { index: n - 1, source: last.out };
  }

  // the project's target lengths from a spec length like "90 s, with a 30 s cut" or "1:30" -> [90, 30] (longest first)
  function targets(length) {
    const s = String(length || "");
    const out = new Set();
    for (const m of s.matchAll(/(\d+):([0-5]\d)/g)) out.add(Number(m[1]) * 60 + Number(m[2]));
    const rest = s.replace(/(\d+):([0-5]\d)/g, " ");
    for (const m of rest.matchAll(/(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b/gi)) {
      const v = Number(m[1]) * (/^m/i.test(m[2]) ? 60 : 1);
      if (v > 0) out.add(v);
    }
    return [...out].sort((a, b) => b - a);
  }

  // 83.4 -> "1:23.4"
  function clock(t) {
    const v = Math.max(0, num(t) || 0);
    const m = Math.floor(v / 60);
    const s = v - m * 60;
    return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
  }

  // "16:9" -> "16 / 9" for CSS aspect-ratio, or "" when it isn't a ratio
  function aspectCss(aspect) {
    const m = String(aspect || "").match(/^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/);
    return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? `${m[1]} / ${m[2]}` : "";
  }

  // is this text a Cut? (its json block says "format": "cut"; the item's spec says so too when the castle made it)
  function isCutText(text) {
    const r = parse(text);
    return r.ok && r.doc.extra.format === "cut";
  }

  const Cut = { MIN, ADD_LEN, header, empty, parse, serialise, reorder, clamp, trim, add, duplicate, remove, setField, total, startOf, at, targets, clock, aspectCss, isCutText, length: len };
  root.Cut = Cut;
  if (typeof module !== "undefined" && module.exports) module.exports = Cut;
})(typeof window !== "undefined" ? window : globalThis);
