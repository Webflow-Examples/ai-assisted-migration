import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

/**
 * Heuristic layout signature: classifies the section's first level of
 * meaningful children into a recognizable shape. Phase-3 archetype rules
 * key off of this string.
 */
export function layoutSignature($: CheerioAPI, el: Element): string {
  const $el = $(el);
  const cols = countColumns($, el);
  if (cols === 0) return "single";
  if (cols === 1) return "stack";
  if (cols === 2) return "two-col";
  if (cols === 3) return "three-col";
  if (cols === 4) return "four-col";
  if (cols >= 5) return `grid-${cols}`;

  // Carousel / accordion / tabs detection
  if ($el.find(".swiper, .slick-slider, [data-element_type='widget'][data-widget_type*='carousel']").length) return "carousel";
  if ($el.find(".elementor-accordion, .elementor-toggle, details, [data-widget_type*='accordion']").length) return "accordion";
  if ($el.find(".elementor-tabs, [role='tablist'], [data-widget_type*='tabs']").length) return "tabs";

  return "stack";
}

function countColumns($: CheerioAPI, el: Element): number {
  const $el = $(el);

  // Elementor columns
  const elColumns = $el.children().find(".elementor-column").addBack(".elementor-column");
  // Filter to only direct-ish columns (depth ≤ 3)
  const direct = $el.find("> .elementor-container > .elementor-column, > .elementor-row > .elementor-column, > .e-con-inner > .e-con, > .e-con > .e-con").length;
  if (direct > 0) return direct;

  // Generic CSS Grid / Flex with direct content children
  const childDivs = $el.children("div, section, article").length;
  if (childDivs > 1 && childDivs <= 6) return childDivs;

  return 0;
}

/**
 * Filter raw class names down to ones that are useful as features —
 * i.e. semantic-ish names, not utility soup like "css-1abc2 mt-4".
 */
export function classFeatures($: CheerioAPI, el: Element, limit = 30): string[] {
  const $el = $(el);
  const seen = new Set<string>();
  const out: string[] = [];

  const collect = (cls: string) => {
    for (const c of cls.split(/\s+/)) {
      if (!c || seen.has(c)) continue;
      if (!isInformative(c)) continue;
      seen.add(c);
      out.push(c);
      if (out.length >= limit) return;
    }
  };

  collect($el.attr("class") ?? "");
  $el.find("[class]").each((_, child) => {
    if (out.length >= limit) return;
    collect($(child).attr("class") ?? "");
  });

  return out;
}

function isInformative(c: string): boolean {
  if (c.length < 3 || c.length > 60) return false;
  // Drop cache-busted hashes / utility token soup
  if (/^[a-z]+-[0-9a-f]{6,}$/i.test(c)) return false;
  if (/^css-[0-9a-z]+$/i.test(c)) return false;
  if (/^(mt|mb|ml|mr|pt|pb|pl|pr|m|p|w|h)-[0-9]/.test(c)) return false;
  if (/^(elementor-element-[0-9a-f]+)$/.test(c)) return false; // per-instance ID
  return true;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Map a section to a builder-specific block type when one is detected
 * (e.g. "elementor:cta", "elementor:image-box").
 */
export function builderBlockType($: CheerioAPI, el: Element): string | undefined {
  const $el = $(el);
  // Elementor exposes the widget type on each .elementor-widget child.
  // The section block type is best inferred from its dominant widget type.
  const widgets = $el
    .find("[data-widget_type], [data-element_type='widget']")
    .map((_, w) => $(w).attr("data-widget_type") ?? $(w).attr("data-element_type"))
    .get()
    .filter((v): v is string => !!v);
  if (widgets.length === 0) return undefined;

  // Pick the most-frequent widget type as the block label.
  const counts = new Map<string, number>();
  for (const w of widgets) counts.set(w, (counts.get(w) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `elementor:${top[0]}` : undefined;
}
