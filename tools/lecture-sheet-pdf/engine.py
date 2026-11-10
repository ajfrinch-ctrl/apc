"""Active Plus Coaching — house-style A4 lecture sheet renderer.

Renders the same visual identity as the lecture sheets downloaded from the
Active Plus studio (`js/lecture-sheet-pdf.js`):

  * A4 portrait, 15 mm side margins, brand green identity (#0e7a55)
  * page 1: logo + "Active Plus Coaching" + tagline, "লেকচার শিট" badge,
    title banner with class / subject / chapter / topic pills
  * later pages: running head (title • subject) with hairline rule
  * footer: brand line + "পৃষ্ঠা X / Y" in Bangla numerals
  * centred rotated logo watermark at ~8% opacity

Text stays real, selectable vector text: Bangla যুক্তাক্ষর is shaped through
HarfBuzz (fpdf2 text shaping) and every paragraph is wrapped here — line by
line — because fpdf2's own `multi_cell` line breaker mis-renders a shaped
cluster that happens to end a wrapped line.

Note: Noto Sans Bengali draws ASCII 0-9 with Bengali numeral shapes, so the
build copies get their ten ASCII digit glyphs replaced by Latin ones; the
font asset inside the repo is never modified.
"""

from __future__ import annotations

import os
import re

from fpdf import FPDF
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
BUILD = os.path.join(REPO, 'build', 'lecture-sheet')
FONT_DIR = os.path.join(BUILD, 'fonts')
LOGO = os.path.join(REPO, 'assets', 'icons', 'logo-128.png')
LOGO_LARGE = os.path.join(REPO, 'assets', 'icons', 'app-logo.png')

# ---- Brand palette (css/course-hub.css + js/brand.js) -----------------------
GREEN = (14, 122, 85)
GREEN_DARK = (4, 120, 87)
GREEN_DEEP = (6, 95, 70)
GREEN_TINT = (236, 253, 245)
GREEN_BORDER = (167, 243, 208)
GREEN_SOFT = (238, 246, 242)
INK = (15, 23, 42)
BODY = (17, 24, 39)
MUTED = (71, 85, 105)
FAINT = (100, 116, 139)
LINE = (226, 232, 240)
LINE_STRONG = (203, 213, 225)
PAPER_TINT = (248, 250, 252)
AMBER_TINT = (255, 251, 235)
AMBER_BORDER = (253, 230, 138)
AMBER_INK = (146, 64, 14)
BLUE_TINT = (239, 246, 255)
BLUE_BORDER = (191, 219, 254)
BLUE_INK = (30, 64, 175)

PAGE_W = 210.0
PAGE_H = 297.0
MARGIN = 15.0
CONTENT_W = PAGE_W - 2 * MARGIN
BODY_BOTTOM = 273.0
BODY_TOP_RUNNING = 23.5

BRAND_NAME = 'Active Plus Coaching'
BRAND_TAGLINE = 'শিখতে থাকো, এগিয়ে যাও'

BN_DIGITS = '০১২৩৪৫৬৭৮৯'


def bn(value) -> str:
    return ''.join(BN_DIGITS[int(ch)] if ch.isdigit() else ch for ch in str(value))


def prepare_fonts() -> None:
    if os.path.isdir(FONT_DIR) and len(os.listdir(FONT_DIR)) >= 3:
        return
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    os.makedirs(FONT_DIR, exist_ok=True)
    source = os.path.join(REPO, 'assets', 'fonts', 'NotoSansBengali-Variable.ttf')
    for weight, name in ((400, 'Regular'), (600, 'SemiBold'), (700, 'Bold')):
        font = TTFont(source)
        font = instantiateVariableFont(font, {'wght': weight, 'wdth': 100}, updateFontNames=True)
        for tag in ('gvar', 'HVAR', 'VVAR', 'MVAR', 'avar', 'fvar'):
            if tag in font:
                del font[tag]
        target = os.path.join(FONT_DIR, f'NotoSansBengali-{name}.ttf')
        font.save(target)
        _patch_ascii_digits(target, bold=(weight >= 700))


def _patch_ascii_digits(path: str, bold: bool = False) -> None:
    """Give ASCII 0-9 Latin shapes so English figures read as English."""
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib import TTFont

    latin_path = ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold
                  else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    if not os.path.exists(latin_path):
        return
    bengali = TTFont(path)
    latin = TTFont(latin_path, fontNumber=0)
    scale = bengali['head'].unitsPerEm / latin['head'].unitsPerEm
    latin_cmap = latin.getBestCmap()
    latin_set = latin.getGlyphSet()
    bengali_cmap = bengali.getBestCmap()
    for digit in '0123456789':
        src_name = latin_cmap.get(ord(digit))
        dst_name = bengali_cmap.get(ord(digit))
        if not src_name or not dst_name:
            continue
        pen = TTGlyphPen(bengali.getGlyphSet())
        latin_set[src_name].draw(TransformPen(pen, (scale, 0, 0, scale, 0, 0)))
        glyph = pen.glyph()
        bengali['glyf'][dst_name] = glyph
        bengali['hmtx'][dst_name] = (
            int(round(latin['hmtx'][src_name][0] * scale)),
            getattr(glyph, 'xMin', 0) or 0,
        )
    bengali.save(path)


def prepare_watermark() -> str:
    """Rotated brand mark with luminance-derived alpha (no grey box edges)."""
    target = os.path.join(BUILD, 'watermark-v2.png')
    if os.path.exists(target):
        return target
    os.makedirs(BUILD, exist_ok=True)
    logo = Image.open(LOGO_LARGE).convert('RGB')
    from PIL import ImageOps
    mask = ImageOps.invert(logo.convert('L'))
    logo.putalpha(mask)
    rotated = logo.rotate(30, expand=True, resample=Image.BICUBIC)
    rotated.putalpha(rotated.split()[3].point(lambda v: int(v * 0.115)))
    rotated.save(target)
    return target


_RUN_SPLIT = re.compile(r'(\s+)')


class LectureSheet(FPDF):
    """Flow-based A4 writer with the Active Plus lecture-sheet furniture."""

    def __init__(self, record: dict, total_pages: int | None = None):
        super().__init__(orientation='P', unit='mm', format='A4')
        self.record = record
        self.total_pages = total_pages
        self.set_margins(MARGIN, 12, MARGIN)
        self.set_auto_page_break(False)
        self.set_text_shaping(True)
        self.add_font('BN', '', os.path.join(FONT_DIR, 'NotoSansBengali-Regular.ttf'))
        self.add_font('BN', 'B', os.path.join(FONT_DIR, 'NotoSansBengali-Bold.ttf'))
        self.watermark = prepare_watermark()

    # ------------------------------------------------------------------ text
    def _font(self, size, bold=False):
        self.set_font('BN', 'B' if bold else '', size)

    def tw(self, text, size, bold=False) -> float:
        self._font(size, bold)
        return self.get_string_width(text)

    @staticmethod
    def runs(text, bold=False):
        """Split `**bold**` markdown into (chunk, is_bold) runs."""
        parts = str(text).split('**')
        return [(part, bold or (idx % 2 == 1)) for idx, part in enumerate(parts) if part]

    def wrap_runs(self, runs, width, size):
        """Greedy word wrap across styled runs; returns lines of runs."""
        tokens = []
        for text, bold in runs:
            for piece in _RUN_SPLIT.split(text):
                if piece:
                    tokens.append((piece, bold, piece.isspace()))

        lines = [[]]
        line_w = 0.0
        for token, bold, is_space in tokens:
            tw = self.tw(token, size, bold)
            has_content = any(not tok[0].isspace() for tok in lines[-1])
            if not is_space and has_content and line_w + tw > width:
                while lines[-1] and lines[-1][-1][0].isspace():
                    line_w -= self.tw(lines[-1][-1][0], size, lines[-1][-1][1])
                    lines[-1].pop()
                lines.append([])
                line_w = 0.0
            lines[-1].append((token, bold))
            line_w += tw

        out = []
        for line in lines:
            merged = []
            for token, bold in line:
                if merged and merged[-1][1] == bold:
                    merged[-1] = (merged[-1][0] + token, bold)
                else:
                    merged.append((token, bold))
            while merged and merged[-1][0].rstrip() == '':
                merged.pop()
            if merged:
                merged[-1] = (merged[-1][0].rstrip(), merged[-1][1])
            line_runs = [(text, bold) for text, bold in merged if text]
            if line_runs:
                out.append(line_runs)
        return out or [[('', False)]]

    def wrapped(self, text, width, size, bold=False):
        return self.wrap_runs(self.runs(text, bold), width, size)

    def measure_line(self, line, size) -> float:
        return sum(self.tw(text, size, bold) for text, bold in line)

    def draw_line(self, line, x, y, width, line_h, size, color, align='L'):
        lw = self.measure_line(line, size)
        cx = x
        if align in ('C', 'J'):
            cx = x + max(0.0, (width - lw) / 2)
        elif align == 'R':
            cx = x + max(0.0, width - lw)
        for text, bold in line:
            w = self.tw(text, size, bold)
            self._font(size, bold)
            self.set_text_color(*color)
            self.set_xy(cx, y)
            self.cell(w, line_h, text, align='L')
            cx += w
        return y + line_h

    def draw_lines(self, lines, x, y, width, line_h, size, color, align='L'):
        for line in lines:
            y = self.draw_line(line, x, y, width, line_h, size, color, align)
        return y

    def block_height(self, lines, line_h) -> float:
        return len(lines) * line_h

    # -- page furniture -----------------------------------------------------
    def header(self):
        self.image(self.watermark, x=(PAGE_W - 122) / 2, y=(PAGE_H - 122) / 2, w=122)
        if self.page_no() == 1:
            self._first_header()
        else:
            self._running_header()

    def footer(self):
        self.set_draw_color(*LINE)
        self.set_line_width(0.2)
        self.line(MARGIN, 281.5, PAGE_W - MARGIN, 281.5)
        self._font(7.6)
        self.set_text_color(*FAINT)
        self.set_xy(MARGIN, 282.4)
        self.cell(120, 4.6, f'{BRAND_NAME}  •  {BRAND_TAGLINE}', align='L')
        label = (f'পৃষ্ঠা {bn(self.page_no())} / {bn(self.total_pages)}'
                 if self.total_pages else f'পৃষ্ঠা {bn(self.page_no())}')
        self.set_xy(PAGE_W - MARGIN - 60, 282.4)
        self.cell(60, 4.6, label, align='R')

    def _first_header(self):
        top = 9.5
        self.image(LOGO, x=MARGIN, y=top, w=10.5)
        self.set_xy(MARGIN + 13.5, top - 1.0)
        self._font(12.6, True)
        self.set_text_color(*GREEN)
        self.cell(90, 6.4, BRAND_NAME, align='L')
        self.set_xy(MARGIN + 13.5, top + 4.6)
        self._font(8.0)
        self.set_text_color(*MUTED)
        self.cell(90, 4.6, BRAND_TAGLINE, align='L')

        badge_w, badge_h = 26.0, 6.6
        bx = PAGE_W - MARGIN - badge_w
        self.set_fill_color(*GREEN_TINT)
        self.set_draw_color(*GREEN_BORDER)
        self.set_line_width(0.25)
        self.rect(bx, top + 1.6, badge_w, badge_h, style='DF', round_corners=True, corner_radius=3)
        self.set_xy(bx, top + 1.75)
        self._font(8.0, True)
        self.set_text_color(*GREEN_DARK)
        self.cell(badge_w, 6.3, 'লেকচার শিট', align='C')

        self.set_draw_color(*GREEN)
        self.set_line_width(0.45)
        self.line(MARGIN, top + 12.4, PAGE_W - MARGIN, top + 12.4)

        # Title banner
        body_w = CONTENT_W - 12
        title_lines = self.wrapped(self.record['title'], body_w, 13.4, bold=True)
        sub_lines = self.wrapped(self.record['subtitle'], body_w, 8.2) if self.record.get('subtitle') else []
        pills = self.record.get('pills') or []
        pill_rows = self._pill_rows(pills, body_w)

        banner_h = 3.6 + len(title_lines) * 7.6 + 1.4
        if sub_lines:
            banner_h += len(sub_lines) * 4.9 + 0.6
        if pill_rows:
            banner_h += len(pill_rows) * 6.4 + 1.6

        banner_y = 23.4
        self.set_fill_color(*PAPER_TINT)
        self.set_draw_color(*LINE_STRONG)
        self.set_line_width(0.25)
        self.rect(MARGIN, banner_y, CONTENT_W, banner_h, style='DF')

        y = banner_y + 3.8
        y = self.draw_lines(title_lines, MARGIN + 6, y, body_w, 7.6, 13.4, INK)
        if sub_lines:
            y = self.draw_lines(sub_lines, MARGIN + 6, y + 0.6, body_w, 4.9, 8.2, MUTED)
        if pill_rows:
            y += 1.6
            self._draw_pill_rows(pill_rows, MARGIN + 6, y)
        self.set_y(banner_y + banner_h + 3.8)

    def _pill_rows(self, pills, max_w):
        rows, current, current_w = [], [], 0.0
        for pill in pills:
            w = self.tw(pill, 7.6) + 6.4
            if current and current_w + w > max_w:
                rows.append(current)
                current, current_w = [], 0.0
            current.append((pill, w))
            current_w += w + 2.6
        if current:
            rows.append(current)
        return rows

    def _draw_pill_rows(self, rows, x, y):
        for row in rows:
            cx = x
            for pill, w in row:
                self.set_fill_color(255, 255, 255)
                self.set_draw_color(*LINE_STRONG)
                self.set_line_width(0.2)
                self.rect(cx, y, w, 5.6, style='DF', round_corners=True, corner_radius=2.8)
                self.set_xy(cx, y + 0.15)
                self._font(7.6)
                self.set_text_color(51, 65, 85)
                self.cell(w, 5.3, pill, align='C')
                cx += w + 2.6
            y += 6.4

    def _running_header(self):
        self._font(8.0, True)
        self.set_text_color(*MUTED)
        self.set_xy(MARGIN, 12.4)
        left = (self.record.get('header_text') or self.record['title'])[:70]
        self.cell(105, 5, left, align='L')
        self._font(8.0)
        self.set_xy(PAGE_W - MARGIN - 78, 12.4)
        self.cell(78, 5, self.record.get('header_right', ''), align='R')
        self.set_draw_color(*LINE)
        self.set_line_width(0.2)
        self.line(MARGIN, 17.6, PAGE_W - MARGIN, 17.6)
        self.set_y(BODY_TOP_RUNNING)

    # -- flow helpers -------------------------------------------------------
    def remaining(self) -> float:
        return BODY_BOTTOM - self.get_y()

    def need(self, height: float):
        if self.remaining() < height:
            self.add_page()

    def gap(self, height: float):
        self.set_y(min(self.get_y() + height, BODY_BOTTOM))

    def para(self, text, size=9.4, line_h=5.05, color=BODY, indent=0.0,
             space_after=2.2, bold=False, align='L'):
        width = CONTENT_W - indent
        lines = self.wrapped(text, width, size, bold)
        h = self.block_height(lines, line_h)
        self.need(h + 1)
        y = self.get_y()
        self.draw_lines(lines, MARGIN + indent, y, width, line_h, size, color, align)
        self.set_y(y + h + space_after)

    def bullet_list(self, items, size=8.9, line_h=4.75, color=BODY, indent=3.0,
                    marker_color=GREEN, space_after=0.9):
        marker_w = 4.6
        width = CONTENT_W - indent - marker_w
        for item in items:
            lines = self.wrapped(item, width, size)
            h = self.block_height(lines, line_h)
            self.need(h + 0.6)
            y = self.get_y()
            self.set_fill_color(*marker_color)
            self.ellipse(MARGIN + indent + 0.9, y + 1.85, 1.5, 1.5, style='F')
            self.draw_lines(lines, MARGIN + indent + marker_w, y, width, line_h, size, color)
            self.set_y(y + h + space_after)
        self.gap(1.2)

    # -- blocks -------------------------------------------------------------
    def h2(self, number, title_bn, title_en=''):
        self.need(9.0 + 42)
        self.gap(1.6)
        y = self.get_y()
        self.set_fill_color(*GREEN)
        self.rect(MARGIN, y, 8.2, 8.2, style='F', round_corners=True, corner_radius=2)
        self.set_xy(MARGIN, y + 0.75)
        self._font(10.2, True)
        self.set_text_color(255, 255, 255)
        self.cell(8.2, 6.6, bn(str(number)), align='C')

        self.set_xy(MARGIN + 10.6, y + 0.9)
        self._font(12.2, True)
        self.set_text_color(*GREEN_DEEP)
        title_w = self.tw(title_bn, 12.2, True)
        self.cell(title_w + 1.5, 6.6, title_bn, align='L')
        if title_en:
            self._font(8.2)
            self.set_text_color(*FAINT)
            self.set_xy(MARGIN + 10.6 + title_w + 2.6, y + 2.4)
            self.cell(0, 4.6, title_en, align='L')
        self.set_y(y + 9.2)
        self.set_draw_color(209, 250, 229)
        self.set_line_width(0.3)
        self.line(MARGIN + 10.6, y + 9.42, PAGE_W - MARGIN, y + 9.42)
        self.gap(2.0)

    def h3(self, text, size=10.2):
        lines = self.wrapped(text, CONTENT_W - 4, size, bold=True)
        h = self.block_height(lines, 5.6)
        self.need(h + 28)
        y = self.get_y()
        self.draw_lines(lines, MARGIN, y, CONTENT_W - 4, 5.6, size, GREEN_DEEP)
        self.set_y(y + h + 1.4)

    def _box_lines(self, lines, body_w, size, line_h):
        """Pre-wrap every entry of a box and return (entries, total height)."""
        prepared = []
        total = 0.0
        for line in lines:
            kind = line[0] if isinstance(line, tuple) else 'p'
            text = line[1] if isinstance(line, tuple) else line
            width = body_w - 3.0 if kind == 'b' else body_w
            wrapped = self.wrapped(text, width, size)
            h = self.block_height(wrapped, line_h)
            prepared.append((kind, wrapped, h))
            total += h + (0.9 if kind == 'b' else 1.4)
        return prepared, total

    def box(self, lines, title='', variant='green', size=8.9, line_h=4.85, space_after=2.4):
        palette = {
            'green': (GREEN_TINT, GREEN_BORDER, GREEN_DEEP),
            'amber': (AMBER_TINT, AMBER_BORDER, AMBER_INK),
            'blue': (BLUE_TINT, BLUE_BORDER, BLUE_INK),
            'paper': (PAPER_TINT, LINE_STRONG, INK),
        }[variant]
        fill, border, accent = palette
        pad = 3.4
        body_w = CONTENT_W - pad * 2
        title_lines = self.wrapped(title, body_w, size + 0.5, bold=True) if title else []
        prepared, inner_h = self._box_lines(lines, body_w, size, line_h)
        title_h = len(title_lines) * 5.4 + 1.2 if title_lines else 0.0
        h = pad * 2 + title_h + inner_h + 1.0
        h = min(h, BODY_BOTTOM - BODY_TOP_RUNNING)
        self.need(h + 1.5)
        y0 = self.get_y()
        self.set_fill_color(*fill)
        self.set_draw_color(*border)
        self.set_line_width(0.3)
        self.rect(MARGIN, y0, CONTENT_W, h, style='DF', round_corners=True, corner_radius=2.2)
        self.set_fill_color(*accent)
        self.rect(MARGIN, y0 + 1.2, 0.9, h - 2.4, style='F')

        y = y0 + pad - 0.4
        if title_lines:
            y = self.draw_lines(title_lines, MARGIN + pad, y, body_w, 5.4, size + 0.5, accent)
            y += 1.2
        for kind, wrapped, block_h in prepared:
            if kind == 'b':
                self._font(size)
                self.set_text_color(*accent)
                self.set_xy(MARGIN + pad + 1.2, y)
                self.cell(2.4, line_h, '•', align='L')
                self.draw_lines(wrapped, MARGIN + pad + 3.0, y, body_w - 3.0, line_h, size, BODY)
                y += block_h + 0.9
            else:
                self.draw_lines(wrapped, MARGIN + pad, y, body_w, line_h, size, BODY)
                y += block_h + 1.4
        self.set_y(y0 + h + space_after)

    def rule(self, label, text, size=9.2):
        self.para(f'**{label}**  {text}', size=size, line_h=4.95, indent=1.5, space_after=1.6)

    def table(self, head, rows, widths, size=8.6, head_size=8.6, line_h=4.6,
              space_after=3.2, first_col_bold=False):
        """Bordered table: kept whole when it fits a page, otherwise split by row
        with the header row repeated and no single-row widow on the last page."""
        col_ws = [CONTENT_W * w for w in widths]
        pad_x, pad_y = 2.4, 1.9

        def measure(cells, bold=False):
            out, tallest = [], 0.0
            for cw, cell in zip(col_ws, cells):
                wrapped = self.wrapped(cell, cw - pad_x * 2, size, bold)
                block_h = self.block_height(wrapped, line_h)
                out.append((wrapped, block_h))
                tallest = max(tallest, block_h)
            return out, tallest + pad_y * 2

        head_cells, head_h = measure(head, True) if head else ([], 0.0)
        body_rows = [measure(row) for row in rows]
        page_space = BODY_BOTTOM - BODY_TOP_RUNNING
        total_h = head_h + sum(row[1] for row in body_rows)

        if total_h <= page_space and self.get_y() + total_h > BODY_BOTTOM:
            self.add_page()

        def draw_header(y):
            self.set_fill_color(*GREEN_SOFT)
            self.rect(MARGIN, y, CONTENT_W, head_h, style='F')
            xx = MARGIN
            for cw, (wrapped, _) in zip(col_ws, head_cells):
                self.set_draw_color(120, 145, 160)
                self.rect(xx, y, cw, head_h, style='D')
                self.draw_lines(wrapped, xx + pad_x, y + pad_y, cw - pad_x * 2, line_h,
                                head_size, GREEN_DEEP)
                xx += cw
            return y + head_h

        index = 0
        while index < len(body_rows):
            y = self.get_y()
            if head:
                if y + head_h + body_rows[index][1] > BODY_BOTTOM:
                    self.add_page()
                    continue
                y = draw_header(y)

            fit = 0
            used = y
            while index + fit < len(body_rows) and used + body_rows[index + fit][1] <= BODY_BOTTOM:
                used += body_rows[index + fit][1]
                fit += 1
            if fit == 0:
                self.add_page()
                continue
            if len(body_rows) - index - fit == 1 and fit > 1:
                fit -= 1

            yy = y
            for offset in range(fit):
                cells, row_h = body_rows[index + offset]
                if (index + offset) % 2 == 1:
                    self.set_fill_color(252, 253, 254)
                    self.rect(MARGIN, yy, CONTENT_W, row_h, style='F')
                xx = MARGIN
                for ci, (cw, (wrapped, _)) in enumerate(zip(col_ws, cells)):
                    self.set_draw_color(148, 163, 184)
                    self.rect(xx, yy, cw, row_h, style='D')
                    bold = ci == 0 and first_col_bold
                    self.draw_lines(wrapped, xx + pad_x, yy + pad_y, cw - pad_x * 2,
                                    line_h, size, INK if bold else BODY)
                    xx += cw
                yy += row_h
            index += fit
            if index < len(body_rows):
                self.add_page()
            else:
                self.set_y(yy + space_after)

    def examples(self, items, size=8.85, line_h=4.55, space_between=2.4):
        width = CONTENT_W - 4.0
        why_width = CONTENT_W - 9.0
        for item in items:
            d_lines = self.wrapped('**Direct:**  ' + item['d'], width, size)
            i_lines = self.wrapped('**Indirect:**  ' + item['i'], width, size)
            why = item.get('why', '')
            w_lines = self.wrapped(why, why_width, size - 0.5) if why else []
            h = (self.block_height(d_lines, line_h) + self.block_height(i_lines, line_h)
                 + self.block_height(w_lines, line_h - 0.15) + 2.2)
            self.need(h)
            y = self.get_y()
            y = self.draw_lines(d_lines, MARGIN + 1.6, y, width, line_h, size, MUTED)
            y = self.draw_lines(i_lines, MARGIN + 1.6, y, width, line_h, size, GREEN_DEEP)
            if w_lines:
                self.draw_lines(w_lines, MARGIN + 4.6, y + 0.15, why_width, line_h - 0.15,
                                size - 0.5, (88, 102, 122))
                y += self.block_height(w_lines, line_h - 0.15)
            self.set_y(y + space_between)

    def numbered_box(self, items, title='', size=8.85, line_h=4.7, variant='paper'):
        """Practice list / answer key with Bangla numerals.

        Uses two columns for short items and splits across pages at row
        boundaries (repeating the box chrome) instead of leaving a big hole.
        """
        num_w = 6.0
        two_col = len(items) > 6 and max(len(i) for i in items) < 90
        col_gap = 5.0
        col_w = (CONTENT_W - 6.8) if not two_col else (CONTENT_W - 6.8 - col_gap) / 2
        text_w = col_w - num_w

        entries = []
        for idx, item in enumerate(items, 1):
            wrapped = self.wrapped(item, text_w, size)
            entries.append((idx, wrapped, self.block_height(wrapped, line_h)))

        if two_col:
            half = (len(entries) + 1) // 2
            left, right = entries[:half], entries[half:]
            rows = []
            for i in range(max(len(left), len(right))):
                lcell = left[i] if i < len(left) else None
                rcell = right[i] if i < len(right) else None
                rows.append((lcell, rcell,
                             max(lcell[2] if lcell else 0.0, rcell[2] if rcell else 0.0) + 1.05))
        else:
            rows = [(entry, None, entry[2] + 1.05) for entry in entries]

        fill, border = {
            'paper': ((255, 255, 255), LINE_STRONG),
            'green': (GREEN_TINT, GREEN_BORDER),
            'amber': (AMBER_TINT, AMBER_BORDER),
        }[variant]
        accent = AMBER_INK if variant == 'amber' else GREEN_DEEP

        title_lines = self.wrapped(title, CONTENT_W - 6.4, size + 0.45, bold=True) if title else []
        title_h = len(title_lines) * 5.2 + 1.4 if title_lines else 0.0

        index = 0
        first_fragment = True
        while index < len(rows):
            y_top = self.get_y()
            head_h = title_h if first_fragment else 0.0
            available = BODY_BOTTOM - y_top - head_h - 4.6
            fit, used = 0, 0.0
            while index + fit < len(rows) and used + rows[index + fit][2] <= available:
                used += rows[index + fit][2]
                fit += 1
            if fit == 0:
                self.add_page()
                continue
            if len(rows) - index - fit == 1 and fit > 1:
                fit -= 1

            box_h = head_h + used + 4.6
            self.set_fill_color(*fill)
            self.set_draw_color(*border)
            self.set_line_width(0.28)
            self.rect(MARGIN, y_top, CONTENT_W, box_h, style='DF',
                      round_corners=True, corner_radius=2.2)
            y = y_top + 2.8
            if first_fragment and title_lines:
                y = self.draw_lines(title_lines, MARGIN + 3.2, y, CONTENT_W - 6.4, 5.2,
                                    size + 0.45, accent)
                y += 1.4

            for offset in range(fit):
                left_cell, right_cell, row_h = rows[index + offset]
                for cidx, cell in enumerate((left_cell, right_cell)):
                    if not cell:
                        continue
                    idx_no, wrapped, _ = cell
                    cx = MARGIN + 3.2 + cidx * (col_w + col_gap)
                    self.draw_lines([[(f'{bn(idx_no)}.', True)]], cx, y, num_w, line_h,
                                    size, GREEN_DARK)
                    self.draw_lines(wrapped, cx + num_w, y, text_w, line_h, size, BODY)
                y += row_h

            index += fit
            first_fragment = False
            if index < len(rows):
                self.add_page()
            else:
                self.set_y(y_top + box_h + 3.2)

    def notes_panel(self, title='আমার নোট', rows=None, gap=10.2,
                    hint='নিজের ভাষায় নিয়মগুলো লিখে রাখুন — লিখলে মনে থাকে'):
        title_lines = self.wrapped(title, CONTENT_W - 10, 9.6, bold=True)
        hint_lines = self.wrapped(hint, CONTENT_W - 10, 7.8) if hint else []
        head_h = len(title_lines) * 5.6 + len(hint_lines) * 4.6 + 3.0
        available = BODY_BOTTOM - self.get_y() - 26.0
        if rows is None:
            rows = max(6, int((available - head_h - 3.0) // gap))
        h = head_h + rows * gap + 3.0
        self.need(h + 2)
        y0 = self.get_y()
        self.set_fill_color(252, 253, 254)
        self.set_draw_color(*LINE_STRONG)
        self.set_line_width(0.28)
        self.rect(MARGIN, y0, CONTENT_W, h, style='DF', round_corners=True, corner_radius=2.2)
        y = y0 + 3.2
        y = self.draw_lines(title_lines, MARGIN + 4.0, y, CONTENT_W - 10, 5.6, 9.6, GREEN_DEEP)
        if hint_lines:
            y = self.draw_lines(hint_lines, MARGIN + 4.0, y + 0.4, CONTENT_W - 10, 4.6, 7.8, FAINT)
        y += 2.0
        self.set_draw_color(199, 210, 222)
        self.set_line_width(0.28)
        self.set_dash_pattern(dash=1.1, gap=1.7)
        for _ in range(rows):
            y += gap
            self.line(MARGIN + 4.0, y, PAGE_W - MARGIN - 4.0, y)
        self.set_dash_pattern()
        self.set_y(y0 + h + 3.0)

    def page_break(self):
        self.add_page()
