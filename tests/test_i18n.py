"""Keep the English and Khmer dictionaries in step, and make sure every key the page uses exists."""
import re
from pathlib import Path

STATIC = Path(__file__).resolve().parent.parent / "static"
I18N = (STATIC / "js" / "i18n.js").read_text(encoding="utf-8")
APP = (STATIC / "js" / "app.js").read_text(encoding="utf-8")
INDEX = (STATIC / "index.html").read_text(encoding="utf-8")


def section(name: str) -> dict[str, str]:
    """Pull the `"key": "value",` pairs out of one language block."""
    start = I18N.index(f"    {name}: {{")
    end = I18N.index("\n    },", start)
    pairs = re.findall(r'^\s*"([\w.]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$', I18N[start:end], re.M)
    return dict(pairs)


EN, KM = section("en"), section("km")


def test_same_keys_in_both_languages():
    assert set(EN) == set(KM), (set(EN) ^ set(KM))


def test_no_empty_translations():
    assert all(v.strip() for v in EN.values())
    assert all(v.strip() for v in KM.values())


def test_placeholders_match():
    for key, en in EN.items():
        assert sorted(re.findall(r"\{(\w+)\}", en)) == sorted(re.findall(r"\{(\w+)\}", KM[key])), key


def test_khmer_is_really_khmer():
    # Every sentence-length Khmer string should contain Khmer letters (U+1780 to U+17FF).
    for key, km in KM.items():
        if key in {"q.kbps"}:
            continue
        assert re.search(r"[\u1780-\u17FF]", km), key


def test_keys_used_in_code_exist():
    used = set(re.findall(r'\bt\("([\w.]+)"', APP))
    used |= set(re.findall(r'key: "(\w+\.[\w.]+)"', APP))  # i18n keys always contain a dot
    used |= set(re.findall(r'\["(e\.[\w]+|note\.[\w]+)"', APP))
    used |= set(re.findall(r'"((?:e|note)\.\w+)"', APP))
    used |= set(re.findall(r'data-i18n(?:-html|-placeholder|-aria)?="([\w.]+)"', INDEX))
    missing = {k for k in used if k not in EN}
    assert not missing, missing


def test_page_loads_i18n_before_app():
    assert INDEX.index("/static/js/i18n.js") < INDEX.index("/static/js/app.js")


def test_language_buttons_present():
    assert 'data-lang="en"' in INDEX and 'data-lang="km"' in INDEX
