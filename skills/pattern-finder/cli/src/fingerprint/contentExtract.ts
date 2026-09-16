import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { ContentBag } from "../util/types.js";

/**
 * Extract a structured ContentBag from a section. Content is the *what* —
 * separated from the *how* (DOM structure) so it can later be bound into
 * a Webflow Component's properties or a CMS field.
 */
export function extractContent($: CheerioAPI, el: Element): ContentBag {
  const $el = $(el);

  const headings = $el
    .find("h1, h2, h3, h4, h5, h6")
    .map((_, h) => {
      const tag = h.tagName.toLowerCase();
      const level = Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
      const text = clean($(h).text());
      return text ? { level, text } : null;
    })
    .get()
    .filter((x): x is { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } => !!x);

  const paragraphs = $el
    .find("p")
    .map((_, p) => clean($(p).text()))
    .get()
    .filter((t) => t.length > 0);

  const images = $el
    .find("img, picture source, [data-bg], [style*='background-image']")
    .map((_, img) => {
      const $img = $(img);
      const src = $img.attr("src") ?? $img.attr("data-src") ?? $img.attr("srcset")?.split(/\s+/)[0] ?? $img.attr("data-bg") ?? extractBgUrl($img.attr("style") ?? "");
      if (!src) return null;
      const alt = $img.attr("alt") ?? "";
      const role = inferImageRole($, img);
      const widthAttr = $img.attr("width");
      const heightAttr = $img.attr("height");
      const width = widthAttr ? Number(widthAttr) || undefined : undefined;
      const height = heightAttr ? Number(heightAttr) || undefined : undefined;
      return { src, alt, role, width, height };
    })
    .get()
    .filter((x): x is NonNullable<typeof x> => !!x);

  const links = $el
    .find("a[href]")
    .map((_, a) => {
      const $a = $(a);
      const href = $a.attr("href") ?? "";
      const label = clean($a.text() || $a.attr("aria-label") || $a.find("img").attr("alt") || "");
      if (!href) return null;
      const role = inferLinkRole($, a);
      return { href, label, role };
    })
    .get()
    .filter((x): x is NonNullable<typeof x> => !!x);

  const buttons = $el
    .find("button, [role='button'], input[type='submit']")
    .map((_, b) => {
      const $b = $(b);
      const label = clean($b.text() || ($b.attr("value") ?? "") || ($b.attr("aria-label") ?? ""));
      if (!label) return null;
      return { label, role: $b.attr("type") === "submit" ? "submit" : undefined };
    })
    .get()
    .filter((x): x is NonNullable<typeof x> => !!x);

  const formFields = $el
    .find("input, textarea, select")
    .map((_, f) => {
      const $f = $(f);
      const name = $f.attr("name");
      const type = $f.attr("type") ?? f.tagName.toLowerCase();
      // Find a label by `for=id` or wrapping <label>
      const id = $f.attr("id");
      let labelText: string | undefined;
      if (id) labelText = clean($el.find(`label[for='${cssEscape(id)}']`).first().text()) || undefined;
      if (!labelText) labelText = clean($f.parent("label").first().text()) || undefined;
      if (!labelText) labelText = $f.attr("placeholder") || $f.attr("aria-label") || undefined;
      return { name, type, label: labelText };
    })
    .get();

  const lists = $el
    .find("ul, ol")
    .map((_, list) => {
      const ordered = list.tagName.toLowerCase() === "ol";
      const items = $(list)
        .children("li")
        .map((_, li) => clean($(li).text()))
        .get()
        .filter(Boolean);
      if (items.length === 0) return null;
      return { ordered, items };
    })
    .get()
    .filter((x): x is NonNullable<typeof x> => !!x);

  const rawText = $el.text();
  const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;

  return {
    headings,
    paragraphs,
    images,
    links,
    buttons,
    form_fields: formFields,
    lists,
    raw_text_word_count: wordCount,
  };
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractBgUrl(style: string): string | undefined {
  const m = /url\(["']?([^"')]+)["']?\)/i.exec(style);
  return m?.[1];
}

function inferImageRole($: CheerioAPI, img: Element): string | undefined {
  const $img = $(img);
  const cls = ($img.attr("class") ?? "").toLowerCase();
  const parentCls = ($img.parent().attr("class") ?? "").toLowerCase();
  if (/logo/.test(cls) || /logo/.test(parentCls)) return "logo";
  if (/avatar|author|profile|headshot/.test(cls + " " + parentCls)) return "avatar";
  if (/icon/.test(cls) || /icon/.test(parentCls)) return "icon";
  if (/hero|banner/.test(parentCls)) return "hero";
  const w = Number($img.attr("width") ?? 0);
  const h = Number($img.attr("height") ?? 0);
  if (w && h && w <= 64 && h <= 64) return "icon";
  return undefined;
}

function inferLinkRole($: CheerioAPI, a: Element): string | undefined {
  const $a = $(a);
  const cls = ($a.attr("class") ?? "").toLowerCase();
  if (/btn|button|cta/.test(cls)) {
    if (/secondary|outline|ghost/.test(cls)) return "cta-secondary";
    return "cta-primary";
  }
  if ($a.parents("nav, header").length > 0) return "nav";
  if ($a.parents("footer").length > 0) return "footer-link";
  return undefined;
}

function cssEscape(s: string): string {
  return s.replace(/(['"\\])/g, "\\$1");
}
