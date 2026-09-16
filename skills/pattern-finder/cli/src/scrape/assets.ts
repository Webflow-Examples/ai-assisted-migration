import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const USER_AGENT =
  "Mozilla/5.0 (compatible; AI-Migration-Bot/0.1; +https://github.com/webflow/ai-migration)";

/**
 * Download a single asset (image/icon) into `destDir`. Returns the relative
 * filename written, or null on failure. Filename is derived from the source
 * URL's basename plus a short content hash to avoid collisions when two
 * sections reference different files of the same name.
 *
 * Failures are non-fatal: a missing image must not break a bundle.
 */
export async function downloadAsset(
  assetUrl: string,
  destDir: string,
  pageUrl: string,
  timeoutMs = 15_000,
): Promise<string | null> {
  let resolved: URL;
  try {
    resolved = new URL(assetUrl, pageUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(resolved.protocol)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resolved.toString(), {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());

    const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8);
    const baseName = sanitize(path.basename(resolved.pathname) || "asset");
    const ext = path.extname(baseName) || extFromContentType(res.headers.get("content-type"));
    const stem = path.basename(baseName, path.extname(baseName)) || "asset";
    const filename = `${stem}.${hash}${ext}`;

    const fullPath = path.join(destDir, filename);
    if (!existsSync(fullPath)) writeFileSync(fullPath, buf);
    return filename;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}

function extFromContentType(ct: string | null): string {
  if (!ct) return "";
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("svg")) return ".svg";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  return "";
}
