import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_PRESETS, clampOpening, createOpening, hitOpening, pointOnWall, reanchorOpenings } from '../src/core/openings.js';
import { Store, makeWall } from '../src/core/store.js';
import { buildManifest, parseProject } from '../src/project/format.js';

const preset = id => OPENING_PRESETS.find(p => p.id === id);
const wall = (x1, y1, x2, y2, id) => ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, finish: null });

test('openings are clamped to their wall and the ceiling', () => {
    const w = wall(0, 0, 100, 0, 'w');
    const o = clampOpening({ width: 300, height: 500, sill: 50, offset: 0 }, w, 240);
    assert.equal(o.width, 90);           // wall minus 5 cm margins
    assert.equal(o.offset, 50);          // centred
    assert.equal(o.height, 240 - 5 - 50);
    const door = createOpening(preset('door-hinged'), wall(0, 0, 400, 0, 'w2'), { x: 10, y: 3 }, 240);
    assert.equal(door.offset, 45);       // pulled in so the 80 cm door fits past the corner
    assert.equal(door.sill, 0);
});

test('openings follow merged, reversed and deleted walls', () => {
    const a = wall(0, 0, 200, 0, 'a');
    const b = wall(200, 0, 400, 0, 'b');
    const window_ = { ...createOpening(preset('window-fixed'), b, { x: 300, y: 0 }, 240) };
    const door = { ...createOpening(preset('door-hinged'), a, { x: 100, y: 0 }, 240), side: 1, hinge: 'start' };
    // a + b merged into one reversed wall from (400,0) to (0,0).
    const merged = wall(400, 0, 0, 0, 'm');
    const [d, w] = reanchorOpenings([door, window_], [a, b], [merged], 240);
    assert.deepEqual(pointOnWall(merged, d.offset), { x: 100, y: 0 });
    assert.deepEqual(pointOnWall(merged, w.offset), { x: 300, y: 0 });
    assert.equal(d.hinge, 'end');        // same physical hinge on the reversed wall
    assert.equal(d.side, -1);
    assert.deepEqual(reanchorOpenings([door], [a, b], [b], 240), [], 'wall deleted → opening dropped');
});

test('hit testing finds an opening on its wall span', () => {
    const w = wall(0, 0, 400, 0, 'w');
    const o = createOpening(preset('window-sliding'), w, { x: 200, y: 0 }, 240);
    assert.equal(hitOpening([o], [w], { x: 150, y: 4 }, 8), o);
    assert.equal(hitOpening([o], [w], { x: 20, y: 0 }, 8), null);
    assert.equal(hitOpening([o], [w], { x: 200, y: 40 }, 8), null);
});

test('store undo restores walls and openings together', () => {
    const store = new Store();
    store.setWalls([makeWall({ x: 0, y: 0 }, { x: 400, y: 0 })]);
    const opening = createOpening(preset('door-sliding'), store.walls[0], { x: 200, y: 0 }, 240);
    store.addOpening(opening);
    store.updateOpening(opening.id, { width: 120 });
    assert.equal(store.openings[0].width, 120);
    store.undo();
    assert.equal(store.openings[0].width, 90);
    store.undo();
    assert.equal(store.openings.length, 0);
    store.redo();
    assert.equal(store.openings.length, 1);
    // Deleting the wall removes its opening; undo brings both back.
    store.setWalls([]);
    assert.equal(store.openings.length, 0);
    store.undo();
    assert.equal(store.walls.length, 1);
    assert.equal(store.openings.length, 1);
});

test('openings survive a project save and load', () => {
    const walls = [wall(0, 0, 400, 0, 'x'), wall(400, 0, 400, 300, 'y')];
    const door = { ...createOpening(preset('door-double'), walls[1], { x: 400, y: 150 }, 240), side: -1, hinge: 'end' };
    const { manifest } = buildManifest({
        walls, openings: [door], ceilingHeight: 240,
        floor: { finish: { preset: 'oak' }, scale: 1 }, wall: { finish: { preset: 'standard' }, scale: 1 }, furniture: [],
    });
    const [restored] = parseProject(JSON.parse(JSON.stringify(manifest))).openings;
    assert.equal(restored.wall, 1);
    for (const key of ['kind', 'style', 'offset', 'width', 'height', 'sill', 'hinge', 'side']) assert.equal(restored[key], door[key], key);
});

test('door open amount is clamped and saved', () => {
    const w = wall(0, 0, 400, 0, 'w');
    const door = createOpening(preset('door-hinged'), w, { x: 200, y: 0 }, 240);
    assert.equal(door.open, 25);
    assert.equal(clampOpening({ ...door, open: 140 }, w, 240).open, 100);
    assert.equal(clampOpening({ ...door, open: -5 }, w, 240).open, 0);
    const { manifest } = buildManifest({
        walls: [w], openings: [{ ...door, open: 80 }], ceilingHeight: 240,
        floor: { finish: { preset: 'oak' }, scale: 1 }, wall: { finish: { preset: 'standard' }, scale: 1 }, furniture: [],
    });
    assert.equal(parseProject(JSON.parse(JSON.stringify(manifest))).openings[0].open, 80);
});
