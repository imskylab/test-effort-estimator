'use strict';
/* Branding: the tool's name, full name, tagline and logo letter.
 *
 * The repo ships a neutral default. An organisation sets its own without changing the code,
 * in the first of these that exists:
 *   1. BRAND_FILE   path to a JSON file, e.g. D:\secure\brand.json
 *   2. brand.json   next to server.js (git-ignored, so it never reaches the public repo)
 * and/or environment variables APP_NAME, APP_FULL_NAME, APP_TAGLINE, APP_MARK, which win over the file.
 *
 *   { "name": "QuEST", "fullName": "Acme Estimation & Scheduling Tool",
 *     "tagline": "Estimate it. Plan it. Track it.", "mark": "Q" }
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze({
  name: 'QuEST',
  fullName: 'Quality Estimation & Scheduling Tool',
  tagline: 'Estimate it. Plan it. Track it.',
  mark: ''
});
const LIMITS = { name: 40, fullName: 120, tagline: 120, mark: 2 };
const ENV = { name: 'APP_NAME', fullName: 'APP_FULL_NAME', tagline: 'APP_TAGLINE', mark: 'APP_MARK' };

function check(b, where) {
  const out = {};
  for (const k of Object.keys(LIMITS)) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'string' || b[k].length > LIMITS[k]) throw new Error(`${where}: "${k}" must be text of up to ${LIMITS[k]} characters`);
    out[k] = b[k].trim();
  }
  for (const k of Object.keys(b)) if (!(k in LIMITS)) throw new Error(`${where}: unknown setting "${k}" (use name, fullName, tagline, mark)`);
  return out;
}

// Returns { brand, source }; throws with a readable message on a bad file.
function load(env = process.env, root = path.join(__dirname, '..')) {
  let file = env.BRAND_FILE ? path.resolve(env.BRAND_FILE) : path.join(root, 'brand.json');
  let fromFile = {}, source = 'default';
  if (env.BRAND_FILE || fs.existsSync(file)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error(`Could not read the branding file ${file}: ${e.message}`); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`${file} must be a JSON object`);
    fromFile = check(j, file); source = file;
  }
  const fromEnv = {};
  for (const [k, v] of Object.entries(ENV)) if (env[v] !== undefined && env[v] !== '') fromEnv[k] = env[v];
  if (Object.keys(fromEnv).length) source = source === 'default' ? 'environment' : source + ' + environment';
  const brand = { ...DEFAULTS, ...fromFile, ...check(fromEnv, 'environment') };
  if (!brand.name) brand.name = DEFAULTS.name;
  if (!brand.mark) brand.mark = brand.name.charAt(0).toUpperCase();
  return { brand, source };
}

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON that is safe inside a <script> element.
const scriptJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// Fills the %%APP_…%% placeholders in the built page.
function apply(html, b) {
  return html
    .replace(/%%BRAND_JSON%%/g, () => scriptJson(b))
    .replace(/%%APP_NAME%%/g, () => escHtml(b.name))
    .replace(/%%APP_FULL_NAME%%/g, () => escHtml(b.fullName || b.name))
    .replace(/%%APP_TAGLINE%%/g, () => escHtml(b.tagline))
    .replace(/%%APP_MARK%%/g, () => escHtml(b.mark));
}

module.exports = { DEFAULTS, load, apply };
