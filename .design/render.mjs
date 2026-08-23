/**
 * Render every approved artboard to a PNG in `screens/`.
 *
 * The artboards are near-standalone HTML: the `<x-dc>` and `<helmet>` wrappers are
 * inert outside the design canvas, and the `<style>` and `<link>` they contain still
 * apply, so a browser renders them faithfully without the canvas runtime.
 *
 * Frame sizes come from `artboards/canvas.json` — the same layout the canvas uses —
 * so a screenshot and its artboard are always the same shape.
 *
 * Usage: node .design/render.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTBOARDS = resolve(HERE, 'artboards');
const SCREENS = resolve(HERE, 'screens');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run the project install first.');
  process.exit(1);
}

const canvas = JSON.parse(readFileSync(resolve(ARTBOARDS, 'canvas.json'), 'utf8'));
mkdirSync(SCREENS, { recursive: true });

const browser = await chromium.launch();
for (const board of canvas.artboards) {
  const page = await browser.newPage({
    viewport: { width: board.w, height: board.h },
    deviceScaleFactor: 2,
  });
  await page.goto(`file://${resolve(ARTBOARDS, board.file)}`, { waitUntil: 'load' });
  await page.waitForTimeout(1200); // let the webfont land before the shot
  const name = basename(board.file, '.dc.html');
  await page.screenshot({ path: resolve(SCREENS, `${name}.png`) });
  console.log(`${name.padEnd(20)} ${board.w}x${board.h}`);
  await page.close();
}
await browser.close();
