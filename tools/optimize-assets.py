#!/usr/bin/env python3
"""Asset weight optimiser — keeps the artwork identical, shrinks the bytes.

Why this exists
---------------
The app is a static PWA served from GitHub Pages, where HTTP cache headers
cannot be tuned, so every uncompressed kilobyte is paid on the wire (and again
in the service worker's precache, which is stored on the user's phone).
Two assets dominated the first-load budget:

  * assets/fonts/NotoSansBengali-Variable.ttf  452.8 KB  -> 238.4 KB as WOFF2
  * assets/icons/app-logo.png                  976.9 KB  ->  30.3 KB

The font is only ever *rendered* by the browser, so WOFF2 (Brotli-compressed
SFNT, universally supported by every engine that can also run this app's
service worker) is strictly better: same 730 glyphs, same wght/wdth axes,
same 444 codepoints — verified by ``tools/optimize-assets.py verify``.
The original TTF stays in the repository as the licensed OFL source for
regenerating the WOFF2; nothing loads it at runtime any more.

The logo is flat artwork (a green ring, a black brush "A", a red brush "+")
that is only ever drawn at 56x56 (report PDF header) or 64x64 (receipt
preview). 256 px is therefore 4x oversampling, and a 256-colour palette
covers the anti-aliased edges with a mean absolute error of 0.16/255 —
visually identical. Opaque icons get the same palette treatment; icons with
an alpha channel (logo-128*.png) are left untouched.

Usage
-----
    python3 tools/optimize-assets.py            # rewrite assets in place
    python3 tools/optimize-assets.py verify     # prove font WOFF2 == TTF

Requires: pip install fonttools brotli Pillow numpy
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_TTF = ROOT / "assets/fonts/NotoSansBengali-Variable.ttf"
FONT_WOFF2 = ROOT / "assets/fonts/NotoSansBengali-Variable.woff2"

# (file, target edge, palette size). Target edge None keeps the current size.
ICONS = [
    ("assets/icons/app-logo.png", 256, 256),   # drawn at 56-64px everywhere
    ("assets/icons/maskable-512.png", None, 256),
    ("assets/icons/maskable-192.png", None, 256),
    ("assets/icons/icon-192.png", None, 256),
    ("assets/icons/apple-touch-icon.png", None, 256),
    ("assets/icons/favicon-32.png", None, 256),
]


def _kb(path: Path) -> str:
    return f"{path.stat().st_size / 1024:8.1f} KB"


def build_font() -> None:
    from fontTools.ttLib import TTFont

    font = TTFont(str(FONT_TTF))
    font.flavor = "woff2"
    font.save(str(FONT_WOFF2))
    print(f"font  {_kb(FONT_TTF)} -> {_kb(FONT_WOFF2)}  {FONT_WOFF2.name}")


def verify_font() -> int:
    from fontTools.ttLib import TTFont

    ttf, woff2 = TTFont(str(FONT_TTF)), TTFont(str(FONT_WOFF2))
    problems = []
    if ttf["maxp"].numGlyphs != woff2["maxp"].numGlyphs:
        problems.append("glyph count differs")
    if set(ttf.keys()) != set(woff2.keys()):
        problems.append(f"table set differs: {set(ttf.keys()) ^ set(woff2.keys())}")
    if len(ttf.getBestCmap()) != len(woff2.getBestCmap()):
        problems.append("cmap codepoint count differs")
    if "fvar" in ttf:
        a = [(x.axisTag, x.minValue, x.maxValue) for x in ttf["fvar"].axes]
        b = [(x.axisTag, x.minValue, x.maxValue) for x in woff2["fvar"].axes]
        if a != b:
            problems.append(f"variable axes differ: {a} vs {b}")
    if problems:
        print("FONT VERIFY FAILED:")
        for p in problems:
            print("  -", p)
        return 1
    print(
        f"font verify ok — {woff2['maxp'].numGlyphs} glyphs, "
        f"{len(woff2.getBestCmap())} codepoints, "
        f"axes {[(x.axisTag, x.minValue, x.maxValue) for x in woff2['fvar'].axes]}"
    )
    return 0


def optimize_icons() -> None:
    from PIL import Image

    for rel, edge, colors in ICONS:
        path = ROOT / rel
        image = Image.open(path)
        if image.mode != "RGB":
            print(f"icon  skipped (mode {image.mode}): {rel}")
            continue
        if edge and image.size[0] > edge:
            image = image.resize((edge, edge), Image.LANCZOS)
        image = image.quantize(
            colors=colors, method=Image.MEDIANCUT, dither=Image.Dither.NONE
        )
        image.save(path, optimize=True)
        print(f"icon  -> {_kb(path)}  {rel}")


def main(argv: list[str]) -> int:
    if "verify" in argv:
        return verify_font()
    build_font()
    optimize_icons()
    return verify_font()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
