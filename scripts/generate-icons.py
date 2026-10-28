#!/usr/bin/env python3
"""Render icons/logo.svg to the extension PNGs with ffmpeg (librsvg decoder).

Usage: python3 scripts/generate-icons.py [--master PATH]

Writes icons/icon{16,32,48,128}.png and a 1024 px store master
(icons/logo-1024.png by default). Each size is rasterized straight from the
vector source at its target size instead of downscaling one big bitmap, so
the 8-unit grid in the SVG lands on whole pixels at 16/32/48 px.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ICONS = pathlib.Path(__file__).resolve().parents[1] / "icons"
SOURCE = ICONS / "logo.svg"
SIZES = (16, 32, 48, 128)
SVG_NS = "http://www.w3.org/2000/svg"


def sized_svg(size: int) -> bytes:
    ET.register_namespace("", SVG_NS)
    root = ET.parse(SOURCE).getroot()
    root.set("width", str(size))
    root.set("height", str(size))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def render(size: int, out: pathlib.Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        svg = pathlib.Path(tmp) / "logo.svg"
        svg.write_bytes(sized_svg(size))
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(svg),
                "-frames:v", "1", "-pix_fmt", "rgba", "-compression_level", "9",
                str(out),
            ],
            check=True,
        )
    print(f"wrote {out} ({out.stat().st_size} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--master", type=pathlib.Path, default=ICONS / "logo-1024.png")
    args = parser.parse_args()
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg (built with --enable-librsvg) is required")
    for size in SIZES:
        render(size, ICONS / f"icon{size}.png")
    render(1024, args.master)


if __name__ == "__main__":
    main()
