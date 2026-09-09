#!/usr/bin/env python3
"""
FABLE-A034 (icon portion): generates a simple placeholder iOS App Icon PNG
(solid teal background + a lighter inset square, same colour motif as
android/scripts/generate-launcher-icons.mjs, parent-web/scripts/generate-icons.mjs
and public-web/src/assets/favicon.svg) and an AppIcon.appiconset using the
modern single-size ("universal", 1024x1024) format Xcode 14+ supports --
no per-idiom size grid needed.

No external dependencies -- hand-rolls a minimal PNG encoder, the same
approach as the other placeholder-icon generators in this repo. Unlike
those, this one emits a TRUE-COLOUR RGB PNG (no alpha channel, color type
2): App Store Connect rejects an app icon that HAS an alpha channel at all,
even one that is fully opaque everywhere, so the RGBA encoder those other
scripts use is not reusable here as-is.

Placeholder only: swap for a real brand asset before shipping -- this is
not a design decision, it closes a functional gap (a missing app icon is a
hard App Store submission rejection).
"""
from zlib import compress
import struct
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ICONSET_DIR = os.path.join(HERE, "..", "PCA", "Assets.xcassets", "AppIcon.appiconset")
ASSETS_DIR = os.path.join(HERE, "..", "PCA", "Assets.xcassets")


def crc32(buf):
    table = crc32.table
    if table is None:
        table = []
        for n in range(256):
            c = n
            for _ in range(8):
                c = 0xEDB88320 ^ (c >> 1) if c & 1 else c >> 1
            table.append(c)
        crc32.table = table
    crc = 0xFFFFFFFF
    for b in buf:
        crc = table[(crc ^ b) & 0xFF] ^ (crc >> 8)
    return crc ^ 0xFFFFFFFF


crc32.table = None


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc32(tag + data))


def make_rgb_png(size, bg, fg):
    """color type 2 (truecolor, NO alpha channel) -- required for a valid App Store icon."""
    margin = round(size * 0.14)
    inset = margin + round(size * 0.1)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none
        for x in range(size):
            is_fg = inset < x < size - inset and inset < y < size - inset
            color = fg if is_fg else bg
            raw += bytes(color)
    idat = compress(bytes(raw))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # bit depth 8, color type 2 = RGB
    sig = b"\x89PNG\r\n\x1a\n"
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


BG = (0x1D, 0x4F, 0x4A)  # brand teal -- same as the other placeholder generators
FG = (0xE8, 0xF5, 0xF3)  # light glyph

os.makedirs(ICONSET_DIR, exist_ok=True)

png_bytes = make_rgb_png(1024, BG, FG)
with open(os.path.join(ICONSET_DIR, "AppIcon.png"), "wb") as f:
    f.write(png_bytes)

iconset_contents = """{
  "images" : [
    {
      "filename" : "AppIcon.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
"""
with open(os.path.join(ICONSET_DIR, "Contents.json"), "w", encoding="utf-8", newline="\n") as f:
    f.write(iconset_contents)

assets_contents = """{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
"""
assets_contents_path = os.path.join(ASSETS_DIR, "Contents.json")
if not os.path.exists(assets_contents_path):
    with open(assets_contents_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(assets_contents)

print("Generated placeholder iOS App Icon at", ICONSET_DIR)
