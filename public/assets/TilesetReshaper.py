#!/usr/bin/env python3
"""
Tilesheet Converter: 16x8 sprites -> 8x16 sprites
Takes a tilesheet where each sprite is two 8x8 tiles side-by-side (16x8)
and rearranges each sprite so the left tile is on top and the right tile is on bottom (8x16).

Usage:
    python convert_tilesheet.py input.png output.png
    python convert_tilesheet.py input_folder/ output_folder/
"""

import os
import sys
from PIL import Image
import argparse

def convert_sprite_sheet(input_path: str, output_path: str):
    """Convert a single tilesheet from 16x8 sprites to 8x16 sprites."""
    img = Image.open(input_path).convert("RGBA")
    w, h = img.size

    if w % 16 != 0 or h % 8 != 0:
        raise ValueError(f"Input image must have width multiple of 16 and height multiple of 8. Got {w}x{h}")

    sprites_per_row = w // 16
    sprite_rows = h // 8

    # Output dimensions: same number of sprites, but each is now 8x16
    out_w = sprites_per_row * 8
    out_h = sprite_rows * 16

    out_img = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))

    for row in range(sprite_rows):
        for col in range(sprites_per_row):
            # Source: left tile (first) and right tile (second)
            left_tile = img.crop((col * 16, row * 8, col * 16 + 8, row * 8 + 8))
            right_tile = img.crop((col * 16 + 8, row * 8, col * 16 + 16, row * 8 + 8))

            # Destination: left tile on top, right tile on bottom
            dst_x = col * 8
            dst_y = row * 16
            out_img.paste(left_tile, (dst_x, dst_y))
            out_img.paste(right_tile, (dst_x, dst_y + 8))

    out_img.save(output_path)
    print(f"✓ Converted: {os.path.basename(input_path)} → {os.path.basename(output_path)} "
          f"({w}x{h} → {out_w}x{out_h})")

def process_path(input_path: str, output_path: str):
    """Process a file or folder."""
    if os.path.isdir(input_path):
        os.makedirs(output_path, exist_ok=True)
        for filename in sorted(os.listdir(input_path)):
            if filename.lower().endswith((".png", ".bmp", ".gif", ".jpg", ".jpeg")):
                in_file = os.path.join(input_path, filename)
                out_file = os.path.join(output_path, filename)
                try:
                    convert_sprite_sheet(in_file, out_file)
                except Exception as e:
                    print(f"✗ Error processing {filename}: {e}")
    else:
        # Single file
        if not os.path.exists(input_path):
            print(f"Error: Input file not found: {input_path}")
            return
        # If output is a directory, keep the same filename
        if os.path.isdir(output_path):
            out_file = os.path.join(output_path, os.path.basename(input_path))
        else:
            out_file = output_path
        os.makedirs(os.path.dirname(out_file) or ".", exist_ok=True)
        convert_sprite_sheet(input_path, out_file)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert tilesheets: 16x8 sprites (side-by-side) → 8x16 sprites (stacked)"
    )
    parser.add_argument("input", help="Input image file or folder of images")
    parser.add_argument("output", help="Output image file or folder")
    args = parser.parse_args()

    process_path(args.input, args.output)
    print("\nDone!")