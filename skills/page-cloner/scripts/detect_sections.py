#!/usr/bin/env python3
"""
Page Cloner — Visual Section Detector

Two modes of operation:

  MODE 1 — LLM-in-the-loop (default, used by the skill workflow):
    The LLM (Claude) running the conversation views the full-page screenshot
    directly and produces section boundaries as JSON. The JSON is then piped
    into this script to slice the image.

    python3 detect_sections.py --slice <screenshot_path> <output_dir> < visual_sections.json

  MODE 2 — Standalone API call:
    Sends the screenshot to Claude's Vision API directly via curl, receives
    structured JSON with section boundaries, then slices.

    python3 detect_sections.py <screenshot_path> <output_dir> --api-key <key>
    python3 detect_sections.py --scrape-json <scrape.json> <output_dir> --api-key <key>

  HELPER — Download & prepare screenshot from scrape JSON:
    python3 detect_sections.py --download <scrape.json> <output_dir>

Outputs:
    output_dir/visual_sections.json     — Section boundaries + metadata
    output_dir/section_screenshots/     — Individual section PNG images

Prerequisites:
    - Pillow (pip install Pillow)
    - For MODE 2 only: ANTHROPIC_API_KEY env var or --api-key flag, curl
"""

import base64
import json
import os
import re
import subprocess
import sys
import tempfile

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip3 install Pillow")
    sys.exit(1)

try:
    from urllib.request import urlopen, Request
    from urllib.error import URLError
except ImportError:
    pass


# ─── Configuration ────────────────────────────────────────────────────────

MODEL = "claude-sonnet-4-5-20250929"
MAX_TOKENS = 8192

# Claude Vision processes images at max 1568px on the long edge.
# For very tall screenshots, we keep width reasonable and let the API resize.
# But if the image is enormous, we pre-scale to avoid hitting the 5MB API limit.
MAX_IMAGE_BYTES = 4_800_000  # Stay under 5MB API limit
MAX_LONG_EDGE = 8000         # Claude's hard limit


# ─── Prompt ───────────────────────────────────────────────────────────────

SECTION_DETECTION_PROMPT = """You are analyzing a full-page screenshot of a website. The image is {width}px wide and {height}px tall.

Your task is to identify every distinct visual section of this web page from top to bottom. A "section" is a visually distinct horizontal band of the page — separated by background color changes, spacing, content boundaries, or layout shifts.

For each section, provide:
- **y_start**: The y-pixel coordinate where this section begins (top edge)
- **y_end**: The y-pixel coordinate where this section ends (bottom edge)
- **section_type**: One of: top-banner, navbar, hero, logo-bar, features, testimonial, stats, comparison, video, cta, resources, pricing, faq, team, gallery, contact, footer, content, generic
- **description**: A brief description of what this section contains (e.g., "Hero with headline, subtitle, CTA button, and product screenshot")
- **background_color**: The dominant background color of the section (hex code or description like "white", "dark blue gradient")
- **layout**: Brief layout description (e.g., "centered text with image right", "3-column card grid", "full-width banner")

Rules:
1. Sections MUST cover the entire image height from y=0 to y={height} with NO gaps and NO overlaps.
2. Each section's y_end must equal the next section's y_start.
3. The first section starts at y_start=0 and the last section ends at y_end={height}.
4. Be precise with coordinates — look for visual boundaries like background color changes, horizontal rules, or significant spacing.
5. Minimum section height is around 40px (for thin banners). Most sections are 200-800px tall.
6. Navigation bars, announcement banners, and footers are their own sections.
7. If you see a section that combines features + testimonial, split them into separate sections."""


# ─── JSON Schema for Structured Output ────────────────────────────────────

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "page_description": {
            "type": "string",
            "description": "Brief overall description of the page"
        },
        "image_width": {"type": "integer"},
        "image_height": {"type": "integer"},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "section_index": {"type": "integer"},
                    "y_start": {"type": "integer"},
                    "y_end": {"type": "integer"},
                    "section_type": {"type": "string"},
                    "description": {"type": "string"},
                    "background_color": {"type": "string"},
                    "layout": {"type": "string"},
                },
                "required": [
                    "section_index", "y_start", "y_end",
                    "section_type", "description", "background_color", "layout"
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["page_description", "image_width", "image_height", "sections"],
    "additionalProperties": False,
}


# ─── Image Handling ───────────────────────────────────────────────────────

def load_screenshot(path_or_url, output_dir):
    """Load a screenshot from a file path or URL. Returns (PIL.Image, local_path)."""
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        print(f"Downloading screenshot...")
        req = Request(path_or_url, headers={"User-Agent": "Mozilla/5.0"})
        response = urlopen(req, timeout=30)
        img_data = response.read()

        local_path = os.path.join(output_dir, "fullpage-screenshot.png")
        with open(local_path, "wb") as f:
            f.write(img_data)

        from io import BytesIO
        img = Image.open(BytesIO(img_data))
        print(f"Downloaded: {img.size[0]}x{img.size[1]}px ({len(img_data)/1024:.0f} KB)")
        return img, local_path
    else:
        img = Image.open(path_or_url)
        return img, path_or_url


def prepare_image_for_api(img, local_path):
    """
    Prepare the image for the Claude API:
    - Ensure it's within size limits
    - Encode to base64
    Returns (base64_data, media_type, width, height)
    """
    width, height = img.size

    # Check if we need to resize (stay under 5MB and 8000px limit)
    file_size = os.path.getsize(local_path)

    if height > MAX_LONG_EDGE or width > MAX_LONG_EDGE or file_size > MAX_IMAGE_BYTES:
        # Scale down proportionally
        scale = min(
            MAX_LONG_EDGE / max(width, height),
            1.0
        )
        if file_size > MAX_IMAGE_BYTES:
            # Estimate needed scale based on file size (rough)
            size_scale = (MAX_IMAGE_BYTES / file_size) ** 0.5
            scale = min(scale, size_scale)

        new_width = int(width * scale)
        new_height = int(height * scale)
        print(f"Resizing for API: {width}x{height} → {new_width}x{new_height}")

        img_resized = img.resize((new_width, new_height), Image.LANCZOS)

        # Save to temp file
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        img_resized.save(tmp.name, "PNG", optimize=True)
        local_path = tmp.name
    else:
        new_width, new_height = width, height

    # Determine media type
    ext = local_path.rsplit(".", 1)[-1].lower()
    media_types = {
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "webp": "image/webp", "gif": "image/gif"
    }
    media_type = media_types.get(ext, "image/png")

    # Base64 encode
    with open(local_path, "rb") as f:
        b64_data = base64.standard_b64encode(f.read()).decode("utf-8")

    return b64_data, media_type, width, height


# ─── Claude Vision API Call ───────────────────────────────────────────────

def call_claude_vision(b64_data, media_type, width, height, api_key=None):
    """Send the screenshot to Claude Vision API and get section boundaries."""
    if not api_key:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ERROR: Anthropic API key not found.")
        print("Provide it via one of:")
        print("  1. --api-key <key> flag")
        print("  2. ANTHROPIC_API_KEY environment variable")
        print("  3. export ANTHROPIC_API_KEY=sk-ant-...")
        sys.exit(1)

    api_base = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")

    prompt = SECTION_DETECTION_PROMPT.format(width=width, height=height)

    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        "output_config": {
            "format": {
                "type": "json_schema",
                "schema": OUTPUT_SCHEMA,
            }
        },
    }

    # Write payload to temp file (base64 can be huge, avoid arg size limits)
    payload_file = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    )
    json.dump(payload, payload_file)
    payload_file.close()

    print(f"Calling Claude Vision API ({MODEL})...")
    print(f"  Image: {width}x{height}px, {len(b64_data)//1024} KB base64")

    try:
        result = subprocess.run(
            [
                "curl", "-s",
                f"{api_base}/v1/messages",
                "-H", f"x-api-key: {api_key}",
                "-H", "anthropic-version: 2023-06-01",
                "-H", "content-type: application/json",
                "-d", f"@{payload_file.name}",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
    finally:
        os.unlink(payload_file.name)

    if result.returncode != 0:
        print(f"ERROR: curl failed with code {result.returncode}")
        print(result.stderr)
        sys.exit(1)

    response = json.loads(result.stdout)

    if response.get("type") == "error":
        print(f"ERROR: API returned error:")
        print(json.dumps(response, indent=2))
        sys.exit(1)

    # Extract the structured JSON from the response
    content_text = response["content"][0]["text"]
    sections_data = json.loads(content_text)

    # Report token usage
    usage = response.get("usage", {})
    print(f"  Input tokens: {usage.get('input_tokens', '?')}")
    print(f"  Output tokens: {usage.get('output_tokens', '?')}")

    return sections_data


# ─── Image Slicing ────────────────────────────────────────────────────────

def slice_screenshot(img, sections, output_dir):
    """Slice the full-page screenshot into individual section images."""
    screenshots_dir = os.path.join(output_dir, "section_screenshots")
    os.makedirs(screenshots_dir, exist_ok=True)

    width, height = img.size

    for section in sections:
        y_start = max(0, section["y_start"])
        y_end = min(height, section["y_end"])

        if y_end <= y_start:
            print(f"  WARNING: Skipping section {section['section_index']} — invalid bounds ({y_start}-{y_end})")
            continue

        # Crop: (left, upper, right, lower)
        cropped = img.crop((0, y_start, width, y_end))

        section_type = section["section_type"].replace(" ", "-")
        filename = f"section-{section['section_index']:02d}-{section_type}.png"
        out_path = os.path.join(screenshots_dir, filename)
        cropped.save(out_path, "PNG")

        section["screenshot_file"] = f"section_screenshots/{filename}"
        section_height = y_end - y_start
        print(f"  [{section['section_index']:2d}] {section_type:15s} y:{y_start:5d}-{y_end:5d} ({section_height:4d}px) — {section['description'][:60]}")

    return sections


# ─── Validation ───────────────────────────────────────────────────────────

def validate_sections(sections, image_height):
    """Validate and fix section boundaries."""
    issues = []

    if not sections:
        issues.append("No sections detected")
        return sections, issues

    # Sort by y_start
    sections.sort(key=lambda s: s["y_start"])

    # Fix: first section should start at 0
    if sections[0]["y_start"] != 0:
        issues.append(f"First section starts at {sections[0]['y_start']}, adjusting to 0")
        sections[0]["y_start"] = 0

    # Fix: last section should end at image_height
    if sections[-1]["y_end"] != image_height:
        issues.append(f"Last section ends at {sections[-1]['y_end']}, adjusting to {image_height}")
        sections[-1]["y_end"] = image_height

    # Fix: ensure no gaps or overlaps between sections
    for i in range(1, len(sections)):
        prev_end = sections[i - 1]["y_end"]
        curr_start = sections[i]["y_start"]
        if curr_start != prev_end:
            # Split the difference
            midpoint = (prev_end + curr_start) // 2
            issues.append(
                f"Gap/overlap between sections {i-1} and {i}: "
                f"{prev_end} vs {curr_start}, adjusting to {midpoint}"
            )
            sections[i - 1]["y_end"] = midpoint
            sections[i]["y_start"] = midpoint

    # Re-index
    for i, section in enumerate(sections):
        section["section_index"] = i

    if issues:
        print(f"\n  Boundary fixes applied:")
        for issue in issues:
            print(f"    ⚠ {issue}")

    return sections, issues


# ─── Main Pipeline ────────────────────────────────────────────────────────

def detect_sections(screenshot_path, output_dir, api_key=None):
    """Main pipeline: load → send to Vision API → validate → slice → save."""

    os.makedirs(output_dir, exist_ok=True)

    # Load the screenshot
    img, local_path = load_screenshot(screenshot_path, output_dir)
    width, height = img.size
    print(f"Screenshot loaded: {width}x{height}px")

    # Prepare for API
    b64_data, media_type, orig_w, orig_h = prepare_image_for_api(img, local_path)

    # Call Claude Vision
    result = call_claude_vision(b64_data, media_type, orig_w, orig_h, api_key=api_key)

    print(f"\nPage: {result.get('page_description', 'N/A')}")
    print(f"Sections detected: {len(result['sections'])}")

    # Validate and fix boundaries
    sections, issues = validate_sections(result["sections"], height)

    # Slice into individual section images
    print(f"\nSlicing screenshot into section images...")
    sections = slice_screenshot(img, sections, output_dir)

    # Save results
    output = {
        "page_description": result.get("page_description", ""),
        "image_width": width,
        "image_height": height,
        "section_count": len(sections),
        "sections": sections,
        "validation_issues": issues,
    }

    output_path = os.path.join(output_dir, "visual_sections.json")
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"VISUAL SECTION DETECTION COMPLETE")
    print(f"{'='*60}")
    print(f"Sections: {len(sections)}")
    print(f"Output: {output_path}")
    print(f"Screenshots: {output_dir}/section_screenshots/")
    if issues:
        print(f"Boundary fixes: {len(issues)}")

    return output


# ─── CLI Entry Point ──────────────────────────────────────────────────────

def slice_from_json(screenshot_path, output_dir, json_input=None):
    """
    MODE 1: Slice a screenshot using pre-computed section boundaries.
    The LLM has already analyzed the image and produced the JSON.
    """
    os.makedirs(output_dir, exist_ok=True)

    # Load screenshot
    img, local_path = load_screenshot(screenshot_path, output_dir)
    width, height = img.size
    print(f"Screenshot loaded: {width}x{height}px")

    # Load section boundaries from JSON (stdin or file)
    if json_input:
        if os.path.isfile(json_input):
            with open(json_input) as f:
                sections_data = json.load(f)
        else:
            sections_data = json.loads(json_input)
    else:
        print("Reading section boundaries from stdin...")
        sections_data = json.load(sys.stdin)

    # Support both {sections: [...]} and bare [...]
    if isinstance(sections_data, list):
        sections = sections_data
    else:
        sections = sections_data.get("sections", [])

    print(f"Sections to slice: {len(sections)}")

    # Validate boundaries
    sections, issues = validate_sections(sections, height)

    # Slice
    print(f"\nSlicing screenshot into section images...")
    sections = slice_screenshot(img, sections, output_dir)

    # Save
    output = {
        "page_description": sections_data.get("page_description", ""),
        "image_width": width,
        "image_height": height,
        "section_count": len(sections),
        "sections": sections,
        "validation_issues": issues,
    }

    output_path = os.path.join(output_dir, "visual_sections.json")
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nOutput: {output_path}")
    print(f"Screenshots: {output_dir}/section_screenshots/")
    return output


def download_screenshot(scrape_json_path, output_dir):
    """Download the full-page screenshot from a Firecrawl scrape JSON and report its dimensions."""
    os.makedirs(output_dir, exist_ok=True)

    with open(scrape_json_path) as f:
        scrape_data = json.load(f)

    screenshot_url = scrape_data.get("screenshot", "")
    if not screenshot_url:
        print("ERROR: No screenshot URL found in scrape JSON")
        sys.exit(1)

    img, local_path = load_screenshot(screenshot_url, output_dir)
    width, height = img.size
    print(f"Screenshot saved: {local_path}")
    print(f"Dimensions: {width}x{height}px")
    print(f"\nThe LLM should now view this image and identify section boundaries.")
    print(f"Then run: python3 detect_sections.py --slice {local_path} {output_dir} --json <path_to_sections.json>")

    return local_path


def main():
    # Simple argument parser
    args = sys.argv[1:]
    api_key = None
    scrape_json = None
    slice_mode = False
    download_mode = False
    json_input = None
    positional = []

    i = 0
    while i < len(args):
        if args[i] == "--api-key" and i + 1 < len(args):
            api_key = args[i + 1]
            i += 2
        elif args[i] == "--scrape-json" and i + 1 < len(args):
            scrape_json = args[i + 1]
            i += 2
        elif args[i] == "--slice":
            slice_mode = True
            i += 1
        elif args[i] == "--download":
            download_mode = True
            i += 1
        elif args[i] == "--json" and i + 1 < len(args):
            json_input = args[i + 1]
            i += 2
        elif args[i] in ("-h", "--help"):
            print(__doc__)
            sys.exit(0)
        elif args[i].startswith("-"):
            print(f"Unknown flag: {args[i]}")
            sys.exit(1)
        else:
            positional.append(args[i])
            i += 1

    # MODE: Download screenshot from scrape JSON
    if download_mode:
        if len(positional) < 2:
            print("Usage: python3 detect_sections.py --download <scrape.json> <output_dir>")
            sys.exit(1)
        download_screenshot(positional[0], positional[1])
        return

    # MODE: Slice using pre-computed JSON (LLM-in-the-loop)
    if slice_mode:
        if len(positional) < 2:
            print("Usage: python3 detect_sections.py --slice <screenshot.png> <output_dir> [--json <sections.json>]")
            sys.exit(1)
        slice_from_json(positional[0], positional[1], json_input=json_input)
        return

    # MODE: Standalone API call
    if scrape_json:
        if len(positional) < 1:
            print("Usage: python3 detect_sections.py --scrape-json <scrape.json> <output_dir> [--api-key KEY]")
            sys.exit(1)

        output_dir = positional[0]

        with open(scrape_json) as f:
            scrape_data = json.load(f)

        screenshot_url = scrape_data.get("screenshot", "")
        if not screenshot_url:
            print("ERROR: No screenshot URL found in scrape JSON")
            sys.exit(1)

        detect_sections(screenshot_url, output_dir, api_key=api_key)
    elif len(positional) >= 2:
        screenshot_path = positional[0]
        output_dir = positional[1]
        detect_sections(screenshot_path, output_dir, api_key=api_key)
    else:
        print("Page Cloner — Visual Section Detector")
        print()
        print("Usage:")
        print("  # LLM-in-the-loop (skill workflow):")
        print("  python3 detect_sections.py --download <scrape.json> <output_dir>")
        print("  python3 detect_sections.py --slice <screenshot.png> <output_dir> --json <sections.json>")
        print()
        print("  # Standalone API call:")
        print("  python3 detect_sections.py <screenshot.png> <output_dir> [--api-key KEY]")
        print("  python3 detect_sections.py --scrape-json <scrape.json> <output_dir> [--api-key KEY]")
        sys.exit(1)


if __name__ == "__main__":
    main()
