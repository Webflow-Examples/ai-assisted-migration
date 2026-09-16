import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type {
  DiscoveryFile,
  DiscoveryEntry,
  FingerprintFile,
  PageFingerprint,
  SectionFingerprint,
} from "../util/types.js";
import { outputPath } from "../util/paths.js";
import { info, step, progress, warn } from "../util/log.js";
import { fetchPageHtml } from "../scrape/fetch.js";
import { detectSections, domPath } from "./detectSections.js";
import { layoutSignature, classFeatures, builderBlockType } from "./structuralFeatures.js";
import { extractContent } from "./contentExtract.js";
import { cleanSectionHtml } from "./cleanHtml.js";
import { writeBundle } from "./bundle.js";

export interface FingerprintOptions {
  domain: string;
  pageConcurrency?: number;
  downloadAssets?: boolean;
  /** Skip pages with errors / utility / non-html in discovery. */
  skipUtilities?: boolean;
}

/**
 * Phase 2 orchestrator. Reads `discovery.json`, fetches HTML for each
 * non-utility page, segments into sections, fingerprints each section, and
 * writes per-section bundles plus the aggregate `fingerprints.json`.
 */
export async function runFingerprint(opts: FingerprintOptions): Promise<FingerprintFile> {
  const {
    domain,
    pageConcurrency = 6,
    downloadAssets = true,
    skipUtilities = true,
  } = opts;

  step("phase 2", `fingerprint for ${domain}`);

  const discoveryPath = outputPath(domain, "discovery.json");
  const discovery = JSON.parse(readFileSync(discoveryPath, "utf8")) as DiscoveryFile;

  const targets = discovery.entries.filter((e) => {
    if (skipUtilities && e.is_utility) return false;
    if (e.error) return false;
    if (e.status === 0 || e.status >= 400) return false;
    if (e.content_type && !e.content_type.includes("html")) return false;
    return true;
  });
  info(`fingerprinting ${targets.length} of ${discovery.entries.length} discovered urls`);

  const limit = pLimit(pageConcurrency);
  const pages: PageFingerprint[] = new Array(targets.length);
  let done = 0;

  await Promise.all(
    targets.map((entry, i) =>
      limit(async () => {
        try {
          pages[i] = await fingerprintPage(domain, entry, downloadAssets);
        } catch (e) {
          pages[i] = {
            url: entry.url,
            scrape_status: "failed",
            error: e instanceof Error ? e.message : String(e),
            sections: [],
          };
        }
        done += 1;
        progress(done, targets.length, entry.url);
      }),
    ),
  );

  const file: FingerprintFile = {
    domain,
    generated_at: new Date().toISOString(),
    pages,
  };
  const outPath = outputPath(domain, "fingerprints.json");
  writeFileSync(outPath, JSON.stringify(file, null, 2));
  info(`wrote ${outPath}`);

  // Summary
  const sectionCount = pages.reduce((s, p) => s + p.sections.length, 0);
  const failed = pages.filter((p) => p.scrape_status === "failed").length;
  info("fingerprint summary", {
    pages: pages.length,
    pages_failed: failed,
    sections_total: sectionCount,
    avg_sections_per_page: pages.length ? +(sectionCount / pages.length).toFixed(2) : 0,
  });

  return file;
}

async function fingerprintPage(
  domain: string,
  entry: DiscoveryEntry,
  downloadAssets: boolean,
): Promise<PageFingerprint> {
  const fetched = await fetchPageHtml(entry.url);
  const $ = cheerio.load(fetched.html);

  const detected = detectSections($, entry.page_builder);
  if (detected.length === 0) {
    warn(`no sections detected`, { url: entry.url });
  }

  const urlHash = crypto.createHash("sha1").update(entry.url).digest("hex").slice(0, 10);

  const sections: SectionFingerprint[] = [];
  let kept = 0;
  for (let i = 0; i < detected.length; i++) {
    const { el } = detected[i]!;
    const fp = fingerprintSection($, el, entry.url, urlHash, kept);
    // Drop empty / structural-only sections — they carry no archetype signal
    // and pollute coverage denominators. Treats a section as empty if it
    // has no words, images, or links.
    if (fp.word_count === 0 && fp.image_count === 0 && fp.link_count === 0) {
      continue;
    }
    sections.push(fp);
    kept += 1;

    const rawHtml = $.html(el);
    const cleaned = cleanSectionHtml(rawHtml);
    fp.html = cleaned;
    await writeBundle({
      domain,
      fp,
      cleanedHtml: cleaned,
      pageUrl: entry.url,
      downloadAssets,
    });
  }

  return {
    url: entry.url,
    scrape_status: "ok",
    sections,
  };
}

function fingerprintSection(
  $: CheerioAPI,
  el: Element,
  pageUrl: string,
  urlHash: string,
  position: number,
): SectionFingerprint {
  const $el = $(el);
  const content = extractContent($, el);
  const layout = layoutSignature($, el);
  const block = builderBlockType($, el);
  const classFeats = classFeatures($, el);

  const hasCarousel = layout === "carousel" || $el.find(".swiper, .slick-slider").length > 0;
  const hasAccordion = layout === "accordion" || $el.find(".elementor-accordion, .elementor-toggle, details").length > 0;
  const hasTabs = layout === "tabs" || $el.find(".elementor-tabs, [role='tablist']").length > 0;
  const hasVideo = $el.find("video, iframe[src*='youtube'], iframe[src*='vimeo'], iframe[src*='wistia']").length > 0;
  const hasForm = $el.find("form").length > 0 || content.form_fields.length > 0;

  return {
    section_id: `${urlHash}__${String(position).padStart(3, "0")}`,
    page_url: pageUrl,
    position_index: position,
    dom_path: domPath($, el),
    tag: el.tagName ?? "div",
    html: "", // populated by caller after cleanSectionHtml
    layout,
    child_count: $el.children().length,
    word_count: content.raw_text_word_count,
    image_count: content.images.length,
    link_count: content.links.length,
    has_form: hasForm,
    has_video: hasVideo,
    has_carousel: hasCarousel,
    has_accordion: hasAccordion,
    has_tabs: hasTabs,
    class_features: classFeats,
    builder_block_type: block,
    content,
  };
}
