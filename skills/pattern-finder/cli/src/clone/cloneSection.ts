import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { BuildPlanEntry, BuildPlanFile, FingerprintFile } from "../util/types.js";
import { outputPath } from "../util/paths.js";
import { info, step, warn, progress } from "../util/log.js";

export interface CloneExportOptions {
  domain: string;
  /** Per-page navigation timeout (ms). */
  timeoutMs?: number;
}

interface ExtractedClone {
  /** Section's original outerHTML, classes and structure preserved. */
  html: string;
  /**
   * Ancestor chain from <html> down to (but NOT including) the section itself.
   * Each entry: opening tag plus class attribute. We re-wrap the section
   * with this chain in the emit so rules like `.elementor .foo` and
   * `body.page-id-X .bar` still match.
   */
  ancestors: { tag: string; className: string }[];
  /** Matched stylesheet rules in source order, grouped by media query. */
  rules: { media: string | null; cssText: string }[];
  /** All @font-face rules (always included — fonts are global). */
  fontFaces: string[];
}

/**
 * Phase 7c — clone-export.
 *
 * Goal: produce 1:1 paste-ready clones of each Component identified by the
 * matcher. UNLIKE the cleaned-HTML emit-export, this phase preserves the
 * source page's original markup (classes, ids, structure) and extracts the
 * subset of CSS rules that match elements within the section. Pasting the
 * result via Ares puts the source's actual rendered shape into Webflow,
 * not a reconstruction from numerical computed values.
 *
 * Workflow per Component:
 *   1. Visit canonical_source_url with JavaScript ENABLED (so any JS-driven
 *      classes/styles are present at capture time).
 *   2. Locate the section element by dom_path (re-fingerprint at runtime).
 *   3. Read the section's outerHTML.
 *   4. Walk every stylesheet in the document, collect rules whose selector
 *      matches the section or any descendant (after stripping pseudo-class
 *      / pseudo-element parts of the selector for the matching test).
 *   5. Apply the minimum set of Webflow-paste-compat transforms:
 *        - Flatten section-level semantic tags (<section>, <nav>, <footer>,
 *          <header>, <main>, <aside>, <article>, <details>, <summary>,
 *          <ul>, <ol>, <li>) → <div>. Webflow's element model treats these
 *          as roots and rejects multi-root pastes.
 *        - Rewrite the corresponding selectors in the extracted CSS so the
 *          rules still match after tag flattening (e.g. `section.foo` → `.foo`,
 *          `nav > ul li.bar` → `[data-was=nav] > [data-was=ul] [data-was=li].bar`
 *          — actually simpler: drop tag selectors entirely, keep classes).
 *        - Strip `role`, `aria-*`, `id`, `data-*`, inline `style` attributes
 *          (Webflow rejects nested `role="list"` and id collisions).
 *        - Rewrite `<img src="data:image/svg+xml,...">` (lazy-load placeholder)
 *          to the value of `data-src` if present.
 *        - Drop `<svg>`, `<iframe>`, `<canvas>`, `<picture>`, `<source>`,
 *          `<table>` family — replace inline SVGs with placeholder divs of
 *          the SVG's intrinsic dimensions.
 *   6. Emit one bare fragment per Component plus a combined bundle.
 */
export async function runCloneExport(opts: CloneExportOptions): Promise<{ files: number }> {
  const { domain, timeoutMs = 30_000 } = opts;
  step("phase 7c", `clone-export for ${domain}`);

  const planPath = outputPath(domain, "build-plan.json");
  if (!existsSync(planPath)) {
    throw new Error(`build-plan.json not found for ${domain} — run \`ai-migrate build-plan\` first`);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as BuildPlanFile;
  if (plan.entries.length === 0) {
    warn("build-plan has no entries; nothing to clone");
    return { files: 0 };
  }

  const fpPath = outputPath(domain, "fingerprints.json");
  if (!existsSync(fpPath)) throw new Error(`fingerprints.json not found for ${domain}`);
  const fingerprints = JSON.parse(readFileSync(fpPath, "utf8")) as FingerprintFile;

  // dom_path lookup — needed because build-plan.json doesn't carry it.
  const domPathById = new Map<string, string>();
  for (const p of fingerprints.pages) {
    for (const s of p.sections) domPathById.set(s.section_id, s.dom_path);
  }

  const clonesDir = path.join(outputPath(domain), "clones");
  mkdirSync(clonesDir, { recursive: true });

  const ordered = sortForPaste(plan.entries);
  const browser = await chromium.launch({ headless: true });

  const transformedParts: { entry: BuildPlanEntry; html: string; cssText: string }[] = [];
  let filesWritten = 0;

  try {
    for (let i = 0; i < ordered.length; i += 1) {
      const entry = ordered[i]!;
      const domPath = domPathById.get(entry.canonical_section_id);
      if (!domPath) {
        warn(`no dom_path for ${entry.canonical_section_id}; skipping`);
        continue;
      }
      try {
        const clone = await extractClone(browser, entry.canonical_source_url, domPath, timeoutMs);
        const transformed = transformClone(clone, entry.archetype_id);
        const fragment = renderFragment(entry, transformed);
        const num = String(i + 1).padStart(2, "0");
        const file = path.join(clonesDir, `${num}-${entry.archetype_id}.html`);
        writeFileSync(file, fragment);
        filesWritten += 1;
        transformedParts.push({ entry, html: transformed.html, cssText: transformed.cssText });
        progress(i + 1, ordered.length, entry.archetype_id);
      } catch (e) {
        warn(`clone failed for ${entry.archetype_id}`, { error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    await browser.close();
  }

  const combinedPath = path.join(clonesDir, "all-clones.html");
  writeFileSync(combinedPath, renderCombined(domain, transformedParts));
  filesWritten += 1;

  const readme = path.join(clonesDir, "README.md");
  writeFileSync(readme, buildReadme(plan, ordered));
  filesWritten += 1;

  info(`wrote ${clonesDir}`, { files: filesWritten });
  return { files: filesWritten };
}

// ────────────────────────────────────────────────────────────────────────
// Extract: visit page, capture original HTML + matching CSS rules
// ────────────────────────────────────────────────────────────────────────

/**
 * Run inside the browser context to read every stylesheet, walk every rule,
 * and collect those whose selector matches the section subtree. Source
 * order preserved within each stylesheet; cross-sheet order is the order
 * sheets appear in the document.
 */
/** Absolute URL the page was loaded from — used to resolve any relative
 * `url(...)` references in extracted CSS and `src` references in HTML. */
function originFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

async function extractClone(
  browser: Browser,
  url: string,
  domPath: string,
  timeoutMs: number,
): Promise<ExtractedClone> {
  // Pass 1: navigate with JS DISABLED to find the section's unique Elementor
  // class hash (e.g. elementor-element-d7eaa5e). The static dom_path resolves
  // reliably with JS off because nothing has mutated the DOM. We grab a
  // stable selector to use in Pass 2.
  let stableSelector = domPath;
  try {
    const ctxA = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      javaScriptEnabled: false,
    });
    const pageA = await ctxA.newPage();
    await pageA.goto(url, { waitUntil: "load", timeout: timeoutMs });
    const found = await pageA.evaluate((p) => {
      const el = document.querySelector(p);
      if (!el) return null;
      const cls = (el as HTMLElement).className || "";
      const m = cls.match(/elementor-element-[a-f0-9]+/);
      return m ? m[0] : null;
    }, domPath);
    if (found) stableSelector = `.${found}`;
    await ctxA.close();
  } catch {
    // Best-effort — fall through to using dom_path as-is in Pass 2.
  }

  // Pass 2: navigate with JS ENABLED to capture styles in their fully
  // hydrated state (Elementor injects per-element style overrides via JS,
  // particularly heading colors and typography). Find the section using
  // the stable Elementor-element class from Pass 1.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    javaScriptEnabled: true,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForTimeout(1500); // settle for JS-driven style injections

    const evalSrc = `
      (function () {
        var primarySelector = ${JSON.stringify(stableSelector)};
        var fallbackSelector = ${JSON.stringify(domPath)};
        var section = document.querySelector(primarySelector) || document.querySelector(fallbackSelector);
        if (!section) return { html: "", ancestors: [], rules: [], fontFaces: [] };

        // Absolutize URLs in CSS and HTML so relative paths still resolve
        // when the clone is pasted outside the source origin. Important:
        // CSS url(...) references resolve against the stylesheet URL,
        // not the page URL.
        var pageURI = document.baseURI;
        function absUrlAgainst(raw, base) {
          if (!raw) return raw;
          if (/^(https?:|data:|blob:|\\/\\/)/.test(raw)) return raw;
          try { return new URL(raw, base).href; } catch (e) { return raw; }
        }
        function absolutizeCss(cssText, sheetHref) {
          var base = sheetHref || pageURI;
          return cssText.replace(/url\\((['"]?)([^)'"]+)\\1\\)/g, function (m, q, u) {
            return "url(" + q + absUrlAgainst(u, base) + q + ")";
          });
        }

        // Walk the section subtree and absolutize src / srcset / href on every
        // element so resources resolve against the source origin once pasted.
        function absolutizeAttrs(root) {
          // HTML attribute paths (src, href, srcset) are relative to the
          // PAGE URL, not a stylesheet URL.
          var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll("*")));
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.hasAttribute && el.hasAttribute("src")) {
              el.setAttribute("src", absUrlAgainst(el.getAttribute("src"), pageURI));
            }
            if (el.hasAttribute && el.hasAttribute("href")) {
              var href = el.getAttribute("href");
              if (href && href.charAt(0) !== "#") el.setAttribute("href", absUrlAgainst(href, pageURI));
            }
            if (el.hasAttribute && el.hasAttribute("srcset")) {
              el.setAttribute("srcset", el.getAttribute("srcset").split(",").map(function (part) {
                var bits = part.trim().split(/\\s+/);
                bits[0] = absUrlAgainst(bits[0], pageURI);
                return bits.join(" ");
              }).join(", "));
            }
            if (el.hasAttribute && el.hasAttribute("data-src") && el.tagName === "IMG") {
              var existing = el.getAttribute("src") || "";
              if (existing.indexOf("data:image/svg+xml") === 0) {
                el.setAttribute("src", absUrlAgainst(el.getAttribute("data-src"), pageURI));
              }
            }
          }
        }
        absolutizeAttrs(section);
        var html = section.outerHTML;

        // Walk ancestors from <html> down to the section's parent. Capture
        // each tag + class attribute. Used to reconstruct the ancestor
        // context in the emit so rules like ".elementor .foo" still match
        // (the source CSS is full of these).
        var ancestors = [];
        var walker = section.parentElement;
        var chain = [];
        while (walker) {
          chain.unshift({
            tag: walker.tagName.toLowerCase(),
            className: typeof walker.className === "string" ? walker.className : (walker.getAttribute("class") || ""),
          });
          walker = walker.parentElement;
        }
        ancestors = chain;

        // Pre-compute element set for matching efficiency.
        var subtree = [section].concat(Array.prototype.slice.call(section.querySelectorAll("*")));

        function selectorMatches(rawSelector) {
          // Always include rules whose selector references :root —
          // they typically define CSS custom properties used by descendant
          // rules. Detection happens before pseudo-class stripping because
          // :root would be stripped otherwise.
          if (/(^|,|\\s):root(\\s|,|$|\\.|#|\\[|:)/.test(rawSelector)) return true;

          // Strip pseudo-classes/elements for matching (DOM API can't
          // evaluate :hover, ::before, etc.) Keep the original text in the
          // emitted CSS so styling still carries.
          var cleaned = rawSelector
            .split(",")
            .map(function (s) {
              return s
                .trim()
                .replace(/::?[a-zA-Z-]+(\\([^)]*\\))?/g, "")
                .replace(/\\s+/g, " ")
                .trim();
            })
            .filter(function (s) { return s.length > 0; });
          if (cleaned.length === 0) return false;

          // Use document.querySelectorAll so ancestor selectors work — a
          // rule like ".elementor .foo" can be tested by querying the whole
          // document and checking if any match is the section, a descendant,
          // OR an ancestor. The ancestor case matters for rules that DEFINE
          // CSS custom properties on :root / body / html / .elementor-kit-X
          // — those rules don't match the section subtree but supply the
          // variable values that descendant rules reference.
          for (var i = 0; i < cleaned.length; i++) {
            var sel = cleaned[i];
            try {
              var hits = document.querySelectorAll(sel);
              for (var h = 0; h < hits.length; h++) {
                var hit = hits[h];
                if (hit === section) return true;
                if (section.contains(hit)) return true;
                if (hit.contains(section)) return true; // ancestor match
              }
            } catch (e) {
              // Invalid selector after stripping — be permissive, include rule.
              return true;
            }
          }
          return false;
        }

        var rules = [];
        var fontFaces = [];

        function walk(rulesList, mediaCondition, sheetHref) {
          for (var i = 0; i < rulesList.length; i++) {
            var r = rulesList[i];
            if (!r) continue;
            // Type 1: STYLE_RULE
            if (r.type === 1) {
              if (selectorMatches(r.selectorText || "")) {
                rules.push({ media: mediaCondition, cssText: absolutizeCss(r.cssText, sheetHref) });
              }
            }
            // Type 4: MEDIA_RULE
            else if (r.type === 4) {
              walk(r.cssRules, r.media && r.media.mediaText ? r.media.mediaText : mediaCondition, sheetHref);
            }
            // Type 5: FONT_FACE_RULE
            else if (r.type === 5) {
              fontFaces.push(absolutizeCss(r.cssText, sheetHref));
            }
            // Type 12: SUPPORTS_RULE — recurse, preserving condition
            else if (r.type === 12) {
              walk(r.cssRules, mediaCondition, sheetHref);
            }
            // Skip @import, @keyframes, @namespace, etc.
          }
        }

        var sheets = document.styleSheets;
        for (var s = 0; s < sheets.length; s++) {
          try {
            var sheet = sheets[s];
            // CORS-protected stylesheets throw on cssRules access — skip.
            // sheet.href is the URL of the linked stylesheet (or null for inline).
            // Used as the base for resolving relative url(...) references.
            walk(sheet.cssRules, null, sheet.href);
          } catch (e) {
            continue;
          }
        }

        return { html: html, ancestors: ancestors, rules: rules, fontFaces: fontFaces };
      })()
    `;

    const out = (await page.evaluate(evalSrc)) as ExtractedClone;
    return out;
  } finally {
    await ctx.close();
  }
}

// ────────────────────────────────────────────────────────────────────────
// Transform: minimum set of Webflow-paste-compat changes
// ────────────────────────────────────────────────────────────────────────

const FLATTEN_TAGS = [
  "section",
  "nav",
  "footer",
  "header",
  "main",
  "aside",
  "article",
  "details",
  "summary",
  "ul",
  "ol",
  "li",
  "search",
  "dialog",
  "figure",
  "figcaption",
  "picture",
];

const REPLACE_WITH_PLACEHOLDER = ["svg", "iframe", "canvas"];

/**
 * Apply the smallest set of HTML/CSS rewrites needed for Webflow's Ares paste
 * to accept the clone:
 *   - Flatten section-level / list / details tags to <div>
 *   - Drop role/aria/id/data-*  / style attributes
 *   - Replace <svg>/<iframe>/<canvas> with empty placeholder divs
 *   - Swap lazy-load img src for data-src
 *   - Rewrite tag-based selectors in CSS (e.g. `section.foo` → `.foo`) so
 *     rules still match after tag flattening
 */
function transformClone(
  clone: ExtractedClone,
  archetypeId: string,
): { html: string; cssText: string } {
  // Build the ancestor-chain wrappers FIRST. Many source CSS rules use
  // ancestor selectors (`body.elementor-page .foo`, `.elementor .bar`,
  // `:root .baz`). Without those ancestors in the paste, those rules
  // never match. We re-create the chain as nested divs carrying the
  // original ancestor classes — html/body/wrappers all become divs.
  let wrappedHtml = clone.html;
  for (let i = clone.ancestors.length - 1; i >= 0; i -= 1) {
    const a = clone.ancestors[i]!;
    if (!a.className) continue; // Skip ancestors with no classes (no rule will reference them)
    const safeClass = a.className.trim().replace(/"/g, "&quot;");
    wrappedHtml = `<div class="${safeClass}" data-was="${a.tag}">${wrappedHtml}</div>`;
  }

  // ---- HTML transforms via Cheerio -------------------------------------
  const $ = cheerio.load(wrappedHtml, null, false);

  // 1. Swap lazy-load image src FIRST — must read `data-src` before the
  //    blanket data-* strip below removes it. Many WordPress lazy-loaders
  //    set src to a transparent SVG placeholder while keeping the real URL
  //    on data-src. After swapping, drop any remaining placeholder-only
  //    <img> elements (no real URL recovered) so they don't render as
  //    invisible-but-space-occupying boxes alongside the real image
  //    (which often sits in a sibling element loaded via noscript).
  $("img").each((_, img) => {
    if (!isElement(img)) return;
    const src = img.attribs.src ?? "";
    const dataSrc = img.attribs["data-src"];
    if (dataSrc && src.startsWith("data:image/svg+xml")) {
      img.attribs.src = dataSrc;
    }
    if (img.attribs["data-srcset"] && (!img.attribs.srcset || img.attribs.srcset.startsWith("data:"))) {
      img.attribs.srcset = img.attribs["data-srcset"];
    }
  });
  // Drop placeholder <img>s that still have a data: src (no real URL was
  // recoverable). Prevents the empty-placeholder + real-image-elsewhere
  // double-render that WordPress lazy-loaders produce.
  $("img").each((_, img) => {
    if (!isElement(img)) return;
    const src = img.attribs.src ?? "";
    if (src.startsWith("data:image/svg+xml")) {
      $(img).remove();
    }
  });

  // 2. Flatten section-level / list / details tags to <div>.
  $(FLATTEN_TAGS.join(", ")).each((_, el) => {
    if (isElement(el)) el.tagName = "div";
  });

  // 3. Replace unsupported elements with empty placeholder divs (preserve
  //    width/height attrs so layout doesn't collapse).
  for (const tag of REPLACE_WITH_PLACEHOLDER) {
    $(tag).each((_, el) => {
      if (!isElement(el)) return;
      const attrsToKeep: Record<string, string> = {};
      if (el.attribs.width) attrsToKeep.width = el.attribs.width;
      if (el.attribs.height) attrsToKeep.height = el.attribs.height;
      if (el.attribs.class) attrsToKeep.class = el.attribs.class;
      el.tagName = "div";
      el.children = [];
      el.attribs = attrsToKeep;
    });
  }

  // 4. <source> elements (inside <picture>) — drop; the <img> carries the fallback.
  $("source").remove();

  // 5. <table>-family — flatten to divs.
  $("table, thead, tbody, tfoot, tr, td, th, caption, colgroup, col").each((_, el) => {
    if (isElement(el)) el.tagName = "div";
  });

  // 6. Strip attributes that confuse Webflow's element model. CLASSES and
  //    inline `style` are KEPT — they're both critical for visual fidelity:
  //    classes link to extracted CSS rules, and `style` carries per-element
  //    overrides that the source page applied directly (e.g. WordPress
  //    Block Editor often emits inline color/font for individual span/strong
  //    elements, and Elementor's heading widget injects `style="color: ..."`
  //    on inner spans for emphasis colors). Drop only id/data-*/aria-*/role
  //    which trigger Webflow's strict validators (id collisions, list
  //    nesting rules) and don't carry visual styling.
  $("*").each((_, el) => {
    if (!isElement(el)) return;
    const a = el.attribs;
    delete a.id;
    delete a.role;
    for (const k of Object.keys(a)) {
      if (k.startsWith("aria-")) delete a[k];
      if (k.startsWith("data-")) delete a[k];
    }
  });

  const html = $.html();

  // ---- CSS transforms --------------------------------------------------
  const cssText = renderCss(clone, archetypeId);

  return { html, cssText };
}

/** Build the final CSS string from extracted rules + font-faces. */
function renderCss(clone: ExtractedClone, archetypeId: string): string {
  const seen = new Set<string>();
  const baseLines: string[] = [];
  const byMedia = new Map<string, string[]>();

  // Rewrite tag-based selectors so flattened tags still match. The HTML
  // pass converted these tags to <div>; selectors must follow.
  //
  //   `body.elementor-page .foo` → `.elementor-page .foo` (body classes are on a wrapper div)
  //   `html.no-touch a` → `a`
  //   `:root .bar` → `.ai-migration-clone .bar` (CSS variables scoped to outer wrapper)
  //   `:root` (alone) → `.ai-migration-clone` (so the rule still has a valid selector)
  //   `section.elementor` → `div.elementor` (then matches our flattened HTML)
  function rewriteSelector(sel: string): string {
    let s = sel.trim();
    if (!s) return ".ai-migration-clone";

    // Replace leading :root with .ai-migration-clone (outer wrapper class)
    // so :root-defined CSS custom properties cascade into our paste tree.
    s = s.replace(/^:root(?=[.#:[\s>+~]|$)/, ".ai-migration-clone");

    // Strip leading body/html, preserving any qualifiers (ancestor wrappers
    // carry body classes as plain divs, so body.foo and .foo are equivalent).
    s = s.replace(/^(?:html|body)(?=[.#:[\s>+~]|$)/, "");

    // Flatten section-level / list / details / replaced-element tags to div.
    s = s.replace(/\b(section|nav|footer|header|main|aside|article|details|summary|ul|ol|li|picture|svg|iframe|canvas|table|thead|tbody|tfoot|tr|td|th|search|dialog|figure|figcaption)\b(?!-)/g, "div");

    // Trim leading combinators / whitespace introduced by the strip.
    s = s.replace(/^\s*[>+~]\s*/, "").trim();

    // Empty selector after strip (was just `body` or `html`) → use a
    // safe global selector so the rule still applies somewhere.
    if (!s) return ".ai-migration-clone";
    return s;
  }

  // Each cssText is "selectorText { decls }". Rewrite the selector portion only.
  function rewriteRule(cssText: string): string {
    const idx = cssText.indexOf("{");
    if (idx < 0) return cssText;
    const sel = cssText.slice(0, idx).trim();
    const decls = cssText.slice(idx);
    const newSel = sel.split(",").map((s) => rewriteSelector(s.trim())).join(", ");
    return `${newSel} ${decls}`;
  }

  for (const r of clone.rules) {
    const text = rewriteRule(r.cssText);
    const key = (r.media || "") + "::" + text;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.media) {
      const arr = byMedia.get(r.media) ?? [];
      arr.push(text);
      byMedia.set(r.media, arr);
    } else {
      baseLines.push(text);
    }
  }

  const parts: string[] = [];
  parts.push(`/* ai-migration clone: ${archetypeId} */`);
  parts.push("");
  // Font-faces first so any later font-family references resolve.
  for (const ff of clone.fontFaces) parts.push(ff);
  if (clone.fontFaces.length > 0) parts.push("");
  for (const r of baseLines) parts.push(r);
  for (const [media, rules] of byMedia) {
    parts.push("");
    parts.push(`@media ${media} {`);
    for (const r of rules) parts.push("  " + r);
    parts.push("}");
  }

  return parts.join("\n");
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

// ────────────────────────────────────────────────────────────────────────
// Render: assemble per-Component file and combined bundle
// ────────────────────────────────────────────────────────────────────────

function renderFragment(entry: BuildPlanEntry, parts: { html: string; cssText: string }): string {
  // Single-root payload for Ares: <style> followed by ONE wrapping <div>.
  // The class on the wrapper ("ai-migration-clone") prevents Ares from
  // stripping it as a trivial wrapper.
  return `<style>\n${parts.cssText}\n</style>\n\n<div class="ai-migration-clone" data-archetype="${entry.archetype_id}">\n${parts.html}\n</div>`;
}

function renderCombined(
  domain: string,
  parts: { entry: BuildPlanEntry; html: string; cssText: string }[],
): string {
  // Combined: one big <style> with all rules + one wrapping <div> with
  // each Component as a child.
  const allCss: string[] = [`/* ai-migration combined clone: ${domain} */`];
  for (const p of parts) {
    allCss.push("");
    allCss.push(`/* ── ${p.entry.archetype_id} */`);
    allCss.push(p.cssText);
  }

  const allHtml: string[] = [];
  for (const p of parts) {
    allHtml.push(`<div data-archetype="${p.entry.archetype_id}">${p.html}</div>`);
  }

  return `<style>\n${allCss.join("\n")}\n</style>\n\n<div class="ai-migration-clone-bundle" data-domain="${domain}">\n${allHtml.join("\n")}\n</div>`;
}

function buildReadme(plan: BuildPlanFile, ordered: BuildPlanEntry[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const rows = ordered
    .map((e, i) => {
      const num = String(i + 1).padStart(2, "0");
      return `| ${num} | ${e.component_name.replace(/\|/g, "\\|")} | ${e.component_group} | ${e.canonical_source_url} |`;
    })
    .join("\n");

  return `# AI Migration → Webflow clone-export

Generated ${date} from \`output/${plan.domain}/build-plan.json\`.

These files are **section-scoped clones** of the source page sections — original
HTML, original classes, plus the matching subset of source-page CSS rules.
Pasting via Ares should produce a 1:1 visual match of the source section in
your Webflow site.

## Components

| # | Component | Group | Source URL |
|---|---|---|---|
${rows}

## How to paste

1. Open your target Webflow site in Designer.
2. Open the Ares extension.
3. Open \`all-clones.html\` (or a per-Component file). Copy the entire contents.
4. Paste into Ares.

## Difference from \`exports/\`

The \`exports/\` folder uses cleaned HTML + reconstructed CSS (synthetic class
names like \`.cta-banner__1\`). The \`clones/\` folder preserves original markup
and source CSS — designed for visual fidelity, not Component reusability. Use
clones for paste-and-edit; use exports for archetype-driven Component building.

## Known caveats

- Source HTML carries Elementor's class names (\`.elementor-element-xxxx\`).
  Designer renames them in Webflow as part of the migration cleanup.
- \`<svg>\`, \`<iframe>\`, \`<canvas>\` are replaced with empty placeholder divs.
- \`<details>\`/\`<summary>\` collapsibility is lost (flattened to divs for paste compat).
- Lazy-loaded image \`src\` is swapped to \`data-src\` where present.
`;
}

// ────────────────────────────────────────────────────────────────────────
// Sort order — same as emit-export
// ────────────────────────────────────────────────────────────────────────

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
