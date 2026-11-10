#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the Active Plus house-style "Narration Master" A4 lecture sheet PDF.

Usage:
    python3 -m venv .venv && .venv/bin/pip install fpdf2 uharfbuzz fonttools brotli pillow
    .venv/bin/python tools/lecture-sheet-pdf/build.py

Output:
    files/lecture-sheets/Narration_Master_Lecture_Sheet_ActivePlus.pdf
"""

from __future__ import annotations

import os
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine import (  # noqa: E402
    BRAND_NAME, BRAND_TAGLINE, FAINT, GREEN_DEEP, LINE, MARGIN, MUTED, PAGE_W,
    LectureSheet, bn, prepare_fonts,
)
import content_a as A  # noqa: E402
import content_b as B  # noqa: E402
import content_c as C  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT_DIR = os.path.join(REPO, 'files', 'lecture-sheets')
OUT_PDF = os.path.join(OUT_DIR, 'Narration_Master_Lecture_Sheet_ActivePlus.pdf')

# Glyph substitutions for characters the bundled Bengali face does not carry.
GLYPH_FIX = {
    '\u2192': '\u00bb',   # →  becomes »
    '\u2190': '\u00ab',
    '\u00b1': '+/-',
    '\u2264': '<=',
    '\u2265': '>=',
    '\u2260': '!=',
    '\u00bd': '1/2',
    '\u2713': '\u00b7',
    '\u2022': '\u2022',
}

RECORD = {
    'title': 'NARRATION — সম্পূর্ণ মাস্টার লেকচার শিট',
    'subtitle': 'Direct ও Indirect Speech: নিয়ম, উদাহরণ, অনুশীলন, উত্তরমালা ও বোর্ড প্রশ্নের সমাধান',
    'pills': [
        'SSC – HSC',
        'বিষয়: English 2nd Paper',
        'অধ্যায়: Narration',
        'টপিক: Direct ও Indirect Speech',
    ],
    'header_text': 'Narration — সম্পূর্ণ মাস্টার লেকচার শিট',
    'header_right': 'English 2nd Paper  •  SSC – HSC',
}


_ALLOWED_EXTRA = set('\u00ab\u00bb\u00b0\u00b7\u00d7\u00f7\u00a9\u00ae\u2013\u2014'
                     '\u2018\u2019\u201c\u201d\u2022\u2026\u20b9\u09f3\u200c\u200d\u2122')


def _assert_supported(text: str) -> None:
    for ch in text:
        code = ord(ch)
        if 0x20 <= code <= 0x7E or 0x0980 <= code <= 0x09FF or code in (0x0964, 0x0965) or ch in _ALLOWED_EXTRA:
            continue
        raise ValueError(f'unsupported character U+{code:04X} {ch!r} in: {text[:70]}')


def clean(text: str) -> str:
    for bad, good in GLYPH_FIX.items():
        text = text.replace(bad, good)
    text = text.replace('\u200c', '')
    _assert_supported(text)
    return text


def walk(block):
    """Deep-clean every string inside a block definition."""
    if isinstance(block, str):
        return clean(block)
    if isinstance(block, list):
        return [walk(item) for item in block]
    if isinstance(block, tuple):
        return tuple(walk(item) for item in block)
    if isinstance(block, dict):
        return {k: walk(v) for k, v in block.items()}
    return block


CONTENTS = {'t': 'box', 'variant': 'paper', 'title': 'এই লেকচার শিটে যা যা আছে',
            'lines': [
                ('b', '**১.** ন্যারেশনের মৌলিক সংজ্ঞা   **২.** পার্সনের পরিবর্তন (123/SON)   **৩.** টেন্স পরিবর্তনের ১২টি নিয়ম ও ৮০টি উদাহরণ'),
                ('b', '**৪.** সেন্টেন্স-ভিত্তিক পরিবর্তন (Assertive, Interrogative, Imperative, Optative, Exclamatory)'),
                ('b', '**৫.** দূরত্ব ও সময়সূচক শব্দ   **৬.** বিশেষ ও ব্যতিক্রমী নিয়ম   **৭.** মাস্টার প্যাসেজ ন্যারেশন ও বোর্ড প্রশ্নের সমাধান'),
            ]}


def render(pdf: LectureSheet, blocks) -> None:
    for block in blocks:
        kind = block['t']
        if kind == 'h2':
            pdf.h2(block['n'], block['bn'], block.get('en', ''))
        elif kind == 'h3':
            pdf.h3(block['x'])
        elif kind == 'p':
            pdf.para(block['x'])
        elif kind == 'rule':
            pdf.rule(block['label'], block['x'])
        elif kind == 'bullets':
            pdf.bullet_list(block['items'], size=8.9, line_h=4.75)
        elif kind == 'box':
            pdf.box(block['lines'], title=block.get('title', ''), variant=block.get('variant', 'green'))
        elif kind == 'table':
            pdf.table(block['head'], block['rows'], block['widths'])
        elif kind == 'examples':
            pdf.examples(block['items'])
        elif kind == 'practice':
            pdf.numbered_box(block['items'], title=block['title'], variant='paper')
        elif kind == 'answers':
            pdf.numbered_box(block['items'], title=block['title'], variant='amber')
        elif kind == 'pagebreak':
            pdf.page_break()
        elif kind == 'notes':
            pdf.notes_panel(block.get('title', 'আমার নোট'), block.get('rows'))
        elif kind == 'signature':
            render_signature(pdf)
        else:
            raise ValueError(f'unknown block: {kind}')


def render_signature(pdf: LectureSheet) -> None:
    pdf.gap(2.0)
    pdf.need(22)
    y = max(pdf.get_y(), 258.0)
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.25)
    pdf.line(MARGIN, y, PAGE_W - MARGIN, y)
    pdf.set_xy(MARGIN, y + 2.4)
    pdf.set_font('BN', 'B', 9.0)
    pdf.set_text_color(*GREEN_DEEP)
    pdf.cell(90, 5.2, BRAND_NAME, align='L')
    pdf.set_xy(MARGIN, y + 6.8)
    pdf.set_font('BN', '', 8.2)
    pdf.set_text_color(*FAINT)
    pdf.cell(120, 4.8, f'{BRAND_TAGLINE}  •  Narration Master Lecture Sheet', align='L')
    pdf.set_xy(PAGE_W - MARGIN - 90, y + 2.4)
    pdf.set_font('BN', '', 8.2)
    pdf.set_text_color(*MUTED)
    pdf.cell(90, 5.2, 'শিক্ষকদের জন্য প্রস্তুতকৃত', align='R')
    pdf.set_xy(PAGE_W - MARGIN - 90, y + 6.8)
    pdf.set_font('BN', '', 8.0)
    pdf.set_text_color(*FAINT)
    pdf.cell(90, 4.8, f'সংস্করণ: {bn(1)}.০  •  নভেম্বর {bn(2026)}', align='R')


def collect_blocks():
    blocks = [A.SHORTCUTS, CONTENTS, *A.SECTION_1, *A.SECTION_2, *A.SECTION_3_HEAD]
    blocks.extend(A.TENSE_GROUPS)
    blocks.extend(A.SECTION_3_TAIL)
    blocks.extend(B.SECTION_4_HEAD)
    blocks.extend(B.ASSERTIVE)
    blocks.extend(B.INTERROGATIVE)
    blocks.extend(B.IMPERATIVE)
    blocks.extend(B.OPTATIVE)
    blocks.extend(B.EXCLAMATORY)
    blocks.extend(C.NEARNESS)
    blocks.extend(C.SPECIAL)
    blocks.extend(C.PASSAGE)
    blocks.extend(C.CLOSING)
    return [walk(b) for b in blocks]


def build(total_pages=None) -> LectureSheet:
    pdf = LectureSheet(RECORD, total_pages=total_pages)
    pdf.add_page()
    render(pdf, collect_blocks())
    return pdf


def main():
    prepare_fonts()
    os.makedirs(OUT_DIR, exist_ok=True)

    probe = build(total_pages=None)
    total = probe.page_no()
    pdf = build(total_pages=total)
    assert pdf.page_no() == total, 'pagination drift between passes'
    pdf.set_title('Narration Master Comprehensive Lecture Sheet — Active Plus Coaching')
    pdf.set_author(BRAND_NAME)
    pdf.set_subject('English 2nd Paper — Narration (Direct & Indirect Speech)')
    pdf.set_keywords('Active Plus Coaching, Narration, Direct Speech, Indirect Speech, SSC, HSC')
    pdf.output(OUT_PDF)
    print(f'wrote {OUT_PDF} ({total} pages)')


if __name__ == '__main__':
    main()
