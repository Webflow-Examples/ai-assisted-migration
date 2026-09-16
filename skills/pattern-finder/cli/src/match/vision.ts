import Anthropic from "@anthropic-ai/sdk";
import type { Archetype, SectionFingerprint } from "../util/types.js";

/**
 * Vision-fallback classifier. v0 is text-mode: we feed Claude the cleaned
 * section HTML + a structural summary plus the archetype library as a
 * multiple-choice list and ask it to pick the best fit. Image input is a
 * future upgrade behind a `--screenshots` flag (requires Playwright).
 *
 * Returns the chosen archetype id (or null = no match) plus a short reason.
 * Confidence is the model's self-reported value; we re-tier downstream.
 */
export interface VisionResult {
  archetype_id: string | null;
  confidence: number;
  reason: string;
  /** True when --dry-run was set: result is synthetic, no API call was made. */
  dryRun: boolean;
}

export interface VisionClassifyOptions {
  fingerprint: SectionFingerprint;
  cleanedHtml: string;
  archetypes: Archetype[];
  /** Top-N DOM candidates from Phase 3, used to focus the prompt. */
  domCandidates: { archetype_id: string; confidence: number }[];
  model?: string;
  dryRun?: boolean;
  /** Truncate HTML to this many chars (cheaper, fits context). */
  htmlCharLimit?: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-5";

export async function classifyWithVision(opts: VisionClassifyOptions): Promise<VisionResult> {
  const { fingerprint, cleanedHtml, archetypes, domCandidates, model = DEFAULT_MODEL, dryRun = false, htmlCharLimit = 6000 } = opts;

  if (dryRun) {
    // Echo the top DOM candidate at a synthetic confidence; flips a few
    // medium-tier matches to "high" so we can see merge logic running.
    const top = domCandidates[0];
    return {
      archetype_id: top?.archetype_id ?? null,
      confidence: top ? Math.min(0.85, top.confidence + 0.1) : 0,
      reason: "dry-run: echoed top DOM candidate",
      dryRun: true,
    };
  }

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL

  const html = cleanedHtml.length > htmlCharLimit ? cleanedHtml.slice(0, htmlCharLimit) + "\n<!-- …truncated -->" : cleanedHtml;
  const summary = summarize(fingerprint);
  const choices = renderChoices(archetypes, domCandidates);

  const sys = `You classify a webpage section into one archetype from a fixed library, or "none" if nothing fits.
Respond with ONLY a JSON object: {"archetype_id": string|null, "confidence": number 0..1, "reason": short string}.
No prose, no markdown.`;

  const user = `## Section structural summary
${summary}

## Top DOM-rule candidates (from rule-based matching)
${domCandidates.map((c) => `- ${c.archetype_id} (${c.confidence.toFixed(2)})`).join("\n") || "(none)"}

## Archetype choices
${choices}

## Cleaned section HTML
\`\`\`html
${html}
\`\`\`

Pick the single archetype_id that best matches, or null if none fit. Prefer the DOM candidates when plausible.`;

  const res = await client.messages.create({
    model,
    max_tokens: 256,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return { ...parseJson(text), dryRun: false };
}

function summarize(fp: SectionFingerprint): string {
  const c = fp.content;
  return [
    `layout: ${fp.layout}`,
    `child_count: ${fp.child_count}`,
    `word_count: ${fp.word_count}`,
    `images: ${fp.image_count}`,
    `links: ${fp.link_count}`,
    `headings: ${c.headings.length}`,
    `has_form: ${fp.has_form}`,
    `has_video: ${fp.has_video}`,
    `has_carousel: ${fp.has_carousel}`,
    `has_accordion: ${fp.has_accordion}`,
    `has_tabs: ${fp.has_tabs}`,
    `builder_block_type: ${fp.builder_block_type ?? "none"}`,
    `position_index: ${fp.position_index}`,
    fp.dom_path ? `dom_path: ${fp.dom_path}` : "",
  ].filter(Boolean).join("\n");
}

function renderChoices(all: Archetype[], domCandidates: { archetype_id: string }[]): string {
  // Put DOM candidates first, then the remaining archetypes by category.
  const candidateIds = new Set(domCandidates.map((c) => c.archetype_id));
  const ordered = [
    ...all.filter((a) => candidateIds.has(a.id)),
    ...all.filter((a) => !candidateIds.has(a.id)),
  ];
  return ordered.map((a) => `- ${a.id} — ${a.display_name}: ${a.description}`).join("\n");
}

function parseJson(text: string): { archetype_id: string | null; confidence: number; reason: string } {
  // Tolerate fenced code blocks just in case.
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const j = JSON.parse(stripped);
    return {
      archetype_id: typeof j.archetype_id === "string" ? j.archetype_id : null,
      confidence: typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0,
      reason: typeof j.reason === "string" ? j.reason : "",
    };
  } catch {
    return { archetype_id: null, confidence: 0, reason: `parse-failed: ${stripped.slice(0, 120)}` };
  }
}
