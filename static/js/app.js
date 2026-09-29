const API = "/api/v1";
let currentFormat = "video";
let cardData = [];
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
});

function parseUrls(text) {
  const urls = [...new Set(text.split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];
  return urls.slice(0, maxUrls);
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

function friendlyError(err) {
  const e = err || "";
  const map = [
    [/unsupported url/i, "We can't download from this link. Check that it's a direct video or music link."],
    [/video unavailable/i, "This video isn't available. It may have been removed."],
    [/private video/i, "This video is private, so it can't be downloaded."],
    [/403/, "The site refused the request. Please try again in a moment."],
    [/404/, "We couldn't find anything at that link. Double-check it."],
    [/copyright/i, "This video is blocked by a copyright claim."],
    [/geo/i, "This video isn't available in your region."],
    [/timed out/i, "That took too long. Please try again."],
    [/network/i, "Connection problem. Check your internet and try again."],
    [/live streams? (are|is) not supported/i, "Live streams can't be downloaded yet. Try again after it ends."],
    [/longer than/i, err],
    [/larger than/i, err],
  ];
  for (const [re, msg] of map) if (re.test(e)) return msg;
  return e.length > 100 ? e.slice(0, 100) + "..." : e || "Something went wrong. Please try again.";
}

$("urls").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    go();
  }
});

async function go() {
  const urls = parseUrls($("urls").value);
  const errBox = $("form-error");
  errBox.hidden = true;
  if (!urls.length) {
    errBox.textContent = "Paste a link first, for example a YouTube or TikTok URL.";
    errBox.hidden = false;
    $("urls").focus();
    return;
  }

  const btn = $("goBtn");
  const container = $("cards");
  btn.disabled = true;
  btn.innerHTML = `<span class="reel-spin"></span> Getting...`;
  container.innerHTML = "";
  const dlAllBar = $("dl-all-bar");
  if (dlAllBar) dlAllBar.remove();
  cardData = [];

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
        if (res.ok && data.urls?.length) urls.splice(i, 1, ...data.urls);
      } catch {
        /* keep the original playlist URL if expansion fails */
      }
    }
  }

  for (const url of urls.slice(0, maxUrls)) {
    const idx = cardData.length;
    cardData.push({ url, status: "loading" });
    renderCard(idx);

    try {
      const res = await fetch(`${API}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        cardData[idx] = { ...cardData[idx], status: "info-error", error: data.detail || "Could not get info" };
      } else {
        cardData[idx] = {
          ...cardData[idx],
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
      cardData[idx] = { ...cardData[idx], status: "info-error", error: err.message };
    }
    renderCard(idx);
  }

  if (cardData.filter((c) => c.status === "ready").length > 1) renderDownloadAll();

  btn.disabled = false;
  btn.textContent = "Fetch";
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
      <div class="card-body">
        <div class="skeleton-line medium"></div>
        <div class="skeleton-line short"></div>
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
        <div class="card-title card-title-error">Couldn't fetch this one</div>
        <div class="card-error-msg">${esc(friendlyError(c.error || ""))}</div>
        <div class="card-error-url">${esc(c.url)}</div>
      </div>`;
    return;
  }

  el.className = "card";
  const isAudio = currentFormat === "audio";

  let thumbHtml;
  if (isAudio) {
    thumbHtml = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" class="thumb-audio"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  } else if (c.thumbnail) {
    thumbHtml = `<img src="${esc(c.thumbnail)}" alt="" loading="lazy">`;
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
    const label = c.status === "processing" ? "Almost there, converting..." : c.speed ? `${c.speed}${c.eta != null ? " · " + fmtDur(c.eta) + " left" : ""}` : "Getting ready…";
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
      <span class="card-status done">${esc(c.filename || "")}</span>`;
  } else if (c.status === "error") {
    actionHtml = `<button class="card-dl-btn retry" data-action="dl-card" data-idx="${idx}">Retry</button>
      <span class="card-status error">${esc(friendlyError(c.error || "Download failed"))}</span>`;
  } else if (c.status === "cancelled") {
    actionHtml = `<button class="card-dl-btn" data-action="dl-card" data-idx="${idx}">Download</button>
      <span class="card-status cancelled">Cancelled</span>`;
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
}

function renderDownloadAll() {
  document.getElementById("dl-all-bar")?.remove();
  const bar = document.createElement("div");
  bar.id = "dl-all-bar";
  bar.className = "dl-all-bar";
  bar.innerHTML = `<button class="dl-all-btn" data-action="dl-all">Download all</button>`;
  $("cards").appendChild(bar);
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
      c.error = data.detail || "Could not start download";
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
      c.error = "Lost connection to server";
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
  const btn = document.querySelector(".dl-all-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Downloading...";
  }
  for (let i = 0; i < cardData.length; i++) {
    if (cardData[i].status === "ready") {
      await dlCard(i);
      await new Promise((r) => setTimeout(r, 250)); // stagger job creation slightly
    }
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Download all";
  }
}

loadConfig();

// friendlier input: clear the hint once typing resumes; focus the box on desktop (not phones, to avoid the keyboard).
$("urls").addEventListener("input", () => { $("form-error").hidden = true; });
if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) $("urls").focus();