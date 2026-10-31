import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWood } from '../src/core/wood.js';

const SIZE = 512;
const WALNUT = [85, 60, 42];
const maps = generateWood('blackWalnut', WALNUT, { size: SIZE, metres: 2 });
const at = (pixels, x, y) => [...pixels.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)];

function meanStep(pixels, fromX, toX) {
    let total = 0;
    for (let y = 0; y < SIZE; y++) {
        for (let c = 0; c < 3; c++) total += Math.abs(pixels[(y * SIZE + fromX) * 4 + c] - pixels[(y * SIZE + toX) * 4 + c]);
    }
    return total / (SIZE * 3);
}

test('same preset, same wood', () => {
    const again = generateWood('blackWalnut', WALNUT, { size: SIZE, metres: 2 });
    assert.deepEqual(again.color, maps.color);
    assert.notDeepEqual(generateWood('oak', WALNUT, { size: SIZE, metres: 2 }).color, maps.color);
});

test('every pixel is filled and opaque', () => {
    for (const pixels of [maps.color, maps.normal, maps.roughness]) {
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) assert.fail(`hole at pixel ${(i - 3) / 4}`);
    }
});

test('the tile repeats without a seam', () => {
    // Crossing the tile's edge is no bigger a jump than crossing any other column.
    const interior = (meanStep(maps.color, 100, 101) + meanStep(maps.color, 300, 301)) / 2;
    assert.ok(meanStep(maps.color, SIZE - 1, 0) < interior * 2.5, 'left and right edges');
    let rowEdge = 0;
    let rowInner = 0;
    for (let x = 0; x < SIZE; x++) {
        rowEdge += Math.abs(at(maps.color, x, SIZE - 1)[0] - at(maps.color, x, 0)[0]);
        rowInner += Math.abs(at(maps.color, x, 25)[0] - at(maps.color, x, 26)[0]);
    }
    // Top and bottom meet at a groove between boards, which is meant to be there.
    assert.ok(rowEdge < SIZE * 40 && rowInner < rowEdge + SIZE * 40);
});

test('the colour stays close to the preset', () => {
    let sum = 0;
    for (let i = 0; i < maps.color.length; i += 4) sum += maps.color[i];
    const mean = sum / (SIZE * SIZE);
    assert.ok(mean > WALNUT[0] * 0.6 && mean < WALNUT[0] * 1.25, `mean red ${mean}`);
});

test('boards differ from each other, and show grain inside', () => {
    const rowMeans = [];
    for (let row = 0; row < 10; row++) {
        let sum = 0;
        for (let x = 0; x < SIZE; x++) sum += at(maps.color, x, Math.round((row + 0.5) * SIZE / 10))[0];
        rowMeans.push(sum / SIZE);
    }
    assert.ok(Math.max(...rowMeans) - Math.min(...rowMeans) > 2, 'rows vary');
    const across = new Set();
    for (let y = 5; y < 45; y++) across.add(at(maps.color, 200, y)[0]);
    assert.ok(across.size > 8, 'grain across a board');
});

test('normals stay normalised and mostly face up, tilting at the grooves', () => {
    let tilted = 0;
    for (let i = 0; i < maps.normal.length; i += 4) {
        const n = [maps.normal[i], maps.normal[i + 1], maps.normal[i + 2]].map(v => v / 255 * 2 - 1);
        assert.ok(Math.abs(Math.hypot(...n) - 1) < 0.03);
        if (n[2] < 0.8) tilted++;
    }
    assert.ok(tilted > 100 && tilted < SIZE * SIZE * 0.4, `tilted ${tilted}`);
});

test('varnish is smooth, and rougher in the grooves', () => {
    const values = [];
    for (let i = 1; i < maps.roughness.length; i += 4) values.push(maps.roughness[i]);
    const mean = values.reduce((a, b) => a + b) / values.length;
    assert.ok(mean / 255 > 0.25 && mean / 255 < 0.6, `mean ${mean / 255}`);
    assert.ok(Math.max(...values.slice(0, 5000)) > mean + 20);
});

test('a small tile for swatches is quick', () => {
    const started = performance.now();
    generateWood('oak', [185, 155, 100], { size: 384, metres: 1.2 });
    assert.ok(performance.now() - started < 300);
});

test('veneer has no seam along its length, so a door never shows a cut in the grain', () => {
    const size = 1024;
    const metres = 3;
    const veneer = generateWood('veneer-oak', [185, 155, 100], { size, metres, boardWidth: 0.3, boardLength: [metres, metres], grooves: false, pores: 0.45 });
    const red = (x, y) => veneer.color[(y * size + x) * 4];
    // Column-to-column jumps stay the same size everywhere inside the tile.
    const steps = [];
    for (let x = 1; x < size - 1; x += 1) {
        let total = 0;
        for (let y = 0; y < size; y += 4) total += Math.abs(red(x, y) - red(x + 1, y));
        steps.push(total);
    }
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    assert.ok(Math.max(...steps) < median * 2.2, `largest ${Math.max(...steps)}, typical ${median}`);
});
