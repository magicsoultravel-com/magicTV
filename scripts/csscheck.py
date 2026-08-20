#!/usr/bin/env python3
"""Sanity: brace/paren balance across every landing stylesheet (post-split)."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = [ROOT / "css/tv-landing.css"] + sorted((ROOT / "css/components").glob("*.css"))


def strip_non_code(src: str) -> str:
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            end = src.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if c == '"' or c == "'":
            q = c
            i += 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == q:
                    i += 1
                    break
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def main() -> int:
    bad = False
    totals = {}
    for p in FILES:
        code = strip_non_code(p.read_text())
        for a, b in (("{", "}"), ("(", ")"), ("[", "]")):
            if code.count(a) != code.count(b):
                print(f"UNBALANCED {p.relative_to(ROOT)}: {a}={code.count(a)} {b}={code.count(b)}")
                bad = True
        for d in ("{", "}", "(", ")", "[", "]"):
            totals[d] = totals.get(d, 0) + code.count(d)
    print("global counts:", totals)
    if bad:
        print("balance check: FAILED")
        return 1
    print(f"balance check: OK ({len(FILES)} files, all delimiters balanced)")
    return 0


if __name__ == "__main__":
    sys.exit(main())