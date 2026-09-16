---
name: wp-to-webflow-migration
description: Migrate any WordPress (or arbitrary CMS) website to Webflow by scraping its sitemap, fingerprinting every page section against a portable archetype library, and rebuilding the site as Webflow Components, CMS collections, and Pages. Use when the user wants to clone, migrate, port, or rebuild an existing site in Webflow at scale. Triggers include "migrate to Webflow", "rebuild this site in Webflow", "clone this WordPress site", "convert this site into Webflow components", "scrape and rebuild [URL]".
---

# WordPress → Webflow Migration

A two-phase workflow: **scrape & analyze** an existing site (Phase A), then **rebuild it in Webflow via the MCP** (Phase B). The first phase is a CLI tool that produces a deterministic build plan; the second phase is an LLM-driven sequence of MCP write operations against the user's Webflow site.

## When to invoke

The user is asking to migrate, port, clone, or rebuild an existing live website (WordPress, Squarespace, Webflow, custom CMS — anything with a sitemap) into a different Webflow site. Concretely:

- "Migrate `acme.com` to Webflow"
- "Build me a Webflow version of this WordPress site"
- "Clone the structure of `competitor.com/products` into our staging site"
- "Set up CMS collections from this site's sitemap"
- "Run the AI migration tool"

Do **not** invoke for: building a single net-new component (use a builder skill), tweaking an existing Webflow site, content edits, or any task that doesn't start from "I have a live URL I want to recreate."

## What this skill does

```
Phase A — Scrape & analyze (CLI)
  1. Discover    fetch sitemap, probe each URL, classify page builder
  2. Fingerprint detect section boundaries on each page; extract content + assets
  3. Match       score every section against a portable archetype library
  4. Vision      (optional) Claude vision fallback for medium/low-confidence matches
  5. Aggregate   cluster pages by component signature; rank archetypes site-wide
  6. Report      render a human-readable site-component-spec.md
  7. Build plan  emit build-plan.json — the contract for Phase B

Phase B — Rebuild in Webflow (MCP, LLM-driven)
  8. Promote build-plan archetypes to reusable Webflow Components (Hero, Feature Row, CTA, Footer, etc.) with typed props
  9. Mirror the original sitemap into Webflow Pages (preserving slugs)
  10. Model repeating content as CMS Collections with reference fields
  11. Upload referenced assets to Webflow CDN
  12. Place Component instances on each page and bind props from CMS items
```

The skill assumes **Phase A produces a deterministic plan** that Phase B consumes. You don't ad-hoc rebuild — you read `build-plan.json` and translate it into MCP write calls.

## Prerequisites

Before invoking, the user must have:

1. **Node 20+** and `pnpm` installed
2. **Anthropic API key** in `ANTHROPIC_API_KEY` (only needed for Phase A vision — DOM-only matching is free)
3. **A live URL with a public sitemap** — usually `https://acme.com/sitemap.xml` or `https://acme.com/page-sitemap.xml`
4. **A target Webflow site** they own and have connected the [Webflow MCP](https://developers.webflow.com/mcp/v1.0.0) to. The Designer must be open in a browser tab and brought to the foreground (the MCP daemon stops responding when the tab is backgrounded — this is the most common breakage).

If any of these are missing, ask before proceeding.

## Setup (run once per machine)

```bash
cd cli/
pnpm install
pnpm build
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env   # only needed for vision phase
```

The CLI is invoked as `pnpm ai-migrate <command>` from inside `cli/`.

## Phase A — Scrape & analyze workflow

For every site you migrate, ask the user for:

- **Sitemap URL** — e.g., `https://acme.com/sitemap.xml` (or `/page-sitemap.xml` if they use Yoast)
- **Domain slug** — short kebab-case identifier for output paths (e.g., `acme-com`)
- **Vision budget** — how many Claude API calls they want to spend on archetype-matching fallback (typical: 100–500). Set to 0 to skip vision entirely.

Then run, in order:

```bash
# 1. Discover (sitemap + URL probing) — ~10s for 100 URLs
pnpm ai-migrate discover --domain acme-com --sitemap https://acme.com/sitemap.xml --concurrency 8

# 2. Fingerprint (section detection + content extraction) — ~1–3 min for 100 pages
pnpm ai-migrate fingerprint --domain acme-com --concurrency 6

# 3. Match (DOM-rule scoring against the archetype library) — instant
pnpm ai-migrate match --domain acme-com

# 4. Vision (optional — use when match coverage is < 70%)
pnpm ai-migrate vision --domain acme-com --tiers medium,low,none --max-calls 200 --model claude-sonnet-4-5

# 5. Aggregate (cluster pages, rank archetypes, recommend Components/Collections)
pnpm ai-migrate aggregate --domain acme-com

# 6. Report (human-readable spec)
pnpm ai-migrate report --domain acme-com

# 7. Build plan (the contract for Phase B)
pnpm ai-migrate build-plan --domain acme-com
```

Or run all of Phase A end-to-end:
```bash
pnpm ai-migrate run --sitemap https://acme.com/sitemap.xml --domain acme-com
```

After Phase A, the user has:

```
output/acme-com/
├── discovery.json            # all URLs + page-builder classification
├── fingerprints.json         # every section on every page
├── matches.json              # archetype score per section (high/medium/low/none)
├── aggregate.json            # template families + recommended Components / CMS
├── site-component-spec.md    # human-readable summary
├── build-plan.json           # ← the contract for Phase B
└── sections/{section_id}/    # one folder per detected section, with content + assets
```

Hand the user `site-component-spec.md` for review before Phase B. They confirm the recommended Components and Collections, then you proceed.

## Phase B — Rebuild in Webflow via MCP

This is the LLM-driven phase. Read `references/mcp-build-workflow.md` for the full detailed contract. The high-level loop:

### B1. Site & page setup

Use the Webflow Data API tools to:
- `data_sites_tool list_sites` → confirm target site with the user
- `data_pages_tool list_pages` → snapshot existing pages (idempotency baseline)
- Identify a staging page where Components will be built (create one if none exists)

### B2. Components — promote archetypes to Webflow Components

For each entry in `build-plan.json.entries`:

1. **Idempotency**: if a Component with `entry.component_name` already exists, skip
2. **Push fragment**: `whtml_builder` push the bare HTML+CSS from the entry onto the staging page
3. **Locate root**: query for the element whose class includes the archetype prefix (the root has class `{archetype_id}__1`)
4. **Promote**: `de_component_tool transform_element_to_component` with `name`, `group`, `description` from the entry
5. **Open canvas**: `de_component_tool open_canvas` with the new component_id (required before inserting slots)
6. **Insert slots** for each `prop_def` where `use_slot: true`
7. **Create typed props** for each `prop_def` where `use_slot: false`:
   - `headline` / `subhead` / `body` → `textContent` (multiline for body/subhead)
   - `primary_cta` / `secondary_cta` / `ctas` → `link`
   - `media` / `image` → `image`
   - everything else → `string`

**Rules**:
- One component at a time. Do not batch `transform_element_to_component`.
- Surface MCP failures — never silent-skip.
- Do not push styles separately. The pasted `<style>` block already carries them.
- Webflow's MCP rejects `@keyframes`, `@font-face`, and non-standard `@media` queries — strip these from any CSS before pushing.

### B3. Pages — mirror the source sitemap

For each URL in `discovery.json` that isn't already a CMS item:
- `de_page_tool create_page` with `page_name = slug` (Webflow auto-generates `untitled-N` for the slug; fix in next step)
- After all creates, `data_pages_tool update_page_settings` to set the real slug and title
- For nested URLs (e.g., `/parent/child`), create `de_page_tool create_page_folder` first and pass `page_parent_folder_id`

### B4. CMS — model repeating content

For every entry in `aggregate.json.recommended_cms_collections`, plus any URL pattern that suggests repetition (`/blog/*`, `/case-studies/*`, parent-child paths like `/solutions/{slug}`):

1. `data_cms_tool create_collection` with `displayName`, `singularName`, `slug`
2. Add fields via `create_collection_static_field` (PlainText, RichText, Image, Link) and `create_collection_reference_field` (for taxonomies)
3. `create_collection_items` with the actual content from the source pages
4. CMS items at slug `xyz` will live at `/{collection-slug}/xyz`

### B5. Assets — upload via remote URL

For every unique image URL referenced in `fingerprints.json` `content.images`:
- `asset_tool upload_image_by_url` with the original WordPress URL — Webflow fetches it server-side
- Batch ~5 per call to keep responses snappy
- Map original URL → returned Webflow CDN URL for use in B6

### B6. Place Component instances on real pages

This is the v0.2 step. For each page in the source sitemap:
1. Find the matching Components for each section (from `matches.json`)
2. `de_component_tool insert_component_instance` to drop each Component instance onto the page
3. `de_component_tool set_component_instance_prop_values` to bind content

This step is the most tedious and least automated. In practice, hand-pick the highest-traffic pages first and bind props from `fingerprints.json` content bags.

## Hard rules for Phase B

- **Live MCP only** — no static export, no XSCP files
- **One Component at a time** — never batch the destructive `transform_element_to_component`
- **Surface every MCP failure** — never silently skip
- **Don't push styles to a Component twice** — pasting via `whtml_builder` already inlines the styles; calling `style_tool` afterward will conflict
- **Don't touch pre-existing Components** unless explicitly asked — read `data_components_tool list_components` first and de-dupe by name
- **`@keyframes`, `@font-face`, custom `@media` rules** — Webflow's MCP rejects these. Strip from CSS before every `whtml_builder` push.
- **Designer-tab foreground** — every Designer-side MCP call (`de_*`, `whtml_builder`, `asset_tool`) needs the user's Designer tab to be active. If you get "Unable to connect to Webflow Designer" three times in a row, stop and ask the user to bring it to the foreground; don't burn tokens retrying.

## Common failure modes & recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| `Unable to connect to Webflow Designer` | Designer tab is backgrounded or app is offline | Ask user to refocus the tab, then retry |
| `whtml_builder` rejects CSS with `@keyframes` | Webflow MCP doesn't allow keyframes | Strip `@(?:-webkit-\|-moz-)?keyframes\s+[^{]+\{...\}` blocks from CSS |
| `whtml_builder` accepts but page renders unstyled | `<style>` tag inside `html` param (not allowed) | Move CSS into the separate `css` parameter |
| `whtml_builder` succeeds but `update_page_settings` returns null parentId | Data API can't change a page's parent folder after create | Delete and recreate the page with the correct `page_parent_folder_id` |
| Page creates auto-assign `untitled-N` slugs | Webflow always auto-generates the slug from internal counter | Bulk-fix slugs via `data_pages_tool update_page_settings` after the create batch |
| Vision API timeouts during `vision` command | Anthropic concurrency limit | Reduce `--concurrency` to 2, batch `--max-calls` |
| `transform_element_to_component` complains the element isn't found | The element id was returned by a timed-out call (server-side success) | List page elements via `element_tool get_all_elements` and rediscover the id |

## Customizing the archetype library

The library at `cli/src/archetypes/library.json` ships with ~50 generic archetypes (hero variants, feature blocks, CTA bands, footers, FAQs, blog grids, etc.). To add a new one:

1. Run `pnpm ai-migrate fingerprint` and inspect `output/{domain}/curation-queue.json` for unmatched sections
2. Pick a recurring pattern, copy a similar archetype's JSON entry as a template
3. Tune the `match_rules.gates` (hard requirements) and `match_rules.dom`/`content` (soft scoring rules) to capture the pattern
4. Re-run `pnpm ai-migrate match` to verify coverage improves

Full authoring guide: `references/archetype-authoring.md`.

## Output integrity

After every migration run, verify:

- `data_pages_tool list_pages` returns at least the URL count from `discovery.json` (minus CMS items, plus pre-existing Webflow pages)
- `data_components_tool list_components` includes one entry per `build-plan.json.entries[]` (plus any pre-existing)
- The user can open the Webflow Designer, click any Component in the panel, and see typed props matching the spec

If any of these fail, surface the gap to the user with a remediation path — don't claim success.

## What this skill does NOT do

- Design overrides — visual styling beyond what's in the source CSS is the user's call after Phase B
- Webflow Interactions / animations — the source's GSAP/scroll animations don't translate; users add Interactions manually post-migration
- Form submissions — forms are placed structurally, but binding submission handlers is post-migration
- Email/Slack/CRM integrations — out of scope; only the visible page structure is migrated
- Localization — single-locale only

## See also

- `references/pipeline-overview.md` — detailed phase-by-phase walkthrough
- `references/archetype-authoring.md` — how to add a new archetype
- `references/mcp-build-workflow.md` — full Phase B specification (the v0.1 contract)
- `cli/README.md` — CLI command reference
