import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Repo root resolved relative to this file.
 * src/util/paths.ts → ../../  = repo root
 */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Resolve the output directory for a given domain. Creates it if missing.
 */
export function outputDir(domain: string): string {
  const dir = path.join(REPO_ROOT, "output", domain);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a path inside the output directory for a domain.
 */
export function outputPath(domain: string, ...parts: string[]): string {
  return path.join(outputDir(domain), ...parts);
}

/**
 * Resolve a path inside the sections subdirectory for a domain.
 */
export function sectionsDir(domain: string): string {
  const dir = path.join(outputDir(domain), "sections");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve the path for a specific section bundle directory.
 * Creates the directory if missing.
 */
export function sectionBundleDir(domain: string, archetypeId: string, n: number): string {
  const slug = `${archetypeId}__${String(n).padStart(3, "0")}`;
  const dir = path.join(sectionsDir(domain), slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve the archetypes directory (relative to repo root).
 */
export const ARCHETYPES_DIR = path.join(REPO_ROOT, "src", "archetypes");
