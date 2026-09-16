# WP → Webflow Migration

A two-phase migration toolkit for porting any WordPress (or other CMS) site into a target Webflow site at scale.

```
Phase A (CLI)    Scrape sitemap → fingerprint sections → match archetypes → emit build plan
Phase B (MCP)    Read build plan → drive Webflow MCP → create Components, Pages, CMS, Assets
```

## Repository layout

```
wp-to-webflow-migration/
├── SKILL.md                      # Top-level skill instructions (the LLM playbook)
├── README.md                     # ← you are here
├── .env.example                  # Documents required environment variables
├── .gitignore                    # Excludes output/, node_modules/, etc.
├── cli/                          # Phase A — the analysis CLI
│   ├── README.md                 # CLI command reference
│   ├── package.json              # Bin entry: `ai-migrate`
│   ├── tsconfig.json
│   └── src/
│       ├── cli.ts                # 14 commands: discover, fingerprint, match, vision, …
│       ├── archetypes/library.json   # ~50 portable section archetypes
│       ├── discover/             # Phase 1 — sitemap probing
│       ├── fingerprint/          # Phase 2 — section detection
│       ├── match/                # Phase 3 + 4 — archetype scoring + vision fallback
│       ├── aggregate/            # Phase 5 — template family clustering
│       ├── build/                # Phase 6 + 7 — build plan + bare HTML/CSS export
│       ├── clone/                # Phase 7c — 1:1 clone export with source CSS
│       ├── styles/               # Phase 2.5 — computed style capture (Playwright)
│       ├── report/               # Phase 5b — markdown spec rendering
│       ├── curation/             # Surfacing patterns for new archetypes
│       └── util/                 # Logging, paths, types
├── references/
│   ├── pipeline-overview.md      # Detailed phase-by-phase walkthrough
│   ├── archetype-authoring.md    # How to add a new archetype
│   └── mcp-build-workflow.md     # Phase B specification
└── examples/
    └── archetype.example.json    # Annotated archetype with all fields explained
```

## Installation

Requires **Node 20+** and **pnpm**.

```bash
git clone <this-repo> wp-to-webflow-migration
cd wp-to-webflow-migration/cli
pnpm install
pnpm build
```

For Phase A's optional vision-matching step, set:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

For Phase B, you also need:
- A Webflow site you own
- The [Webflow MCP](https://developers.webflow.com/mcp/v1.0.0) connected to your LLM platform of choice
- The Webflow Designer open in a browser tab and **kept in the foreground** during MCP write operations

## Quick start (Phase A)

```bash
cd cli/

# End-to-end (no vision)
pnpm ai-migrate run \
  --sitemap https://example.com/sitemap.xml \
  --domain example-com

# With vision fallback (requires ANTHROPIC_API_KEY)
pnpm ai-migrate run --sitemap … --domain example-com --vision-cache none
pnpm ai-migrate vision --domain example-com --max-calls 200
pnpm ai-migrate aggregate --domain example-com
pnpm ai-migrate report    --domain example-com
pnpm ai-migrate build-plan --domain example-com
```

Outputs land in `output/{domain}/`:

- `discovery.json` — every URL + page-builder classification
- `fingerprints.json` — every section on every page
- `matches.json` — archetype scores
- `aggregate.json` — template families + recommended Components / CMS Collections
- `site-component-spec.md` — human-readable spec
- `build-plan.json` — the Phase B contract

See [`cli/README.md`](cli/README.md) for full command reference.

## Quick start (Phase B)

Phase B is LLM-driven via the Webflow MCP. The instructions live in [`SKILL.md`](SKILL.md). Install this folder as a skill on your LLM platform (Claude Code, Anthropic Skills, etc.) and ask:

> "Migrate `https://example.com` to my Webflow site `mysite.webflow.io` using the build plan at `output/example-com/`."

The skill will:
1. List Webflow sites and confirm the target
2. Read `build-plan.json` and promote each archetype into a reusable Webflow Component with typed props
3. Mirror the source sitemap into Webflow Pages (preserving slugs)
4. Create CMS Collections for repeating content
5. Upload referenced images to the Webflow asset library
6. Place Component instances on real pages with bound props (where automatable)

Read the full Phase B spec in [`references/mcp-build-workflow.md`](references/mcp-build-workflow.md).

## What this is not

This toolkit migrates **page structure, content, and assets**. It does **not** migrate:

- Visual design overrides beyond what the source CSS expresses (apply your design system after)
- Animations / Interactions (re-implement post-migration in Webflow)
- Form submission handlers, integrations, custom JS
- Multi-locale content (single-locale only)

## Customizing the archetype library

The library at `cli/src/archetypes/library.json` is generic by design. After running Phase A on a real site, inspect `output/{domain}/curation-queue.json` for recurring unmatched patterns — those are candidates for new archetypes. See [`references/archetype-authoring.md`](references/archetype-authoring.md).

## License

Specify at publish time.

## Contributing

PRs welcome — particularly new archetypes for patterns we don't yet cover. Each archetype is a small declarative JSON entry; see the authoring guide.
