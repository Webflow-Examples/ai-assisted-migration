#!/usr/bin/env python3
"""
Page Cloner — 1:1 HTML+CSS Clone Generator

Takes the Firecrawl scrape data and produces a single self-contained HTML file
that is a pixel-perfect copy of the original page. All CSS (embedded + external)
is inlined into the document, and asset URLs are rewritten to local paths when
downloaded assets are available.

Usage:
    python3 generate_clone.py <scrape.json> <output_dir> [--assets-dir <path>]

Outputs:
    output_dir/clone.html  — Self-contained HTML+CSS clone of the original page
"""

import json
import os
import re
import sys
from urllib.parse import urlparse, urljoin


def load_scrape(scrape_path):
    """Load and return the scrape data."""
    with open(scrape_path, "r") as f:
        return json.load(f)


def collect_downloaded_css(output_dir):
    """Read all downloaded CSS files from the css/ directory."""
    css_dir = os.path.join(output_dir, "css")
    if not os.path.isdir(css_dir):
        return ""

    css_blocks = []
    for fname in sorted(os.listdir(css_dir)):
        if fname.endswith(".css"):
            fpath = os.path.join(css_dir, fname)
            with open(fpath, "r", errors="replace") as f:
                css_blocks.append(f"/* === {fname} === */\n{f.read()}")
    return "\n\n".join(css_blocks)


def build_asset_map(output_dir, assets_dir):
    """Build a map of original URLs -> local file paths for asset rewriting."""
    asset_map = {}
    assets_json = os.path.join(output_dir, "assets.json")
    if not os.path.exists(assets_json) or not assets_dir or not os.path.isdir(assets_dir):
        return asset_map

    with open(assets_json, "r") as f:
        assets = json.load(f)

    # List actual downloaded files
    downloaded_files = set(os.listdir(assets_dir)) if os.path.isdir(assets_dir) else set()

    for asset in assets:
        url = asset.get("url", "")
        if not url:
            continue

        # The download script names files based on the URL path basename
        url_path = urlparse(url).path
        basename = url_path.split("/")[-1] if url_path else ""
        if not basename:
            basename = f"asset-{asset.get('index', 0)}.bin"

        # Clean query params from basename
        basename = re.sub(r"[?#].*", "", basename)

        if basename in downloaded_files:
            # Use relative path from clone.html (which lives in output_dir)
            asset_map[url] = f"downloaded-assets/{basename}"

    return asset_map


def rewrite_asset_urls(html, asset_map):
    """Replace original asset URLs with local paths in the HTML."""
    if not asset_map:
        return html

    # Sort by URL length descending to avoid partial replacements
    for original_url, local_path in sorted(asset_map.items(), key=lambda x: -len(x[0])):
        html = html.replace(original_url, local_path)

    return html


def extract_doctype_and_html(raw_html):
    """Extract the full HTML document, preserving doctype."""
    # Check if it starts with a doctype
    doctype_match = re.match(r"(<!DOCTYPE[^>]*>)", raw_html, re.IGNORECASE)
    doctype = doctype_match.group(1) if doctype_match else "<!DOCTYPE html>"
    return doctype, raw_html


def inject_downloaded_css(html, downloaded_css):
    """Inject downloaded external CSS into the <head> as an embedded <style> block."""
    if not downloaded_css:
        return html

    css_block = f"\n<style data-source=\"page-cloner-external-css\">\n{downloaded_css}\n</style>\n"

    # Try to inject before </head>
    head_close = re.search(r"</head>", html, re.IGNORECASE)
    if head_close:
        insert_pos = head_close.start()
        html = html[:insert_pos] + css_block + html[insert_pos:]
    else:
        # No </head> found — prepend to the document
        html = css_block + html

    return html


def remove_external_stylesheet_links(html, output_dir):
    """Remove <link> tags for external stylesheets that we've already downloaded and inlined."""
    styles_json = os.path.join(output_dir, "styles.json")
    if not os.path.exists(styles_json):
        return html

    with open(styles_json, "r") as f:
        styles = json.load(f)

    # Get URLs of stylesheets we successfully downloaded
    downloaded_urls = set()
    for entry in styles.get("external_stylesheets", {}).get("site_specific", []):
        if entry.get("downloaded"):
            downloaded_urls.add(entry["url"])

    if not downloaded_urls:
        return html

    # Remove <link> tags that reference downloaded stylesheets
    def should_remove(match):
        tag = match.group(0)
        for url in downloaded_urls:
            if url in tag:
                return ""
        return tag

    html = re.sub(
        r'<link[^>]*rel=["\']stylesheet["\'][^>]*/?>',
        should_remove,
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r'<link[^>]*href=["\'][^"\']+\.css[^"\']*["\'][^>]*rel=["\']stylesheet["\'][^>]*/?>',
        should_remove,
        html,
        flags=re.IGNORECASE,
    )

    return html


def strip_scroll_blockers(html):
    """Remove CSS rules that lock body/html overflow and height.

    Embedded iframes (Vimeo, YouTube, etc.) often inject rules like:
        body, html, .player, .fallback { overflow: hidden; width: 100%; height: 100%; ... }
    These are scoped to the iframe context on the live page but in a flat clone
    they apply to the top-level document and prevent scrolling.
    """
    # Remove full rule blocks that target body/html with overflow:hidden + height:100%
    # These are always from embedded video players
    html = re.sub(
        r'body\s*,\s*html\s*,\s*\.player\s*,\s*\.fallback\s*\{[^}]*overflow\s*:\s*hidden[^}]*\}',
        '/* [page-cloner] removed iframe scroll-lock rule */',
        html,
    )

    # Also handle standalone body/html overflow:hidden rules from video embeds
    html = re.sub(
        r'(?:body|html)\s*(?:,\s*(?:body|html)\s*)*\{[^}]*overflow\s*:\s*hidden[^}]*height\s*:\s*100%[^}]*\}',
        '/* [page-cloner] removed iframe scroll-lock rule */',
        html,
    )

    return html


def add_base_tag(html, source_url):
    """Add a <base> tag so relative URLs (that weren't rewritten) still resolve."""
    if not source_url:
        return html

    parsed = urlparse(source_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    base_tag = f'<base href="{base_url}/">\n'

    # Insert after <head> or after doctype
    head_open = re.search(r"<head[^>]*>", html, re.IGNORECASE)
    if head_open:
        insert_pos = head_open.end()
        # Don't add if base tag already exists
        if not re.search(r"<base\s", html[:insert_pos + 200], re.IGNORECASE):
            html = html[:insert_pos] + "\n" + base_tag + html[insert_pos:]

    return html


def generate_clone(scrape_path, output_dir, assets_dir=None):
    """Main clone generation pipeline."""
    scrape = load_scrape(scrape_path)

    raw_html = scrape.get("rawHtml", "")
    metadata = scrape.get("metadata", {})
    source_url = metadata.get("sourceURL", metadata.get("url", ""))

    if not raw_html:
        print("ERROR: No rawHtml found in scrape data")
        sys.exit(1)

    print(f"Generating 1:1 clone for: {source_url}")
    print(f"  Raw HTML size: {len(raw_html):,} chars")

    # Step 1: Collect downloaded external CSS
    downloaded_css = collect_downloaded_css(output_dir)
    if downloaded_css:
        print(f"  Downloaded CSS collected: {len(downloaded_css):,} chars")

    # Step 2: Remove external <link> tags for downloaded CSS (we'll inline them)
    html = remove_external_stylesheet_links(raw_html, output_dir)

    # Step 3: Inject downloaded CSS into the document
    html = inject_downloaded_css(html, downloaded_css)

    # Step 4: Add <base> tag for unresolved relative URLs
    html = add_base_tag(html, source_url)

    # Step 4b: Strip scroll-blocking CSS from embedded iframes (Vimeo, YouTube, etc.)
    html = strip_scroll_blockers(html)

    # Step 5: Rewrite asset URLs to local paths (if assets were downloaded)
    if not assets_dir:
        assets_dir = os.path.join(output_dir, "downloaded-assets")

    asset_map = build_asset_map(output_dir, assets_dir)
    if asset_map:
        html = rewrite_asset_urls(html, asset_map)
        print(f"  Asset URLs rewritten: {len(asset_map)}")

    # Step 6: Write the clone
    clone_path = os.path.join(output_dir, "clone.html")
    with open(clone_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"\n  Clone written: {clone_path}")
    print(f"  Clone size: {os.path.getsize(clone_path):,} bytes")
    print(f"\n  Open in browser: file://{os.path.abspath(clone_path)}")

    return clone_path


# ─── CLI Entry Point ───────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 generate_clone.py <scrape.json> <output_dir> [--assets-dir <path>]")
        sys.exit(1)

    scrape_path = sys.argv[1]
    output_dir = sys.argv[2]

    assets_dir = None
    if "--assets-dir" in sys.argv:
        idx = sys.argv.index("--assets-dir")
        if idx + 1 < len(sys.argv):
            assets_dir = sys.argv[idx + 1]

    if not os.path.exists(scrape_path):
        print(f"ERROR: Scrape file not found: {scrape_path}")
        sys.exit(1)

    generate_clone(scrape_path, output_dir, assets_dir)
