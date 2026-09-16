---
name: webflow-builder
description: >
  Webflow-aware component building skill. Use this EVERY TIME a user asks to
  build, create, design, or generate any UI component, section, or layout for
  a Webflow project — whether starting from existing styles, net new, or a
  mix. Manages a main CSS file per project, a local existing CSS snapshot,
  and a preview HTML workflow with a built-in style panel. MCP is used
  read-only for context only — never to build directly in Webflow. Trigger on
  any mention of Webflow, components, sections, layouts, styles, classes, UI
  building, or migration.
---

# Webflow Builder

This skill manages a structured, iterative component build process for Webflow projects. It produces clean, Webflow-compatible HTML and CSS — never building directly in Webflow via MCP. MCP and stylesheet crawling are for context gathering only.

---

## Session Onboarding

**Always deliver this at the very start of a new chat before asking anything else.** Set expectations upfront so the user understands the workflow and limitations before investing time in the session.

> 👋 **Welcome to the Webflow Builder.**
>
> Before we dive in, here's how this works and what to expect:
>
> **What we'll do together:**
> - Pull your existing Webflow styles as context (via Ares context file, stylesheet URL, file upload, or MCP)
> - Build fully responsive, Webflow-compatible HTML + CSS components
> - Preview everything locally with a style panel showing exactly what's reused vs. new
> - Approve new styles before they're added to your local design system
> - Export a clean bare-fragment code block — copy and paste directly into Webflow, no file needed
>
> **Recommended workflow:**
> - If you have the Ares extension open in Webflow Designer, export a context file from the Design Context tab — it gives me styles, variables, components, and page structure all at once
> - Keep one chat per project — this keeps your style context clean and focused
> - At the end of each session, **download the generated `[site]-main.css`** — it contains your approved design system and you'll want to re-upload it at the start of your next session to pick up where you left off
> - If you're working with a team, share that `main.css` file so everyone starts from the same context
>
> **Limitations to know:**
> - ⚠️ **This chat is session-local** — nothing persists when you close it. Files generated here exist only in this conversation.
> - ⚠️ **No automatic team sync** — if multiple people are building in separate chats, their local design systems won't stay in sync automatically. Share the `main.css` file manually between sessions.
> - ⚠️ **MCP requires Webflow Designer to be open** — if you want to pull styles via MCP, keep your Webflow Designer tab active and in the foreground.
> - 💡 **For persistent, team-wide state**, a Claude Code + GitHub workflow is recommended (ask me about this if you're interested).
>
> **Ready? Let's start by figuring out what we're building and where your styles are coming from.**

---

## Core File Model

Every project maintains three files. Understand these before doing anything:

```
[site]-existing.css   — Snapshot of all styles currently in Webflow.
                        Read-only. Never modified by the build process.
                        Used only for local preview rendering and reuse decisions.

[site]-main.css     — The living project design system.
                        Starts as a copy of existing.css (or empty for net-new).
                        Grows as new styles are approved after each component build.
                        This is what Webflow "knows about" after migration.

[component]-new.css   — Net-new styles introduced for the current component only.
                        Styles not yet in main.css.
                        Cleared/reset each new component build.
```

**Preview HTML** links both `[site]-existing.css` and `[component]-new.css` — full fidelity rendering for iteration.

**Export** is a bare HTML+CSS fragment delivered as a code block in chat — new CSS only in a `<style>` tag, existing class names remain on elements. Copy and paste directly into Webflow. A separate JS block is included if the component requires it.

---

## Step 0 — Session Start: Ask Mode + Gather Context

At the start of every session (or when a new project is introduced), ask all questions together in a single message. If the user says skip or just build — respect it immediately, no pushback.

### 0 — Context File Check

Bundle this into the same opening message as 0a/0b/0c.

**If a context file is attached with the initial prompt:**

> "I see you've attached a context file exported from the Ares extension. Would you like me to use this as your design context instead of pulling styles via MCP or stylesheet?
>
> - **Yes, use this file** — I'll parse it for styles, variables, components, and page structure. No MCP or stylesheet crawl needed.
> - **No, use MCP / stylesheet** — I'll ignore the file and pull context the usual way."

**If no context file is attached:**

Ask this as part of the opening question bundle:

> "Do you have a context file from the Ares extension? If so, upload it now and I can skip the MCP/stylesheet step entirely — it contains your full design system: styles, variables, components, and page structure.
>
> If you don't have one, no problem — we'll pull context via MCP or your stylesheet URL as usual."

### 0a. Build Mode — REQUIRED ask

> **"Before I start, I need to know: are we working with existing Webflow styles or starting net new?**
>
> - **Existing styles** — I'll pull your current Webflow stylesheet and reuse your existing classes wherever they fit. Where nothing matches, I'll create new classes that follow your established naming conventions and design tokens.
> - **Net new** — We start fresh from a prompt, image, or HTML example. New styles will seed the main CSS file
>

#### If Existing:

Ask for the stylesheet source:

> **"To pull your existing styles, share one of these:**
> - **Ares context file** — export from the Design Context tab in the Ares extension; includes styles, variables, components, and page structure all at once
> - **Upload the CSS file**
> - **Paste the CSS**
> - **MCP** — if your Webflow Designer tab is open, I can pull styles directly
> - **CSS URL** — e.g. `https://your-site.webflow.io/css/your-site.webflow.css` works for any Webflow CSS file URL, but large stylesheets may be truncated
>
> To find your CSS URL: open your staging site in Chrome → View Page Source → find the `<link>` tag ending in `.webflow.css`."

Once the source is provided, proceed to Step 1 to build `[site]-existing.css`.

#### If Net New:

No stylesheet needed. Skip to Step 2. Naming conventions will be inferred from the prompt/image/example and confirmed at the approval step.

### 0b. Design System Adherence — REQUIRED ask (Existing only)

When existing styles are present, ask explicitly:

> **"Should this component adhere to your existing design system — using your established fonts, colors, and spacing as-is — or are you looking to introduce something new stylistically?**
>
> - **Adhere** — I'll inherit fonts, colors, and spacing from your existing styles. Only layout will be net-new
> - **Introduce something new** — I'll diverge stylistically where needed and flag what's changing and why"

**Default is Adhere** if the user skips this question.

**When adhering:**
- Pull font families, sizes, and weights directly from existing/main.css — never invent new type styles
- Pull colors exclusively from existing/main.css — no new color values unless explicitly requested
- Match the spacing scale already present (padding, margin, gap values)
- Only layout, composition, and structure are net-new variables
- New classes should be primarily structural — use combo classes to borrow style properties from existing classes wherever possible

**When introducing something new:**
- Document clearly what is diverging from the existing design system and why
- Flag divergent styles in the style panel with a ⚠️ indicator
- These are strong candidates for design system review at the approval step

### 0d. Component Usage — optional ask

> **"Would you like me to use existing Webflow components (nav, footer, buttons, etc.) as references in the build rather than rebuilding them from scratch?"**
>
> - **Yes** — I'll catalog your site's components and reference them as placeholders. They'll be inserted as real component instances when you import via the Ares extension.
> - **No** — I'll build everything from scratch as standalone markup.

**Default is No** if the user skips this question. Component usage is opt-in.

### 0e. Component Catalog (only if 0d = Yes)

When the user opts in to component usage, build a **Component Registry** from available sources:

**When MCP is connected:** use `data_components_tool > list_components` to enumerate site components, noting ID and name.

**When page HTML is provided:** identify component instances from page structure — elements with component markers, repeated global patterns like nav/footer.

Output a **Component Registry** table with scope classification:

| Name | Component ID | Scope | Role |
|------|-------------|-------|------|
| Primary Nav | abc123 | **page-level** | navigation |
| Footer | def456 | **page-level** | footer |
| Global Code | ghi789 | **page-level** | code embed |
| CTA Button | jkl012 | **element-level** | button |
| Card | mno345 | **element-level** | content block |

**Scope rules:**
- **Page-level** components (nav, footer, global code, hero headers) — only referenced when building **full pages or page sections**. Not used when building individual elements/components.
- **Element-level** components (buttons, cards, form groups, CTAs) — can be referenced in **any build**, including when building other components or sections.

The user confirms the registry and can reclassify any component's scope.

Maintain a `COMPONENT_REFS` list alongside `EXISTING_CLASSES` and `NEW_CLASSES` throughout the build to track which components are referenced.

### 0c. Page Context — REQUIRED ask, optional to provide

Ask alongside 0a and 0b:

> **"Is there a page I can reference for layout structure — nesting patterns, spacing rhythm, how classes are combined in practice? If so share one of the following:**
>
> - **Production URL** — a published page on your custom domain; I'll fetch the HTML structure
> - **Upload or paste the page HTML** — works for any page including staging; grab it from browser dev tools (right-click → Save as) or View Page Source
> - **MCP** — if Designer is open, I can read the page structure directly via `data_pages_tool`
> - **Describe it** — tell me the layout pattern and I'll infer from there
> - **Skip** — no reference needed, building fresh
>
> Note: Webflow staging URLs (`*.webflow.io`) are blocked by robots.txt — they won't load for me directly."

If a production URL is provided, fetch the page HTML to extract: class combinations used in practice, nesting depth, spacing rhythm, combo class patterns.

If HTML is uploaded or pasted, parse it the same way.

If MCP is available, use `data_pages_tool > get_page_content` to read structure directly.

If skipped, proceed without it.

---

## Step 1 — Refresh Style Context (every component build)

**This step runs at the start of every new component build — not just session start.** The main.css grows with each approval and the Webflow project may have changed, so both need to be in sync before building.

### 1a. CSS Refresh Checkpoint

Ask at the start of every new component build:

> **"Before I start building, let's make sure I have the latest styles. How would you like to refresh the CSS context?**
>
> - **Ares context file** — re-export from the Design Context tab and upload here
> - **Re-crawl** — I'll re-fetch your stylesheet URL to catch any changes published in Webflow since last time
> - **Manual update** — paste or upload any new/changed classes you want me to know about, and I'll merge them into the local context
> - **MCP scan** — if your Webflow Designer tab is open, I'll pull the latest styles directly
> - **Skip** — use the existing local context as-is (only recommended if nothing has changed)"

Once the user responds, proceed with the chosen method before doing anything else.

**On Ares context file:** parse styles, variables, components, and page structure from the single Markdown file. Skip individual MCP calls — the file already contains everything those calls would return. Use the style definitions to build `[site]-existing.css`. Pre-populate the Component Registry (Step 0e) from the file's component section if component usage is enabled. Note source as "Ares context file" in the existing.css header comment.

**On re-crawl:** fetch the stylesheet URL fresh, re-parse, and update `[site]-existing.css`. Then diff against `[site]-main.css` — if new classes appear in existing.css that aren't in main.css yet, flag them:

> "I found [N] new classes in your stylesheet that aren't in main.css yet: `.new-class-a`, `.new-class-b`. Want me to add them to main.css before we build?"

**On manual update:** parse the provided classes, merge into the local context, note what was added.

**On MCP scan:** use `style_tool > get_styles` with `include_all_breakpoints: true, skip_properties: false`. MCP is read-only — never write anything. Diff and flag new classes as above.

**On skip:** proceed with current local context. Note that new classes added in Webflow since the last crawl won't be available for reuse.

### 1b. Parse & Categorize

For every class, capture all property values and assign a category:

- `font-*`, `color`, `letter-spacing`, `line-height` → **typography**
- `display`, `flex-*`, `grid-*`, `width`, `height`, `position` → **layout**
- `background-color`, `border-color` only → **color**
- `margin-*`, `padding-*` only → **spacing**
- Mixed properties → **component**

Skip Webflow utility classes (`.w-nav`, `.w-container`, `.w-layout-grid`, etc.) — catalog separately, never replicate.

### 1c. Detect Naming Framework

Analyze all class names against the detection patterns in `references/framework-docs.json`. For each framework in the JSON, check:

1. **Prefixes** — do class names start with the framework's `prefixes` (e.g., `fk-`, `c-`, `rl-`, `mast-`, `lumos-`)?
2. **Script fingerprints** — do any embedded scripts or custom attributes contain the framework's `detection.scriptFingerprints` strings?
3. **Component patterns** — do class names or component names match the framework's `detection.componentPatterns` regexes?

Score each framework by how many pattern categories match. Present the **best match** with confidence reasoning:

> **"Based on your class names, I'm detecting [Framework Name] ([documentation URL from JSON]). Evidence: [list matching patterns, e.g., 'found `fk-` prefixes and Flowkit script fingerprints']. I'll follow this naming pattern for all new classes — does that sound right, or would you like to use a different framework?"**

If no framework scores strongly, flag it as **Custom / unknown** — note the dominant casing style (kebab-case, camelCase, BEM) and any prefix/suffix patterns found.

Options to offer if they want to pivot:
- Flowkit
- Client-First (recommended default, most widely adopted in Webflow)
- Relume
- Mast
- Lumos
- BEM
- SMACSS
- CUBE CSS
- Tailwind
- Custom — describe it and I'll follow it

After the user confirms, adopt the chosen framework's `comboClassPattern` and `componentNaming` convention from `references/framework-docs.json` as the active naming rules for the session.

### 1d. Net New — No Existing Framework

When building net-new with no stylesheet to reference, **default to Client-First** but confirm before proceeding:

> **"Since we're starting fresh, I'll default to Client-First naming conventions — the most widely adopted Webflow framework. It uses utility-style prefixes (`padding-`, `text-`, `heading-`) and `is-` for state modifiers.**
>
> **Stick with Client-First, or would you prefer a different convention?**"

Options: Flowkit, Client-First, Relume, Mast, Lumos, BEM, SMACSS, CUBE CSS, Tailwind, or Custom.

After selection, adopt the chosen framework's `comboClassPattern` and `componentNaming` convention from `references/framework-docs.json` as the active naming rules for the session.

### 1e. Layout-First Naming — HARD RULE

**Every new class name must describe the layout pattern or structural role — never the content, subject matter, or page context it currently holds.**

This is not a style preference. It is a firm rule applied before any class name is written. A class name that describes content is always wrong, even if the user's prompt uses content language.

#### The test — ask this before naming anything:

> *"If I moved this element to a completely different page with different content, would this class name still make sense?"*

If no → rename it. A class name that only works in one content context is a content name, not a layout name.

#### Name-by-structure, not by subject:

```
The prompt says...          ❌ Content name (never use)    ✅ Layout name (always use)
"team photo gallery"        .team-gallery                  .grid-three-col
"marketing hero"            .marketing-hero                .hero-split
"product feature row"       .product-features              .feature-row
"blog post cards"           .blog-cards                    .card-row
"client logo strip"         .client-logos                  .logo-strip
"about page intro"          .about-intro                   .section-intro
"services list"             .services-list                 .list-three-col
```

When a user describes what the content *is*, translate it into what the layout *does*. Strip the subject, keep the structure.

#### Naming hierarchy for every new component:

```
1. Layout wrapper   → the container's structural pattern
                      e.g. .grid-three-col, .hero-split, .feature-row, .card-row

2. Layout children  → positional/structural role within the parent
                      e.g. .grid-three-col_item, .hero-split_media, .feature-row_text

3. Content slots    → content type, not subject matter
                      e.g. .hero-split_eyebrow, .card-row_body, .feature-row_icon

4. Typography       → pulled from existing main.css first
                      e.g. .heading-style-h3, .text-size-medium

5. Utilities        → pulled from existing main.css first
                      e.g. .padding-large, .margin-0, .is-active
```

Content-specific state modifiers (`.is-featured`, `.is-dark`, `.is-active`) are allowed **only as combo classes on top of a layout base class**. They must never appear as the primary class.

#### Framework convention takes priority over everything:

Once a naming framework is confirmed (Step 1c/1d), **all new class names must follow that framework's conventions exactly** — prefix patterns, separator style, combo class syntax, utility naming. If the active framework is Client-First, names follow Client-First. If it's Flowkit, names follow Flowkit. Never mix conventions mid-component or default to a different pattern because it "feels more natural."

If a name can't be reconciled with the active framework's conventions, flag it explicitly:

> "I'd name this `.grid-three-col` under Client-First conventions — does that work, or would you like a different name?"

#### Enforcement — before writing any CSS:

For every proposed new class name, run this check internally:

1. Does the name describe a layout pattern or structural role? → ✅ proceed
2. Does the name contain a subject, topic, page name, or content type? → ❌ rename before writing CSS
3. Does the name follow the active framework's conventions? → ✅ proceed / ❌ fix first

Never ship a class name that fails steps 1 or 3. Never ask the user to approve a content-named class.

### 1f-guardrail. Flexbox-First Layout Rule — HARD RULE

**Never use `display: grid` or any `grid-*` properties when the layout can be achieved with flexbox.**

This is a firm guardrail, not a preference. Flexbox must be the default for all layout decisions. CSS Grid is only permitted when a layout is genuinely two-dimensional in a way flexbox cannot handle — e.g. overlapping cells, named template areas, or strict row-AND-column alignment that would require brittle flexbox hacks.

**Before using any grid property, ask:** *Can this be done with flexbox?* If yes — use flexbox.

```
✅ Use flexbox for:                         ❌ Do NOT use grid for:
Row or column layouts                       Single-axis lists or rows
Wrapping tag clouds / pill lists            Card rows (flex-wrap handles this)
Centering anything                          Side-by-side two-column layouts
Nav bars, toolbars, footers                 Any layout a single flex container handles
Stacked content blocks
Card layouts with flex-wrap

✅ Grid is only acceptable for:
True 2D grids where both row AND column
placement must be controlled simultaneously
```

If the user's prompt or reference image implies a grid-like layout, always reach for `flex-wrap: wrap` or nested flex containers first. Only escalate to grid if flex genuinely cannot produce the result without hacky workarounds.

### 1f. Write `[site]-existing.css`

Output a well-organized CSS file with all parsed classes, grouped by category, with a comment header:

```css
/* ============================================================
   [site]-existing.css
   Snapshot of existing Webflow styles — READ ONLY
   Generated: [date]
   Source: [url or "MCP" or "uploaded file" or "Ares context file"]
   Framework: [detected framework]
   DO NOT EDIT — this file is for local preview only
   ============================================================ */

/* Typography */
.heading-1 { ... }
...

/* Layout */
.section-wrap { ... }
...
```

If `[site]-main.css` doesn't exist yet, create it as an exact copy of `[site]-existing.css` at this point.

### 1g. Report Design System Summary

```
📋 [site]-existing.css built — 41 classes

Framework:         Client-First ✓ (confirmed) — https://finsweet.com/client-first/docs
Naming convention: utility prefixes (padding-, text-, heading-) + is- modifiers
Combo pattern:     c-[component].cc-[modifier]
Layout-first:      enabled — all new classes will describe structure, not content

Typography (12):   .heading-style-h1, .heading-style-h2, .text-size-medium ...
Layout (8):        .section-wrap, .container, .grid-2col ...
Component (15):    .btn-primary, .card, .nav-link ...
Utilities (6):     .padding-large, .margin-0, .background-color-black ...

[site]-main.css initialized ✓

Ready to build. What are we making?
```

---

## Step 2 — The Reuse-First Decision Tree

**Run this on every style decision before writing any CSS.** Reference `[site]-main.css` — not just existing.css, as main may already contain approved new styles from previous builds.

Before running the tree, plan the full component layout structure and name all new classes using the layout-first principle (Step 1e). Class names must be settled *before* any CSS is written.

### Component Check (only when component usage is enabled)

Before the class-matching tree, check the Component Registry first:

```
Is the element a known component from the registry?
│
├─ YES, element-level → Reference as placeholder. Add to COMPONENT_REFS list.
│
├─ YES, page-level
│   └─ Are we building a full page/section?
│       ├─ YES → Reference as placeholder. Add to COMPONENT_REFS list.
│       └─ NO  → Skip. Build normally or omit.
│
└─ NO  → Proceed with class reuse-first tree below.
```

### Class Reuse Tree

```
Does a class in main.css match the needed visual rules?
│
├─ YES → USE the existing class. Write nothing new.
│         Add to EXISTING_CLASSES list.
│
├─ CLOSE (same base, 1–3 property overrides needed)
│   └─ USE main class as base + new combo class for the delta only.
│       Combo name describes the modifier: "is-large", "is-dark", "on-hero"
│       Follow the inferred naming convention.
│       Add base to EXISTING_CLASSES, combo to NEW_CLASSES.
│
└─ NO (genuinely different role, no close match)
    └─ CREATE a new class.
        Follow the inferred naming convention.
        Note why no existing class was reusable.
        Add to NEW_CLASSES.
```

Maintain three lists throughout the build:
- `EXISTING_CLASSES` — classes from main.css reused as-is or as combo bases
- `NEW_CLASSES` — net-new classes not yet in main.css
- `COMPONENT_REFS` — components from the registry referenced as placeholders (only when component usage is enabled)

---

## Step 3 — Build the Component

Build the HTML markup and `[component]-new.css` containing only `NEW_CLASSES`.

### Responsive Rules — Desktop Down (Webflow's cascade model)

Webflow is **not mobile-first**. Styles cascade from desktop downward. Always follow this model:

- **Desktop is the base** — all styles written at the main breakpoint first, no media query
- **Override downward** with `@media max-width` only — never use `min-width`
- Breakpoint order: Desktop → Tablet → Mobile Landscape → Mobile Portrait

```css
/* Desktop — base (no media query) */
.feature-card { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }

/* Tablet ≤ 991px */
@media (max-width: 991px) {
  .feature-card { grid-template-columns: 1fr; gap: 32px; }
}

/* Mobile Landscape ≤ 767px */
@media (max-width: 767px) {
  .feature-card { gap: 24px; }
}

/* Mobile Portrait ≤ 479px */
@media (max-width: 479px) {
  .feature-card { gap: 16px; }
}
```

Every component must be fully responsive by default. Apply best practices at each breakpoint unless the user specifies otherwise. When feedback is given on responsive behavior, adapt the existing breakpoint overrides — don't rewrite from scratch.

### General CSS Rules

- Longhand only — `padding-top` not `padding`, `margin-left` not `margin`
- No CSS variables unless already present in main.css
- Class naming must follow the inferred convention from the design system

---

## Step 4 — Preview Build

Generate a fully self-contained `[component]-preview.html` the user can open in any browser.

### Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview — [Component Name]</title>
  <style>
    /* Preview Alert Banner */
    #preview-alert {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10000;
      background: #7c3aed;
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #preview-alert strong { font-size: 14px; }
    #preview-alert span { opacity: 0.85; }
    body { padding-top: 44px; } /* offset for alert height */

    /* ============================================
       FROM MASTER CSS (existing styles)
       Included for preview rendering only.
       These will NOT be in the export.
       ============================================ */
    .heading-1 { ... }
    .btn-primary { ... }

    /* ============================================
       NEW CLASSES
       These will be in the export and
       submitted for main CSS approval.
       ============================================ */
    .feature-card { ... }
    .is-highlighted { ... }

    /* ============================================
       COMPONENT PLACEHOLDERS (when component usage is enabled)
       Visual stand-ins for referenced components.
       Replaced with real instances on Ares import.
       ============================================ */
    .wf-component-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #e5e5e5;
      border: 2px dashed #999;
      border-radius: 8px;
      padding-top: 24px;
      padding-right: 16px;
      padding-bottom: 24px;
      padding-left: 16px;
      color: #666;
      font-family: monospace;
      font-size: 13px;
      min-height: 60px;
    }

    /* Style Panel UI */
    #style-panel { ... }
  </style>
</head>
<body>

  <!-- ===================== PREVIEW ALERT ===================== -->
  <div id="preview-alert">
    <strong>⚠️ Preview only.</strong>
    <span>Do not copy this file into Webflow. Use the export fragment (Step 7) — it contains only the new CSS + clean markup ready to paste.</span>
  </div>

  <!-- ===================== COMPONENT ===================== -->
  <!-- Component markup here -->

  <!-- ===================== STYLE PANEL ===================== -->
  <!-- Always use the standardized 3-tab layout defined in "Style Panel Design" above -->
  <!-- Tabs: Existing | New | Components — render all three, use sp-empty if a tab has no items -->

</body>
</html>
```

### Style Panel Design

The panel is fixed to the bottom of the viewport, always rendered, always collapsible. It uses a tab-based layout with three fixed sections (Existing, New, Components). Collapsed by default is allowed, but the header must always be visible.

Structure is **always the same regardless of component** — never omit a section, even if empty. Empty sections show "none" in muted text.

```css
#style-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #1a1a1a;
  color: #fff;
  font-family: monospace;
  font-size: 13px;
  z-index: 9999;
  border-top: 2px solid #333;
}
.sp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #111;
  cursor: pointer;
  user-select: none;
}
.sp-header strong { font-size: 13px; }
.sp-toggle { font-size: 16px; transition: transform 0.2s; display: inline-block; }
.sp-collapsed .sp-toggle { transform: rotate(-90deg); }
.sp-body {
  display: flex;
  gap: 0;
  border-top: 1px solid #2a2a2a;
}
.sp-collapsed .sp-body { display: none; }
.sp-tab {
  flex: 1;
  padding: 10px 16px;
  border-right: 1px solid #2a2a2a;
  min-width: 0;
}
.sp-tab:last-child { border-right: none; }
.sp-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
  display: block;
}
.sp-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-empty { color: #555; font-size: 12px; font-style: italic; }
.sp-existing { color: #4caf50; }
.sp-new { color: #2196f3; }
.sp-component-label { color: #ff9800; }
.sp-tag {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: default;
}
.sp-tag--existing { background: #1e3a1e; color: #81c784; border: 1px solid #2e5a2e; }
.sp-tag--new { background: #0d2a3a; color: #64b5f6; border: 1px solid #1a4a6a; }
.sp-tag--component { background: #3a2a0d; color: #ffb74d; border: 1px solid #6a4a1a; }
```

HTML structure — **always use this exact layout**:

```html
<div id="style-panel">
  <div class="sp-header" onclick="document.getElementById('style-panel').classList.toggle('sp-collapsed')">
    <strong>Style Panel — [Component Name]</strong>
    <span class="sp-toggle">▾</span>
  </div>
  <div class="sp-body">
    <!-- Tab 1: Existing -->
    <div class="sp-tab">
      <span class="sp-label sp-existing">✅ Existing styles reused</span>
      <div class="sp-tags">
        <!-- One .sp-tag--existing per EXISTING_CLASS, or: -->
        <span class="sp-empty">none</span>
      </div>
    </div>
    <!-- Tab 2: New -->
    <div class="sp-tab">
      <span class="sp-label sp-new">🆕 New styles introduced</span>
      <div class="sp-tags">
        <!-- One .sp-tag--new per NEW_CLASS with title= property summary, or: -->
        <span class="sp-empty">none</span>
      </div>
    </div>
    <!-- Tab 3: Components — always render, even if component usage is disabled -->
    <div class="sp-tab">
      <span class="sp-label sp-component-label">🔶 Component references</span>
      <div class="sp-tags">
        <!-- One .sp-tag--component per referenced component, or: -->
        <span class="sp-empty">none</span>
      </div>
    </div>
  </div>
</div>
```

### After delivering the preview, tell the user:

> "Here's your preview — open it in any browser to review the full component. The **style panel** at the bottom shows which existing classes were reused and which new ones were introduced (hover new classes to see their properties).
>
> Let me know what to adjust. Once you're happy, I'll ask you to approve the new styles before we generate the export."

When component usage is enabled, add:

> "Gray dashed boxes represent **component references** — these will be replaced with real Webflow component instances when you import via the Ares extension."

In preview markup, referenced components render as:
```html
<div class="wf-component-placeholder">[Component: Primary Nav]</div>
```

---

## Step 5 — Iterate

Respond to feedback, update the preview HTML and `[component]-new.css`. Repeat until approved.

Each iteration:
- Re-run the reuse decision tree for any style changes
- Keep `EXISTING_CLASSES` and `NEW_CLASSES` lists updated
- Update the style panel to reflect any changes
- Deliver an updated preview file

---

## Step 6 — Style Approval Checkpoint

When the user approves the design, present the new styles for sign-off before export:

> **"Great — before I generate the export, here are the new styles introduced in this component:**
>
> ```
> .feature-card     — flex container, 24px gap, 32px padding
> .is-highlighted   — orange background, white text
> .card-eyebrow     — small caps label, tracked, muted color
> ```
>
> **Approve these to add them to `[site]-main.css`?**
> - **Yes** — merge into main, they become reusable for future builds
> - **Edit** — adjust any before merging (tell me what to change)
> - **Skip** — don't add to main, export only (not reusable next time)"

#### On Approve:
Append the approved `NEW_CLASSES` to `[site]-main.css` with a comment block:

```css
/* ============================================================
   Added: [component name] — [date]
   ============================================================ */
.feature-card { ... }
.is-highlighted { ... }
```

Confirm: `✅ [site]-main.css updated — 3 new classes added (now 44 total)`

#### On Edit:
Make the requested changes, show the updated styles, ask for approval again.

#### On Skip:
Note it. Proceed to export. Skipped styles are still in the export but won't be reusable in future builds until explicitly added to main.

---

## Step 7 — Export

Once styles are approved, deliver the final export as **inline code blocks in chat only** — no file, no download. The user copies directly from the response.

The export is a bare fragment — no `<html>`, `<head>`, or `<body>` wrapper. Just what gets pasted into Webflow.

### Block 1 — HTML + CSS (always)

A `<style>` tag with new classes only, followed by the component markup. Existing class names remain on elements — Webflow resolves them from the project stylesheet.

```html
<style>
  /* New classes only — existing Webflow classes are
     referenced in the markup but not redefined here */
  .feature-card {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
  }
  .feature-card_content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  @media (max-width: 991px) {
    .feature-card { grid-template-columns: 1fr; gap: 32px; }
  }
  @media (max-width: 767px) {
    .feature-card { gap: 24px; }
  }
  @media (max-width: 479px) {
    .feature-card { gap: 16px; }
  }
</style>

<!-- Component markup -->
<div class="feature-card">
  <div class="feature-card_content">
    <h2 class="heading-style-h2">Title</h2>
    <p class="text-size-medium">Description</p>
  </div>
</div>
```

### Block 2 — JS snippet (only if component requires JS)

If the component needs JavaScript, deliver it as a second code block immediately after Block 1. Label it clearly with where to paste it in Webflow.

```html
<!-- Paste into: Webflow Page Settings → Custom Code → Before </body> tag -->
<script>
  // JS for [Component Name]
  // [brief description of what it does]
  document.addEventListener('DOMContentLoaded', function() {
    // ...
  });
</script>
```

Only include this block if JS is actually needed. Never output an empty script block.

### Component References in Export (only when component usage is enabled)

Where a referenced component appears in the layout, emit a self-closing `<componentInstance>` tag instead of rebuilding the component:

```html
<componentInstance data-wf-id="{componentID}" />
```

Component references are **not** rebuilt in the export — they are placeholder tags that the Ares extension recognizes and replaces with real Webflow component instances after paste.

Example export with component references:

```html
<style>
  .hero-layout { display: flex; flex-direction: column; gap: 48px; }
</style>

<componentInstance data-wf-id="abc123" />
<section class="hero-layout">
  <h1 class="heading-style-h1">Welcome</h1>
  <componentInstance data-wf-id="jkl012" />
</section>
<componentInstance data-wf-id="def456" />
```

### Export Rules

- Bare fragment only — no `<!DOCTYPE>`, no `<html>`, `<head>`, or `<body>` tags
- `<style>` contains **only `NEW_CLASSES`** — no existing or main.css classes
- Any `<div>` wrapping form inputs must be converted to `<form>`
- Any `<div>` acting as a submit trigger must be converted to `<button type="submit">`
- Other markup identical to preview minus the style panel and placeholder styling
- Component references use self-closing `<componentInstance>` tags with `data-wf-id` — not rebuilt as HTML
- All CSS in longhand
- JS in a separate block, clearly labeled with the Webflow paste location
- No file generated, no download — chat response only

### Delivery format

Introduce the export with a brief message, then the blocks:

> "Here's your migration code — copy each block and paste into Webflow as labeled:"

Then Block 1 (always), then Block 2 (if needed).

### Ares Handoff (only when component references are present)

After delivering the export, add a handoff note:

> "**Ares Component Handoff:** This export contains **[N] component reference(s)**: [list names]. When you paste this into Webflow via the Ares extension, it will automatically detect the `<componentInstance>` tags, create placeholder blocks, and replace them with the real component instances from your site."

---

## MCP Usage Rules

**MCP is read-only context. Always. No exceptions.**

✅ Allowed:
- `style_tool > get_styles` — read existing styles
- `data_pages_tool > list_pages` / `get_page_content` — read page structure
- `data_components_tool > list_components` / `get_component_content` — read component structure
- `data_sites_tool > get_site` — read site metadata

❌ Never allowed via MCP in this skill:
- Creating or updating elements
- Creating or updating styles
- Publishing anything
- Any write operation of any kind

If the user asks to build directly in Webflow via MCP, decline and redirect:

> "This skill builds code for migration — I don't write directly to Webflow. Once you have the export file, use the migration tool to bring it in."

Finding your Site ID: The Webflow Site ID is NOT in the URL. It lives in Webflow Dashboard → Site Settings → General → Overview.

---

## Handling Edge Cases

**Stylesheet URL not loading:** Ask to upload or paste. If MCP Designer is available, offer that as fallback.

**MCP Designer not connected:** Fall back to stylesheet URL or uploaded file. Note that MCP is unavailable and proceed.

**Page context URL not loading:** Note it, proceed with main.css context alone.

**Net new with no conventions:** Infer from the prompt/image. State the inferred conventions clearly in the design system summary so the user can correct before building.

**Master CSS doesn't exist yet:** Create it. If existing styles were provided, seed from existing.css. If net new, start empty and build it up through approvals.

**User wants to reset main CSS:** Confirm first, then re-seed from existing.css or start fresh.

---

## Reference Files

For Webflow CSS compatibility rules, supported properties, and anti-patterns:
→ [`references/webflow-compatibility.md`](references/webflow-compatibility.md)

Read when: unsure if a CSS pattern is Webflow-safe, working with complex layouts, or handling pseudo-elements and animations.

For CSS naming framework detection patterns, prefixes, and documentation:
→ [`references/framework-docs.json`](references/framework-docs.json)

Read when: detecting which framework a project uses, presenting framework options to the user, or adopting a framework's naming conventions for new classes.
