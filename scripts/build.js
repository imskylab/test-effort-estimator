#!/usr/bin/env node
/*
 * Builds the page from src/ into two targets:
 *   public/index.html          self-hosted version, served by server.js
 *   dist/claude-artifact.html  version published as a claude.ai artifact
 *                              (no doctype/head; the platform adds them)
 * The self-hosted page keeps %%APP_…%% placeholders, which server.js fills from the branding
 * settings when it serves the page. The artifact build fills them now (brand.json or defaults).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Brand = require('../lib/brand');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const head = read('head.html');
const body = read('body.html');
const engine = read('engine.js'), ui = read('ui.js');
const app = engine + '\n' + ui;

// Fail the build on a script syntax error rather than shipping a blank page.
try { new Function(app); } catch (e) { console.error('Script syntax error:', e.message); process.exit(1); }

const XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

const selfHosted = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>
${head.replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n?/, '')}</head>
<body>
${body}
<script src="/vendor/xlsx.full.min.js"></script>
<script src="/store.js"></script>
<script id="engine-src">
${engine}
</script>
<script>
${ui}
</script>
</body>
</html>
`;

const artifact = `${head}${body}
<script src="${XLSX_CDN}"></script>
<script id="engine-src">
${engine}
</script>
<script>
${ui}
</script>
`;

fs.writeFileSync(path.join(root, 'public', 'index.html'), selfHosted);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const { brand, source } = Brand.load();
fs.writeFileSync(path.join(root, 'dist', 'claude-artifact.html'), Brand.apply(artifact, brand));
console.log(`Built public/index.html and dist/claude-artifact.html (artifact named “${brand.name}”, from ${source})`);
