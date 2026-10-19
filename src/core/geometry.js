// Plan geometry. Plan coordinates are centimetres; x grows right, y grows
// towards the viewer (3D z).

export const wallLength = wall => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);

export function distanceToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function planBounds(walls) {
    if (!walls.length) return null;
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const { start, end } of walls) {
        bounds.minX = Math.min(bounds.minX, start.x, end.x);
        bounds.maxX = Math.max(bounds.maxX, start.x, end.x);
        bounds.minY = Math.min(bounds.minY, start.y, end.y);
        bounds.maxY = Math.max(bounds.maxY, start.y, end.y);
    }
    bounds.width = bounds.maxX - bounds.minX;
    bounds.height = bounds.maxY - bounds.minY;
    bounds.cx = (bounds.minX + bounds.maxX) / 2;
    bounds.cy = (bounds.minY + bounds.maxY) / 2;
    return bounds;
}

export const snapToGrid = (value, grid) => Math.round(value / grid) * grid;

/** Constrain `to` so the segment from `from` is horizontal, vertical or 45°. */
export function constrainAngle(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const length = dx * Math.cos(angle) + dy * Math.sin(angle);
    const round = v => Math.round(v * 100) / 100;
    return { x: round(from.x + Math.cos(angle) * length), y: round(from.y + Math.sin(angle) * length) };
}

export function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

/** Wall list for a rectangle or L shape, origin at the top-left corner. */
export function presetRoom(kind, width = 360, depth = 270) {
    const corners = kind === 'l-shape'
        ? [[0, 0], [width * 0.55, 0], [width * 0.55, depth * 0.4], [width, depth * 0.4], [width, depth], [0, depth]]
        : [[0, 0], [width, 0], [width, depth], [0, depth]];
    return corners.map(([x, y], i) => {
        const [nx, ny] = corners[(i + 1) % corners.length];
        return { start: { x, y }, end: { x: nx, y: ny } };
    });
}

const round2 = v => Math.round(v * 100) / 100;

/**
 * Clean up walls after an edit: walls on the same line that overlap or touch
 * become one wall, duplicates disappear, and zero-length walls are dropped.
 * A collinear run is still split wherever another wall's endpoint meets it,
 * so corners and T-junctions stay connected (the floor outline needs that).
 *
 * Returns new wall objects; each keeps the id and finish of a wall it came
 * from (id is null when that id is already used by another piece).
 */
export function mergeWalls(walls, tolerance = 0.5) {
    const groups = [];
    const valid = walls.filter(w => wallLength(w) > tolerance);
    for (const wall of valid) {
        const length = wallLength(wall);
        let ux = (wall.end.x - wall.start.x) / length;
        let uy = (wall.end.y - wall.start.y) / length;
        if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0)) { ux = -ux; uy = -uy; }
        const offset = wall.start.y * ux - wall.start.x * uy; // distance of the line from the origin
        let group = groups.find(g => Math.abs(g.ux * uy - g.uy * ux) < 1e-3 && Math.abs(g.offset - offset) < tolerance);
        if (!group) groups.push(group = { ux, uy, offset, origin: { ...wall.start }, items: [] });
        const along = p => (p.x - group.origin.x) * group.ux + (p.y - group.origin.y) * group.uy;
        const [a, b] = [along(wall.start), along(wall.end)].sort((p, q) => p - q);
        group.items.push({ a, b, wall });
    }

    const result = [];
    const usedIds = new Set();
    for (const group of groups) {
        const point = s => ({ x: round2(group.origin.x + group.ux * s), y: round2(group.origin.y + group.uy * s) });
        const along = p => (p.x - group.origin.x) * group.ux + (p.y - group.origin.y) * group.uy;
        const across = p => Math.abs((p.y - group.origin.y) * group.ux - (p.x - group.origin.x) * group.uy);
        const members = new Set(group.items.map(i => i.wall));
        // Endpoints of walls on other lines that touch this line.
        const junctions = valid.filter(w => !members.has(w))
            .flatMap(w => [w.start, w.end])
            .filter(p => across(p) < tolerance)
            .map(along);

        group.items.sort((p, q) => p.a - q.a);
        const spans = [];
        for (const item of group.items) {
            const last = spans.at(-1);
            if (last && item.a <= last.b + tolerance) {
                last.b = Math.max(last.b, item.b);
                last.items.push(item);
            } else {
                spans.push({ a: item.a, b: item.b, items: [item] });
            }
        }

        for (const span of spans) {
            const cuts = junctions.filter(s => s > span.a + tolerance && s < span.b - tolerance).sort((p, q) => p - q);
            const stops = [span.a, ...cuts.filter((s, i) => i === 0 || s - cuts[i - 1] > tolerance), span.b];
            for (let i = 0; i < stops.length - 1; i++) {
                const mid = (stops[i] + stops[i + 1]) / 2;
                const source = (span.items.find(it => it.a - tolerance <= mid && mid <= it.b + tolerance) ?? span.items[0]).wall;
                const id = source.id && !usedIds.has(source.id) ? source.id : null;
                if (id) usedIds.add(id);
                result.push({ ...source, id, start: point(stops[i]), end: point(stops[i + 1]), finish: source.finish ?? null });
            }
        }
    }
    return result;
}
