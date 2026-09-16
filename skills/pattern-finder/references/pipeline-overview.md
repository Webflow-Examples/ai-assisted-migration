# Pipeline overview

End-to-end walkthrough of the migration pipeline, phase by phase.

## Phase A — analyze (CLI, deterministic)

```
URL → Discovery → Fingerprint → Match → (Vision) → Aggregate → Report → Build plan
```

### 1. Discovery (`pnpm ai-migrate discover`)

**Input**: a sitemap URL (or a newline-delimited URL list file)
**Output**: `output/{domain}/discovery.json`

For each URL, the discovery probe:
- Issues a HEAD/GET request and records HTTP status
- Inspects HTML for **page-builder fingerprints** (Elementor, Divi, Beaver Builder, Gutenberg, Webflow, custom)
- Captures `<body>` class list (used as a feature for matching)
- Classifies the URL as "utility" (404, search, login) vs "content" — utilities skip later phases

Concurrency: tunable via `--concurrency` (default 8). 100 URLs in ~10 seconds.

### 2. Fingerprint (`pnpm ai-migrate fingerprint`)

**Input**: `discovery.json`
**Output**: `output/{domain}/fingerprints.json` + `output/{domain}/sections/{section_id}/`

For each non-utility URL:
- Fetches the rendered HTML
- Detects **section boundaries** using a layered strategy:
  1. Builder-specific markers (e.g., `data-element_type="section"` for Elementor, `<div class="et_pb_section">` for Divi, `<section class="wp-block-*">` for Gutenberg)
  2. Semantic HTML (`<section>`, `<header>`, `<footer>`, `<main>` direct children)
  3. Top-level children of the main content wrapper
- For each detected section, extracts:
  - **Layout signature** — `single`, `stack`, `two-col`, `grid-N`, `carousel`, `accordion`, `tabs`
  - **Class features** — informative class names (filtered against utility soup like `css-abc123`, `mt-4`, `elementor-element-{hash}`)
  - **Content bag** — headings, paragraphs, images (with `alt` and dimensions), links, buttons, forms, lists, plus aggregated word/image/link counts
  - **Section HTML** — cleaned `outerHTML` with scripts, styles, and event handlers stripped
  - **Builder block type** — e.g., `elementor:hero-section.boxed-text`
  - **Asset URLs** — every `<img>`, `<source>`, and CSS background reference; downloaded to the section's `assets/` folder

Per-section bundles are written to `sections/{section_id}/`:
```
sections/{section_id}/
├── metadata.json     # layout, position, builder type, word/image counts
├── content.json      # headings, paragraphs, images, links, buttons, forms
├── section.html      # cleaned outerHTML
└── assets/           # downloaded images
```

Concurrency: tunable via `--concurrency` (default 6). 100 pages in 1–3 minutes.

### 3. Match (`pnpm ai-migrate match`)

**Input**: `fingerprints.json` + the archetype library (`cli/src/archetypes/library.json`)
**Output**: `output/{domain}/matches.json`

For every section × every archetype pair, score the match:

1. **Gates check** (binary). If any gate fails → confidence = 0, skip to next archetype.
   - `position_index_max: 6` — section must appear in the first 7 sections of the page
   - `child_layout_any: ["two-col"]` — layout must match
   - `heading_count_min: 1`, `image_count_min: 1` — content thresholds
   - `must_have: { has_form: false }` — boolean asserts

2. **DOM rules** (soft, weighted). Each rule contributes points if it passes:
   - `child_layout: ["two-col", "grid-3"]`
   - `must_contain_class: ["hero", "feature"]`
   - `builder_block_type_includes: ["elementor:hero"]`

3. **Content rules** (soft). Same shape, applied to the content bag:
   - `min_headings: 1`, `max_words: 200`
   - `min_images: 1`, `min_links: 1`

4. **Final confidence**:
   ```
   confidence = (w.dom × dom_passed + w.content × content_passed) / (denominator + padding)
   ```
   - `confidence_weights` are per-archetype (default 0.5/0.5)
   - Padding ensures low-rule archetypes can't trivially hit 1.0

5. **Tier classification**:
   - `high` ≥ 0.8
   - `medium` 0.5–0.8
   - `low` 0.3–0.5
   - `none` < 0.3

The result `matches.json` has one entry per section with: `archetype_id`, `confidence`, `tier`, `top_5_candidates`. Sections in tiers `medium`/`low`/`none` go to a `curation-queue.json` for the optional vision phase.

### 4. Vision (optional, `pnpm ai-migrate vision`)

**Input**: `matches.json` + `curation-queue.json`
**Output**: `vision-cache.json`, then merged back into `matches.json`

For each section in tiers `medium`/`low`/`none`:
- Compose a prompt with: the section's cleaned HTML (truncated to 6000 chars), structural summary (word count, image count, position, builder type), and top-5 DOM-matched archetype candidates as multiple-choice
- Call Claude with the user-specified model (`--model claude-sonnet-4-5` default)
- Parse the JSON response: `{"archetype_id": "...", "confidence": 0..1, "reason": "..."}`
- Merge into `matches.json` with `archetype_source: "merged"` (DOM + vision)

Caching:
- `--cache <file>` reads pre-computed classifications, skipping API calls for cached sections
- `--cache-only` runs purely from cache (no API calls)
- `--dry-run` echoes the top DOM candidate as a fake vision result (for testing)

Budget controls:
- `--max-calls <n>` hard cap (default 500)
- `--concurrency <n>` parallel API calls (default 4)

Typical cost: ~$0.50–$3 per site for a 200-call run with Claude Sonnet.

### 5. Aggregate (`pnpm ai-migrate aggregate`)

**Input**: `fingerprints.json` + `matches.json`
**Output**: `output/{domain}/aggregate.json`

- Cluster pages by **archetype signature** — pages with the same set of high-confidence archetypes form a "template family"
- Build a **frequency table** — how often each archetype appears across the site
- **Recommend Components**: archetypes that appear in ≥ 3 template families
- **Recommend CMS Collections**: archetypes that repeat with content variation across pages (e.g., blog cards, case study cards, testimonials)
- **One-off sections**: archetypes that appear only once — surface for designer review

### 6. Report (`pnpm ai-migrate report`)

**Input**: `aggregate.json`
**Output**: `output/{domain}/site-component-spec.md`

Human-readable markdown summarizing:
- Total pages, sections, high-confidence match coverage
- Recommended Components (with occurrence counts)
- Recommended CMS Collections
- Template families
- One-off sections to review

This is the artifact you hand the user before starting Phase B.

### 7. Build plan (`pnpm ai-migrate build-plan`)

**Input**: `aggregate.json` + `matches.json` + section bundles
**Output**: `output/{domain}/build-plan.json`

For each recommended Component, picks a **canonical section** (highest-confidence example), extracts:
- `archetype_id`, `component_name`, `component_group`, `component_description`
- `canonical_source_url` — the page it came from
- `section_html` — bare HTML for `whtml_builder` push
- `slots[]` — slot definitions: `name`, `selector`, `cardinality`, optional `example`
- `prop_definitions[]` — per slot: `slot_name`, `webflow_type`, `use_slot`, optional `default_value`, `multiline`
- `families_in_site`, `occurrences_in_site` — for prioritization
- `assets[]` — every image URL referenced in the section

This is the **contract** Phase B reads.

### Optional: Capture styles (`pnpm ai-migrate capture-styles`)

**Output**: `styles.json` per section bundle

Visits every page with **Playwright**, samples computed CSS at three breakpoints (1280, 991, 479), per element selector (`@root`, `div:nth-child(1)`, etc.). Useful for high-fidelity visual replication; adds 30–60s per page.

### Optional: Emit / Clone export

```bash
pnpm ai-migrate emit-export   --domain acme-com    # bare HTML+CSS fragments per Component
pnpm ai-migrate clone-export  --domain acme-com    # 1:1 source HTML+CSS with original classes
pnpm ai-migrate preview       --domain acme-com    # standalone HTML pages for browser preview
```

**emit-export**: pushes through `whtml_builder` cleanly (synthetic `archetype_id__N` classes, minimal CSS).
**clone-export**: preserves source markup and CSS — for visual fidelity reference, but not directly Webflow-compatible.
**preview**: wraps clones in standalone HTML pages with `<head>` boilerplate so designers can browse the entire migration in one folder.

## Phase B — rebuild (LLM + MCP, judgment-driven)

See `references/mcp-build-workflow.md` for the detailed Phase B contract. High-level:

1. **Site/page setup** — list sites, choose target, create staging page
2. **Component creation** — for each `build-plan.entries[]`: push fragment, locate root, promote, insert slots, create typed props
3. **Page mirroring** — for each `discovery.json` URL: create page with original slug, nest under page folders for multi-level paths
4. **CMS modeling** — for each `aggregate.recommended_cms_collections[]`: create collection, define fields, populate items
5. **Asset upload** — `upload_image_by_url` every unique image URL from `fingerprints.json`
6. **Page assembly** — drop Component instances on each page, bind props from CMS items

Phase B is significantly more brittle than Phase A. Common failure modes and recovery paths are documented in `SKILL.md`.

## File size & performance ballpark

| Site size | Discovery | Fingerprint | Match | Vision (200 calls) | Aggregate+Report+Build | Total |
|---|---|---|---|---|---|---|
| 50 pages | 5s | 1m | <1s | 90s | 3s | ~3 min |
| 200 pages | 30s | 4m | <1s | 90s | 8s | ~6 min |
| 500 pages | 1m | 12m | <1s | 90s | 15s | ~14 min |

Disk usage scales linearly with section count: ~1 MB per page (HTML, content, assets, and per-breakpoint computed styles if captured).
