# AI-Assisted Migration

Skills for migrating sites to Webflow using AI and the Webflow MCP server. This repo is for Webflow partners and agencies running migration work.

## What's here

Each skill in `skills/` handles a piece of the migration workflow: cloning pages, matching design patterns, building CMS collections, injecting brand tokens, and generating Webflow-compatible output.

| Skill | What it does |
| --- | --- |
| `collection-builder/` | Model and populate Webflow CMS collections from extraction output |
| `mast-brand-injector/` | Inject brand tokens and build the MAST variable set and foundation pages |
| `page-cloner/` | Scrape a page, slice it into sections, and clone it |
| `pattern-finder/` | Crawl a site, fingerprint sections, match against archetypes, emit a build plan |
| `webflow-builder/` | Normalize HTML into Webflow-compatible output |

Each skill has its own `SKILL.md` with invocation details.

## What this is not

These skills are a starting point, not a finished migration tool. They won't handle every site, every CMS structure, or every edge case an agency runs into. Expect to hit gaps.

We encourage partners to extend these skills, fork them, or build net new tools as the underlying AI models and Webflow's own tooling evolve. If something here breaks on your use case or you build something better, that's expected and welcome.
