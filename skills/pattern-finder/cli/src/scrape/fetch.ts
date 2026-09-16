/**
 * Plain HTTP fetch for a page's HTML. Kept small and dependency-free so we
 * can swap in Firecrawl later without a rewrite — the contract is
 * `(url) → { html, finalUrl, status }`.
 */

const USER_AGENT =
  "Mozilla/5.0 (compatible; AI-Migration-Bot/0.1; +https://github.com/webflow/ai-migration)";

export interface FetchedPage {
  html: string;
  finalUrl: string;
  status: number;
}

export async function fetchPageHtml(url: string, timeoutMs = 25_000): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`fetch ${url} → ${res.status}`);
    }
    const html = await res.text();
    return { html, finalUrl: res.url, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}
