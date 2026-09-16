#!/usr/bin/env python3
"""
Page Cloner — Asset Downloader

Scans rawHtml from a Firecrawl scrape and downloads all page assets
(images, videos, fonts, SVGs) into a local directory.

Usage:
    python3 download_assets.py <scrape.json> <output_dir>

Example:
    python3 download_assets.py .firecrawl/example-com/scrape.json .firecrawl/example-com/assets/
"""

import json
import os
import re
import sys
import hashlib
from urllib.parse import urlparse, urljoin

try:
    from urllib.request import urlopen, Request
    from urllib.error import URLError, HTTPError
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = False


# ─── Asset URL Extraction ─────────────────────────────────────────────────

def extract_asset_urls(raw_html, page_url):
    """Extract all asset URLs from HTML."""
    assets = []
    seen = set()

    def add(url, tag, role):
        if not url or url.startswith("data:"):
            return
        absolute = urljoin(page_url, url)
        if absolute not in seen:
            seen.add(absolute)
            assets.append({"url": absolute, "tag": tag, "role": role})

    # <img src="..."> and <img srcset="...">
    for m in re.finditer(r'<img[^>]+src=["\']([^"\']+)["\']', raw_html, re.IGNORECASE):
        add(m.group(1), "img", "image")
    for m in re.finditer(r'<img[^>]+srcset=["\']([^"\']+)["\']', raw_html, re.IGNORECASE):
        for entry in m.group(1).split(","):
            url_part = entry.strip().split()[0]
            add(url_part, "img-srcset", "image")

    # <source src="..." / srcset="..."> (picture, video, audio)
    for m in re.finditer(r'<source[^>]+(?:src|srcset)=["\']([^"\']+)["\']', raw_html, re.IGNORECASE):
        add(m.group(1), "source", "media")

    # <video src="..." poster="...">
    for m in re.finditer(r'<video[^>]+src=["\']([^"\']+)["\']', raw_html, re.IGNORECASE):
        add(m.group(1), "video", "video")
    for m in re.finditer(r'<video[^>]+poster=["\']([^"\']+)["\']', raw_html, re.IGNORECASE):
        add(m.group(1), "video-poster", "image")

    # CSS background-image: url(...)
    for m in re.finditer(r'background(?:-image)?\s*:[^;]*url\(["\']?([^"\')\s]+)["\']?\)', raw_html, re.IGNORECASE):
        add(m.group(1), "css-bg", "background")

    # <link rel="icon" / apple-touch-icon>
    for m in re.finditer(r'<link[^>]+rel=["\'][^"\']*icon[^"\']*["\'][^>]+href=["\']([^"\']+)["\']', raw_html, re.IGNORECASE):
        add(m.group(1), "favicon", "icon")

    # <svg> references — external use/image hrefs
    for m in re.finditer(r'<(?:use|image)[^>]+(?:href|xlink:href)=["\']([^"\'#]+)', raw_html, re.IGNORECASE):
        add(m.group(1), "svg-ref", "svg")

    # Open Graph / Twitter meta images
    for m in re.finditer(r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)["\']', raw_html, re.IGNORECASE):
        add(m.group(1), "meta-og", "social")
    # Reversed attribute order
    for m in re.finditer(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\']', raw_html, re.IGNORECASE):
        add(m.group(1), "meta-og", "social")

    return assets


# ─── Download ──────────────────────────────────────────────────────────────

def download_assets(assets, output_dir):
    """Download all assets to output_dir. Returns manifest with results."""
    os.makedirs(output_dir, exist_ok=True)
    manifest = []
    seen_filenames = set()

    for i, asset in enumerate(assets):
        url = asset["url"]
        parsed = urlparse(url)

        # Derive filename from URL path
        filename = os.path.basename(parsed.path) or "asset"
        filename = re.sub(r'[?#].*', '', filename)  # strip query params
        if not os.path.splitext(filename)[1]:
            filename += ".bin"

        # Deduplicate filenames
        if filename in seen_filenames:
            name, ext = os.path.splitext(filename)
            short_hash = hashlib.md5(url.encode()).hexdigest()[:6]
            filename = f"{name}-{short_hash}{ext}"
        seen_filenames.add(filename)

        entry = {
            "index": i,
            "url": url,
            "filename": filename,
            "role": asset["role"],
            "tag": asset["tag"],
            "downloaded": False,
            "size_kb": 0,
        }

        try:
            req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            response = urlopen(req, timeout=15)
            data = response.read()

            filepath = os.path.join(output_dir, filename)
            with open(filepath, "wb") as f:
                f.write(data)

            entry["downloaded"] = True
            entry["size_kb"] = round(len(data) / 1024, 1)
            print(f"  ✓ {filename} ({entry['size_kb']} KB)")

        except (URLError, HTTPError, OSError) as e:
            entry["error"] = str(e)
            print(f"  ✗ {filename} — {e}")

        manifest.append(entry)

    return manifest


# ─── Main ──────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 download_assets.py <scrape.json> <output_dir>")
        print("  Extracts all asset URLs from the scrape's rawHtml and downloads them.")
        sys.exit(1)

    scrape_path = sys.argv[1]
    output_dir = sys.argv[2]

    if not HAS_URLLIB:
        print("Error: urllib is required for downloading assets.")
        sys.exit(1)

    # Load scrape data
    with open(scrape_path, "r") as f:
        scrape = json.load(f)

    # Get rawHtml and page URL
    data = scrape.get("data", scrape)
    raw_html = data.get("rawHtml", "")
    page_url = data.get("url", data.get("metadata", {}).get("sourceURL", ""))

    if not raw_html:
        print("Error: No rawHtml found in scrape data.")
        sys.exit(1)

    print(f"Page Cloner — Asset Downloader")
    print(f"  Source: {page_url}")
    print(f"  Output: {output_dir}")
    print()

    # Extract URLs
    assets = extract_asset_urls(raw_html, page_url)
    print(f"Found {len(assets)} assets:")
    by_role = {}
    for a in assets:
        by_role.setdefault(a["role"], []).append(a)
    for role, items in sorted(by_role.items()):
        print(f"  {role}: {len(items)}")
    print()

    # Download
    print("Downloading...")
    manifest = download_assets(assets, output_dir)

    # Write manifest
    manifest_path = os.path.join(output_dir, "assets-manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    # Summary
    downloaded = sum(1 for m in manifest if m["downloaded"])
    failed = len(manifest) - downloaded
    total_kb = sum(m["size_kb"] for m in manifest)
    print()
    print(f"Done: {downloaded} downloaded, {failed} failed, {round(total_kb / 1024, 1)} MB total")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
