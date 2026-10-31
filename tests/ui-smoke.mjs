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
    // Board direction: changes the 3D floor's mapping, and is remembered.
    await page.click('#floorDirection [data-direction="vertical"]');
    assert.equal(await page.$eval('#floorDirection [data-direction="vertical"]', el => el.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.evaluate(() => window.roomSetup.store.floor.direction), 'vertical');
    await page.waitForFunction(async () => (await (await fetch('/api/scene')).json()).floor.direction === 'vertical', { timeout: 15000 });
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

    // A GLB file is placed at the size stored in it (the mock model is a 1 m cube).
    const mockGlb = await page.evaluate(async () => {
        const { store } = window.roomSetup;
        const bytes = new Uint8Array(await (await fetch(store.furniture[0].modelUrl)).arrayBuffer());
        return { bytes: [...bytes], count: store.furniture.length };
    });
    const glbFile = join(process.env.TMPDIR || '/tmp', `テスト-${process.pid}.glb`);
    (await import('node:fs')).writeFileSync(glbFile, Buffer.from(mockGlb.bytes));
    await (await page.$('#glbInput')).uploadFile(glbFile);
    await page.waitForFunction(count => window.roomSetup.store.furniture.length === count + 1, {}, mockGlb.count);
    const imported = await page.evaluate(() => {
        const { store, footprint } = window.roomSetup;
        const item = store.furniture.at(-1);
        const fp = footprint(item);
        return { name: item.name, engine: item.engine, size: [fp.width, fp.depth, fp.height].map(v => Math.round(v * 100)) };
    });
    assert.deepEqual(imported, { name: `テスト-${process.pid}`, engine: 'import', size: [100, 100, 100] });
    await page.evaluate(() => { const { store } = window.roomSetup; store.removeFurniture?.(store.furniture.at(-1).id); });
    await page.waitForFunction(count => window.roomSetup.store.furniture.length === count, {}, mockGlb.count);

    // 3D view renders without errors.
    await page.click('[data-view="room"]');
    await new Promise(r => setTimeout(r, 1500));
    await step(page, '06-room');

    // Doors and windows are listed, and can be edited from there, in the 3D view too.
    await page.click('[data-view="room"]');
    await page.click('[data-tab="room"]');
    const listed = await page.evaluate(async () => {
        const { createOpening, findOpeningPreset } = await import('/src/core/openings.js');
        const { store } = window.roomSetup;
        const wall = store.walls[0];
        const at = t => ({ x: wall.start.x + (wall.end.x - wall.start.x) * t, y: wall.start.y + (wall.end.y - wall.start.y) * t });
        const door = createOpening(findOpeningPreset('door-hinged'), wall, at(0.25), store.ceilingHeight);
        const pane = createOpening(findOpeningPreset('window-fixed'), wall, at(0.75), store.ceilingHeight);
        store.addOpening(door);
        store.addOpening(pane);
        store.selectOpening(null);
        return { door: door.id, pane: pane.id };
    });
    await page.waitForFunction(() => document.querySelectorAll('#openingList li').length === 2);
    assert.match(await page.$eval('#openingList li:nth-child(1) .list-title', el => el.textContent), /ドア 1/);
    assert.match(await page.$eval('#openingList li:nth-child(2) .list-title', el => el.textContent), /窓 1/);
    assert.match(await page.$eval('#openingList li:nth-child(2) .list-meta', el => el.textContent), /壁 1 · .* · 90×90/);
    assert.equal(await page.$eval('#openingInspector', el => el.hidden), true);
    await page.click('#openingList li:nth-child(1)');
    await page.waitForFunction(() => !document.getElementById('openingInspector').hidden);
    assert.equal(await page.$eval('#openingColorField', el => el.hidden), false, 'a door shows its colours');
    await page.click('#openingColors [data-color="black"]');
    assert.equal(await page.evaluate(id => window.roomSetup.store.getOpening(id).color, listed.door), 'black');
    await page.click('#openingList li:nth-child(2)');
    await page.waitForFunction(() => !document.getElementById('openingCurtain').hidden);
    assert.equal(await page.$eval('#openingColorField', el => el.hidden), true);
    await page.click('#curtainOn');
    await page.waitForFunction(() => /カーテン/.test(document.querySelector('#openingList li:nth-child(2) .list-meta').textContent));
    await step(page, '063-opening-list');
    // Title and details stay readable however long the details get.
    const titleBox = await page.$eval('#openingList li:nth-child(2) .list-title', el => { const b = el.getBoundingClientRect(); return { width: b.width, inside: b.right <= el.closest('li').getBoundingClientRect().right }; });
    assert.ok(titleBox.width > 10 && titleBox.inside, 'the title has room');
    const metaFits = await page.$eval('#openingList li:nth-child(2) .list-meta', el => el.scrollWidth <= el.clientWidth + 1);
    assert.ok(metaFits, 'the details are not cut off');
    // Clicking the selected one again closes it; the delete button removes it.
    await page.click('#openingList li:nth-child(2)');
    await page.waitForFunction(() => document.getElementById('openingInspector').hidden);
    await page.hover('#openingList li:nth-child(1)');
    await page.click('#openingList li:nth-child(1) [data-action="delete"]');
    await page.waitForFunction(() => document.querySelectorAll('#openingList li').length === 1);
    assert.equal(await page.$eval('#openingInspector', el => el.hidden), true, 'deleting does not select anything');
    await page.evaluate(id => window.roomSetup.store.removeOpening(id), listed.pane);
    await page.waitForFunction(() => document.getElementById('openingListCard').hidden); // nothing placed, no empty card

    // Curtains: only on windows, off until asked for, and every control reaches the window.
    await page.click('[data-view="plan"]');
    await page.click('[data-tab="room"]');
    const windowId = await page.evaluate(async () => {
        const { createOpening, findOpeningPreset } = await import('/src/core/openings.js');
        const { store } = window.roomSetup;
        const wall = store.walls[0];
        const middle = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
        const opening = createOpening(findOpeningPreset('window-sliding'), wall, middle, store.ceilingHeight);
        store.addOpening(opening);
        store.selectOpening(opening.id);
        return opening.id;
    });
    const curtainOf = () => page.evaluate(id => window.roomSetup.store.getOpening(id).curtain ?? null, windowId);
    await page.waitForFunction(() => !document.getElementById('openingCurtain').hidden);
    assert.equal(await page.$eval('#curtainOff', el => el.checked), true);
    assert.equal(await page.$eval('#curtainControls', el => el.hidden), true);
    await page.click('#curtainOn');
    await page.waitForFunction(() => !document.getElementById('curtainControls').hidden);
    assert.equal((await curtainOf()).enabled, true);
    await page.select('#curtainMaterial', 'velvet');
    assert.equal((await curtainOf()).material, 'velvet');
    // Dragging in the picker changes the colour at every step, and is one undo step.
    await page.evaluate(() => document.getElementById('curtainPicker').scrollIntoView({ block: 'center' }));
    const area = await (await page.$('.picker-area')).boundingBox();
    const seen = new Set();
    await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.2);
    await page.mouse.down();
    for (const f of [0.3, 0.5, 0.7, 0.9]) {
        await page.mouse.move(area.x + area.width * f, area.y + area.height * 0.3, { steps: 2 });
        seen.add((await curtainOf()).color);
    }
    const undoableBefore = await page.evaluate(() => window.roomSetup.store.canUndo);
    await page.mouse.up();
    assert.equal(seen.size, 4, 'changes while dragging, before the button is released');
    assert.ok(undoableBefore);
    await page.$eval('.picker-hex', el => { el.focus(); el.value = '#3f5566'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal((await curtainOf()).color, '#3f5566');
    await page.$eval('.picker-hex', el => { el.value = 'not a colour'; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); });
    assert.equal((await curtainOf()).color, '#3f5566');
    assert.equal(await page.$eval('.picker-hex', el => el.value), '#3f5566');
    await page.$eval('.picker-hue', el => { el.value = '200'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.notEqual((await curtainOf()).color, '#3f5566');
    await page.$eval('#curtainOpen', el => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal((await curtainOf()).open, 35);
    await page.click('#curtainSwatches button');
    assert.equal((await curtainOf()).color, '#f4f1ea');
    await page.click('[data-view="room"]');
    await new Promise(r => setTimeout(r, 800));
    await step(page, '065-curtains');
    await page.click('[data-view="plan"]');
    await page.evaluate(id => window.roomSetup.store.selectOpening(id), windowId);
    await page.waitForFunction(() => !document.getElementById('openingCurtain').hidden);
    await page.click('#curtainOff');
    assert.equal((await curtainOf()).enabled, false);
    await page.evaluate(id => { const { store } = window.roomSetup; store.removeOpening(id); store.selectOpening(null); }, windowId);
    await page.click('[data-view="room"]');

    // Undo from the 3D view: a deleted item returns, and it can be taken away again.
    const countFurniture = () => page.evaluate(() => window.roomSetup.store.furniture.length);
    const before3D = await countFurniture();
    assert.ok(before3D >= 1);
    await page.evaluate(() => { const { store } = window.roomSetup; store.selectFurniture(store.furniture[0].id); });
    await page.keyboard.press('Delete');
    await page.waitForFunction(count => window.roomSetup.store.furniture.length === count - 1, {}, before3D);
    assert.equal(await page.$eval('#undoRoom', el => el.disabled), false);
    await page.click('#undoRoom');
    await page.waitForFunction(count => window.roomSetup.store.furniture.length === count, {}, before3D);
    assert.ok(await page.evaluate(() => { const { store, scene } = window.roomSetup; return store.furniture.every(f => f.object.parent === scene.furnitureGroup); }), 'back in the scene');
    await page.click('#redoRoom');
    await page.waitForFunction(count => window.roomSetup.store.furniture.length === count - 1, {}, before3D);
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
    await page.waitForFunction(count => window.roomSetup.store.furniture.length === count, {}, before3D);
    // Moving with the plan's numbers, the floor and the ceiling.
    const floorBefore = await page.evaluate(() => JSON.stringify(window.roomSetup.store.floor));
    await page.evaluate(() => window.roomSetup.store.setFloor({ scale: 3 }));
    await page.click('#undoRoom');
    assert.equal(await page.evaluate(() => JSON.stringify(window.roomSetup.store.floor)), floorBefore);

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
    assert.equal(await page.evaluate(() => window.roomSetup.store.floor.direction), 'vertical', 'direction survives a reload');
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
