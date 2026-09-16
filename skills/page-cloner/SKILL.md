---
name: page-cloner
description: Clone any existing website page by scraping it with Firecrawl and decomposing it into visual sections. Use when the user wants to replicate, clone, rebuild, or recreate an existing website page. Takes a URL, scrapes it with Firecrawl (rawHtml + full-page screenshot), then slices the screenshot into individual section images for processing. Trigger on phrases like "clone this page", "rebuild this site", "replicate this design", "extract this page", "analyze this site", or any URL + rebuild context.
---

# Page Cloner

Scrape an existing website page and decompose it into visual sections for rebuilding.

## Prerequisites

- **Firecrawl CLI** — installed via `npx firecrawl-cli` (no global install needed)
- **Python 3 + Pillow** — for screenshot slicing (`pip3 install Pillow`)
- **Firecrawl authentication** — check with `npx firecrawl-cli --status`

If Firecrawl is not authenticated, run: `npx firecrawl-cli login --browser`

## Workflow

### Step 1: Scrape the Page

```bash
mkdir -p .firecrawl/{domain}
npx firecrawl-cli scrape "{URL}" --format rawHtml --full-page-screenshot -o .firecrawl/{domain}/scrape.json
```

This returns:
- **rawHtml** — Full DOM with all markup, styles, scripts, and structure
- **screenshot** — Full-page screenshot (entire scrollable page, top to bottom)

The `{domain}` is derived from the URL (e.g., `floatfinancial.com` → `floatfinancial-com`).

### Step 2: Download & View the Screenshot

Download the full-page screenshot from the scrape data:

```bash
python3 skill/page-cloner/scripts/detect_sections.py --download .firecrawl/{domain}/scrape.json .firecrawl/{domain}/
```

This saves the screenshot locally as `fullpage-screenshot.png`.

**Now view the screenshot.** Look at the entire page top-to-bottom and identify every distinct visual section with:
- **y-pixel boundaries** (where each section starts and ends)
- **Section type** (navbar, hero, features, testimonial, cta, footer, etc.)
- **Brief description** of what the section contains

Write the section boundaries as JSON:

```json
{
  "page_description": "Brief page description",
  "image_width": 1920,
  "image_height": 11320,
  "sections": [
    {
      "section_index": 0,
      "y_start": 0,
      "y_end": 50,
      "section_type": "top-banner",
      "description": "Blue announcement banner with promo text",
      "background_color": "#049FDD",
      "layout": "full-width centered text"
    }
  ]
}
```

Save to `.firecrawl/{domain}/visual/llm_sections.json`.

### Step 3: Slice into Section Images

```bash
python3 skill/page-cloner/scripts/detect_sections.py --slice .firecrawl/{domain}/fullpage-screenshot.png .firecrawl/{domain}/visual/ --json .firecrawl/{domain}/visual/llm_sections.json
```

This validates the boundaries and crops the screenshot into individual section PNGs:

| Output | Contents |
|---|---|
| `visual/visual_sections.json` | Validated section boundaries + file paths |
| `visual/section_screenshots/` | Individual PNG per section (e.g., `section-02-hero.png`) |

### Step 4: Download Page Assets

```bash
python3 skill/page-cloner/scripts/download_assets.py .firecrawl/{domain}/scrape.json .firecrawl/{domain}/assets/
```

This scans the rawHtml for all asset URLs (images, videos, fonts, SVGs, backgrounds, favicons, OG images) and downloads them locally. Outputs:

| Output | Contents |
|---|---|
| `assets/` | All downloaded asset files |
| `assets/assets-manifest.json` | Manifest with URL, filename, role, size for each asset |

### Step 5: Generate the 1:1 HTML+CSS Clone

Generate a self-contained HTML file that is a pixel-perfect copy of the original page, viewable in any browser:

```bash
python3 skill/page-cloner/scripts/generate_clone.py .firecrawl/{domain}/scrape.json .firecrawl/{domain}/
```

This script ([scripts/generate_clone.py](scripts/generate_clone.py)):
1. Takes the raw HTML from the scrape
2. Collects all downloaded external CSS from `css/` and inlines it as `<style>` blocks
3. Removes the original external `<link>` stylesheet tags (since CSS is now embedded)
4. Adds a `<base>` tag so any remaining relative URLs resolve to the original domain
5. Rewrites image/asset URLs to point to local `downloaded-assets/` paths (if assets were downloaded)
6. Writes a single `clone.html` file

| Output | Contents |
|---|---|
| `clone.html` | Self-contained HTML+CSS page clone — open directly in a browser |

> **Note:** For the best result, run `download_assets.py` (Step 4) **before** generating the clone, so image URLs get rewritten to local paths. If assets haven't been downloaded, the clone will still work but images will load from the original remote URLs (requires internet).

**Optional: with explicit assets directory:**
```bash
python3 skill/page-cloner/scripts/generate_clone.py .firecrawl/{domain}/scrape.json .firecrawl/{domain}/ --assets-dir .firecrawl/{domain}/downloaded-assets/
```

### Step 6: Review with the User

Present the section inventory — show each section's screenshot with its type and description, plus the asset summary and the `clone.html` file. The user decides which sections to rebuild and how.

The rawHtml, per-section screenshots, downloaded assets, and the 1:1 clone together provide everything needed to recreate any section on any platform.

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Firecrawl returns empty | JavaScript-heavy SPA | Add `--wait-for 5000` to scrape command |
| Screenshot is viewport-only | Missing `--full-page-screenshot` flag | Ensure `--full-page-screenshot` is included (see Step 1) |
| Pillow not installed | Missing dependency | `pip3 install Pillow` |
