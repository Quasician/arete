"""Draws Arete's icon: a gold laurel wreath (the victor's crown of the Greek
games, the classic emblem of arete) around a star, on a night-sky tile.

Writes build/icon.png (512px) and build/icon.ico with every Windows size,
each drawn separately so the small taskbar sizes stay crisp.

    python scripts/make-icon.py [variant]   # variant: star (default) | alpha
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
NAVY_TOP = (22, 32, 68)
NAVY_BOTTOM = (9, 13, 28)
GOLD = (242, 200, 107)
GOLD_LIGHT = (255, 229, 160)
GOLD_DARK = (196, 150, 62)


def tile(size: int) -> Image.Image:
    """Rounded night-sky square with a faint glow at the top."""
    img = Image.new('RGBA', (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        c = tuple(int(NAVY_TOP[i] * (1 - t) + NAVY_BOTTOM[i] * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c + (255,))
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([size * 0.2, -size * 0.25, size * 0.8, size * 0.35], fill=(122, 167, 255, 60))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(size * 0.08)))
    mask = Image.new('L', (size, size), 0)
    inset = size * 0.04
    ImageDraw.Draw(mask).rounded_rectangle(
        [inset, inset, size - inset, size - inset], radius=size * 0.22, fill=255
    )
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def leaf(d: ImageDraw.ImageDraw, bx, by, length, width, angle, fill):
    """A pointed laurel leaf growing from (bx, by) in the direction of angle (radians)."""
    pts = []
    for i in range(41):
        t = i / 40  # 0 at the base, 1 at the tip
        half = width / 2 * math.sin(math.pi * t ** 0.75) * (1 - 0.15 * t)
        pts.append((t * length, half))
    pts += [(x, -y) for x, y in reversed(pts)]
    ca, sa = math.cos(angle), math.sin(angle)
    d.polygon([(bx + x * ca - y * sa, by + x * sa + y * ca) for x, y in pts], fill=fill)


def wreath(d: ImageDraw.ImageDraw, size: int, leaves_per_side: int, detail: bool):
    """Two laurel branches rising from the bottom and curving up the sides,
    leaving an opening at the top."""
    cx, cy = size / 2, size * 0.52
    r = size * 0.33
    stem_w = max(1, size * (0.018 if detail else 0.03))
    bottom, top = math.radians(172), math.radians(32)  # angle measured from 12 o'clock

    def point(a, side):
        return cx + side * r * math.sin(a), cy - r * math.cos(a)

    for side in (1, -1):
        stem = [point(bottom + (top - bottom) * i / 60, side) for i in range(61)]
        d.line(stem, fill=GOLD_DARK, width=int(round(stem_w)), joint='curve')
        for i in range(leaves_per_side):
            t = (i + 0.35) / leaves_per_side
            a = bottom + (top - bottom) * t
            px, py = point(a, side)
            # direction of growth along the stem, towards the top
            heading = math.atan2(-r * math.sin(a), -side * r * math.cos(a))
            length = size * (0.15 if detail else 0.19) * (1 - 0.3 * t)
            width = length * (0.40 if detail else 0.5)
            spread = math.radians(40)
            leaf(d, px, py, length, width, heading - side * spread, GOLD)  # outer leaf
            leaf(d, px, py, length * 0.85, width * 0.9, heading + side * spread, GOLD_LIGHT if detail else GOLD)  # inner leaf
        # a final leaf at the tip of each branch
        tx, ty = point(top, side)
        heading = math.atan2(-r * math.sin(top), -side * r * math.cos(top))
        tip = size * (0.10 if detail else 0.13)
        leaf(d, tx, ty, tip, tip * 0.45, heading, GOLD)


def star(d: ImageDraw.ImageDraw, cx, cy, r, fill):
    pts = []
    for i in range(8):
        a = math.pi / 4 * i - math.pi / 2
        rr = r if i % 2 == 0 else r * 0.28
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=fill)


def alpha(d: ImageDraw.ImageDraw, size: int):
    cx, top, base = size / 2, size * 0.36, size * 0.68
    half = size * 0.12
    w = size * 0.055
    d.line([(cx - half, base), (cx, top), (cx + half, base)], fill=GOLD_LIGHT, width=int(w), joint='curve')
    d.line([(cx - half * 0.55, size * 0.585), (cx + half * 0.55, size * 0.585)], fill=GOLD_LIGHT, width=int(w * 0.8))


def render(size: int, variant: str) -> Image.Image:
    scale = 4  # draw large, then downsample for smooth edges
    big = size * scale
    img = tile(big)
    d = ImageDraw.Draw(img)
    detail = size >= 48
    wreath(d, big, leaves_per_side=6 if detail else 4, detail=detail)
    if variant == 'alpha':
        alpha(d, big)
        star(d, big / 2, big * 0.2, big * (0.06 if detail else 0.08), GOLD_LIGHT)
    else:
        glow = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse(
            [big * 0.34, big * 0.37, big * 0.66, big * 0.69], fill=GOLD + (90,)
        )
        img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(big * 0.05)))
        d = ImageDraw.Draw(img)
        star(d, big / 2, big * 0.53, big * (0.15 if detail else 0.19), GOLD_LIGHT)
    return img.resize((size, size), Image.LANCZOS)


def main():
    variant = sys.argv[1] if len(sys.argv) > 1 else 'star'
    out = ROOT / 'build'
    out.mkdir(exist_ok=True)
    render(512, variant).save(out / 'icon.png')
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = [render(s, variant) for s in sizes]
    frames[-1].save(out / 'icon.ico', sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    print('wrote', out / 'icon.png', out / 'icon.ico')


if __name__ == '__main__':
    main()
