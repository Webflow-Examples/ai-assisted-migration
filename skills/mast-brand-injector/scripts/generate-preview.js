#!/usr/bin/env node
/**
 * Generate an XSCP preview with copy-to-clipboard buttons.
 *
 * Architecture:
 *   - Writes components + styles XSCP as separate .json files
 *   - Generates an HTML page that fetches them via relative URLs
 *   - Spins up a local HTTP server and opens the browser automatically
 *   - Copy uses execCommand + copy event interception to set application/json MIME
 *
 * Why a server? Webflow reads application/json from the clipboard paste event.
 * The only reliable way to set that MIME type is via the copy event's
 * clipboardData.setData() — which requires a secure context (http/https).
 * Opening the HTML as file:// blocks execCommand('copy') in modern browsers.
 *
 * Usage:
 *   node generate-preview.js \
 *     --components client-components.xscp.json \
 *     --styles client-styles.xscp.json \
 *     --brand brand-tokens.json \
 *     --output-dir ./preview \
 *     --port 8787
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--components' && args[i + 1]) opts.components = args[++i];
    else if (args[i] === '--styles' && args[i + 1]) opts.styles = args[++i];
    else if (args[i] === '--brand' && args[i + 1]) opts.brand = args[++i];
    else if (args[i] === '--output-dir' && args[i + 1]) opts.outputDir = args[++i];
    else if (args[i] === '--output' && args[i + 1]) opts.outputDir = path.dirname(args[++i]); // back-compat
    else if (args[i] === '--port' && args[i + 1]) opts.port = parseInt(args[++i], 10);
    else if (args[i] === '--no-serve') opts.noServe = true;
  }
  return opts;
}

function buildHTML(brand, compNodes, compStyles, styleNodes, styleStyles) {
  const clientName = (brand._brand || 'Client').replace(/[^a-zA-Z0-9 ]/g, '').trim();
  const accent = brand.primaryAccent || '#FCCB30';

  const tokenSwatches = Object.entries(brand)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => {
      const isColor = typeof v === 'string' && (v.startsWith('#') || v === 'white');
      return isColor
        ? `<div class="token"><div class="swatch" style="background:${v}"></div>${k}: ${v}</div>`
        : `<div class="token">${k}: ${v}</div>`;
    })
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MAST Foundation — ${clientName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 40px; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 4px; }
    h2 { font-size: 20px; margin-top: 32px; margin-bottom: 12px; color: #ccc; }
    .subtitle { color: #888; margin-bottom: 24px; font-size: 15px; }
    .tokens { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
    .token { background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 6px 12px; display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid #555; flex-shrink: 0; }
    .copy-section { display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap; align-items: center; }
    .copy-btn { border: none; border-radius: 6px; padding: 14px 28px; font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.15s; }
    .copy-btn.primary { background: ${accent}; color: #1a1a1a; }
    .copy-btn.primary:hover { filter: brightness(0.9); }
    .copy-btn.success { background: #22c55e !important; color: white !important; }
    .copy-btn.fail { background: #ef4444 !important; color: white !important; }
    .copy-btn:disabled { opacity: 0.5; cursor: wait; }
    .note { color: #666; font-size: 13px; margin-bottom: 24px; }
    .divider { height: 1px; background: #333; margin: 32px 0; }
    .page-info { display: flex; gap: 24px; margin-bottom: 8px; }
    .page-info span { font-size: 13px; color: #888; }
    .page-info strong { color: #ccc; }
    .status { font-size: 12px; color: #888; }
    .status.ok { color: #22c55e; }
    .status.err { color: #ef4444; }
    .warn-banner { background: #3b2506; border: 1px solid #7c4d12; border-radius: 8px; padding: 14px 20px; margin-bottom: 24px; font-size: 13px; color: #f5a623; display: none; }
  </style>
</head>
<body>
  <h1>MAST Foundation — ${clientName}</h1>
  <p class="subtitle">Branded Components + Styles pages ready to paste into Webflow Designer</p>

  <div class="warn-banner" id="warn-banner">
    ⚠️ This page must be served via HTTP for clipboard to work.
    Run: <code>python3 -m http.server 8787</code> in the output directory, then open <code>http://localhost:8787</code>
  </div>

  <h2>Brand Tokens</h2>
  <div class="tokens">
    ${tokenSwatches}
  </div>

  <div class="divider"></div>

  <h2>Components Page</h2>
  <div class="page-info">
    <span><strong>${compNodes.toLocaleString()}</strong> nodes</span>
    <span><strong>${compStyles}</strong> styles</span>
  </div>
  <div class="copy-section">
    <button class="copy-btn primary" id="btn-components" disabled>Loading...</button>
    <span class="status" id="status-components"></span>
  </div>

  <div class="divider"></div>

  <h2>Styles Page</h2>
  <div class="page-info">
    <span><strong>${styleNodes.toLocaleString()}</strong> nodes</span>
    <span><strong>${styleStyles}</strong> styles</span>
  </div>
  <div class="copy-section">
    <button class="copy-btn primary" id="btn-styles" disabled>Loading...</button>
    <span class="status" id="status-styles"></span>
  </div>

  <p class="note">After copying, switch to Webflow Designer and press Cmd+V on the target page.</p>

  <script>
    // ─── Protocol check ─────────────────────────────────────────────
    if (location.protocol === 'file:') {
      document.getElementById('warn-banner').style.display = 'block';
    }

    // ─── State ──────────────────────────────────────────────────────
    const xscpCache = {};

    // ─── Fetch XSCP files (not embedded — keeps HTML small) ────────
    async function loadXSCP(type) {
      const statusEl = document.getElementById('status-' + type);
      const btnEl = document.getElementById('btn-' + type);
      const filename = type + '.xscp.json';

      try {
        statusEl.textContent = 'Loading ' + filename + '...';
        const resp = await fetch(filename);
        if (!resp.ok) throw new Error(resp.status + ' ' + resp.statusText);
        const text = await resp.text();

        // Validate it's real XSCP
        const parsed = JSON.parse(text);
        if (parsed.type !== '@webflow/XscpData') {
          throw new Error('Not valid @webflow/XscpData');
        }

        xscpCache[type] = text; // Store raw JSON string (already stringified)
        const sizeMB = (text.length / 1024 / 1024).toFixed(2);
        statusEl.textContent = sizeMB + ' MB loaded';
        statusEl.className = 'status ok';
        btnEl.disabled = false;
        btnEl.textContent = 'Copy ' + (type === 'components' ? 'Components' : 'Styles') + ' XSCP';
      } catch (err) {
        statusEl.textContent = 'Failed to load: ' + err.message;
        statusEl.className = 'status err';
        btnEl.textContent = 'Error';
        console.error('Failed to load ' + filename, err);
      }
    }

    // ─── Clipboard: execCommand + copy event interception ──────────
    // This is the ONLY reliable way to put application/json on the clipboard.
    // ClipboardItem API rejects non-standard MIME types.
    // Must be triggered from a real user gesture (onclick).

    function copyToClipboard(jsonString) {
      return new Promise((resolve) => {
        let intercepted = false;

        function onCopy(e) {
          e.preventDefault();
          e.clipboardData.setData('application/json', jsonString);
          e.clipboardData.setData('text/plain', jsonString);
          intercepted = true;
        }

        document.addEventListener('copy', onCopy, true);

        // Use a contenteditable div (more reliable than textarea across browsers)
        const div = document.createElement('div');
        div.contentEditable = true;
        div.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0.01;';
        div.textContent = 'xscp';
        document.body.appendChild(div);

        const range = document.createRange();
        range.selectNodeContents(div);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        let success = false;
        try {
          success = document.execCommand('copy');
        } catch (err) {
          console.error('execCommand error:', err);
        }

        document.removeEventListener('copy', onCopy, true);
        document.body.removeChild(div);
        sel.removeAllRanges();

        resolve(success && intercepted);
      });
    }

    // ─── Button click handlers ──────────────────────────────────────
    async function handleCopy(type) {
      const btnEl = document.getElementById('btn-' + type);
      const statusEl = document.getElementById('status-' + type);
      const label = type === 'components' ? 'Components' : 'Styles';
      const jsonString = xscpCache[type];

      if (!jsonString) {
        statusEl.textContent = 'Not loaded yet';
        statusEl.className = 'status err';
        return;
      }

      const ok = await copyToClipboard(jsonString);

      if (ok) {
        btnEl.textContent = label + ' copied! Paste in Webflow (Cmd+V)';
        btnEl.classList.add('success');
        statusEl.textContent = (jsonString.length / 1024 / 1024).toFixed(2) + ' MB on clipboard as application/json';
        statusEl.className = 'status ok';
        console.log(label + ' XSCP copied:', jsonString.length, 'chars');
      } else {
        btnEl.textContent = 'Copy failed';
        btnEl.classList.add('fail');
        statusEl.textContent = 'execCommand blocked — make sure this page is served via HTTP, not file://';
        statusEl.className = 'status err';
        console.error('Copy failed. Protocol:', location.protocol);
      }

      setTimeout(() => {
        btnEl.textContent = 'Copy ' + label + ' XSCP';
        btnEl.classList.remove('success', 'fail');
      }, 4000);
    }

    // ─── Wire up buttons ────────────────────────────────────────────
    document.getElementById('btn-components').addEventListener('click', () => handleCopy('components'));
    document.getElementById('btn-styles').addEventListener('click', () => handleCopy('styles'));

    // ─── Load both XSCP files on page load ──────────────────────────
    loadXSCP('components');
    loadXSCP('styles');
  </script>
</body>
</html>`;
}

function main() {
  const opts = parseArgs();
  if (!opts.components || !opts.styles || !opts.brand) {
    console.error('Usage: node generate-preview.js --components <file> --styles <file> --brand <file> [--output-dir <dir>] [--port <port>] [--no-serve]');
    process.exit(1);
  }

  const compData = JSON.parse(fs.readFileSync(opts.components, 'utf-8'));
  const styleData = JSON.parse(fs.readFileSync(opts.styles, 'utf-8'));
  const brand = JSON.parse(fs.readFileSync(opts.brand, 'utf-8'));

  const compNodes = compData.payload.nodes.length;
  const compStyles = compData.payload.styles.length;
  const styleNodes = styleData.payload.nodes.length;
  const styleStyles = styleData.payload.styles.length;

  const clientName = (brand._brand || 'Client').replace(/[^a-zA-Z0-9 ]/g, '').trim();
  const clientSlug = clientName.toLowerCase().replace(/\s+/g, '-') || 'client';

  // Output directory
  const outDir = opts.outputDir || path.join(process.cwd(), clientSlug + '-mast-preview');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Write XSCP files separately (not embedded in HTML)
  const compPath = path.join(outDir, 'components.xscp.json');
  const stylePath = path.join(outDir, 'styles.xscp.json');
  const htmlPath = path.join(outDir, 'index.html');

  fs.writeFileSync(compPath, JSON.stringify(compData));
  fs.writeFileSync(stylePath, JSON.stringify(styleData));

  const compSizeMB = (fs.statSync(compPath).size / 1024 / 1024).toFixed(2);
  const styleSizeMB = (fs.statSync(stylePath).size / 1024 / 1024).toFixed(2);

  console.log(`Components XSCP: ${compPath} (${compSizeMB} MB, ${compNodes} nodes, ${compStyles} styles)`);
  console.log(`Styles XSCP:     ${stylePath} (${styleSizeMB} MB, ${styleNodes} nodes, ${styleStyles} styles)`);

  // Generate HTML (lightweight — no embedded JSON)
  const html = buildHTML(brand, compNodes, compStyles, styleNodes, styleStyles);
  fs.writeFileSync(htmlPath, html);

  const htmlSizeKB = (fs.statSync(htmlPath).size / 1024).toFixed(1);
  console.log(`Preview HTML:    ${htmlPath} (${htmlSizeKB} KB)`);

  if (opts.noServe) {
    console.log(`\nTo use: cd ${outDir} && python3 -m http.server 8787`);
    console.log('Then open http://localhost:8787');
    return;
  }

  // Auto-serve and open browser
  const port = opts.port || 8787;
  const MIME_TYPES = {
    '.html': 'text/html',
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.css': 'text/css',
  };

  const server = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(outDir, urlPath);
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\nPreview server running at ${url}`);
    console.log('Press Ctrl+C to stop.\n');

    // Open in default browser
    const openCmd = process.platform === 'darwin' ? 'open' :
                    process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${openCmd} ${url}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Try --port ${port + 1}`);
      process.exit(1);
    }
    throw err;
  });
}

main();
