import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type {
  Archetype,
  FingerprintFile,
  MatchesFile,
  SectionMatch,
  ConfidenceTier,
  ArchetypeMatch,
  CurationQueueFile,
  CurationQueueEntry,
} from "../util/types.js";
import { ARCHETYPES_DIR, outputPath, sectionsDir } from "../util/paths.js";
import { info, step, warn } from "../util/log.js";
import { scoreArchetype } from "./dom.js";

export interface MatchOptions {
  domain: string;
  topN?: number;
  thresholds?: { high: number; medium: number; low: number };
}

const DEFAULT_THRESHOLDS = { high: 0.8, medium: 0.5, low: 0.3 };

/**
 * Phase 3 orchestrator. Score every section against every archetype,
 * write `matches.json` plus a curation queue for unmatched/low-tier
 * sections, and stamp each section's `metadata.json` with its primary
 * archetype so the on-disk bundle becomes self-describing.
 */
export async function runMatch(opts: MatchOptions): Promise<MatchesFile> {
  const { domain, topN = 5, thresholds = DEFAULT_THRESHOLDS } = opts;

  step("phase 3", `dom matching for ${domain}`);

  const archetypes = loadArchetypes();
  info(`loaded ${archetypes.length} archetypes`);

  const fingerprintsPath = outputPath(domain, "fingerprints.json");
  const fingerprints = JSON.parse(readFileSync(fingerprintsPath, "utf8")) as FingerprintFile;

  const matches: SectionMatch[] = [];
  const unmatched: string[] = [];
  const curation: CurationQueueEntry[] = [];

  for (const page of fingerprints.pages) {
    for (const fp of page.sections) {
      const scored = archetypes
        .map((a) => scoreArchetype(fp, a))
        .sort((a, b) => b.confidence - a.confidence);

      const candidates = scored.slice(0, topN);
      const primary = candidates[0];
      const tier = classify(primary?.confidence ?? 0, thresholds);

      const sectionMatch: SectionMatch = {
        section_id: fp.section_id,
        page_url: fp.page_url,
        position_index: fp.position_index,
        tier,
        primary: tier === "none" ? undefined : primary,
        candidates,
      };
      matches.push(sectionMatch);

      if (tier === "none") {
        unmatched.push(fp.section_id);
      }
      if (tier === "low" || tier === "none" || tier === "medium") {
        curation.push({
          section_id: fp.section_id,
          page_url: fp.page_url,
          position_index: fp.position_index,
          fingerprint_summary: {
            layout: fp.layout,
            child_count: fp.child_count,
            has_form: fp.has_form,
            has_video: fp.has_video,
            image_count: fp.image_count,
            word_count: fp.word_count,
          },
          best_partial_match: tier === "none" ? undefined : primary,
        });
      }

      stampBundle(domain, fp.section_id, sectionMatch);
    }
  }

  const file: MatchesFile = {
    domain,
    generated_at: new Date().toISOString(),
    matches,
    unmatched_section_ids: unmatched,
  };
  writeFileSync(outputPath(domain, "matches.json"), JSON.stringify(file, null, 2));
  info(`wrote ${outputPath(domain, "matches.json")}`);

  const queueFile: CurationQueueFile = {
    domain,
    generated_at: new Date().toISOString(),
    entries: curation,
  };
  writeFileSync(outputPath(domain, "curation-queue.json"), JSON.stringify(queueFile, null, 2));
  info(`wrote ${outputPath(domain, "curation-queue.json")}`);

  // Tier breakdown
  const tiers = matches.reduce((m, x) => ((m[x.tier] = (m[x.tier] ?? 0) + 1), m), {} as Record<string, number>);
  info("match summary", { total: matches.length, ...tiers });

  return file;
}

function classify(score: number, t: { high: number; medium: number; low: number }): ConfidenceTier {
  if (score >= t.high) return "high";
  if (score >= t.medium) return "medium";
  if (score >= t.low) return "low";
  return "none";
}

function loadArchetypes(): Archetype[] {
  const libPath = path.join(ARCHETYPES_DIR, "library.json");
  if (existsSync(libPath)) {
    const raw = JSON.parse(readFileSync(libPath, "utf8")) as { archetypes: Archetype[] };
    return raw.archetypes;
  }
  warn(`no archetype library at ${libPath} — matcher will produce no matches`);
  return [];
}

function stampBundle(domain: string, sectionId: string, match: SectionMatch): void {
  const metaPath = path.join(sectionsDir(domain), sectionId, "metadata.json");
  if (!existsSync(metaPath)) return;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
  meta.archetype_id = match.primary?.archetype_id ?? null;
  meta.archetype_confidence = match.primary?.confidence ?? null;
  meta.archetype_tier = match.tier;
  meta.archetype_candidates = match.candidates.map((c) => ({ id: c.archetype_id, confidence: c.confidence }));
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}
