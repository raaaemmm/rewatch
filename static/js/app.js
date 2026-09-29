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
});

function parseUrls(text) {
  const urls = [...new Set(text.split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];
  return urls;
}

function fmtDur(s) {
  if (!s && s !== 0) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

// Turns server / yt-dlp error text into plain-language advice: what happened and what to do next.
function friendlyError(err) {
  const e = String(err || "");
  const rules = [
    // connection and server load
    [/failed to fetch|networkerror|load failed|network/i, "Can't reach the server. Check your connection and try again."],
    [/too many requests|slow down|HTTP Error 429/i, "That's a lot at once. Wait a few seconds and try again."],
    [/queue is full/i, "The server is busy right now. Try again in a minute."],
    [/timed out|took too long/i, "That took too long. Try again, or pick a lower quality."],
    [/lost connection/i, "Lost the connection to the server. Try again."],
    [/unexpected server error/i, "Something went wrong on our side. Please try again."],
    [/job not found|expired|file not ready/i, "This download has expired. Get the link again to restart it."],
    // the link itself
    [/only http/i, "That isn't a web link. Links start with https://"],
    [/invalid url/i, "That doesn't look like a valid link. Check it and try again."],
    [/embedded credentials/i, "Remove the username and password from the link and try again."],
    [/private addresses/i, "This address can't be used. Paste a public video or music link."],
    [/could not resolve host/i, "We couldn't find that website. Check the link for typos."],
    [/allow-list/i, "This website isn't supported on this server."],
    [/unsupported url/i, "This link isn't supported. Paste a direct video or music link."],
    [/no media found|no video formats/i, "No video or audio found at this link."],
    [/HTTP Error 404|\b404\b|not found/i, "Nothing was found at this link. It may have been removed."],
    // the video
    [/video unavailable|this video is not available|has been removed|no longer available/i, "This video isn't available. It may have been removed or made private."],
    [/private video/i, "This video is private, so it can't be downloaded."],
    [/members[- ]only|join this channel/i, "This video is for channel members only."],
    [/confirm your age|age[- ]restricted/i, "This video is age-restricted, so it can't be downloaded."],
    [/not a bot|sign in to confirm/i, "The site wants to verify this request. Try again in a few minutes."],
    [/copyright/i, "This video is blocked by a copyright claim."],
    [/geo[- ]?restrict|geographic|in your country|not available in your/i, "This video isn't available in your region."],
    [/live streams? (are|is) not supported|is live/i, "Live streams can't be downloaded. Try again after it ends."],
    [/requested format is not available/i, "That quality isn't available. Pick another one."],
    [/HTTP Error 403|\b403\b|forbidden/i, "The site refused the request. Try again in a moment."],
    // limits
    [/longer than (\d+)h/i, (m) => `This is longer than ${m[1]} hours, which is the most this server can save.`],
    [/larger than|exceed the size|size limit/i, "This file is too big for this server. Try a lower quality or a shorter video."],
    [/^cancelled$/i, "Download cancelled."],
  ];
  for (const [re, msg] of rules) {
    const m = e.match(re);
    if (m) return typeof msg === "function" ? msg(m) : msg;
  }
  return "We couldn't process this link. It may not be supported, or the site may be blocking downloads.";
}

function detailText(data, fallback) {
  return typeof data?.detail === "string" ? data.detail : fallback;
}

// The note under the field: a playlist hint, or a heads-up when we trimmed the list.
const PLAYLIST_NOTE = "Playlist detected. All its videos will be listed.";
function setNote(text) {
  const n = $("detect");
  n.textContent = text || "";
  n.hidden = !text;
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
        ? "That doesn't look like a link. Links start with https://"
        : "Paste a link first. YouTube, TikTok and most other video sites work.",
    );
    $("urls").focus();
    return;
  }
  if (!navigator.onLine) {
    showFormError("You're offline. Reconnect and try again.");
    return;
  }

  const btn = $("goBtn");
  const container = $("cards");
  btn.disabled = true;
  btn.innerHTML = `<span class="reel-spin"></span> Getting…`;
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
    setNote(`That's ${urls.length} links. Getting the first ${maxUrls}.`);
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
  btn.textContent = "Get";
}

// Reads one link's details. Also used by the "Try again" button on a failed card.
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
        selectedHeight: data.formats?.[0]?.height ?? null, // default to the highest resolution
        selectedBitrate: DEFAULT_BITRATE,
      };
    }
  } catch (err) {
    cardData[idx] = { url, status: "info-error", error: err.message };
  }
  renderCard(idx);
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
        <span class="sr-only">Reading link...</span>
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
        <div class="card-title card-title-error">Couldn't load this link</div>
        <div class="card-error-msg">${esc(friendlyError(c.error || ""))}</div>
        <div class="card-error-url">${esc(c.url)}</div>
        <div class="card-actions"><button class="card-dl-btn retry" data-action="retry-info" data-idx="${idx}">Try again</button></div>
      </div>`;
    return;
  }

  el.className = "card";
  const isAudio = currentFormat === "audio";

  let thumbHtml;
  if (isAudio) {
    thumbHtml = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" class="thumb-audio"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  } else if (c.thumbnail) {
    thumbHtml = `<img src="${esc(c.thumbnail)}" alt="" loading="lazy"${c.boxed ? ' class="boxed"' : ""}>`;
  } else {
    thumbHtml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
  }

  let qualityChips = "";

  // Show chips even for a single format so the resolution you'll get is always visible.
  if (!isAudio && c.formats?.length > 0 && c.status === "ready") {
    qualityChips = c.formats
      .map((f) => `<button class="q-chip${f.height === c.selectedHeight ? " active" : ""}" data-action="pick-height" data-idx="${idx}" data-height="${f.height}">${esc(f.label)}</button>`)
      .join("");
  } else if (isAudio && c.status === "ready") {
    qualityChips = audioBitrates
      .map((kbps) => `<button class="q-chip${kbps === c.selectedBitrate ? " active" : ""}" data-action="pick-bitrate" data-idx="${idx}" data-bitrate="${kbps}">${kbps}kbps</button>`)
      .join("");
  }

  let actionHtml = "";
  if (c.status === "ready") {
    actionHtml = `<button class="card-dl-btn" data-action="dl-card" data-idx="${idx}">Download</button>${qualityChips ? `<div class="chips">${qualityChips}</div>` : ""}`;
  } else if (c.status === "downloading" || c.status === "processing") {
    const pct = Math.round(c.progress || 0);
    const label = c.status === "processing" ? "Almost done. Finishing your file..." : c.speed ? `${c.speed}${c.eta != null ? " · " + fmtDur(c.eta) + " left" : ""}` : "Starting...";
    actionHtml = `
      <div class="card-progress grow">
        <span class="reel-spin"></span>
        <div class="bar"><i data-pct="${pct}"></i></div>
        <span>${pct}%</span>
      </div>
      <span class="card-status small">${esc(label)}</span>
      <button class="icon-btn" data-action="cancel-card" data-idx="${idx}">Cancel</button>`;
  } else if (c.status === "done") {
    actionHtml = `<button class="card-dl-btn done" data-action="save-card" data-idx="${idx}">Save file</button>
      <span class="card-status done">${c.filename ? "Saved as " + esc(c.filename) : "Your download is ready."}</span>`;
  } else if (c.status === "error") {
    actionHtml = `<button class="card-dl-btn retry" data-action="dl-card" data-idx="${idx}">Retry</button>
      <span class="card-status error">${esc(friendlyError(c.error || "Download failed"))}</span>`;
  } else if (c.status === "cancelled") {
    actionHtml = `<button class="card-dl-btn" data-action="dl-card" data-idx="${idx}">Download</button>
      <span class="card-status cancelled">Download cancelled</span>`;
  }

  el.innerHTML = `
    <div class="card-thumb">${thumbHtml}</div>
    <div class="card-body">
      <div class="card-title">${esc(c.title || "Untitled")}</div>
      <div class="card-meta">${esc(c.uploader)}${c.duration ? " · " + fmtDur(c.duration) : ""}</div>
      <div class="card-actions">${actionHtml}</div>
      ${c.warning && !isAudio ? `<div class="card-warning">${esc(c.warning)}</div>` : ""}
    </div>`;
  // The CSP forbids inline style attributes; setting styles via the CSSOM is allowed.
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
  $("batch-title").textContent = batchKind === "playlist" ? `${total} videos in this playlist` : `${total} links`;
  const parts = [];
  if (fetching) parts.push(`Loading ${cardData.length - count("loading")} of ${total}…`);
  else parts.push(`${ready + busy + done} ready to download`);
  if (failed && !fetching) parts.push(`${failed} couldn't load`);
  if (done) parts.push(`${done} downloaded`);
  $("batch-sub").textContent = parts.join(" · ");
  const active = ready + busy + done;
  const track = $("batch-track");
  track.hidden = !(busy || done);
  if (active) $("batch-bar").style.width = `${Math.round((done / active) * 100)}%`;
  const btn = $("dlAllBtn");
  btn.disabled = fetching || batchRunning || busy > 0 || ready === 0;
  btn.textContent = busy || batchRunning ? "Downloading..." : ready ? `Download all (${ready})` : done ? "All downloaded" : "Download all";
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
        format: currentFormat,
        height: currentFormat === "video" ? c.selectedHeight : null,
        audio_bitrate: currentFormat === "audio" ? c.selectedBitrate : null,
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

// Some sites return a 4:3 thumbnail with black bars baked in. Detect that shape and zoom past the bars.
document.addEventListener("load", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest(".card-thumb")) return;
  if (img.naturalWidth / img.naturalHeight >= 1.5) return;
  img.classList.add("boxed");
  const idx = Number(img.closest(".card")?.id.replace("card-", ""));
  if (cardData[idx]) cardData[idx].boxed = true;
}, true);

loadConfig();

// friendlier input: clear the hint once typing resumes; focus the box on desktop (not phones, to avoid the keyboard).
$("urls").addEventListener("input", () => {
  $("form-error").hidden = true;
  setNote(/[?&]list=/.test($("urls").value) ? PLAYLIST_NOTE : "");
});
if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) $("urls").focus();
// Say so when the connection drops, and clear the message when it comes back.
window.addEventListener("offline", () => showFormError("You're offline. Reconnect to keep going."));
window.addEventListener("online", () => { $("form-error").hidden = true; });