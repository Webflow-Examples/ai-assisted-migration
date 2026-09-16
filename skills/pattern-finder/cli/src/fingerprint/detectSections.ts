import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type { PageBuilder } from "../util/types.js";

/**
 * A detected section: the cheerio element plus a short reason for why it
 * was selected. The reason is useful debugging telemetry — it shows whether
 * the page was segmented via builder markers, semantic HTML, or fallback.
 */
export interface DetectedSection {
  el: Element;
  source: "elementor" | "divi" | "wpbakery" | "beaver" | "oxygen" | "bricks" | "gutenberg" | "semantic" | "fallback";
}

/**
 * Detect top-level sections in a page. Strategy is layered:
 *   1. Builder-specific top-level blocks (Elementor sections, Divi rows, …)
 *   2. Semantic HTML5 (<section>, <header>, <footer>, <main> children)
 *   3. Fallback: top-level direct children of <main> or <body>
 *
 * "Top-level" means not nested inside another already-selected section,
 * because a hero contains columns contains widgets — we want the hero only.
 */
export function detectSections($: CheerioAPI, builder: PageBuilder): DetectedSection[] {
  const candidates = findCandidates($, builder);
  return dedupeNested($, candidates);
}

function findCandidates($: CheerioAPI, builder: PageBuilder): DetectedSection[] {
  const out: DetectedSection[] = [];

  if (builder === "elementor") {
    // Elementor's top-level units are .elementor-section (classic) and
    // .e-con (containers, newer Flexbox/Grid editor). Both are direct
    // children of an <elementor-section-wrap> or .elementor-inner / data-elementor-type root.
    $(".elementor-top-section, .elementor-section.elementor-top-section, .e-con.e-parent, .elementor-section[data-element_type='section']").each((_, el) => {
      out.push({ el, source: "elementor" });
    });
    // Fallback Elementor selector if none of the above hit:
    if (out.length === 0) {
      $("section.elementor-section, .elementor-section, .e-con").each((_, el) => {
        out.push({ el, source: "elementor" });
      });
    }
  } else if (builder === "divi") {
    $(".et_pb_section").each((_, el) => { out.push({ el, source: "divi" }); });
  } else if (builder === "wpbakery") {
    $(".vc_row, .wpb_row").each((_, el) => { out.push({ el, source: "wpbakery" }); });
  } else if (builder === "beaver-builder") {
    $(".fl-row").each((_, el) => { out.push({ el, source: "beaver" }); });
  } else if (builder === "oxygen") {
    $(".ct-section, [class*='ct_section']").each((_, el) => { out.push({ el, source: "oxygen" }); });
  } else if (builder === "bricks") {
    $("[class*='brxe-section'], section[class*='brxe-']").each((_, el) => { out.push({ el, source: "bricks" }); });
  } else if (builder === "gutenberg") {
    // Gutenberg has no enforced section concept; group consecutive top-level
    // blocks into one logical section by their parent wp-block-group/wp-block-cover/
    // or just take top-level wp-block-* under main/article.
    $("main .wp-block-group, main .wp-block-cover, article > .wp-block-group, article > .wp-block-cover").each((_, el) => {
      out.push({ el, source: "gutenberg" });
    });
  }

  if (out.length > 0) return out;

  // Semantic fallback
  $("body > header, body > main > header, body > main > section, body > footer, main > section, main > article > section").each((_, el) => {
    out.push({ el, source: "semantic" });
  });

  if (out.length > 0) return out;

  // Last-resort fallback: top-level children of <main> or <body> with content.
  const root = $("main").first().length ? $("main").first() : $("body").first();
  root.children().each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (!text && $el.find("img,picture,video,svg,iframe,form").length === 0) return;
    out.push({ el, source: "fallback" });
  });

  return out;
}

/**
 * Drop any candidate that is contained by an earlier candidate. Order matters:
 * builder-specific selectors run first and are preferred over their nested kin.
 */
function dedupeNested($: CheerioAPI, candidates: DetectedSection[]): DetectedSection[] {
  const out: DetectedSection[] = [];
  for (const cand of candidates) {
    const $cand = $(cand.el);
    const containedByEarlier = out.some((prev) => $cand.parents().is(prev.el));
    if (containedByEarlier) continue;
    // Also drop if any earlier is inside this one — replace it
    const containsEarlier = out.findIndex((prev) => $(prev.el).parents().is(cand.el));
    if (containsEarlier >= 0) {
      out.splice(containsEarlier, 1);
    }
    out.push(cand);
  }
  return out;
}

/**
 * Compute a stable CSS-style DOM path to an element.
 * e.g. "main > div:nth-child(2) > section.elementor-section.hero"
 * Used to locate the section deterministically across runs.
 */
export function domPath($: CheerioAPI, el: Element): string {
  const parts: string[] = [];
  let cursor: Cheerio<Element> | null = $(el);
  while (cursor && cursor.length && cursor.get(0)?.type === "tag") {
    const node = cursor.get(0)!;
    const tag = node.tagName ?? "div";
    const parent = cursor.parent();
    if (!parent.length || parent.get(0)?.type !== "tag") {
      parts.unshift(tag);
      break;
    }
    const siblings = parent.children(tag);
    const idx = siblings.toArray().indexOf(node) + 1;
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    cursor = parent as Cheerio<Element>;
  }
  return parts.join(" > ");
}
