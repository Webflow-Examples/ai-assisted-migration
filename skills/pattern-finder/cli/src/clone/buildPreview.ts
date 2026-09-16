import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { outputPath } from "../util/paths.js";
import { info, step } from "../util/log.js";

export interface BuildPreviewOptions {
  domain: string;
}

/**
 * Wrap each per-Component clone HTML fragment in a full standalone HTML
 * document so it can be opened directly in a browser for visual preview
 * BEFORE pasting into Webflow. Also writes an `index.html` page that lists
 * all Components with iframe previews side-by-side.
 *
 * Output: `output/<domain>/clones/preview/`
 *   - 01-<archetype>.html ... 12-<archetype>.html  (standalone docs)
 *   - all-clones.html                                (combined standalone doc)
 *   - index.html                                     (gallery + iframes)
 */
export async function runBuildPreview(opts: BuildPreviewOptions): Promise<{ files: number; indexPath: string }> {
  const { domain } = opts;
  step("phase 7c-preview", `wrap clones into browseable preview docs for ${domain}`);

  const clonesDir = path.join(outputPath(domain), "clones");
  if (!existsSync(clonesDir)) {
    throw new Error(`clones/ not found for ${domain} — run \`ai-migrate clone-export\` first`);
  }
  const previewDir = path.join(clonesDir, "preview");
  mkdirSync(previewDir, { recursive: true });

  const cloneFiles = readdirSync(clonesDir)
    .filter((f) => /^\d{2}-.*\.html$/.test(f) || f === "all-clones.html")
    .sort();

  let written = 0;
  const items: { file: string; title: string }[] = [];
  for (const f of cloneFiles) {
    const fragment = readFileSync(path.join(clonesDir, f), "utf8");
    const title = f === "all-clones.html"
      ? "All clones (combined paste payload)"
      : f.replace(/^\d{2}-/, "").replace(/\.html$/, "").replace(/-/g, " ");
    const wrapped = wrapStandalone(title, fragment);
    writeFileSync(path.join(previewDir, f), wrapped);
    items.push({ file: f, title });
    written += 1;
  }

  const indexPath = path.join(previewDir, "index.html");
  writeFileSync(indexPath, buildIndex(domain, items));
  written += 1;

  info(`wrote ${previewDir}`, { files: written });
  return { files: written, indexPath };
}

/**
 * Wrap a bare-fragment clone (`<style>` + `<div>`) in a complete HTML
 * document. Adds a viewport meta, web-font preload, and a tiny preview
 * banner at top so the user knows what they're looking at.
 */
function wrapStandalone(title: string, fragment: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1280">
  <title>Preview — ${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    /* Preview chrome — NOT exported. Just a banner so users know this is a preview. */
    html, body { margin: 0; padding: 0; }
    body { background: #fff; }
    #__preview-banner {
      position: sticky;
      top: 0;
      z-index: 99999;
      background: #1a1a1a;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      padding: 8px 16px;
      display: flex;
      gap: 12px;
      align-items: center;
      border-bottom: 1px solid #333;
    }
    #__preview-banner strong { font-weight: 600; }
    #__preview-banner span { opacity: 0.7; }
    #__preview-content { width: 1280px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="__preview-banner">
    <strong>Preview:</strong> ${escapeHtml(title)}
    <span>· This is what your clone will look like before pasting into Webflow</span>
  </div>
  <div id="__preview-content">
    ${fragment}
  </div>
</body>
</html>
`;
}

/** Index page listing all preview docs as clickable cards. */
function buildIndex(domain: string, items: { file: string; title: string }[]): string {
  const cards = items
    .map(
      (it) => `
    <a class="card" href="./${it.file}" target="_blank">
      <div class="card-num">${it.file.match(/^(\d{2})/)?.[1] ?? "—"}</div>
      <div class="card-title">${escapeHtml(it.title)}</div>
      <div class="card-file">${escapeHtml(it.file)}</div>
    </a>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI Migration Preview — ${escapeHtml(domain)}</title>
  <style>
    body { margin: 0; padding: 32px; background: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; }
    h1 { margin: 0 0 8px; font-size: 28px; font-weight: 600; }
    .sub { color: #666; margin-bottom: 32px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; max-width: 1200px; }
    .card {
      display: block;
      background: #fff;
      border-radius: 8px;
      padding: 20px;
      text-decoration: none;
      color: inherit;
      border: 1px solid #e5e5e5;
      transition: border-color 0.15s, transform 0.15s;
    }
    .card:hover { border-color: #1a1a1a; transform: translateY(-2px); }
    .card-num { font-size: 11px; color: #999; font-weight: 600; letter-spacing: 1px; }
    .card-title { font-size: 16px; font-weight: 600; margin: 4px 0 6px; text-transform: capitalize; }
    .card-file { font-family: monospace; font-size: 11px; color: #888; }
  </style>
</head>
<body>
  <h1>AI Migration → Webflow clones</h1>
  <div class="sub">Domain: <code>${escapeHtml(domain)}</code> · Click any Component to preview before pasting.</div>
  <div class="grid">${cards}
  </div>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
