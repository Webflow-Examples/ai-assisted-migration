import type {
  Archetype,
  ArchetypeDOMRules,
  ArchetypeContentRules,
  ArchetypeGates,
  SectionFingerprint,
  ArchetypeMatch,
} from "../util/types.js";

interface RuleResult {
  passed: number;
  total: number;
  evidence: string[];
}

/**
 * Score a single section against a single archetype using the deterministic
 * rule schema. Returns confidence in [0,1] plus an evidence trail. Each
 * rule is binary (pass/fail) and contributes equally within its side
 * (dom vs content); sides are combined via the archetype's weights.
 *
 * Sections that lack any matching rules from a side score 0 on that side
 * — the weights still apply, so an archetype that defines no DOM rules
 * effectively becomes content-only.
 */
export function scoreArchetype(
  fp: SectionFingerprint,
  archetype: Archetype,
): ArchetypeMatch {
  // Hard gates: if any defined gate fails, this archetype is impossible.
  const gateResult = checkGates(fp, archetype.match_rules.gates);
  if (!gateResult.passed) {
    return {
      archetype_id: archetype.id,
      confidence: 0,
      source: "dom",
      evidence: { gates_failed: gateResult.failed },
    };
  }

  const dom = scoreDom(fp, archetype.match_rules.dom);
  const content = scoreContent(fp, archetype.match_rules.content);

  const w = archetype.confidence_weights;
  // Weighted score with a "minimum rule count" floor: archetypes that
  // define fewer than MIN_RULES total rules get padded with imaginary
  // failed rules so they can't trivially hit 1.0 by passing 2 generic
  // checks. The floor is in *rule* units (each padding rule contributes
  // the average weight of dom & content sides).
  const MIN_RULES = 5;
  const totalRules = dom.total + content.total;
  const padding = Math.max(0, MIN_RULES - totalRules);
  const avgWeight = (w.dom + w.content) / 2;

  const passed = w.dom * dom.passed + w.content * content.passed;
  const observedTotal = w.dom * dom.total + w.content * content.total;
  const denom = observedTotal + padding * avgWeight;
  const confidence = denom === 0 ? 0 : Math.min(1, passed / denom);

  return {
    archetype_id: archetype.id,
    confidence,
    source: "dom",
    evidence: {
      dom: { passed: dom.passed, total: dom.total, hits: dom.evidence },
      content: { passed: content.passed, total: content.total, hits: content.evidence },
    },
  };
}

function checkGates(fp: SectionFingerprint, gates: ArchetypeGates | undefined): { passed: boolean; failed: string[] } {
  const failed: string[] = [];
  if (!gates) return { passed: true, failed };

  const classes = fp.class_features.join(" ").toLowerCase();
  const block = (fp.builder_block_type ?? "").toLowerCase();
  const role = `${fp.dom_path} ${fp.tag}`.toLowerCase();

  if (gates.section_role_hints?.length && !gates.section_role_hints.some((h) => role.includes(h.toLowerCase()))) {
    failed.push("section_role_hints");
  }
  if (gates.must_contain_class_any?.length && !gates.must_contain_class_any.some((c) => classes.includes(c.toLowerCase()))) {
    failed.push("must_contain_class_any");
  }
  if (gates.builder_block_type_any?.length && !gates.builder_block_type_any.some((b) => block.includes(b.toLowerCase()))) {
    failed.push("builder_block_type_any");
  }
  if (gates.child_layout_any?.length && !gates.child_layout_any.includes(fp.layout)) {
    failed.push("child_layout_any");
  }
  if (gates.must_have) {
    for (const [k, v] of Object.entries(gates.must_have) as [string, boolean][]) {
      if ((fp as unknown as Record<string, boolean>)[k] !== v) failed.push(`must_have.${k}`);
    }
  }
  if (gates.position_index_max !== undefined && fp.position_index > gates.position_index_max) failed.push("position_index_max");
  if (gates.position_index_min !== undefined && fp.position_index < gates.position_index_min) failed.push("position_index_min");
  if (gates.word_count_min !== undefined && fp.word_count < gates.word_count_min) failed.push("word_count_min");
  if (gates.word_count_max !== undefined && fp.word_count > gates.word_count_max) failed.push("word_count_max");
  if (gates.image_count_min !== undefined && fp.image_count < gates.image_count_min) failed.push("image_count_min");
  if (gates.image_count_max !== undefined && fp.image_count > gates.image_count_max) failed.push("image_count_max");
  if (gates.heading_count_min !== undefined && fp.content.headings.length < gates.heading_count_min) failed.push("heading_count_min");
  if (gates.link_count_min !== undefined && fp.link_count < gates.link_count_min) failed.push("link_count_min");
  if (gates.link_count_max !== undefined && fp.link_count > gates.link_count_max) failed.push("link_count_max");

  return { passed: failed.length === 0, failed };
}

function scoreDom(fp: SectionFingerprint, rules: ArchetypeDOMRules | undefined): RuleResult {
  const r: RuleResult = { passed: 0, total: 0, evidence: [] };
  if (!rules) return r;

  if (rules.section_role_hints?.length) {
    r.total += 1;
    const hay = `${fp.dom_path} ${fp.tag}`.toLowerCase();
    const hit = rules.section_role_hints.find((h) => hay.includes(h.toLowerCase()));
    if (hit) {
      r.passed += 1;
      r.evidence.push(`role_hint:${hit}`);
    }
  }

  if (rules.child_layout?.length) {
    r.total += 1;
    if (rules.child_layout.includes(fp.layout)) {
      r.passed += 1;
      r.evidence.push(`layout:${fp.layout}`);
    }
  }

  if (rules.must_contain_class?.length) {
    r.total += 1;
    const features = fp.class_features.join(" ").toLowerCase();
    const hit = rules.must_contain_class.find((c) => features.includes(c.toLowerCase()));
    if (hit) {
      r.passed += 1;
      r.evidence.push(`class:${hit}`);
    }
  }

  if (rules.builder_block_type_includes?.length) {
    r.total += 1;
    const block = (fp.builder_block_type ?? "").toLowerCase();
    const hit = rules.builder_block_type_includes.find((b) => block.includes(b.toLowerCase()));
    if (hit) {
      r.passed += 1;
      r.evidence.push(`block:${hit}`);
    }
  }

  if (rules.child_count_range) {
    r.total += 1;
    const [min, max] = rules.child_count_range;
    if (fp.child_count >= min && fp.child_count <= max) {
      r.passed += 1;
      r.evidence.push(`child_count:${fp.child_count}`);
    }
  }

  if (rules.must_have) {
    for (const [k, v] of Object.entries(rules.must_have) as [keyof typeof rules.must_have, boolean][]) {
      r.total += 1;
      if ((fp as unknown as Record<string, boolean>)[k] === v) {
        r.passed += 1;
        r.evidence.push(`flag:${k}=${v}`);
      }
    }
  }

  return r;
}

function scoreContent(fp: SectionFingerprint, rules: ArchetypeContentRules | undefined): RuleResult {
  const r: RuleResult = { passed: 0, total: 0, evidence: [] };
  if (!rules) return r;

  const c = fp.content;

  if (rules.min_words !== undefined) {
    r.total += 1;
    if (fp.word_count >= rules.min_words) {
      r.passed += 1;
      r.evidence.push(`words>=${rules.min_words}`);
    }
  }
  if (rules.max_words !== undefined) {
    r.total += 1;
    if (fp.word_count <= rules.max_words) {
      r.passed += 1;
      r.evidence.push(`words<=${rules.max_words}`);
    }
  }
  if (rules.min_images !== undefined) {
    r.total += 1;
    if (fp.image_count >= rules.min_images) {
      r.passed += 1;
      r.evidence.push(`images>=${rules.min_images}`);
    }
  }
  if (rules.max_images !== undefined) {
    r.total += 1;
    if (fp.image_count <= rules.max_images) {
      r.passed += 1;
      r.evidence.push(`images<=${rules.max_images}`);
    }
  }
  if (rules.min_links !== undefined) {
    r.total += 1;
    if (fp.link_count >= rules.min_links) {
      r.passed += 1;
      r.evidence.push(`links>=${rules.min_links}`);
    }
  }
  if (rules.max_links !== undefined) {
    r.total += 1;
    if (fp.link_count <= rules.max_links) {
      r.passed += 1;
      r.evidence.push(`links<=${rules.max_links}`);
    }
  }
  if (rules.min_headings !== undefined) {
    r.total += 1;
    if (c.headings.length >= rules.min_headings) {
      r.passed += 1;
      r.evidence.push(`headings>=${rules.min_headings}`);
    }
  }
  for (const flag of ["has_form", "has_video", "has_carousel", "has_accordion", "has_tabs"] as const) {
    if (rules[flag] !== undefined) {
      r.total += 1;
      if ((fp as unknown as Record<string, boolean>)[flag] === rules[flag]) {
        r.passed += 1;
        r.evidence.push(`${flag}=${rules[flag]}`);
      }
    }
  }

  return r;
}
