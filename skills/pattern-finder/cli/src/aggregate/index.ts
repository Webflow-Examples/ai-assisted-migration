import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AggregateFile,
  Archetype,
  FingerprintFile,
  FrequencyRow,
  MatchesFile,
  TemplateFamily,
} from "../util/types.js";
import { ARCHETYPES_DIR, outputPath } from "../util/paths.js";
import { info, step } from "../util/log.js";

export interface AggregateOptions {
  domain: string;
  /** Min families an archetype must appear in to be recommended as a Component. */
  minFamiliesForComponent?: number;
}

/**
 * Phase 5 — aggregate fingerprints + matches into the site-wide spec data.
 * Clusters pages by their archetype signature (the sorted list of
 * high-confidence archetype IDs that appear on the page), surfaces
 * frequency, and produces Component / CMS-collection recommendations.
 */
export async function runAggregate(opts: AggregateOptions): Promise<AggregateFile> {
  const { domain, minFamiliesForComponent = 3 } = opts;
  step("phase 5", `aggregate for ${domain}`);

  const fingerprints = JSON.parse(readFileSync(outputPath(domain, "fingerprints.json"), "utf8")) as FingerprintFile;
  const matches = JSON.parse(readFileSync(outputPath(domain, "matches.json"), "utf8")) as MatchesFile;
  const archetypes = loadArchetypes();
  const archetypesById = new Map(archetypes.map((a) => [a.id, a]));

  // Page → archetype signature (only high-confidence matches define the family)
  const pageArchetypes = new Map<string, string[]>(); // url → [archetype_ids in position order]
  for (const m of matches.matches) {
    if (m.tier !== "high" || !m.primary) continue;
    const arr = pageArchetypes.get(m.page_url) ?? [];
    arr.push(m.primary.archetype_id);
    pageArchetypes.set(m.page_url, arr);
  }
  // Ensure every fingerprinted page is represented (even if 0 matches)
  for (const p of fingerprints.pages) {
    if (!pageArchetypes.has(p.url)) pageArchetypes.set(p.url, []);
  }

  // Cluster pages by signature (sorted unique archetype set)
  const familyMap = new Map<string, { signature: string[]; urls: string[] }>();
  for (const [url, ids] of pageArchetypes) {
    const sig = Array.from(new Set(ids)).sort();
    const key = crypto.createHash("sha1").update(sig.join("|")).digest("hex").slice(0, 8);
    const existing = familyMap.get(key);
    if (existing) existing.urls.push(url);
    else familyMap.set(key, { signature: sig, urls: [url] });
  }
  const families: TemplateFamily[] = [...familyMap.entries()]
    .sort((a, b) => b[1].urls.length - a[1].urls.length)
    .map(([key, { signature, urls }], i) => ({
      family_id: `family-${String(i + 1).padStart(2, "0")}-${key}`,
      display_name: namedFamily(signature, urls, archetypesById) ?? `family-${i + 1}`,
      member_urls: urls.sort(),
      archetype_signature: signature,
    }));

  // Stamp page_template_family back onto fingerprints + matches if useful — skipped here for simplicity.

  // Frequency table
  const freqMap = new Map<string, { occurrences: number; pages: Set<string>; families: Set<string> }>();
  const familyByUrl = new Map<string, string>();
  for (const f of families) for (const u of f.member_urls) familyByUrl.set(u, f.family_id);

  for (const m of matches.matches) {
    if (m.tier !== "high" || !m.primary) continue;
    const id = m.primary.archetype_id;
    const slot = freqMap.get(id) ?? { occurrences: 0, pages: new Set(), families: new Set() };
    slot.occurrences += 1;
    slot.pages.add(m.page_url);
    const fam = familyByUrl.get(m.page_url);
    if (fam) slot.families.add(fam);
    freqMap.set(id, slot);
  }
  const frequency: FrequencyRow[] = [...freqMap.entries()]
    .map(([id, v]) => ({
      archetype_id: id,
      total_occurrences: v.occurrences,
      pages_with_archetype: [...v.pages].sort(),
      template_families_with_archetype: [...v.families].sort(),
    }))
    .sort((a, b) => b.total_occurrences - a.total_occurrences);

  // Recommendations
  const recommendedComponents = frequency
    .filter((f) => f.template_families_with_archetype.length >= minFamiliesForComponent)
    .map((f) => f.archetype_id);

  const recommendedCmsCollections: { archetype_id: string; reason: string }[] = [];
  for (const f of frequency) {
    const a = archetypesById.get(f.archetype_id);
    if (!a) continue;
    if (
      ["content-list", "social-proof"].includes(a.category) &&
      f.total_occurrences >= 2 &&
      /grid|list|carousel/i.test(a.id)
    ) {
      recommendedCmsCollections.push({
        archetype_id: f.archetype_id,
        reason: `Repeating ${a.category} pattern across ${f.pages_with_archetype.length} pages — model as a CMS Collection`,
      });
    }
  }

  const oneOffSections = frequency.filter((f) => f.total_occurrences === 1).map((f) => f.archetype_id);

  const totalSections = matches.matches.length;
  const totalHighConf = matches.matches.filter((m) => m.tier === "high").length;
  const coverage = totalSections === 0 ? 0 : totalHighConf / totalSections;

  const file: AggregateFile = {
    domain,
    generated_at: new Date().toISOString(),
    total_pages: fingerprints.pages.length,
    total_sections: totalSections,
    total_high_confidence: totalHighConf,
    coverage_ratio: +coverage.toFixed(4),
    template_families: families,
    frequency,
    recommended_components: recommendedComponents,
    recommended_cms_collections: recommendedCmsCollections,
    one_off_sections: oneOffSections,
  };
  writeFileSync(outputPath(domain, "aggregate.json"), JSON.stringify(file, null, 2));
  info(`wrote ${outputPath(domain, "aggregate.json")}`);
  info("aggregate summary", {
    pages: file.total_pages,
    sections: file.total_sections,
    high_conf: file.total_high_confidence,
    coverage: file.coverage_ratio,
    families: families.length,
    recommended_components: recommendedComponents.length,
  });

  return file;
}

function loadArchetypes(): Archetype[] {
  const libPath = path.join(ARCHETYPES_DIR, "library.json");
  if (!existsSync(libPath)) return [];
  return (JSON.parse(readFileSync(libPath, "utf8")) as { archetypes: Archetype[] }).archetypes;
}

/**
 * Heuristic friendly name for a template family. Picks the highest-signal
 * archetype in the signature (e.g. "comparison-table" → "vs/comparison page")
 * or falls back to a path-based label from member URLs.
 */
function namedFamily(
  signature: string[],
  urls: string[],
  archetypesById: Map<string, Archetype>,
): string | undefined {
  // Strongly indicative archetypes — if present, the family is named after them.
  const strong: { match: (id: string) => boolean; label: string }[] = [
    { match: (id) => id.includes("comparison") || id.includes("-vs-"), label: "comparison-page" },
    { match: (id) => id === "pricing-tiers", label: "pricing-page" },
    { match: (id) => id === "blog-card-grid", label: "blog-index" },
    { match: (id) => id === "case-study-grid", label: "case-studies" },
    { match: (id) => id === "team-grid", label: "about-team" },
    { match: (id) => id === "contact-form", label: "contact-page" },
    { match: (id) => id === "faq-accordion", label: "faq-page" },
    { match: (id) => id === "hero-with-form", label: "demo-request" },
  ];
  for (const { match, label } of strong) {
    if (signature.some(match)) return label;
  }

  // URL-segment hint: most consistent path segment among members.
  const segCounts = new Map<string, number>();
  for (const u of urls) {
    try {
      const seg = new URL(u).pathname.split("/").filter(Boolean)[0];
      if (seg) segCounts.set(seg, (segCounts.get(seg) ?? 0) + 1);
    } catch {
      /* ignore */
    }
  }
  const segWinner = [...segCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (segWinner && segWinner[1] >= Math.max(2, urls.length / 2)) {
    return `path:/${segWinner[0]}`;
  }

  // Fallback: most distinctive non-chrome archetype in the signature.
  // ("chrome" = nav/header/footer that appears site-wide and doesn't differentiate.)
  const CHROME = new Set(["header-contact-bar", "nav-primary", "nav-mega-menu", "footer-simple", "footer-multi-column"]);
  const distinctive = signature.find((id) => {
    const a = archetypesById.get(id);
    return a && !CHROME.has(id);
  });
  if (distinctive) {
    const a = archetypesById.get(distinctive);
    return a ? `${a.category}-page` : distinctive;
  }
  return urls.length === 1 ? "single-url" : "chrome-only";
}
