#!/usr/bin/env node
/**
 * MAST Brand Injection POC
 *
 * Takes the frozen MAST Components XSCP template and injects brand tokens
 * extracted from a scraped site to produce a project-specific Components page.
 *
 * Usage:
 *   node brand-inject.js --brand brand-tokens.json --output branded-components.xscp.json
 *
 * Or with inline tokens:
 *   node brand-inject.js --primary "#2563eb" --font "Inter" --output branded-components.xscp.json
 */

const fs = require('fs');
const path = require('path');

// ─── MAST Default Tokens ──────────────────────────────────────────
// These are the exact values in the MAST Components XSCP that get swapped.
const MAST_DEFAULTS = {
  // Colors
  primaryAccent: '#d14424',
  primaryAccentDark: '#9c331b',       // darker variant used in hover states
  primaryAccentMix: '#d14424',        // used inside color-mix() expressions
  borderLight: '#cccabf',             // light mode border
  borderDark: '#474641',              // dark mode border
  textLight: '#1d1c1a',              // light mode text
  textDark: 'white',                  // dark mode text (keep as 'white' not hex)
  bgLight: 'white',                   // light mode background
  bgDark: '#1d1c1a',                 // dark mode background
  infoColor: '#0073e6',              // links, info states

  // Typography
  fontFamily: 'General Sans',

  // Borders
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

  // CLI overrides
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

// ─── Apply replacements to XSCP ─────────────────────────────────
function applyBrand(xscpData, replacements) {
  const styles = xscpData.payload.styles;
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
            const count = (before.split(rep.from).length - 1);
            totalSwaps += count;
            swapLog[rep.token] = (swapLog[rep.token] || 0) + count;
          }
        }
      }
    }

    // Process variant styleLess (hover, breakpoints, etc.)
    if (style.variants) {
      for (const [variantKey, variantVal] of Object.entries(style.variants)) {
        if (variantVal.styleLess) {
          for (const rep of replacements) {
            if (variantVal.styleLess.includes(rep.from)) {
              const before = variantVal.styleLess;
              variantVal.styleLess = variantVal.styleLess.split(rep.from).join(rep.to);
              if (before !== variantVal.styleLess) {
                const count = (before.split(rep.from).length - 1);
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

// ─── Main ────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs();

  // Load template
  const templatePath = opts.template || path.join(__dirname, 'components.xscp.json');
  console.log(`Loading template: ${templatePath}`);
  const xscpRaw = fs.readFileSync(templatePath, 'utf-8');
  const xscpData = JSON.parse(xscpRaw);

  // Validate
  if (xscpData.type !== '@webflow/XscpData') {
    console.error('ERROR: Not a valid XSCP file');
    process.exit(1);
  }

  console.log(`Template: ${xscpData.payload.nodes.length} nodes, ${xscpData.payload.styles.length} styles`);

  // Load brand tokens
  const brandTokens = loadBrandTokens(opts);
  if (Object.keys(brandTokens).length === 0) {
    console.error('ERROR: No brand tokens provided. Use --brand <file> or --primary "#hex" etc.');
    console.log('\nAvailable tokens:');
    for (const [key, val] of Object.entries(MAST_DEFAULTS)) {
      console.log(`  --${key.replace(/([A-Z])/g, '-$1').toLowerCase()}  (default: ${val})`);
    }
    process.exit(1);
  }

  console.log(`\nBrand tokens:`);
  for (const [key, val] of Object.entries(brandTokens)) {
    const mastVal = MAST_DEFAULTS[key];
    console.log(`  ${key}: ${mastVal} → ${val}`);
  }

  // Build and apply replacements
  const replacements = buildReplacements(brandTokens);
  const { totalSwaps, swapLog } = applyBrand(xscpData, replacements);

  console.log(`\nApplied ${totalSwaps} replacements:`);
  for (const [token, count] of Object.entries(swapLog)) {
    console.log(`  ${token}: ${count} swaps`);
  }

  // Write output
  const outputPath = opts.output || path.join(__dirname, 'branded-components.xscp.json');
  fs.writeFileSync(outputPath, JSON.stringify(xscpData));

  const sizeMB = (Buffer.byteLength(JSON.stringify(xscpData)) / 1024 / 1024).toFixed(2);
  console.log(`\nOutput: ${outputPath} (${sizeMB} MB)`);
  console.log('Paste into Webflow Designer with Cmd+V');
}

main();
