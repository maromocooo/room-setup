import test from 'node:test';
import assert from 'node:assert/strict';
import { STEP_OVER, WALK_RADIUS, eyeHeight, walkObstacles, walkStep } from '../src/core/walk.js';

// 400 × 300 cm room; the bottom wall (y = 300) runs from x = 0 to 400.
const walls = [
    { id: 'top', start: { x: 0, y: 0 }, end: { x: 400, y: 0 } },
    { id: 'right', start: { x: 400, y: 0 }, end: { x: 400, y: 300 } },
    { id: 'bottom', start: { x: 400, y: 300 }, end: { x: 0, y: 300 } },
    { id: 'left', start: { x: 0, y: 300 }, end: { x: 0, y: 0 } },
];
// A 90 cm door in the middle of the bottom wall (offset from its start at x = 400).
const door = { id: 'd', kind: 'door', wallId: 'bottom', offset: 200, width: 90, height: 200, sill: 0 };
const window_ = { id: 'w', kind: 'window', wallId: 'top', offset: 200, width: 165, height: 110, sill: 90 };

test('walls stop you and you slide along them', () => {
    const segments = walkObstacles(walls, []);
    const end = walkStep({ x: 200, y: 150 }, { x: 0, y: -500 }, segments);
    assert.ok(end.y >= WALK_RADIUS, `stopped at ${end.y}`);
    assert.ok(Math.abs(end.x - 200) < 1e-6);
    // Moving diagonally into the wall keeps the sideways part.
    const slide = walkStep({ x: 200, y: 40 }, { x: 50, y: -50 }, segments);
    assert.ok(slide.x > 245 && slide.y >= WALK_RADIUS);
});

test('a fast move cannot tunnel through a wall', () => {
    const end = walkStep({ x: 380, y: 150 }, { x: 1000, y: 0 }, walkObstacles(walls, []));
    assert.ok(end.x < 400);
});

test('doors let you through, windows do not', () => {
    const segments = walkObstacles(walls, [door, window_]);
    const out = walkStep({ x: 200, y: 250 }, { x: 0, y: 200 }, segments);
    assert.ok(out.y > 400, `went through the door to ${out.y}`);
    const blocked = walkStep({ x: 200, y: 50 }, { x: 0, y: -200 }, segments);
    assert.ok(blocked.y > 0, 'window still blocks');
    // Beside the door the wall still blocks.
    const beside = walkStep({ x: 60, y: 250 }, { x: 0, y: 200 }, segments);
    assert.ok(beside.y < 300);
});

test('tall furniture blocks, low furniture can be stepped over', () => {
    const bed = { x: 200, z: 150, width: 55, depth: 55, rotation: 0, height: 15 };
    const desk = { ...bed, height: 72 };
    assert.equal(walkObstacles([], [], [bed]).length, 0);
    const segments = walkObstacles([], [], [desk]);
    assert.equal(segments.length, 4);
    const end = walkStep({ x: 50, y: 150 }, { x: 300, y: 0 }, segments);
    assert.ok(end.x <= 200 - 27.5 - WALK_RADIUS + 1e-6, `stopped at ${end.x}`);
    assert.ok(STEP_OVER > 15 && STEP_OVER < 72);
});

test('eye height follows very low ceilings', () => {
    assert.equal(eyeHeight(240), 160);
    assert.equal(eyeHeight(170), 140);
});
