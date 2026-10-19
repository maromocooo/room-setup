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
