// Where the pieces of a door go, built the way real ones are: a lining inside the
// wall's opening, architraves over the joint on both faces, stops, and leaves that
// fit inside the lining. No three.js here, so the layout can be tested.
//
// Coordinates are the wall's local metres: x along the wall, y up, z through it.
// A part is { name, box: [x0, x1, y0, y1, z0, z1] }.
//
// Nothing visible may lie in the plane of a wall face: two coplanar surfaces take
// turns being drawn as the camera moves, which shows up as flickering. So the
// lining's faces sit inside the opening, clear of its sides, and the wall's own
// opening is drawn slightly smaller than the lining (OPENING_OVERLAP) so that its
// edges are buried in it.

export const OPENING_OVERLAP = 0.002;

const LINING = 0.018;        // thickness of the lining boards
const LINING_PROUD = 0.002;  // how far the lining stands past the wall's faces
const ARCHITRAVE = 0.065;    // width of the trim around the opening
const ARCHITRAVE_DEPTH = 0.012;
const REVEAL = 0.004;        // the small step between the trim and the lining's inner face
const STOP = 0.012;          // the strip the leaf closes against
const CLEARANCE = 0.002;     // gap around the leaf
const FLOOR_GAP = 0.008;
export const LEAF_THICKNESS = 0.036;
export const LEVER_HEIGHT = 1.0;

/** Lining, architraves and stops. `withStop`: false for sliding doors and bare openings. */
export function doorFrame({ x0, x1, y1 }, thickness, { side = 1, withStop = true } = {}) {
    const face = thickness / 2;
    const depth = face + LINING_PROUD;
    const parts = [
        { name: 'lining', box: [x0, x0 + LINING, 0, y1, -depth, depth] },
        { name: 'lining', box: [x1 - LINING, x1, 0, y1, -depth, depth] },
        { name: 'lining', box: [x0 + LINING, x1 - LINING, y1 - LINING, y1, -depth, depth] },
    ];
    const inner = { left: x0 + LINING - REVEAL, right: x1 - LINING + REVEAL, top: y1 - LINING + REVEAL };
    for (const sign of [-1, 1]) {
        // Starts just inside the wall so no gap shows behind it, and ends proud of the lining.
        const z = sign > 0 ? [face - 0.001, depth + ARCHITRAVE_DEPTH] : [-depth - ARCHITRAVE_DEPTH, -face + 0.001];
        parts.push(
            { name: 'architrave', box: [inner.left - ARCHITRAVE, inner.left, 0, inner.top, ...z] },
            { name: 'architrave', box: [inner.right, inner.right + ARCHITRAVE, 0, inner.top, ...z] },
            { name: 'architrave', box: [inner.left - ARCHITRAVE, inner.right + ARCHITRAVE, inner.top, inner.top + ARCHITRAVE, ...z] },
        );
    }
    if (withStop) {
        // On the side away from the swing, right behind the closed leaf.
        const near = LEAF_THICKNESS / 2 + 0.001;
        const z = side > 0 ? [-near - 0.02, -near] : [near, near + 0.02];
        parts.push(
            { name: 'stop', box: [x0 + LINING, x0 + LINING + STOP, 0, y1 - LINING, ...z] },
            { name: 'stop', box: [x1 - LINING - STOP, x1 - LINING, 0, y1 - LINING, ...z] },
            { name: 'stop', box: [x0 + LINING + STOP, x1 - LINING - STOP, y1 - LINING - STOP, y1 - LINING, ...z] },
        );
    }
    return parts;
}

/** The space a leaf or a pair of leaves fills inside the lining. */
export function leafOpening({ x0, x1, y1 }) {
    return { x0: x0 + LINING + CLEARANCE, x1: x1 - LINING - CLEARANCE, y0: FLOOR_GAP, y1: y1 - LINING - CLEARANCE };
}

/** Hinges along a leaf's edge: heights, from the floor. */
export function hingeHeights({ y0, y1 }) {
    return [y0 + 0.2, (y0 + y1) / 2 + 0.2, y1 - 0.2];
}

/** A sliding door runs clear of the trim on the wall's face. */
export function slidingPanelZ(thickness, side) {
    const near = thickness / 2 + LINING_PROUD + ARCHITRAVE_DEPTH + 0.004;
    return side > 0 ? [near, near + LEAF_THICKNESS] : [-near - LEAF_THICKNESS, -near];
}
