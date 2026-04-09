from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from app.logging_utils import logger


class TelegramStatsRenderer:
    def __init__(self) -> None:
        self.width = 1100
        self.height = 700
        self.center_x = 250
        self.center_y = 365
        self.radius = 205
        self.legend_x = 505
        self.legend_width = 350
        self.amount_x = 880
        self.percent_x = 1020
        self.colors = [
            "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed",
            "#0891b2", "#db2777", "#65a30d", "#ea580c", "#475569",
        ]
        self.other_color = "#94a3b8"
        self.title_font = self._load_font(44, bold=True)
        self.subtitle_font = self._load_font(28)
        self.label_font = self._load_font(24, bold=True)
        self.small_font = self._load_font(22)
        self.center_font = self._load_font(34, bold=True)
        self.center_amount_font = self._load_font(28, bold=True)

    def render_category_breakdown(self, breakdown: dict, report_title: str) -> bytes:
        image = Image.new("RGB", (self.width, self.height), "#f8fafc")
        draw = ImageDraw.Draw(image)
        draw.text((48, 34), f"{report_title} за {breakdown['periodLabel'].lower()}", font=self.title_font, fill="#0f172a")
        draw.text((48, 92), f"Общая сумма: {self._format_money(breakdown['totalAmount'], breakdown['currency'])}", font=self.subtitle_font, fill="#475569")
        if not breakdown["items"]:
            draw.text((48, 180), "Нет данных для построения диаграммы", font=self.subtitle_font, fill="#334155")
            return self._to_png_bytes(image)

        bbox = (self.center_x - self.radius, self.center_y - self.radius, self.center_x + self.radius, self.center_y + self.radius)
        start_angle = -90.0
        legend_items: list[tuple[str, dict]] = []
        rank = 0
        for item in breakdown["items"]:
            color = self.other_color if item.get("isOther") else self.colors[rank % len(self.colors)]
            if not item.get("isOther"):
                rank += 1
            sweep = 360.0 * item["share"]
            draw.pieslice(bbox, start=start_angle, end=start_angle + sweep, fill=color)
            legend_items.append((color, item))
            start_angle += sweep

        inner_radius = int(self.radius * 0.54)
        inner_bbox = (self.center_x - inner_radius, self.center_y - inner_radius, self.center_x + inner_radius, self.center_y + inner_radius)
        draw.ellipse(inner_bbox, fill="#f8fafc")
        self._draw_centered_text(draw, self.center_x, self.center_y - 22, "Итого", self.center_font, "#0f172a")
        self._draw_centered_text(
            draw,
            self.center_x,
            self.center_y + 22,
            self._format_money(breakdown["totalAmount"], breakdown["currency"]),
            self.center_amount_font,
            "#0f172a",
        )

        draw.text((self.legend_x, 146), "Категории", font=self.label_font, fill="#0f172a")
        legend_top = 204
        if len(legend_items) <= 3:
            line_height = 78
        elif len(legend_items) <= 5:
            line_height = 66
        else:
            line_height = min(64, max(48, int((self.height - 250) / max(len(legend_items), 1))))
        for index, (color, item) in enumerate(legend_items):
            top = legend_top + index * line_height
            marker_size = 24 if item.get("isOther") else 28
            marker_top = top - marker_size + 4
            draw.rectangle(
                (self.legend_x, marker_top, self.legend_x + marker_size, marker_top + marker_size),
                fill=color,
                outline="#cbd5e1" if item.get("isOther") else color,
            )
            label = "Прочее" if item.get("isOther") else f"#{index + 1} {item['categoryName']}"
            label_font = self.label_font if not item.get("isOther") else self.small_font
            draw.text(
                (self.legend_x + 42, top - 4),
                self._ellipsize(draw, label, self.legend_width, label_font),
                font=label_font,
                fill="#0f172a",
            )
            amount_text = self._format_money(item["amount"], breakdown["currency"])
            percent_text = f"{(item['share'] * 100):.1f}%"
            draw.text((self.amount_x, top - 4), amount_text, font=self.small_font, fill="#334155")
            draw.text((self.percent_x, top - 4), percent_text, font=self.small_font, fill="#64748b" if item.get("isOther") else "#475569")

        return self._to_png_bytes(image)

    def _to_png_bytes(self, image: Image.Image) -> bytes:
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    def _format_money(self, value: float, currency: str) -> str:
        formatted = f"{value:,.2f}".replace(",", " ").replace(".", ",")
        return f"{formatted} {currency}"

    def _resolve_font_path(self, *, bold: bool = False) -> str | None:
        candidates = [
            "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/TTF/DejaVuSans.ttf",
        ]
        for candidate in candidates:
            if Path(candidate).exists():
                return candidate
        return None

    def _load_font(self, size: int, *, bold: bool = False) -> ImageFont.ImageFont:
        font_path = self._resolve_font_path(bold=bold)
        if font_path:
            return ImageFont.truetype(font_path, size=size)
        logger.warn(
            "telegram",
            "stats_font_fallback",
            "Telegram stats renderer fell back to default font",
            {"bold": bold, "size": size},
        )
        return ImageFont.load_default()

    def _ellipsize(self, draw: ImageDraw.ImageDraw, text: str, max_width: int, font: ImageFont.ImageFont) -> str:
        if draw.textlength(text, font=font) <= max_width:
            return text
        value = text
        while len(value) > 1 and draw.textlength(f"{value}...", font=font) > max_width:
            value = value[:-1]
        return f"{value}..."

    def _draw_centered_text(
        self,
        draw: ImageDraw.ImageDraw,
        center_x: int,
        center_y: int,
        text: str,
        font: ImageFont.ImageFont,
        fill: str,
    ) -> None:
        bbox = draw.textbbox((0, 0), text, font=font)
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        draw.text((center_x - width / 2, center_y - height / 2), text, font=font, fill=fill)
