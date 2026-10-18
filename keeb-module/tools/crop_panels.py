#!/usr/bin/env python3
"""Cut the per-layer portrait artwork out of a mockup sheet for gen_art.py.

The mockup is one PNG with a rounded frame drawn around every panel, plus a
decorative battery glyph in each top-right corner. The firmware draws its own
frame (keeb_panel_draw) and the right half has no battery readout - the left
half owns all of them - so both get dropped here and only the artwork inside
the frame survives. Caption text that cannot survive a 60px panel width is
replaced with dash skeletons (TEXT_ZONES): same lines and rhythm, no glyphs.

  <mockup>/<panel>  ->  art/<slug>_portrait.png   (consumed by gen_art.py)

PANELS below holds the outer bbox of each panel's frame in the source image,
keyed by the layer slug from gen_art.py's LAYERS list. TEXT_ZONES holds the
zones to skeleton. Re-measure them when the mockup changes size or layout:

    python3 tools/crop_panels.py --measure <mockup>.png   # print candidate boxes

Then:

    python3 tools/crop_panels.py <mockup>.png
    python3 tools/gen_art.py

--keep-battery leaves the decorative battery glyph in place.
--keep-text leaves the caption text as drawn (TEXT_ZONES are skipped).
"""

import os
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("numpy and Pillow are required: python3 -m pip install --user pillow numpy")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(REPO, "art")

# Outer bbox (x0, x1, y0, y1 inclusive) of each panel's rounded frame, measured
# in the mockup sheet. Keep the keys in sync with gen_art.py LAYERS.
PANELS = {
    "home": (627, 967, 22, 631),
    "navigation": (46, 317, 660, 1246),
    "function": (336, 600, 660, 1246),
    "media": (623, 887, 660, 1246),
    "game": (908, 1178, 660, 1246),
}

FRAME = 4      # frame stroke thickness in the mockup
PAD = 10       # margin cleared around the battery glyph
# A battery glyph is the outline plus its filled cell: a component in the top
# right corner, under 60x34, big enough to not be a title letter.
# (corner_inset_x, corner_inset_y, glyph_max_w, glyph_max_h, min_area)
BATTERY_ZONE = (130, 110, 60, 34, 300)

# Caption text that is hopeless at 60px panel width, as absolute mockup rects.
# Each zone keeps its line count, extent and rhythm, but the glyphs become
# dash skeletons - a line of text at a glance, no unreadable mush.
TEXT_ZONES = {
    "function": [(365, 1165, 570, 1228)],   # TOOLS | CONFIG / UPDATE | EXIT
    "media": [(700, 1140, 856, 1196)],      # LOFI BEATS / CHILL VIBES
}

DASH_UNIT = 24   # nominal dash length, mockup px (~5px on the panel)
DASH_GAP = 12    # gap between dashes (~2.7px on the panel)
DASH_H = 8       # dash height, mockup px (~1.8px on the panel)


def skeleton(patch, zone, slug):
    """Replace glyph text inside a patch-relative zone with dash skeletons.

    The text lines are detected first (runs of rows that carry ink), so every
    line keeps its own y, height and horizontal extent. Dash lengths come from
    a hash of the zone, so the result is reproducible without a seed to pass
    around.
    """
    import hashlib

    x0, y0, x1, y1 = zone
    sub = patch[y0:y1 + 1, x0:x1 + 1] > 100
    rows = sub.any(axis=1)

    lines = []
    y = 0
    while y < len(rows):
        if not rows[y]:
            y += 1
            continue
        h = 0
        while y + h < len(rows) and rows[y + h]:
            h += 1
        cols = np.where(sub[y:y + h].any(axis=0))[0]
        lines.append((y, h, int(cols.min()), int(cols.max())))
        y += h

    if not lines:
        print(f"  {slug}: text zone {zone} carries no ink, left alone")
        return

    patch[y0:y1 + 1, x0:x1 + 1] = 0
    digest = hashlib.md5(f"{slug}:{zone}".encode()).digest()
    rand = [digest[i % len(digest)] / 255.0 for i in range(len(digest) * 4)]

    for index, (ly, lh, lx0, lx1) in enumerate(lines):
        top = y0 + ly + max(0, (lh - DASH_H) // 2)
        height = min(DASH_H, lh)
        end = x0 + lx1
        x = x0 + lx0
        dashes = 0
        i = index * 7
        while x < end - 2:
            rest = end - x
            if rest < int(DASH_UNIT * 0.6):
                dash = rest
            else:
                r = rand[(i * 3) % len(rand)]
                dash = min(max(4, int(DASH_UNIT * (0.55 + r * 0.9))), rest)
            patch[top:top + height, x:x + dash] = 255
            x += dash + DASH_GAP
            i += 1
            dashes += 1
        print(f"  {slug}: skeleton line y={top}..{top + height - 1} "
              f"x={x0 + lx0}..{end} -> {dashes} dashes")


def components(mask):
    """Label 8-connected white components; return list of dicts with bbox+area."""
    from collections import deque

    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    comps = []
    nxt = 0
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or lab[y, x]:
                continue
            nxt += 1
            q = deque([(y, x)])
            lab[y, x] = nxt
            pts = []
            while q:
                cy, cx = q.popleft()
                pts.append((cy, cx))
                for yy in (cy - 1, cy, cy + 1):
                    if yy < 0 or yy >= h:
                        continue
                    for xx in (cx - 1, cx, cx + 1):
                        if xx < 0 or xx >= w:
                            continue
                        if mask[yy, xx] and not lab[yy, xx]:
                            lab[yy, xx] = nxt
                            q.append((yy, xx))
            ys = np.array([p[0] for p in pts])
            xs = np.array([p[1] for p in pts])
            comps.append(dict(area=len(pts), x0=xs.min(), x1=xs.max(),
                              y0=ys.min(), y1=ys.max()))
    return comps


def battery_rect(comps, zone_x, zone_y, zone_w, zone_h, min_area):
    """Bounding box of the battery glyph components, None when there is none.

    comps and the zone are all in interior-relative coordinates (the corner
    zone is measured from the interior's top-right), so glyph outline and its
    filled cell are picked up while title letters stay out (they are small).
    """
    parts = [c for c in comps
             if c["x0"] > zone_x and c["y1"] < zone_y
             and (c["x1"] - c["x0"] + 1) <= zone_w
             and (c["y1"] - c["y0"] + 1) <= zone_h
             and c["area"] >= min_area]
    if not parts:
        return None
    return (min(c["x0"] for c in parts), min(c["y0"] for c in parts),
            max(c["x1"] for c in parts), max(c["y1"] for c in parts))


def extract(src, slug, box, keep_battery, keep_text):
    x0, x1, y0, y1 = box
    ix0, iy0, ix1, iy1 = x0 + FRAME, y0 + FRAME, x1 - FRAME, y1 - FRAME

    patch = np.array(src.convert("L").crop((ix0, iy0, ix1 + 1, iy1 + 1)))
    comps = components(patch > 100)
    corner_x, corner_y, glyph_w, glyph_h, min_area = BATTERY_ZONE
    rect = battery_rect(comps, (ix1 - ix0 + 1) - corner_x, corner_y,
                        glyph_w, glyph_h, min_area)

    if rect and not keep_battery:
        bx0, by0, bx1, by1 = rect
        print(f"  {slug}: battery glyph ({bx0 + ix0},{by0 + iy0})-"
              f"({bx1 + ix0},{by1 + iy0}) removed")
        patch[max(by0 - PAD, 0):by1 + PAD + 1, max(bx0 - PAD, 0):bx1 + PAD + 1] = 0
    elif rect:
        print(f"  {slug}: battery glyph kept")

    for zone in () if keep_text else TEXT_ZONES.get(slug, ()):
        skeleton(patch, (zone[0] - ix0, zone[1] - iy0, zone[2] - ix0, zone[3] - iy0), slug)

    # Tight crop: gen_art.py scales to fit and centres, so dead margins inside
    # the frame only shrink the artwork.
    ys, xs = np.where(patch > 100)
    if len(xs) == 0:
        sys.exit(f"{slug}: no artwork inside the frame")
    crop = Image.fromarray(patch[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    return crop, (x1 - x0 + 1, y1 - y0 + 1)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep_battery = "--keep-battery" in sys.argv
    keep_text = "--keep-text" in sys.argv
    measure = "--measure" in sys.argv

    if not args:
        sys.exit(__doc__)
    src_path = os.path.abspath(args[-1])
    src = Image.open(src_path)

    if measure:
        gray = np.array(src.convert("L"))
        mask = gray > 100
        comps = components(mask)
        print(f"{src_path}: {src.size}, {len(comps)} components")
        for c in sorted(comps, key=lambda c: -c["area"])[:12]:
            print(f"  area={c['area']:8d} bbox=({c['x0']},{c['y0']})-({c['x1']},{c['y1']}) "
                  f"{c['x1']-c['x0']+1}x{c['y1']-c['y0']+1}")
        return

    print(f"source {src_path} {src.size}")
    for slug, box in PANELS.items():
        crop, panel_size = extract(src, slug, box, keep_battery, keep_text)
        path = os.path.join(ART_DIR, f"{slug}_portrait.png")
        os.makedirs(ART_DIR, exist_ok=True)
        crop.save(path)
        print(f"  {slug}: panel {panel_size[0]}x{panel_size[1]} -> "
              f"{crop.width}x{crop.height} {os.path.relpath(path, REPO)}")

    print("next: python3 tools/gen_art.py")


if __name__ == "__main__":
    main()
