#!/usr/bin/env python3
"""Draws the app icon, Android launcher icons and splash screens (needs Pillow).

    python3 scripts/make-icons.py

Writes into web/public (PWA icons) and android/app/src/main/res (launcher + splash).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BLUE = (28, 92, 171, 255)
WHITE = (255, 255, 255, 255)
SS = 4  # supersampling factor for smooth edges


def mark(draw, cx, cy, s, line=True):
    """Medical cross with a heartbeat line; s = size of the cross in pixels."""
    u = s / 288.0
    x0, y0 = cx - 144 * u, cy - 144 * u
    bar = 100 * u
    draw.rectangle([x0 + 94 * u, y0, x0 + 94 * u + bar, y0 + 288 * u], fill=WHITE)
    draw.rectangle([x0, y0 + 94 * u, x0 + 288 * u, y0 + 94 * u + bar], fill=WHITE)
    if line:
        pts = [(8, 188), (78, 188), (104, 140), (138, 232), (168, 168), (186, 188), (280, 188)]
        pts = [(x0 + px * u, y0 + py * u) for px, py in pts]
        w = max(1, int(22 * u))
        draw.line(pts, fill=BLUE, width=w, joint='curve')
        r = w / 2
        for px, py in (pts[0], pts[-1]):
            draw.ellipse([px - r, py - r, px + r, py + r], fill=BLUE)


def render(size, shape, cross_ratio, transparent=False):
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0) if transparent else BLUE)
    d = ImageDraw.Draw(img)
    if shape == 'rounded':
        img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=BLUE)
    elif shape == 'circle':
        img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse([0, 0, big - 1, big - 1], fill=BLUE)
    mark(d, big / 2, big / 2, big * cross_ratio)
    return img.resize((size, size), Image.LANCZOS)


def splash(w, h):
    big_w, big_h = w * 2, h * 2
    img = Image.new('RGB', (big_w, big_h), BLUE[:3])
    d = ImageDraw.Draw(img)
    mark(d, big_w / 2, big_h / 2, min(big_w, big_h) * 0.22)
    return img.resize((w, h), Image.LANCZOS)


def main():
    web = ROOT / 'web' / 'public'
    render(192, 'square', 0.56).save(web / 'icon-192.png')
    render(512, 'square', 0.56).save(web / 'icon-512.png')

    res = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
    for density, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        folder = res / f'mipmap-{density}'
        render(px, 'rounded', 0.62).save(folder / 'ic_launcher.png')
        render(px, 'circle', 0.56).save(folder / 'ic_launcher_round.png')
        # adaptive icon foreground: 108dp canvas, keep the mark inside the 66dp safe zone
        render(int(px * 108 / 48), 'square', 0.40, transparent=True).save(folder / 'ic_launcher_foreground.png')

    for png in res.glob('drawable*/splash.png'):
        with Image.open(png) as old:
            size = old.size
        splash(*size).save(png)
    print('icons and splash screens written')


if __name__ == '__main__':
    main()
