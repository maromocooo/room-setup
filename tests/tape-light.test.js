import test from 'node:test';
import assert from 'node:assert/strict';
import { clampTapeLength, createLight, lightHeight, movePatch, normalizeDegrees, tapeBetween, tapeEnds } from '../src/core/lights.js';

test('a new tape is 1 m long, level and casts no shadows', () => {
    const tape = createLight('tape', { x: 100, y: 200 });
    assert.equal(tape.length, 100);
    assert.equal(tape.rotation, 0);
    assert.equal(tape.emit, 'side');
    assert.equal(tape.shadows, false);
    assert.equal(tape.height, 100);
    assert.equal(createLight('ceiling', { x: 0, y: 0 }).shadows, true);
    assert.equal(createLight('ceiling', { x: 0, y: 0 }).length, undefined);
});

test('ends follow the length and direction', () => {
    assert.deepEqual(tapeEnds({ x: 100, y: 50, length: 200, rotation: 0 }), [{ x: 0, y: 50 }, { x: 200, y: 50 }]);
    const [a, b] = tapeEnds({ x: 100, y: 50, length: 200, rotation: 90 });
    assert.ok(Math.abs(a.x - 100) < 1e-9 && Math.abs(a.y + 50) < 1e-9);
    assert.ok(Math.abs(b.x - 100) < 1e-9 && Math.abs(b.y - 150) < 1e-9);
});

test('stretching between two points is the inverse of its ends', () => {
    const patch = tapeBetween({ x: 0, y: 0 }, { x: 0, y: 300 });
    assert.deepEqual(patch, { x: 0, y: 150, length: 300, rotation: 90 });
    const [a, b] = tapeEnds(patch);
    assert.ok(Math.hypot(a.x, a.y) < 1e-9 && Math.hypot(b.x, b.y - 300) < 1e-9);
    assert.equal(tapeBetween({ x: 0, y: 0 }, { x: -100, y: 0 }).rotation, 180);
});

test('ends too close together, or too far apart, change nothing', () => {
    assert.deepEqual(tapeBetween({ x: 10, y: 10 }, { x: 11, y: 10 }), {});
    assert.deepEqual(tapeBetween({ x: 0, y: 0 }, { x: 3000, y: 0 }), {});
});

test('length and direction are kept in range', () => {
    assert.equal(clampTapeLength(1), 5);
    assert.equal(clampTapeLength(99999), 2000);
    assert.equal(clampTapeLength(120.4), 120);
    assert.equal(normalizeDegrees(-90), 270);
    assert.equal(normalizeDegrees(450), 90);
});

test('a tape can sit right under the ceiling, and moves like a lamp', () => {
    const tape = { ...createLight('tape', { x: 0, y: 0 }), height: 500 };
    assert.equal(lightHeight(tape, 240), 239);
    assert.deepEqual(movePatch(tape, { x: 12.4, y: 7.6, height: 180 }, 240), { x: 12, y: 8, height: 180 });
});
