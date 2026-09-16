# AI Migration

Section archetype matcher and per-section rebuild bundler — the site-wide foundation for AI-driven WordPress → Webflow migrations.

## What it does

Given a sitemap, this tool:

1. **Discovers** every URL and probes it for metadata (page builder signature, body classes, status)
2. **Fingerprints** each page's DOM, detecting section boundaries
3. **Matches** each section against a portable archetype library (DOM rules + vision fallback)
4. **Bundles** each matched section into a self-contained rebuild package: HTML structure + content + assets + screenshot
5. **Aggregates** site-wide patterns into a single `site-component-spec.md` that drives the Webflow build

The archetype library is portable — it survives across migrations and grows more accurate every site.

## Why no CSS extraction?

Styling is downstream's job. Whatever rebuilds in Webflow applies on-brand styling at that stage. Replicating source CSS works *against* that. The matcher delivers structure, content, and visual reference — nothing more.

## Quick start

```bash
pnpm install
pnpm build

# Full pipeline:
pnpm ai-migrate run \
  --sitemap https://example.com/page-sitemap.xml \
  --domain example-com

# Or step-by-step:
pnpm ai-migrate discover    --sitemap https://example.com/page-sitemap.xml --domain example-com
pnpm ai-migrate fingerprint --domain example-com
pnpm ai-migrate match       --domain example-com
pnpm ai-migrate aggregate   --domain example-com
pnpm ai-migrate report      --domain example-com
```

Outputs land under `output/{domain}/`.

## Pipeline integration

```
ai-migration (this repo)        →  Webflow rebuilder
  - section archetype matching     - applies styles
  - per-section rebuild bundles    - assembles pages
  - site-wide component spec       - binds content
```

## Documentation

- `references/archetype-authoring.md` — how to add a new archetype
- `references/pipeline-overview.md` — full pipeline doc
