import { readFileSync } from "node:fs";
import type { CurationQueueFile } from "../util/types.js";
import { outputPath } from "../util/paths.js";
import { info, step } from "../util/log.js";

export interface QueueSummaryOptions {
  domain: string;
  /** Cluster threshold — patterns that recur ≥N times are surfaced as candidates. */
  minRecurrence?: number;
  /** Hard cap on candidates printed. */
  topN?: number;
}

/**
 * Print a digest of the curation queue: which structural patterns recur most
 * often among unmatched/low-confidence sections. Recurring patterns are
 * candidates for a new archetype — that's how the library grows.
 *
 * Patterns are keyed by a coarse fingerprint signature (layout + flag bits +
 * word/image/link buckets) so genuine repeats cluster while one-offs don't.
 */
export function summarizeCurationQueue(opts: QueueSummaryOptions): void {
  const { domain, minRecurrence = 3, topN = 20 } = opts;
  step("curation", `queue digest for ${domain}`);

  const queue = JSON.parse(readFileSync(outputPath(domain, "curation-queue.json"), "utf8")) as CurationQueueFile;
  const total = queue.entries.length;

  const buckets = new Map<string, { signature: string; count: number; sample_section_id: string; sample_page_url: string }>();
  for (const e of queue.entries) {
    const f = e.fingerprint_summary;
    const sig = [
      f.layout,
      `w:${bucketWords(f.word_count)}`,
      `i:${bucketCount(f.image_count)}`,
      `l:${bucketCount(f.child_count)}`,
      f.has_form ? "form" : "",
      f.has_video ? "video" : "",
    ].filter(Boolean).join("|");
    const slot = buckets.get(sig);
    if (slot) slot.count += 1;
    else buckets.set(sig, { signature: sig, count: 1, sample_section_id: e.section_id, sample_page_url: e.page_url });
  }

  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
  const candidates = ranked.filter((r) => r.count >= minRecurrence).slice(0, topN);

  info("curation summary", {
    queue_size: total,
    distinct_patterns: buckets.size,
    candidate_patterns: candidates.length,
  });

  if (candidates.length === 0) {
    info(`no patterns recur ≥${minRecurrence}× — nothing to promote`);
    return;
  }

  console.log("\nTop recurring patterns (candidates for new archetypes):");
  for (const c of candidates) {
    console.log(`  ${String(c.count).padStart(4)}×  ${c.signature}`);
    console.log(`        sample: ${c.sample_section_id}  ${c.sample_page_url}`);
  }
}

function bucketWords(n: number): string {
  if (n === 0) return "0";
  if (n < 20) return "<20";
  if (n < 80) return "20-80";
  if (n < 200) return "80-200";
  return "200+";
}

function bucketCount(n: number): string {
  if (n === 0) return "0";
  if (n <= 3) return "1-3";
  if (n <= 8) return "4-8";
  return "9+";
}
