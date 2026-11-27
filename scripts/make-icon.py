"""Builds Arete's icon files from the SVG sources in build/.

The icon is an arrow in the centre of a target: Aristotle's image of living
well as an archer aiming at the mark, the right amount, neither too much nor
too little.

  build/icon.svg        full design, used for 40 px and up
  build/icon-small.svg  fewer, thicker rings, used for 16-32 px (taskbar)

Writes build/icon.png (512 px), build/icon.ico (every Windows size) and the
sidebar logo in src/renderer/src/assets/icon.png. Needs rsvg-convert
(librsvg) and Pillow:

    python scripts/make-icon.py
"""
import io
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'build'
SMALL_MAX = 32


def render(svg: Path, size: int) -> Image.Image:
    png = subprocess.run(
        ['rsvg-convert', '-w', str(size), '-h', str(size), str(svg)], check=True, capture_output=True
    ).stdout
    return Image.open(io.BytesIO(png)).convert('RGBA')


def main() -> None:
    full, small = BUILD / 'icon.svg', BUILD / 'icon-small.svg'
    render(full, 512).save(BUILD / 'icon.png')
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = {s: render(small if s <= SMALL_MAX else full, s) for s in sizes}
    frames[256].save(BUILD / 'icon.ico', sizes=[(s, s) for s in sizes], append_images=[frames[s] for s in sizes[:-1]])
    render(full, 96).save(ROOT / 'src' / 'renderer' / 'src' / 'assets' / 'icon.png')
    print('wrote build/icon.png, build/icon.ico and the sidebar logo')


if __name__ == '__main__':
    main()
