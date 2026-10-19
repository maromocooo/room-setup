// Trace the outside of connected walls, independent of drawing order/direction.
export function getFloorPolygon(walls) {
    const vertices = [];
    const neighbors = [];
    const vertexId = point => {
        let id = vertices.findIndex(p => Math.hypot(p.x - point.x, p.y - point.y) <= 0.01);
        if (id === -1) {
            id = vertices.length;
            vertices.push({ x: point.x, y: point.y });
            neighbors.push(new Set());
        }
        return id;
    };

    for (const wall of walls) {
        if (![wall.start?.x, wall.start?.y, wall.end?.x, wall.end?.y].every(Number.isFinite)) continue;
        const a = vertexId(wall.start);
        const b = vertexId(wall.end);
        if (a === b) continue;
        neighbors[a].add(b);
        neighbors[b].add(a);
    }

    // Unfinished walls and dangling partitions cannot enclose a floor.
    const leaves = neighbors.flatMap((edges, id) => edges.size < 2 ? [id] : []);
    while (leaves.length) {
        const id = leaves.pop();
        for (const other of neighbors[id]) {
            neighbors[other].delete(id);
            if (neighbors[other].size === 1) leaves.push(other);
        }
        neighbors[id].clear();
    }

    const ordered = neighbors.map((edges, id) => [...edges].sort((a, b) =>
        Math.atan2(vertices[a].y - vertices[id].y, vertices[a].x - vertices[id].x) -
        Math.atan2(vertices[b].y - vertices[id].y, vertices[b].x - vertices[id].x)
    ));
    const visited = new Set();
    let outline = null;
    let outerArea = 0;
    for (let start = 0; start < vertices.length; start++) {
        for (const next of ordered[start]) {
            if (visited.has(`${start}:${next}`)) continue;
            const ring = [];
            let a = start;
            let b = next;
            do {
                visited.add(`${a}:${b}`);
                ring.push(vertices[a]);
                const exits = ordered[b];
                const c = exits[(exits.indexOf(a) + exits.length - 1) % exits.length];
                a = b;
                b = c;
            } while (a !== start || b !== next);

            const area = ring.reduce((sum, p, i) => {
                const q = ring[(i + 1) % ring.length];
                return sum + p.x * q.y - q.x * p.y;
            }, 0) / 2;
            // Clockwise faces are exterior boundaries. Keep the largest room's
            // exterior, so internal partitions do not cut away its floor.
            if (ring.length >= 3 && area < outerArea) {
                outline = ring;
                outerArea = area;
            }
        }
    }
    return outline?.map(p => ({ x: p.x / 100, z: p.y / 100 })) ?? null;
}
