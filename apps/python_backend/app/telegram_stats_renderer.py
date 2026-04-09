from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


class TelegramStatsRenderer:
    def __init__(self) -> None:
        self.width = 1200
        self.height = 760
        self.center_x = 290
        self.center_y = 380
        self.radius = 190
        self.colors = [
            "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed",
            "#0891b2", "#db2777", "#65a30d", "#ea580c", "#475569",
        ]
        self.other_color = "#94a3b8"
        self.title_font = self._load_font(38, bold=True)
        self.subtitle_font = self._load_font(24)
        self.label_font = self._load_font(20, bold=True)
        self.small_font = self._load_font(18)
        self.center_font = self._load_font(28, bold=True)

    def render_category_breakdown(self, breakdown: dict, report_title: str) -> bytes:
        image = Image.new("RGB", (self.width, self.height), "#f8fafc")
        draw = ImageDraw.Draw(image)
        draw.text((60, 45), f"{report_title} за {breakdown['periodLabel'].lower()}", font=self.title_font, fill="#0f172a")
        draw.text((60, 95), f"Общая сумма: {self._format_money(breakdown['totalAmount'], breakdown['currency'])}", font=self.subtitle_font, fill="#475569")
        if not breakdown["items"]:
            draw.text((60, 180), "Нет данных для построения диаграммы", font=self.subtitle_font, fill="#334155")
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
        draw.text((self.center_x - 34, self.center_y - 24), "Итого", font=self.center_font, fill="#0f172a")
        draw.text((self.center_x - 78, self.center_y + 10), self._format_money(breakdown["totalAmount"], breakdown["currency"]), font=self.small_font, fill="#0f172a")

        draw.text((560, 150), "Категории", font=self.label_font, fill="#0f172a")
        legend_top = 210
        line_height = min(58, max(42, int((self.height - 270) / max(len(legend_items), 1))))
        for index, (color, item) in enumerate(legend_items):
            top = legend_top + index * line_height
            marker_size = 20 if item.get("isOther") else 24
            draw.rectangle((560, top - 19, 560 + marker_size, top - 19 + marker_size), fill=color, outline="#cbd5e1" if item.get("isOther") else color)
            label = "Прочее" if item.get("isOther") else f"#{index + 1} {item['categoryName']}"
            draw.text((600, top - 4), self._ellipsize(draw, label, 300, self.label_font if not item.get("isOther") else self.small_font), font=self.label_font if not item.get("isOther") else self.small_font, fill="#0f172a")
            amount_text = self._format_money(item["amount"], breakdown["currency"])
            percent_text = f"{(item['share'] * 100):.1f}%"
            draw.text((900, top - 4), amount_text, font=self.small_font, fill="#334155")
            draw.text((1080, top - 4), percent_text, font=self.small_font, fill="#64748b" if item.get("isOther") else "#475569")

        return self._to_png_bytes(image)

    def _to_png_bytes(self, image: Image.Image) -> bytes:
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    def _format_money(self, value: float, currency: str) -> str:
        formatted = f"{value:,.2f}".replace(",", " ").replace(".", ",")
        return f"{formatted} {currency}"

    def _load_font(self, size: int, *, bold: bool = False) -> ImageFont.ImageFont:
        candidates = [
            "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/TTF/DejaVuSans.ttf",
        ]
        for candidate in candidates:
            if Path(candidate).exists():
                return ImageFont.truetype(candidate, size=size)
        return ImageFont.load_default()

    def _ellipsize(self, draw: ImageDraw.ImageDraw, text: str, max_width: int, font: ImageFont.ImageFont) -> str:
        if draw.textlength(text, font=font) <= max_width:
            return text
        value = text
        while len(value) > 1 and draw.textlength(f"{value}...", font=font) > max_width:
            value = value[:-1]
        return f"{value}..."
