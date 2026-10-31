// Doors and windows. An opening sits on one wall: `offset` is the distance
// in cm from the wall's start to the opening's centre.
//
//   { id, kind: 'door' | 'window', preset, style, wallId, offset,
//     width, height, sill,          // cm; sill = height of the bottom edge above the floor
//     hinge: 'start' | 'end',       // doors: jamb nearer the wall's start or end
//     side: 1 | -1,                 // doors: swing towards the wall's left (+1) or right (-1)
//     color,                        // doors: id from DOOR_COLORS
//     open,                         // doors: how far open in the 3D view, 0–100 (%)
//     curtain }                     // windows: see core/curtains.js; `side` is the room side
//
// Preset ids are stored in project files; never rename them.

import { normalizeCurtain } from './curtains.js';
import { distanceToSegment, wallLength } from './geometry.js';
import { FLOOR_PRESETS } from './textures.js';

export const OPENING_PRESETS = [
    { id: 'door-hinged', kind: 'door', style: 'hinged', width: 80, height: 200, sill: 0 },
    { id: 'door-double', kind: 'door', style: 'double', width: 140, height: 200, sill: 0 },
    { id: 'door-sliding', kind: 'door', style: 'sliding', width: 90, height: 200, sill: 0 },
    { id: 'door-opening', kind: 'door', style: 'opening', width: 90, height: 200, sill: 0 },
    { id: 'window-sliding', kind: 'window', style: 'sliding', width: 165, height: 110, sill: 90 },
    { id: 'window-patio', kind: 'window', style: 'sliding', width: 165, height: 200, sill: 0 },
    { id: 'window-tall', kind: 'window', style: 'sliding', width: 170, height: 200, sill: 10 },
    { id: 'window-fixed', kind: 'window', style: 'fixed', width: 90, height: 90, sill: 90 },
    { id: 'window-casement', kind: 'window', style: 'casement', width: 60, height: 90, sill: 100 },
    { id: 'window-high', kind: 'window', style: 'fixed', width: 120, height: 30, sill: 180 },
];

// Door finishes: painted, or any of the woods the floor can be, since doors and
// floors are so often chosen to match. `grain` means wood veneer.
export const DOOR_COLORS = [
    { id: 'white', color: [242, 240, 236] },
    { id: 'grey', color: [150, 150, 147] },
    { id: 'black', color: [50, 50, 52] },
    ...FLOOR_PRESETS.map(({ id, color }) => ({ id, color, grain: true })),
];

// Ids from before doors shared the floor's woods. They stay valid in saved projects.
const OLD_DOOR_COLORS = { maple: 'hardMaple', walnut: 'blackWalnut' };

/** The finish for a stored colour id, old or new. */
export function findDoorColor(id) {
    const current = OLD_DOOR_COLORS[id] ?? id;
    return DOOR_COLORS.find(c => c.id === current) ?? DOOR_COLORS.find(c => c.id === DEFAULT_DOOR_COLOR);
}

export const DEFAULT_DOOR_COLOR = 'white';
export const DEFAULT_DOOR_OPEN = 25;

export const STYLES = {
    door: ['hinged', 'double', 'sliding', 'opening'],
    window: ['sliding', 'fixed', 'casement'],
};

export const findOpeningPreset = id => OPENING_PRESETS.find(p => p.id === id) ?? null;

const EDGE_MARGIN = 5; // keep openings off the very corner
const MIN_SIZE = 20;

let nextId = 1;
export const newOpeningId = () => `o${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Direction, length and left-hand normal of a wall (plan coordinates). */
export function wallFrame(wall) {
    const length = wallLength(wall);
    const ux = (wall.end.x - wall.start.x) / (length || 1);
    const uy = (wall.end.y - wall.start.y) / (length || 1);
    return { length, ux, uy, nx: -uy, ny: ux };
}

/** Plan point at `offset` cm along a wall. */
export function pointOnWall(wall, offset) {
    const { ux, uy } = wallFrame(wall);
    return { x: wall.start.x + ux * offset, y: wall.start.y + uy * offset };
}

/** Distance along the wall of the projection of `point`. */
export function offsetOnWall(wall, point) {
    const { ux, uy } = wallFrame(wall);
    return (point.x - wall.start.x) * ux + (point.y - wall.start.y) * uy;
}

/** Keep an opening inside its wall and below the ceiling. Returns a new object. */
export function clampOpening(opening, wall, ceilingHeight = 240) {
    const length = wallLength(wall);
    const width = Math.max(MIN_SIZE, Math.min(opening.width, length - EDGE_MARGIN * 2));
    const sill = Math.max(0, Math.min(opening.sill, ceilingHeight - MIN_SIZE - 5));
    const height = Math.max(MIN_SIZE, Math.min(opening.height, ceilingHeight - 5 - sill));
    const half = width / 2;
    if (opening.curtain !== undefined) opening = { ...opening, curtain: normalizeCurtain(opening.curtain) };
    if (opening.open !== undefined) opening = { ...opening, open: Math.max(0, Math.min(100, Number(opening.open) || 0)) };
    const offset = Math.min(Math.max(opening.offset, half + EDGE_MARGIN), Math.max(half + EDGE_MARGIN, length - half - EDGE_MARGIN));
    return { ...opening, width, height, sill, offset };
}

/**
 * New opening from a preset, centred where the user clicked on `wall`.
 * Doors open towards `inside` (a point in the room) when given.
 */
export function createOpening(preset, wall, point, ceilingHeight, inside = null) {
    const { nx, ny } = wallFrame(wall);
    const side = inside && (inside.x - point.x) * nx + (inside.y - point.y) * ny < 0 ? -1 : 1;
    return clampOpening({
        id: newOpeningId(),
        kind: preset.kind,
        preset: preset.id,
        style: preset.style,
        wallId: wall.id,
        offset: offsetOnWall(wall, point),
        width: preset.width,
        height: preset.height,
        sill: preset.sill,
        hinge: 'start',
        side,
        ...(preset.kind === 'door' ? { color: DEFAULT_DOOR_COLOR, open: DEFAULT_DOOR_OPEN } : {}),
    }, wall, ceilingHeight);
}

/**
 * Carry openings over a wall edit (merge, split, delete). Each opening keeps
 * its position in the plan and moves to whichever new wall runs through that
 * point in the same direction; openings whose wall is gone are dropped.
 */
export function reanchorOpenings(openings, oldWalls, newWalls, ceilingHeight) {
    const oldById = new Map(oldWalls.map(w => [w.id, w]));
    const result = [];
    for (const opening of openings) {
        const oldWall = oldById.get(opening.wallId);
        if (!oldWall) continue;
        const centre = pointOnWall(oldWall, opening.offset);
        const oldFrame = wallFrame(oldWall);
        const target = newWalls.find(w => {
            const frame = wallFrame(w);
            return Math.abs(frame.ux * oldFrame.uy - frame.uy * oldFrame.ux) < 1e-3 && distanceToSegment(centre, w.start, w.end) < 1;
        });
        if (!target) continue;
        const frame = wallFrame(target);
        const reversed = frame.ux * oldFrame.ux + frame.uy * oldFrame.uy < 0;
        result.push(clampOpening({
            ...opening,
            wallId: target.id,
            offset: offsetOnWall(target, centre),
            // A reversed wall swaps start/end and left/right; keep the door physically the same.
            hinge: reversed ? (opening.hinge === 'start' ? 'end' : 'start') : opening.hinge,
            side: reversed ? -opening.side : opening.side,
        }, target, ceilingHeight));
    }
    return result;
}

/** The opening whose span on its wall is under `point` (within tolerance cm). */
export function hitOpening(openings, walls, point, tolerance) {
    const byId = new Map(walls.map(w => [w.id, w]));
    for (const opening of openings) {
        const wall = byId.get(opening.wallId);
        if (!wall) continue;
        const along = offsetOnWall(wall, point);
        const { nx, ny } = wallFrame(wall);
        const across = Math.abs((point.x - wall.start.x) * nx + (point.y - wall.start.y) * ny);
        if (across <= tolerance && Math.abs(along - opening.offset) <= opening.width / 2 + tolerance / 2) return opening;
    }
    return null;
}
