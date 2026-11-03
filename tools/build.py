#!/usr/bin/env python3
"""Build both deployments of thread from src/.

- build/artifact.html : page content only (Claude Artifact wraps it in its own <html>/<head>).
- index.html          : full standalone document for GitHub Pages, with home-screen app metadata.

Run from the repository root:  python3 tools/build.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTS = ["page.html", "state.js", "views.js", "parse.js", "features.js"]

body = "".join((ROOT / "src" / p).read_text(encoding="utf-8") for p in PARTS)

(ROOT / "build").mkdir(exist_ok=True)
(ROOT / "build" / "artifact.html").write_text(body, encoding="utf-8")

# The first two lines of page.html are <title> and the Claude-only viewport meta; the standalone page puts the title in <head>.
lines = body.split("\n")
assert lines[0].startswith("<title>") and "claude:viewport-fit-sides" in lines[1], "page.html must start with <title> and the claude meta"
title = lines[0]
content = "\n".join(lines[2:])

HEAD = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{title}
<meta name="description" content="导入微信、支付宝、中国银行账单，画出像股价一样涨跌的总资产曲线。数据只存在本机。">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="thread">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="manifest" href="manifest.webmanifest">
<style>
:root {{ color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }}
body {{ margin: 0; font-size: 14px; }}
img {{ max-width: 100%; }}
[hidden] {{ display: none !important; }}
/* keeps scrolled content from showing under the status bar when opened from the home screen */
body::before {{ content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 35; background: var(--bg); }}
</style>
</head>
<body>
"""

(ROOT / "index.html").write_text(HEAD + content + "\n</body>\n</html>\n", encoding="utf-8")
print("built build/artifact.html and index.html")
