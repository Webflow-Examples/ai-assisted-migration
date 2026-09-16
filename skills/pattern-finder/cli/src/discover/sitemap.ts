import { XMLParser } from "fast-xml-parser";

/**
 * Fetch a sitemap and return the URL list. Supports nested sitemaps
 * (sitemap-index → child sitemaps) up to one level deep.
 *
 * Filters out non-page URLs (image:loc inside image extension blocks
 * are not parsed as page locations).
 */
export async function fetchSitemap(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchText(sitemapUrl);
  return parseSitemap(xml, sitemapUrl);
}

async function parseSitemap(xml: string, sourceUrl: string): Promise<string[]> {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: true,
    trimValues: true,
  });
  const parsed = parser.parse(xml);

  // sitemap-index → recurse one level
  if (parsed.sitemapindex?.sitemap) {
    const nested = toArray(parsed.sitemapindex.sitemap);
    const all: string[] = [];
    for (const entry of nested) {
      const loc = extractLoc(entry);
      if (!loc) continue;
      try {
        const child = await fetchText(loc);
        const childUrls = await parseSitemap(child, loc);
        all.push(...childUrls);
      } catch (e) {
        // skip broken nested sitemap, continue
      }
    }
    return dedupe(all);
  }

  // urlset
  if (parsed.urlset?.url) {
    const urls = toArray(parsed.urlset.url)
      .map((entry) => extractLoc(entry))
      .filter((u): u is string => !!u);
    return dedupe(urls);
  }

  // Some WordPress AIOSEO sitemaps wrap urls oddly — fallback regex
  const regexUrls = Array.from(xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/g))
    .map((m) => (m[1] ?? "").trim())
    .filter(Boolean);
  return dedupe(regexUrls);
}

function extractLoc(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const obj = entry as Record<string, unknown>;
  const loc = obj.loc;
  if (typeof loc === "string") return loc.trim();
  if (typeof loc === "object" && loc !== null && "#text" in loc) {
    const text = (loc as Record<string, unknown>)["#text"];
    if (typeof text === "string") return text.trim();
  }
  return null;
}

function toArray<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : [x];
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const norm = normalizeUrl(u);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    // strip trailing slash from path (except root)
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AI-Migration-Bot/0.1; +https://github.com/webflow/ai-migration)",
      Accept: "application/xml, text/xml, */*",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Sitemap fetch failed: ${url} → ${res.status}`);
  return res.text();
}
