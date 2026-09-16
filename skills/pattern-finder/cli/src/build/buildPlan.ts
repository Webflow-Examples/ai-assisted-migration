import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  AggregateFile,
  Archetype,
  BreakpointStyles,
  BuildPlanEntry,
  BuildPlanFile,
  BuildPlanSlot,
  ContentBag,
  MatchesFile,
  PropDefinition,
  WebflowPropType,
} from "../util/types.js";
import { ARCHETYPES_DIR, outputPath, sectionsDir } from "../util/paths.js";
import { info, step, warn } from "../util/log.js";

export interface BuildPlanOptions {
  domain: string;
}

/**
 * Phase 6 — emit a build plan: one entry per archetype in
 * `aggregate.recommended_components`, each pointing at a canonical section
 * bundle and listing the slots a downstream Webflow Component would expose.
 *
 * This is a pure data step. No MCP, no network. The emitted JSON is later
 * consumed by the `webflow-component-builder` Claude skill, which talks to
 * the Webflow MCP.
 */
export async function runBuildPlan(opts: BuildPlanOptions): Promise<BuildPlanFile> {
  const { domain } = opts;
  step("phase 6", `build plan for ${domain}`);

  const aggregate = JSON.parse(readFileSync(outputPath(domain, "aggregate.json"), "utf8")) as AggregateFile;
  const matches = JSON.parse(readFileSync(outputPath(domain, "matches.json"), "utf8")) as MatchesFile;
  const archetypes = loadArchetypes();
  const archetypesById = new Map(archetypes.map((a) => [a.id, a]));

  // Index frequency rows for occurrence/family counts on each entry.
  const freqById = new Map(aggregate.frequency.map((f) => [f.archetype_id, f]));

  // Pre-bucket high-confidence DOM matches by archetype_id so we can pick a
  // canonical section per archetype in O(1). DOM source is preferred over
  // vision/merged because DOM matches mean the rule library actually fired —
  // less noise than a heuristic agreement.
  const sectionsByArchetype = new Map<string, { section_id: string; page_url: string; confidence: number; source: string }[]>();
  for (const m of matches.matches) {
    if (m.tier !== "high" || !m.primary) continue;
    const list = sectionsByArchetype.get(m.primary.archetype_id) ?? [];
    list.push({
      section_id: m.section_id,
      page_url: m.page_url,
      confidence: m.primary.confidence,
      source: m.primary.source,
    });
    sectionsByArchetype.set(m.primary.archetype_id, list);
  }

  const entries: BuildPlanEntry[] = [];
  const skipped: { archetype_id: string; reason: string }[] = [];

  for (const id of aggregate.recommended_components) {
    const arch = archetypesById.get(id);
    if (!arch) {
      skipped.push({ archetype_id: id, reason: "archetype not found in library.json" });
      continue;
    }

    const candidates = sectionsByArchetype.get(id);
    if (!candidates || candidates.length === 0) {
      skipped.push({ archetype_id: id, reason: "no high-confidence section bundles for archetype" });
      continue;
    }

    // Pick canonical: DOM-source preferred, then highest confidence,
    // then word-count desc as tiebreaker (richer example).
    const ranked = [...candidates].sort((a, b) => {
      const sourceRank = (s: string) => (s === "dom" ? 0 : s === "merged" ? 1 : 2);
      const sa = sourceRank(a.source), sb = sourceRank(b.source);
      if (sa !== sb) return sa - sb;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      // Tiebreaker — pull richer bundle (more words) for slot example extraction
      const aMeta = readBundleMeta(domain, a.section_id);
      const bMeta = readBundleMeta(domain, b.section_id);
      return (bMeta?.word_count ?? 0) - (aMeta?.word_count ?? 0);
    });
    const chosen = ranked[0]!;

    const bundle = readBundle(domain, chosen.section_id);
    if (!bundle) {
      skipped.push({ archetype_id: id, reason: `bundle not on disk for section ${chosen.section_id}` });
      continue;
    }

    const slots = deriveSlots(arch, bundle.html, bundle.content);
    const propDefinitions = derivePropDefinitions(slots);
    const styles = bundle.styles;
    const freq = freqById.get(id);

    entries.push({
      archetype_id: id,
      component_name: arch.display_name,
      component_group: groupForCategory(arch.category),
      component_description: arch.description,
      canonical_section_id: chosen.section_id,
      canonical_source_url: chosen.page_url,
      canonical_confidence: +chosen.confidence.toFixed(3),
      section_html: bundle.html,
      slots,
      assets: bundle.assets,
      occurrences_in_site: freq?.total_occurrences ?? 0,
      families_in_site: freq?.template_families_with_archetype.length ?? 0,
      styles,
      prop_definitions: propDefinitions,
    });
  }

  const file: BuildPlanFile = {
    domain,
    generated_at: new Date().toISOString(),
    entries,
    skipped,
  };
  const outPath = outputPath(domain, "build-plan.json");
  writeFileSync(outPath, JSON.stringify(file, null, 2));
  info(`wrote ${outPath}`, {
    entries: entries.length,
    skipped: skipped.length,
  });
  if (skipped.length > 0) {
    for (const s of skipped) warn(`skipped ${s.archetype_id}`, { reason: s.reason });
  }
  return file;
}

function loadArchetypes(): Archetype[] {
  const libPath = path.join(ARCHETYPES_DIR, "library.json");
  if (!existsSync(libPath)) return [];
  return (JSON.parse(readFileSync(libPath, "utf8")) as { archetypes: Archetype[] }).archetypes;
}

interface BundleData {
  html: string;
  content: ContentBag;
  assets: string[];
  /** styles.json from Phase 2.5 if present; empty when capture-styles hasn't run. */
  styles: Record<string, BreakpointStyles>;
}

function readBundle(domain: string, sectionId: string): BundleData | null {
  const dir = path.join(sectionsDir(domain), sectionId);
  const htmlPath = path.join(dir, "section.html");
  const contentPath = path.join(dir, "content.json");
  if (!existsSync(htmlPath) || !existsSync(contentPath)) return null;
  const html = readFileSync(htmlPath, "utf8");
  const content = JSON.parse(readFileSync(contentPath, "utf8")) as ContentBag;
  const assetsDir = path.join(dir, "assets");
  const assets = existsSync(assetsDir) ? readdirSync(assetsDir).map((f) => `assets/${f}`) : [];
  const stylesPath = path.join(dir, "styles.json");
  let styles: Record<string, BreakpointStyles> = {};
  if (existsSync(stylesPath)) {
    try {
      styles = JSON.parse(readFileSync(stylesPath, "utf8")) as Record<string, BreakpointStyles>;
    } catch {
      styles = {};
    }
  }
  return { html, content, assets, styles };
}

function readBundleMeta(domain: string, sectionId: string): { word_count: number } | null {
  const metaPath = path.join(sectionsDir(domain), sectionId, "metadata.json");
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { word_count?: number };
    return { word_count: meta.word_count ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Derive slot definitions from the archetype's content_schema, populating
 * each with an example value pulled from the canonical section's content
 * extraction + a cardinality flag inferred by running the selector
 * against the section HTML.
 */
function deriveSlots(arch: Archetype, _html: string, content: ContentBag): BuildPlanSlot[] {
  const slots: BuildPlanSlot[] = [];

  for (const [name, selector] of Object.entries(arch.content_schema)) {
    const cardinality = inferCardinality(name, selector);
    const example = pickExample(name, selector, content);
    slots.push({ name, selector, cardinality, ...(example ? { example } : {}) });
  }

  return slots;
}

/**
 * Cardinality is an authoring hint, not a computed fact. We infer it from
 * the slot name + selector shape: plural slot names (cards, tiers, logos,
 * columns) and class-targeted selectors (.card, .tier) are repeating;
 * bare-element selectors (p, h1, img) and singular names (headline, media)
 * are 1:1.
 */
function inferCardinality(name: string, selector: string): "1" | "*" {
  const lower = name.toLowerCase();
  const pluralNames = /^(cards|tiers|logos|columns|slides|items|members|features|stats|links|fields|rows|panels|tabs)$/;
  if (pluralNames.test(lower)) return "*";
  // Class-targeted selectors that look like repeating items
  if (/\.(card|tier|logo|column|slide|item|member|feature|stat|row|panel|tab|swiper-slide|footer-col|mega-col|accordion-item|case-study|post|testimonial)\b/.test(selector)) {
    return "*";
  }
  // Pluralized class targets like ".cards", ".items"
  if (/\.[a-z]+s\b/.test(selector)) return "*";
  return "1";
}

/**
 * Walk content.json with light heuristics to find an example value for a
 * given slot. Slot names like `headline`, `subhead`, `cta`, `media`,
 * `cards`, `tiers` map onto the structured ContentBag fields.
 */
function pickExample(slotName: string, selector: string, content: ContentBag): string | undefined {
  const lower = slotName.toLowerCase();

  if (/headline|title|heading/.test(lower)) {
    return content.headings[0]?.text;
  }
  if (/subhead|subtitle|description|body|intro|copy/.test(lower)) {
    return content.paragraphs[0];
  }
  if (/cta|button|primary|secondary|action/.test(lower)) {
    // Honor :nth-of-type(N) in the selector so primary/secondary CTAs map
    // to different links rather than both pointing at links[0].
    const nth = /:nth-of-type\((\d+)\)/.exec(selector);
    const idx = nth ? Math.max(0, parseInt(nth[1]!, 10) - 1) : -1;
    if (idx >= 0 && content.links[idx]) return content.links[idx]!.label;
    if (/secondary/.test(lower) && content.links[1]) return content.links[1]!.label;
    if (/primary/.test(lower) && content.links[0]) return content.links[0]!.label;
    const ctaRoled = content.links.find((l) => l.role?.startsWith("cta"));
    return (ctaRoled ?? content.links[0])?.label;
  }
  if (/media|image|photo|illustration|video|logo|headshot/.test(lower)) {
    return content.images[0]?.src;
  }
  if (/link/.test(lower)) {
    return content.links[0]?.label;
  }
  if (/copyright/.test(lower)) {
    return content.paragraphs[0];
  }
  if (/email|field|input|form/.test(lower)) {
    return content.form_fields[0]?.label ?? content.form_fields[0]?.name;
  }
  // Fallback: if the selector clearly targets headings, use the first heading.
  if (/h[1-6]/i.test(selector)) {
    return content.headings[0]?.text;
  }
  if (/img|picture|video/i.test(selector)) {
    return content.images[0]?.src;
  }
  if (/^a\b/.test(selector)) {
    return content.links[0]?.label;
  }
  return undefined;
}

/**
 * Convert each slot to a typed Webflow prop spec the build skill turns
 * into MCP `create_prop` calls — or, when the slot is repeating, an
 * `insert_slot` action instead.
 *
 * Mapping is deterministic and based on slot name patterns. Source of
 * truth lives in the plan; keep the table in sync with the plan when
 * archetypes are added.
 */
function derivePropDefinitions(slots: BuildPlanSlot[]): PropDefinition[] {
  return slots.map((slot) => mapSlotToProp(slot));
}

function mapSlotToProp(slot: BuildPlanSlot): PropDefinition {
  const name = slot.name.toLowerCase();

  // Repeating slots → use_slot=true, the skill calls insert_slot for these.
  // Webflow type is left as "string" for the type field but isn't used since
  // use_slot short-circuits the create_prop path.
  if (slot.cardinality === "*") {
    return {
      slot_name: slot.name,
      webflow_type: "string",
      use_slot: true,
      ...(slot.example ? { default_value: slot.example } : {}),
    };
  }

  // Single-binding slots — pick a typed prop based on slot name.
  let webflow_type: WebflowPropType = "string";
  let multiline = false;

  if (/headline|title|heading/.test(name)) {
    webflow_type = "textContent";
  } else if (/subhead|subtitle|description|body|intro|copy/.test(name)) {
    webflow_type = "textContent";
    multiline = true;
  } else if (/cta|button|primary_cta|secondary_cta|link/.test(name)) {
    webflow_type = "link";
  } else if (/^media$|image|photo|logo|headshot/.test(name)) {
    webflow_type = "image";
  } else if (/^video/.test(name)) {
    webflow_type = "video";
  } else if (/copyright/.test(name)) {
    webflow_type = "textContent";
    multiline = true;
  } else if (/alt[_ -]?text/.test(name)) {
    webflow_type = "altText";
  }

  const def: PropDefinition = { slot_name: slot.name, webflow_type };
  if (multiline) def.multiline = true;
  if (slot.example) def.default_value = slot.example;
  return def;
}

/**
 * Map an archetype category to a Webflow Components group/folder name.
 * Designer surfaces these as collapsible sections in the Components panel,
 * so a stable, plural-noun grouping makes browsing easier.
 */
function groupForCategory(category: string): string {
  const map: Record<string, string> = {
    header: "Headers",
    nav: "Navigation",
    hero: "Heroes",
    "social-proof": "Social Proof",
    features: "Features",
    pricing: "Pricing",
    comparison: "Comparison",
    cta: "CTAs",
    faq: "FAQ",
    "content-list": "Content Lists",
    form: "Forms",
    about: "About",
    footer: "Footers",
    content: "Content",
  };
  return map[category] ?? capitalize(category);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
