# Phase B — Webflow MCP build workflow

The detailed contract Phase B follows. This document is read by the LLM driving Phase B — every step here translates to one or more MCP tool calls.

## Inputs (from Phase A)

```
output/{domain}/
├── discovery.json         # source site URLs + builder classification
├── fingerprints.json      # per-section content + structure
├── matches.json           # archetype scores
├── aggregate.json         # template families + Component / CMS recommendations
└── build-plan.json        # the contract — recommended Components with all metadata
```

## Outputs (to the user's Webflow site)

- N reusable Webflow Components in the Components panel (one per `build-plan.entries[]`)
- M static Pages mirroring `discovery.json` (preserving slugs)
- 0 or more CMS Collections from `aggregate.recommended_cms_collections`
- All referenced images uploaded to the Webflow asset library
- (Optional) Component instances placed on real pages with bound props

## Required MCP capabilities

The Phase B LLM platform must expose (at minimum) the **Webflow MCP** tools listed below. These are the tool names from the Webflow MCP package.

### Read (data API — works without Designer)

- `data_sites_tool list_sites` — site selection
- `data_pages_tool list_pages` — page inventory + idempotency baseline
- `data_components_tool list_components` — Component inventory + idempotency

### Read (Designer — requires Designer tab in foreground)

- `element_tool get_all_elements` — page element tree
- `element_tool query_elements` — find element by class/text/tag
- `de_component_tool get_all_components` / `get_component`

### Write (Data API — reliable, no Designer dependency)

- `data_pages_tool update_page_settings` — fix slugs, titles, SEO
- `data_cms_tool create_collection` / `create_collection_static_field` / `create_collection_reference_field` / `create_collection_items`
- `asset_tool upload_image_by_url` — fetches remote image server-side and uploads to Webflow CDN

### Write (Designer — flaky, requires Designer foreground)

- `whtml_builder` — push raw HTML+CSS onto the active page
- `de_page_tool create_page` / `create_page_folder` / `switch_page`
- `de_component_tool transform_element_to_component` / `open_canvas` / `insert_slot` / `create_prop` / `insert_component_instance`
- `element_tool remove_element`
- `style_tool` (rarely used — pasted CSS via `whtml_builder` is preferred)

## Step B1 — Site & page setup

```pseudocode
// 1. Confirm site
sites = data_sites_tool.list_sites()
target = sites.where(displayName matches user-named target)
confirm with user before any writes

// 2. Idempotency baselines
existing_pages = data_pages_tool.list_pages(site_id=target.id, limit=200)
existing_components = data_components_tool.list_components(site_id=target.id, limit=100)

// 3. Locate or create staging page
staging = existing_pages.find(p => p.slug === "component-staging")
if not staging:
  staging = de_page_tool.create_page(siteId, page_name="Component Staging")
de_page_tool.switch_page(siteId, page_id=staging.id)

// 4. Get body element id (parent for whtml_builder pushes)
elements = element_tool.get_all_elements(siteId)
body = elements.where(type === "Body")
```

## Step B2 — Components

For each `entry` in `build-plan.json.entries`:

### B2.1. Idempotency check

```pseudocode
if existing_components.any(c => c.name === entry.component_name):
  print("→ skip (exists)")
  continue
```

### B2.2. Push the bare fragment

```pseudocode
// Strip any <style> tags from html, route CSS via the css param
html = strip_style_tags(entry.section_html)
css = collect_css_for_archetype(entry.archetype_id)
css = strip_keyframes_and_fontface(css)
css = strip_unsupported_media_queries(css)  // keep only 991/767/479 max-widths

result = whtml_builder({
  siteId: target.id,
  parent_element_id: body.id,
  creation_position: "append",
  html: html,
  css: css
})

root_element_id = result.id
```

### B2.3. Promote to Component

```pseudocode
component = de_component_tool.transform_element_to_component({
  siteId: target.id,
  id: root_element_id,
  name: entry.component_name,
  group: entry.component_group,
  description: entry.component_description
})
component_id = component.id
```

### B2.4. Open the Component canvas

`insert_slot` and `create_prop` only work inside the Component editing context.

```pseudocode
de_component_tool.open_canvas({siteId: target.id, component_id})
```

### B2.5. Insert slots

For each `prop_def` in `entry.prop_definitions` where `use_slot === true`:

```pseudocode
// Find natural slot container — usually the immediate parent of the
// repeating items (e.g., for a card grid, the grid wrapper)
container = element_tool.query_elements({
  queries: [{
    label: "container",
    element_filter: { style: archetype_id_prefix + "__N" }  // pick by inspection
  }]
})

de_component_tool.insert_slot({
  siteId: target.id,
  parent_element_id: container.id,
  position: "append"
})
```

The slot container is the only place LLM judgment is required. For most archetypes the container is the immediate parent of the repeating elements.

### B2.6. Create typed props

For each `prop_def` in `entry.prop_definitions` where `use_slot === false`:

```pseudocode
type_map = {
  "headline":     "textContent",
  "subhead":      "textContent" + multiline,
  "body":         "textContent" + multiline,
  "primary_cta":  "link",
  "secondary_cta": "link",
  "ctas":         "link",
  "media":        "image",
  "image":        "image",
  "copyright":    "textContent" + multiline,
  // everything else falls back to "string"
}

for prop in entry.prop_definitions where !use_slot:
  webflow_type = type_map[prop.slot_name] || "string"
  de_component_tool.create_prop({
    siteId: target.id,
    component_id,
    props: [{
      type: webflow_type,
      name: prop.slot_name,
      // skip default_link — Webflow MCP times out on it
      default_text: prop.default_value ? {value: prop.default_value, multiline: prop.multiline} : undefined
    }]
  })
```

**Critical**: do NOT pass `default_link` for `link`-type props — the Webflow MCP times out on link-default payloads. Set link defaults manually in Designer afterwards.

### B2.7. Confirm

Print one line: `✓ {component_name} (id=…) · N props · M slots`

### B2.8. Switch back to staging

```pseudocode
de_component_tool.open_canvas({siteId: target.id, page_id: staging.id})
```

## Step B3 — Pages

For each URL in `discovery.json.entries`:

### B3.1. Compute slug + parent path

```pseudocode
slug = url.pathname.replace(/^\//, "").replace(/\/$/, "") || "home"
parent_segments = slug.split("/").slice(0, -1)
leaf_slug = slug.split("/").pop()
```

### B3.2. Skip conflicts

```pseudocode
if existing_pages.any(p => p.slug === slug):
  print("→ skip (slug exists)")
  continue
```

### B3.3. Create page folders for nested paths

For each segment in `parent_segments` (build top-down):

```pseudocode
folder = de_page_tool.create_page_folder({
  siteId: target.id,
  page_folder_name: segment,
  page_folder_parent_id: parent_folder_id  // null for top-level
})

// Webflow auto-assigns "untitled-N" as folder slug — fix it
data_pages_tool.update_page_settings({
  page_id: folder.id,
  body: { id: folder.id, slug: segment }
})
```

### B3.4. Create the page

```pseudocode
page = de_page_tool.create_page({
  siteId: target.id,
  page_name: leaf_slug,
  meta_title: leaf_slug,
  page_parent_folder_id: deepest_folder_id  // or omit for root pages
})
```

### B3.5. Bulk-fix slugs (after all pages created)

Webflow auto-generates `untitled-N` slugs at create time. After creating all pages in a batch, fix slugs in one pass:

```pseudocode
for created_page in batch:
  data_pages_tool.update_page_settings({
    page_id: created_page.id,
    body: { id: created_page.id, slug: created_page.intended_slug, title: title }
  })
```

This is dramatically more reliable than fixing slugs one-at-a-time during creation, because the data API is stable while the Designer-side create_page is flaky.

### B3.6. Known data-API limitation

The data API's `update_page_settings` **cannot change a page's `parentId`** after creation. If a page lands at the wrong nesting level (because the Designer batch dropped the `page_parent_folder_id`), the only fix is delete-and-recreate via the Designer.

## Step B4 — CMS Collections

For each entry in `aggregate.json.recommended_cms_collections`:

### B4.1. Create the collection

```pseudocode
collection = data_cms_tool.create_collection({
  siteId: target.id,
  request: {
    displayName: entry.display_name,    // e.g. "Solutions"
    singularName: entry.singular_name,  // e.g. "Solution"
    slug: entry.collection_slug         // e.g. "solutions" → items live at /solutions/{slug}
  }
})
```

Webflow auto-creates a `Name` (PlainText, required) and `Slug` (PlainText, required) field.

### B4.2. Add fields

```pseudocode
// For each field defined in the Collection's content_schema:
data_cms_tool.create_collection_static_field({
  collection_id: collection.id,
  request: {
    type: "PlainText" | "RichText" | "Image" | "Link" | "Number" | "DateTime" | "Switch",
    displayName: "Headline" | "Body" | "Hero image" | "Source URL"
  }
})

// For category-style references to another collection:
data_cms_tool.create_collection_reference_field({
  collection_id: collection.id,
  request: {
    type: "Reference",   // or "MultiReference"
    displayName: "Category",
    metadata: { collectionId: parent_collection.id }
  }
})
```

### B4.3. Populate items

```pseudocode
// Source: matching pages from discovery.json + content from fingerprints.json
items = []
for url in collection.member_urls:
  page = fingerprints.json.entries[url]
  items.push({
    name: page.title,
    slug: url.path.split("/").pop(),
    headline: extract_headline(page.sections),
    body: extract_body_richtext(page.sections),
    "hero-image": extract_hero_image_url(page.sections),
    "source-url": url.full,    // plain URL string, not an object
    category: parent_item_id || undefined
  })

data_cms_tool.create_collection_items({
  collection_id: collection.id,
  request: { fieldData: items, isDraft: false }
})
```

**Critical**: Link fields accept the URL as a **plain string**, not an object. Passing `{url: "..."}` returns a `validation_error`.

### B4.4. CMS-vs-static decision

Not every URL pattern should become a CMS Collection. Use:

- **CMS** when there's a parent path with multiple sibling pages sharing structure: `/solutions/*`, `/case-studies/*`, `/blog/*`, `/team/*`
- **Static** when each URL is unique top-level marketing content: `/about`, `/contact`, `/equipment-monitoring`

The aggregate output recommends collections heuristically; ask the user to confirm before creating.

## Step B5 — Assets

```pseudocode
// Collect every unique image URL across fingerprints
all_image_urls = unique(fingerprints.json.entries[*].sections[*].content.images[*].src)

// Filter out data: URIs and placeholders
real_urls = all_image_urls.filter(u => u.startsWith("http") && !u.includes("placehold"))

// Batch upload via remote URL — Webflow fetches server-side
for batch in chunks(real_urls, 5):
  asset_tool.upload_image_by_url({
    siteId: target.id,
    actions: batch.map(url => ({
      label: derive_filename(url),
      upload_image_by_url: {
        url: encode_special_chars(url),  // ©, spaces → %C2%A9, %20
        asset_name: derive_friendly_name(url),
        alt_text: extract_alt_from_fingerprints(url)
      }
    }))
  })
```

The returned `cdn.prod.website-files.com` URL is what you use in B6 when binding image props.

## Step B6 — Page assembly (v0.2)

For each page in `discovery.json` mapped to a template family:

### B6.1. Switch to the page

```pseudocode
de_page_tool.switch_page({siteId: target.id, page_id: page.id})
body = element_tool.get_all_elements()[0]
```

### B6.2. Insert Component instances per section

For each section in `fingerprints.json.entries[page.url].sections`:

```pseudocode
matched_archetype = matches.json[section.id].archetype_id
component = existing_components.find(c => c.name === archetype_to_component_name[matched_archetype])

instance = de_component_tool.insert_component_instance({
  siteId: target.id,
  parent_element_id: body.id,
  component_id: component.id,
  creation_position: "append"
})

// Bind prop values
prop_values = []
for prop in component.props:
  source_value = section.content[prop.slot_name] || section.content_schema[prop.slot_name]
  if prop.type === "image":
    prop_values.push({prop_id: prop.id, type: "string", string_value: webflow_cdn_url_for(source_value)})
  else if prop.type === "link":
    prop_values.push({prop_id: prop.id, type: "link", link_mode: "url", link_to: source_value})
  else:
    prop_values.push({prop_id: prop.id, type: "string", string_value: source_value})

de_component_tool.set_component_instance_prop_values({
  siteId: target.id,
  element_id: instance.id,
  values: prop_values
})
```

This step is the most LLM-judgmental and the least automated. Recommend hand-picking the highest-traffic pages first.

## Idempotency

Phase B should be safely **re-runnable**. Before any write, check:

- Components: `data_components_tool list_components` → skip if name exists
- Pages: `data_pages_tool list_pages` → skip if slug exists
- CMS items: `data_cms_tool list_collection_items` → skip if slug exists in collection
- Assets: `asset_tool get_all_assets_and_folders` → skip if asset name exists

In practice, Webflow CDN names are de-duplicated automatically (returning the existing asset id), but page/component/CMS-item names are not — explicit checks required.

## Hard rules (recap)

- **One Component at a time** — never batch `transform_element_to_component`
- **No `default_link`** — set link defaults in Designer manually
- **Strip `@keyframes`, `@font-face`, custom `@media`** before every `whtml_builder` push
- **No `<style>` tags inside `whtml_builder.html`** — use the `css` param
- **Designer foreground required** for every Designer-side write — surface failures immediately rather than retrying
- **Don't change page parent via data API** — it's a no-op; recreate via Designer if mis-nested
- **Every MCP failure surfaces** — never silent-skip, never hide errors

## Recovery protocols

| Failure | Recovery |
|---|---|
| Designer disconnect (3+ retries) | Pause and ask user to refocus the Designer tab |
| `transform_element_to_component` "element not found" | List page elements, find by class, retry with new id |
| `whtml_builder` rejects CSS | Strip more aggressively (gzip-style scan for unsupported rules) |
| Page-folder slug ends up `untitled-N` | `update_page_settings` to fix slug right after create |
| CMS link field "Expected value to be a valid URL string" | Caller passed `{url: "..."}` — pass plain string |
| Asset upload "ascii codec can't encode" | URL has `©`/`®`/etc. — URL-encode before passing |

## See also

- `SKILL.md` — top-level skill instructions
- `references/pipeline-overview.md` — Phase A details
- `cli/src/build/buildPlan.ts` — how `build-plan.json` is generated
