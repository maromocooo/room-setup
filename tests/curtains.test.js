import test from 'node:test';
import assert from 'node:assert/strict';
import { CURTAIN_MATERIALS, DEFAULT_CURTAIN, curtainLayout, findCurtainMaterial, foldDepth, normalizeCurtain, panelWidthAt } from '../src/core/curtains.js';
import { clampOpening } from '../src/core/openings.js';

const window1m = { x0: -0.5, x1: 0.5, y0: 0.9, y1: 2, wallHeight: 2.4, wallHalf: 2, thickness: 0.1 };
const layoutAt = (open, more = {}) => curtainLayout({ ...window1m, open, ...more });

test('closed panels meet in the middle of the window and cover it', () => {
    const { panels, tied } = layoutAt(0);
    assert.equal(tied, false);
    const [left, right] = panels;
    assert.ok(left.outer < -0.5 && right.outer > 0.5);
    assert.ok(Math.abs(left.outer + left.width - 0) < 1e-9);
    assert.ok(Math.abs(right.outer - right.width - 0) < 1e-9);
});

test('drawn back, the panels clear most of the glass and are tied', () => {
    const { panels, tied } = layoutAt(100);
    assert.equal(tied, true);
    const [left, right] = panels;
    const clear = (right.outer - right.width) - (left.outer + left.width);
    assert.ok(clear > 0.6, `clear opening ${clear}`);
});

test('any opening at all brings the tieback, and it pinches the panel', () => {
    assert.equal(layoutAt(2).tied, false);
    assert.equal(layoutAt(3).tied, true);
    const layout = layoutAt(70);
    const panel = layout.panels[0];
    const atTie = panelWidthAt(panel, true, 0.62);
    assert.ok(atTie < panel.width * 0.75, 'narrow at the tieback');
    assert.ok(Math.abs(panelWidthAt(panel, true, 0) - panel.width) < 1e-9, 'full width at the rod');
    assert.ok(panelWidthAt(panel, true, 1) > atTie, 'fuller again at the hem');
});

test('gathered cloth has deeper folds', () => {
    const panel = layoutAt(100).panels[0];
    assert.ok(foldDepth(panel, panel.width) > foldDepth(panel, panel.closed));
    assert.ok(foldDepth(panel, panel.width) < 0.06, 'stays in front of the wall');
});

test('stays in the room: under the ceiling, above the floor, on its wall', () => {
    const tallWindow = layoutAt(50, { y0: 0, y1: 2.38 });
    assert.ok(tallWindow.rod.y <= 2.4 - 0.02);
    assert.ok(tallWindow.bottom > 0, 'clears the floor');
    const atCorner = layoutAt(50, { x0: 1.5, x1: 1.95 });
    assert.ok(atCorner.rod.x1 <= 2);
    assert.ok(atCorner.panels[1].outer <= 2);
});

test('length follows the window: to the floor when low, just past the sill when high', () => {
    assert.ok(layoutAt(0, { y0: 0.1 }).bottom < 0.05);
    assert.ok(Math.abs(layoutAt(0, { y0: 0.9 }).bottom - 0.75) < 1e-9);
});

test('it hangs on the room side', () => {
    assert.ok(layoutAt(0, { side: 1 }).z > 0.05);
    assert.ok(layoutAt(0, { side: -1 }).z < -0.05);
});

test('every window and fabric gives a finite layout', () => {
    for (const material of CURTAIN_MATERIALS) assert.equal(findCurtainMaterial(material.id).id, material.id);
    for (const open of [0, 1, 3, 50, 100]) {
        for (const panel of layoutAt(open).panels) {
            for (const down of [0, 0.3, 0.62, 0.9, 1]) {
                const width = panelWidthAt(panel, open >= 3, down);
                assert.ok(Number.isFinite(width) && width > 0, `open ${open} down ${down}`);
            }
        }
    }
});

test('bad curtain data is repaired, not trusted', () => {
    assert.equal(normalizeCurtain(null), null);
    assert.equal(normalizeCurtain('yes'), null);
    assert.deepEqual(normalizeCurtain({ enabled: true, material: 'nope', color: 'red', open: 500 }),
        { enabled: true, material: 'linen', color: DEFAULT_CURTAIN.color, open: 100 });
    assert.equal(normalizeCurtain({ enabled: 'true' }).enabled, false);
    assert.equal(normalizeCurtain({ color: '#ABCDEF' }).color, '#abcdef');
});

test('openings keep a curtain through clamping', () => {
    const wall = { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } };
    const opening = { kind: 'window', offset: 100, width: 100, height: 100, sill: 90, curtain: { enabled: true, material: 'velvet', color: '#112233', open: 40 } };
    assert.deepEqual(clampOpening(opening, wall, 240).curtain, opening.curtain);
    assert.equal(clampOpening({ kind: 'window', offset: 100, width: 100, height: 100, sill: 90 }, wall, 240).curtain, undefined);
});
