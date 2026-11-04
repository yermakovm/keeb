#!/usr/bin/env python3
"""Estimate SVG <text> boxes and report real collisions.

A label inside its own box is fine. What matters:
  TEXT/TEXT  two labels whose boxes intersect
  TEXT/RECT  a label crossing a box edge (mis-centered label)
  OVERFLOW   text outside the viewBox
Width model: system-ui ~0.53em/char, monospace ~0.60em, + letter-spacing.
"""
import re, sys, glob
import xml.etree.ElementTree as ET

MONO = re.compile(r"monospace|Menlo|SFMono")
SVG_NS = "{http://www.w3.org/2000/svg}"


def num(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def walk(node, inherited, texts, rects, rotated):
    attrs = dict(node.attrib)
    fs = num(attrs.get("font-size"), inherited["fs"])
    mono = bool(MONO.search(attrs.get("font-family", "") or "")) or inherited["mono"]
    ls = num(attrs.get("letter-spacing"), inherited["ls"])
    anchor = attrs.get("text-anchor") or inherited["anchor"]
    fill = attrs.get("fill", inherited["fill"])
    cur = dict(fs=fs, mono=mono, ls=ls, anchor=anchor, fill=fill)
    tag = node.tag.replace(SVG_NS, "")
    if tag == "defs":
        return
    if tag == "rect":
        if all(k in attrs for k in ("x", "y", "width", "height")):
            rects.append(dict(x0=num(attrs["x"]), y0=num(attrs["y"]),
                              x1=num(attrs["x"]) + num(attrs["width"]),
                              y1=num(attrs["y"]) + num(attrs["height"])))
    if tag == "text":
        raw = "".join(node.itertext()).strip()
        txt = re.sub(r"\s+", " ", raw)
        if txt and attrs.get("transform"):
            rotated.append(dict(txt=txt, transform=attrs["transform"]))
        elif txt:
            x = num(attrs.get("x"), 0)
            y = num(attrs.get("y"), 0)
            f = cur["fs"]
            w = len(txt) * (0.60 if cur["mono"] else 0.53) * f + cur["ls"] * max(len(txt) - 1, 0)
            x0 = x if cur["anchor"] == "start" else (x - w if cur["anchor"] == "end" else x - w / 2)
            texts.append(dict(x0=x0, x1=x0 + w, y0=y - 0.78 * f, y1=y + 0.26 * f,
                              txt=txt, fs=f, fill=cur["fill"]))
    for child in node:
        walk(child, cur, texts, rects, rotated)


def overlap(a, b):
    return (min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]) > 2 and
            min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]) > 2)


def contained(a, r, tol=3):
    return (a["x0"] >= r["x0"] - tol and a["x1"] <= r["x1"] + tol and
            a["y0"] >= r["y0"] - tol and a["y1"] <= r["y1"] + tol)


def report(path):
    tree = ET.parse(path)
    root = tree.getroot()
    vb = num(root.get("viewBox", "0 0 0 0").split()[2]), num(root.get("viewBox").split()[3])
    texts, rects, rotated = [], [], []
    walk(root, dict(fs=12, mono=False, ls=0.0, anchor="start", fill=""), texts, rects, rotated)
    hits = 0
    print(f"\n=== {path} ({len(texts)} texts, {len(rects)} rects) ===")
    for r in rotated:
        print(f"  rotated (box not modelled): '{r['txt'][:40]}' {r['transform']}")
    for t in texts:
        if t["x0"] < -1 or t["x1"] > vb[0] + 1 or t["y0"] < -1 or t["y1"] > vb[1] + 1:
            print(f"  OVERFLOW  '{t['txt'][:46]}' ({t['x0']:.0f}..{t['x1']:.0f}, {t['y0']:.0f}..{t['y1']:.0f})")
            hits += 1
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            a, b = texts[i], texts[j]
            if overlap(a, b):
                print(f"  TEXT/TEXT  '{a['txt'][:30]}'@({a['x0']:.0f}-{a['x1']:.0f},{a['y0']:.0f}-{a['y1']:.0f}) <-> '{b['txt'][:30]}'@({b['x0']:.0f}-{b['x1']:.0f},{b['y0']:.0f}-{b['y1']:.0f})")
                hits += 1
    for t in texts:
        for r in rects:
            if overlap(t, r) and not contained(t, r) and not any(contained(t, o) for o in rects):
                print(f"  TEXT/RECT  '{t['txt'][:40]}'@({t['x0']:.0f}-{t['x1']:.0f},{t['y0']:.0f}-{t['y1']:.0f}) crosses rect({r['x0']:.0f}-{r['x1']:.0f},{r['y0']:.0f}-{r['y1']:.0f})")
                hits += 1
    if not hits:
        print("  clean")


for p in sys.argv[1:] or sorted(glob.glob("docs/assets/*.svg")):
    report(p)
