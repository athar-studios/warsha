# Generates the 1024x1024 source PNG the Tauri icon set is derived from.
#
# `tauri icon` (the @tauri-apps/cli command) turns one square PNG into every size and
# format the bundle needs — 32x32.png, 128x128.png, 128x128@2x.png, icon.ico and
# icon.icns. The mark is drawn in code rather than shipped as a binary with no
# provenance: the accent is the design system's #FFD60A on #0E0E0E (packages/ui), and a
# hex nut is the workshop mark — no font is needed, so the icon cannot change shape
# because a glyph is missing from whatever font happens to be installed.
import math

from PIL import Image, ImageDraw

SIZE = 1024
BACKGROUND = (14, 14, 14, 255)
ACCENT = (255, 214, 10, 255)

# The nut's outer radius leaves the margin the Windows icon grid expects.
OUTER = 380
INNER = 150


def hexagon(cx: float, cy: float, radius: float, rotation: int = 0) -> list[tuple[float, float]]:
    """Six points of a regular hexagon, flat side up at `rotation == 0`."""
    return [
        (
            cx + radius * math.cos(math.radians(rotation + 60 * i)),
            cy + radius * math.sin(math.radians(rotation + 60 * i)),
        )
        for i in range(6)
    ]


def main() -> None:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # The rounded plate the mark sits on.
    draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=200, fill=BACKGROUND)
    # The nut.
    draw.polygon(hexagon(SIZE / 2, SIZE / 2, OUTER, rotation=30), fill=ACCENT)
    # The dark bore in its middle, so the plate shows through.
    draw.polygon(hexagon(SIZE / 2, SIZE / 2, INNER, rotation=30), fill=BACKGROUND)

    canvas.save("warsha-icon.png", "PNG")
    print(f"wrote warsha-icon.png ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
