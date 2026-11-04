# Generates the PWA icon set the install prompt reads, from the plate the desktop already ships.
#
# Provenance, not a resample of whatever is lying around: the one mark in this repository is
# `apps/desktop/src-tauri/icons/warsha-icon.png`, itself drawn in code by that directory's
# `make-source-icon.py` (#FFD60A on #0E0E0E — the design system's accent on its dark plate). This
# script only *reads* that file; nothing under `src-tauri/` is touched, so the desktop bundler's own
# set stays exactly as it was.
#
# It is a development tool, not a build step. The PNGs it writes into `public/icons/` are committed,
# because `pnpm --filter warsha-remote build` must not need Pillow: Vite copies `public/` verbatim, so
# the shipped `dist/` carries the icons whatever machine built it. Re-run this only when the mark
# changes:
#
#     python3 apps/remote/scripts/make-icons.py
#
# Two purposes, and they are not interchangeable:
#
#   * `any` — the plate keeps its rounded corners and its transparent field, because a browser that
#     does not mask shows the mark as drawn.
#   * `maskable` — a full-bleed square on the same #0E0E0E, because Android crops the whole canvas to
#     a circle/squircle and a transparent field would come out as a hole. The hex nut spans 64% x 74%
#     of the source, so it already sits inside the 80% safe zone a mask cannot reach; nothing is
#     scaled, which is why the mark cannot be pushed out of that zone by accident.
#
# `apple-touch-icon` is the iOS half: iOS ignores the manifest's icons and masks the tile itself, so
# it gets the full-bleed plate at 180x180 (iOS composites alpha onto black, which would show a
# ragged edge — opaque here, on purpose).
import struct
from pathlib import Path

from PIL import Image

SOURCE = Path(__file__).resolve().parents[3] / "apps/desktop/src-tauri/icons/warsha-icon.png"
OUT_DIR = Path(__file__).resolve().parent.parent / "public/icons"
BACKGROUND = (14, 14, 14, 255)

# name -> (edge length, maskable/full-bleed?)
#
# `favicon-32.png` is not part of installability — it is here because `index.html` carried no icon of its
# own, so every desktop tab asked the host for `/favicon.ico` and got a 404 next to the manifest's 404.
TARGETS: dict[str, tuple[int, bool]] = {
    "icon-192.png": (192, False),
    "icon-512.png": (512, False),
    "maskable-512.png": (512, True),
    "apple-touch-icon.png": (180, True),
    "favicon-32.png": (32, True),
}


def square(source: Image.Image, edge: int, full_bleed: bool) -> Image.Image:
    """The mark at `edge` x `edge`, on a transparent field or on its own plate colour."""
    if source.size[0] != source.size[1]:
        raise SystemExit(f"{SOURCE} is not square: {source.size}")
    canvas = Image.new("RGBA", (edge, edge), BACKGROUND if full_bleed else (0, 0, 0, 0))
    mark = source.resize((edge, edge), Image.LANCZOS)
    canvas.paste(mark, (0, 0), mark)
    return canvas


def png_size(path: Path) -> tuple[int, int]:
    """The IHDR dimensions, read back from the written file: a `sizes` entry the PNG disagrees with
    is an icon Chrome drops, so the script that writes the set is the wrong place to trust it."""
    with path.open("rb") as handle:
        header = handle.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise SystemExit(f"{path} is not a PNG")
    width, height = struct.unpack(">II", header[16:24])
    return int(width), int(height)


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing icon source: {SOURCE}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")

    for name, (edge, full_bleed) in TARGETS.items():
        target = OUT_DIR / name
        square(source, edge, full_bleed).save(target, "PNG")
        written = png_size(target)
        if written != (edge, edge):
            raise SystemExit(f"{target} is {written}, expected {edge}x{edge}")
        print(f"wrote {target.relative_to(OUT_DIR.parents[2])} {written[0]}x{written[1]}")


if __name__ == "__main__":
    main()
