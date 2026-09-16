import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import pLimit from "p-limit";
import type {
  BreakpointStyles,
  CSSDeclarations,
  FingerprintFile,
  PageFingerprint,
  SectionFingerprint,
} from "../util/types.js";
import { outputPath, sectionsDir } from "../util/paths.js";
import { info, step, warn, progress } from "../util/log.js";

export interface CaptureStylesOptions {
  domain: string;
  /** Concurrent page navigations. Each page hits all 3 breakpoints sequentially. */
  pageConcurrency?: number;
  /** Per-page navigation timeout (ms). */
  timeoutMs?: number;
  /** Skip pages that already have styles.json for every section. */
  resume?: boolean;
}

/**
 * Phase 2.5 — Computed-style extraction.
 *
 * Visits every URL in fingerprints.json, samples each section's element
 * subtree at three viewports (desktop / tablet / mobile portrait), and
 * writes `styles.json` next to the section bundle. Output is keyed by
 * the section's element selector path within the cleaned section HTML.
 *
 * Designed to follow Webflow's desktop-down cascade: desktop is the base,
 * tablet at ≤991px and mobile at ≤479px carry only the diffs from the
 * preceding breakpoint. The skill applies them as max-width overrides.
 */
export async function runCaptureStyles(opts: CaptureStylesOptions): Promise<{ pages: number; sections: number }>
{
  const { domain, pageConcurrency = 2, timeoutMs = 30_000, resume = false } = opts;
  step("phase 2.5", `capture styles for ${domain}`);

  const fpPath = outputPath(domain, "fingerprints.json");
  if (!existsSync(fpPath)) throw new Error(`fingerprints.json not found for ${domain} — run \`ai-migrate fingerprint\` first`);
  const fingerprints = JSON.parse(readFileSync(fpPath, "utf8")) as FingerprintFile;

  const browser = await chromium.launch({ headless: true });
  const pageLimit = pLimit(pageConcurrency);
  let pagesDone = 0;
  let sectionsDone = 0;
  const pagesTotal = fingerprints.pages.filter((p) => p.scrape_status === "ok").length;

  try {
    await Promise.all(
      fingerprints.pages.map((p) =>
        pageLimit(async () => {
          if (p.scrape_status !== "ok") return;
          if (resume && p.sections.every((s) => existsSync(path.join(sectionsDir(domain), s.section_id, "styles.json")))) {
            pagesDone += 1;
            progress(pagesDone, pagesTotal, p.url);
            return;
          }
          try {
            const captured = await capturePage(browser, p, timeoutMs);
            for (const [sectionId, styles] of Object.entries(captured)) {
              const dir = path.join(sectionsDir(domain), sectionId);
              if (!existsSync(dir)) {
                // Bundle dir might be missing if Phase 2 skipped this section — write next to where it would live.
                continue;
              }
              writeFileSync(path.join(dir, "styles.json"), JSON.stringify(styles, null, 2));
              sectionsDone += 1;
            }
          } catch (e) {
            warn(`capture failed for ${p.url}`, { error: e instanceof Error ? e.message : String(e) });
          }
          pagesDone += 1;
          progress(pagesDone, pagesTotal, p.url);
        }),
      ),
    );
  } finally {
    await browser.close();
  }

  info("capture-styles summary", { pages: pagesDone, sections: sectionsDone });
  return { pages: pagesDone, sections: sectionsDone };
}

/** Webflow's three primary breakpoints (subset of the 7 it actually supports). */
const BREAKPOINTS = [
  { name: "base" as const, width: 1280, height: 800 },
  { name: "tablet" as const, width: 991, height: 800 },
  { name: "mobile" as const, width: 479, height: 800 },
];

/**
 * Property allow-list. Captured longhand only — shorthand expansion happens
 * on the in-page side via getComputedStyle (which already returns longhand
 * for these named properties).
 */
const STYLE_PROPERTIES = [
  // layout
  "display", "position", "top", "right", "bottom", "left", "z-index", "float", "clear",
  // flex / grid
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
  "justify-content", "align-items", "align-content", "align-self", "gap",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
  // sizing
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  // spacing (longhand)
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  // typography
  "font-family", "font-size", "font-weight", "font-style",
  "line-height", "letter-spacing",
  "text-align", "text-transform", "text-decoration-line", "text-decoration-color",
  "color",
  // background
  "background-color", "background-image", "background-size", "background-position", "background-repeat",
  // border (longhand)
  "border-top-width", "border-top-style", "border-top-color",
  "border-right-width", "border-right-style", "border-right-color",
  "border-bottom-width", "border-bottom-style", "border-bottom-color",
  "border-left-width", "border-left-style", "border-left-color",
  "border-top-left-radius", "border-top-right-radius",
  "border-bottom-left-radius", "border-bottom-right-radius",
  // effects
  "box-shadow", "opacity", "transform", "overflow",
];

/**
 * Default values that getComputedStyle returns when nothing is set. We
 * skip these to keep the JSON small. Anything not in this map is kept.
 */
const DEFAULT_VALUES: Record<string, string[]> = {
  "display": ["inline"],
  "position": ["static"],
  "top": ["auto"], "right": ["auto"], "bottom": ["auto"], "left": ["auto"],
  "z-index": ["auto"],
  "float": ["none"], "clear": ["none"],
  "flex-direction": ["row"], "flex-wrap": ["nowrap"],
  "flex-grow": ["0"], "flex-shrink": ["1"], "flex-basis": ["auto"],
  "justify-content": ["normal", "flex-start"],
  "align-items": ["normal", "stretch"],
  "align-content": ["normal"],
  "align-self": ["auto"],
  "gap": ["normal", "0px"],
  "grid-template-columns": ["none"], "grid-template-rows": ["none"],
  "grid-column": ["auto / auto"], "grid-row": ["auto / auto"],
  "min-width": ["auto"], "min-height": ["auto"],
  "max-width": ["none"], "max-height": ["none"],
  "margin-top": ["0px"], "margin-right": ["0px"], "margin-bottom": ["0px"], "margin-left": ["0px"],
  "padding-top": ["0px"], "padding-right": ["0px"], "padding-bottom": ["0px"], "padding-left": ["0px"],
  "font-style": ["normal"],
  "letter-spacing": ["normal"],
  "text-align": ["start"],
  "text-transform": ["none"],
  "text-decoration-line": ["none"],
  "background-color": ["rgba(0, 0, 0, 0)"],
  "background-image": ["none"],
  "background-size": ["auto"],
  "background-position": ["0% 0%"],
  "background-repeat": ["repeat"],
  "border-top-width": ["0px"], "border-right-width": ["0px"],
  "border-bottom-width": ["0px"], "border-left-width": ["0px"],
  "border-top-style": ["none"], "border-right-style": ["none"],
  "border-bottom-style": ["none"], "border-left-style": ["none"],
  "border-top-left-radius": ["0px"], "border-top-right-radius": ["0px"],
  "border-bottom-left-radius": ["0px"], "border-bottom-right-radius": ["0px"],
  "box-shadow": ["none"],
  "opacity": ["1"],
  "transform": ["none"],
  "overflow": ["visible"],
};

/**
 * Visit one page, collect computed styles for every fingerprinted section
 * at all three breakpoints, and return a map of section_id → styles tree.
 */
async function capturePage(
  browser: Browser,
  p: PageFingerprint,
  timeoutMs: number,
): Promise<Record<string, Record<string, BreakpointStyles>>> {
  const out: Record<string, Record<string, BreakpointStyles>> = {};

  // JS is disabled deliberately. The matcher's fingerprints.json was built
  // from the static (pre-JS) HTML via Cheerio. With JS on, Elementor and
  // assorted plugins mutate the DOM after load (move popups to body, inject
  // chat widgets, etc.), which breaks `:nth-of-type(N)` paths that were
  // valid in the static parse. With JS off, we get the same tree the
  // matcher saw. Stylesheet-level CSS still applies because <link>s load
  // independently of JS.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    javaScriptEnabled: false,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(p.url, { waitUntil: "load", timeout: timeoutMs });
  } catch {
    try {
      await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    } catch (e) {
      await ctx.close();
      throw e;
    }
  }

  // Sample at each breakpoint sequentially; mutate viewport in place.
  const perBreakpoint: Record<string, Record<string, CSSDeclarations>> = {};
  for (const bp of BREAKPOINTS) {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    // Brief settle — some Elementor sites recompute layout on resize.
    await page.waitForTimeout(150);
    const sectionStyles = await samplePageStyles(page, p.sections, STYLE_PROPERTIES);
    perBreakpoint[bp.name] = sectionStyles;
  }

  // Diff cascade: tablet drops anything matching base, mobile drops anything matching tablet.
  for (const section of p.sections) {
    const baseStyles = perBreakpoint["base"]?.[section.section_id] ?? {};
    const tabletStyles = perBreakpoint["tablet"]?.[section.section_id] ?? {};
    const mobileStyles = perBreakpoint["mobile"]?.[section.section_id] ?? {};

    const elementMap: Record<string, BreakpointStyles> = {};
    // A section returns one record per element selector path. We need to
    // iterate over the union of element keys.
    const allKeys = new Set<string>([
      ...Object.keys(baseStyles),
      ...Object.keys(tabletStyles),
      ...Object.keys(mobileStyles),
    ]);
    for (const key of allKeys) {
      const base = filterDefaults(parseElementStyles(baseStyles[key] ?? ""));
      const tablet = parseElementStyles(tabletStyles[key] ?? "");
      const mobile = parseElementStyles(mobileStyles[key] ?? "");
      const tabletDiff = diffStyles(tablet, base);
      const mobileDiff = diffStyles(mobile, { ...base, ...tabletDiff });
      const entry: BreakpointStyles = { base };
      if (Object.keys(tabletDiff).length > 0) entry.tablet = tabletDiff;
      if (Object.keys(mobileDiff).length > 0) entry.mobile = mobileDiff;
      elementMap[key] = entry;
    }
    out[section.section_id] = elementMap;
  }

  await ctx.close();
  return out;
}

/**
 * For the given page, query every fingerprinted section and walk its
 * subtree, returning per-element computed-style strings keyed by a
 * section-relative selector path.
 *
 * Returns a map: section_id → (selector_path → encoded styles). Encoded
 * styles is a `prop:value;prop:value;` string — parsed back in Node to
 * keep the cross-context payload simple.
 */
async function samplePageStyles(
  page: Page,
  sections: SectionFingerprint[],
  props: string[],
): Promise<Record<string, Record<string, string>>> {
  const sectionPaths = sections.map((s) => ({ id: s.section_id, dom_path: s.dom_path }));
  // NOTE: We pass a STRING to page.evaluate — Playwright runs it raw in the
  // browser and ignores the args parameter on the string variant. Args are
  // baked into the source via JSON.stringify. We avoid passing a function
  // because tsx wraps inner declarations with __name() helpers that aren't
  // defined in the browser context.
  const sectionsJson = JSON.stringify(sectionPaths);
  const propsJson = JSON.stringify(props);
  const evalSrc = `
    (function () {
      var sections = ${sectionsJson};
      var props = ${propsJson};
      var out = {};

      function visit(node, relPath, accum) {
        var cs = window.getComputedStyle(node);
        var parts = [];
        for (var p = 0; p < props.length; p++) {
          var prop = props[p];
          var value = cs.getPropertyValue(prop);
          if (value) parts.push(prop + ":" + value);
        }
        accum[relPath || "@root"] = parts.join(";");
        var children = node.children;
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          var seg = child.tagName.toLowerCase() + ":nth-child(" + (i + 1) + ")";
          var nextPath = relPath ? (relPath + " > " + seg) : seg;
          visit(child, nextPath, accum);
        }
      }

      for (var s = 0; s < sections.length; s++) {
        var spec = sections[s];
        try {
          var el = document.querySelector(spec.dom_path);
          if (!el) { out[spec.id] = {}; continue; }
          var accum = {};
          visit(el, "", accum);
          out[spec.id] = accum;
        } catch (e) {
          out[spec.id] = {};
        }
      }
      return out;
    })()
  `;
  return page.evaluate(evalSrc) as Promise<Record<string, Record<string, string>>>;
}

function parseElementStyles(encoded: string): CSSDeclarations {
  const out: CSSDeclarations = {};
  if (!encoded) return out;
  for (const part of encoded.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function filterDefaults(decls: CSSDeclarations): CSSDeclarations {
  const out: CSSDeclarations = {};
  for (const [k, v] of Object.entries(decls)) {
    const defaults = DEFAULT_VALUES[k];
    if (defaults && defaults.includes(v)) continue;
    out[k] = v;
  }
  return out;
}

function diffStyles(child: CSSDeclarations, parent: CSSDeclarations): CSSDeclarations {
  const out: CSSDeclarations = {};
  for (const [k, v] of Object.entries(child)) {
    if (parent[k] !== v) {
      // Only record a diff if the value is meaningful (not a default value
      // that happens to differ from the parent for inherited reasons).
      const defaults = DEFAULT_VALUES[k];
      if (defaults && defaults.includes(v) && parent[k] === undefined) continue;
      out[k] = v;
    }
  }
  return out;
}
