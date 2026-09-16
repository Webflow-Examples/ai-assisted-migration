#!/usr/bin/env node
/**
 * Extract brand tokens from scraped site HTML/CSS.
 *
 * Usage:
 *   node extract-tokens.js --scrape .firecrawl/domain/scrape.json --output brand-tokens.json
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scrape' && args[i + 1]) opts.scrape = args[++i];
    else if (args[i] === '--output' && args[i + 1]) opts.output = args[++i];
  }
  return opts;
}

function extractColors(html) {
  const colorCounts = {};
  // Match hex colors in inline styles, Elementor data, and CSS blocks
  const hexMatches = html.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  for (const hex of hexMatches) {
    const normalized = hex.toLowerCase().length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex.toLowerCase();
    if (normalized.length === 7) {
      colorCounts[normalized] = (colorCounts[normalized] || 0) + 1;
    }
  }
  // Also match rgb/rgba
  const rgbMatches = html.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g) || [];
  for (const rgb of rgbMatches) {
    const m = rgb.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const hex = `#${(+m[1]).toString(16).padStart(2,'0')}${(+m[2]).toString(16).padStart(2,'0')}${(+m[3]).toString(16).padStart(2,'0')}`;
      colorCounts[hex] = (colorCounts[hex] || 0) + 1;
    }
  }
  return colorCounts;
}

function isNeutral(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const lightness = (r + g + b) / 3;
  // Neutral = low saturation OR very light/dark
  return saturation < 0.15 || lightness < 30 || lightness > 230;
}

function darkenHex(hex, amount) {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function extractFonts(html) {
  const fontCounts = {};
  const fontMatches = html.match(/font-family\s*:\s*([^;}"']+)/g) || [];
  for (const match of fontMatches) {
    let font = match.replace(/font-family\s*:\s*/, '').trim();
    // Take the first font in the stack
    font = font.split(',')[0].trim().replace(/["']/g, '');
    if (font && !font.startsWith('-') && font !== 'inherit' && font !== 'sans-serif' && font !== 'serif' && font !== 'monospace') {
      fontCounts[font] = (fontCounts[font] || 0) + 1;
    }
  }
  return fontCounts;
}

function extractBorderRadius(html) {
  const radiusCounts = {};
  const matches = html.match(/border-radius\s*:\s*([^;}"']+)/g) || [];
  for (const match of matches) {
    let val = match.replace(/border-radius\s*:\s*/, '').trim();
    // Normalize to first value if shorthand
    val = val.split(/\s+/)[0];
    if (val && val !== '0' && val !== '0px' && val !== 'none') {
      radiusCounts[val] = (radiusCounts[val] || 0) + 1;
    }
  }
  return radiusCounts;
}

function extractDarkBackground(html) {
  // Look for hero/header sections with dark backgrounds
  const bgMatches = html.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/g) || [];
  const darkBgs = {};
  for (const match of bgMatches) {
    const hex = (match.match(/#[0-9a-fA-F]{3,8}/) || [''])[0].toLowerCase();
    if (hex.length === 7) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      if ((r + g + b) / 3 < 80) {
        darkBgs[hex] = (darkBgs[hex] || 0) + 1;
      }
    }
  }
  return darkBgs;
}

function topN(counts, n = 1, filterFn = null) {
  let entries = Object.entries(counts);
  if (filterFn) entries = entries.filter(([k]) => filterFn(k));
  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, n).map(([k]) => k);
}

function main() {
  const opts = parseArgs();
  if (!opts.scrape) {
    console.error('Usage: node extract-tokens.js --scrape <scrape.json> [--output brand-tokens.json]');
    process.exit(1);
  }

  const scrapeData = JSON.parse(fs.readFileSync(opts.scrape, 'utf-8'));
  const html = scrapeData.rawHtml || scrapeData.html || '';
  if (!html) {
    console.error('ERROR: No rawHtml found in scrape file');
    process.exit(1);
  }

  console.log(`Analyzing ${(html.length / 1024).toFixed(0)} KB of HTML...`);

  // Extract all signals
  const colors = extractColors(html);
  const fonts = extractFonts(html);
  const radii = extractBorderRadius(html);
  const darkBgs = extractDarkBackground(html);

  // Determine primary accent (most-used non-neutral color)
  const accentColors = topN(colors, 3, hex => !isNeutral(hex));
  const primaryAccent = accentColors[0] || '#2563eb';
  const infoColor = accentColors[1] || accentColors[0] || primaryAccent;

  // Determine font
  const topFonts = topN(fonts, 2);
  const fontFamily = topFonts[0] || 'Inter';

  // Determine border radius
  const topRadii = topN(radii, 1);
  const borderRadius = topRadii[0] || '0.5rem';

  // Determine dark background
  const topDarkBg = topN(darkBgs, 1);
  const bgDark = topDarkBg[0] || '#111827';

  // Determine text color (most common dark neutral)
  const darkNeutrals = topN(colors, 3, hex => {
    if (!isNeutral(hex)) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r + g + b) / 3 < 100 && (r + g + b) / 3 > 10;
  });
  const textLight = darkNeutrals[0] || bgDark;

  // Determine border colors
  const lightNeutrals = topN(colors, 3, hex => {
    if (!isNeutral(hex)) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const avg = (r + g + b) / 3;
    return avg > 180 && avg < 240;
  });
  const borderLight = lightNeutrals[0] || '#e5e5e5';

  const midNeutrals = topN(colors, 3, hex => {
    if (!isNeutral(hex)) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const avg = (r + g + b) / 3;
    return avg > 50 && avg < 100;
  });
  const borderDark = midNeutrals[0] || '#3a3a3a';

  // Build brand tokens
  const domain = path.basename(path.dirname(opts.scrape));
  const tokens = {
    _brand: `Extracted from ${domain}`,
    _note: 'Auto-extracted by mast-brand-injector. Review and adjust before proceeding.',
    primaryAccent,
    primaryAccentDark: darkenHex(primaryAccent, 30),
    borderLight,
    borderDark,
    textLight,
    bgLight: 'white',
    bgDark,
    infoColor,
    fontFamily,
    borderRadius
  };

  // Report
  console.log('\n--- Extracted Brand Tokens ---');
  for (const [key, val] of Object.entries(tokens)) {
    if (key.startsWith('_')) continue;
    console.log(`  ${key}: ${val}`);
  }
  console.log(`\nTop accent colors found: ${accentColors.join(', ') || '(none)'}`);
  console.log(`Top fonts found: ${topFonts.join(', ') || '(none)'}`);
  console.log(`Top border-radius found: ${topN(radii, 3).join(', ') || '(none)'}`);

  // Write output
  const outputPath = opts.output || 'brand-tokens.json';
  fs.writeFileSync(outputPath, JSON.stringify(tokens, null, 2));
  console.log(`\nWritten to: ${outputPath}`);
  console.log('Review these values and adjust if needed before running brand injection.');
}

main();
