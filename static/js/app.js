const API = "/api/v1";
let currentFormat = "video";
let cardData = [];
let batchKind = "links";
let batchTotal = 0;
let fetching = false;
let batchRunning = false;
let maxUrls = 25;
let audioBitrates = [128, 192, 320];
let platforms = []; // from /config: { key, name, color, icon, hosts }
const DEFAULT_BITRATE = 192;
let fileTtl = 1800; // seconds a finished file stays on the server (from /config)
let batchCancelled = false; // set by "Cancel all" so a running Download all stops starting new jobs
let retrying = false;
const ACTIVE = ["queued", "downloading", "processing"];
const isActive = (c) => ACTIVE.includes(c.status);
const BASE_TITLE = document.title;
const SESSION_KEY = "rewatch.session.v1";
const INFO_CONCURRENCY = 3; // link lookups in flight at once (the server rate-limits per minute)

const $ = (id) => document.getElementById(id);

// button icons
// small line icons shown in front of each button label (same 24px grid and 2px stroke as the rest).
const ICONS = {
  get: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/>',
  save: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  photos: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  cancel: '<path d="M18 6 6 18M6 6l12 12"/>',
  retry: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

function ico(name) {
  return `<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

// icon + label for a button's inner HTML; busy swaps the icon for the spinner.
function lbl(name, text, busy = false) {
  return `${busy ? '<span class="reel-spin"></span>' : ico(name)}<span>${esc(text)}</span>`;
}


async function loadConfig() {
  try {
    const r = await fetch(`${API}/config`);
    const cfg = await r.json();
    maxUrls = cfg.max_urls_per_batch || maxUrls;
    if (Array.isArray(cfg.audio_bitrates) && cfg.audio_bitrates.length) audioBitrates = cfg.audio_bitrates;
    if (Array.isArray(cfg.platforms)) platforms = cfg.platforms;
    if (cfg.file_ttl_seconds > 0) fileTtl = cfg.file_ttl_seconds;
    renderSites(); // links may have been pasted before the config arrived
    if (!cardData.length) refreshHint(); // the hint quotes the limit, which only the config knows
  } catch {
    /* defaults are fine offline */
  }
}

function setFormat(btn) {
  if (batchRunning) return; // a batch is being started: switching now would mix formats
  document.querySelectorAll(".pill").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentFormat = btn.dataset.format;
  cardData.forEach((_, i) => renderCard(i));
}

// CSP (script-src 'self') blocks inline onclick="" attributes, so every
// action in generated card HTML is wired through data-action attributes and
// this one delegated listener instead of inline handlers.
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const idx = el.dataset.idx !== undefined ? Number(el.dataset.idx) : undefined;
  if (action === "go") go();
  else if (action === "set-format") setFormat(el);
  else if (action === "pick-height") pickHeight(idx, Number(el.dataset.height));
  else if (action === "pick-bitrate") pickBitrate(idx, Number(el.dataset.bitrate));
  else if (action === "dl-card") { askNotify(); dlCard(idx); }
  else if (action === "cancel-card") cancelCard(idx);
  else if (action === "save-card") saveCard(idx);
  else if (action === "share-card") { askNotify(); shareCard(idx); }
  else if (action === "dl-all") { askNotify(); dlAll(); }
  else if (action === "cancel-all") cancelAll();
  else if (action === "retry-failed") retryFailed();
  else if (action === "retry-info") loadInfo(idx);
  else if (action === "split-photos") splitPhotos(idx);
  else if (action === "set-lang") changeLang(el.dataset.lang);
});

function parseUrls(text) {
  const urls = [...new Set(text.split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];
  return urls;
}

// human-friendly durations: "18 sec", "3 min 25 sec", "1 hr 2 min" (or the Khmer equivalents).
function fmtDur(s) {
  if (!s && s !== 0) return "";
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const parts = [];
  if (h) parts.push(t("dur.hr", { n: h }));
  if (m) parts.push(t("dur.min", { n: m }));
  if (!h && (sec || !parts.length)) parts.push(t("dur.sec", { n: sec }));
  return parts.join(" ");
}

// escapes text for HTML bodies AND double/single-quoted attribute values.
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// site detection (logo + name)
// the server's answer (card.platform, from /info) wins; this guess from the link's host
// is what shows while a card is still loading, on error cards, and in the row under the box.
function detectPlatform(url) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  for (const p of platforms) {
    if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return p;
  }
  return { key: "other", name: host.replace(/^(www|m|mobile)\./, ""), color: "", icon: "" };
}

function platformBadge(p) {
  if (!p) return "";
  const glyph = p.icon
    ? `<img src="${esc(p.icon)}" alt="" width="14" height="14">`
    : `<span class="plat-letter" aria-hidden="true">${esc(([...(p.name || "?")][0] || "?").toUpperCase())}</span>`;
  const bg = /^#[0-9a-f]{3,8}$/i.test(p.color || "") ? p.color : "";
  return `<span class="plat" title="${esc(t("platform.aria", { name: p.name }))}"><span class="plat-icon" data-bg="${esc(bg)}">${glyph}</span><span class="plat-name">${esc(p.name)}</span></span>`;
}

// the CSP forbids inline style attributes; setting styles via the CSSOM is allowed.
function applyDynamicStyles(root) {
  root.querySelectorAll("[data-pct]").forEach((n) => { n.style.width = `${n.dataset.pct}%`; });
  root.querySelectorAll("[data-bg]").forEach((n) => { if (n.dataset.bg) n.style.background = n.dataset.bg; });
}

// one chip per distinct site among the pasted links, with a count when a site repeats.
// sitesSource: the final list after playlists are expanded (set by go()); null = count the raw textarea.
let sitesSource = null;
function renderSites() {
  const box = $("sites");
  const found = new Map();
  for (const u of sitesSource ?? parseUrls($("urls").value)) {
    const p = detectPlatform(u);
    if (!p) continue;
    const key = `${p.key}:${p.name}`;
    found.set(key, { p, n: (found.get(key)?.n || 0) + 1 });
  }
  box.hidden = found.size === 0;
  box.classList.toggle("compact", found.size > 3); // logos only once there are more than 3 sites
  box.innerHTML = [...found.values()]
    .map(({ p, n }) => `<span class="plat-chip">${platformBadge(p)}<span class="plat-count" title="${esc(t("platform.count", { name: p.name, n }))}">${n}</span></span>`)
    .join("");
  applyDynamicStyles(box);
}

// turns server / yt-dlp error text into plain-language advice: what happened and what to do next.
function friendlyError(err) {
  const e = String(err || "");
  const rules = [

    // connection and server load
    [/failed to fetch|networkerror|load failed|network/i, "e.network"],
    [/too many requests|slow down|HTTP Error 429/i, "e.rate"],
    [/queue is full/i, "e.queue"],
    [/timed out|took too long/i, "e.timeout"],
    [/lost connection/i, "e.lost"],
    [/unexpected server error/i, "e.server"],
    [/job not found|expired|file not ready/i, "e.expired"],

    // TikTok photo slideshows
    [/no photos found|couldn't read the photos/i, "e.noPhotos"],
    [/need gallery-dl|run gallery-dl/i, "e.needGalleryDl"],
    [/needs ffmpeg/i, "e.needFfmpeg"],
    [/could not download the slideshow files|non-tiktok/i, "e.slideDl"],
    [/could not build the slideshow/i, "e.slideBuild"],
    [/isn't in this post/i, "e.photoGone"],
    [/no music to save/i, "e.noMusic"],
    [/photo or audio file is too large/i, "e.photoBig"],

    // the link itself
    [/only http/i, "e.onlyHttp"],
    [/invalid url/i, "e.invalidUrl"],
    [/embedded credentials/i, "e.credentials"],
    [/private addresses/i, "e.private"],
    [/could not resolve host/i, "e.resolve"],
    [/allow-list/i, "e.allow"],
    [/unsupported url/i, "e.unsupported"],
    [/no media found|no video formats/i, "e.noMedia"],
    [/pfbid|permalink\.php|\/share\/p\//i, "e.fbPost"],
    [/only available for registered users|log ?in required|login required|sign in to view|cookies/i, "e.login"],
    [/HTTP Error 404|\b404\b|not found/i, "e.notFound"],

    // the video
    [/video unavailable|this video is not available|has been removed|no longer available/i, "e.unavailable"],
    [/private video/i, "e.privateVideo"],
    [/members[- ]only|join this channel/i, "e.members"],
    [/confirm your age|age[- ]restricted/i, "e.age"],
    [/not a bot|sign in to confirm/i, "e.bot"],
    [/copyright/i, "e.copyright"],
    [/geo[- ]?restrict|geographic|in your country|not available in your/i, "e.geo"],
    [/live streams? (are|is) not supported|is live/i, "e.live"],
    [/requested format is not available/i, "e.format"],
    [/HTTP Error 403|\b403\b|forbidden/i, "e.forbidden"],

    // limits
    [/longer than (\d+)h/i, (m) => ({ key: "e.tooLong", params: { h: m[1] } })],
    [/larger than|exceed the size|size limit/i, "e.tooBig"],
    [/^cancelled$/i, "e.cancelled"],
  ];
  for (const [re, msg] of rules) {
    const m = e.match(re);
    if (m) {
      const r = typeof msg === "function" ? msg(m) : msg;
      return typeof r === "string" ? t(r) : t(r.key, r.params);
    }
  }
  return t("e.generic");
}

function detailText(data, fallback) {
  return typeof data?.detail === "string" ? data.detail : fallback;
}

// the note under the field: a playlist hint, or a heads-up when we trimmed the list.
let noteState = null; // { key, params } so the note can be re-translated when the language changes
function setNote(key, params, busy = false) {
  noteState = key ? { key, params, busy } : null;
  const n = $("detect");
  n.textContent = key ? t(key, params) : "";
  n.classList.toggle("busy", !!key && busy); // busy = small spinner in front of the text
  n.hidden = !key;
}

// playlist heads-up: tell people what Get will do BEFORE they press it
const isPlaylistUrl = (u) => /[?&]list=/.test(u);

function playlistHintFor(text) {
  const pl = parseUrls(text).filter(isPlaylistUrl);
  if (!pl.length) return null;
  if (pl.length > 1) return ["note.playlistMany", { p: pl.length, m: maxUrls }];
  // watch?v=...&list=... is ONE video inside a playlist, but Get opens the whole playlist: say so.
  return [/[?&]v=/.test(pl[0]) ? "note.playlistVideo" : "note.playlist", { m: maxUrls }];
}

function refreshHint() {
  const h = playlistHintFor($("urls").value);
  setNote(h ? h[0] : "", h ? h[1] : undefined);
}

function showFormError(msg) {
  const box = $("form-error");
  box.textContent = msg;
  box.hidden = false;
}

// Enter = Get only with a mouse and keyboard. On a phone there is no Shift key, so Enter must stay a
// line break (that is how several links are separated); Ctrl/Cmd+Enter submits everywhere.
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
$("urls").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return; // isComposing: Enter confirms an IME (e.g. Khmer) word
  if ((finePointer.matches && !e.shiftKey) || e.ctrlKey || e.metaKey) {
    e.preventDefault();
    go();
  }
});

// phones: the on-screen keyboard shows "return", and the field + Get button are kept above it.
if (!finePointer.matches) {
  $("urls").setAttribute("enterkeyhint", "enter");
  const keepVisible = () => {
    if (document.activeElement === $("urls")) $("goBtn").scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  $("urls").addEventListener("focus", () => setTimeout(keepVisible, 300));
  window.visualViewport?.addEventListener("resize", keepVisible); // the keyboard opening/closing resizes it
}

async function go() {
  const raw = $("urls").value;
  let urls = parseUrls(raw);
  $("form-error").hidden = true;
  if (!urls.length) {
    showFormError(
      raw.trim()
        ? t("err.notLink")
        : t("err.pasteFirst"),
    );
    $("urls").focus();
    return;
  }
  if (!navigator.onLine) {
    showFormError(t("err.offline"));
    return;
  }

  // hongguo series pages list many episodes but aren't videos themselves. Ask for a single episode link.
  const isHongguoSeries = (u) => /^https?:\/\/([^/]+\.)?hongguoduanju\.com\/detail/i.test(u);
  if (urls.some(isHongguoSeries)) {
    urls = urls.filter((u) => !isHongguoSeries(u));
    if (!urls.length) {
      showFormError(t("err.series"));
      $("urls").focus();
      return;
    }
    setNote("note.seriesSkipped");
  }

  const btn = $("goBtn");
  const container = $("cards");
  btn.disabled = true;
  btn.innerHTML = lbl("get", t("btn.getting"), true);
  container.innerHTML = "";
  cardData = [];
  runCards.clear();
  batchKind = "links";
  fetching = true;

  // show a skeleton card for every pasted link straight away, so nothing looks missing while it loads.
  const showSkeletons = (list) => {
    container.innerHTML = "";
    cardData = list.map((url) => ({ url, status: "loading" }));
    batchTotal = list.length;
    cardData.forEach((_, i) => renderCard(i));
    updateBatch();
  };
  showSkeletons(urls);

  // expand any playlist URLs into individual entries (the skeletons stay up meanwhile).
  let expanded = false;
  const origCount = urls.length;
  const listTotal = urls.filter(isPlaylistUrl).length;
  let seen = 0, opened = 0, added = 0, cutAt = 0, failedLists = 0;
  for (let i = 0; i < urls.length; i++) {
    if (isPlaylistUrl(urls[i])) {
      setNote("note.expanding", { a: ++seen, b: listTotal }, true);
      try {
        const res = await fetch(`${API}/playlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urls[i] }),
        });
        const data = await res.json();
        if (res.ok && data.urls?.length) {
          urls.splice(i, 1, ...data.urls);
          i += data.urls.length - 1; // don't re-scan the entries we just inserted
          expanded = true;
          opened++;
          added += data.urls.length;
          if (data.truncated) cutAt = data.urls.length;
        } else {
          failedLists++;
        }
      } catch {
        failedLists++; /* keep the original playlist URL if expansion fails */
      }
    }
  }
  // "N videos in this playlist" is only true when the playlist was the only thing pasted.
  batchKind = origCount === 1 && opened === 1 && urls.length > 1 ? "playlist" : "links";

  // tell the user what just happened (the trim note below wins if we also had to cut the list).
  if (failedLists) setNote("note.playlistFailed");
  else if (cutAt) setNote("note.playlistCut", { n: cutAt });
  else if (opened) setNote(opened > 1 ? "note.expandedMany" : "note.expanded", { n: added, p: opened });
  else setNote("");

  if (urls.length > maxUrls) {
    setNote("note.trimmed", { n: urls.length, m: maxUrls });
    urls = urls.slice(0, maxUrls);
    expanded = true;
  }
  if (expanded) showSkeletons(urls);
  sitesSource = urls.slice(); // badges now count every entry, not the one playlist URL
  renderSites();

  // read the details a few at a time: every card is already on screen as a skeleton and fills in as its info arrives.
  let next = 0;
  const worker = async () => {
    while (next < urls.length) await loadInfo(next++);
  };
  await Promise.all(Array.from({ length: Math.min(INFO_CONCURRENCY, urls.length) }, worker));

  fetching = false;
  updateBatch();
  btn.disabled = false;
  btn.innerHTML = lbl("get", t("btn.get"));
}

// TikTok photo posts (/@user/photo/<id>) can be saved as one video or as separate images.
const PHOTO_POST = /^https?:\/\/(www\.|m\.)?tiktok\.com\/@[^/?#]+\/photo\/\d+/i;

// "Save as photos": swaps the slideshow card for one card per photo, like a playlist.
async function splitPhotos(idx) {
  const c = cardData[idx];
  $("form-error").hidden = true;
  try {
    const res = await fetch(`${API}/playlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: c.url }),
    });
    const data = await res.json();
    if (!res.ok || !data.photos?.length) {
      showFormError(friendlyError(detailText(data, "Could not list the photos")));
      return;
    }
    $("cards").innerHTML = "";
    runCards.clear();
    cardData = data.photos.map((p) => ({
      url: p.url,
      kind: "image",
      status: "ready",
      title: p.title,
      thumbnail: p.thumbnail,
      uploader: c.uploader,
      platform: c.platform,
      formats: [],
      selectedHeight: null,
      selectedBitrate: DEFAULT_BITRATE,
    }));
    batchKind = "photos";
    batchTotal = cardData.length;
    cardData.forEach((_, i) => renderCard(i));
    updateBatch();
  } catch (err) {
    showFormError(friendlyError(err.message));
  }
}

// reads one link's details. Also used by the "Try again" button on a failed card.
async function loadInfo(idx) {
  const url = cardData[idx].url;
  cardData[idx] = { url, status: "loading" };
  renderCard(idx);
  try {
    const res = await fetch(`${API}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      cardData[idx] = { url, status: "info-error", error: detailText(data, "Could not get info") };
    } else {
      cardData[idx] = {
        url,
        status: "ready",
        title: data.title || "",
        thumbnail: data.thumbnail || "",
        duration: data.duration,
        uploader: data.uploader || "",
        formats: data.formats || [],
        warning: data.warning || "",
        photos: data.photos || 0,
        platform: data.platform || detectPlatform(url),
        selectedHeight: data.formats?.[0]?.height ?? null, // default to the highest resolution
        selectedBitrate: DEFAULT_BITRATE,
      };
    }
  } catch (err) {
    cardData[idx] = { url, status: "info-error", error: err.message };
  }
  renderCard(idx);
}

// friendly quality names: 4K / 2K / Full HD / HD / SD instead of raw pixel heights.
function qualityName(height) {
  if (height >= 4320) return "8K";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "2K";
  if (height >= 1080) return "Full HD";
  if (height >= 720) return "HD";
  if (height >= 480) return "SD";
  return t("q.low");
}

// if two resolutions land in the same bucket (e.g. 540p and 480p), keep the pixel height so chips stay distinct.
function videoChipLabels(formats) {
  const names = formats.map((f) => qualityName(f.height));
  return formats.map((f, i) => (names.filter((n) => n === names[i]).length > 1 ? `${names[i]} · ${f.height}p` : names[i]));
}

function bitrateName(kbps, all) {
  const sorted = [...all].sort((a, b) => a - b);
  const names = sorted.length === 3 ? ["q.standard", "q.high", "q.best"] : sorted.length === 2 ? ["q.standard", "q.best"] : null;
  return names ? t(names[sorted.indexOf(kbps)]) : t("q.kbps", { n: kbps });
}

function renderCard(idx) {
  const c = cardData[idx];
  let el = document.getElementById(`card-${idx}`);
  if (!el) {
    el = document.createElement("div");
    el.id = `card-${idx}`;
    el.className = "card";
    $("cards").appendChild(el);
  }

  if (c.status === "loading") {
    el.className = "card";
    el.innerHTML = `
      <div class="card-thumb loading"></div>
      <div class="card-body" aria-busy="true">
        <span class="skeleton-plat" aria-hidden="true"><i class="skeleton-plat-icon"></i><i class="skeleton-plat-name"></i></span>
        <div class="skeleton-line title"></div>
        <div class="skeleton-line meta"></div>
        <div class="skeleton-chips"><i></i><i></i><i></i><i></i></div>
        <div class="skeleton-btn"></div>
        <span class="sr-only">${esc(t("card.reading"))}</span>
      </div>`;
    applyDynamicStyles(el);
    return;
  }

  if (c.status === "info-error") {
    el.className = "card card-error";
    el.innerHTML = `
      <div class="card-thumb">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </div>
      <div class="card-body">
        ${platformBadge(detectPlatform(c.url))}
        <div class="card-title card-title-error">${esc(t("card.couldntLoad"))}</div>
        <div class="card-error-msg">${esc(friendlyError(c.error || ""))}</div>
        <div class="card-error-url">${esc(c.url)}</div>
        <div class="card-actions"><button class="card-dl-btn retry" data-action="retry-info" data-idx="${idx}">${lbl("retry", t("btn.tryAgain"))}</button></div>
      </div>`;
    applyDynamicStyles(el);
    return;
  }

  el.className = "card";
  const isAudio = currentFormat === "audio" && c.kind !== "image";

  let thumbHtml;
  if (isAudio && !c.thumbnail) {
    thumbHtml = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" class="thumb-audio"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  } else if (c.thumbnail) {

    // audio keeps the cover art and adds a small music-note badge so it's clear you're saving sound only.
    const audioBadge = isAudio ? `<span class="thumb-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>` : "";
    thumbHtml = `${audioBadge}<img src="${esc(c.thumbnail)}" alt="" loading="lazy"${c.boxed ? ' class="boxed"' : ""}>`;
  } else {
    thumbHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
  }

  let qualityChips = "";

  // show chips even for a single format so the resolution you'll get is always visible.
  if (!isAudio && c.formats?.length > 0 && c.status === "ready") {
    const labels = videoChipLabels(c.formats);
    qualityChips = c.formats
      .map((f, i) => `<button class="q-chip${f.height === c.selectedHeight ? " active" : ""}" data-action="pick-height" data-idx="${idx}" data-height="${f.height}" title="${esc(f.label)}">${esc(labels[i])}</button>`)
      .join("");
  } else if (isAudio && c.status === "ready") {
    qualityChips = audioBitrates
      .map((kbps) => `<button class="q-chip${kbps === c.selectedBitrate ? " active" : ""}" data-action="pick-bitrate" data-idx="${idx}" data-bitrate="${kbps}" title="${kbps} kbps">${bitrateName(kbps, audioBitrates)}</button>`)
      .join("");
  }

  let actionHtml = "";
  if (c.status === "ready") {
    const photosBtn = !isAudio && (c.photos > 0 || PHOTO_POST.test(c.url)) && c.kind !== "image" ? `<button class="icon-btn" data-action="split-photos" data-idx="${idx}">${lbl("photos", t("btn.savePhotos"))}</button>` : "";
    actionHtml = `<button class="card-dl-btn" data-action="dl-card" data-idx="${idx}">${lbl("download", t("btn.download"))}</button>${photosBtn}${shareButton(c, idx)}${qualityChips ? `<div class="chips">${qualityChips}</div>` : ""}`;
  } else if (isActive(c)) {
    const pct = Math.round(c.progress || 0);
    const label = c.status === "processing" ? t("progress.finishing") : c.status === "queued" ? t("progress.queued") : c.speed ? `${c.speed}${c.eta != null ? t("progress.left", { t: fmtDur(c.eta) }) : ""}` : t("progress.starting");
    actionHtml = `
      <div class="card-progress grow">
        <span class="reel-spin"></span>
        <div class="bar"><i data-pct="${pct}"></i></div>
        <span>${pct}%</span>
      </div>
      <span class="card-status small">${esc(label)}</span>
      <button class="icon-btn" data-action="cancel-card" data-idx="${idx}">${lbl("cancel", t("btn.cancel"))}</button>`;
  } else if (c.status === "done") {
    actionHtml = `<button class="card-dl-btn done" data-action="save-card" data-idx="${idx}">${lbl("save", t("btn.saveFile"))}</button>
      ${shareButton(c, idx)}
      <span class="card-status done">${c.filename ? esc(t("card.ready", { name: c.filename })) : esc(t("card.readyGeneric"))}</span>${expiryNote(c)}`;
  } else if (c.status === "error") {
    actionHtml = `<button class="card-dl-btn retry" data-action="dl-card" data-idx="${idx}">${lbl("retry", t("btn.retry"))}</button>
      <span class="card-status error">${esc(friendlyError(c.error || "Download failed"))}</span>`;
  } else if (c.status === "expired") {
    actionHtml = `<button class="card-dl-btn" data-action="dl-card" data-idx="${idx}">${lbl("download", t("btn.download"))}</button>
      <span class="card-status cancelled">${esc(t("card.expired"))}</span>`;
  } else if (c.status === "cancelled") {
    actionHtml = `<button class="card-dl-btn" data-action="dl-card" data-idx="${idx}">${lbl("download", t("btn.download"))}</button>
      <span class="card-status cancelled">${esc(t("card.cancelled"))}</span>`;
  }

  el.innerHTML = `
    <div class="card-thumb">${thumbHtml}</div>
    <div class="card-body">
      ${platformBadge(c.platform || detectPlatform(c.url))}
      <div class="card-title">${esc(c.title || t("card.untitled"))}</div>
      <div class="card-meta">${esc([c.uploader, c.duration ? fmtDur(c.duration) : ""].filter(Boolean).join(" · "))}</div>
      <div class="card-actions">${actionHtml}</div>
      ${c.warning && !isAudio ? `<div class="card-warning" title="${esc(c.warning)}">${esc(t("card.warning"))}</div>` : ""}
    </div>`;
  applyDynamicStyles(el);
  updateBatch();
}

// share the file
// Share sends the downloaded FILE itself (not a link) through the phone's own share sheet.
// Browsers only allow that on secure pages (https or localhost), and only from a fresh tap, so
// the file is fetched into memory first and the share happens on the tap that follows.
const MAX_SHARE_BYTES = 300 * 1024 * 1024;

function canShareFiles() {
  try {
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File(["x"], "a.mp4", { type: "video/mp4" })] }));
  } catch {
    return false;
  }
}

function shareButton(c, idx) {
  const preparing = c.shareState === "preparing";
  const label = preparing ? t("btn.preparing") : c.shareState === "ready" ? t("btn.shareFile") : t("btn.share");
  return `<button class="icon-btn${c.shareState === "ready" ? " share-ready" : ""}" data-action="share-card" data-idx="${idx}"${preparing ? " disabled" : ""}>${lbl("share", label, preparing)}</button>`;
}

// a finished download: save it, or (if the person chose Share) get it ready to share.
function finishCard(idx) {
  const c = cardData[idx];
  if (c.intent === "share") {
    c.intent = null;
    prepareShare(idx);
  } else {
    saveCard(idx);
  }
}

async function prepareShare(idx) {
  const c = cardData[idx];
  c.shareState = "preparing";
  renderCard(idx);
  try {
    const res = await fetch(`${API}/jobs/${c.jobId}/file?token=${encodeURIComponent(c.token)}`);
    if (!res.ok) throw new Error("file");
    if (Number(res.headers.get("content-length")) > MAX_SHARE_BYTES) {
      c.shareState = null;
      renderCard(idx);
      showFormError(t("share.tooBig"));
      return;
    }
    const blob = await res.blob();
    c.shareFile = new File([blob], c.filename || "rewatch", { type: blob.type || "application/octet-stream" });
    if (!navigator.canShare({ files: [c.shareFile] })) {
      c.shareFile = null;
      c.shareState = null;
      renderCard(idx);
      showFormError(t("share.unsupported"));
      return;
    }
    c.shareState = "ready";
    renderCard(idx);
    await sendShare(idx, true); // may be refused (the tap was a while ago); the Share file button then waits for a tap
  } catch {
    c.shareState = null;
    c.shareFile = null;
    renderCard(idx);
    showFormError(t("share.failed"));
  }
}

async function sendShare(idx, quiet = false) {
  const c = cardData[idx];
  try {
    await navigator.share({ files: [c.shareFile], title: c.title || "" });
  } catch (err) {
    if (err?.name === "AbortError") return; // the person closed the share sheet
    if (err?.name === "NotAllowedError" && quiet) return; // needs a fresh tap
    showFormError(t("share.failed"));
  }
}

function shareCard(idx) {
  const c = cardData[idx];
  $("form-error").hidden = true;
  if (c.shareState === "preparing") return;
  if (c.shareState === "ready" && c.shareFile) return void sendShare(idx);
  if (!canShareFiles()) {
    showFormError(t("share.unsupported"));
    return;
  }
  if (c.status === "done" && c.jobId) return void prepareShare(idx);
  c.intent = "share"; // download first, then share instead of saving
  dlCard(idx);
}

// keeping a download safe and visible
// One place decides "is something running?" and keeps everything that depends on it in step:
// pull-to-refresh lock, screen wake lock, tab title, reload recovery and the finish buzz.
const runCards = new Set(); // cards started since the last time everything was idle
let wasBusy = false;
let wakeLock = null;
let wakeBusy = false;
let saveTimer = null;

function isBusy() {
  return batchRunning || cardData.some((c) => isActive(c) || c.shareState === "preparing");
}

function syncBusy() {
  const busy = isBusy();
  document.documentElement.classList.toggle("no-pull", busy); // pull-to-refresh would reload the page
  document.querySelectorAll(".pill").forEach((b) => { b.disabled = batchRunning; });
  setWake(busy);
  saveSession(batchRunning || cardData.some(isActive));
  updateTitle(busy);
  if (wasBusy && !busy) runFinished();
  wasBusy = busy;
}

// the screen stays on while downloading (a sleeping phone pauses the page). Needs https; ignored elsewhere.
async function setWake(on) {
  if (!navigator.wakeLock || wakeBusy) return;
  wakeBusy = true;
  try {
    if (on && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      const l = wakeLock;
      wakeLock = null;
      await l.release();
    }
  } catch {
    /* refused (e.g. battery saver): downloads carry on regardless */
  }
  wakeBusy = false;
  if (!isBusy() && wakeLock) setWake(false);
}

// "(42%) Rewatch" while downloading, so progress is visible from another tab.
function updateTitle(busy) {
  if (busy) {
    const list = [...runCards].filter((c) => c.status !== "error" && c.status !== "cancelled");
    if (list.length) {
      const pct = Math.round(list.reduce((sum, c) => sum + (c.status === "done" ? 100 : c.progress || 0), 0) / list.length);
      document.title = `(${pct}%) ${BASE_TITLE}`;
    } else {
      document.title = BASE_TITLE;
    }
  } else if (!document.title.startsWith("✓")) {
    document.title = BASE_TITLE;
  }
}

// everything finished: a short buzz on phones, and a tab mark + notification if the person is elsewhere.
function runFinished() {
  const done = [...runCards].filter((c) => c.status === "done").length;
  runCards.clear();
  if (!done) return;
  try { navigator.vibrate?.([80, 40, 80]); } catch { /* not supported */ }
  if (!document.hidden) return;
  document.title = `✓ ${BASE_TITLE}`;
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(BASE_TITLE, { body: done > 1 ? t("notify.batchDone", { n: done }) : t("notify.done"), icon: "/static/icons/icon-192.png" });
    }
  } catch { /* some browsers only allow notifications from a service worker */ }
}

// asked once, on the first download tap (browsers only allow the question after a tap), and only on https.
function askNotify() {
  try {
    if (!("Notification" in window) || !window.isSecureContext || Notification.permission !== "default") return;
    if (localStorage.getItem("rewatch.asked")) return;
    localStorage.setItem("rewatch.asked", "1");
    Notification.requestPermission();
  } catch { /* ignore */ }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (document.title.startsWith("✓")) document.title = BASE_TITLE;
  setWake(isBusy()); // the browser drops the wake lock whenever the tab is hidden
  updateTitle(isBusy());
});

// survive a reload: running jobs live on the server, so the page just re-attaches
const SAVE_FIELDS = ["url", "status", "title", "thumbnail", "duration", "uploader", "formats", "warning", "photos", "platform", "selectedHeight", "selectedBitrate", "kind", "boxed", "jobId", "token", "filename", "progress", "speed", "eta", "error", "doneAt"];

function saveSession(active) {
  if (!active) {
    clearTimeout(saveTimer);
    saveTimer = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    return;
  }
  if (!saveTimer) saveTimer = setTimeout(flushSession, 800); // progress ticks are frequent: write at most every 0.8 s
}

function flushSession() {
  saveTimer = null;
  if (!(batchRunning || cardData.some(isActive))) return;
  try {
    const cards = cardData.map((c) => Object.fromEntries(SAVE_FIELDS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]])));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ format: currentFormat, batchKind, batchTotal, cards }));
  } catch { /* storage full or blocked: recovery just won't be available */ }
}

function restoreSession() {
  let snap;
  try { snap = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return; }
  if (!snap || !Array.isArray(snap.cards) || !snap.cards.length) return;
  cardData = snap.cards;
  currentFormat = snap.format === "audio" ? "audio" : "video";
  batchKind = snap.batchKind || "links";
  batchTotal = snap.batchTotal || cardData.length;
  document.querySelectorAll(".pill").forEach((b) => b.classList.toggle("active", b.dataset.format === currentFormat));
  cardData.forEach((c) => {
    // a card caught between the tap and the server's answer has no job to re-attach to: let it be started again
    if (isActive(c) && !c.jobId) c.status = "ready";
  });
  $("cards").innerHTML = "";
  sitesSource = cardData.map((c) => c.url);
  cardData.forEach((_, i) => renderCard(i));
  updateBatch();
  renderSites();
  cardData.forEach((c, i) => {
    if (c.status === "loading") loadInfo(i);
    else if (isActive(c) && c.jobId) { runCards.add(c); watchCard(i); }
  });
}

// leaving is only risky for work that can't be picked up again: jobs still being created, or a file being fetched to share.
window.addEventListener("beforeunload", (e) => {
  if (batchRunning || cardData.some((c) => c.shareState === "preparing" || (c.status === "downloading" && !c.jobId))) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("pagehide", flushSession);

// how long a saved file stays on the server
function expiryLeft(c) {
  return c.doneAt ? Math.max(0, fileTtl * 1000 - (Date.now() - c.doneAt)) : null;
}

function expiryNote(c) {
  const left = expiryLeft(c);
  if (left === null) return "";
  const mins = Math.max(1, Math.ceil(left / 60000));
  c._expLabel = mins;
  return `<span class="card-expiry${mins <= 5 ? " soon" : ""}">${esc(t("card.expiresIn", { t: t("dur.min", { n: mins }) }))}</span>`;
}

setInterval(() => {
  cardData.forEach((c, i) => {
    if (c.status !== "done" || !c.doneAt || c.shareState === "preparing") return;
    if (expiryLeft(c) === 0) {
      c.status = "expired";
      c.shareFile = null;
      c.shareState = null;
      renderCard(i);
    } else if (Math.max(1, Math.ceil(expiryLeft(c) / 60000)) !== c._expLabel) {
      renderCard(i); // the minute count changed
    }
  });
}, 20000);

function updateBatch() {
  syncBusy();
  const box = $("batch");
  if (cardData.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  const count = (...st) => cardData.filter((c) => st.includes(c.status)).length;
  const ready = count("ready", "cancelled");
  const busy = cardData.filter(isActive).length;
  const done = count("done", "expired");
  const failed = count("info-error", "error");
  const total = Math.max(batchTotal, cardData.length);
  $("batch-title").textContent =
    batchKind === "playlist" ? t("batch.playlist", { n: total })
      : batchKind === "photos" ? t("batch.photos", { n: total })
        : t("batch.links", { n: total });
  const parts = [];
  if (fetching) parts.push(t("batch.loading", { a: cardData.length - count("loading"), b: total }));
  else parts.push(t("batch.ready", { n: ready + busy + done }));
  if (failed && !fetching) parts.push(t("batch.failed", { n: failed }));
  if (done) parts.push(t("batch.done", { n: done }));
  $("batch-sub").textContent = parts.join(" · ");
  const active = ready + busy + done;
  const track = $("batch-track");
  track.hidden = !(busy || done);
  if (active) $("batch-bar").style.width = `${Math.round((done / active) * 100)}%`;
  const btn = $("dlAllBtn");
  btn.disabled = fetching || batchRunning || retrying || busy > 0 || ready === 0;
  btn.innerHTML = busy || batchRunning ? lbl("download", t("btn.downloading"), true)
    : ready ? lbl("download", t("btn.dlAllN", { n: ready }))
      : done ? lbl("check", t("btn.allDone"))
        : lbl("download", t("btn.dlAll"));

  // Chrome and Brave ask once before letting a page save several files in a row: say so before it happens
  const hint = $("batch-hint");
  hint.textContent = t("batch.multiHint");
  hint.hidden = !(ready > 1 && !busy && !done && !fetching);

  const cancelBtn = $("cancelAllBtn");
  const retryBtn = $("retryFailedBtn");
  cancelBtn.hidden = !(busy > 0 || batchRunning);
  cancelBtn.innerHTML = lbl("cancel", t("btn.cancelAll"));
  retryBtn.hidden = !failed || fetching;
  retryBtn.disabled = batchRunning || retrying;
  retryBtn.innerHTML = lbl("retry", t("btn.retryFailed", { n: failed }));
  $("batch-actions").hidden = cancelBtn.hidden && retryBtn.hidden;
}

function pickHeight(idx, height) {
  cardData[idx].selectedHeight = height;
  renderCard(idx);
}

function pickBitrate(idx, kbps) {
  cardData[idx].selectedBitrate = kbps;
  renderCard(idx);
}

async function dlCard(idx) {
  const c = cardData[idx];
  c.status = "downloading";
  c.progress = 0;
  c.error = null;
  c.doneAt = null;
  runCards.add(c);
  c.shareState = null;
  c.shareFile = null;
  renderCard(idx);

  try {
    const res = await fetch(`${API}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: c.url,
        format: c.kind === "image" ? "video" : currentFormat, // a photo is always saved as the image
        height: c.kind !== "image" && currentFormat === "video" ? c.selectedHeight : null,
        audio_bitrate: c.kind !== "image" && currentFormat === "audio" ? c.selectedBitrate : null,
        title: c.title || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      c.status = "error";
      c.error = detailText(data, "Could not start download");
      renderCard(idx);
      return;
    }
    c.jobId = data.job_id;
    c.token = data.token;
    watchCard(idx);
    if (c.cancelRequested) { // "Cancel all" was pressed while this job was still being created
      c.cancelRequested = false;
      cancelCard(idx);
    }
  } catch (err) {
    c.status = "error";
    c.error = err.message;
    renderCard(idx);
  }
}

function watchCard(idx) {
  const c = cardData[idx];
  const es = new EventSource(`${API}/jobs/${c.jobId}/events?token=${encodeURIComponent(c.token)}`);
  c._es = es;

  es.onmessage = (evt) => {
    let data;
    try {
      data = JSON.parse(evt.data);
    } catch {
      return;
    }
    Object.assign(c, { status: data.status, progress: data.progress, speed: data.speed, eta: data.eta, error: data.error, filename: data.filename });
    if (data.status === "done") {
      c.doneAt = Date.now();
      if (c.intent === "share") c.shareState = "preparing"; // set before drawing so the page doesn't look idle for a moment
    }
    renderCard(idx);
    if (["done", "error", "cancelled"].includes(data.status)) {
      es.close();
      if (data.status === "done") finishCard(idx);
      else c.intent = null;
    }
  };

  es.addEventListener("gone", () => { // the server has already deleted this job
    es.close();
    Object.assign(c, { status: "error", error: "Job not found or expired" });
    c.intent = null;
    renderCard(idx);
  });

  es.onerror = () => {
    es.close();
    pollCard(idx); // SSE was interrupted (e.g. proxy) — fall back to polling
  };
}

function pollCard(idx) {
  const c = cardData[idx];
  const iv = setInterval(async () => {
    try {
      const res = await fetch(`${API}/jobs/${c.jobId}?token=${encodeURIComponent(c.token)}`);
      const data = await res.json();
      if (!res.ok) { // the job is gone (expired, or the server restarted)
        clearInterval(iv);
        Object.assign(c, { status: "error", error: detailText(data, "Job not found or expired") });
        c.intent = null;
        renderCard(idx);
        return;
      }
      Object.assign(c, data);
      if (data.status === "done") {
        c.doneAt = Date.now();
        if (c.intent === "share") c.shareState = "preparing";
      }
      renderCard(idx);
      if (["done", "error", "cancelled"].includes(data.status)) {
        clearInterval(iv);
        if (data.status === "done") finishCard(idx);
        else c.intent = null;
      }
    } catch {
      clearInterval(iv);
      c.status = "error";
      c.error = "Lost connection to the server";
      renderCard(idx);
    }
  }, 1200);
}

async function cancelCard(idx) {
  const c = cardData[idx];
  if (!c.jobId) return;
  try {
    await fetch(`${API}/jobs/${c.jobId}?token=${encodeURIComponent(c.token)}`, { method: "DELETE" });
  } catch {
    /* the SSE stream will still reflect the final state */
  }
}

function saveCard(idx) {
  const c = cardData[idx];
  if (!c.jobId) return;
  const a = document.createElement("a");
  a.href = `${API}/jobs/${c.jobId}/file?token=${encodeURIComponent(c.token)}`;
  a.download = c.filename || "";
  a.click();
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function dlAll() {
  batchRunning = true;
  batchCancelled = false;
  updateBatch();
  for (let i = 0; i < cardData.length && !batchCancelled; i++) {
    if (cardData[i].status === "ready" || cardData[i].status === "cancelled") {
      await dlCard(i);
      await pause(250); // stagger job creation slightly
    }
  }
  batchRunning = false;
  updateBatch();
}

// stops everything that is queued or running, and stops a Download all that is still creating jobs.
function cancelAll() {
  batchCancelled = true;
  cardData.forEach((c, i) => {
    if (!isActive(c)) return;
    if (c.jobId) cancelCard(i);
    else c.cancelRequested = true;
  });
}

// tries again every card that failed: lookups first, then downloads.
async function retryFailed() {
  if (retrying || batchRunning) return;
  retrying = true;
  batchCancelled = false;
  updateBatch();
  const infoIdx = [];
  const dlIdx = [];
  cardData.forEach((c, i) => {
    if (c.status === "info-error") infoIdx.push(i);
    else if (c.status === "error") dlIdx.push(i);
  });
  let next = 0;
  const worker = async () => {
    while (next < infoIdx.length) await loadInfo(infoIdx[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(INFO_CONCURRENCY, infoIdx.length) }, worker));
  if (dlIdx.length) {
    batchRunning = true;
    updateBatch();
    for (const i of dlIdx) {
      if (batchCancelled) break;
      if (cardData[i].status === "error") await dlCard(i);
      await pause(250);
    }
    batchRunning = false;
  }
  retrying = false;
  updateBatch();
}

// some sites return a 4:3 thumbnail with black bars baked in. Detect that shape and zoom past the bars.
document.addEventListener("load", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest(".card-thumb")) return;
  const ratio = img.naturalWidth / img.naturalHeight;
  if (ratio >= 1.5 || ratio < 1.1) return; // only 4:3-ish shots have baked-in bars; posters and squares stay as they are
  const idx = Number(img.closest(".card")?.id.replace("card-", ""));
  if (cardData[idx]?.kind === "image") return; // photos are shown as they are
  img.classList.add("boxed");
  if (cardData[idx]) cardData[idx].boxed = true;
}, true);

// switching language re-renders everything that was built from text: cards, batch bar, note, button label.
function changeLang(next) {
  if (!I18N.setLang(next)) return;
  $("form-error").hidden = true;
  if (noteState) setNote(noteState.key, noteState.params);
  if (!fetching) $("goBtn").innerHTML = lbl("get", t("btn.get"));
  cardData.forEach((_, i) => renderCard(i));
  updateBatch();
  renderSites();
}

I18N.init();
loadConfig();
restoreSession();

// friendlier input: clear the hint once typing resumes; focus the box on desktop (not phones, to avoid the keyboard).
$("urls").addEventListener("input", () => {
  $("form-error").hidden = true;
  refreshHint();
  sitesSource = null; // text changed: go back to counting what's typed
  renderSites();
});
if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) $("urls").focus();

// say so when the connection drops, and clear the message when it comes back.
window.addEventListener("offline", () => showFormError(t("err.offlineKeep")));
window.addEventListener("online", () => { $("form-error").hidden = true; });