---
name: brain-drop
description: Route arbitrary dropped content — a paragraph, pasted doc, URL, file path, voice-transcript braindump, or a lesson learned from a review — into the correct folder of the ai-migrations-brain repo, extending an existing file rather than creating a near-duplicate. Use when the user says "add this to the brain", "capture this", "log this decision", "we learned that…", "we're calling it…", "where does this go", or pastes content into this repo with no instruction. Routes a newly coined term to knowledge/glossary.md. Enforces the single-source rule, append-only folders, frontmatter schema, and naming conventions.
---

# Brain Drop

Put dropped content in the one folder that answers the question it answers, and nowhere else.

## Primary bias: extend, do not create

A fact lives in exactly one file. Before writing anything new, find whether it already has
a home and add to that file. A second file on the same topic is the failure this skill
exists to prevent — copies drift, and a drifted rule means grading a partner on something
the methodology never taught.

Creating a new file is the exception, taken only after the search in step 3 comes back empty.

## Procedure

```
1. Split    is this one thing, or several?     ──► route each part separately
2. Route    which question does it answer?     ──► one folder, first match wins
3. Locate   does a file already cover it?      ──► extend it
4. Scan     is this stated elsewhere already?  ──► reference it, or stop on conflict
5. Write    frontmatter + naming + write rules
6. Report   path, created-or-extended, cross-references
```

Never skip step 4. Writing before scanning is how duplicates get in.

---

## Step 1 — Split test

Run this before routing. Dropped content is often several things wearing one coat.

Read the content and mark every clause that is one of these four shapes:

| Shape | Sounds like | Goes to |
| --- | --- | --- |
| **Fact** | "X is the case" | `knowledge/` |
| **Bar** | "a submission must show X" / "fails if not X" | `assessment/` |
| **Reason** | "we chose X over Y because Z" | `decisions/program/` or `decisions/methodology/` |
| **Ruling** | "on this submission we judged X" | `decisions/precedent/` |

More than one shape present means more than one file. Split it and route each part
through step 2 independently, then cross-reference them.

The most common miss: a fact and the bar that grades it arrive together. They are always
two files. `assessment/` references the standard, never restates it.

---

## Step 2 — Routing sieve

Ordered tests, top to bottom. **First match wins.** The order matters — ambiguous content
matches several tests, and the more specific test is above the more general one.

```
content
  │
  ├─ about a person or agency? ─────────────────────────► partners/  (identity, status)
  │                                                       evaluations/ (verdict, findings)
  │     never decisions/ — see the partner rule below
  │
  ├─ true only of the Texada capstone site? ────────────► baseline/texada-software/
  │
  ├─ says "we chose / instead of / because"? ───────────► decisions/  (kind test below)
  │
  ├─ a limit on what the eval agent may decide? ────────► contract/
  │
  ├─ a bar a submission is measured against? ───────────► assessment/
  │     ("must show", "fails if", evidence required)
  │
  ├─ a fixed shape a recurring output takes? ───────────► templates/
  │
  ├─ a scheduled check, or a staleness finding? ────────► curators/
  │
  ├─ how to run something / invocation steps? ──────────► skills/
  │
  ├─ names a word and says what it means? ──────────────► knowledge/glossary.md
  │     a meaning and a pointer, carrying no bar
  │     and no procedure of its own
  │
  └─ true across every migration? ──────────────────────► knowledge/<subfolder>
```

**The partner rule.** `decisions/` is program administration. Nothing in it is about a
person. A verdict — *this partner failed this gate* — belongs only in `evaluations/`.

A case can still produce a decision, but only after the partner is stripped out:

```
  evaluations/acme/attempt-01    "Acme split taxonomy into two collections
                                  and we accepted it."              ← verdict

  decisions/precedent/0012       "Splitting taxonomy into two collections
                                  satisfies the CMS architecture gate."  ← rule
```

Test before writing to `decisions/`: state it without naming a partner. If you cannot,
it is not a decision yet — stop at the evaluation.

**Decision kind test** (for the third branch):

```
does it change what a partner is graded on?  ──► decisions/program/
does it change how a migration is executed?  ──► decisions/methodology/
does it interpret an existing rule for a
  situation the rule did not cover?          ──► decisions/precedent/
```

**`knowledge/` subfolder:** `pipeline/` (methodology stage by stage), `mast/`,
`webflow/` (Webflow platform behavior, including what Webflow Cloud provisions),
`cloudflare/` (runtime-platform behavior of the account the grader runs in),
`sources/` (WordPress and other source platforms), `commercial/`, `standards/` (the bars the
rubric grades against). The `webflow/` and `cloudflare/` split is by whose account owns the
resource, not by which vendor built it — `knowledge/README.md` states it.

**The glossary branch is narrow on purpose.** It catches a term being coined or clarified,
not a fact that happens to introduce a word. Most content naming something new is really a
fact or a bar, and it routes to `knowledge/<subfolder>` or `assessment/` — the glossary
then gets a one-line entry pointing at wherever it landed. See *A newly coined term* below.

If the content is a URL or a bare file path with no framing, do not route it. Read it
first, then run step 1 on what it says.

---

## Hard calls, worked

### Fact vs. bar vs. reason

Content: *"Interactive elements need a visible focus state at 3:1 contrast."*

| Rewrite it as | Folder |
| --- | --- |
| "Focus states require 3:1 contrast." | `knowledge/standards/focus-state.md` |
| "Domain 02 fails if any interactive element lacks a visible focus state." | `assessment/domains/02-redesign-and-conversion.md` |
| "We set the bar at 3:1, not 4.5:1, because WCAG 2.1 non-text contrast is 3:1." | `decisions/methodology/NNNN-focus-contrast-threshold.md` |

All three can be true at once. Then it is three files, and the assessment criterion reads
`Evaluated against knowledge/standards/focus-state.md` — the number 3:1 appears once, in
`knowledge/`.

### General rule vs. one-off ruling

| Content | Folder | Why |
| --- | --- | --- |
| "Legacy framework class names must not survive the migration." | `knowledge/mast/class-naming.md` | True with or without any submission |
| "Acme kept `col-md-6` in three components; accepted because their style guide documented the mapping." | `decisions/precedent/` | Names a partner, one case, one ruling |

Test: **would this be true if no one had ever submitted?** Yes → `knowledge/`.

`contract/` is explicit that the agent applies precedent and does not create it. Draft the
facts of the case — the divergence, what the baseline did, the artifacts involved — and
leave the ruling and `outcome:` blank for a human. Say so in the report.

### Program vs. methodology vs. precedent

| Content | Folder |
| --- | --- |
| "SEO migration becomes a fourth critical gate." | `decisions/program/` — changes what is graded |
| "Match sections by DOM first, vision second." | `decisions/methodology/` — changes how the craft works |
| "Accepted Acme consolidating two layouts into one." | `decisions/precedent/` — one attempt |

A `program/` decision also needs the **Effect on in-flight work** section filled in
(`templates/decision.md`). Changing a criterion mid-cohort grades partners against a
standard that did not exist when they executed.

### A newly coined term

`knowledge/glossary.md` is the one file that must grow every time this system names
something. A term that only lives in the head of whoever coined it costs a question later.

The trap is that defining a term and stating the rule it belongs to feel like one act. They
are two, and collapsing them puts a second copy of a rule in the most-read file in the repo.

Dropped: *"We're calling it a 'measured' failure when the criterion resolves to one
observable value — that's the only kind the agent may rule on."*

```
rule    which failures the agent may rule on   ──► contract/evaluator-role.md
                                                    ⚠ deliberate change — needs a
                                                      decisions/program/ entry first
entry   measured — a gate failure that reports ──► knowledge/glossary.md
        what a published criterion already
        settles. Defined in contract/
        evaluator-role.md.
```

Two writes, and the entry is written second so it can point at where the rule landed.

Rules for an entry:

| | |
| --- | --- |
| Shape | **term** — one or two sentences of meaning. *Defined in* `path`. Nothing else. |
| Never | A bar, a threshold, a count, a procedure, or a list of the things the rule enumerates. That is the copy the glossary exists to avoid. |
| Two meanings | Both get entries and an explicit contrast. A word doing double duty is worth naming as such rather than picking a winner. |
| Cannot be written without restating the rule | The term is doing too much work. Put it under *Two terms that carry more than a word should* instead of restating the rule to get around it. |
| Deprecated | Keep the old name as its own entry pointing at the new one, and say where it survives in code. A reader hitting the old name has to be able to resolve it. |

`knowledge/glossary.md` is exempt from the `consumed_by` reverse check in `drop.py` — it
cites much of the repo and nothing consumes it in the sense that field describes. Do not
add mutual backlinks to satisfy the validator; it will not ask for them.

### Content that is several things

Dropped: *"Reviewed Acme attempt-01. Their redirect map missed 302s on the /resources tree.
Let it pass since the spec never said redirect type matters — but it should. Going forward
the SEO gate needs 301 specifically."*

Four shapes, four destinations:

```
fact     301 vs 302 semantics in migration  ──► knowledge/standards/  (or extend existing)
ruling   Acme's 302s accepted this time     ──► decisions/precedent/  (draft, human rules)
reason   the gate should require 301        ──► decisions/program/
bar      the gate text itself               ──► assessment/critical-gates/
                                                 seo-migration-configuration.md
                                                 ⚠ deliberate change — needs the program
                                                   decision above logged first
```

Write them in that order. The precedent cites the fact; the program decision cites the
precedent; the gate edit cites the program decision.

---

## Step 3 — Locate the existing home

```bash
python3 skills/brain-drop/scripts/drop.py similar "<the content>" --top 8
# or: --file path/to/dropped.md
```

Ranks every file in the repo by rare-term overlap and prints the matched line. Read the
top candidates before deciding. Extend the top one unless it covers a different topic.

Extending means adding a section to the existing file and updating its frontmatter — not
appending a loose paragraph. Match the file's existing heading structure.

## Step 4 — Duplication and conflict scan

The same command answers this. Judge each hit:

| Finding | Action |
| --- | --- |
| Same rule, same meaning | Do not write a second copy. Reference the existing file by path or `id`. |
| Related but distinct | Write, and add a cross-reference both ways. |
| **Contradicts the existing file** | **Stop.** Surface both statements and their paths, and ask which holds. |

On a contradiction, do not pick a winner and do not write a hedge that accommodates both.
Two files that disagree are worse than one that is wrong, because nothing signals which
one the rubric is grading against. Report and wait.

---

## Step 5 — Write

### Frontmatter

`knowledge/README.md` is the authority for the `knowledge/` schema. brain-drop writes:

```yaml
---
id: standards.focus-state        # path minus knowledge/ and .md, "/" → "."; permanent, never reused
status: draft                    # stable | partial | draft | superseded
source: Module 04                # external origin — course module, spec, platform doc
extracted_from: skills/pattern-finder/SKILL.md   # in-repo origin; use instead of source
consumed_by:
  - assessment/domains/02-redesign-and-conversion.md
---
```

New content enters at `status: draft`. Promoting to `partial` or `stable` is a deliberate
change and gets a decision entry. `partial` means some of what the file's references need is
stated and the rest is not, with the split named at the top of the file. See
`knowledge/README.md`.

Rename a file if you must; **never change an `id`.** References resolve through it.

There is no `added:` field, and brain-drop does not add one. `git log --diff-filter=A`
gives the exact date and cannot drift out of sync the way a hand-written field can. If a
date field is wanted anyway, that is a change to `knowledge/README.md` — propose it as a
`decisions/program/` entry rather than introducing it file by file.

Other folders: `decisions/program/` and `decisions/methodology/` use
`templates/decision.md`; `decisions/precedent/` uses `templates/precedent.md`. Copy the
template's frontmatter block as-is.

### Naming

| Folder | Pattern | Example |
| --- | --- | --- |
| `knowledge/` | kebab-case, one topic per name, **no dates** | `knowledge/mast/class-naming.md` |
| `assessment/domains/` | `NN-slug.md` | `03-system-build.md` |
| `assessment/critical-gates/` | kebab-case | `cms-architecture.md` |
| `decisions/program/`, `methodology/`, `precedent/` | `NNNN-slug.md`, zero-padded, sequential per folder, never reused | `decisions/precedent/0004-layout-consolidation.md` |
| `baseline/texada-software/` | kebab-case; see `baseline/README.md` | `acceptable-divergence.md` |
| `evaluations/` | mirrors `submissions/`; see `evaluations/README.md` | `acme/attempt-01/2-gates.json` |

Precedent files are numbered, not date-prefixed — the date lives in frontmatter. Get the
next number from the script; never count by eye:

```bash
python3 skills/brain-drop/scripts/drop.py next-number decisions/precedent
```

A reused number in an append-only folder cannot be cleanly undone.

If a filename needs a qualifier to distinguish it from a neighbor, that is a signal the
content belongs inside the neighbor. Go back to step 3.

### Write rules

| Folder | Rule | Behavior |
| --- | --- | --- |
| `knowledge/`, `assessment/`, `contract/` | Deliberate changes only | Warn before writing. State what the edit changes and prompt: *log this in `decisions/`?* Offer to draft the entry. |
| `decisions/` | Append-only | Never modify an existing file. To change a decision, write a new one and set `supersedes:` / `superseded_by:` on both. |
| `evaluations/` | Append-only | brain-drop does not author verdicts. A correction is a new superseding file, and only on explicit instruction. |
| `partners/` | Registry only | Identity and status. Never judgment about their work — that lives in the evaluation. `attempts[].result` is a derived copy; the evaluation wins on conflict. |
| `submissions/` | Never modified | Refuse. Partner work is read-only; a malformed artifact is a finding, not a fix. |
| `baseline/` | Changes when the site drifts | Log the observation in `baseline/texada-software/snapshot.md`. |

After writing to `knowledge/`, verify:

```bash
python3 skills/brain-drop/scripts/drop.py validate
```

Checks `id`-to-path agreement, `status` values, provenance, and `consumed_by` links in
both directions. Non-zero exit means fix before finishing.

---

## Low confidence: ask one question

Ask when the top two routes score close, when the content names a partner but states no
ruling, or when it could be a fact or a bar and the wording does not settle it.

Ask exactly one question. A good one:

- names both candidate folders,
- states the consequence of each,
- asks about the **scope of the content**, not the user's preference,
- is answerable in a word.

> "Is this true for every migration, or is it how we ruled on Acme attempt-01? First goes
> in `knowledge/webflow/`; second goes in `decisions/precedent/` and needs your sign-off."

Not: *"Where should this go?"* — that returns the work to the user unchanged.

Never invent a folder. There is no inbox, no `misc/`, no `scratch/`. Content with no home
is signal: if `knowledge/` should cover it and does not, add the gap to
`knowledge/OPEN-WORK.md` and say so.

---

## Step 6 — Report

```
route       knowledge/standards/focus-state.md
action      extended — added "Contrast threshold" section
id          standards.focus-state
refs added  assessment/domains/02-redesign-and-conversion.md → consumed_by
refs owed   assessment/critical-gates/mast-build-compliance.md cites this file
            but is not in consumed_by — add it?
warnings    knowledge/ is deliberate-change. Log a decisions/program/ entry?
split       2 of 2 parts written; part 1 → decisions/methodology/0003-focus-contrast.md
```

Report `refs owed` even when the cross-reference was not added — an unrecorded dependency
is what `curators/traceability-check.md` exists to catch, and catching it at write time is
cheaper.

## Scripts

`scripts/drop.py` — python3 stdlib, no dependencies.

| Command | Use |
| --- | --- |
| `similar "<text>" [--file F] [--top N]` | Step 3 and 4 — rank existing files by term overlap |
| `next-number decisions/<folder>` | Step 5 — collision-free sequence number |
| `validate` | After any `knowledge/` write — frontmatter and backlinks |

`scripts/test_drop.py` covers the backlink walk — which spellings of a citation count as
one, and that a file's own `consumed_by` does not. Stdlib `unittest`, no dependencies:

```bash
python3 -m unittest discover -s skills/brain-drop/scripts
```
