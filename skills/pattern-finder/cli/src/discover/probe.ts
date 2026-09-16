import * as cheerio from "cheerio";
import type { DiscoveryEntry, PageBuilder } from "../util/types.js";

const USER_AGENT =
  "Mozilla/5.0 (compatible; AI-Migration-Bot/0.1; +https://github.com/webflow/ai-migration)";

const UTILITY_URL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\/privacy[-_]?policy/i, reason: "privacy policy" },
  { pattern: /\/terms[-_]?(of[-_]service|and[-_]conditions)?/i, reason: "terms" },
  { pattern: /\/cookie[-_]?policy/i, reason: "cookie policy" },
  { pattern: /\/legal(entity)?$/i, reason: "legal" },
  { pattern: /\/thank[-_]?you/i, reason: "thank-you" },
  { pattern: /\/(404|500|error)/i, reason: "error page" },
  { pattern: /-redirect\/?$/i, reason: "redirect stub" },
  { pattern: /\/payment[-_]?confirmation/i, reason: "payment confirmation" },
  { pattern: /\/tpl\/?$/i, reason: "tpl stub" },
];

/**
 * Probe a single URL: fetch, parse minimal metadata, detect page builder.
 * Returns a DiscoveryEntry — never throws; failures land in `error`.
 */
export async function probeUrl(url: string, timeoutMs = 15_000): Promise<DiscoveryEntry> {
  const utility = classifyUtility(url);

  // For URLs that look like obvious utilities, skip the actual fetch — saves time.
  if (utility) {
    return {
      url,
      status: 0,
      body_classes: [],
      page_builder: "unknown",
      builder_signals: [],
      is_utility: true,
      utility_reason: utility,
    };
  }

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
    clearTimeout(timer);

    const status = res.status;
    const finalUrl = res.url;
    const contentType = res.headers.get("content-type") ?? undefined;

    if (!contentType?.includes("text/html") && !contentType?.includes("application/xhtml")) {
      return {
        url,
        status,
        redirected_to: finalUrl !== url ? finalUrl : undefined,
        content_type: contentType,
        body_classes: [],
        page_builder: "unknown",
        builder_signals: [],
        is_utility: false,
      };
    }

    if (!res.ok) {
      return {
        url,
        status,
        redirected_to: finalUrl !== url ? finalUrl : undefined,
        content_type: contentType,
        body_classes: [],
        page_builder: "unknown",
        builder_signals: [],
        is_utility: false,
      };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const bodyClasses = ($("body").attr("class") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const generator = $('meta[name="generator"]').attr("content");

    const { builder, signals } = detectPageBuilder(html, bodyClasses, generator);

    return {
      url,
      status,
      redirected_to: finalUrl !== url ? finalUrl : undefined,
      content_type: contentType,
      body_classes: bodyClasses,
      generator,
      page_builder: builder,
      builder_signals: signals,
      is_utility: false,
    };
  } catch (e) {
    clearTimeout(timer);
    return {
      url,
      status: 0,
      body_classes: [],
      page_builder: "unknown",
      builder_signals: [],
      is_utility: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function classifyUtility(url: string): string | undefined {
  for (const { pattern, reason } of UTILITY_URL_PATTERNS) {
    if (pattern.test(url)) return reason;
  }
  return undefined;
}

/**
 * Detect WordPress page builder from class signatures, generator meta,
 * and inline markers. Returns (builder, list-of-evidence-strings).
 */
function detectPageBuilder(
  html: string,
  bodyClasses: string[],
  generator?: string,
): { builder: PageBuilder; signals: string[] } {
  const signals: string[] = [];
  const bodyClassStr = bodyClasses.join(" ");

  if (/elementor/i.test(bodyClassStr) || html.includes("elementor-section") || html.includes("elementor-widget")) {
    signals.push("elementor body class / inline markers");
    if (generator) signals.push(`generator: ${generator}`);
    return { builder: "elementor", signals };
  }
  if (/et_pb_|divi/i.test(bodyClassStr) || html.includes("et_pb_section")) {
    signals.push("divi body class / et_pb_section");
    return { builder: "divi", signals };
  }
  if (html.includes("vc_row") || html.includes("wpb_row")) {
    signals.push("WPBakery vc_row / wpb_row");
    return { builder: "wpbakery", signals };
  }
  if (/fl-builder/i.test(bodyClassStr) || html.includes("fl-row")) {
    signals.push("Beaver Builder fl-builder / fl-row");
    return { builder: "beaver-builder", signals };
  }
  if (/oxygen-/i.test(bodyClassStr) || html.includes("ct_section")) {
    signals.push("Oxygen ct_section / oxygen- class");
    return { builder: "oxygen", signals };
  }
  if (/brxe-/i.test(html)) {
    signals.push("Bricks brxe- markers");
    return { builder: "bricks", signals };
  }
  if (html.includes("wp-block-") || /wp-block-group|wp-block-cover/.test(bodyClassStr)) {
    signals.push("Gutenberg wp-block-* markers");
    return { builder: "gutenberg", signals };
  }

  // No builder detected, but it's still WordPress (or similar)
  if (generator?.toLowerCase().includes("wordpress")) {
    signals.push(`generator: ${generator}`);
    return { builder: "custom-theme", signals };
  }

  return { builder: "unknown", signals };
}
