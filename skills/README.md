# skills/

**Question this folder answers: what tooling can be run?**

The executable migration pipeline — the same tools the methodology teaches partners to
use — and the tools the program runs on its own side. Kept as readable source, never as
archives.

## Contents

Program side, run by an operator rather than by a partner:

| Skill                  | What it does                                                          |
| ---------------------- | --------------------------------------------------------------------- |
| `submission-intake/`   | Start a graded run from a delivered package with one command          |
| `console-review/`      | The reviewer's side: submit, follow, and answer a run in the console  |
| `brain-drop/`          | Route dropped content into the one folder that answers its question   |

The migration pipeline:

| Skill                  | What it does                                                          |
| ---------------------- | --------------------------------------------------------------------- |
| `page-cloner/`         | Scrape a page with Firecrawl, slice into visual sections, 1:1 clone   |
| `pattern-finder/`      | Crawl a site, fingerprint sections, match against archetypes, emit a build plan |
| `webflow-builder/`     | Normalize HTML into Webflow-compatible output                         |
| `mast-brand-injector/` | Inject brand tokens, build the MAST variable set and foundation pages |
| `collection-builder/`  | Model and populate Webflow CMS collections from extraction output     |

Each carries its own `SKILL.md` with invocation details.

## Source, not archives

This folder previously held five `.zip` and `.skill` files. They are unpacked now, and
should stay that way.

An archive cannot be diffed, searched, or read by an agent. Knowledge sealed inside one is
invisible to every other part of this repo — which defeats the point of a source of truth.

If a skill needs to be distributed as an archive, build it on the way out. Do not commit
the built artifact back here.

## Skills are tools, not knowledge

A `SKILL.md` describes how to run something. `knowledge/` describes what is true.

When a skill encodes a rule that matters beyond the tool — a Webflow constraint, a MAST
convention, a failure mode worth knowing — that rule belongs in `knowledge/`, with the
skill referencing it. Otherwise the rule is discoverable only by someone already reading
that specific script.

`pattern-finder/` in particular carries a lot of undistilled knowledge: the archetype
library, the DOM-vs-vision matching model, the Webflow MCP failure table. Extracting those
into `knowledge/` is outstanding work.
