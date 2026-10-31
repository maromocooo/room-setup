import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWallFinish, wallSwatch } from '../src/core/wallpaper.js';
import { WALL_PRESETS } from '../src/core/textures.js';

const SIZE = 512;
const base = [240, 240, 238];
const mapsFor = kind => generateWallFinish(`test-${kind}`, base, kind, { size: SIZE, metres: 1 });
const KINDS = ['pebble', 'woven', 'plaster', 'paint'];

function meanStep(pixels, a, b, along) {
    let total = 0;
    for (let i = 0; i < SIZE; i++) {
        const p = along === 'x' ? [i * SIZE + a, i * SIZE + b] : [a * SIZE + i, b * SIZE + i];
        total += Math.abs(pixels[p[0] * 4] - pixels[p[1] * 4]);
    }
    return total / SIZE;
}

test('every preset names a finish that exists, and they differ', () => {
    for (const preset of WALL_PRESETS) assert.ok(KINDS.includes(preset.finish), preset.id);
    assert.notDeepEqual(mapsFor('pebble').normal, mapsFor('plaster').normal);
    assert.notDeepEqual(mapsFor('woven').normal, mapsFor('paint').normal);
});

test('same preset, same wall', () => {
    assert.deepEqual(mapsFor('plaster').normal, mapsFor('plaster').normal);
});

for (const kind of KINDS) {
    test(`${kind}: no seam where the tile repeats`, () => {
        const { normal } = mapsFor(kind);
        for (const along of ['x', 'y']) {
            // One column's step varies, so compare the edge with how much steps vary inside.
            const steps = [];
            for (let i = 20; i < SIZE - 20; i += 3) steps.push(meanStep(normal, i, i + 1, along));
            const edge = meanStep(normal, SIZE - 1, 0, along);
            assert.ok(edge <= Math.max(...steps) * 1.15, `${along}: edge ${edge}, largest inside ${Math.max(...steps)}`);
        }
    });

    test(`${kind}: the colour stays close to plain, and the relief is really there`, () => {
        const { color, normal } = mapsFor(kind);
        let low = 255;
        let high = 0;
        let tilted = 0;
        for (let i = 0; i < color.length; i += 4) {
            low = Math.min(low, color[i]);
            high = Math.max(high, color[i]);
            if (Math.abs(normal[i] - 127.5) > 3 || Math.abs(normal[i + 1] - 127.5) > 3) tilted++;
        }
        assert.ok(high <= 241 && low >= 215, `${low}..${high}`);
        assert.ok(tilted > SIZE * SIZE * 0.05, `tilted ${tilted}`);
    });
}

test('normals are unit length and roughness suits a matt wall', () => {
    for (const kind of KINDS) {
        const { normal, roughness } = mapsFor(kind);
        for (let i = 0; i < normal.length; i += 4096) {
            const n = [normal[i], normal[i + 1], normal[i + 2]].map(v => v / 255 * 2 - 1);
            assert.ok(Math.abs(Math.hypot(...n) - 1) < 0.03);
        }
        for (let i = 1; i < roughness.length; i += 4000) {
            const value = roughness[i] / 255;
            assert.ok(value > 0.55 && value < 0.98, `${kind} ${value}`);
        }
    }
});

test('a lit swatch is quick to make, and shows the relief', () => {
    const started = performance.now();
    const swatch = wallSwatch('standard', base, 'pebble', 192);
    assert.ok(performance.now() - started < 300);
    const values = new Set();
    for (let i = 0; i < swatch.length; i += 4) values.add(swatch[i]);
    assert.ok(values.size > 10);
});
