const API = "/api/v1";
let currentFormat = "video";
let cardData = [];
let batchKind = "links";
let batchTotal = 0;
let fetching = false;
let batchRunning = false;
let maxUrls = 25;
let audioBitrates = [128, 192, 320];
const DEFAULT_BITRATE = 192;

const $ = (id) => document.getElementById(id);

async function loadConfig() {
  try {
    const r = await fetch(`${API}/config`);
    const cfg = await r.json();
    maxUrls = cfg.max_urls_per_batch || maxUrls;
    if (Array.isArray(cfg.audio_bitrates) && cfg.audio_bitrates.length) audioBitrates = cfg.audio_bitrates;
  } catch {
    /* defaults are fine offline */
  }
}

function setFormat(btn) {
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
  else if (action === "dl-card") dlCard(idx);
  else if (action === "cancel-card") cancelCard(idx);
  else if (action === "save-card") saveCard(idx);
  else if (action === "dl-all") dlAll();
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

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
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
function setNote(key, params) {
  noteState = key ? { key, params } : null;
  const n = $("detect");
  n.textContent = key ? t(key, params) : "";
  n.hidden = !key;
}

function showFormError(msg) {
  const box = $("form-error");
  box.textContent = msg;
  box.hidden = false;
}

$("urls").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    go();
  }
});

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
  btn.innerHTML = `<span class="reel-spin"></span> ${esc(t("btn.getting"))}`;
  container.innerHTML = "";
  cardData = [];
  batchKind = "links";
  fetching = true;
  updateBatch();

  // expand any playlist URLs into individual entries first.
  for (let i = 0; i < urls.length; i++) {
    if (/[?&]list=/.test(urls[i])) {
      try {
        const res = await fetch(`${API}/playlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urls[i] }),
        });
        const data = await res.json();
        if (res.ok && data.urls?.length) {
          urls.splice(i, 1, ...data.urls);
          if (data.urls.length > 1) batchKind = "playlist";
        }
      } catch {
        /* keep the original playlist URL if expansion fails */
      }
    }
  }

  if (urls.length > maxUrls) {
    setNote("note.trimmed", { n: urls.length, m: maxUrls });
    urls = urls.slice(0, maxUrls);
  }

  batchTotal = urls.length;
  for (const url of urls) {
    const idx = cardData.length;
    cardData.push({ url, status: "loading" });
    await loadInfo(idx);
  }

  fetching = false;
  updateBatch();
  btn.disabled = false;
  btn.textContent = t("btn.get");
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
    cardData = data.photos.map((p) => ({
      url: p.url,
      kind: "image",
      status: "ready",
      title: p.title,
      thumbnail: p.thumbnail,
      uploader: c.uploader,
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
        <div class="skeleton-line title"></div>
        <div class="skeleton-line meta"></div>
        <div class="skeleton-chips"><i></i><i></i><i></i><i></i></div>
        <div class="skeleton-btn"></div>
        <span class="sr-only">${esc(t("card.reading"))}</span>
      </div>`;
    return;
  }

  if (c.status === "info-error") {
    el.className = "card card-error";
    el.innerHTML = `
      <div class="card-thumb">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </div>
      <div class="card-body">
        <div class="card-title card-title-error">${esc(t("card.couldntLoad"))}</div>
        <div class="card-error-msg">${esc(friendlyError(c.error || ""))}</div>
        <div class="card-error-url">${esc(c.url)}</div>
        <div class="card-actions"><button class="card-dl-btn retry" data-action="retry-info" data-idx="${idx}">${esc(t("btn.tryAgain"))}</button></div>
      </div>`;
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
    const photosBtn = !isAudio && (c.photos > 0 || PHOTO_POST.test(c.url)) && c.kind !== "image" ? `<button class="icon-btn" data-action="split-photos" data-idx="${idx}">${esc(t("btn.savePhotos"))}</button>` : "";
    actionHtml = `<button class="card-dl-btn" data-action="dl-card" data-idx="${idx}">${esc(t("btn.download"))}</button>${photosBtn}${qualityChips ? `<div class="chips">${qualityChips}</div>` : ""}`;
  } else if (c.status === "downloading" || c.status === "processing") {
    const pct = Math.round(c.progress || 0);
    const label = c.status === "processing" ? t("progress.finishing") : c.speed ? `${c.speed}${c.eta != null ? t("progress.left", { t: fmtDur(c.eta) }) : ""}` : t("progress.starting");
    actionHtml = `
      <div class="card-progress grow">
        <span class="reel-spin"></span>
        <div class="bar"><i data-pct="${pct}"></i></div>
        <span>${pct}%</span>
      </div>
      <span class="card-status small">${esc(label)}</span>
      <button class="icon-btn" data-action="cancel-card" data-idx="${idx}">${esc(t("btn.cancel"))}</button>`;
  } else if (c.status === "done") {
    actionHtml = `<button class="card-dl-btn done" data-action="save-card" data-idx="${idx}">${esc(t("btn.saveFile"))}</button>
      <span class="card-status done">${c.filename ? esc(t("card.ready", { name: c.filename })) : esc(t("card.readyGeneric"))}</span>`;
  } else if (c.status === "error") {
    actionHtml = `<button class="card-dl-btn retry" data-action="dl-card" data-idx="${idx}">${esc(t("btn.retry"))}</button>
      <span class="card-status error">${esc(friendlyError(c.error || "Download failed"))}</span>`;
  } else if (c.status === "cancelled") {
    actionHtml = `<button class="card-dl-btn" data-action="dl-card" data-idx="${idx}">${esc(t("btn.download"))}</button>
      <span class="card-status cancelled">${esc(t("card.cancelled"))}</span>`;
  }

  el.innerHTML = `
    <div class="card-thumb">${thumbHtml}</div>
    <div class="card-body">
      <div class="card-title">${esc(c.title || t("card.untitled"))}</div>
      <div class="card-meta">${esc([c.uploader, c.duration ? fmtDur(c.duration) : ""].filter(Boolean).join(" · "))}</div>
      <div class="card-actions">${actionHtml}</div>
      ${c.warning && !isAudio ? `<div class="card-warning" title="${esc(c.warning)}">${esc(t("card.warning"))}</div>` : ""}
    </div>`;
  // the CSP forbids inline style attributes; setting styles via the CSSOM is allowed.
  el.querySelectorAll("[data-pct]").forEach((n) => { n.style.width = `${n.dataset.pct}%`; });
  updateBatch();
}

function updateBatch() {
  const box = $("batch");
  if (cardData.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  const count = (...st) => cardData.filter((c) => st.includes(c.status)).length;
  const ready = count("ready", "cancelled", "error");
  const busy = count("downloading", "processing");
  const done = count("done");
  const failed = count("info-error");
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
  btn.disabled = fetching || batchRunning || busy > 0 || ready === 0;
  btn.textContent = busy || batchRunning ? t("btn.downloading") : ready ? t("btn.dlAllN", { n: ready }) : done ? t("btn.allDone") : t("btn.dlAll");
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
    renderCard(idx);
    if (["done", "error", "cancelled"].includes(data.status)) {
      es.close();
      if (data.status === "done") saveCard(idx);
    }
  };

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
      Object.assign(c, data);
      renderCard(idx);
      if (["done", "error", "cancelled"].includes(data.status)) {
        clearInterval(iv);
        if (data.status === "done") saveCard(idx);
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

async function dlAll() {
  batchRunning = true;
  updateBatch();
  for (let i = 0; i < cardData.length; i++) {
    if (cardData[i].status === "ready") {
      await dlCard(i);
      await new Promise((r) => setTimeout(r, 250)); // stagger job creation slightly
    }
  }
  batchRunning = false;
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
  if (!fetching) $("goBtn").textContent = t("btn.get");
  cardData.forEach((_, i) => renderCard(i));
  updateBatch();
}

I18N.init();
loadConfig();

// friendlier input: clear the hint once typing resumes; focus the box on desktop (not phones, to avoid the keyboard).
$("urls").addEventListener("input", () => {
  $("form-error").hidden = true;
  setNote(/[?&]list=/.test($("urls").value) ? "note.playlist" : "");
});
if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) $("urls").focus();

// say so when the connection drops, and clear the message when it comes back.
window.addEventListener("offline", () => showFormError(t("err.offlineKeep")));
window.addEventListener("online", () => { $("form-error").hidden = true; });