import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import type {
  Archetype,
  CurationQueueEntry,
  CurationQueueFile,
  FingerprintFile,
  MatchesFile,
  SectionFingerprint,
  SectionMatch,
} from "../util/types.js";
import { ARCHETYPES_DIR, outputPath, sectionsDir } from "../util/paths.js";
import { info, step, warn, progress } from "../util/log.js";
import { classifyWithVision } from "./vision.js";

export interface VisionRunOptions {
  domain: string;
  /** Tiers to send through vision. Default: ["medium","low","none"]. */
  tiers?: ("medium" | "low" | "none")[];
  /** Hard cap on API calls — protects budget. */
  maxCalls?: number;
  concurrency?: number;
  dryRun?: boolean;
  model?: string;
  /**
   * Path to a JSON cache of pre-computed vision results, keyed by section_id.
   * When provided, sections found in the cache skip the API entirely.
   * Format: `{ "<section_id>": { "archetype_id": string|null, "confidence": number, "reason": string } }`
   * Lets an outer process (e.g. an agent without subprocess env access) supply
   * classifications without touching the Anthropic SDK.
   */
  cachePath?: string;
  /** When true, only sections found in the cache are processed; uncached ones stay untouched. */
  cacheOnly?: boolean;
}

export interface VisionWorklistItem {
  section_id: string;
  page_url: string;
  position_index: number;
  current_tier: string;
  current_primary?: { archetype_id: string; confidence: number };
  dom_candidates: { archetype_id: string; confidence: number }[];
  fingerprint_summary: {
    layout: string;
    child_count: number;
    word_count: number;
    image_count: number;
    link_count: number;
    heading_count: number;
    has_form: boolean;
    has_video: boolean;
    has_carousel: boolean;
    has_accordion: boolean;
    has_tabs: boolean;
    builder_block_type?: string;
    dom_path: string;
  };
  cleaned_html: string;
}

export interface VisionWorklistFile {
  domain: string;
  generated_at: string;
  archetype_menu: { id: string; display_name: string; description: string; category: string }[];
  items: VisionWorklistItem[];
}

const DEFAULT_TIERS: ("medium" | "low" | "none")[] = ["medium", "low", "none"];

/**
 * Phase 4 — vision (text-mode) fallback. Reads matches.json, picks the
 * sections in target tiers, queries Claude for each with the cleaned
 * section HTML + archetype menu, merges results back, re-tiers, and
 * rewrites matches.json + curation-queue.json in place.
 *
 * Merge policy:
 *   - vision picks same archetype as DOM primary → tier upgraded to "high"
 *     (combined source: "merged"), confidence = max(dom, vision)
 *   - vision picks a different archetype → use vision's pick at "vision"
 *     source; tier classified from vision confidence
 *   - vision returns null → keep DOM primary, mark for curation
 */
export async function runVision(opts: VisionRunOptions): Promise<MatchesFile> {
  const {
    domain,
    tiers = DEFAULT_TIERS,
    maxCalls = 500,
    concurrency = 4,
    dryRun = false,
    model,
    cachePath,
    cacheOnly = false,
  } = opts;

  const cache = cachePath ? loadCache(cachePath) : null;
  if (cache) info(`vision cache: ${Object.keys(cache).length} entries from ${cachePath}`);

  step("phase 4", `vision fallback for ${domain}${dryRun ? " (DRY RUN)" : ""}`);

  const matchesPath = outputPath(domain, "matches.json");
  const matches = JSON.parse(readFileSync(matchesPath, "utf8")) as MatchesFile;
  const fingerprints = JSON.parse(readFileSync(outputPath(domain, "fingerprints.json"), "utf8")) as FingerprintFile;
  const archetypes = loadArchetypes();

  // Index for lookup
  const fpById = new Map<string, SectionFingerprint>();
  for (const p of fingerprints.pages) for (const s of p.sections) fpById.set(s.section_id, s);

  let targets = matches.matches.filter((m) => tiers.includes(m.tier as "medium" | "low" | "none"));
  if (cacheOnly && cache) {
    targets = targets.filter((m) => cache[m.section_id] !== undefined);
  }
  const capped = targets.slice(0, maxCalls);
  if (capped.length < targets.length) {
    warn(`max-calls cap (${maxCalls}) trimmed ${targets.length - capped.length} sections; raise --max-calls to cover all`);
  }
  info(`vision target sections: ${capped.length} (of ${targets.length} eligible / ${matches.matches.length} total)`);

  if (capped.length === 0) {
    info("nothing to do");
    return matches;
  }

  // Determine if we'll need the SDK at all. If every target has a cache entry
  // (or dry-run / cache-only is set), no API key is required.
  const needsApi = !dryRun && capped.some((m) => !cache || cache[m.section_id] === undefined);
  if (needsApi && cacheOnly) {
    throw new Error("--cache-only set but some targets have no cache entries. Either supply complete cache or drop --cache-only.");
  }
  if (needsApi && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set. Provide --cache <file>, --cache-only, or --dry-run to skip live API calls.");
  }

  const limit = pLimit(concurrency);
  let done = 0;

  await Promise.all(
    capped.map((m) =>
      limit(async () => {
        const fp = fpById.get(m.section_id);
        if (!fp) {
          done += 1;
          progress(done, capped.length, m.section_id);
          return;
        }
        const cleanedHtml = readSectionHtml(domain, m.section_id);
        try {
          // Cache hit short-circuits the API call entirely.
          const cached = cache?.[m.section_id];
          const result = cached
            ? { archetype_id: cached.archetype_id, confidence: cached.confidence, reason: cached.reason || "from cache", dryRun: false }
            : await classifyWithVision({
                fingerprint: fp,
                cleanedHtml,
                archetypes,
                domCandidates: m.candidates.map((c) => ({ archetype_id: c.archetype_id, confidence: c.confidence })),
                dryRun,
                ...(model ? { model } : {}),
              });
          mergeIntoMatch(m, result);
        } catch (e) {
          (m as SectionMatch & { vision_error?: string }).vision_error = e instanceof Error ? e.message : String(e);
        }
        done += 1;
        progress(done, capped.length, m.section_id);
      }),
    ),
  );

  // Recompute unmatched_section_ids and rebuild curation queue from final tiers.
  matches.unmatched_section_ids = matches.matches.filter((m) => m.tier === "none").map((m) => m.section_id);
  matches.generated_at = new Date().toISOString();
  writeFileSync(matchesPath, JSON.stringify(matches, null, 2));
  info(`updated ${matchesPath}`);

  rewriteCurationQueue(domain, matches, fpById);

  // Re-stamp metadata.json on the affected bundles so on-disk truth tracks.
  for (const m of capped) {
    stampBundle(domain, m);
  }

  const tiersOut = matches.matches.reduce((m, x) => ((m[x.tier] = (m[x.tier] ?? 0) + 1), m), {} as Record<string, number>);
  const cacheHits = cache ? capped.filter((m) => cache[m.section_id] !== undefined).length : 0;
  info("vision summary", { calls: capped.length, cache_hits: cacheHits, api_calls: capped.length - cacheHits, ...tiersOut });

  return matches;
}

function loadCache(p: string): Record<string, { archetype_id: string | null; confidence: number; reason: string }> {
  if (!existsSync(p)) throw new Error(`vision cache not found: ${p}`);
  const raw = JSON.parse(readFileSync(p, "utf8"));
  // Accept either flat map or `{ entries: [...] }`
  if (Array.isArray(raw?.entries)) {
    const out: Record<string, { archetype_id: string | null; confidence: number; reason: string }> = {};
    for (const e of raw.entries) {
      if (e?.section_id) out[e.section_id] = { archetype_id: e.archetype_id ?? null, confidence: e.confidence ?? 0, reason: e.reason ?? "" };
    }
    return out;
  }
  return raw;
}

/**
 * Emit a worklist file containing everything an outside classifier needs to
 * pick an archetype per section: structural summary, top DOM candidates,
 * cleaned HTML, and the full archetype menu. No API calls. Use the result to
 * produce a vision-cache.json that `runVision({ cachePath })` can ingest.
 */
export async function prepareVisionWorklist(opts: {
  domain: string;
  tiers?: ("medium" | "low" | "none")[];
  maxItems?: number;
  htmlCharLimit?: number;
}): Promise<string> {
  const { domain, tiers = DEFAULT_TIERS, maxItems = 1000, htmlCharLimit = 6000 } = opts;
  step("phase 4 prep", `vision worklist for ${domain}`);

  const matches = JSON.parse(readFileSync(outputPath(domain, "matches.json"), "utf8")) as MatchesFile;
  const fingerprints = JSON.parse(readFileSync(outputPath(domain, "fingerprints.json"), "utf8")) as FingerprintFile;
  const archetypes = loadArchetypes();

  const fpById = new Map<string, SectionFingerprint>();
  for (const p of fingerprints.pages) for (const s of p.sections) fpById.set(s.section_id, s);

  const targets = matches.matches.filter((m) => tiers.includes(m.tier as "medium" | "low" | "none")).slice(0, maxItems);

  const items: VisionWorklistItem[] = [];
  for (const m of targets) {
    const fp = fpById.get(m.section_id);
    if (!fp) continue;
    const html = readSectionHtml(domain, m.section_id);
    const truncated = html.length > htmlCharLimit ? html.slice(0, htmlCharLimit) + "\n<!-- …truncated -->" : html;
    const item: VisionWorklistItem = {
      section_id: m.section_id,
      page_url: m.page_url,
      position_index: m.position_index,
      current_tier: m.tier,
      dom_candidates: m.candidates.slice(0, 5).map((c) => ({ archetype_id: c.archetype_id, confidence: c.confidence })),
      fingerprint_summary: {
        layout: fp.layout,
        child_count: fp.child_count,
        word_count: fp.word_count,
        image_count: fp.image_count,
        link_count: fp.link_count,
        heading_count: fp.content.headings.length,
        has_form: fp.has_form,
        has_video: fp.has_video,
        has_carousel: fp.has_carousel,
        has_accordion: fp.has_accordion,
        has_tabs: fp.has_tabs,
        ...(fp.builder_block_type ? { builder_block_type: fp.builder_block_type } : {}),
        dom_path: fp.dom_path,
      },
      cleaned_html: truncated,
    };
    if (m.primary) {
      item.current_primary = { archetype_id: m.primary.archetype_id, confidence: m.primary.confidence };
    }
    items.push(item);
  }

  const file: VisionWorklistFile = {
    domain,
    generated_at: new Date().toISOString(),
    archetype_menu: archetypes.map((a) => ({ id: a.id, display_name: a.display_name, description: a.description, category: a.category })),
    items,
  };
  const out = outputPath(domain, "vision-worklist.json");
  writeFileSync(out, JSON.stringify(file, null, 2));
  info(`wrote ${out}`, { items: items.length, archetypes: archetypes.length });
  return out;
}

function mergeIntoMatch(m: SectionMatch, vision: { archetype_id: string | null; confidence: number; reason: string }): void {
  const dom = m.primary;
  if (!vision.archetype_id) {
    // No match. Leave DOM primary in place; flag note.
    m.curation_note = `vision returned null (${vision.reason || "no fit"})`;
    return;
  }

  // Same archetype as DOM → consensus. Boost confidence (small additive bonus
  // for agreement, capped at 1) but let tier follow the merged confidence.
  // Auto-promoting to "high" on agreement was over-eager: a 0.58 DOM match
  // confirmed by a 0.55 vision call shouldn't end up tagged high-confidence.
  if (dom && vision.archetype_id === dom.archetype_id) {
    const boosted = Math.min(1, Math.max(dom.confidence, vision.confidence) + 0.1);
    const merged = {
      archetype_id: dom.archetype_id,
      confidence: boosted,
      source: "merged" as const,
      evidence: { dom: dom.evidence, vision: { reason: vision.reason } },
    };
    m.primary = merged;
    m.tier = boosted >= 0.8 ? "high" : boosted >= 0.5 ? "medium" : boosted >= 0.3 ? "low" : "none";
    m.curation_note = `vision confirmed; merged conf ${boosted.toFixed(2)}`;
    return;
  }

  // Vision picked something different → trust vision (it sees structure DOM rules missed).
  m.primary = {
    archetype_id: vision.archetype_id,
    confidence: vision.confidence,
    source: "vision",
    evidence: { vision: { reason: vision.reason } },
  };
  m.tier = vision.confidence >= 0.8 ? "high" : vision.confidence >= 0.5 ? "medium" : vision.confidence >= 0.3 ? "low" : "none";
  m.curation_note = `vision overrode DOM (${dom?.archetype_id ?? "none"}) → ${vision.archetype_id}`;
}

function loadArchetypes(): Archetype[] {
  const libPath = path.join(ARCHETYPES_DIR, "library.json");
  if (!existsSync(libPath)) return [];
  return (JSON.parse(readFileSync(libPath, "utf8")) as { archetypes: Archetype[] }).archetypes;
}

function readSectionHtml(domain: string, sectionId: string): string {
  const p = path.join(sectionsDir(domain), sectionId, "section.html");
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

function rewriteCurationQueue(
  domain: string,
  matches: MatchesFile,
  fpById: Map<string, SectionFingerprint>,
): void {
  const entries: CurationQueueEntry[] = [];
  for (const m of matches.matches) {
    if (m.tier === "high") continue;
    const fp = fpById.get(m.section_id);
    if (!fp) continue;
    entries.push({
      section_id: m.section_id,
      page_url: m.page_url,
      position_index: m.position_index,
      fingerprint_summary: {
        layout: fp.layout,
        child_count: fp.child_count,
        has_form: fp.has_form,
        has_video: fp.has_video,
        image_count: fp.image_count,
        word_count: fp.word_count,
      },
      ...(m.primary ? { best_partial_match: m.primary } : {}),
      ...(m.curation_note ? { notes: m.curation_note } : {}),
    });
  }
  const file: CurationQueueFile = { domain, generated_at: new Date().toISOString(), entries };
  writeFileSync(outputPath(domain, "curation-queue.json"), JSON.stringify(file, null, 2));
}

function stampBundle(domain: string, m: SectionMatch): void {
  const metaPath = path.join(sectionsDir(domain), m.section_id, "metadata.json");
  if (!existsSync(metaPath)) return;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
  meta.archetype_id = m.primary?.archetype_id ?? null;
  meta.archetype_confidence = m.primary?.confidence ?? null;
  meta.archetype_source = m.primary?.source ?? null;
  meta.archetype_tier = m.tier;
  if (m.curation_note) meta.curation_note = m.curation_note;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}
