#!/usr/bin/env python3
"""Placeholder toolbar icons (stdlib only)."""

from __future__ import annotations

import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1] / "icons"
BG = (20, 63, 74, 255)
GLYPH = (244, 247, 246, 255)
ACCENT = (94, 234, 212, 255)


def png(width: int, height: int, rows: list[bytes]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = b"".join(b"\x00" + row for row in rows)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )


def in_rounded_rect(x: float, y: float, size: int, radius: float) -> bool:
    r = max(radius, 0.0)
    cx = min(max(x, r), size - 1 - r)
    cy = min(max(y, r), size - 1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r + 0.25


def in_bookmark(nx: float, ny: float) -> bool:
    # Classic bookmark: rectangle with an inverted-V cut at the bottom.
    left, right = 0.32, 0.68
    top, bottom, notch = 0.18, 0.84, 0.66
    if nx < left or nx > right or ny < top or ny > bottom:
        return False
    if ny <= notch:
        return True
    # two triangles from the bottom corners up to (0.50, notch)
    t = (ny - notch) / (bottom - notch)
    half = (right - left) / 2 * (1 - t)
    return abs(nx - 0.50) <= half


def in_accent_bar(nx: float, ny: float) -> bool:
    return 0.32 <= nx <= 0.68 and 0.18 <= ny <= 0.24


def render(size: int) -> bytes:
    radius = size * (0.22 if size >= 32 else 0.18)
    rows: list[bytes] = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            if not in_rounded_rect(x, y, size, radius):
                row.extend((0, 0, 0, 0))
                continue
            nx = (x + 0.5) / size
            ny = (y + 0.5) / size
            if in_accent_bar(nx, ny):
                row.extend(ACCENT)
            elif in_bookmark(nx, ny):
                row.extend(GLYPH)
            else:
                row.extend(BG)
        rows.append(bytes(row))
    return png(size, size, rows)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = ROOT / f"icon{size}.png"
        path.write_bytes(render(size))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
