import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { AggregateFile, Archetype, MatchesFile } from "../util/types.js";
import { ARCHETYPES_DIR, outputPath } from "../util/paths.js";
import { info, step } from "../util/log.js";

export interface ReportOptions {
  domain: string;
}

/**
 * Phase 5b — render the human-readable site-component-spec.md from the
 * aggregate.json + archetype library. This is the primary deliverable.
 */
export async function runReport(opts: ReportOptions): Promise<string> {
  const { domain } = opts;
  step("phase 5b", `report for ${domain}`);

  const agg = JSON.parse(readFileSync(outputPath(domain, "aggregate.json"), "utf8")) as AggregateFile;
  const matches = JSON.parse(readFileSync(outputPath(domain, "matches.json"), "utf8")) as MatchesFile;
  const archetypes = loadArchetypes();
  const byId = new Map(archetypes.map((a) => [a.id, a]));

  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push(`# Site Component Spec — ${domain}`);
  push();
  push(`_Generated ${agg.generated_at}_`);
  push();

  push(`## Summary`);
  push();
  push(`- **Pages analyzed:** ${agg.total_pages}`);
  push(`- **Sections detected:** ${agg.total_sections}`);
  push(`- **High-confidence matches:** ${agg.total_high_confidence} (${(agg.coverage_ratio * 100).toFixed(1)}%)`);
  push(`- **Template families:** ${agg.template_families.length}`);
  push(`- **Recommended Components:** ${agg.recommended_components.length}`);
  push(`- **Recommended CMS Collections:** ${agg.recommended_cms_collections.length}`);
  push();

  push(`## Recommended Webflow Components`);
  push();
  push(`Archetypes appearing in 3+ template families. Build these first as reusable Components.`);
  push();
  if (agg.recommended_components.length === 0) {
    push(`_None yet — coverage too low or sections too varied. Inspect curation-queue.json._`);
  } else {
    for (const id of agg.recommended_components) {
      const a = byId.get(id);
      const f = agg.frequency.find((r) => r.archetype_id === id);
      push(`### ${a?.display_name ?? id}`);
      push();
      push(`- **Archetype ID:** \`${id}\``);
      push(`- **Category:** ${a?.category ?? "unknown"}`);
      push(`- **Occurrences:** ${f?.total_occurrences ?? "?"} across ${f?.template_families_with_archetype.length ?? "?"} families`);
      push(`- **Description:** ${a?.description ?? ""}`);
      if (a?.content_schema) {
        push(`- **Slots / properties:**`);
        for (const [slot, hint] of Object.entries(a.content_schema)) {
          push(`  - \`${slot}\` — ${hint}`);
        }
      }
      push();
    }
  }

  push(`## Recommended CMS Collections`);
  push();
  if (agg.recommended_cms_collections.length === 0) {
    push(`_None detected._`);
  } else {
    for (const rec of agg.recommended_cms_collections) {
      const a = byId.get(rec.archetype_id);
      push(`- **${a?.display_name ?? rec.archetype_id}** — ${rec.reason}`);
    }
  }
  push();

  push(`## Template Families`);
  push();
  push(`Pages clustered by their high-confidence archetype signature. Each family ≈ one template in Webflow.`);
  push();
  for (const fam of agg.template_families) {
    push(`### ${fam.display_name} (\`${fam.family_id}\`)`);
    push();
    push(`- **Members:** ${fam.member_urls.length} pages`);
    push(`- **Signature:** ${fam.archetype_signature.length ? fam.archetype_signature.map((s) => `\`${s}\``).join(", ") : "_(no high-confidence sections)_"}`);
    push(`- **Sample URLs:**`);
    for (const u of fam.member_urls.slice(0, 5)) push(`  - ${u}`);
    if (fam.member_urls.length > 5) push(`  - …and ${fam.member_urls.length - 5} more`);
    push();
  }

  push(`## Archetype Frequency`);
  push();
  push(`| Archetype | Occurrences | Pages | Families |`);
  push(`| --- | ---: | ---: | ---: |`);
  for (const f of agg.frequency) {
    const name = byId.get(f.archetype_id)?.display_name ?? f.archetype_id;
    push(`| ${name} (\`${f.archetype_id}\`) | ${f.total_occurrences} | ${f.pages_with_archetype.length} | ${f.template_families_with_archetype.length} |`);
  }
  push();

  push(`## One-off Sections`);
  push();
  if (agg.one_off_sections.length === 0) {
    push(`_None._`);
  } else {
    push(`Archetypes that matched on exactly one section site-wide. Build as one-off Webflow sections, not Components.`);
    push();
    for (const id of agg.one_off_sections) {
      push(`- \`${id}\``);
    }
  }
  push();

  // Curation backlog summary
  const lowCount = matches.matches.filter((m) => m.tier === "low").length;
  const noneCount = matches.matches.filter((m) => m.tier === "none").length;
  const medCount = matches.matches.filter((m) => m.tier === "medium").length;
  push(`## Curation Backlog`);
  push();
  push(`Sections that didn't reach high confidence. See \`curation-queue.json\` for details.`);
  push();
  push(`- **Medium-tier:** ${medCount} (would benefit from vision verification)`);
  push(`- **Low-tier:** ${lowCount}`);
  push(`- **No match:** ${noneCount} (likely candidates for new archetypes)`);
  push();

  push(`---`);
  push(`_Bundles per section live in \`output/${domain}/sections/<section_id>/\`._`);

  const md = lines.join("\n");
  const outPath = outputPath(domain, "site-component-spec.md");
  writeFileSync(outPath, md);
  info(`wrote ${outPath}`);
  return outPath;
}

function loadArchetypes(): Archetype[] {
  const libPath = path.join(ARCHETYPES_DIR, "library.json");
  if (!existsSync(libPath)) return [];
  return (JSON.parse(readFileSync(libPath, "utf8")) as { archetypes: Archetype[] }).archetypes;
}
