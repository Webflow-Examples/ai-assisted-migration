/**
 * Shared types across the pipeline.
 *
 * Each phase reads/writes JSON to disk; these are the on-disk contracts.
 * Keep them additive — phases downstream tolerate extra fields, never break
 * on new optional ones.
 */

// ─── Phase 1: Discovery ─────────────────────────────────────────────────────

export type PageBuilder =
  | "elementor"
  | "divi"
  | "wpbakery"
  | "gutenberg"
  | "beaver-builder"
  | "oxygen"
  | "bricks"
  | "custom-theme"
  | "unknown";

export interface DiscoveryEntry {
  url: string;
  status: number;
  redirected_to?: string;
  content_type?: string;
  body_classes: string[];
  generator?: string;
  page_builder: PageBuilder;
  builder_signals: string[]; // raw evidence strings
  is_utility: boolean; // privacy/legal/thank-you/redirect — skip in deeper phases
  utility_reason?: string;
  error?: string; // populated on probe failure
}

export interface DiscoveryFile {
  domain: string;
  sitemap_url?: string;
  generated_at: string;
  total_urls: number;
  entries: DiscoveryEntry[];
}

// ─── Phase 2: Fingerprint + Extract ─────────────────────────────────────────

export interface ContentBag {
  headings: { level: 1 | 2 | 3 | 4 | 5 | 6; text: string }[];
  paragraphs: string[];
  images: { src: string; alt: string; role?: string; width?: number; height?: number }[];
  links: { href: string; label: string; role?: string }[];
  buttons: { label: string; role?: string }[];
  form_fields: { name?: string; type: string; label?: string }[];
  lists: { ordered: boolean; items: string[] }[];
  raw_text_word_count: number;
}

export interface SectionFingerprint {
  section_id: string; // {url-hash}__{position}
  page_url: string;
  position_index: number;
  dom_path: string; // CSS-style path to the section root
  tag: string;
  /** Cleaned outerHTML of the section */
  html: string;
  /** Layout signature: "two-col", "grid-3", "stack", "single", etc. */
  layout: string;
  child_count: number;
  word_count: number;
  image_count: number;
  link_count: number;
  has_form: boolean;
  has_video: boolean;
  has_carousel: boolean;
  has_accordion: boolean;
  has_tabs: boolean;
  /** Filtered class-name n-grams used as features */
  class_features: string[];
  /** Page-builder block type, if detectable */
  builder_block_type?: string;
  /** Approximate y-bounds within the rendered page (if known) */
  y_bounds?: { y_start: number; y_end: number };
  content: ContentBag;
}

export interface PageFingerprint {
  url: string;
  page_template_family?: string; // populated later from clustering
  scrape_status: "ok" | "failed" | "skipped";
  error?: string;
  full_screenshot_path?: string;
  sections: SectionFingerprint[];
}

export interface FingerprintFile {
  domain: string;
  generated_at: string;
  pages: PageFingerprint[];
}

// ─── Phase 3 + 4: Matching ──────────────────────────────────────────────────

export type ConfidenceTier = "high" | "medium" | "low" | "none";

export interface ArchetypeMatch {
  archetype_id: string;
  confidence: number; // 0..1
  source: "dom" | "vision" | "merged";
  evidence?: Record<string, unknown>;
}

export interface SectionMatch {
  section_id: string;
  page_url: string;
  position_index: number;
  tier: ConfidenceTier;
  primary?: ArchetypeMatch;
  candidates: ArchetypeMatch[]; // top-N
  curation_note?: string;
}

export interface MatchesFile {
  domain: string;
  generated_at: string;
  matches: SectionMatch[];
  unmatched_section_ids: string[];
}

// ─── Phase 5: Aggregation + Report ──────────────────────────────────────────

export interface FrequencyRow {
  archetype_id: string;
  total_occurrences: number;
  pages_with_archetype: string[];
  template_families_with_archetype: string[];
}

export interface TemplateFamily {
  family_id: string;
  display_name: string;
  member_urls: string[];
  archetype_signature: string[];
}

export interface AggregateFile {
  domain: string;
  generated_at: string;
  total_pages: number;
  total_sections: number;
  total_high_confidence: number;
  coverage_ratio: number;
  template_families: TemplateFamily[];
  frequency: FrequencyRow[];
  recommended_components: string[]; // archetype IDs appearing in ≥3 families
  recommended_cms_collections: { archetype_id: string; reason: string }[];
  one_off_sections: string[];
}

// ─── Archetype library ──────────────────────────────────────────────────────

export interface ArchetypeDOMRules {
  /** Substrings to look for in dom_path / tag (e.g. "header", "footer", "nav"). */
  section_role_hints?: string[];
  /** Any-of match against fingerprint.layout (e.g. ["two-col","three-col"]). */
  child_layout?: string[];
  /** class_features must include any of these substrings. */
  must_contain_class?: string[];
  /** builder_block_type must include any of these substrings. */
  builder_block_type_includes?: string[];
  /** [min, max] inclusive range against fingerprint.child_count. */
  child_count_range?: [number, number];
  /** Required boolean flags on fingerprint (has_form, has_video, …). */
  must_have?: Partial<{
    has_form: boolean;
    has_video: boolean;
    has_carousel: boolean;
    has_accordion: boolean;
    has_tabs: boolean;
  }>;
}

export interface ArchetypeContentRules {
  min_words?: number;
  max_words?: number;
  min_images?: number;
  max_images?: number;
  min_links?: number;
  max_links?: number;
  min_headings?: number;
  has_form?: boolean;
  has_video?: boolean;
  has_carousel?: boolean;
  has_accordion?: boolean;
  has_tabs?: boolean;
}

export interface ArchetypeContentSchema {
  [slot: string]: string; // selector or extraction hint
}

/**
 * Gates are *hard requirements*. Any defined gate that fails forces the
 * archetype's confidence to 0 — no matter how many soft rules pass. Use
 * gates to express "this archetype is impossible without X" (e.g. a
 * testimonial without a quote signal, a footer not in a footer role).
 */
export interface ArchetypeGates {
  section_role_hints?: string[]; // any-of substring match against dom_path/tag
  must_contain_class_any?: string[]; // any-of substring match against class_features
  builder_block_type_any?: string[]; // any-of substring match against builder_block_type
  child_layout_any?: string[]; // any-of exact match against fingerprint.layout
  must_have?: Partial<{
    has_form: boolean;
    has_video: boolean;
    has_carousel: boolean;
    has_accordion: boolean;
    has_tabs: boolean;
  }>;
  position_index_max?: number; // section must appear within first N on the page
  position_index_min?: number; // section must appear after position N
  word_count_min?: number;
  word_count_max?: number;
  image_count_min?: number;
  image_count_max?: number;
  heading_count_min?: number;
  link_count_min?: number;
  link_count_max?: number;
}

export interface Archetype {
  id: string;
  version: string;
  display_name: string;
  category: string;
  description: string;
  match_rules: {
    gates?: ArchetypeGates;
    dom?: ArchetypeDOMRules;
    content?: ArchetypeContentRules;
  };
  confidence_weights: { dom: number; content: number };
  vision_prompt_hint: string;
  content_schema: ArchetypeContentSchema;
  common_variants?: string[];
}

// ─── Curation queue ─────────────────────────────────────────────────────────

export interface CurationQueueEntry {
  section_id: string;
  page_url: string;
  position_index: number;
  fingerprint_summary: {
    layout: string;
    child_count: number;
    has_form: boolean;
    has_video: boolean;
    image_count: number;
    word_count: number;
  };
  best_partial_match?: ArchetypeMatch;
  suggested_archetype_id?: string;
  notes?: string;
}

export interface CurationQueueFile {
  domain: string;
  generated_at: string;
  entries: CurationQueueEntry[];
}

// ─── Phase 6: Build plan (Webflow Component shells) ─────────────────────────

/**
 * One slot inside a Component. Slots are the "fill-in-the-blanks" of an
 * archetype — what a Designer wires up as Component properties after the
 * shell is created.
 */
export interface BuildPlanSlot {
  /** Slot name from the archetype's `content_schema` (e.g. "headline"). */
  name: string;
  /** CSS-style selector hint from the archetype's `content_schema`. */
  selector: string;
  /** Example value pulled from the canonical section's content.json. */
  example?: string;
  /** "1" for single-binding slots, "*" for repeating (cards, tiers, slides). */
  cardinality: "1" | "*";
}

/**
 * Webflow-compatible prop type produced by `de_component_tool.create_prop`.
 * 'slot' is a special marker — repeating slots are inserted via
 * `de_component_tool.insert_slot`, not declared as props.
 */
export type WebflowPropType =
  | "textContent"
  | "string"
  | "richText"
  | "image"
  | "link"
  | "video"
  | "boolean"
  | "number"
  | "altText"
  | "id";

/**
 * Typed prop spec the skill turns into MCP `create_prop` calls (or a slot
 * insertion when use_slot is true).
 */
export interface PropDefinition {
  slot_name: string;
  webflow_type: WebflowPropType;
  multiline?: boolean;
  default_value?: string;
  /** When true, this entry should drive `insert_slot` instead of `create_prop`. */
  use_slot?: boolean;
}

/**
 * CSS property → value pairs at one breakpoint. Longhand only —
 * shorthand (`padding`, `margin`, `border`, etc.) is expanded by the
 * capture step.
 */
export type CSSDeclarations = Record<string, string>;

/**
 * Computed styles for one element at the three breakpoints used by the
 * desktop-down cascade. `tablet` and `mobile` carry only diffs against
 * the previous breakpoint to keep the JSON small.
 */
export interface BreakpointStyles {
  base: CSSDeclarations;
  tablet?: CSSDeclarations;
  mobile?: CSSDeclarations;
}

export interface BuildPlanEntry {
  archetype_id: string;
  /** Display-name for the Webflow Component, e.g. "Hero / Split — Text + Image". */
  component_name: string;
  /** Group/folder under which the Component is created in the Designer. */
  component_group: string;
  /** Short description shown in the Components panel. */
  component_description: string;
  /** Section ID of the bundle chosen as the canonical example. */
  canonical_section_id: string;
  /** Source URL of the page the canonical section came from. */
  canonical_source_url: string;
  /** Archetype confidence on the chosen section (0..1). */
  canonical_confidence: number;
  /** Cleaned section HTML — fed to whtml_builder when the skill runs. */
  section_html: string;
  /** Slot definitions for the Component, derived from archetype.content_schema. */
  slots: BuildPlanSlot[];
  /** Relative paths to assets bundled with the canonical section. */
  assets: string[];
  /** Sitewide occurrence count for this archetype (from aggregate.frequency). */
  occurrences_in_site: number;
  /** Sitewide template-family count for this archetype. */
  families_in_site: number;
  /**
   * Computed styles per element selector path within section.html. The skill
   * pushes `base` as the desktop default and `tablet`/`mobile` as max-width
   * overrides via Webflow's breakpoint system. Empty if capture-styles has
   * not been run for this domain.
   */
  styles: Record<string, BreakpointStyles>;
  /**
   * Typed prop spec per slot, derived from the archetype's content_schema +
   * a deterministic name → Webflow type mapping. Drives `create_prop` and
   * `insert_slot` calls in the build skill.
   */
  prop_definitions: PropDefinition[];
}

export interface BuildPlanFile {
  domain: string;
  generated_at: string;
  entries: BuildPlanEntry[];
  /** Archetypes that recommended_components listed but where no canonical section was found. */
  skipped: { archetype_id: string; reason: string }[];
}
