import test from 'node:test';
import assert from 'node:assert/strict';
import { TILT_TURNS, turnTilt } from '../src/core/tilt.js';

const apply = (tilt, name) => turnTilt(tilt, ...TILT_TURNS[name]);
const near = (a, b) => ['x', 'y', 'z'].every(k => Math.abs(((a[k] - b[k]) % 360 + 540) % 360 - 180) < 0.01);

test('flipping twice returns to upright', () => {
    const once = apply({}, 'flip');
    assert.ok(near(once, { x: 180, y: 0, z: 0 }), JSON.stringify(once));
    assert.ok(near(apply(once, 'flip'), { x: 0, y: 0, z: 0 }));
});

test('opposite tips cancel, four tips go full circle', () => {
    assert.ok(near(apply(apply({}, 'forward'), 'backward'), { x: 0, y: 0, z: 0 }));
    let t = {};
    for (let i = 0; i < 4; i++) t = apply(t, 'left');
    assert.ok(near(t, { x: 0, y: 0, z: 0 }));
});

test('turns compose about the room axes', () => {
    // Tip forward, then flip upside down: equivalent to tipping backward.
    assert.ok(near(apply(apply({}, 'forward'), 'flip'), apply({}, 'backward')));
});

import { attachOffset, lightPlacement } from '../src/core/lights.js';

test('attached lights follow their furniture and drag back to offsets', () => {
    const pose = { x: 200, z: 100, y: 0, yaw: Math.PI / 2 };
    const light = { attach: { furnitureId: 'lamp', dx: 10, dy: 140, dz: 30 } };
    const placed = lightPlacement(light, 240, () => pose);
    // yaw 90°: local +x → world −z (plan up), local +z → world +x.
    assert.ok(Math.abs(placed.x - 230) < 1e-9 && Math.abs(placed.y - 90) < 1e-9 && placed.height === 140);
    const back = attachOffset({ x: placed.x, y: placed.y }, pose);
    assert.ok(Math.abs(back.dx - 10) < 1e-9 && Math.abs(back.dz - 30) < 1e-9);
    assert.equal(lightPlacement(light, 240, () => null), null);
});

import { dimensionsAfterTurn, fitScales, turnDimensions } from '../src/core/tilt.js';

const LAMP = { width: 36, depth: 30, height: 130 };
const stretch = (size, dims) => {
    const { x, y, z } = fitScales(size, dims);
    return Math.max(x, y, z) / Math.min(x, y, z);
};

test('a quarter turn swaps two sides, a half turn none', () => {
    assert.deepEqual(turnDimensions(LAMP, 'forward'), { width: 36, depth: 130, height: 30 });
    assert.deepEqual(turnDimensions(LAMP, 'backward'), { width: 36, depth: 130, height: 30 });
    assert.deepEqual(turnDimensions(LAMP, 'left'), { width: 130, depth: 30, height: 36 });
    assert.deepEqual(turnDimensions(LAMP, 'right'), { width: 130, depth: 30, height: 36 });
    assert.deepEqual(turnDimensions(LAMP, 'flip'), LAMP);
});

test('a standing item tipped over keeps its shape, and takes its size with it', () => {
    // A true-to-size lamp after tipping forward: now 1.3 m deep and 0.3 m high.
    const tipped = { x: 0.36, y: 0.3, z: 1.3 };
    const after = dimensionsAfterTurn(tipped, LAMP, turnDimensions(LAMP, 'forward'));
    assert.deepEqual(after, { width: 36, depth: 130, height: 30 });
    assert.ok(stretch(tipped, after) < 1.01, 'not stretched');
    assert.ok(stretch(tipped, LAMP) > 10, 'keeping the old size is what crushed it');
});

test('a model generated lying down, stood up, keeps the size that was entered', () => {
    // Generators return any scale. Upright now, it has the proportions of the size entered.
    const stoodUp = { x: 0.28, y: 1, z: 0.23 };
    assert.deepEqual(dimensionsAfterTurn(stoodUp, LAMP, turnDimensions(LAMP, 'left')), LAMP);
});

test('a half turn, or an item as wide as it is tall, changes no size', () => {
    assert.deepEqual(dimensionsAfterTurn({ x: 0.36, y: 1.3, z: 0.3 }, LAMP, turnDimensions(LAMP, 'flip')), LAMP);
    const cube = { width: 50, depth: 50, height: 50 };
    assert.deepEqual(dimensionsAfterTurn({ x: 1, y: 1, z: 1 }, cube, turnDimensions(cube, 'forward')), cube);
});

test('fitting keeps the longer horizontal side with the longer of width and depth', () => {
    const sofa = { width: 180, depth: 80, height: 70 };
    const sideways = fitScales({ x: 0.5, y: 0.5, z: 1 }, sofa);
    assert.ok(Math.abs(sideways.z * 1 - 1.8) < 1e-9 && Math.abs(sideways.x * 0.5 - 0.8) < 1e-9);
});
