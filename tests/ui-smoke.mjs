// End-to-end smoke test in headless Chrome against a running dev server and
// gateway started with ROOM_SETUP_MOCK_ENGINE=1 (no GPU needed):
//
//   ROOM_SETUP_MOCK_ENGINE=1 npm run api & npm run dev & npm run test:ui
//
// Environment: TEST_BASE_URL (default http://127.0.0.1:5173), CHROME_BIN,
// SCREENSHOT_DIR (optional; saves screenshots of each step).

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const shots = process.env.SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });

// 1×1 PNG; the mock engine ignores the content.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
    + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
});

const errors = [];
const step = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }); };

try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('room-setup.language', 'ja');
        localStorage.setItem('room-setup.engine', 'mock');
    });
    // Start from an empty shared room (the gateway keeps it between runs).
    await fetch(`${baseUrl}/api/scene`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scene: { walls: [], furniture: [] }, origin: 'ui-smoke' }),
    });
    // The page keeps an event stream open, so wait for load rather than network idle.
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.roomSetup);
    assert.equal(await page.$eval('[data-view="plan"] span', el => el.textContent), '間取り');
    await step(page, '01-empty');

    // Template room → walls listed and floor area shown.
    await page.click('[data-template="l-shape"]');
    await page.waitForFunction(() => document.querySelectorAll('#wallList li').length === 6);
    assert.match(await page.$eval('#roomSummary', el => el.textContent), /m²/);
    // Drawing over an existing wall merges instead of stacking duplicates.
    await page.click('[data-tool="wall"]');
    const canvasBox = await (await page.$('#planCanvas')).boundingBox();
    const [from, to] = await page.evaluate(() => {
        const { plan, store } = window.roomSetup;
        const wall = store.walls.reduce((a, b) => (Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) > Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y) ? b : a));
        const at = t => plan.toScreen({ x: wall.start.x + (wall.end.x - wall.start.x) * t, y: wall.start.y + (wall.end.y - wall.start.y) * t });
        return [at(0.2), at(1)];
    });
    await page.mouse.move(canvasBox.x + from.x, canvasBox.y + from.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + to.x, canvasBox.y + to.y, { steps: 5 });
    await page.mouse.up();
    assert.equal(await page.$$eval('#wallList li', els => els.length), 6);
    await page.click('[data-tool="select"]');
    await step(page, '02-plan');

    // Undo/redo restores walls.
    await page.click('#undo');
    await page.waitForFunction(() => document.querySelectorAll('#wallList li').length === 0);
    await page.click('#redo');
    await page.waitForFunction(() => document.querySelectorAll('#wallList li').length === 6);

    // Finishes.
    await page.click('[data-tab="finish"]');
    await page.click('#floorSwatches [data-preset="blackWalnut"]');
    assert.equal(await page.$eval('#floorSwatches [data-preset="blackWalnut"]', el => el.getAttribute('aria-checked')), 'true');
    await step(page, '03-finishes');

    // Generate with the mock engine.
    await page.click('[data-tab="furniture"]');
    await page.waitForSelector('#engineList .engine[aria-checked="true"]');
    const input = await page.$('#furnitureInput');
    const file = join(process.env.TMPDIR || '/tmp', `room-setup-smoke-${process.pid}.png`);
    (await import('node:fs')).writeFileSync(file, PNG);
    await input.uploadFile(file);
    await page.waitForFunction(() => !document.querySelector('#generate').disabled);
    await page.click('#generate');
    await page.waitForSelector('#jobList .job');
    await step(page, '04-job');
    await page.waitForFunction(() => document.querySelectorAll('#furnitureList li').length === 1, { timeout: 30000 });
    assert.equal(await page.$eval('#inspector', el => el.hidden), false);
    await step(page, '05-furniture');

    // 3D view renders without errors.
    await page.click('[data-view="room"]');
    await new Promise(r => setTimeout(r, 1500));
    await step(page, '06-room');

    // Walk mode: W moves the eye-level camera, Esc ends the walk.
    await page.click('#walkToggle');
    assert.equal(await page.$eval('#walkBar', el => el.hidden), false);
    const eye = () => page.evaluate(() => window.roomSetup.scene.camera.position.toArray());
    const before = await eye();
    await page.keyboard.down('KeyW');
    await new Promise(r => setTimeout(r, 600));
    await page.keyboard.up('KeyW');
    const after = await eye();
    assert.ok(Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.05, 'walked forward');
    assert.ok(Math.abs(after[1] - before[1]) < 1e-6, 'eye height unchanged');
    await step(page, '07-walk');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.roomSetup.scene.walking);

    // Save → open round trip through the real ZIP code.
    const roundTrip = await page.evaluate(async () => {
        const { saveProject, openProject } = await import('/src/project/project-io.js');
        const { store } = window.roomSetup;
        const blob = await saveProject(store);
        const project = await openProject(blob);
        return { walls: project.walls.length, furniture: project.furniture.length, floor: project.floor.finish.preset, failed: project.failed.length };
    });
    assert.deepEqual(roundTrip, { walls: 6, furniture: 1, floor: 'blackWalnut', failed: 0 });

    // Edits sync to the gateway, survive a reload, and remote edits show up live.
    await page.waitForFunction(async () => (await (await fetch('/api/scene')).json()).furniture.length === 1, { timeout: 15000 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('#wallList li').length === 6
        && document.querySelectorAll('#furnitureList li').length === 1, { timeout: 15000 });
    const remote = await (await fetch(`${baseUrl}/api/scene`)).json();
    remote.walls = remote.walls.slice(0, 4).map((w, i, all) => ({ ...w, end: all[(i + 1) % 4].start }));
    await fetch(`${baseUrl}/api/scene`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scene: remote, base_revision: remote.revision, origin: 'ui-smoke' }),
    });
    await page.waitForFunction(() => document.querySelectorAll('#wallList li').length === 4, { timeout: 15000 });

    // A screenshot request is answered by the open page.
    const shot = await fetch(`${baseUrl}/api/scene/render`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'top', width: 640, height: 400 }),
    });
    assert.equal(shot.headers.get('content-type'), 'image/png');
    assert.ok((await shot.arrayBuffer()).byteLength > 1000);

    // Language and theme switch without losing state.
    await page.select('#languageSelect', 'en');
    assert.equal(await page.$eval('[data-view="plan"] span', el => el.textContent), 'Plan');
    await page.click('#themeToggle');
    await new Promise(r => setTimeout(r, 500));
    await step(page, '07-room-dark');
    await page.click('[data-view="plan"]');
    await new Promise(r => setTimeout(r, 300));
    await step(page, '08-plan-dark');
    assert.equal(await page.$$eval('#furnitureList li', els => els.length), 1);

    assert.deepEqual(errors, []);
    console.log('UI smoke test passed');
} finally {
    await browser.close();
}
