/* Rewatch i18n: English and Khmer.
 *
 * - static page text is marked in index.html with data-i18n (text), data-i18n-html (trusted
 *   markup with links or <b>), data-i18n-placeholder and data-i18n-aria.
 * - Text built in app.js calls t("key", { params }).
 * - The choice is remembered in localStorage; the first visit follows the browser language.
 * - Unknown keys fall back to English, then to the key itself.
 */
(() => {
  const STORE = "rewatch.lang";

  const dict = {
    en: {
      // page
      "brand.tagline": "Save videos and music from almost any site. Files are deleted from the server shortly after they're ready.",
      "links.label": "Links",
      "links.placeholder": "Paste a video or music link here...",
      "links.hint": "You can paste several links at once, separated by spaces or new lines. Playlist links open as a list of videos.",
      "format.aria": "Format",
      "format.video": "Video",
      "format.audio": "Audio",
      "lang.aria": "Language",
      "results.aria": "Results",
      "empty.title": "Ready when you are",
      "empty.sub": "Your videos and songs will show up here, ready to save.",
      "empty.step1": "<b>Paste</b> a link from YouTube, TikTok, Facebook and more",
      "empty.step2": "<b>Choose</b> Video to watch it or Audio to just listen",
      "empty.step3": "<b>Get</b>, pick a quality, then tap Download",
      "footer.note": "Works with 1000+ more sites through <a href=\"https://github.com/yt-dlp/yt-dlp\" target=\"_blank\" rel=\"noopener\">yt-dlp</a>.",
      "footer.credit1": "Rebuilt from <a href=\"https://github.com/averygan/reclip\" target=\"_blank\" rel=\"noopener\">ReClip</a>, the open-source downloader by averygan (MIT license).",
      "footer.credit2": "Rebuilt by <a href=\"https://www.raaaemmm.tech\" target=\"_blank\" rel=\"noopener\">Raaaemmm</a>, 2026.",

      // buttons
      "btn.get": "Get",
      "btn.getting": "Getting...",
      "btn.download": "Download",
      "btn.savePhotos": "Save as photos",
      "btn.saveFile": "Save file",
      "btn.cancel": "Cancel",
      "btn.retry": "Retry",
      "btn.tryAgain": "Try again",
      "btn.dlAll": "Download all",
      "btn.dlAllN": "Download all ({n})",
      "btn.downloading": "Downloading...",
      "btn.allDone": "All downloaded",

      // cards
      "card.reading": "Reading link...",
      "card.couldntLoad": "Couldn't load this link",
      "card.untitled": "Untitled",
      "card.ready": "Ready · {name}",
      "card.readyGeneric": "Your download is ready.",
      "card.cancelled": "Download cancelled",
      "card.warning": "Some higher qualities may be missing for this video because of a server setup issue. Please let the site owner know.",
      "progress.starting": "Starting...",
      "progress.finishing": "Almost done. Finishing your file...",
      "progress.left": " · about {t} left",

      // quality names
      "q.low": "Low",
      "q.standard": "Standard",
      "q.high": "High",
      "q.best": "Best",
      "q.kbps": "{n} kbps",

      // durations
      "dur.sec": "{n} sec",
      "dur.min": "{n} min",
      "dur.hr": "{n} hr",

      // batch
      "batch.playlist": "{n} videos in this playlist",
      "batch.photos": "{n} photos in this slideshow",
      "batch.links": "{n} links",
      "batch.loading": "Loading {a} of {b}...",
      "batch.ready": "{n} ready to download",
      "batch.failed": "{n} couldn't load",
      "batch.done": "{n} downloaded",

      // form messages
      "note.playlist": "Playlist detected. All its videos will be listed.",
      "note.trimmed": "That's {n} links. Getting the first {m}.",
      "note.seriesSkipped": "Skipped a series page. Paste an episode link (.../player/...) instead.",
      "err.notLink": "That doesn't look like a link. Links start with https://",
      "err.pasteFirst": "Paste a link first. YouTube, TikTok and most other video sites work.",
      "err.offline": "You're offline. Reconnect and try again.",
      "err.offlineKeep": "You're offline. Reconnect to keep going.",
      "err.series": "That's a series page, not a video. Open an episode, then copy the link from your browser's address bar. It looks like hongguoduanju.com/player/...",

      // friendly errors
      "e.network": "We can'reach the server right now. Please check your internet connection and try again.",
      "e.rate": "That's a lot of requests at once. Please wait a few seconds and try again.",
      "e.queue": "The server is busy at the moment. Please try again in a minute.",
      "e.timeout": "That took longer than expected. Please try again, or choose a lower quality.",
      "e.lost": "The connection dropped. Please try again.",
      "e.server": "Something went wrong on our side, not yours. Please try again.",
      "e.expired": "This download has expired. Paste the link again to start a new one.",
      "e.noPhotos": "We couldn't read the photos from this TikTok post. It may be private, or TikTok is limiting requests right now. Please try again in a minute.",
      "e.needGalleryDl": "This server can't handle TikTok slideshows yet. Please let the site owner know.",
      "e.needFfmpeg": "This server can't build slideshows yet. Please let the site owner know.",
      "e.slideDl": "We couldn't download the photos from TikTok. Please try again.",
      "e.slideBuild": "We couldn't build the video from these photos. Please try again.",
      "e.photoGone": "That photo is no longer in the post. Load the slideshow again.",
      "e.noMusic": "This slideshow has no music, so there's nothing to save as audio.",
      "e.photoBig": "One of the files in this slideshow is too large for this server.",
      "e.onlyHttp": "That doesn't look like a web link. Links start with https://",
      "e.invalidUrl": "That link doesn't look right. Please check it and try again.",
      "e.credentials": "Please remove the username and password from the link and try again.",
      "e.private": "That address can't be used. Please paste a public video or music link.",
      "e.resolve": "We couldn't find that website. Please check the link for typos.",
      "e.allow": "Sorry, this website isn't supported on this server.",
      "e.unsupported": "This link isn't supported yet. Try a direct link to a video or song.",
      "e.noMedia": "We couldn't find any video or audio at this link.",
      "e.fbPost": "This looks like a Facebook post, not a video. Open the video on its own page and copy that link, or use a reel or /watch link.",
      "e.login": "This video needs a login to watch, so we can't download it. If it's a Facebook post, open the video on its own page and copy that link.",
      "e.notFound": "We couldn't find anything at this link. It may have been removed, or it may need a login to view.",
      "e.unavailable": "This video isn't available. It may have been removed or made private.",
      "e.privateVideo": "This video is private, so we can't download it.",
      "e.members": "This video is for channel members only, so we can't download it.",
      "e.age": "This video is age-restricted, so we can't download it.",
      "e.bot": "The site is asking to verify this request. Please try again in a few minutes.",
      "e.copyright": "This video is blocked by a copyright claim, so we can't download it.",
      "e.geo": "This video isn't available in your region.",
      "e.live": "Live streams can't be downloaded. Please try again after it ends.",
      "e.format": "That quality isn't available for this video. Please pick another one.",
      "e.forbidden": "The site turned down the request. Please try again in a moment.",
      "e.tooLong": "This is longer than {h} hours, which is the most this server can save.",
      "e.tooBig": "This file is too big for this server. Try a lower quality or a shorter video.",
      "e.cancelled": "Download cancelled.",
      "e.generic": "We couldn't open this link. It may not be supported, or the site may be blocking downloads. Please try a different link.",
    },

    km: {
      // page
      "brand.tagline": "លោកម៉ូយ—កញ្ញាម៉ូយ អាចទាញយកនិងរក្សាទុកនូវវីដេអូឬសម្លេងពីគេហទំព័រល្បីៗជាច្រើនទៅកាន់ទូរស័ព្ទដៃឬកុំព្យូទ័ររបស់លោកអ្នកយ៉ាងងាយស្រួល ម្យ៉ាងទៀត រាល់ឯកសារដែលបានទាញយកនឹងត្រូវលុបចេញពីប្រព័ន្ធមេ (Server) ដោយស្វ័យប្រវត្តិបន្ទាប់ពីបានរក្សាទុករួច",
      "links.label": "តំណលីង",
      "links.placeholder": "បិទភ្ជាប់តំណ (Paste Link) វីដេអូ ឬសម្លេងនៅទីនេះ...",
      "links.hint": "អ្នកអាចបិទភ្ជាប់ (Paste) តំណច្រើនក្នុងពេលតែមួយ ដោយចុចដកឃ្លា ឬចុះបន្ទាត់ ចំពោះតំណជា Playlist វានឹងបង្ហាញជាបញ្ជីវីដេអូទាំងអស់",
      "format.aria": "ប្រភេទ",
      "format.video": "វីដេអូ",
      "format.audio": "សំឡេង",
      "lang.aria": "ភាសា",
      "results.aria": "លទ្ធផល",
      "empty.title": "ត្រៀមរួចរាល់សម្រាប់អ្នក",
      "empty.sub": "វីដេអូ និងបទចម្រៀងដែលអ្នកបានជ្រើសរើស នឹងបង្ហាញនៅទីនេះ",
      "empty.step1": "<b>បិទភ្ជាប់</b> តំណលីងពី YouTube, TikTok, Facebook និងបណ្តាញផ្សេងៗ",
      "empty.step2": "<b>ជ្រើសរើស</b> ប្រភេទវីដេអូ (Video) ឬសំឡេង (Audio)",
      "empty.step3": "<b>ចុចទាញយក</b> ជ្រើសរើសកម្រិតច្បាស់ រួចចុចទាញយក",
      "footer.note": "គាំទ្រជាមួយគេហទំព័រជាង ១០០០+ ផ្សេងទៀតតាមរយៈ <a href=\"https://github.com/yt-dlp/yt-dlp\" target=\"_blank\" rel=\"noopener\">yt-dlp</a>",
      "footer.credit1": "អភិវឌ្ឍបន្តពី <a href=\"https://github.com/averygan/reclip\" target=\"_blank\" rel=\"noopener\">ReClip</a> កម្មវិធី Open-source របស់ averygan (ក្រោមអាជ្ញាប័ណ្ណ MIT)",
      "footer.credit2": "បង្កើតឡើងវិញដោយ <a href=\"https://www.raaaemmm.tech\" target=\"_blank\" rel=\"noopener\">Raaaemmm</a> ក្នុងឆ្នាំ ២០២៦",

      // buttons
      "btn.get": "ទាញយក",
      "btn.getting": "កំពុងដំណើរការ...",
      "btn.download": "ទាញយក",
      "btn.savePhotos": "រក្សាទុកជារូបភាព",
      "btn.saveFile": "រក្សាទុកឯកសារ",
      "btn.cancel": "បោះបង់",
      "btn.retry": "ព្យាយាមម្តងទៀត",
      "btn.tryAgain": "ព្យាយាមម្តងទៀត",
      "btn.dlAll": "ទាញយកទាំងអស់",
      "btn.dlAllN": "ទាញយកទាំងអស់ ({n})",
      "btn.downloading": "កំពុងទាញយក...",
      "btn.allDone": "បានទាញយករួចរាល់ទាំងអស់",

      // cards
      "card.reading": "កំពុងពិនិត្យតំណលីង...",
      "card.couldntLoad": "មិនអាចបើកតំណលីងនេះបានទេ",
      "card.untitled": "គ្មានចំណងជើង",
      "card.ready": "រួចរាល់ · {name}",
      "card.readyGeneric": "ការទាញយករបស់អ្នករួចរាល់ហើយ",
      "card.cancelled": "បានបោះបង់ការទាញយក",
      "card.warning": "កម្រិតច្បាស់ខ្ពស់អាចមិនមានសម្រាប់វីដេអូនេះ ដោយសារការកំណត់របស់ប្រព័ន្ធ",
      "progress.starting": "កំពុងចាប់ផ្តើម...",
      "progress.finishing": "ជិតរួចរាល់ហើយ... កំពុងរៀបចំឯកសារ",
      "progress.left": " · នៅសល់ប្រហែល {t}",

      // quality names
      "q.low": "កម្រិតទាប",
      "q.standard": "ធម្មតា",
      "q.high": "ច្បាស់",
      "q.best": "ច្បាស់បំផុត",
      "q.kbps": "{n} kbps",

      // durations
      "dur.sec": "{n} វិនាទី",
      "dur.min": "{n} នាទី",
      "dur.hr": "{n} ម៉ោង",

      // batch
      "batch.playlist": "វីដេអូ {n} ក្នុង Playlist នេះ",
      "batch.photos": "រូបភាព {n} ក្នុង Slideshow នេះ",
      "batch.links": "តំណលីងចំនួន {n}",
      "batch.loading": "កំពុងផ្ទុក {a} ក្នុងចំណោម {b}...",
      "batch.ready": "{n} រួចរាល់សម្រាប់ទាញយក",
      "batch.failed": "{n} មិនអាចផ្ទុកបាន",
      "batch.done": "{n} បានទាញយករួច",

      // form messages
      "note.playlist": "បានរកឃើញ Playlist! វីដេអូទាំងអស់ក្នុង Playlist នឹងត្រូវបង្ហាញ",
      "note.trimmed": "មានតំណលីងសរុប {n} ប្រព័ន្ធមេនឹងយកតែ {m} ដំបូងប៉ុណ្ណោះ",
      "note.seriesSkipped": "បានរំលងទំព័រស៊េរី (Series)។ សូមប្រើតំណលីងភាគវីដេអូ (.../player/...) វិញ",
      "err.notLink": "តំណលីងនេះមិនត្រឹមត្រូវទេ តំណលីងត្រូវផ្តើមដោយ https://",
      "err.pasteFirst": "សូមបិទភ្ជាប់តំណលីងជាមុនសិន (គាំទ្រ YouTube, TikTok, Facebook និងគេហទំព័រផ្សេងៗ)",
      "err.offline": "អ្នកមិនមានអ៊ីនធឺណិតទេ (Offline) សូមពិនិត្យការភ្ជាប់អ៊ីនធឺណិត រួចព្យាយាមម្តងទៀត",
      "err.offlineKeep": "អ្នកមិនមានអ៊ីនធឺណិតទេ សូមភ្ជាប់អ៊ីនធឺណិតដើម្បីបន្ត",
      "err.series": "នេះជាទំព័រស៊េរី (Series) មិនមែនជាវីដេអូទោលទេ សូមបើកមើលភាគណាមួយ រួចចម្លងតំណលីងពី Address bar (ឧទាហរណ៍៖ hongguoduanju.com/player/...)",

      // friendly errors
      "e.network": "មិនអាចភ្ជាប់ទៅកាន់ប្រព័ន្ធបានទេនៅពេលនេះ។ សូមពិនិត្យអ៊ីនធឺណិតរបស់អ្នក រួចព្យាយាមម្តងទៀត",
      "e.rate": "មានការស្នើសុំច្រើនពេកក្នុងពេលតែមួយ សូមរង់ចាំបន្តិច រួចព្យាយាមម្តងទៀត",
      "e.queue": "ប្រព័ន្ធកំពុងរវល់ខ្លាំងនៅពេលនេះ សូមព្យាយាមម្តងទៀតនៅ ១ នាទីក្រោយ",
      "e.timeout": "ការតភ្ជាប់ប្រើពេលយូរពេក សូមព្យាយាមម្តងទៀត ឬជ្រើសរើសកម្រិតច្បាស់ទាបជាងនេះ",
      "e.lost": "ដាច់ការតភ្ជាប់អ៊ីនធឺណិត សូមព្យាយាមម្តងទៀត",
      "e.server": "មានបញ្ហាបច្ចេកទេសកើតឡើងនៅលើប្រព័ន្ធ សូមព្យាយាមម្តងទៀត",
      "e.expired": "តំណទាញយកនេះបានផុតកំណត់ហើយ សូមបិទភ្ជាប់តំណលីងម្តងទៀតដើម្បីទាញយកជាថ្មី",
      "e.noPhotos": "មិនអាចអានរូបភាពពី TikTok នេះបានទេ ផុសនេះអាចជា Private ឬ TikTok កំពុងកំហិតសំណើ សូមព្យាយាមម្តងទៀតនៅ ១ នាទីក្រោយ។",
      "e.needGalleryDl": "ប្រព័ន្ធមិនទាន់គាំទ្រការទាញយក Slideshow រូបភាព TikTok នៅឡើយទេ",
      "e.needFfmpeg": "ប្រព័ន្ធមិនទាន់គាំទ្រការបង្កើតវីដេអូ Slideshow នៅឡើយទេ",
      "e.slideDl": "មិនអាចទាញយករូបភាពពី TikTok បានទេ។ សូមព្យាយាមម្តងទៀត",
      "e.slideBuild": "មិនអាចបង្កើតវីដេអូពីរូបភាពទាំងនេះបានទេ សូមព្យាយាមម្តងទៀត",
      "e.photoGone": "រូបភាពនេះលែងមានក្នុង Post ទៀតហើយ សូមទាញយក Slideshow ឡើងវិញ",
      "e.noMusic": "Slideshow នេះគ្មានបទចម្រៀង/សំឡេង សម្រាប់ទាញយកទេ",
      "e.photoBig": "ឯកសាររូបភាពក្នុង Slideshow នេះមានទំហំធំពេក",
      "e.onlyHttp": "អាសយដ្ឋាននេះមិនមែនជាតំណលីងទេ តំណលីងត្រូវផ្តើមដោយ https://",
      "e.invalidUrl": "តំណលីងនេះមិនត្រឹមត្រូវទេ សូមពិនិត្យ រួចព្យាយាមម្តងទៀត",
      "e.credentials": "សូមលុប Username និង Password ចេញពីតំណលីង រួចព្យាយាមម្តងទៀត",
      "e.private": "អាសយដ្ឋាននេះមិនអាចប្រើបានទេ សូមបិទភ្ជាប់តំណលីងវីដេអូ ឬបទចម្រៀងសាធារណៈ (Public)",
      "e.resolve": "រកមិនឃើញគេហទំព័រនេះទេ សូមពិនិត្យមើលតំណលីងឡើងវិញ",
      "e.allow": "សូមអភ័យទោស គេហទំព័រនេះមិនគាំទ្រនៅលើប្រព័ន្ធឡើយ",
      "e.unsupported": "តំណលីងនេះមិនទាន់គាំទ្រនៅឡើយទេ សូមសាកល្បងតំណផ្ទាល់ទៅកាន់វីដេអូ ឬបទចម្រៀង",
      "e.noMedia": "រកមិនឃើញវីដេអូ ឬសំឡេងនៅក្នុងតំណលីងនេះទេ",
      "e.fbPost": "នេះជា Post លើ Facebook មិនមែនជាវីដេអូទេ សូមបើកវីដេអូនោះដាច់ដោយឡែក រួចចម្លងតំណលីង (ឬប្រើតំណ Reel / Watch)",
      "e.login": "វីដេអូនេះតម្រូវឱ្យចូលគណនី (Log in) ដើម្បីមើល ដូច្នេះមិនអាចទាញយកបានទេ ប្រសិនបើជា Facebook សូមបើកទំព័រវីដេអូនោះផ្ទាល់ រួចចម្លងតំណលីង",
      "e.notFound": "រកមិនឃើញមាតិកានៅក្នុងតំណលីងនេះទេ វាអាចត្រូវលុបចោល ឬតម្រូវឱ្យ Log in",
      "e.unavailable": "វីដេអូនេះមិនមានឡើយ វាអាចត្រូវគេលុប ឬកំណត់ជា Private",
      "e.privateVideo": "វីដេអូនេះជា Private ដូច្នេះមិនអាចទាញយកបានទេ",
      "e.members": "វីដេអូនេះសម្រាប់តែសមាជិក (Members-only) ដូច្នេះមិនអាចទាញយកបានទេ",
      "e.age": "វីដេអូនេះមានកម្រិតអាយុ (Age-restricted) ដូច្នេះមិនអាចទាញយកបានទេ",
      "e.bot": "គេហទំព័រតម្រូវឱ្យផ្ទៀងផ្ទាត់សិន (Bot check) សូមព្យាយាមម្តងទៀតក្នុងពេលបន្តិចទៀត",
      "e.copyright": "វីដេអូនេះត្រូវបានរារាំងដោយសាររក្សាសិទ្ធិ (Copyright) ដូច្នេះមិនអាចទាញយកបានទេ",
      "e.geo": "វីដេអូនេះមិនអនុញ្ញាតឱ្យមើលក្នុងតំបន់/ប្រទេសរបស់អ្នកទេ",
      "e.live": "មិនអាចទាញយកការឡាយផ្ទាល់ (Live stream) បានទេ សូមព្យាយាមម្តងទៀតបន្ទាប់ពីការឡាយចប់",
      "e.format": "កម្រិតច្បាស់នេះមិនមានសម្រាប់វីដេអូនេះទេ សូមជ្រើសរើសកម្រិតផ្សេង",
      "e.forbidden": "គេហទំព័រដើមបានបដិសេធសំណើ សូមព្យាយាមម្តងទៀតក្នុងពេលបន្តិចទៀត",
      "e.tooLong": "វីដេអូនេះវែងជាង {h} ម៉ោង ដែលជាកម្រិតអតិបរមាប្រព័ន្ធអាចទាញយកបាន",
      "e.tooBig": "ឯកសារនេះមានទំហំធំពេក សូមជ្រើសរើសកម្រិតច្បាស់ទាបជាងនេះ ឬវីដេអូខ្លីជាងនេះ",
      "e.cancelled": "បានបោះបង់ការទាញយក",
      "e.generic": "មិនអាចបើកតំណលីងនេះបានទេ វាអាចមិនទាន់គាំទ្រ ឬគេហទំព័ររារាំងការទាញយក សូមសាកល្បងតំណលីងផ្សេង",
    },
  };

  let lang = "en";

  function detect() {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved && dict[saved]) return saved;
    } catch {
      /* storage can be blocked; fall through to the browser language */
    }
    return (navigator.language || "").toLowerCase().startsWith("km") ? "km" : "en";
  }

  function t(key, params) {
    let s = dict[lang][key] ?? dict.en[key] ?? key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
    return s;
  }

  // everything marked in index.html. The html variant only ever gets our own trusted strings above.
  function applyStatic() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    document.querySelectorAll(".lang-btn").forEach((b) => {
      const on = b.dataset.lang === lang;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function setLang(next) {
    if (!dict[next] || next === lang) return false;
    lang = next;
    try {
      localStorage.setItem(STORE, lang);
    } catch {
      /* not remembered, still works for this visit */
    }
    applyStatic();
    return true;
  }

  function init() {
    lang = detect();
    applyStatic();
  }

  window.I18N = { t, setLang, applyStatic, init, getLang: () => lang, dict };
  window.t = t;
})();