import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_OVERLAP, doorFrame, hingeHeights, leafOpening, slidingPanelZ } from '../src/core/door-parts.js';

const THICKNESS = 0.1;
const FACE = THICKNESS / 2;
const hole = { x0: -0.4, x1: 0.4, y1: 2 };
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('nothing lies in the plane of the opening, where it would flicker against the wall', () => {
    // The wall is cut slightly smaller than the opening, so its edges are buried in the lining.
    const wallCut = { x0: hole.x0 + OPENING_OVERLAP, x1: hole.x1 - OPENING_OVERLAP, y1: hole.y1 - OPENING_OVERLAP };
    for (const part of doorFrame(hole, THICKNESS)) {
        const [x0, x1, y0, y1] = part.box;
        for (const x of [x0, x1]) {
            assert.ok(!near(x, wallCut.x0) && !near(x, wallCut.x1), `${part.name} x ${x} on the wall's cut`);
        }
        assert.ok(!near(y0, wallCut.y1) && !near(y1, wallCut.y1), `${part.name} y on the wall's cut`);
    }
});

test('the lining covers the wall cut on every side of the opening', () => {
    const linings = doorFrame(hole, THICKNESS).filter(p => p.name === 'lining').map(p => p.box);
    const covers = (value, low, high) => low < value && value < high;
    assert.ok(linings.some(b => covers(hole.x0 + OPENING_OVERLAP, b[0], b[1])), 'left');
    assert.ok(linings.some(b => covers(hole.x1 - OPENING_OVERLAP, b[0], b[1])), 'right');
    assert.ok(linings.some(b => covers(hole.y1 - OPENING_OVERLAP, b[2], b[3])), 'top');
});

test('a lining stands clear of the wall faces, and a door at a corner has its inner face clear of the next wall', () => {
    for (const part of doorFrame(hole, THICKNESS).filter(p => p.name === 'lining')) {
        assert.ok(part.box[5] > FACE && part.box[4] < -FACE);
    }
    // A door right at a corner: the next wall's face is exactly at the opening's edge.
    const nextWallFace = hole.x0;
    const visible = doorFrame(hole, THICKNESS).filter(p => p.name === 'lining').map(p => p.box[1]);
    for (const x of visible) assert.ok(!near(x, nextWallFace));
});

test('trim sits proud on both faces, with its back just inside the wall so no gap shows', () => {
    const trim = doorFrame(hole, THICKNESS).filter(p => p.name === 'architrave').map(p => p.box);
    assert.equal(trim.length, 6);
    for (const [, , , , z0, z1] of trim) {
        const front = z1 > 0 ? z1 : -z0;
        const back = z1 > 0 ? z0 : -z1;
        assert.ok(front > FACE + 0.005 && back < FACE && !near(back, FACE));
    }
});

test('stops sit on the side away from the swing, and only when asked for', () => {
    const z = side => doorFrame(hole, THICKNESS, { side }).filter(p => p.name === 'stop').map(p => p.box[4] + p.box[5]);
    assert.ok(z(1).every(v => v < 0));
    assert.ok(z(-1).every(v => v > 0));
    assert.equal(doorFrame(hole, THICKNESS, { withStop: false }).filter(p => p.name === 'stop').length, 0);
});

test('the leaf fits inside the lining, clear of the floor and the head', () => {
    const space = leafOpening(hole);
    const lining = doorFrame(hole, THICKNESS).filter(p => p.name === 'lining').map(p => p.box);
    assert.ok(space.x0 > lining[0][1] && space.x1 < lining[1][0]);
    assert.ok(space.y1 < lining[2][2] && space.y0 > 0);
});

test('three hinges, within the leaf', () => {
    const space = leafOpening(hole);
    const heights = hingeHeights(space);
    assert.equal(heights.length, 3);
    assert.ok(heights.every(y => y > space.y0 && y < space.y1));
});

test('a sliding panel runs clear of the trim', () => {
    const trimFront = Math.max(...doorFrame(hole, THICKNESS).filter(p => p.name === 'architrave').map(p => p.box[5]));
    assert.ok(slidingPanelZ(THICKNESS, 1)[0] > trimFront);
    assert.ok(slidingPanelZ(THICKNESS, -1)[1] < -trimFront);
});
