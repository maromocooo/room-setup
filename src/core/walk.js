// Walking around the room at eye level: what blocks you and how you slide
// along it. Plan coordinates in centimetres (x, y), like the store.
//
// Walls block, except where a door is. Furniture taller than STEP_OVER
// blocks with its footprint; lower things (rugs, a dog bed) can be stepped over.

import { wallFrame } from './openings.js';

export const WALK_RADIUS = 25;      // half the walker's shoulder width
export const STEP_OVER = 35;        // furniture lower than this does not block
const WALL_HALF = 5;                // half the 3D wall thickness

/**
 * Segments that block walking: { a, b, pad } where pad is extra clearance
 * (half a wall's thickness). `footprints` are the scene's plan rectangles
 * ({ x, z, width, depth, rotation, height } in cm).
 */
export function walkObstacles(walls, openings, footprints = []) {
    const segments = [];
    for (const wall of walls) {
        const { length, ux, uy } = wallFrame(wall);
        if (!length) continue;
        const gaps = openings
            .filter(o => o.wallId === wall.id && o.kind === 'door')
            .map(o => [o.offset - o.width / 2, o.offset + o.width / 2])
            .sort((a, b) => a[0] - b[0]);
        let from = 0;
        for (const [start, end] of [...gaps, [length, length]]) {
            if (start > from) {
                segments.push({
                    a: { x: wall.start.x + ux * from, y: wall.start.y + uy * from },
                    b: { x: wall.start.x + ux * start, y: wall.start.y + uy * start },
                    pad: WALL_HALF,
                });
            }
            from = Math.max(from, end);
        }
    }
    for (const f of footprints) {
        if ((f.height ?? Infinity) < STEP_OVER) continue;
        const cos = Math.cos(f.rotation);
        const sin = Math.sin(f.rotation);
        // Same rotation as three.js about +Y: local (lx, lz) → (lx·cos + lz·sin, −lx·sin + lz·cos).
        const corner = (lx, lz) => ({ x: f.x + lx * cos + lz * sin, y: f.z - lx * sin + lz * cos });
        const w = f.width / 2;
        const d = f.depth / 2;
        const c = [corner(-w, -d), corner(w, -d), corner(w, d), corner(-w, d)];
        for (let i = 0; i < 4; i++) segments.push({ a: c[i], b: c[(i + 1) % 4], pad: 0 });
    }
    return segments;
}

function closestOnSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * Move from `position` by `delta` (cm), sliding along anything in the way.
 * Long moves are split into small steps so you cannot pass through a wall.
 */
export function walkStep(position, delta, segments, radius = WALK_RADIUS) {
    const distance = Math.hypot(delta.x, delta.y);
    const steps = Math.max(1, Math.ceil(distance / (radius / 2)));
    let p = { ...position };
    for (let s = 0; s < steps; s++) {
        p = { x: p.x + delta.x / steps, y: p.y + delta.y / steps };
        for (let iteration = 0; iteration < 3; iteration++) {
            let pushed = false;
            for (const seg of segments) {
                const q = closestOnSegment(p, seg.a, seg.b);
                const dx = p.x - q.x;
                const dy = p.y - q.y;
                const d = Math.hypot(dx, dy);
                const min = radius + seg.pad;
                if (d >= min) continue;
                if (d < 1e-6) continue; // exactly on the line: leave it, the next step resolves it
                p = { x: q.x + (dx / d) * min, y: q.y + (dy / d) * min };
                pushed = true;
            }
            if (!pushed) break;
        }
    }
    return p;
}

/** Eye height (cm): 160 cm, or 30 cm under a very low ceiling. */
export const eyeHeight = ceilingHeight => Math.min(160, ceilingHeight - 30);
