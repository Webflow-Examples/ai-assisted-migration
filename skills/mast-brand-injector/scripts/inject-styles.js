#!/usr/bin/env node
/**
 * MAST Styles Brand Injection
 *
 * Takes the frozen MAST Styles XSCP template and injects brand tokens
 * to produce a project-specific Styles page. Also replaces text content
 * in nodes where text matches old brand values (e.g., color hex labels,
 * font family names shown as display text).
 *
 * Usage:
 *   node inject-styles.js --brand texada-brand.json --output texada-styles.xscp.json
 *   node inject-styles.js --template styles.xscp.json --brand texada-brand.json
 */

const fs = require('fs');
const path = require('path');

// ─── MAST Default Tokens ──────────────────────────────────────────
// Exact values baked into the MAST Styles XSCP that get swapped.
const MAST_DEFAULTS = {
  primaryAccent: '#d14424',
  primaryAccentDark: '#9c331b',
  primaryAccentMix: '#d14424',
  borderLight: '#cccabf',
  borderDark: '#474641',
  textLight: '#1d1c1a',
  textDark: 'white',
  bgLight: 'white',
  bgDark: '#1d1c1a',
  infoColor: '#0073e6',
  fontFamily: 'General Sans',
  borderRadius: '0.5rem',
};

// ─── Parse CLI args ───────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--brand' && args[i + 1]) {
      opts.brandFile = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      opts.output = args[++i];
    } else if (args[i] === '--template' && args[i + 1]) {
      opts.template = args[++i];
    } else if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        opts[key] = args[++i];
      }
    }
  }

  return opts;
}

// ─── Load brand tokens ───────────────────────────────────────────
function loadBrandTokens(opts) {
  let tokens = {};

  if (opts.brandFile) {
    const raw = fs.readFileSync(opts.brandFile, 'utf-8');
    tokens = JSON.parse(raw);
  }

  // CLI overrides (same mapping as brand-inject.js)
  const cliMap = {
    primary: 'primaryAccent',
    'primary-dark': 'primaryAccentDark',
    'border-light': 'borderLight',
    'border-dark': 'borderDark',
    'text-light': 'textLight',
    'text-dark': 'textDark',
    'bg-light': 'bgLight',
    'bg-dark': 'bgDark',
    info: 'infoColor',
    font: 'fontFamily',
    radius: 'borderRadius',
  };

  for (const [cliKey, tokenKey] of Object.entries(cliMap)) {
    if (opts[cliKey]) {
      tokens[tokenKey] = opts[cliKey];
    }
  }

  return tokens;
}

// ─── Build replacement map ───────────────────────────────────────
function buildReplacements(brandTokens) {
  const replacements = [];

  for (const [key, mastDefault] of Object.entries(MAST_DEFAULTS)) {
    const brandValue = brandTokens[key];
    if (brandValue && brandValue !== mastDefault) {
      replacements.push({
        token: key,
        from: mastDefault,
        to: brandValue,
      });
    }
  }

  return replacements;
}

// ─── Apply replacements to styles (styleLess + variants) ────────
function applyStyleBrand(xscpData, replacements) {
  const styles = xscpData.payload.styles || [];
  let totalSwaps = 0;
  const swapLog = {};

  for (const style of styles) {
    // Process main styleLess
    if (style.styleLess) {
      for (const rep of replacements) {
        if (style.styleLess.includes(rep.from)) {
          const before = style.styleLess;
          style.styleLess = style.styleLess.split(rep.from).join(rep.to);
          if (before !== style.styleLess) {
            const count = before.split(rep.from).length - 1;
            totalSwaps += count;
            swapLog[rep.token] = (swapLog[rep.token] || 0) + count;
          }
        }
      }
    }

    // Process variant styleLess (hover, breakpoints, etc.)
    if (style.variants) {
      for (const [, variantVal] of Object.entries(style.variants)) {
        if (variantVal.styleLess) {
          for (const rep of replacements) {
            if (variantVal.styleLess.includes(rep.from)) {
              const before = variantVal.styleLess;
              variantVal.styleLess = variantVal.styleLess.split(rep.from).join(rep.to);
              if (before !== variantVal.styleLess) {
                const count = before.split(rep.from).length - 1;
                totalSwaps += count;
                swapLog[rep.token] = (swapLog[rep.token] || 0) + count;
              }
            }
          }
        }
      }
    }
  }

  return { totalSwaps, swapLog };
}

// ─── Apply text content replacements to nodes ───────────────────
// The Styles page has nodes that display brand values as visible text
// (e.g., showing "#d14424" as a color label, "General Sans" as a font name).
// We replace those text values so the preview reflects the new brand.
function applyNodeTextBrand(xscpData, replacements) {
  const nodes = xscpData.payload.nodes || [];
  let totalTextSwaps = 0;
  const textSwapLog = {};

  // Build text-specific replacements (case-insensitive matching for hex colors)
  const textReplacements = replacements.map((rep) => ({
    ...rep,
    fromLower: rep.from.toLowerCase(),
    fromUpper: rep.from.toUpperCase(),
  }));

  function processValue(val, rep) {
    if (typeof val !== 'string') return { val, changed: false };
    let changed = false;
    // Exact case match
    if (val.includes(rep.from)) {
      val = val.split(rep.from).join(rep.to);
      changed = true;
    }
    // Case-insensitive for hex colors (e.g., #D14424 vs #d14424)
    if (rep.from.startsWith('#') && !changed) {
      if (val.toLowerCase().includes(rep.fromLower)) {
        // Replace all case variants
        const regex = new RegExp(rep.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const newVal = val.replace(regex, rep.to);
        if (newVal !== val) {
          val = newVal;
          changed = true;
        }
      }
    }
    return { val, changed };
  }

  for (const node of nodes) {
    // Process node.v (text content in Webflow XSCP)
    if (node.v && typeof node.v === 'string') {
      for (const rep of textReplacements) {
        const result = processValue(node.v, rep);
        if (result.changed) {
          node.v = result.val;
          totalTextSwaps++;
          textSwapLog[rep.token] = (textSwapLog[rep.token] || 0) + 1;
        }
      }
    }

    // Process data.text (another text field in XSCP nodes)
    if (node.data && node.data.text && typeof node.data.text === 'string') {
      for (const rep of textReplacements) {
        const result = processValue(node.data.text, rep);
        if (result.changed) {
          node.data.text = result.val;
          totalTextSwaps++;
          textSwapLog[rep.token] = (textSwapLog[rep.token] || 0) + 1;
        }
      }
    }

    // Process data.xattr (custom attributes that may contain brand values)
    if (node.data && node.data.xattr && Array.isArray(node.data.xattr)) {
      for (const attr of node.data.xattr) {
        if (attr.value && typeof attr.value === 'string') {
          for (const rep of textReplacements) {
            const result = processValue(attr.value, rep);
            if (result.changed) {
              attr.value = result.val;
              totalTextSwaps++;
              textSwapLog[rep.token] = (textSwapLog[rep.token] || 0) + 1;
            }
          }
        }
      }
    }

    // Process children recursively if they exist as nested data
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child.v && typeof child.v === 'string') {
          for (const rep of textReplacements) {
            const result = processValue(child.v, rep);
            if (result.changed) {
              child.v = result.val;
              totalTextSwaps++;
              textSwapLog[rep.token] = (textSwapLog[rep.token] || 0) + 1;
            }
          }
        }
      }
    }
  }

  return { totalTextSwaps, textSwapLog };
}

// ─── Main ────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs();

  // Load template
  const templatePath = opts.template || path.join(__dirname, 'styles.xscp.json');
  console.log(`Loading template: ${templatePath}`);

  let xscpRaw;
  try {
    xscpRaw = fs.readFileSync(templatePath, 'utf-8');
  } catch (e) {
    console.error(`ERROR: Cannot read template file: ${templatePath}`);
    console.error('Make sure styles.xscp.json exists with the full XSCP data.');
    process.exit(1);
  }

  let xscpData;
  try {
    xscpData = JSON.parse(xscpRaw);
  } catch (e) {
    console.error(`ERROR: Invalid JSON in template file: ${templatePath}`);
    console.error('The file must contain valid @webflow/XscpData JSON.');
    process.exit(1);
  }

  // Validate
  if (xscpData.type !== '@webflow/XscpData') {
    console.error('ERROR: Not a valid XSCP file (missing @webflow/XscpData type)');
    process.exit(1);
  }

  const nodeCount = (xscpData.payload.nodes || []).length;
  const styleCount = (xscpData.payload.styles || []).length;
  const assetCount = (xscpData.payload.assets || []).length;
  console.log(`Template: ${nodeCount} nodes, ${styleCount} styles, ${assetCount} assets`);

  // Load brand tokens
  const brandTokens = loadBrandTokens(opts);
  if (Object.keys(brandTokens).filter((k) => !k.startsWith('_')).length === 0) {
    console.error('ERROR: No brand tokens provided. Use --brand <file> or --primary "#hex" etc.');
    console.log('\nAvailable tokens:');
    for (const [key, val] of Object.entries(MAST_DEFAULTS)) {
      console.log(`  --${key.replace(/([A-Z])/g, '-$1').toLowerCase()}  (default: ${val})`);
    }
    process.exit(1);
  }

  console.log('\nBrand tokens:');
  for (const [key, val] of Object.entries(brandTokens)) {
    if (key.startsWith('_')) continue;
    const mastVal = MAST_DEFAULTS[key];
    if (mastVal) console.log(`  ${key}: ${mastVal} -> ${val}`);
  }

  // Build replacements
  const replacements = buildReplacements(brandTokens);

  // Apply style replacements
  const { totalSwaps, swapLog } = applyStyleBrand(xscpData, replacements);
  console.log(`\nStyle replacements: ${totalSwaps}`);
  for (const [token, count] of Object.entries(swapLog)) {
    console.log(`  ${token}: ${count} swaps`);
  }

  // Apply node text replacements
  const { totalTextSwaps, textSwapLog } = applyNodeTextBrand(xscpData, replacements);
  console.log(`\nText content replacements: ${totalTextSwaps}`);
  for (const [token, count] of Object.entries(textSwapLog)) {
    console.log(`  ${token}: ${count} text swaps`);
  }

  const grandTotal = totalSwaps + totalTextSwaps;
  console.log(`\nTotal brand swaps: ${grandTotal}`);

  // Write output
  const outputPath = opts.output || path.join(__dirname, 'texada-styles.xscp.json');
  fs.writeFileSync(outputPath, JSON.stringify(xscpData));

  const sizeMB = (Buffer.byteLength(JSON.stringify(xscpData)) / 1024 / 1024).toFixed(2);
  console.log(`\nOutput: ${outputPath} (${sizeMB} MB)`);
  console.log('Paste into Webflow Designer with Cmd+V');
}

main();
