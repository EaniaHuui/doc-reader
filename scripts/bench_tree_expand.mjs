#!/usr/bin/env node
/**
 * Feedback loop for directory-tree expand jank.
 *
 * RED if:
 *  - full render of a tree with one large loaded dir exceeds RENDER_BUDGET_MS
 *  - toggle after large dir loaded exceeds TOGGLE_BUDGET_MS
 *  - collapsed large directories still keep children in the DOM
 *
 * Usage:
 *   NODE_PATH=/tmp/node_modules node scripts/bench_tree_expand.mjs
 *   TOKEN=... BENCH_USER=... BENCH_PASS=... node scripts/bench_tree_expand.mjs
 */
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function loadPuppeteer() {
  const require = createRequire(resolve(ROOT, 'package.json'));
  const candidates = [
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(':') : []),
    '/tmp/node_modules',
    resolve(ROOT, 'node_modules'),
    resolve(process.cwd(), 'node_modules'),
  ];

  for (const base of candidates) {
    if (!base) continue;
    const pkgDir = resolve(base, 'puppeteer-core');
    if (!existsSync(pkgDir)) continue;
    try {
      return (await import(pathToFileURL(pkgDir).href)).default;
    } catch {
      // fall through
    }
  }

  try {
    return require('puppeteer-core');
  } catch {
    throw new Error(
      'puppeteer-core not found. Example: npm install --prefix /tmp puppeteer-core && NODE_PATH=/tmp/node_modules node scripts/bench_tree_expand.mjs'
    );
  }
}

const puppeteer = await loadPuppeteer();

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const RENDER_BUDGET_MS = Number(process.env.RENDER_BUDGET_MS || 120);
const TOGGLE_BUDGET_MS = Number(process.env.TOGGLE_BUDGET_MS || 150);
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';

async function login() {
  if (process.env.TOKEN) return process.env.TOKEN;
  const user = process.env.BENCH_USER || 'zhuhui';
  const pass = process.env.BENCH_PASS || 'Zhuhui00';
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const data = await res.json();
  if (!data.token) throw new Error('login failed: ' + JSON.stringify(data));
  return data.token;
}

const token = await login();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((authToken) => {
  localStorage.setItem('authToken', authToken);
  localStorage.setItem('expandedPaths', JSON.stringify(['~/project/document']));
  localStorage.setItem('showTxtFiles', 'true');
}, token);
await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('.tree-row');

const metrics = await page.evaluate(async () => {
  const out = {};
  await toggleDirectoryNode(findNodeByPath('~/project/document/01-原始素材区'));
  const tFetch0 = performance.now();
  await toggleDirectoryNode(findNodeByPath('~/project/document/01-原始素材区/02-dan-koe'));
  out.first_expand_dankoe_ms = performance.now() - tFetch0;
  out.rows_with_dankoe = document.querySelectorAll('.tree-row').length;
  out.dankoe_children = findNodeByPath('~/project/document/01-原始素材区/02-dan-koe')?.children?.length;

  // collapse dankoe
  await toggleDirectoryNode(findNodeByPath('~/project/document/01-原始素材区/02-dan-koe'));
  out.rows_after_collapse = document.querySelectorAll('.tree-row').length;
  out.dankoe_dom_children_when_collapsed = document.querySelectorAll(
    '.tree-row[data-path^="~/project/document/01-原始素材区/02-dan-koe/"]'
  ).length;

  const tRender0 = performance.now();
  renderDirectoryTree();
  out.full_render_ms = performance.now() - tRender0;

  const tToggle0 = performance.now();
  await toggleDirectoryNode(findNodeByPath('~/project/document/临时'));
  out.toggle_unrelated_ms = performance.now() - tToggle0;
  return out;
});

await browser.close();

const failures = [];
if (metrics.full_render_ms > RENDER_BUDGET_MS) {
  failures.push(`full_render_ms ${metrics.full_render_ms.toFixed(1)} > ${RENDER_BUDGET_MS}`);
}
if (metrics.toggle_unrelated_ms > TOGGLE_BUDGET_MS) {
  failures.push(`toggle_unrelated_ms ${metrics.toggle_unrelated_ms.toFixed(1)} > ${TOGGLE_BUDGET_MS}`);
}
if (metrics.dankoe_dom_children_when_collapsed > 0) {
  failures.push(
    `collapsed dankoe still has ${metrics.dankoe_dom_children_when_collapsed} children in DOM (should be 0 for partial render)`
  );
}

console.log(JSON.stringify({ budgets: { RENDER_BUDGET_MS, TOGGLE_BUDGET_MS }, metrics, failures }, null, 2));
process.exit(failures.length ? 1 : 0);
