# Active Plus house-style lecture sheet builder (A4 PDF)

Builds a print-ready A4 lecture sheet that matches the sheets students download
from the Active Plus studio (`js/lecture-sheet-pdf.js`):

| Element | Implementation |
| --- | --- |
| Page 1 header | logo + “Active Plus Coaching” +tagline, `লেকচার শিট` badge, title banner with class / subject / chapter / topic pills |
| Running pages | title + `English 2nd Paper • SSC – HSC` running head with hairline rule |
| Footer | `Active Plus Coaching • শিখতে থাকো, এগিয়ে যাও` and `পৃষ্ঠা X / Y` in Bangla numerals |
| Watermark | centred, rotated brand mark derived from `assets/icons/app-logo.png` |
| Colour system | brand green `#0e7a55`, tinted info/warning boxes, `#eef6f2` table heads |
| Typography | bundled `NotoSansBengali-Variable.woff2`/`.ttf` (OFL) shaped through HarfBuzz |

Output: `files/lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf`
(public URL: `/files/lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf` —
see `files/README.md` for the repository-wide file convention)
(18 pages, A4, vector text, ~180 KB).

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install fpdf2 uharfbuzz fonttools brotli pillow
.venv/bin/python tools/lecture-sheet-pdf/build.py
```

`build/lecture-sheet/` holds throw-away build assets (instanced fonts, watermark)
and is git-ignored; the PDF itself is tracked.

## Files

| File | Purpose |
| --- | --- |
| `engine.py` | A4 flow writer: header/footer furniture, boxes, tables, example pairs, practice/answer keys, notes panel |
| `content_a.py` | Sections 1–3: definitions, 123/SON person change, twelve tense rules + 80 examples |
| `content_b.py` | Section 4: sentence-type change (Assertive, Interrogative, Imperative, Optative, Exclamatory) |
| `content_c.py` | Sections 5–7: nearness words, special rules, passage narration, closing page |
| `build.py` | Assembles blocks, renders twice (page count for `X / Y`), writes the PDF |

## Two rendering notes

1. **Bengali line breaking.** fpdf2's `multi_cell` line breaker mis-draws a
   shaped cluster that happens to end a wrapped line (a dotted-circle/reph
   artefact). This engine wraps text itself (`wrap_runs`) and draws each line
   with `cell()`, which keeps যুক্তাক্ষর intact.
2. **ASCII digits.** Noto Sans Bengali draws `0-9` with Bengali numeral shapes.
   The build copies of the font get their ten ASCII digit glyphs replaced with
   Latin ones (DejaVu Sans) — `assets/fonts/` is never modified. Bengali digits
   (`০-৯`) keep their original shapes.

Bengali text is shaped correctly when printed, but the PDF's `ToUnicode` map for
reordered glyph clusters is incomplete, so copy-pasting Bangla out of the PDF is
imperfect (Latin text copies cleanly). Content lives in the `content_*.py` files
— edit those and rebuild rather than editing the PDF.
