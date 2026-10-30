"""The public page in site/ loads only its own files and names no instance but the sign-in target."""

import re
from pathlib import Path

SITE = Path(__file__).parent.parent / "site"
# Filled by .github/workflows/pages.yml from the tutorials release.
RELEASE_FILES = {
    "tutorials/ontotator-onboarding.mp4",
    "tutorials/ontotator-onboarding.vtt",
    "tutorials/ontotator-annotation-guidelines.mp4",
    "tutorials/ontotator-annotation-guidelines.vtt",
}


def _html() -> str:
    return (SITE / "index.html").read_text(encoding="utf-8")


def test_every_loaded_resource_is_a_local_file() -> None:
    html = _html()
    loaded = re.findall(r'(?:src|poster)="([^"]+)"', html)
    loaded += re.findall(r'<link rel="(?:stylesheet|preload)" href="([^"]+)"', html)
    assert loaded
    for path in loaded:
        assert "://" not in path, path
        assert path in RELEASE_FILES or (SITE / path).is_file(), path


def test_stylesheet_requests_only_local_files() -> None:
    css = (SITE / "styles.css").read_text(encoding="utf-8")
    urls = re.findall(r'url\("([^"]+)"\)', css)
    assert urls
    assert all((SITE / url).is_file() for url in urls)


def test_instance_appears_only_as_the_sign_in_link() -> None:
    html = _html()
    assert html.lower().count("phentrieve") == 2
    assert (
        len(
            re.findall(
                r'class="sign-in" href="https://ontotator\.phentrieve\.org"', html
            )
        )
        == 2
    )
