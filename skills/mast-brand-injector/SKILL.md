---
name: mast-brand-inject
description: >
  Inject brand tokens into MAST template pages and create Webflow variables via MCP.
  Produces pasteable XSCP for Components and Styles pages, plus builds all 103 MAST
  variables in the target Webflow project. Use after Page Cloner + Webflow Builder
  (Artemis), or with a brand-tokens.json file. Invoke with /mast-brand-inject.
---

# MAST Brand Injector

This skill takes brand tokens (extracted from a scraped site or provided manually) and produces a complete MAST foundation in a blank Webflow project:

1. **Variables** — Creates all 103 MAST variables across 5 collections via Webflow MCP, branded to the client
2. **Components Page** — Branded XSCP with all MAST interactive components (buttons, forms, tabs, accordions, sliders, etc.)
3. **Styles Page** — Branded XSCP with typography, color swatches, utilities, and layout grid

---

## Pipeline Position

```
Page Cloner (scrape site) --> Webflow Builder / Artemis (normalize HTML) --> THIS SKILL --> Build pages
```

This skill runs AFTER scraping and normalization, BEFORE building actual site pages. It establishes the design system foundation.

---

## Step 1 — Detect Brand Input

Check for brand tokens in this priority order:

### Mode A: Brand JSON file exists
Look for `brand-tokens.json` in the CWD, or `.firecrawl/{domain}/brand-tokens.json`.

Expected format:
```json
{
  "primaryAccent": "#FCCB30",
  "primaryAccentDark": "#e0b420",
  "borderLight": "#e5e5e5",
  "borderDark": "#3a3a3a",
  "textLight": "#1E2330",
  "bgLight": "white",
  "bgDark": "#1E2330",
  "infoColor": "#6F1AC1",
  "fontFamily": "Montserrat",
  "borderRadius": "0.25rem"
}
```

### Mode B: Scraped CSS available — extract tokens
If no JSON but `.firecrawl/{domain}/scrape.json` exists, run:
```bash
node ~/.claude/skills/mast-brand-injector/scripts/extract-tokens.js \
  --scrape .firecrawl/{domain}/scrape.json \
  --output brand-tokens.json
```
Present extracted tokens to user for confirmation. User can override any value.

### Mode C: Interactive
No files available. Ask the user for:
- **Primary accent color** (required)
- **Font family** (required)
- **Border radius** (default: 0.5rem)
- **Secondary/info color** (default: same as primary)

Fill remaining tokens with sensible derivations:
- `primaryAccentDark` = darken primary by 15%
- `borderLight` = #e5e5e5
- `borderDark` = #3a3a3a
- `textLight` = #111827
- `bgLight` = white
- `bgDark` = textLight value

Write the result to `brand-tokens.json`.

---

## Step 1.5 — Resolve Dynamic Color Names

The variable taxonomy uses `{colorName}` placeholders for the 4 brand-specific color variables. Before creating variables, you must resolve these to human-readable color names based on the actual hex values in `brand-tokens.json`.

**Look at each brand color hex value and determine the best descriptive color name:**

| Brand Token | Example Hex | Example Name |
|------------|-------------|-------------|
| `primaryAccent` | #2563eb | Blue |
| `primaryAccent` | #FCCB30 | Gold |
| `primaryAccent` | #d14424 | Red |
| `primaryAccent` | #10b981 | Green |
| `primaryAccentDark` | (derived from primary) | Dark {primary name} |
| `infoColor` | #6F1AC1 | Purple |
| `secondaryColor` | #f8d47a | Amber |

**Naming rules:**
1. Use simple, recognizable color names: Red, Blue, Green, Gold, Teal, Purple, Orange, Coral, Crimson, Indigo, Emerald, Amber, etc.
2. Keep names to 1-2 words max (e.g., "Sky Blue" is fine, "Light Greenish Blue" is not)
3. The dark variant should always be "Dark {primary name}" (e.g., "Dark Blue")
4. If two colors resolve to the same name, differentiate the secondary (e.g., primary = "Blue", secondary = "Navy")
5. Neutral colors (White, Light Gray, Mid Gray 1/2, Dark Gray, Black) keep their structural names — do NOT rename these

**Apply the resolved names to the variable taxonomy:**
- `Primary/{ColorName}` → e.g., `Primary/Blue`
- `Primary/Dark {ColorName}` → e.g., `Primary/Dark Blue`
- `Secondary/{ColorName}` for infoColor → e.g., `Secondary/Purple`
- `Secondary/{ColorName}` for secondaryColor → e.g., `Secondary/Amber`
- Theme aliases `{primaryColorVar}` → resolved primary name (e.g., `Primary/Blue`)
- Theme aliases `{primaryDarkColorVar}` → resolved dark name (e.g., `Primary/Dark Blue`)

Present the resolved names to the user for confirmation before proceeding.

---

## Step 2 — Create Variables via Webflow MCP

**IMPORTANT:** This step requires the Webflow Designer to be open and connected via MCP.

Ask the user for the target site ID, or use `data_sites_tool > list_sites` to discover it.

### Creation Order (dependency-safe):

Read the variable taxonomy from `~/.claude/skills/mast-brand-injector/templates/mast-variables.json`.

**Phase 1: Color collection** (no dependencies)
```
Create collection "Color"
Create 10 color variables with brand-overridden values where brandToken is specified
Use the resolved color names from Step 1.5 for the 4 brand-specific variables
```

Brand token mapping for Color:
| Variable | Brand Token | MAST Default |
|----------|------------|--------------|
| Primary/{ColorName} | `primaryAccent` | #d14424 |
| Primary/Dark {ColorName} | `primaryAccentDark` | #9c331b |
| Secondary/{ColorName} | `infoColor` | #0073e6 |
| Secondary/{ColorName} | `secondaryColor` | #f8d47a |
| Neutral/Mid Gray 1 | `borderLight` | #cccabf |
| Neutral/Mid Gray 2 | `borderDark` | #474641 |
| Neutral/Black | `textLight` | #1d1c1a |
| Neutral/White | (unchanged) | white |
| Neutral/Light Gray | (unchanged) | #f0eee6 |
| Neutral/Dark Gray | (unchanged) | #292825 |

**Phase 2: Layout collection** (no dependencies)
```
Create collection "Layout"
Create 11 variables: Grid (columns, 4 gap sizes), Spacing (4 margin sizes), Fluid (min/max)
All use MAST defaults — these are structural, not brand-specific
```

**Phase 3: Typography collection** (needs Layout for fluid clamp)
```
Create collection "Typography"
Create "Fonts/Primary Font" as FontFamily with brand fontFamily value
Create H1-H6, Paragraph XL/LG/Body/SM, Eyebrow groups
  - Each Font variable aliases to Fonts/Primary Font
  - Each Font Size is a custom clamp() expression referencing Layout fluid vars
  - All other values use MAST defaults (weights, line heights, letter spacing, margins)
```

**Phase 4: Theme collection with Accent mode** (needs Color vars)
```
Create collection "Theme"
Create mode "Accent"
Create 5 semantic color variables:
  - Primary/Background: light-dark(white, black) | Accent: light-dark(light-gray, dark-gray)
  - Primary/Text: light-dark(black, white) | Accent: same
  - Primary/Border: light-dark(mid-gray-1, mid-gray-2) | Accent: same
  - Primary/Accent: alias to Color > Primary/{resolved color name from Step 1.5}
  - Primary/Accent Dark: alias to Color > Primary/Dark {resolved color name from Step 1.5}
```

**Phase 5: Components collection** (needs Typography for font aliases)
```
Create collection "Components"
Create Section, Container, Card, Button, Input, Input Label groups
  - Font variables alias to Typography/Primary Font
  - Border Radius uses brand borderRadius value
  - All other values use MAST defaults
```

### MCP Tool Usage Reference

For each variable type, use the corresponding `variable_tool` action:

```
Color:       create_color_variable     (static_value: "#hex" or custom_value: "light-dark(...)")
Size:        create_size_variable      (static_value: {value, unit} or custom_value: "clamp(...)")
Number:      create_number_variable    (static_value: 1.4)
FontFamily:  create_font_family_variable (static_value: "Montserrat" or existing_variable_id for aliases)
```

For variable aliases (e.g., H1/Font pointing to Fonts/Primary Font):
```
Use existing_variable_id with the ID returned when creating the referenced variable
```

For Theme mode values:
```
Use update_color_variable with mode_id parameter set to the Accent mode ID
```

### Progress Reporting

After each collection, report:
```
[1/5] Color: 10 variables created
[2/5] Layout: 11 variables created
[3/5] Typography: 71 variables created
[4/5] Theme: 5 variables + Accent mode created
[5/5] Components: 28 variables created
Total: 103 variables across 5 collections
```

---

## Step 3 — Generate Branded XSCP Pages

Run both injection scripts:

```bash
# Components page
node ~/.claude/skills/mast-brand-injector/scripts/brand-inject.js \
  --brand brand-tokens.json \
  --template ~/.claude/skills/mast-brand-injector/templates/components.xscp.json \
  --output {client}-components.xscp.json

# Styles page
node ~/.claude/skills/mast-brand-injector/scripts/inject-styles.js \
  --brand brand-tokens.json \
  --template ~/.claude/skills/mast-brand-injector/templates/styles.xscp.json \
  --output {client}-styles.xscp.json
```

Where `{client}` is derived from the brand JSON `_brand` field or the domain name.

---

## Step 4 — Generate Copy-Paste Preview

Run the preview generator:

```bash
node ~/.claude/skills/mast-brand-injector/scripts/generate-preview.js \
  --components {client}-components.xscp.json \
  --styles {client}-styles.xscp.json \
  --brand brand-tokens.json \
  --output-dir ./{client}-mast-preview \
  --port 8787
```

This creates a preview directory with:
- `components.xscp.json` — separate XSCP file (not embedded in HTML)
- `styles.xscp.json` — separate XSCP file (not embedded in HTML)
- `index.html` — lightweight preview page (~5KB) that fetches XSCP via HTTP

The script auto-starts a local HTTP server and opens the browser. This is required because:
- Webflow reads `application/json` from the clipboard paste event
- Setting `application/json` requires `execCommand('copy')` + copy event interception
- This only works in a secure context (`http://localhost`), NOT `file://`

Use `--no-serve` to skip the server (e.g., when using Claude Preview).

For Claude Preview, add a launch config instead:
```json
{
  "name": "mast-preview",
  "runtimeExecutable": "python3",
  "runtimeArgs": ["-m", "http.server", "8787", "--directory", "./{client}-mast-preview"],
  "port": 8787
}
```

---

## Step 5 — Present Results & Next Steps

Show summary:

```
MAST Foundation Complete for {Client}

Variables:    103 created across 5 collections
Components:   {N} nodes, {N} styles, {N} brand swaps
Styles:       {N} nodes, {N} styles, {N} brand swaps

Next steps:
1. Preview server is running at http://localhost:8787
2. Click "Copy Components XSCP" --> Paste in Webflow on the Components page
3. Click "Copy Styles XSCP" --> Paste in Webflow on the Styles page
4. Your MAST foundation is ready -- proceed with building site pages
```

---

## Brand Token Schema Reference

| Token | What it controls | Required? | Default derivation |
|-------|-----------------|-----------|-------------------|
| `primaryAccent` | Primary brand color — buttons, links, active states | Yes | — |
| `primaryAccentDark` | Hover/pressed states | No | Darken primaryAccent 15% |
| `borderLight` | Light mode borders, dividers | No | #e5e5e5 |
| `borderDark` | Dark mode borders, dividers | No | #3a3a3a |
| `textLight` | Light mode text color | No | #111827 |
| `textDark` | Dark mode text color | No | white |
| `bgLight` | Light mode background | No | white |
| `bgDark` | Dark mode background | No | same as textLight |
| `infoColor` | Secondary accent — info links, badges | No | same as primaryAccent |
| `secondaryColor` | Secondary palette color | No | #f8d47a |
| `fontFamily` | All headings + body text | Yes | — |
| `borderRadius` | Cards, buttons, inputs | No | 0.5rem |

---

## File Inventory

```
~/.claude/skills/mast-brand-injector/
  SKILL.md                              # This file
  templates/
    components.xscp.json                # Frozen MAST Components template (1.5MB)
    styles.xscp.json                    # Frozen MAST Styles template (1.4MB)
    mast-variables.json                 # Variable taxonomy (103 vars, 5 collections)
  scripts/
    brand-inject.js                     # Components XSCP brand injection
    inject-styles.js                    # Styles XSCP brand injection (+ text nodes)
    extract-tokens.js                   # CSS-to-brand-tokens extractor
    generate-preview.js                 # Preview generator + HTTP server (auto-opens browser)
```
