# Archetype authoring guide

The archetype library at `cli/src/archetypes/library.json` is the matcher's brain. Each archetype is a declarative spec describing a recurring section pattern — a hero, a feature row, a footer, etc. — with rules that tell the matcher what counts as that pattern.

This guide is for adding new archetypes after a migration run surfaces unmatched recurring sections.

## When to add a new archetype

After running Phase A on a new site, inspect:

1. `output/{domain}/curation-queue.json` — sections that scored medium/low/none
2. `output/{domain}/aggregate.json.one_off_sections` — patterns that didn't repeat enough to be Components

Look for **recurring unmatched patterns** — sections with similar layouts and content shapes appearing on multiple pages but not matching any current archetype. Those are the candidates.

If a pattern only appears once, it's not a Component candidate — it's a one-off and stays as a static section in the Webflow build.

## Anatomy of an archetype

```json
{
  "id": "feature-grid-3",
  "version": "1",
  "display_name": "Feature grid — 3 cards",
  "category": "features",
  "description": "Three-column feature cards with icon/image + heading + body",
  "match_rules": {
    "gates": {
      "child_layout_any": ["grid-3"],
      "image_count_min": 3,
      "heading_count_min": 3,
      "must_have": { "has_form": false }
    },
    "dom": {
      "child_layout": ["grid-3"],
      "must_contain_class": ["card", "feature"]
    },
    "content": {
      "min_headings": 3,
      "min_images": 3,
      "min_words": 30
    }
  },
  "confidence_weights": { "dom": 0.4, "content": 0.6 },
  "vision_prompt_hint": "Three-column row of feature cards. Each card has an icon or image at top, a short heading, and 1–2 lines of supporting copy.",
  "content_schema": {
    "cards": {
      "selector": ".card, .feature",
      "cardinality": "3..*",
      "example": "Each card includes a small icon, a 2–4 word headline, and a 1–2 sentence body."
    }
  }
}
```

### Field by field

| Field | Type | Purpose |
|---|---|---|
| `id` | string (kebab-case) | Stable identifier. Used to build CSS prefixes for emitted Webflow markup. Never rename without a migration. |
| `version` | string | Track revisions (e.g., bump to `"2"` when match rules change). |
| `display_name` | string | Human-readable name shown in spec, used as the Webflow Component name in the build plan. |
| `category` | string | Loose grouping: `hero`, `nav`, `features`, `cta`, `testimonial`, `footer`, `header`, `faq`, `content`, etc. |
| `description` | string | Short marketing-style description shown in the Component panel. |
| `match_rules.gates` | object | **Hard requirements** — any failure → confidence 0. Use sparingly; prefer soft scoring. |
| `match_rules.dom` | object | **Soft DOM scoring** — class names, layout, builder type. Each rule that passes adds points. |
| `match_rules.content` | object | **Soft content scoring** — heading/image/link/word counts on the content bag. |
| `confidence_weights` | object | Relative weight of DOM vs content scoring. Default `{dom: 0.5, content: 0.5}`. Use `{dom: 0.7}` for visually-distinctive layouts; `{content: 0.7}` for content-driven patterns. |
| `vision_prompt_hint` | string | One-sentence description fed to Claude during the vision phase to disambiguate from siblings. |
| `content_schema` | object | Slot definitions — what the rebuilder Should bind. Each entry: `selector`, `cardinality`, optional `example`. |

### Available rule keys

#### `gates` (binary — fail any → confidence 0)

- `position_index_max: number` — section must be one of the first N on the page
- `position_index_min: number` — section must appear after the first N
- `child_layout_any: string[]` — `single`, `stack`, `two-col`, `grid-N`, `carousel`, `accordion`, `tabs`
- `heading_count_min: number`, `heading_count_max: number`
- `image_count_min: number`, `image_count_max: number`
- `link_count_min: number`, `link_count_max: number`
- `word_count_min: number`, `word_count_max: number`
- `must_have: { has_form?: bool, has_video?: bool, has_carousel?: bool, has_accordion?: bool, has_tabs?: bool }`

#### `dom` (soft — each match adds points)

- `child_layout: string[]` — softer version of `child_layout_any`
- `must_contain_class: string[]` — at least one class feature contains any of these substrings
- `must_not_contain_class: string[]`
- `builder_block_type_includes: string[]` — `elementor:hero-section`, `divi:row`, `gutenberg:cover`, etc.

#### `content` (soft, applied to the content bag)

- `min_headings`, `max_headings`
- `min_images`, `max_images`
- `min_links`, `max_links`
- `min_words`, `max_words`

## Authoring workflow

### 1. Pick a target

From `curation-queue.json`, find a recurring pattern. A real example:

> Sections appearing on 4 different pages, all matching `position_index: 0..2`, `child_layout: stack`, `image_count: 1`, `heading_count: 1`, `link_count: 0..1`, with class features including `hero` and `centered`.

That's a candidate for `hero-centered-headline` (or whatever name fits).

### 2. Find the closest existing archetype

Open `cli/src/archetypes/library.json` and find an archetype in the same category. Copy its JSON entry as a template.

### 3. Tune the rules

Use the actual section data to set thresholds:
- For each rule field, look at the matched sections' fingerprint values and set min/max with some margin
- Set gates to **must-true** invariants (e.g., this archetype always has at least 1 image)
- Set DOM/content rules to **likely-true** signals (e.g., usually class includes "hero", usually 1 heading)

### 4. Add to the library

Append to the array in `cli/src/archetypes/library.json`. Keep the file sorted by category.

### 5. Re-run the matcher

```bash
pnpm ai-migrate match --domain acme-com
pnpm ai-migrate aggregate --domain acme-com
```

Inspect `matches.json` for the new archetype's coverage. Iterate gates if it over-matches (catches sections that aren't really this pattern) or under-matches (misses obvious instances).

### 6. (Optional) Test against another site

Run the same matcher on a different scraped site to verify the new archetype generalizes. If it only matches for one site, it's probably too specific — relax the gates.

## Common pitfalls

- **Over-fitting to one site's class names** — `must_contain_class: ["my-special-hero-class"]` will only match that one site. Prefer generic substrings: `["hero"]`, `["feature"]`, `["card"]`.
- **Gates that are too strict** — if `image_count_min: 4` filters out 80% of valid matches because some pages strip an image, lower it.
- **Confidence weights that mask weak rules** — if DOM scoring is 0/2 but content is 5/5, `weights = {dom: 0.5, content: 0.5}` still gives 0.625 confidence. Use higher DOM weight for layout-driven archetypes.
- **Skipping `vision_prompt_hint`** — when the vision phase runs, this is what disambiguates similar archetypes. A vague hint = vision picks wrong sibling.
- **Missing `content_schema`** — without it, the build plan can't bind props. Every archetype needs at least one slot defined.

## Archetype lifecycle

Archetypes evolve. Bump `version` when:

- Match rules change in a way that would invalidate prior runs' matches
- Content schema changes (Webflow Components downstream might need a re-import)

Phase A respects the `version` string in `matches.json` and re-matches when it changes.

## See also

- `examples/archetype.example.json` — fully-annotated archetype with every field commented
- `cli/src/archetypes/library.json` — the live library
- `cli/src/match/dom.ts` — the scoring implementation
