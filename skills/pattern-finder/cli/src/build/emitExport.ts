import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type {
  BreakpointStyles,
  BuildPlanEntry,
  BuildPlanFile,
  CSSDeclarations,
} from "../util/types.js";
import { outputPath } from "../util/paths.js";
import { info, step, warn } from "../util/log.js";

export interface EmitExportOptions {
  domain: string;
  /**
   * When true, emit only the desktop base styles — skip the tablet
   * (≤991px) and mobile (≤479px) `@media` overrides. Useful for diagnosing
   * fidelity issues: if desktop-only paste looks closer to source than the
   * full responsive paste, the mobile rules are masking the real shape in
   * Webflow Designer's narrower canvas.
   */
  desktopOnly?: boolean;
}

/**
 * Phase 7 — emit per-Component bare HTML+CSS fragments ready to paste into
 * Webflow via the Ares extension.
 *
 * Reads `build-plan.json` and produces one self-contained HTML file per
 * Component plus a README index. No MCP, no network, deterministic.
 *
 * Output structure:
 *   output/<domain>/exports/
 *     README.md                       index + paste instructions
 *     01-<archetype-id>.html          ordered chrome → heroes → content
 *     02-<archetype-id>.html
 *     ...
 */
export async function runEmitExport(opts: EmitExportOptions): Promise<{ files: number }> {
  const { domain, desktopOnly = false } = opts;
  step("phase 7", `emit Webflow paste fragments for ${domain}${desktopOnly ? " (desktop-only)" : ""}`);

  const planPath = outputPath(domain, "build-plan.json");
  if (!existsSync(planPath)) {
    throw new Error(`build-plan.json not found for ${domain} — run \`ai-migrate build-plan\` first`);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as BuildPlanFile;
  if (plan.entries.length === 0) {
    warn("build-plan has no entries; nothing to emit");
    return { files: 0 };
  }

  const exportsDir = path.join(outputPath(domain), "exports");
  mkdirSync(exportsDir, { recursive: true });

  const ordered = sortForPaste(plan.entries);

  let filesWritten = 0;
  // Accumulate parts for the combined "paste-once" file alongside the per-Component files.
  const combinedParts: { entry: BuildPlanEntry; classes: ClassEntry[]; html: string }[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i]!;
    const parts = buildFragmentParts(entry);
    const fragment = renderFragment(entry, parts.classes, parts.html, desktopOnly);
    const filename = `${String(i + 1).padStart(2, "0")}-${entry.archetype_id}.html`;
    const fullPath = path.join(exportsDir, filename);
    writeFileSync(fullPath, fragment);
    filesWritten += 1;
    combinedParts.push({ entry, classes: parts.classes, html: parts.html });
  }

  const combinedPath = path.join(exportsDir, "all-components.html");
  writeFileSync(combinedPath, renderCombined(plan.domain, combinedParts, desktopOnly));
  filesWritten += 1;

  const readmePath = path.join(exportsDir, "README.md");
  writeFileSync(readmePath, buildReadme(plan, ordered));
  info(`wrote ${exportsDir}`, { files: filesWritten + 1 });

  return { files: filesWritten };
}

/** Recommended paste order: chrome → heroes → content. Stable secondary sort. */
function sortForPaste(entries: BuildPlanEntry[]): BuildPlanEntry[] {
  const groupRank: Record<string, number> = {
    Navigation: 1,
    Headers: 2,
    Footers: 3,
    Heroes: 4,
    "Social Proof": 5,
    Features: 6,
    CTAs: 7,
    FAQ: 8,
    Pricing: 9,
    Comparison: 10,
    "Content Lists": 11,
    Forms: 12,
    About: 13,
    Content: 14,
  };
  return [...entries].sort((a, b) => {
    const rankA = groupRank[a.component_group] ?? 99;
    const rankB = groupRank[b.component_group] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return a.archetype_id.localeCompare(b.archetype_id);
  });
}

interface ClassEntry {
  name: string;
  /** Lowercase tag name of the element this class targets (div, img, h1, ...). */
  tagName: string;
  base: CSSDeclarations;
  tablet?: CSSDeclarations;
  mobile?: CSSDeclarations;
}

/**
 * Tags where width/height are structural (replaced elements). For everything
 * else we drop pinned pixel widths because the captured value is the rendered
 * size at capture-viewport (1280px), which fights responsive layout once
 * pasted into Webflow.
 */
const REPLACED_ELEMENTS = new Set(["img", "video", "iframe", "svg", "canvas", "picture", "source"]);

/**
 * Strip computed dimensions and inset noise that hurt the paste output:
 *   - width/height on non-replaced elements (computed pixel values lock layout)
 *   - top/right/bottom/left = 0px (no-op when position is static or relative)
 *   - text-decoration-color / border-*-color matching the resolved text color
 *     (getComputedStyle returns these for every element even when no decoration
 *     or border is set; they're noise)
 */
function trimRenderingNoise(
  decls: CSSDeclarations,
  tagName: string,
  isFlexChild: boolean,
): CSSDeclarations {
  const out: CSSDeclarations = {};
  const isReplaced = REPLACED_ELEMENTS.has(tagName);
  for (const [k, v] of Object.entries(decls)) {
    // Replace VIEWPORT-PINNED widths with `100%` on non-replaced elements.
    // A captured width of 1280px on the section root is "fill the desktop
    // viewport"; pasted into a Webflow page wrapper of any size we want it
    // to fill its parent, not freeze at 1280. Outright dropping width on
    // flex containers makes them shrink to content — the section collapses.
    // Substituting `100%` preserves the "fill parent" intent.
    //
    // Same treatment for any width >= viewport: these are runtime-computed
    // overflow values (e.g. an Elementor icon-list rendered with horizontal
    // scroll content reports a `width: 2240px` even though the source CSS
    // has no such pin). They MUST be normalized to `100%` or they overflow
    // the page in the paste output.
    if (!isReplaced && k === "width" && isPinnedToViewportOrLarger(v)) {
      out[k] = "100%";
      continue;
    }
    // Same for max-width above viewport (rare but seen).
    if (!isReplaced && k === "max-width" && isPinnedToViewportOrLarger(v)) {
      out[k] = "100%";
      continue;
    }
    // Drop viewport-or-larger heights entirely — captured `height: 800px`
    // on a section is the capture window's height, not an intentional
    // sizing.
    if (!isReplaced && k === "height" && isPinnedToViewportOrLarger(v)) continue;
    // Drop zero insets — no effect on static/relative.
    if ((k === "top" || k === "right" || k === "bottom" || k === "left") && v === "0px") continue;
    // Drop "auto" grid placement noise.
    if ((k === "grid-column" || k === "grid-row") && v === "auto / auto") continue;
    // Drop "0px" min sizes (default).
    if ((k === "min-width" || k === "min-height") && v === "0px") continue;
    // Drop "none" max sizes (default).
    if ((k === "max-width" || k === "max-height") && v === "none") continue;
    // Drop text-decoration-color (only meaningful when text-decoration-line is set).
    if (k === "text-decoration-color" && !decls["text-decoration-line"]) continue;
    // Drop border-*-color when there's no border-*-width matching the side
    // (color without width is invisible, just noise).
    if (k.startsWith("border-") && k.endsWith("-color")) {
      const sideMatch = /^border-(top|right|bottom|left)-color$/.exec(k);
      if (sideMatch) {
        const widthKey = `border-${sideMatch[1]}-width`;
        const w = decls[widthKey];
        if (!w || w === "0px") continue;
      }
    }
    // Drop flex defaults (Chrome emits these for every element).
    if (k === "flex-grow" && v === "0") continue;
    if (k === "flex-shrink" && v === "1") continue;
    if (k === "flex-basis" && v === "auto") continue;
    if (k === "transform" && v === "none") continue;
    if (!isFlexChild && k === "align-self" && (v === "auto" || v === "stretch")) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Captured value either matches a capture viewport size OR exceeds the
 * largest capture viewport. Both indicate runtime-computed widths that
 * should follow the parent container instead of being pinned absolutely.
 *
 * Examples:
 *   - "1280px" — full desktop section (substitute 100%)
 *   - "991px"  — full tablet section
 *   - "479px"  — full mobile section
 *   - "1734.05px" — overflow content rendered at runtime (substitute 100%)
 *   - "600px"  — intentional column constraint (KEEP)
 */
function isPinnedToViewportOrLarger(value: string): boolean {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (!m) return false;
  const n = parseFloat(m[1]!);
  // Capture viewports were 1280 / 991 / 479. Tolerance ±2px.
  if (Math.abs(n - 1280) < 3) return true;
  if (Math.abs(n - 991) < 3) return true;
  if (Math.abs(n - 479) < 3) return true;
  // Anything >= 1280 is bigger than the desktop viewport. These are
  // computed overflow widths. Replace with 100%.
  return n >= 1280;
}

/** Detect classes WE added (synthetic prefixes always end with `__<digit>`). */
const OUR_CLASS_PATTERN = /^[a-z][a-z0-9_-]*__\d+$/;

/**
 * Walk the entry's section HTML, assign synthetic classes, run the pre-emit
 * cleanup pass, and return both the class list and the rendered HTML markup.
 *
 * Split out from `renderFragment` so the combined "paste-once" file can
 * reuse the same per-entry work without duplicating walking/cleanup logic.
 */
function buildFragmentParts(entry: BuildPlanEntry): { classes: ClassEntry[]; html: string } {
  // Fragment-mode load — no <html>/<head> wrappers added.
  const $ = cheerio.load(entry.section_html, null, false);
  const root = $.root().children().first();
  if (root.length === 0) {
    return { classes: [], html: `<!-- empty section_html for ${entry.archetype_id} -->` };
  }

  const prefix = shortPrefix(entry.archetype_id);
  const counter = { n: 0 };
  const classes: ClassEntry[] = [];

  walkAndAssignClasses($, root[0]!, "@root", entry.styles, prefix, counter, classes);

  // Pre-emit HTML pass — Webflow-shape rules.
  flattenSectionLevelTags($);
  stripBadAttributes($);
  stripNonContentChildren($);
  applyFormSubmitConversions($);
  replaceLazyImagePlaceholders($);

  const html = ($.root().html() ?? "").trim();
  return { classes, html };
}

/**
 * Per-Component bare fragment — `<style>` block followed by the cleaned
 * section markup, matching the existing `webflow-builder` skill's export
 * contract exactly: TWO top-level nodes (style + content root), nothing
 * more, nothing wrapped. Ares' paste validator accepts this specific
 * shape.
 */
function renderFragment(entry: BuildPlanEntry, classes: ClassEntry[], html: string, desktopOnly = false): string {
  const css = renderCss(entry, classes, desktopOnly);
  return `${css}\n\n${html}`;
}

/**
 * Combined "paste-once" file: a single `<style>` block with every Component's
 * classes (grouped by Component for readability), followed by every
 * Component's markup wrapped in a `<section data-ai-migration="...">` so the
 * boundaries are visible in Designer.
 *
 * Class names are collision-free across Components because each archetype
 * has its own short prefix (`hcb__N`, `hsti__N`, `fmc__N`, ...).
 */
function renderCombined(
  domain: string,
  parts: { entry: BuildPlanEntry; classes: ClassEntry[]; html: string }[],
  desktopOnly = false,
): string {
  // Apply the same render-noise trim every per-Component file uses.
  const trimmedParts = parts.map((p) => ({
    ...p,
    classes: p.classes.map((c) => ({
      name: c.name,
      tagName: c.tagName,
      base: trimRenderingNoise(c.base, c.tagName, isFlexParentDecls(c.base)),
      tablet: c.tablet ? trimRenderingNoise(c.tablet, c.tagName, isFlexParentDecls(c.base)) : undefined,
      mobile: c.mobile ? trimRenderingNoise(c.mobile, c.tagName, isFlexParentDecls(c.base)) : undefined,
    })),
  }));

  const styleBlocks: string[] = [];

  // Base rules grouped per Component.
  for (const { entry, classes } of trimmedParts) {
    const baseBlocks = classes
      .filter((c) => Object.keys(c.base).length > 0)
      .map((c) => `  .${c.name} { ${declsToString(c.base)} }`);
    if (baseBlocks.length === 0) continue;
    styleBlocks.push(
      `  /* ── ${entry.archetype_id} (canonical: ${entry.canonical_section_id}, ${entry.occurrences_in_site}× / ${entry.families_in_site} families) */`,
      ...baseBlocks,
      "",
    );
  }

  if (!desktopOnly) {
    // Tablet overrides — one media query, all Components inside.
    const allTablet: string[] = [];
    for (const { entry, classes } of trimmedParts) {
      const tabletBlocks = classes
        .filter((c) => c.tablet && Object.keys(c.tablet).length > 0)
        .map((c) => `    .${c.name} { ${declsToString(c.tablet!)} }`);
      if (tabletBlocks.length === 0) continue;
      allTablet.push(`    /* ── ${entry.archetype_id} */`, ...tabletBlocks);
    }
    if (allTablet.length > 0) {
      styleBlocks.push("  @media (max-width: 991px) {", ...allTablet, "  }", "");
    }

    // Mobile overrides — same pattern.
    const allMobile: string[] = [];
    for (const { entry, classes } of trimmedParts) {
      const mobileBlocks = classes
        .filter((c) => c.mobile && Object.keys(c.mobile).length > 0)
        .map((c) => `    .${c.name} { ${declsToString(c.mobile!)} }`);
      if (mobileBlocks.length === 0) continue;
      allMobile.push(`    /* ── ${entry.archetype_id} */`, ...mobileBlocks);
    }
    if (allMobile.length > 0) {
      styleBlocks.push("  @media (max-width: 479px) {", ...allMobile, "  }");
    }
  }

  const styleHeader = `  /* ai-migration: combined export for ${domain} (${parts.length} Components, generated ${new Date().toISOString().slice(0, 10)}) */`;
  const styleBody = ["<style>", STYLE_RESET, "", styleHeader, "", ...styleBlocks].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n</style>";

  // Markup — every Component wrapped in a `<section>` divider so boundaries
  // are visible in Designer's element tree. All sections are children of a
  // SINGLE outer `<div class="ai-migration-bundle">` so the whole bundle
  // has one content root. Combined with the leading `<style>` block, the
  // file matches the existing `webflow-builder` skill's accepted contract:
  // exactly TWO top-level nodes (style + content root). Adding a real
  // class on the wrapper prevents Ares from stripping it as a "trivial"
  // data-only div.
  // Use <div> wrappers (NOT <section>) — Webflow's Ares treats <section>
  // as a top-level Section root regardless of nesting, breaking the
  // single-root contract.
  const markup = parts
    .map(({ entry, html }) =>
      `<div data-ai-migration="${entry.archetype_id}">${html}</div>`,
    )
    .join("");

  return `${styleBody}\n\n<div class="ai-migration-bundle" data-domain="${domain}">${markup}</div>`;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim() ? pad + line : line))
    .join("\n");
}

/**
 * DFS walk mirroring captureStyles' selector-path scheme. Each visited
 * element with non-empty styles gets a synthetic class.
 */
function walkAndAssignClasses(
  $: cheerio.CheerioAPI,
  el: AnyNode,
  selectorPath: string,
  styles: Record<string, BreakpointStyles>,
  prefix: string,
  counter: { n: number },
  classes: ClassEntry[],
): void {
  if (!isElement(el)) return;

  const styleEntry = styles[selectorPath];
  const baseSize = styleEntry ? Object.keys(styleEntry.base ?? {}).length : 0;
  const tabletSize = styleEntry?.tablet ? Object.keys(styleEntry.tablet).length : 0;
  const mobileSize = styleEntry?.mobile ? Object.keys(styleEntry.mobile).length : 0;
  const hasMeaningfulStyles = baseSize > 0 || tabletSize > 0 || mobileSize > 0;

  if (hasMeaningfulStyles && styleEntry) {
    counter.n += 1;
    const className = `${prefix}__${counter.n}`;
    $(el).addClass(className);
    classes.push({
      name: className,
      tagName: el.tagName.toLowerCase(),
      base: styleEntry.base ?? {},
      ...(styleEntry.tablet ? { tablet: styleEntry.tablet } : {}),
      ...(styleEntry.mobile ? { mobile: styleEntry.mobile } : {}),
    });
  }

  let i = 0;
  for (const child of el.children) {
    if (!isElement(child)) continue;
    const seg = `${child.tagName.toLowerCase()}:nth-child(${i + 1})`;
    const childPath = selectorPath === "@root" ? seg : `${selectorPath} > ${seg}`;
    walkAndAssignClasses($, child, childPath, styles, prefix, counter, classes);
    i += 1;
  }
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

/**
 * Strip noisy/unwanted attributes from every element. Keep our synthetic
 * classes; drop everything else (original class soup, ids, data-*, inline
 * styles). Whitelist the few attributes Webflow needs to render content
 * correctly: src/href/alt/etc.
 */
function stripBadAttributes($: cheerio.CheerioAPI): void {
  const keep = new Set([
    "src", "srcset", "href", "alt", "title", "type", "name", "value",
    "for", "loading", "decoding", "width", "height", "target", "rel",
    // Note: `role` and aria-* attributes were previously kept for
    // accessibility but Webflow rejects pastes when role="list" /
    // role="listitem" attributes appear on non-<li>/<ul> elements with
    // "List can not be placed in a Non-List Item" — the visual editor's
    // element model sees them as list-typed and enforces strict nesting.
    // Drop role and aria-* during paste; they can be re-added in Designer.
  ]);
  $("*").each((_, el) => {
    if (!isElement(el)) return;
    const className = el.attribs.class ?? "";
    const ours = className
      .split(/\s+/)
      .filter((tok) => OUR_CLASS_PATTERN.test(tok));

    for (const attr of Object.keys(el.attribs)) {
      if (keep.has(attr)) continue;
      delete el.attribs[attr];
    }
    if (ours.length > 0) {
      el.attribs.class = ours.join(" ");
    } else {
      delete el.attribs.class;
    }
  });
}

/**
 * Webflow's Ares paste validator counts every section-level semantic tag
 * (`<section>`, `<nav>`, `<footer>`, `<header>`, `<main>`, `<aside>`,
 * `<article>`) as a top-level root regardless of nesting depth. With 12
 * Components in the combined bundle plus inner navs/footers/articles, the
 * count balloons past Ares's "single root" expectation, producing errors
 * like "Expected single root element but found 19 elements."
 *
 * Normalize all section-level tags to `<div>` so Ares only sees the outer
 * wrapper (one) and the `<style>` (one) — exactly the two-root contract
 * Ares accepts. Visual rendering is unchanged (`display: block` is the
 * default for both).
 */
function flattenSectionLevelTags($: cheerio.CheerioAPI): void {
  // Section-level semantic tags Webflow Section/Section-root → div.
  $("section, nav, footer, header, main, aside, article, search, dialog, figure, figcaption").each((_, el) => {
    if (isElement(el)) el.tagName = "div";
  });
  // <ul>/<ol>/<li> — Webflow's element model treats these as List/List-Item
  // types and rejects nested lists where the inner <ul> isn't a direct
  // child of an <li> ("List can not be placed in a Non-List Item"). The
  // mega-menu pattern (top <ul> → <li> → divs → inner <ul>) breaks this
  // rule. Flatten to <div> for paste safety. Visual rendering is the same
  // (default `display: block`); list-style bullets are dropped, which is
  // fine because Elementor's lists don't use bullets anyway.
  $("ul, ol, li").each((_, el) => {
    if (isElement(el)) el.tagName = "div";
  });
  // <details>/<summary> are NOT supported by Webflow per the compatibility
  // doc — they must be re-implemented as Tabs or IX2 interactions. For
  // paste compatibility, normalize them to <div>; the FAQ-accordion
  // archetype loses its native expand/collapse but the questions and
  // answers all remain visible.
  $("details").each((_, el) => {
    if (isElement(el)) el.tagName = "div";
  });
  $("summary").each((_, el) => {
    if (isElement(el)) el.tagName = "div";
  });
  // Inline <svg> is NOT supported in the Webflow visual editor — must be
  // imported as Image with external SVG src. For now, replace with a
  // placeholder div so paste succeeds; user uploads real SVG assets later.
  $("svg").each((_, el) => {
    if (!isElement(el)) return;
    el.tagName = "div";
    // Drop SVG-internal children (path, g, clipPath, etc.) — they're not
    // valid HTML inside a div and Ares may reject them.
    el.children = [];
    el.attribs["data-was-svg"] = "1";
  });
  // <iframe>, <canvas> not supported — replace with div placeholders too.
  $("iframe, canvas").each((_, el) => {
    if (!isElement(el)) return;
    const wasTag = el.tagName;
    el.tagName = "div";
    el.children = [];
    el.attribs["data-was"] = wasTag;
  });
  // <picture>/<source> — Webflow uses Image with srcset via asset panel.
  // Unwrap <picture> by replacing it with its first <img> child if any.
  $("picture").each((_, el) => {
    if (!isElement(el)) return;
    el.tagName = "div";
  });
  $("source").each((_, el) => {
    if (isElement(el)) $(el).remove();
  });
  // <table>/<tr>/<td>/<thead>/<tbody> — Webflow uses CSS Grid; convert to divs.
  $("table, thead, tbody, tfoot, tr, td, th, caption, colgroup, col").each((_, el) => {
    if (isElement(el)) el.tagName = "div";
  });
}

/**
 * Many WordPress themes (Elementor, GeneratePress, etc.) lazy-load images
 * by setting `src` to a transparent SVG placeholder of the correct aspect
 * ratio and storing the real URL in `data-src`. The matcher's HTML cleaner
 * strips `data-src`, so the cleaned HTML carries the placeholder forever.
 *
 * For paste-into-Webflow we want SOMETHING visible. Swap the placeholder
 * src for a placehold.co URL of the right dimensions so the layout's image
 * slots are visible at their intended aspect ratio. Designer replaces with
 * real assets later.
 */
function replaceLazyImagePlaceholders($: cheerio.CheerioAPI): void {
  $("img").each((_, img) => {
    if (!isElement(img)) return;
    const src = img.attribs.src ?? "";
    if (!src.startsWith("data:image/svg+xml")) return;
    // Try to recover dimensions from img's width/height attrs first.
    let w = parseDim(img.attribs.width);
    let h = parseDim(img.attribs.height);
    // Fall back to the SVG's viewBox embedded in the placeholder.
    if (!w || !h) {
      const vb = /viewBox='[\d\s]+\s(\d+)\s(\d+)'/.exec(src) ?? /viewBox=%270%200%20(\d+)%20(\d+)%27/.exec(src);
      if (vb) {
        w = w || parseInt(vb[1]!, 10);
        h = h || parseInt(vb[2]!, 10);
      }
    }
    const width = w || 600;
    const height = h || 400;
    const label = (img.attribs.alt || "image").slice(0, 20).replace(/[^a-zA-Z0-9]+/g, "+") || "image";
    img.attribs.src = `https://placehold.co/${width}x${height}?text=${label}`;
  });
}

function parseDim(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Defensive: kill any inner <style>/<script>/<noscript>/<link>/<meta>. */
function stripNonContentChildren($: cheerio.CheerioAPI): void {
  $("style, script, noscript, link, meta").remove();
}

/**
 * Form / submit conversions for Webflow-shape compliance:
 *   - <div> wrapping form inputs → <form>
 *   - <div> acting as a submit trigger → <button type="submit">
 *
 * Conservative on detection — strong signals only.
 */
function applyFormSubmitConversions($: cheerio.CheerioAPI): void {
  // div → form: nearest <div> ancestor of any input/textarea/select that
  // isn't already inside a <form>.
  const promoted = new Set<AnyNode>();
  $("input, textarea, select").each((_, input) => {
    if (!isElement(input)) return;
    if ($(input).parents("form").length > 0) return;
    const wrapperDiv = $(input).parents("div").first();
    if (wrapperDiv.length === 0) return;
    const node = wrapperDiv[0];
    if (!node || promoted.has(node)) return;
    promoted.add(node);
    if (isElement(node)) {
      node.tagName = "form";
    }
  });

  // div → button[type=submit]: divs whose entire visible text matches a
  // submit-shaped phrase and which contain no nested interactive elements.
  $("div").each((_, div) => {
    if (!isElement(div)) return;
    const $div = $(div);
    const text = ($div.text() || "").trim();
    if (text.length === 0 || text.length > 30) return;
    if (!/^(submit|send|sign\s?up|subscribe|get started|book\s?a?\s?demo|request\s?a?\s?demo)$/i.test(text)) return;
    if ($div.find("a, button, input, select, textarea").length > 0) return;
    div.tagName = "button";
    div.attribs.type = "submit";
  });
}

/** The reset prepended to every emitted style block. */
const STYLE_RESET = `  /* Reset — Webflow's default is border-box; many WordPress themes use content-box.
     Forcing border-box here keeps captured padding/border math consistent in Webflow. */
  *, *::before, *::after { box-sizing: border-box; }`;

/** Render the <style> block — reset + base rules + tablet/mobile media queries. */
function renderCss(entry: BuildPlanEntry, classes: ClassEntry[], desktopOnly = false): string {
  const header = `  /* ai-migration: ${entry.archetype_id}  (canonical: ${entry.canonical_section_id}, ${entry.occurrences_in_site}× / ${entry.families_in_site} families) */`;

  const trimmed = classes.map((c) => ({
    name: c.name,
    tagName: c.tagName,
    base: trimRenderingNoise(c.base, c.tagName, isFlexParentDecls(c.base)),
    tablet: c.tablet ? trimRenderingNoise(c.tablet, c.tagName, isFlexParentDecls(c.base)) : undefined,
    mobile: c.mobile ? trimRenderingNoise(c.mobile, c.tagName, isFlexParentDecls(c.base)) : undefined,
  }));

  const baseBlocks = trimmed
    .filter((c) => Object.keys(c.base).length > 0)
    .map((c) => `  .${c.name} { ${declsToString(c.base)} }`);

  const tabletBlocks = trimmed
    .filter((c) => c.tablet && Object.keys(c.tablet).length > 0)
    .map((c) => `    .${c.name} { ${declsToString(c.tablet!)} }`);

  const mobileBlocks = trimmed
    .filter((c) => c.mobile && Object.keys(c.mobile).length > 0)
    .map((c) => `    .${c.name} { ${declsToString(c.mobile!)} }`);

  const parts: string[] = ["<style>", STYLE_RESET, "", header, ...baseBlocks];
  if (!desktopOnly) {
    if (tabletBlocks.length > 0) {
      parts.push("", "  @media (max-width: 991px) {", ...tabletBlocks, "  }");
    }
    if (mobileBlocks.length > 0) {
      parts.push("", "  @media (max-width: 479px) {", ...mobileBlocks, "  }");
    }
  }
  parts.push("</style>");
  return parts.join("\n");
}

/**
 * Best-effort detector: does this element's own style suggest it's a flex
 * container? Used by `trimRenderingNoise` to decide whether children's
 * `align-self` is meaningful. (We don't have parent context per-element here,
 * so we consult the element's own decls — flex containers usually inherit
 * from somewhere known.)
 */
function isFlexParentDecls(_decls: CSSDeclarations): boolean {
  // Conservative — assume the element MIGHT be a flex child. Keeps align-self
  // in most cases. The trim function still drops align-self defaults when it
  // looks like a no-op.
  return true;
}

function declsToString(decls: CSSDeclarations): string {
  return Object.entries(decls)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
}

/**
 * Class-name prefix per archetype.
 *
 * Uses the FULL archetype id (slugified to safe CSS chars). Initials cause
 * collisions (e.g. `feature-alternating` and `faq-accordion` both reduce
 * to "fa", which silently breaks every Component using the colliding
 * prefix in the combined-export file). Full ids are slightly longer but
 * guaranteed unique and human-readable.
 *
 *   "hero-split-text-image" → "hero-split-text-image"
 *   "cta-banner" → "cta-banner"
 */
function shortPrefix(archetypeId: string): string {
  return archetypeId.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

/** Build the index README that ships alongside the per-Component HTML files. */
function buildReadme(plan: BuildPlanFile, ordered: BuildPlanEntry[]): string {
  const date = plan.generated_at.slice(0, 10);
  const rows = ordered
    .map((e, i) => {
      const num = String(i + 1).padStart(2, "0");
      return `| ${num} | ${e.component_name.replace(/\|/g, "\\|")} | ${e.component_group} | ${e.canonical_confidence.toFixed(2)} | ${e.occurrences_in_site}× / ${e.families_in_site} families |`;
    })
    .join("\n");

  return `# AI Migration → Webflow paste guide

Generated ${date} from \`output/${plan.domain}/build-plan.json\`.

Paste each file's contents into Webflow via the **Ares** browser extension.
Files are numbered in recommended paste order (chrome first, content last).

## Components

| # | Component | Group | Source confidence | Site usage |
|---|---|---|---|---|
${rows}

## How to paste

You have **two options**:

### Option A — single paste (fastest)

1. Open your target Webflow site in Designer.
2. Open the Ares extension.
3. Open \`all-components.html\`. Copy the entire file contents.
4. Paste into Ares once. All Components appear in order, each wrapped in a \`<section data-ai-migration="...">\` so boundaries are visible in the element tree.

### Option B — per-Component pastes (smaller payloads, easier to iterate)

1. Open your target Webflow site in Designer.
2. Open the Ares extension.
3. Open \`01-<name>.html\`. Copy the entire contents (the \`<style>\` block + the markup).
4. Paste into Ares. The elements appear in Webflow with the styles applied.
5. Repeat for each numbered file.

## After paste

1. Verify each Component visually in Designer at desktop, tablet (≤991px), and mobile (≤479px).
2. Run the asset-upload pass to replace WordPress image \`src\` URLs with Webflow Asset URLs.
3. (v0.1) Run the \`ai-migration-webflow-builder\` skill to convert pasted elements into Webflow Components with typed props and slots.

## Known limitations

- Image \`src\` attributes still point at the source WordPress site.
- Hover/focus states not captured (deferred to v0.1).
- JS-driven interactions (carousels, accordion toggles, dropdowns) render static-only — they need to be re-wired in Webflow.
- Nested Components (e.g. nav appearing inside a hero scaffold) are inlined for v0; the v0.1 skill substitutes Component instances during conversion.
- Synthetic class names (\`.hsti__1\`, \`.cb__2\`, etc.) are sequential. Designers should rename them to follow the target site's naming convention before publishing.
`;
}
