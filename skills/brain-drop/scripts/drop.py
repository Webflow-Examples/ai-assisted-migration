#!/usr/bin/env python3
"""Routing helpers for brain-drop. Stdlib only.

  similar       rank existing files by term overlap with new content
  next-number   next unused sequence number in a decisions/ folder
  validate      frontmatter + consumed_by backlinks, both directions
"""

import argparse
import os
import re
import sys
from collections import defaultdict

TEXT_EXT = {".md", ".yaml", ".yml"}
SKIP_DIRS = {".git", "node_modules", "dist", "build", ".firecrawl", "__pycache__"}
KNOWLEDGE_STATUS = {"stable", "partial", "draft", "superseded"}

# Index files: they point at much of the repo and nothing depends on them in the
# way consumed_by describes. Backlinks in either direction are noise, so they are
# left out of the reverse check as both subject and referrer.
INDEX_PREFIXES = ("curators/", "knowledge/OPEN-WORK", "knowledge/glossary.md")

KNOWLEDGE_PREFIX = "knowledge/"

# A top-level frontmatter key. Continuation lines of a folded scalar are
# indented, so anchoring at column zero keeps one out of the match.
FM_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):")

STOPWORDS = set("""
the a an and or but if then than that this these those there here when where which who whom
whose what how why is are was were be been being am do does did doing have has had having
of in on at to for from with without into onto over under about across per via by as it its
not no nor so such only own same too very can will just should would could may might must
one two all any each both few more most other some own s t don now our their your his her
you we they he she them us me my mine i
""".split())

TERM_RE = re.compile(r"[a-z][a-z0-9_-]{2,}")


def repo_root(start):
    p = os.path.abspath(start)
    while p != "/":
        if os.path.isdir(os.path.join(p, ".git")):
            return p
        p = os.path.dirname(p)
    return os.path.abspath(start)


def walk_text_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if os.path.splitext(fn)[1] in TEXT_EXT:
                yield os.path.join(dirpath, fn)


def read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def terms(text):
    return {t for t in TERM_RE.findall(text.lower()) if t not in STOPWORDS}


def split_frontmatter(text):
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    return text[3:end], text[end + 4:]


def parse_frontmatter(block):
    """Handles the subset used in this repo: scalars and '- ' lists."""
    data = {}
    key = None
    for raw in block.splitlines():
        line = raw.split("#", 1)[0].rstrip() if not raw.strip().startswith("#") else ""
        if not line.strip():
            continue
        if line.lstrip().startswith("- ") and key:
            data.setdefault(key, [])
            if isinstance(data[key], list):
                data[key].append(line.lstrip()[2:].strip())
            continue
        if ":" in line:
            k, _, v = line.partition(":")
            key = k.strip()
            v = v.strip()
            data[key] = v if v else []
    return data


def consumed_by_list(fm):
    declared = fm.get("consumed_by") or []
    if isinstance(declared, str):
        declared = [declared] if declared else []
    return declared


def citation_text(text):
    """A file's text with its own consumed_by removed.

    consumed_by names who reads this file, not what this file cites, so a path
    sitting there is not a reference. Counting it as one makes every declared
    edge demand its own reverse. Nothing else in the frontmatter is dropped:
    depends_on there is a real citation and is most of what this check finds.
    """
    block, body = split_frontmatter(text)
    if block is None:
        return text
    kept = []
    dropping = False
    for line in block.splitlines():
        m = FM_KEY_RE.match(line)
        if m:
            dropping = m.group(1) == "consumed_by"
        if not dropping:
            kept.append(line)
    return "\n".join(kept) + body


def citation_forms(rel, fm):
    """The spellings a citation of `rel` takes in this repo.

    Prose under knowledge/ cites a sibling by the short form — `webflow/
    mcp-constraints.md` rather than the repo-relative path — so the short form
    is matched too, bounded so it cannot land inside a longer path. A short
    form with no directory in it is a bare filename and is not distinctive
    enough to match on.
    """
    literals = [rel]
    if fm.get("id"):
        literals.append(fm["id"])
    patterns = []
    if rel.startswith(KNOWLEDGE_PREFIX):
        short = rel[len(KNOWLEDGE_PREFIX):]
        if "/" in short:
            patterns.append(re.compile(r"(?<![\w./-])%s(?![\w-])" % re.escape(short)))
    return literals, patterns


def referrers(rel, fm, corpus):
    """Files in `corpus` that cite `rel`. `corpus` values are citation_text."""
    literals, patterns = citation_forms(rel, fm)
    found = set()
    for other, text in corpus.items():
        if other == rel:
            continue
        if any(lit in text for lit in literals) or any(p.search(text) for p in patterns):
            found.add(other)
    return found


def cmd_similar(args):
    root = repo_root(args.root)
    query = read(args.file) if args.file else args.text
    if not query:
        sys.exit("similar: provide TEXT or --file")
    q = terms(query)
    if not q:
        sys.exit("similar: no distinctive terms in input")

    docs = {}
    for path in walk_text_files(root):
        rel = os.path.relpath(path, root)
        if rel.startswith("skills/brain-drop/"):
            continue
        docs[rel] = read(path)

    df = defaultdict(int)
    doc_terms = {}
    for rel, text in docs.items():
        dt = terms(text) & q
        doc_terms[rel] = dt
        for t in dt:
            df[t] += 1

    n = max(len(docs), 1)
    scored = []
    for rel, dt in doc_terms.items():
        if not dt:
            continue
        score = sum(1.0 / (1 + df[t] / n * 10) for t in dt)
        scored.append((score, rel, dt))
    scored.sort(key=lambda r: (-r[0], r[1]))

    if not scored:
        print("no overlap found — no existing home, safe to create")
        return

    print("candidate existing homes (highest overlap first):\n")
    for score, rel, dt in scored[: args.top]:
        rare = sorted(dt, key=lambda t: df[t])[:6]
        print("  %6.2f  %s" % (score, rel))
        print("          shared: %s" % ", ".join(rare))
        for line in docs[rel].splitlines():
            low = line.lower()
            if sum(1 for t in rare[:3] if t in low) >= 2:
                print("          > %s" % line.strip()[:100])
                break
        print()
    print("Extend the top candidate unless it covers a different topic.")


def cmd_next_number(args):
    root = repo_root(args.root)
    folder = os.path.join(root, args.folder)
    if not os.path.isdir(folder):
        sys.exit("next-number: no such folder: %s" % args.folder)
    used = set()
    for fn in os.listdir(folder):
        m = re.match(r"^(\d{4})-", fn)
        if m:
            used.add(int(m.group(1)))
    print("%04d" % ((max(used) + 1) if used else 1))


def cmd_validate(args):
    root = repo_root(args.root)
    errors = []
    warnings = []

    knowledge = {}
    for path in walk_text_files(os.path.join(root, "knowledge")):
        rel = os.path.relpath(path, root)
        stem = os.path.splitext(os.path.basename(rel))[0]
        if stem == stem.upper():
            continue
        block, _ = split_frontmatter(read(path))
        if block is None:
            errors.append("%s: no frontmatter" % rel)
            continue
        fm = parse_frontmatter(block)
        knowledge[rel] = fm

        expected = rel[len("knowledge/"):-len(".md")].replace("/", ".")
        if fm.get("id") != expected:
            errors.append("%s: id is %r, path implies %r" % (rel, fm.get("id"), expected))
        if fm.get("status") not in KNOWLEDGE_STATUS:
            errors.append("%s: status %r not in %s" % (rel, fm.get("status"), sorted(KNOWLEDGE_STATUS)))
        if not fm.get("source") and not fm.get("extracted_from"):
            warnings.append("%s: no source/extracted_from — provenance unknown" % rel)

        for dep in consumed_by_list(fm):
            if not os.path.exists(os.path.join(root, dep)):
                errors.append("%s: consumed_by points at missing %s" % (rel, dep))

    corpus = {}
    for path in walk_text_files(root):
        rel = os.path.relpath(path, root)
        if rel.startswith("skills/brain-drop/"):
            continue
        corpus[rel] = citation_text(read(path))

    for rel, fm in knowledge.items():
        if rel.startswith(INDEX_PREFIXES):
            continue
        declared = consumed_by_list(fm)
        actual = referrers(rel, fm, corpus)
        actual = {o for o in actual
                  if not o.startswith(INDEX_PREFIXES)
                  and os.path.basename(o) != "README.md"}
        missing = sorted(actual - set(declared))
        if missing:
            warnings.append("%s: referenced by %s but not listed in consumed_by" % (rel, ", ".join(missing)))
        if not declared and not actual:
            warnings.append("%s: nothing consumes this file" % rel)

    for line in errors:
        print("ERROR  %s" % line)
    for line in warnings:
        print("WARN   %s" % line)
    print("\n%d file(s) checked, %d error(s), %d warning(s)" % (len(knowledge), len(errors), len(warnings)))
    sys.exit(1 if errors else 0)


def main():
    ap = argparse.ArgumentParser(prog="drop.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("similar", help="rank existing files by overlap with new content")
    s.add_argument("text", nargs="?", default="")
    s.add_argument("--file")
    s.add_argument("--top", type=int, default=8)
    s.set_defaults(func=cmd_similar)

    s = sub.add_parser("next-number", help="next unused NNNN in a decisions/ folder")
    s.add_argument("folder")
    s.set_defaults(func=cmd_next_number)

    s = sub.add_parser("validate", help="check knowledge/ frontmatter and backlinks")
    s.set_defaults(func=cmd_validate)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
