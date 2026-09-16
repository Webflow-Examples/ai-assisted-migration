# Field type mapping reference

Maps common source CMS field types to Webflow CMS field types. Use this during Phase 1 to translate source schemas.

The **Generic** table below covers most field types you'll encounter — boolean → Switch, number → Number, etc. Platform-specific sections only list things that are genuinely unique to that platform: named fields with conventional roles, platform-specific modules, asset URL conventions, structured-content formats, and known migration gotchas. If you don't see a field type in the platform section, fall back to the generic table.

## Generic / universal field types

| Source type | Webflow type | Notes |
|---|---|---|
| Short text / string / varchar | PlainText | No default character limit; designer can set min/max in the UI after creation |
| Long text / textarea | PlainText or RichText | Use RichText if it contains HTML/formatting; PlainText if it's truly plain |
| Rich text / HTML / WYSIWYG | RichText | Will need sanitization during import — flag for the rich text sanitizer skill |
| Markdown | RichText | Convert markdown → HTML before import |
| Number / integer / float | Number | Webflow Number handles both integers and decimals |
| Boolean / toggle / checkbox | Switch | |
| Date / datetime / timestamp | DateTime | Normalize format to ISO 8601 during import |
| Single image / media (image) | Image | Source URL must be publicly accessible or re-hosted |
| Image gallery / media (multiple) | MultiImage | Max 25 images per item |
| File / attachment / document | File | Non-image files |
| URL / link | Link | |
| Email | Email | |
| Phone / telephone | Phone | |
| Color / hex color | Color | Must be valid hex |
| Video URL / embed | VideoLink | YouTube and Vimeo URLs only; other providers need a Link or embed in RichText |
| Select / dropdown / enum | Option | Requires predefined choices at field creation time. Option is single-select only. |
| Multi-select / tags (fixed set) | Consider a Reference collection + MultiReference | Webflow Option is single-select only. For multi-select, create a separate collection for the values and use MultiReference. |
| Relation / foreign key (single) | Reference | Target collection must exist before creating this field |
| Relation / foreign key (multiple) | MultiReference | Max 25 references per item. Target collection must exist before creating this field. |
| JSON / object / structured data | PlainText or RichText | No native JSON field in Webflow; serialize as text or restructure as separate fields |
| Slug / permalink | (skip) | Webflow auto-generates slugs from the Name field; only preserve source slugs during content import if they differ from auto-generated ones |
| ID / primary key | (skip) | Webflow assigns its own IDs; store source IDs in a PlainText field if needed for reference mapping during import |
| Publish date / created date | DateTime | Create an explicit field — Webflow's system timestamps reflect when the item was created in Webflow, not the original source date |

## WordPress-specific

| WordPress field / type | Webflow type | Notes |
|---|---|---|
| post_title | (maps to built-in Name) | |
| post_content | RichText | Likely contains shortcodes, embeds, and WordPress-specific HTML — needs sanitization during import |
| post_excerpt | PlainText or RichText | Depends on whether excerpts contain HTML; clarify whether it's used as the meta description |
| post_status | (skip as field) | Map to Webflow's draft/published state during import, not a field |
| featured_image / post_thumbnail | Image | Resolve WordPress media library URLs; assets must be publicly accessible or re-hosted |
| categories | Reference or MultiReference | Hierarchical → separate collection with a parent Reference; flat → MultiReference to a Categories collection |
| tags | MultiReference | To a Tags collection |
| ACF repeater | (no equivalent) | Flatten into separate fields, use RichText, or create a child collection with a Reference back to parent |
| ACF flexible content | (no equivalent) | Same approach as repeater — usually becomes RichText content |
| Yoast SEO title / meta description | PlainText | Map to dedicated SEO fields on the collection (or to Webflow's page-level SEO during page-template configuration) |
| WooCommerce collections | (flag as ecommerce) | Route through the ecommerce flagging path described in the main skill — don't try to model these as standard CMS collections without confirming |

## Contentful-specific

| Contentful field type | Webflow type | Notes |
|---|---|---|
| Rich text | RichText | Contentful Rich Text is a structured JSON format — convert to HTML before import. Embedded entries inside rich text need separate handling during conversion |
| Location | PlainText or two Number fields | No native geo field in Webflow; store as "lat,lng" or split |
| Asset link (Media) | Image or File | Contentful assets are referenced by asset ID — resolve to URLs and ensure assets are publicly accessible or re-hosted |
| Localized fields | (one field, populated per locale) | Contentful localizes per-field; Webflow's localization handles this natively — create one field, populate per locale during import |

## Sanity-specific

| Sanity field type | Webflow type | Notes |
|---|---|---|
| block (Portable Text) | RichText | Portable Text is structured JSON — convert to HTML before import |
| image | Image | Sanity images use an asset reference system — resolve to URLs and ensure publicly accessible |
| array of objects | (no equivalent) | Flatten or restructure as a child collection with Reference back to parent |
| reference with weak/strong setting | Reference / MultiReference | The weak/strong distinction doesn't matter for migration — both map to the same Webflow type |

## Drupal-specific

| Drupal field / type | Webflow type | Notes |
|---|---|---|
| Text (formatted) / Text (formatted, long) | RichText | Drupal text formats and filters apply at render time — output may need sanitization during import |
| Text (formatted, long, with summary) | RichText (body) + PlainText (summary) | Drupal stores body and summary together; in Webflow they need separate fields. Map summary to excerpt or meta description if used that way |
| Taxonomy term reference | Reference or MultiReference | Each Drupal vocabulary becomes its own Webflow collection. Watch the collection count against plan limits |
| Image / File | Image / File | Resolve Drupal file paths (`public://`, `private://`) to publicly accessible URLs during import |
| Path alias | (skip) | Webflow auto-generates slugs; preserve source aliases during content import only if they differ |
| status (published/unpublished) | (skip as field) | Map to Webflow's draft/published state during import |
| Sticky / Promoted flags | Switch | Only if surfaced on the live site |
| Address (Address module) | (no native equivalent) | Flatten into separate PlainText fields per address part, or store the whole address as PlainText |
| Metatag (Metatag module) | PlainText fields | Map individual meta values to dedicated SEO fields |
| Paragraphs / Field Collection | (no equivalent) | Same problem as ACF repeaters: flatten, use RichText, or create a child collection with a Reference back to parent |
| Layout Builder blocks | (no equivalent) | These are page-building structures, not content data — rebuild in the Webflow Designer rather than migrating as fields |
| Comments | (skip or handle separately) | Webflow has no native comment system — typically replaced with a third-party widget |

## AEM (Adobe Experience Manager)-specific

AEM migrations typically pull from Content Fragments (structured content defined by a Content Fragment Model). Page-level Components and Experience Fragments are authoring structures, not CMS data — those should be rebuilt in the Webflow Designer rather than migrated as fields.

| AEM Content Fragment field | Webflow type | Notes |
|---|---|---|
| Tags | MultiReference | AEM tags are a centrally-managed tree — create a Webflow Tags collection. If hierarchy matters, flag it; Webflow collections are flat and may need a parent Reference field to recreate the tree |
| Asset reference (image / file) | Image / File | Resolve DAM URLs — assets must be publicly accessible or re-hosted before import |
| Multifield (dialog repeater) | (no equivalent) | Same as ACF repeater / Drupal Paragraphs — flatten or use a child collection |
| jcr:title (page property) | (maps to built-in Name) | |
| jcr:description (page property) | PlainText | Often maps to SEO description |
| cq:lastModified, cq:lastModifiedBy | (skip) | System metadata — Webflow tracks its own |
| Workflow state | (skip as field) | Handle during import as draft/published state |

## Fields with no Webflow equivalent

These source CMS concepts don't map directly to a Webflow field type. For each, note the recommended workaround:

| Concept | Workaround |
|---|---|
| Nested/repeater fields | Create a child collection with a Reference back to the parent |
| Computed/formula fields | Compute the value before import and store in a static field, or handle with custom code on the frontend |
| Multi-select (many values from fixed list) | Create a separate collection for the values + MultiReference |
| Geo/location fields | Store as PlainText "lat,lng" or two Number fields |
| JSON/structured objects | Flatten into individual fields, or serialize to PlainText if needed for display via custom code |
| Password/secret fields | Don't migrate — handle through Webflow Memberships or external auth |
| Polymorphic relations | Pick the most common type and create a Reference field; handle edge cases manually |
| Revision history | Don't migrate — Webflow has its own versioning |
| Localized field variants | Webflow's localization handles this natively — create one field and populate per locale |
| Min/max validation rules | Cannot be set via the MCP API. Note for manual setup in the Designer after schema creation. |
