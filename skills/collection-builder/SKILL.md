---
name: webflow-migration-collection-builder
description: >
  Build Webflow CMS collection schemas from migration plans using the Webflow MCP. Triggers: "create my collections," "set up the CMS," "build the CMS schema," "migrate my content model," sharing a CSV/spreadsheet of source CMS structure, or sharing content types/fields from WordPress, Contentful, Sanity, or any other CMS. Also triggers when adding fields to existing collections as part of a migration or schema update. Handles collection creation, field setup with proper types and help text, reference/multi-reference relationships, and pre-creation validation. Flags ecommerce collections to the user for separate handling. Does NOT handle content item import, field-level validation rules (min/max characters), or site publishing.
---

# Webflow migration collection builder

Sets up Webflow CMS collections and fields from a migration plan. Takes whatever the user provides — a CSV of their source schema, a written description, a screenshot of their CMS, a list of content types — and translates it into Webflow collections with properly typed fields, help text, and reference relationships, created via MCP.

Also handles partial migrations: adding fields to existing collections, extending a schema that's already partially built, or filling in reference fields after target collections are created.

## When not to use this skill

- **Content item import.** This skill creates the schema only. Use CSV import, the CMS API, the Webflow MCP, or other migration tools for actual content.
- **Field-level validation rules.** The Webflow MCP supports `isRequired` but does not support setting min/max character counts or other validation rules programmatically. Note this limitation to the user if they mention any of these kinds of validation rules — they'll need to set validation rules manually in the Designer after schema creation.
- **Full site publish.** Never trigger a full site publish from this skill. Schema changes require a publish to appear on the live site, but that decision belongs to the user. Tell them a publish is needed, but do not execute it.
- **Redesigning CMS architecture.** Don't restructure a user's content model without their explicit approval. Present options, let them decide.
- **Localization content population.** This skill creates fields; it doesn't populate locale-specific content.

### Ecommerce collections

This skill cannot create Webflow Ecommerce collections (Products, SKUs, Categories used by Ecommerce). However, if the source schema includes ecommerce-related collections (products, variants, orders, product categories, shopping carts, etc.), **do not silently skip them.** Explicitly flag them to the user:

- Name the specific collections you detected as ecommerce-related
- Explain that Webflow Ecommerce has its own built-in collection structure that must be configured through the Designer or Ecommerce settings, not the CMS API
- Ask the user whether they plan to use Webflow Ecommerce (in which case these collections have a different setup path) or whether they want to model this content as standard CMS collections instead (which is valid for catalog/showcase sites that don't need checkout)
- Do not proceed until the user confirms how to handle these

## How it works

The skill operates in three phases: understand the schema, validate it, then create it. Never skip validation — creating collections with bad field types or circular references wastes time because you'll need to delete and recreate them.

---

## MCP conventions

Every Webflow MCP tool call requires a `context` parameter: 15–25 words in third-person describing why you're making the call. Without it, the call fails. Example: `"Creating the Blog Posts collection as part of a WordPress-to-Webflow migration for the customer's marketing site."`

Before the first MCP call in a session, call `webflow_guide_tool` to load current best practices.

---

## Phase 1 — Understand the source schema

Start by figuring out what the user has and what they need. They might provide:

- A CSV or table with collection names, field names, and field types
- A written list of content types and their fields
- A description of their source CMS structure (e.g., "I have blog posts with categories and tags")
- A migration plan document from an earlier inspect/plan phase
- Column headers from a CSV export (which imply the schema)
- Even a design file or mockup, which will take more inference and confirmation

Whatever they give you, extract this information for each collection:

1. **Collection name** and **singular name** (Webflow requires both)
2. **Slug** for the collection (derived from the name, lowercase with hyphens). Choose carefully and confirm with the user — the slug becomes the URL directory for all Collection pages (e.g., slug `post` → `yourdomain.com/post/item-slug`). Changing it post-launch requires redirects for every item.
3. **Fields** — for each field: display name, field type (mapped to Webflow's type system — see reference below), whether it's required, help text (see Help text section below), and for Reference/MultiReference fields, which collection it points to

### Mandatory completeness audit

**After extracting your proposed schema, go back to the source input and verify every single field and collection is accounted for.** Walk through the user's input row by row, column by column, collection by collection. For each source field, confirm it appears in your plan — either as a mapped field, a field that maps to a Webflow built-in (like Name or Slug), or an explicitly skipped field with a documented reason.

If any source fields are missing from your plan, add them or document why they were excluded. Common legitimate reasons to skip a field: it maps to a Webflow built-in (title → Name, slug → Slug), it's a system field that Webflow handles automatically (IDs, revision history), or it's a field the user has confirmed they don't need. "I didn't notice it" is never a valid reason.

Similarly, verify every collection from the source is represented. If a collection was intentionally excluded (ecommerce, duplicate, user-confirmed removal, etc.), it must appear in a "Collections not included" section with an explanation.

**Do not generate the plan from memory or inference alone. Systematically walk the source input.**

### Resolving ambiguous field types

When a source field could map to more than one Webflow field type, **ask the user** rather than guessing. This is a general principle, not limited to specific field names.

The general rule: if the source field's type, name, or context leaves room for more than one reasonable Webflow mapping, present the options and let the user decide. Here are common patterns to watch for, but apply the principle broadly:

- **"Category" / "Department" / "Type" / any taxonomy field** — Could be PlainText (if it's freeform), an Option field (if it's a fixed set of choices), or a Reference to a separate collection (if categories need their own metadata, pages, or images). Also ask: could an item belong to multiple categories? If yes, it needs to be MultiReference, not Reference. **Do not assume a taxonomy field on one collection points to the same collection as a similarly-named field on a different collection.** "Categories" on Blog Posts and "Categories" on Team Members are almost certainly different things (post topics vs departments). Ask.
- **"Tags"** — Same as Category, but more likely to be MultiReference if relational. If the source says "comma-separated" but you're mapping to MultiReference, do not carry over "comma-separated" into the help text — that describes the old system's data format, not how MultiReference works in Webflow.
- **"Author"** — Reference to a Team Members or Authors collection, or just a plain text name?
- **"Image" / "Icon" / "Logo" / "Avatar" / "Thumbnail"** — Could be an Image field (most common), but if the source stores these as text (icon names, CSS classes, SVG code, emoji), ask whether the user wants to keep it as PlainText or convert to an Image field in Webflow. Don't assume — a field called "icon" might be a Font Awesome class name, an uploaded image, or an SVG string.
- **"Gallery" / "Photos" / "Images"** — MultiImage field. Do not skip gallery fields. If the source has a gallery or multi-image field, it maps to MultiImage in Webflow.
- **"Content" / "Body"** — RichText almost always, but confirm if the source CMS uses markdown vs HTML.
- **"Video" / "Video URL"** — VideoLink supports YouTube and Vimeo only. If you don't have confirmation that the user exclusively uses YouTube or Vimeo, note in the plan: "If using other video providers (Wistia, Loom, self-hosted, etc.), this field should be a Link field instead, or the video can be embedded in a RichText field." Ask the user if you're unsure.
- **Any field marked "select" / "dropdown" / "enum" in the source** — Maps to an Option field in Webflow, not PlainText. Option fields require predefined choices at creation time, so ask the user for the list of options. If the source data includes the available choices, use those. If not, ask.
- **Any relational field** — Always ask whether it should be Reference (single) or MultiReference (multiple). Don't assume single just because the source field name is singular. Ask: "Can a [item] have more than one [related item]?" For example, a "category" field might need to be MultiReference if items can belong to multiple categories.

### SEO, Open Graph, and meta fields

For **every collection that will have its own page** (i.e., a Collection Template page in Webflow), proactively ask the user about SEO and Open Graph fields. Do not skip this — it's one of the most commonly needed and most commonly forgotten parts of a migration.

Specifically ask:

1. **Do they need a meta title field?** (PlainText — often separate from the display title, optimized for search)
2. **Do they need a meta description field?** (PlainText — used for search engine snippets and social sharing)
3. **Do they need an Open Graph image field?** (Image — used when the page is shared on social media; may be different from the featured image)

If the source schema already includes SEO/meta fields (like Yoast SEO title, meta description, og:image), map them directly. If the source schema has an "excerpt" field, clarify whether it serves as the meta description, a standalone excerpt, or both — and whether they need separate fields for each purpose. Do not add both an excerpt field noted as "used for meta" and a separate meta description field without asking the user which approach they prefer.

If the user says they don't need SEO fields, that's fine — move on. But always ask.

### Help text

Help text is a **first-class deliverable** of the planning phase. Every field in the plan must have help text written out, and it must be presented to the user for review alongside the field name, type, and required status.

**Help text is for the content editors who will use the Webflow CMS going forward.** It should tell them what to put in the field, any constraints or formatting expectations, and how the field is used on the site. It should NOT reference the old/source CMS, migration details, or the system being migrated from. Editors using the Webflow CMS in six months won't know or care that the site used to be on WordPress.

Good help text examples:
- "Short summary of the post, displayed on listing pages and in search results. Keep under 160 characters."
- "Select the primary category for this case study. Determines which filter it appears under on the Case Studies page."
- "Upload a square image, minimum 400×400px. Used as the team member's headshot on the About page and in author bylines."
- "YouTube or Vimeo URL only. Displayed as an embedded player on the resource detail page."

Bad help text examples (do NOT write help text like this):
- "Migrated from wp_posts.post_excerpt" — references old CMS
- "Maps to the ACF 'summary' field" — references old CMS
- "Comma-separated tags" — describes the old system's data format, not how the Webflow field works
- "Category" — not helpful, just restates the field name

### Partial migrations

If the user already has some collections built, use `data_cms_tool` with `get_collection_list` and `get_collection_details` to read the existing schema before proposing changes. Then:

- For new collections: create them as normal.
- For existing collections that need new fields: propose the fields to add, confirm with the user, then create them on the existing collection using the same field-creation MCP actions.
- For existing fields that need changes: note that the MCP can update field metadata (`update_collection_field`) like display name, help text, and required status — but cannot change a field's type after creation. If a type change is needed, flag it as a manual step — and note that you could create the new field and help migrate all content to the new field if it would be helpful.

### Field type mapping

Map source CMS field types to Webflow types. When the source type doesn't have a 1:1 equivalent, pick the closest Webflow type and note the tradeoff.

Read `references/field-type-mapping.md` for the complete mapping table covering WordPress, Contentful, Sanity, and generic field types.

Key Webflow field types and when to use them:
- **PlainText** — short text, titles, names. No default character limit; user can optionally set min/max.
- **RichText** — long-form content with HTML formatting. Often the main content body field.
- **Image** — single image with alt text.
- **MultiImage** — image gallery. Max 25 images per item.
- **Number** — integers and decimals.
- **Switch** — boolean true/false.
- **DateTime** — dates and timestamps.
- **Link** — URLs.
- **Email** — email addresses.
- **Phone** — phone numbers.
- **Color** — hex color values.
- **Option** — single-select from predefined choices. Choices must be defined at field creation time.
- **File** — file attachments (typically non-image).
- **VideoLink** — YouTube or Vimeo URLs specifically. Other video providers need a Link field or embed in RichText.
- **Reference** — link to one item in another collection.
- **MultiReference** — link to multiple items in another collection. Max 25 referenced items per item.

### Historical dates

Webflow's built-in timestamps (`createdOn`, `lastUpdated`, `lastPublished`) reflect when an item is created, edited, or published **in Webflow** — they cannot be overwritten with values from the source CMS. Any legacy timestamps that need to display on the live site (publish date, original created date, modified date, etc.) require their own explicit DateTime fields in the schema.

This is a common migration gotcha because users assume Webflow will carry dates over automatically. It will not.

**Only act on this when the source input visibly contains datetime/timestamp fields** (e.g., `published_at`, `post_date`, `created_at`, `modified_at`, `pubDate`, `dateCreated`, or any field with a date/datetime type). When you spot them, **do not silently include or exclude them.** Ask the user to confirm whether each one should be preserved as an explicit DateTime field, since Webflow's built-ins won't carry them over.

If the source input doesn't show any datetime fields, or the user hasn't shared source data at all, don't proactively suggest adding them. Don't assume the source CMS has timestamps that need preserving — that's a decision for the user to raise.

### Present the schema for review

Before doing anything in Webflow, present the full proposed schema to the user. For each collection, show a table with ALL of the following columns — no exceptions:

| Field name | Type | Required | Ref target | Help text |
|---|---|---|---|---|

Every table must include the Required column and the Help text column. Do not omit these from any collection's table.

For each collection, also show:
- Collection name, singular name, slug

Additionally present:
- **Collections not included** — any source collections that were intentionally excluded, with reasons (ecommerce, duplicates, user-confirmed removal, etc.). If no collections were excluded, state that explicitly.
- **Questions for the user** — any unresolved ambiguities, field type decisions, reference cardinality questions, SEO/meta questions, and Option field choices that need input before proceeding
- Validation report (see Phase 2)
- Creation order
- Expected collection count vs available plan slots
- Any fields that can't be cleanly represented in Webflow, with the chosen workaround

**Backup recommendation.** When you first present the schema plan, add a brief, friendly nudge: "It's a good idea to create a backup of your site before making structural CMS changes. I recommend doing so now." Mention it once at this stage — don't repeat it later.

Ask the user to confirm or request changes. Don't proceed until they approve.

### Cross-collection semantic validation

Before presenting the plan, check that reference relationships make semantic sense across collections:

- If multiple collections have a field with the same or similar name (e.g., "category"), verify whether they should actually point to the same target collection. A "category" field on Blog Posts probably points to a Blog Categories collection. A "category" field on Team Members is probably "department" and should either point to a separate Departments collection or be an Option field. **Do not reuse reference targets across unrelated collections without asking the user.**
- If a Reference field points to a collection that seems semantically wrong (e.g., Team Members referencing Blog Categories), flag it and ask.

---

## Phase 2 — Validate the schema

Run these checks before creating anything. Report all issues at once rather than failing on the first one.

### Naming checks
- No two collections share the same name or slug
- Collection names and slugs meet Webflow's requirements (no special characters in slugs, reasonable length)
- Field names within a collection are unique
- No field uses a name that conflicts with built-in defaults. Every collection automatically includes five default fields: `name`, `slug`, `createdOn`, `lastUpdated`, and `lastPublished`. Don't create custom fields with these names. If the source schema has a "Title" field, it typically maps to the built-in Name field, unless the user has specified otherwise. If the source has explicit item slugs that differ from auto-generated ones, those are handled during content import, not schema creation.

### Reference integrity
- Every Reference and MultiReference field points to a collection that exists in the plan (or already exists on the site for partial migrations)
- Reference targets are collections, not fields
- **Bidirectional relationships lose a direction.** Webflow's MultiReference is one-directional. If the source CMS has a bidirectional many-to-many (e.g., Posts ↔ Tags where both sides auto-resolve), only one side carries over. Flag this so the user can decide which direction to model — typically the direction that matters most for frontend display and filtering.

### Field type compatibility
- No unsupported field types slipped through the mapping
- Option fields have their choices defined — if choices are unknown, this is a **blocking question** for the user before proceeding
- VideoLink fields are confirmed to be YouTube/Vimeo only — if unconfirmed, flag as a question
- RichText fields are noted as needing content sanitization during import (informational, not blocking)

### Description-vs-type consistency check

Review every field's help text against its actual Webflow field type. Catch mismatches like:
- A MultiReference field with help text that says "comma-separated" (that's not how MultiReference works)
- A Reference field with help text that says "enter the name of..." (Reference is a picker, not free text)
- A VideoLink field with help text that doesn't mention the YouTube/Vimeo restriction
- An Option field with help text that says "enter..." (Option is a dropdown, not free text entry)

### Webflow limits

Don't hardcode limits — check the actual plan. Use `data_sites_tool` with `get_site` to retrieve the site's plan, then validate against plan-specific limits:

- **Collections per site**: varies by plan. Check the actual limit. Account for any existing collections when calculating available slots.
- **Fields per collection**: 60 on post-July 2024 non-Enterprise plans; may differ on Enterprise or legacy plans. Check the actual limit.
- **Reference fields per collection**: 10 on post-July 2024 non-Enterprise plans, 20 on Enterprise. This limit applies to the total count of Reference + MultiReference fields combined, not MultiReference alone.
- **MultiReference fields**: max 25 referenced items per item.
- **MultiImage fields**: max 25 images per item.

If you can't determine the plan from the API response, use the most conservative non-Enterprise limits (60 fields, 10 reference fields) and note the assumption to the user.

### Validation output

Present results as:
- **Errors** (must fix before proceeding): naming conflicts, missing reference targets, exceeded limits, Option fields with undefined choices
- **Warnings** (proceed with caution): circular references, bidirectional relationship lossy conversions, fields that need special handling during import, unconfirmed VideoLink provider compatibility
- **Info** (good to know): total collection count, total field count, reference relationship summary, fields where validation rules will need manual setup

If there are errors, show them and ask the user how they want to resolve each one. Don't auto-fix naming conflicts — the user needs to decide on the right names.

---

## Phase 3 — Create collections and fields via MCP

### Step 1: Check existing site and collections

Before creating anything, get the site details and existing collections:

1. Use `data_sites_tool` with `list_sites` to find the target site. If the user hasn't provided a site ID, ask — or help them find it.
2. Use `data_sites_tool` with `get_site` to retrieve the site's plan and limits.
3. Use `data_cms_tool` with `get_collection_list` to list existing collections.

Check for:
- Collections that already exist with the same name (ask: skip, rename, or add fields to existing?)
- How many collection slots are available based on the site's actual plan limits

### Step 2: Determine creation order

Collections must be created before other collections can reference them. Build a dependency graph from the reference fields and create in topological order:

1. Collections with no outbound reference fields (leaf nodes)
2. Collections that only reference already-created collections
3. Continue until all collections are created

If there's a circular dependency, create the collections without the circular reference fields first, then add those fields after all collections exist.

**Self-referencing collections** (e.g., Categories with a parent-category Reference pointing to itself): create the collection first, then add the self-referencing field as a second step. The collection must exist before it can be used as its own reference target.

### Step 3: Create collections

For each new collection (in dependency order), use `data_cms_tool` with `create_collection`:

```
Action: create_collection
siteId: [the site ID — must be passed explicitly]
request:
  displayName: [collection name]
  singularName: [singular name]
  slug: [collection slug]
```

Record the returned collection ID — you'll need it for field creation and for reference field `metadata.collectionId` targets.

### Step 4: Create fields

For each collection (new or existing), create its fields using the appropriate MCP action:

- **Static fields** (PlainText, RichText, Number, DateTime, etc.) → `create_collection_static_field`
- **Option fields** → `create_collection_option_field` (include the predefined choices in `metadata.options`)
- **Reference/MultiReference fields** → `create_collection_reference_field` (include the target collection's Webflow-assigned ID in `metadata.collectionId`)

Required parameters for each field:
- `displayName`: the field name
- `type`: the Webflow field type string

Required for every field (do not skip these):
- `helpText`: the help text written during Phase 1 planning. Every field gets help text — no exceptions.
- `isRequired`: whether the field must be filled (true or false — always set explicitly)

Create fields in this order: basic static fields first, then Option fields, then Reference/MultiReference fields. This isn't technically required, but it makes the collection easier to work with in the Designer since fields appear in creation order.

### Step 5: Verify creation

After creating each collection and its fields, read it back using `data_cms_tool` with `get_collection_details` to confirm everything was created correctly. Check that:
- All fields are present with the right types
- Reference fields point to the correct target collections
- Required flags are set correctly
- Help text was saved correctly

This catches silent failures — sometimes a field creation call returns success but the field doesn't actually appear, especially under rate limiting.

**If a field creation fails:** wait 3 seconds and retry once. If it fails again, log the failure and continue with remaining fields. Report all failures at the end so the user can address them.

### Step 6: Report results

After creation, present a summary:
- Collections created (with Webflow-assigned IDs)
- Fields added to existing collections (if partial migration)
- Fields created per collection
- Any fields that were skipped or failed (with error details and retry instructions)
- Reference relationship map showing how collections link together
- Reminder that every collection includes five built-in fields (`name`, `slug`, `createdOn`, `lastUpdated`, `lastPublished`) — these don't need to be created and can't be removed
- **Reminder that a full site publish is needed for schema changes to appear on the live site** — but do not trigger a publish. The user should do this themselves when ready.

If any fields failed to create, offer to retry them individually.

---

## Do not publish

This skill must never trigger a full site publish. Schema changes require a publish to take effect on the live site, but publishing can have unintended side effects (exposing draft content, overwriting staging changes, etc.). Always tell the user that a publish is needed, but leave the action to them.
