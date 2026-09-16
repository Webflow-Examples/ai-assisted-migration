import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import type { SectionFingerprint } from "../util/types.js";
import { sectionsDir } from "../util/paths.js";
import { downloadAsset } from "../scrape/assets.js";

/**
 * Write the per-section bundle to disk. At fingerprint time we don't know
 * the archetype yet, so the directory is keyed by `section_id`. Phase 5
 * generates an archetype-grouped manifest on top of this layout.
 *
 * Bundle contents (per plan, minus screenshot which is deferred to Phase 4):
 *   section.html     — cleaned structural skeleton
 *   content.json     — extracted ContentBag
 *   metadata.json    — fingerprint summary + provenance
 *   assets/          — downloaded images/icons referenced by this section
 */
export interface BundleWriteOptions {
  domain: string;
  fp: SectionFingerprint;
  cleanedHtml: string;
  pageUrl: string;
  downloadAssets?: boolean;
  assetConcurrency?: number;
}

export interface BundleWriteResult {
  dir: string;
  assetCount: number;
}

export async function writeBundle(opts: BundleWriteOptions): Promise<BundleWriteResult> {
  const { domain, fp, cleanedHtml, pageUrl, downloadAssets = true, assetConcurrency = 4 } = opts;

  const dir = path.join(sectionsDir(domain), fp.section_id);
  const assetsDirPath = path.join(dir, "assets");
  mkdirSync(assetsDirPath, { recursive: true });

  writeFileSync(path.join(dir, "section.html"), cleanedHtml);
  writeFileSync(path.join(dir, "content.json"), JSON.stringify(fp.content, null, 2));

  let assetMap: Record<string, string> = {};
  if (downloadAssets) {
    const limit = pLimit(assetConcurrency);
    const uniqueSrcs = Array.from(new Set(fp.content.images.map((i) => i.src).filter(Boolean)));
    const results = await Promise.all(
      uniqueSrcs.map((src) =>
        limit(async () => {
          const filename = await downloadAsset(src, assetsDirPath, pageUrl);
          return [src, filename] as const;
        }),
      ),
    );
    for (const [src, filename] of results) {
      if (filename) assetMap[src] = `assets/${filename}`;
    }
  }

  const metadata = {
    section_id: fp.section_id,
    page_url: fp.page_url,
    position_index: fp.position_index,
    dom_path: fp.dom_path,
    tag: fp.tag,
    layout: fp.layout,
    child_count: fp.child_count,
    word_count: fp.word_count,
    image_count: fp.image_count,
    link_count: fp.link_count,
    has_form: fp.has_form,
    has_video: fp.has_video,
    has_carousel: fp.has_carousel,
    has_accordion: fp.has_accordion,
    has_tabs: fp.has_tabs,
    builder_block_type: fp.builder_block_type,
    class_features: fp.class_features,
    asset_map: assetMap,
    // Filled in by Phase 3:
    archetype_id: null,
    archetype_confidence: null,
    page_template_family: null,
    // Filled in by Phase 4 if needed:
    section_screenshot_path: null,
  };
  writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2));

  return { dir, assetCount: Object.keys(assetMap).length };
}
