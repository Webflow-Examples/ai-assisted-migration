import * as cheerio from "cheerio";
import type { Element, AnyNode } from "domhandler";

/**
 * Strip a section's outerHTML to a clean structural skeleton:
 *   - no inline `style` attrs (downstream styling is MAST-driven)
 *   - no `class` attrs (source class soup misleads the rebuilder)
 *   - no script/style/link tags
 *   - no Elementor / WP id and data-* attrs that leak source identity
 *   - no comments
 *
 * What stays: tag structure, semantic attributes (`href`, `src`, `alt`,
 * `aria-*`, `role`, form-field essentials), and text content. The result
 * is meant to be readable by a Webflow-builder model as "this is the
 * structure, populate it with content.json".
 */
export function cleanSectionHtml(rawOuterHtml: string): string {
  const $ = cheerio.load(`<root>${rawOuterHtml}</root>`, { xmlMode: false });
  const $root = $("root").first();

  $root.find("script, style, noscript, link, template").remove();

  $root.find("*").each((_, el) => {
    const attribs = (el as Element).attribs;
    if (!attribs) return;
    for (const name of Object.keys(attribs)) {
      if (shouldKeep(name)) continue;
      delete attribs[name];
    }
  });

  // Strip comment nodes everywhere in the subtree.
  const stripComments = (nodes: AnyNode[]): void => {
    for (const n of [...nodes]) {
      if (n.type === "comment") {
        $(n).remove();
        continue;
      }
      if ("children" in n && Array.isArray(n.children)) {
        stripComments(n.children as AnyNode[]);
      }
    }
  };
  const rootNode = $root.get(0);
  if (rootNode && "children" in rootNode) {
    stripComments(rootNode.children as AnyNode[]);
  }

  return $root.html() ?? "";
}

function shouldKeep(attrName: string): boolean {
  const a = attrName.toLowerCase();
  if (a === "href" || a === "src" || a === "srcset" || a === "alt" || a === "title") return true;
  if (a === "role" || a.startsWith("aria-")) return true;
  if (a === "type" || a === "name" || a === "value" || a === "placeholder" || a === "for") return true;
  if (a === "method" || a === "action") return true;
  if (a === "width" || a === "height") return true;
  return false;
}
