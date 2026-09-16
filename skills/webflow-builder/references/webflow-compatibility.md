# Webflow Compatibility Reference

Rules and anti-patterns for writing HTML/CSS that migrates cleanly into Webflow.

---

## HTML Structure Rules

### ✅ DO — Semantic, flat, single-root

Webflow maps HTML elements to its own element types. Stay close to native semantics:

| HTML element | Webflow type |
|---|---|
| `<section>` | Section (root container) |
| `<div>` | Block / Div Block |
| `<h1>`–`<h6>` | Heading |
| `<p>` | Paragraph |
| `<a>` | Link Block or Button |
| `<img>` | Image |
| `<form>` | Form (via FormWrapper > FormForm) |
| `<input>` | Form Text Input |
| `<button>` / `<input type="submit">` | Form Button |

### ❌ AVOID — Elements Webflow can't represent visually

- `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>` — use CSS Grid instead
- `<svg>` inline — use Image with external SVG src, or Embed element
- `<canvas>` — not supported in the visual editor
- `<details>` / `<summary>` — use Webflow Tabs or custom IX2 instead
- `<picture>` / `<source>` — use Image with srcset via Webflow's asset panel
- `<iframe>` — use Webflow's Embed element instead
- Custom web components / shadow DOM — not compatible

### Nesting Depth

Keep nesting to 4–5 levels max. Deep nesting (`div > div > div > div > div > div`) creates brittle structures in the Webflow canvas and makes combo classes unpredictable.

**Good:**
```
Section
  └── Container (div)
        ├── Heading (h2)
        └── Grid (div, flex)
              ├── Card (div)
              └── Card (div)
```

**Avoid:**
```
Section > Div > Div > Div > Div > Div > Div > Text
```

---

## CSS Rules

### ✅ Always use CSS longhand

Webflow's style panel stores every property individually. Shorthand is not parsed correctly during migration.

| ❌ Shorthand | ✅ Longhand |
|---|---|
| `padding: 16px 24px` | `padding-top: 16px; padding-right: 24px; padding-bottom: 16px; padding-left: 24px` |
| `margin: 0 auto` | `margin-top: 0; margin-right: auto; margin-bottom: 0; margin-left: auto` |
| `border: 1px solid #ccc` | `border-top-width: 1px; border-top-style: solid; border-top-color: #ccc` (repeat for all sides) |
| `border-radius: 8px` | `border-top-left-radius: 8px; border-top-right-radius: 8px; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px` |
| `font: 700 18px/1.5 sans-serif` | `font-weight: 700; font-size: 18px; line-height: 1.5; font-family: sans-serif` |
| `background: #000 url(...) center/cover` | `background-color: #000; background-image: url(...); background-position: center; background-size: cover` |
| `transition: all 0.2s ease` | `transition-property: all; transition-duration: 0.2s; transition-timing-function: ease` |
| `flex: 1 1 auto` | `flex-grow: 1; flex-shrink: 1; flex-basis: auto` |
| `grid: repeat(3, 1fr) / auto` | Use Webflow Row/Column helpers instead |

### ✅ Safe CSS properties (Webflow panel supports these)

- `display: flex`, `display: grid`, `display: block`, `display: inline-flex`
- All `flex-*` longhand properties
- `width`, `height`, `min-width`, `max-width`, `min-height`, `max-height`
- `overflow: hidden / visible / scroll / auto`
- `position: relative / absolute / fixed / sticky`
- `z-index`
- `opacity`
- `object-fit`, `object-position`
- `cursor`
- `pointer-events`
- `transform` (simple: `translateX`, `scale`, `rotate`) — complex transforms need IX2
- `transition-*` longhand
- `box-shadow` (single shadow — multiple shadows may not migrate cleanly)
- `text-decoration`, `text-transform`, `text-align`
- `white-space`, `word-break`, `overflow-wrap`
- `letter-spacing`, `line-height`

### ❌ Avoid or use carefully

- **CSS custom properties / variables** (`--color-brand: #ff0000`) — Webflow doesn't support CSS variables in its style panel. Use literal values.
- **`calc()`** — limited support in Webflow's visual panel; use fixed values where possible
- **CSS Grid `grid-template-areas`** — use Webflow's Row/Column system instead
- **`::before` / `::after` pseudo-elements** — not editable in Webflow's panel; use Block elements instead
- **`:not()`, `:nth-child()` selectors** — not supported in Webflow's class system
- **`@keyframes` / `animation-*`** — use Webflow Interactions (IX2) instead
- **`clamp()`, `min()`, `max()`** — not supported in Webflow panel
- **Multi-layer `box-shadow`** — may not import fully; use single shadow
- **`backdrop-filter`** — limited Webflow support, test before relying on it
- **Logical properties** (`margin-inline`, `padding-block`) — use directional longhand instead

### Responsive Breakpoints

Webflow has four fixed breakpoints. Always map to these — never use custom breakpoint values:

| Webflow breakpoint | Max-width | Key in createStyle variants |
|---|---|---|
| Desktop (base) | No limit | *(base styles, no key)* |
| Tablet | ≤ 991px | `medium` |
| Mobile Landscape | ≤ 767px | `small` |
| Mobile Portrait | ≤ 479px | `tiny` |

---

## Class Naming Rules (inferred convention)

Since your project has no enforced convention, Claude will infer it from the existing stylesheet. Until inferred, follow these defaults:

- **kebab-case** for all class names (`hero-heading`, not `heroHeading` or `HeroHeading`)
- **Semantic prefixes** based on role:
  - `btn-` for interactive buttons/links
  - `heading-` / `text-` for typography
  - `section-` for full-width sections
  - `container-` / `wrap-` for layout wrappers
  - `card-` for contained content blocks
  - `nav-` for navigation elements
  - `form-` for form-specific elements
  - `icon-` for icon containers
- **Combo class names** should describe the modifier, not the result:
  - `is-large`, `is-dark`, `is-featured`, `is-active` ✅
  - `heading-large-dark-featured` ❌

---

## Combo Class Patterns (Webflow-specific)

Webflow combo classes stack on a base class to apply overrides. This is the primary way to extend styles without duplication.

### When to use a combo class

Use a combo when:
- The base class is 80%+ correct and you need 1–4 property overrides
- You're creating a variant of a component (e.g. a dark card vs default card)
- You want to modify a shared class contextually (e.g. a heading that's larger only in the hero)

### Combo class construction

```javascript
// Base carries everything foundational
const cardStyle = createStyle('card', `
  background-color: #1a1a1a;
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
  padding-top: 24px;
  padding-right: 24px;
  padding-bottom: 24px;
  padding-left: 24px;
`);

// Combo carries only the delta
const cardFeaturedStyle = createComboStyle('is-featured', `
  border-top-width: 2px;
  border-top-style: solid;
  border-top-color: #e8865a;
  background-color: #1f1a17;
`);

// Link combo to base
cardStyle.children.push(cardFeaturedStyle.id);

// Apply both to the featured card node
const featuredCard = createBlock([], [cardStyle.id, cardFeaturedStyle.id]);
```

### ❌ Combo class anti-patterns

```javascript
// DON'T: standalone combo with all properties (defeats the purpose)
const badCombo = createComboStyle('card-featured', `
  background-color: #1f1a17;
  border-radius: 8px;        // shorthand — also wrong
  padding: 24px;             // shorthand — also wrong
  border: 2px solid #e8865a; // shorthand — also wrong
`);

// DON'T: create a new base class when a combo would suffice
const cardFeatured = createStyle('card-featured', `... all 20 properties ...`);
```

---

## Migration Checklist

Before finalizing any component, verify:

- [ ] Single root node (Section)
- [ ] No shorthand CSS anywhere
- [ ] No CSS variables (`--var`)
- [ ] No pseudo-elements (`::before`, `::after`) — replaced with Block elements
- [ ] No unsupported HTML elements (table, canvas, etc.)
- [ ] All breakpoint variants use the correct keys (`medium`, `small`, `tiny`)
- [ ] Combo classes are linked to their base via `base.children.push(combo.id)`
- [ ] New class names follow the inferred or default naming convention
- [ ] No class name duplicates an existing class from the style inventory
- [ ] All existing-class reuse is documented in the response
