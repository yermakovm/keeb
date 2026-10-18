#!/usr/bin/env python3
"""Generate the artwork used by the keeb peripheral (right hand) status screen.

Source art lives in  <repo>/art/<slug>.png  - one file per keymap layer, named
after the layer and listed in LAYERS below in keymap order. Each file becomes
an LVGL "A8" stencil image written to:

  boards/shields/keeb/ui/art/layer_art_data.c   image data + lookup table
  boards/shields/keeb/ui/art/layer_art_count.h  KBEEB_ART_COUNT

Run it after adding or editing artwork:

    python3 tools/gen_art.py

Conventions
-----------
* Bright source pixels become ink, dark pixels become paper. The mockups are
  white line art on black, which matches. Only the shape matters: the colour is
  chosen at draw time (see keeb_panel_draw), so CONFIG_ZMK_DISPLAY_INVERT flips
  the artwork for free.
* A8 (one byte per pixel) rather than 1 bit: it is the one format LVGL blends
  straight into the UI canvas as a recoloured mask without allocating a
  conversion buffer, which matters on a 1 bit / 8 KB heap build.
* Artwork is scaled to fit inside the frame, never cropped. A dedicated portrait
  source (<slug>_portrait.png) is used when present, otherwise the same image is
  fit into the portrait box. Only the artwork for the configured panel rotation
  is compiled in.
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow is required: python3 -m pip install --user pillow")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(REPO, "art")
OUT_DIR = os.path.join(REPO, "boards", "shields", "keeb", "ui", "art")

# Keep in sync with the layer order in zmk-config/config/keeb.keymap.
LAYERS = [
    ("home", "HOME"),
    ("navigation", "NAV"),
    ("function", "FUN"),
    ("media", "MEDIA"),
    ("game", "GAME"),
]

# 1px rounded frame at the panel edge + 3px gutter.
LANDSCAPE = (152, 60)
PORTRAIT = (60, 152)

# Source pixels at or above this luminance become ink.
#
# The mockup line art is drawn at ~4x the panel size, so a 1px line lands at
# ~25% intensity after the LANCZOS downscale. 128 (50%) wipes those lines out
# entirely; 64 keeps every stroke, at the cost of slightly thickening dense
# regions - the right trade-off for a 152x60 1-bit target.
THRESHOLD = 64

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Verdana Bold.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/verdanab.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # older Pillow
        return ImageFont.load_default()


def placeholder(size, index, name):
    """Stand-in artwork: frame, hatch texture, layer number and name."""
    w, h = size
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)

    for x in range(-h, w, 6):
        d.line([(x, h), (x + h, 0)], fill=60)

    box = 2
    d.rectangle([box, box, w - 1 - box, h - 1 - box], outline=255)

    d.text((w // 2, h // 2 - 8), str(index + 1), fill=255, font=load_font(30), anchor="mm")
    d.text((w // 2, h - 12), name, fill=255, font=load_font(11), anchor="mm")
    return img


def fit(src, target):
    """Scale to fit inside target, centred on an empty canvas (never crops)."""
    tw, th = target
    scale = min(tw / src.width, th / src.height)
    nw, nh = max(1, round(src.width * scale)), max(1, round(src.height * scale))
    out = Image.new("L", target, 0)
    out.paste(src.resize((nw, nh), Image.LANCZOS), ((tw - nw) // 2, (th - nh) // 2))
    return out


def to_alpha(img):
    """Threshold to 0 / 255 alpha; rows are byte padded to the stride."""
    gray = img.convert("L")
    stride = (gray.width + 3) & ~3
    out = bytearray(stride * gray.height)
    for y in range(gray.height):
        base = y * stride
        for x in range(gray.width):
            out[base + x] = 255 if gray.getpixel((x, y)) >= THRESHOLD else 0
    return bytes(out), stride


def c_array(data, per_line=24):
    return "\n".join(
        "    " + ", ".join(f"0x{b:02x}" for b in data[i : i + per_line]) + ","
        for i in range(0, len(data), per_line)
    )


def emit_image(out, slug, img):
    alpha, stride = to_alpha(img)
    w, h = img.size
    name = f"keeb_art_{slug}"

    out.write(f"static const uint8_t {name}_map[] __aligned(4) = {{\n{c_array(alpha)}\n}};\n\n")
    out.write(
        f"const lv_image_dsc_t {name} = {{\n"
        f"    .header = {{\n"
        f"        .cf = LV_COLOR_FORMAT_A8,\n"
        f"        .w = {w},\n"
        f"        .h = {h},\n"
        f"        .stride = {stride},\n"
        f"    }},\n"
        f"    .data_size = sizeof({name}_map),\n"
        f"    .data = {name}_map,\n"
        f"}};\n\n"
    )
    return name


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    sources = {}
    for index, (slug, name) in enumerate(LAYERS):
        src_path = os.path.join(ART_DIR, f"{slug}.png")
        if os.path.exists(src_path):
            sources[slug] = Image.open(src_path)
            print(f"  {slug}: {os.path.relpath(src_path, REPO)}")
        else:
            sources[slug] = placeholder(LANDSCAPE, index, name)
            print(f"  {slug}: placeholder (missing art/{slug}.png)")

        portrait_path = os.path.join(ART_DIR, f"{slug}_portrait.png")
        if os.path.exists(portrait_path):
            sources[slug + "_portrait"] = Image.open(portrait_path)

    names = [f"keeb_art_{slug}" for slug, _ in LAYERS]

    with open(os.path.join(OUT_DIR, "layer_art_data.c"), "w") as out:
        out.write(
            "/* GENERATED by tools/gen_art.py - do not edit.\n"
            " * Layer artwork for the keeb peripheral status screen (A8 stencils).\n"
            " */\n\n"
            "#include <lvgl.h>\n"
            "#include <zephyr/toolchain.h>\n\n"
            '#include "../keeb_ui.h" /* KBEEB_UI_PORTRAIT */\n'
            '#include "layer_art_count.h"\n\n'
            "#if KBEEB_UI_PORTRAIT\n"
        )

        emit = lambda orient_suffix, size: [
            emit_image(out, slug, fit(sources.get(slug + orient_suffix, sources[slug]), size))
            for slug, _ in LAYERS
        ]
        emit("_portrait", PORTRAIT)
        out.write("#else\n")
        emit("", LANDSCAPE)
        out.write("#endif\n\n")

        out.write("const lv_image_dsc_t *const keeb_art[KBEEB_ART_COUNT] = {\n")
        out.write("".join(f"    &{n},\n" for n in names))
        out.write("};\n")

    with open(os.path.join(OUT_DIR, "layer_art_count.h"), "w") as out:
        out.write(
            "/* GENERATED by tools/gen_art.py - do not edit. */\n"
            "#pragma once\n\n"
            f"#define KBEEB_ART_COUNT {len(LAYERS)}\n"
        )

    print(f"wrote {len(LAYERS)} artworks to {os.path.relpath(OUT_DIR, REPO)}")


if __name__ == "__main__":
    main()
