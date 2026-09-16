#!/usr/bin/env python3
"""Tests for the reverse reference walk in drop.py. Stdlib only.

    python3 -m unittest discover -s skills/brain-drop/scripts

The walk reports across every file in the repo, so a change to what it counts
as a citation moves findings on files nobody was editing. These pin the two
halves of the match: what is excluded from a candidate's text, and which
spellings of a subject are recognised in what remains.
"""

import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import drop  # noqa: E402

SUBJECT = "knowledge/webflow/mcp-constraints.md"
SUBJECT_TEXT = """---
id: webflow.mcp-constraints
status: stable
consumed_by:
  - skills/pattern-finder/SKILL.md
---

# Webflow MCP constraints
"""


def frontmatter(text):
    block, _ = drop.split_frontmatter(text)
    return drop.parse_frontmatter(block)


def who_cites(subject, subject_text, others):
    """referrers() over a corpus built the way cmd_validate builds it."""
    corpus = {rel: drop.citation_text(text) for rel, text in others.items()}
    corpus[subject] = drop.citation_text(subject_text)
    return drop.referrers(subject, frontmatter(subject_text), corpus)


class ConsumedByIsNotACitation(unittest.TestCase):
    """consumed_by names who reads a file, so it cannot be read as a citation."""

    def test_declaring_a_consumer_does_not_make_the_consumer_a_referrer(self):
        other = """---
id: webflow.inspection-surfaces
status: draft
consumed_by:
  - knowledge/webflow/mcp-constraints.md
---

# Inspection surfaces
"""
        self.assertEqual(
            who_cites(SUBJECT, SUBJECT_TEXT, {"knowledge/webflow/inspection-surfaces.md": other}),
            set(),
        )

    def test_a_scalar_consumed_by_is_excluded_too(self):
        other = """---
id: webflow.inspection-surfaces
status: draft
consumed_by: knowledge/webflow/mcp-constraints.md
---

# Inspection surfaces
"""
        self.assertEqual(
            who_cites(SUBJECT, SUBJECT_TEXT, {"knowledge/webflow/inspection-surfaces.md": other}),
            set(),
        )


class OnlyConsumedByIsExcluded(unittest.TestCase):
    """Every other frontmatter key carries real citations and must survive."""

    def test_depends_on_is_a_citation(self):
        other = """---
id: assessment.domain.04
status: stable
depends_on:
  - knowledge/webflow/mcp-constraints.md
---

# Domain 04
"""
        self.assertEqual(
            who_cites(SUBJECT, SUBJECT_TEXT, {"assessment/domains/04-cms-population.md": other}),
            {"assessment/domains/04-cms-population.md"},
        )

    def test_extracted_from_is_a_citation(self):
        other = """---
id: webflow.inspection-surfaces
status: draft
extracted_from: knowledge/webflow/mcp-constraints.md
---

# Inspection surfaces
"""
        self.assertEqual(
            who_cites(SUBJECT, SUBJECT_TEXT, {"knowledge/webflow/inspection-surfaces.md": other}),
            {"knowledge/webflow/inspection-surfaces.md"},
        )

    def test_the_exclusion_stops_at_the_next_key(self):
        """A depends_on written after consumed_by is still read."""
        other = """---
id: assessment.domain.04
status: stable
consumed_by:
  - assessment/README.md
depends_on:
  - knowledge/webflow/mcp-constraints.md
---

# Domain 04
"""
        self.assertEqual(
            who_cites(SUBJECT, SUBJECT_TEXT, {"assessment/domains/04-cms-population.md": other}),
            {"assessment/domains/04-cms-population.md"},
        )

    def test_a_file_without_frontmatter_is_searched_whole(self):
        self.assertEqual(
            who_cites(SUBJECT, SUBJECT_TEXT,
                      {"assessment/required-artifacts.yaml": "a: knowledge/webflow/mcp-constraints.md\n"}),
            {"assessment/required-artifacts.yaml"},
        )


class CitationSpellings(unittest.TestCase):
    """Path, dotted id, and the short form prose actually writes."""

    def cites(self, body):
        return who_cites(SUBJECT, SUBJECT_TEXT, {"knowledge/webflow/inspection-surfaces.md": body})

    def test_repo_relative_path(self):
        self.assertTrue(self.cites("see `knowledge/webflow/mcp-constraints.md` for it\n"))

    def test_dotted_id(self):
        self.assertTrue(self.cites("see `webflow.mcp-constraints` for it\n"))

    def test_short_form(self):
        self.assertTrue(self.cites("`webflow/mcp-constraints.md` describes the local server\n"))

    def test_short_form_does_not_match_inside_a_longer_path(self):
        self.assertFalse(self.cites("see `archive/webflow/mcp-constraints.md` for it\n"))

    def test_short_form_does_not_match_a_longer_filename(self):
        self.assertFalse(self.cites("see `webflow/mcp-constraints.mdx` for it\n"))

    def test_a_nested_knowledge_path_gets_a_short_form_pattern(self):
        _, patterns = drop.citation_forms(SUBJECT, {"id": "webflow.mcp-constraints"})
        self.assertEqual(len(patterns), 1)

    def test_a_bare_filename_gets_no_short_form_pattern(self):
        """A top-level knowledge file short-forms to a bare filename, which is
        not distinctive enough to search for. Path and id still match."""
        literals, patterns = drop.citation_forms("knowledge/glossary.md", {"id": "glossary"})
        self.assertEqual(patterns, [])
        self.assertEqual(literals, ["knowledge/glossary.md", "glossary"])

    def test_a_non_knowledge_path_gets_no_short_form_pattern(self):
        _, patterns = drop.citation_forms("assessment/domains/04-cms-population.md", {})
        self.assertEqual(patterns, [])

    def test_a_file_is_never_its_own_referrer(self):
        text = SUBJECT_TEXT + "\nSee knowledge/webflow/mcp-constraints.md and webflow/mcp-constraints.md.\n"
        self.assertEqual(who_cites(SUBJECT, text, {}), set())


class ValidateEndToEnd(unittest.TestCase):
    """The wiring: cmd_validate builds its corpus through citation_text."""

    def run_validate(self, files):
        with tempfile.TemporaryDirectory() as root:
            os.mkdir(os.path.join(root, ".git"))
            for rel, text in files.items():
                path = os.path.join(root, rel)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
            proc = subprocess.run(
                [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "drop.py"),
                 "--root", root, "validate"],
                capture_output=True, text=True,
            )
        return proc

    @staticmethod
    def knowledge(dotted, consumers, body=""):
        return "---\nid: %s\nstatus: stable\nsource: test\nconsumed_by:\n%s---\n\n# Title\n\n%s\n" % (
            dotted, "".join("  - %s\n" % c for c in consumers), body)

    SKILL = "cites knowledge/webflow/mcp-constraints.md and knowledge/webflow/inspection-surfaces.md\n"

    def test_a_short_form_citation_is_seen(self):
        """Prose writes `webflow/x.md`, not the repo-relative path."""
        proc = self.run_validate({
            "knowledge/webflow/mcp-constraints.md":
                self.knowledge("webflow.mcp-constraints", ["skills/pattern-finder/SKILL.md"]),
            "knowledge/webflow/inspection-surfaces.md":
                self.knowledge("webflow.inspection-surfaces", ["skills/pattern-finder/SKILL.md"],
                               "`webflow/mcp-constraints.md` describes the local server."),
            "skills/pattern-finder/SKILL.md": self.SKILL,
        })
        self.assertIn(
            "knowledge/webflow/mcp-constraints.md: referenced by "
            "knowledge/webflow/inspection-surfaces.md but not listed in consumed_by",
            proc.stdout)

    def test_declaring_a_consumer_does_not_demand_the_reverse(self):
        """The citation runs one way, so only the cited file declares a consumer."""
        proc = self.run_validate({
            "knowledge/webflow/mcp-constraints.md":
                self.knowledge("webflow.mcp-constraints",
                               ["skills/pattern-finder/SKILL.md",
                                "knowledge/webflow/inspection-surfaces.md"]),
            "knowledge/webflow/inspection-surfaces.md":
                self.knowledge("webflow.inspection-surfaces", ["skills/pattern-finder/SKILL.md"],
                               "`webflow/mcp-constraints.md` describes the local server."),
            "skills/pattern-finder/SKILL.md": self.SKILL,
        })
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertNotIn("WARN", proc.stdout)

    def test_a_full_path_citation_is_still_seen(self):
        proc = self.run_validate({
            "knowledge/webflow/mcp-constraints.md":
                self.knowledge("webflow.mcp-constraints", ["skills/pattern-finder/SKILL.md"]),
            "knowledge/webflow/inspection-surfaces.md":
                self.knowledge("webflow.inspection-surfaces", ["skills/pattern-finder/SKILL.md"],
                               "see `knowledge/webflow/mcp-constraints.md` for the write limits."),
            "skills/pattern-finder/SKILL.md": self.SKILL,
        })
        self.assertIn(
            "knowledge/webflow/mcp-constraints.md: referenced by "
            "knowledge/webflow/inspection-surfaces.md but not listed in consumed_by",
            proc.stdout)

    def test_a_frontmatter_depends_on_citation_is_still_seen(self):
        """The guard against the exclusion becoming a blanket frontmatter strip:
        depends_on carries most of the edges this walk finds."""
        domain = ("---\nid: assessment.domain.04\nstatus: stable\ndepends_on:\n"
                  "  - knowledge/webflow/mcp-constraints.md\n---\n\n# Domain 04\n")
        proc = self.run_validate({
            "knowledge/webflow/mcp-constraints.md":
                self.knowledge("webflow.mcp-constraints", ["skills/pattern-finder/SKILL.md"]),
            "assessment/domains/04-cms-population.md": domain,
            "skills/pattern-finder/SKILL.md": self.SKILL,
        })
        self.assertIn(
            "knowledge/webflow/mcp-constraints.md: referenced by "
            "assessment/domains/04-cms-population.md but not listed in consumed_by",
            proc.stdout)


if __name__ == "__main__":
    unittest.main()
