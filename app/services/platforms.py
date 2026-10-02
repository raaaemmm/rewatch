"""Work out which site a link belongs to (name, brand colour, logo).

Detection looks at the link's host first (reliable, and works before yt-dlp has run),
then at the extractor yt-dlp reports (covers mirrors and custom domains). The registry
below is the only place platforms are listed: the page gets it from /api/v1/config.

Logos are served from /static/platforms/<key>.svg (Simple Icons, CC0, white glyphs), so
the page never calls a third-party service. A platform with ``icon=False`` has no logo
file and is shown with a letter badge.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from ..schemas import PlatformEntry, PlatformInfo


@dataclass(frozen=True)
class Platform:
    key: str
    name: str
    hosts: tuple[str, ...]
    color: str  # badge background; near-black brands are lifted so they show on the dark UI
    extractors: tuple[str, ...] = ()  # yt-dlp extractor_key prefixes, lowercase
    icon: bool = True


_DARK = "#2a312d"

PLATFORMS: tuple[Platform, ...] = (
    Platform(
        "youtube",
        "YouTube",
        ("youtube.com", "youtu.be", "youtube-nocookie.com"),
        "#FF0000",
        ("youtube",),
    ),
    Platform("tiktok", "TikTok", ("tiktok.com",), _DARK, ("tiktok",)),
    Platform(
        "instagram",
        "Instagram",
        ("instagram.com", "instagr.am"),
        "#E4405F",
        ("instagram",),
    ),
    Platform(
        "facebook",
        "Facebook",
        ("facebook.com", "fb.watch", "fb.com", "fb.me"),
        "#1877F2",
        ("facebook",),
    ),
    Platform(
        "x",
        "X (Twitter)",
        ("x.com", "twitter.com", "t.co", "vxtwitter.com", "fxtwitter.com"),
        _DARK,
        ("twitter",),
    ),
    Platform("reddit", "Reddit", ("reddit.com", "redd.it"), "#FF4500", ("reddit",)),
    Platform("vimeo", "Vimeo", ("vimeo.com",), "#1AB7EA", ("vimeo",)),
    Platform("twitch", "Twitch", ("twitch.tv",), "#9146FF", ("twitch",)),
    Platform(
        "dailymotion",
        "Dailymotion",
        ("dailymotion.com", "dai.ly"),
        "#0066DC",
        ("dailymotion",),
    ),
    Platform(
        "soundcloud",
        "SoundCloud",
        ("soundcloud.com", "snd.sc"),
        "#FF5500",
        ("soundcloud",),
    ),
    Platform("loom", "Loom", ("loom.com",), "#625DF5", ("loom",)),
    Platform("pinterest", "Pinterest", ("pinterest.com", "pin.it"), "#BD081C", ("pinterest",)),
    Platform("tumblr", "Tumblr", ("tumblr.com",), "#36465D", ("tumblr",)),
    Platform("threads", "Threads", ("threads.net", "threads.com"), _DARK, ("threads",)),
    Platform("bilibili", "Bilibili", ("bilibili.com", "b23.tv"), "#00A1D6", ("bilibili",)),
    Platform("telegram", "Telegram", ("t.me", "telegram.me"), "#26A5E4", ("telegram",)),
    Platform("bandcamp", "Bandcamp", ("bandcamp.com",), "#1DA0C3", ("bandcamp",)),
    Platform("vk", "VK", ("vk.com", "vk.ru", "vkvideo.ru"), "#0077FF", ("vk",)),
    Platform("snapchat", "Snapchat", ("snapchat.com",), "#9C9A00", ("snapchat",)),
    Platform("rumble", "Rumble", ("rumble.com",), "#5E8A12", ("rumble",)),
    Platform("odysee", "Odysee", ("odysee.com",), "#EF1970", ("lbry", "odysee")),
    Platform("mixcloud", "Mixcloud", ("mixcloud.com",), "#5000FF", ("mixcloud",)),
    Platform("bluesky", "Bluesky", ("bsky.app",), "#1185FE", ("bluesky",)),
    Platform("imgur", "Imgur", ("imgur.com",), "#1BB76E", ("imgur",)),
    Platform("flickr", "Flickr", ("flickr.com", "flic.kr"), "#0063DC", ("flickr",)),
    Platform(
        "niconico",
        "Niconico",
        ("nicovideo.jp", "nico.ms"),
        "#252525",
        ("niconico", "nicovideo"),
    ),
    Platform("ted", "TED", ("ted.com",), "#E62B1E"),
    # No logo in the icon set: shown as a letter badge.
    Platform(
        "linkedin",
        "LinkedIn",
        ("linkedin.com", "lnkd.in"),
        "#0A66C2",
        ("linkedin",),
        icon=False,
    ),
    Platform(
        "streamable",
        "Streamable",
        ("streamable.com",),
        "#0F90FA",
        ("streamable",),
        icon=False,
    ),
    Platform("hongguo", "Hongguo", ("hongguoduanju.com",), "#D4380D", icon=False),
)

_GENERIC_COLOR = "#3a473f"
_EXTRACTOR_SKIP = {"", "generic", "genericgeneric"}


def _host(url: str) -> str:
    try:
        return (urlsplit(url or "").hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def _host_matches(host: str, domains: tuple[str, ...]) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


def _info(p: Platform) -> PlatformInfo:
    return PlatformInfo(
        key=p.key,
        name=p.name,
        color=p.color,
        icon=f"/static/platforms/{p.key}.svg" if p.icon else "",
    )


def _pretty_domain(host: str) -> str:
    return re.sub(r"^(www|m|mobile)\.", "", host)


def detect(
    url: str, extractor_key: str | None = None, extractor: str | None = None
) -> PlatformInfo | None:
    """Best guess at the site behind ``url``. None only if there is nothing to go on."""
    host = _host(url)
    for p in PLATFORMS:
        if host and _host_matches(host, p.hosts):
            return _info(p)

    key = (extractor_key or "").lower()
    if key not in _EXTRACTOR_SKIP:
        for p in PLATFORMS:
            if any(key.startswith(e) for e in p.extractors):
                return _info(p)
        # a site yt-dlp knows but we have no logo for: use its own display name
        name = (extractor or extractor_key or "").strip()
        if name:
            return PlatformInfo(key="other", name=name[:40], color=_GENERIC_COLOR, icon="")

    if host:
        return PlatformInfo(
            key="other", name=_pretty_domain(host)[:40], color=_GENERIC_COLOR, icon=""
        )
    return None


def catalog() -> list[PlatformEntry]:
    """Everything the page needs to recognise a site the moment a link is pasted."""
    return [PlatformEntry(**_info(p).model_dump(), hosts=list(p.hosts)) for p in PLATFORMS]
