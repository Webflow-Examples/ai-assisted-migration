import { writeFileSync } from "node:fs";
import pLimit from "p-limit";
import { fetchSitemap } from "./sitemap.js";
import { probeUrl } from "./probe.js";
import { outputPath } from "../util/paths.js";
import { info, step, progress, warn } from "../util/log.js";
import type { DiscoveryEntry, DiscoveryFile } from "../util/types.js";

export interface DiscoverOptions {
  sitemapUrl?: string;
  urls?: string[];
  domain: string;
  concurrency?: number;
  timeoutMs?: number;
}

/**
 * Phase 1 orchestrator. Resolve URL list (sitemap or explicit), probe each
 * concurrently, write `output/{domain}/discovery.json`. Returns the file
 * payload so callers can chain into Phase 2 without re-reading from disk.
 */
export async function runDiscovery(opts: DiscoverOptions): Promise<DiscoveryFile> {
  const { domain, sitemapUrl, urls: explicitUrls, concurrency = 8, timeoutMs = 15_000 } = opts;

  step("phase 1", `discovery for ${domain}`);

  let urls: string[] = [];
  if (explicitUrls && explicitUrls.length > 0) {
    urls = dedupe(explicitUrls);
    info(`using ${urls.length} explicit urls`);
  } else if (sitemapUrl) {
    info(`fetching sitemap`, { sitemapUrl });
    urls = await fetchSitemap(sitemapUrl);
    info(`sitemap returned ${urls.length} urls`);
  } else {
    throw new Error("runDiscovery requires sitemapUrl or urls[]");
  }

  if (urls.length === 0) {
    warn("no urls to probe — writing empty discovery.json");
  }

  const limit = pLimit(concurrency);
  const entries: DiscoveryEntry[] = new Array(urls.length);
  let completed = 0;

  await Promise.all(
    urls.map((url, i) =>
      limit(async () => {
        const entry = await probeUrl(url, timeoutMs);
        entries[i] = entry;
        completed += 1;
        progress(completed, urls.length, url);
      }),
    ),
  );

  const file: DiscoveryFile = {
    domain,
    sitemap_url: sitemapUrl,
    generated_at: new Date().toISOString(),
    total_urls: entries.length,
    entries,
  };

  const outPath = outputPath(domain, "discovery.json");
  writeFileSync(outPath, JSON.stringify(file, null, 2));
  info(`wrote ${outPath}`);

  // Quick summary so the operator can sanity-check before Phase 2
  const summary = summarize(entries);
  info("discovery summary", summary);

  return file;
}

function summarize(entries: DiscoveryEntry[]): Record<string, number> {
  const out: Record<string, number> = {
    total: entries.length,
    utility: 0,
    errors: 0,
    ok: 0,
  };
  for (const e of entries) {
    if (e.is_utility) out.utility = (out.utility ?? 0) + 1;
    else if (e.error || e.status === 0 || e.status >= 400) out.errors = (out.errors ?? 0) + 1;
    else out.ok = (out.ok ?? 0) + 1;
    const k = `builder:${e.page_builder}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function dedupe(urls: string[]): string[] {
  return Array.from(new Set(urls));
}
