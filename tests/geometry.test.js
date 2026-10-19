import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainAngle, distanceToSegment, mergeWalls, planBounds, polygonArea, presetRoom, snapToGrid, wallLength } from '../src/core/geometry.js';
import { getFloorPolygon } from '../src/core/floor-outline.js';

test('wall length and point-to-segment distance', () => {
    assert.equal(wallLength({ start: { x: 0, y: 0 }, end: { x: 300, y: 400 } }), 500);
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    assert.equal(distanceToSegment({ x: 50, y: 20 }, a, b), 20);
    assert.equal(distanceToSegment({ x: -30, y: 40 }, a, b), 50);
    assert.equal(distanceToSegment({ x: 5, y: 5 }, a, a), Math.hypot(5, 5));
});

test('grid snapping and angle constraint', () => {
    assert.equal(snapToGrid(14, 10), 10);
    assert.equal(snapToGrid(15, 10), 20);
    assert.deepEqual(constrainAngle({ x: 0, y: 0 }, { x: 100, y: 8 }), { x: 100, y: 0 });
    assert.deepEqual(constrainAngle({ x: 0, y: 0 }, { x: -6, y: 90 }), { x: 0, y: 90 });
    const diagonal = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 90 });
    assert.ok(Math.abs(diagonal.x - diagonal.y) < 0.02);
});

test('templates are closed rooms with the requested size', () => {
    const rect = presetRoom('rectangle', 400, 300);
    assert.equal(rect.length, 4);
    assert.deepEqual(planBounds(rect), { minX: 0, maxX: 400, minY: 0, maxY: 300, width: 400, height: 300, cx: 200, cy: 150 });
    const polygon = getFloorPolygon(rect);
    assert.equal(polygonArea(polygon.map(p => ({ x: p.x, y: p.z }))), 12);

    const l = presetRoom('l-shape', 400, 300);
    assert.equal(l.length, 6);
    const lPolygon = getFloorPolygon(l);
    assert.ok(lPolygon, 'L-shape should close');
    assert.ok(polygonArea(lPolygon.map(p => ({ x: p.x, y: p.z }))) < 12);
});

test('bounds of nothing is null', () => {
    assert.equal(planBounds([]), null);
});

const seg = (x1, y1, x2, y2, id) => ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
const key = w => [w.start, w.end].map(p => `${p.x},${p.y}`).sort().join('|');

test('redrawn pieces of one wall merge into a single wall', () => {
    // The left wall drawn as 100 + 40 + 20 cm pieces, plus an exact duplicate.
    const walls = [
        seg(0, 0, 0, 100, 'a'), seg(0, 100, 0, 140, 'b'), seg(0, 160, 0, 140, 'c'),
        seg(0, 160, 180, 160, 'd'), seg(180, 160, 0, 160, 'e'),
    ];
    const merged = mergeWalls(walls);
    assert.deepEqual(merged.map(key).sort(), ['0,0|0,160', '0,160|180,160']);
    assert.deepEqual(new Set(merged.map(w => w.id)).size, 2, 'ids stay unique');
});

test('overlapping walls merge, corners and T-junctions stay split', () => {
    const walls = [
        seg(0, 0, 300, 0), seg(200, 0, 400, 0),   // overlapping → one 0..400
        seg(150, 0, 150, 200),                     // partition meeting it at x=150
        seg(400, 0, 400, 200),                     // corner at x=400
    ];
    const merged = mergeWalls(walls).map(key).sort();
    assert.deepEqual(merged, ['0,0|150,0', '150,0|150,200', '150,0|400,0', '400,0|400,200']);
});

test('a closed room keeps its walls and its floor', () => {
    const room = presetRoom('l-shape', 400, 300);
    const merged = mergeWalls([...room, ...room]);
    assert.equal(merged.length, 6);
    assert.ok(getFloorPolygon(merged));
    assert.deepEqual(mergeWalls([seg(0, 0, 0, 0.2)]), [], 'zero-length walls are dropped');
});
