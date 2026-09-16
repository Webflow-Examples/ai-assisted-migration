#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { runDiscovery } from "./discover/index.js";
import { runFingerprint } from "./fingerprint/index.js";
import { runMatch } from "./match/index.js";
import { runVision, prepareVisionWorklist } from "./match/visionRunner.js";
import { runAggregate } from "./aggregate/index.js";
import { runReport } from "./report/index.js";
import { runBuildPlan } from "./build/buildPlan.js";
import { runEmitExport } from "./build/emitExport.js";
import { runCloneExport } from "./clone/cloneSection.js";
import { runBuildPreview } from "./clone/buildPreview.js";
import { runCaptureStyles } from "./styles/captureStyles.js";
import { summarizeCurationQueue } from "./curation/queue.js";
import { err, info } from "./util/log.js";

const program = new Command();

program
  .name("ai-migrate")
  .description("AI-driven WordPress → Webflow migration: section archetype matcher")
  .version("0.1.0");

program
  .command("discover")
  .description("Phase 1: fetch sitemap, probe URLs, classify page builders")
  .requiredOption("--domain <domain>", "output folder name (e.g. example-com)")
  .option("--sitemap <url>", "sitemap.xml URL")
  .option("--urls <file>", "newline-delimited URL list file (alternative to --sitemap)")
  .option("--concurrency <n>", "parallel probes", (v) => parseInt(v, 10), 8)
  .option("--timeout <ms>", "per-request timeout", (v) => parseInt(v, 10), 15_000)
  .action(async (opts) => {
    let urls: string[] | undefined;
    if (opts.urls) {
      urls = readFileSync(opts.urls, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (!opts.sitemap && !urls) {
      err("discover requires --sitemap or --urls");
      process.exit(2);
    }
    await runDiscovery({
      domain: opts.domain,
      sitemapUrl: opts.sitemap,
      urls,
      concurrency: opts.concurrency,
      timeoutMs: opts.timeout,
    });
  });

program
  .command("fingerprint")
  .description("Phase 2: fetch HTML, segment sections, extract content, write per-section bundles")
  .requiredOption("--domain <domain>", "domain folder under output/ (must have discovery.json)")
  .option("--concurrency <n>", "parallel page fetches", (v) => parseInt(v, 10), 6)
  .option("--no-assets", "skip image/icon downloads (faster, smaller bundles)")
  .action(async (opts) => {
    await runFingerprint({
      domain: opts.domain,
      pageConcurrency: opts.concurrency,
      downloadAssets: opts.assets !== false,
    });
  });

program
  .command("match")
  .description("Phase 3: score every section against the archetype library")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .action(async (opts) => {
    await runMatch({ domain: opts.domain });
  });

program
  .command("vision")
  .description("Phase 4: vision/LLM fallback for medium/low/none tier sections (text-mode v0)")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .option("--tiers <list>", "comma-separated tiers to process", "medium,low,none")
  .option("--max-calls <n>", "hard cap on API calls", (v) => parseInt(v, 10), 500)
  .option("--concurrency <n>", "parallel API calls", (v) => parseInt(v, 10), 4)
  .option("--model <id>", "override Anthropic model id")
  .option("--dry-run", "skip API calls; echo top DOM candidate as fake vision result")
  .option("--cache <file>", "JSON map of pre-computed classifications keyed by section_id; cache hits skip API")
  .option("--cache-only", "only process sections present in --cache; never call the API")
  .action(async (opts) => {
    const tiers = String(opts.tiers).split(",").map((s) => s.trim()) as ("medium" | "low" | "none")[];
    await runVision({
      domain: opts.domain,
      tiers,
      maxCalls: opts.maxCalls,
      concurrency: opts.concurrency,
      dryRun: !!opts.dryRun,
      cacheOnly: !!opts.cacheOnly,
      ...(opts.cache ? { cachePath: opts.cache } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    });
  });

program
  .command("vision-prepare")
  .description("Phase 4 prep: emit vision-worklist.json (no API calls). An external classifier produces vision-cache.json from this.")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .option("--tiers <list>", "comma-separated tiers to include", "medium,low,none")
  .option("--max-items <n>", "cap items in worklist", (v) => parseInt(v, 10), 1000)
  .option("--html-chars <n>", "truncate cleaned HTML per section to N chars", (v) => parseInt(v, 10), 6000)
  .action(async (opts) => {
    const tiers = String(opts.tiers).split(",").map((s) => s.trim()) as ("medium" | "low" | "none")[];
    await prepareVisionWorklist({
      domain: opts.domain,
      tiers,
      maxItems: opts.maxItems,
      htmlCharLimit: opts.htmlChars,
    });
  });

program
  .command("aggregate")
  .description("Phase 5: cluster pages into template families and rank archetypes")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .action(async (opts) => {
    await runAggregate({ domain: opts.domain });
  });

program
  .command("curation")
  .description("Digest the curation queue: surface recurring unmatched patterns as candidates for new archetypes")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .option("--min-recurrence <n>", "patterns must recur ≥N times to surface", (v) => parseInt(v, 10), 3)
  .option("--top <n>", "max candidates to print", (v) => parseInt(v, 10), 20)
  .action((opts) => {
    summarizeCurationQueue({ domain: opts.domain, minRecurrence: opts.minRecurrence, topN: opts.top });
  });

program
  .command("report")
  .description("Phase 5b: render site-component-spec.md from aggregate.json")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .action(async (opts) => {
    await runReport({ domain: opts.domain });
  });

program
  .command("capture-styles")
  .description("Phase 2.5: visit each source URL, sample computed styles per section at 3 breakpoints, write styles.json into each bundle")
  .requiredOption("--domain <domain>", "domain folder under output/ (must have fingerprints.json)")
  .option("--concurrency <n>", "parallel page navigations", (v) => parseInt(v, 10), 2)
  .option("--timeout <ms>", "per-page navigation timeout", (v) => parseInt(v, 10), 30_000)
  .option("--resume", "skip pages whose sections already have styles.json")
  .action(async (opts) => {
    await runCaptureStyles({
      domain: opts.domain,
      pageConcurrency: opts.concurrency,
      timeoutMs: opts.timeout,
      resume: !!opts.resume,
    });
  });

program
  .command("build-plan")
  .description("Phase 6: emit build-plan.json — one entry per recommended Component, including styles and prop_definitions")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .action(async (opts) => {
    await runBuildPlan({ domain: opts.domain });
  });

program
  .command("emit-export")
  .description("Phase 7: emit per-Component bare HTML+CSS fragments ready to paste into Webflow via the Ares extension")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .option("--desktop-only", "skip tablet/mobile @media overrides; emit only desktop base styles")
  .action(async (opts) => {
    await runEmitExport({ domain: opts.domain, desktopOnly: !!opts.desktopOnly });
  });

program
  .command("clone-export")
  .description("Phase 7c: clone each canonical section's original HTML + matching CSS rules from the source page (1:1 visual fidelity, source classes preserved)")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .option("--timeout <ms>", "per-page navigation timeout", (v) => parseInt(v, 10), 30_000)
  .action(async (opts) => {
    await runCloneExport({ domain: opts.domain, timeoutMs: opts.timeout });
  });

program
  .command("preview")
  .description("Wrap clone fragments in standalone HTML pages so they can be opened in a browser to verify before pasting into Webflow")
  .requiredOption("--domain <domain>", "domain folder under output/")
  .option("--open", "open the preview index in the default browser after building")
  .action(async (opts) => {
    const { indexPath } = await runBuildPreview({ domain: opts.domain });
    if (opts.open) {
      const { execSync } = await import("node:child_process");
      try { execSync(`open "${indexPath}"`); } catch { /* non-mac platforms */ }
    }
  });

program
  .command("run")
  .description("Run all phases end-to-end (discover \u2192 fingerprint \u2192 match \u2192 [vision] \u2192 aggregate \u2192 report)")
  .requiredOption("--sitemap <url>", "sitemap.xml URL")
  .requiredOption("--domain <domain>", "output folder name")
  .option("--concurrency <n>", "page-fetch concurrency", (v) => parseInt(v, 10), 8)
  .option("--no-assets", "skip image downloads")
  .option("--vision-cache <file>", "if set, run Phase 4 with this cache (no API calls)")
  .action(async (opts) => {
    await runDiscovery({ domain: opts.domain, sitemapUrl: opts.sitemap, concurrency: opts.concurrency });
    await runFingerprint({ domain: opts.domain, pageConcurrency: Math.min(opts.concurrency, 6), downloadAssets: opts.assets !== false });
    await runMatch({ domain: opts.domain });
    if (opts.visionCache) {
      await runVision({ domain: opts.domain, cachePath: opts.visionCache, cacheOnly: true, maxCalls: 100_000 });
    }
    await runAggregate({ domain: opts.domain });
    const outPath = await runReport({ domain: opts.domain });
    info(`done \u2192 ${outPath}`);
  });

program.parseAsync(process.argv).catch((e) => {
  err(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
