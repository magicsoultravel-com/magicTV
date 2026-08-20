#!/usr/bin/env python3
"""
Split css/tv-landing.css into per-domain component files under css/components/
and convert css/tv-landing.css into an @import orchestrator.

The split is *offset-preserving*: each component file is a contiguous slice of
the original file (by 1-indexed inclusive line ranges), concatenated in import
order it reproduces the original byte-for-byte, so cascade order is untouched.

Usage:  python3 scripts/split-css.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "css/tv-landing.css"
OUT = ROOT / "css/components"

# (filename, label, start_line, end_line) — 1-indexed inclusive.
# Each range starts at the previous range's end + 1 so nothing is lost or reordered.
SLICES = [
    ("boot-screen", "Boot cover, grain/test-card modes, toast system, app skeleton", 1, 166),
    ("layout", "Header, bottom tabs, filter/sort toolbar, content splitter", 167, 721),
    ("catalog", "Channel/country grids, tiles, visited accents, favorites, settings preview", 722, 1273),
    ("mosaic", "Active-tile indicators, tile body, mosaic grid/free-layout, back button", 1274, 1488),
    ("player", "Player slots, playback surfaces, swap animations, controls chrome", 1489, 2803),
    ("settings", "Settings panels, appearance controls, sliders, responsive tweaks", 2804, 3456),
    ("modals", "Channel picker modal, tab-bar popup controls", 3457, 3709),
    ("remote", "Remote module, textures, external popout (PiP / popup)", 3710, 4901),
]

HUB_HEADER = """\
/** @css {"owns":"magicTV landing page layout, header, tabs, channel grid, refresh arrow"} */
/*
 * Orchestration hub only — real rules live in ./components/*.css and are
 * imported here *in cascade order* (a browser will load them as one file).
 * Edit the component files, not this hub. To add a component, insert an
 * @import before the last line and keep the order identical to cascade intent.
 */
"""

IMPORT = '@import "./components/{name}.css";'


def main() -> int:
    text = SRC.read_text(encoding="utf-8")
    if '@import "./components/' in text:
        print("Already split — css/tv-landing.css is the orchestrator. Nothing to do.")
        return 0
    lines = text.splitlines(keepends=True)
    total = len(lines)

    OUT.mkdir(parents=True, exist_ok=True)

    # Validate slice table is contiguous and in-bounds.
    prev_end = 0
    checksum = 0
    for name, _label, start, end in SLICES:
        if start != prev_end + 1:
            print(f"FAIL: slice '{name}' starts at {start}, expected {prev_end + 1}")
            return 1
        if end > total or start < 1:
            print(f"FAIL: slice '{name}' out of bounds ({start}..{end} vs 1..{total})")
            return 2
        prev_end = end
        checksum += end - start + 1
    if prev_end != total:
        print(f"FAIL: slices cover {prev_end} lines, file has {total}")
        return 3

    original_text = "".join(lines)

    for name, label, start, end in SLICES:
        body = "".join(lines[start - 1:end])
        header = (
            f"/** @css {{slice}}: {label} "
            f"(tv-landing.css lines {start}–{end}) */\n\n"
        )
        (OUT / f"{name}.css").write_text(header + body, encoding="utf-8")

    # Rewrite the hub.
    imports = "\n".join(IMPORT.format(name=name) for name, *_ in SLICES)
    hub = HUB_HEADER + imports
    if not hub.endswith("\n"):
        hub += "\n"
    SRC.write_text(hub, encoding="utf-8")

    # Lossless check: stripping the per-file header comment and concatenating
    # in import order must reproduce the original content exactly.
    # The per-file header is exactly one line + one blank line.
    reconstructed = []
    for name, label, start, end in SLICES:
        content = (OUT / f"{name}.css").read_text(encoding="utf-8")
        # Drop the leading "__header__\n\n" block.
        body = content.split("\n\n", 1)[1]
        reconstructed.append(body)
    rebuilt = "".join(reconstructed)
    if rebuilt != original_text:
        print("FAIL: reconstructed content differs from the original file!")
        for i, (a, b) in enumerate(zip(rebuilt.split("\n"), original_text.split("\n"))):
            if a != b:
                print(f"  first diff at line {i + 1}:\n    got:      {a!r}\n    expected: {b!r}")
                return 4
    print(f"OK: {total} original lines reconstructed exactly from {len(SLICES)} components")
    print(f"OK: wrote components under css/components/:")
    for name, label, start, end in SLICES:
        sz = (OUT / f"{name}.css").stat().st_size
        print(f"    - {name}.css  ({end - start + 1:>4} lines, {sz:>6} bytes) — {label}")
    print(f"OK: css/tv-landing.css is now the orchestrator ({len(SRC.read_text(encoding='utf-8').splitlines())} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main())