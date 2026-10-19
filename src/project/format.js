// Project file format (project.json inside a ZIP). Pure functions only, so
// they can be tested without a browser.
//
// Version 3 (this app):
//   walls[]      { start, end, finish? }            plan centimetres
//   openings[]   { wall (index into walls), kind, preset, style, offset, width, height, sill, hinge, side }
//   lights[]     { preset, x, y, drop | height, lumens, kelvin, on, shadows }    plus timeOfDay
//   floor, wall  { finish, scale }                  finish = { preset } | { image: "<zip path>" }
//   furniture[]  { id, name, engine, dimensions, position (cm), rotation { y (deg) },
//                  model: "<zip path>", thumbnail?: "<zip path>" }
// Version 2 and earlier came from the original Room Designer; parseProject
// reads them too.

import { findPreset } from '../core/textures.js';

export const FORMAT = 'room-setup';
export const VERSION = 3;

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const point = p => ({ x: round(p.x), y: round(p.y) });
const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const extensionOf = dataUrl => IMAGE_EXTENSIONS[/^data:([^;,]+)/.exec(dataUrl ?? '')?.[1]] ?? 'png';

/**
 * @param {object} state  { walls, ceilingHeight, floor, wall, furniture[] } where furniture
 *                         entries are { id, name, engine, dimensions, position, rotationY, hasThumbnail }
 * @returns {{ manifest: object, images: Map<string, string> }} images maps zip path → data URL
 */
export function buildManifest(state) {
    const images = new Map();
    const finishRef = (finish, name) => {
        if (!finish) return null;
        if (finish.preset) return { preset: finish.preset };
        const path = `textures/${name}.${extensionOf(finish.image)}`;
        images.set(path, finish.image);
        return { image: path };
    };
    const manifest = {
        format: FORMAT,
        exportVersion: VERSION,
        ceilingHeight: state.ceilingHeight,
        walls: state.walls.map((wall, i) => {
            const entry = { start: point(wall.start), end: point(wall.end) };
            const finish = finishRef(wall.finish, `wall-${i + 1}`);
            if (finish) entry.finish = finish;
            return entry;
        }),
        openings: (state.openings ?? []).flatMap(o => {
            const wall = state.walls.findIndex(w => w.id === o.wallId);
            if (wall === -1) return [];
            const { id, wallId, ...rest } = o;
            return [{ ...rest, wall }];
        }),
        lights: (state.lights ?? []).map(({ id, ...rest }) => rest),
        timeOfDay: state.timeOfDay ?? 'day',
        floor: { finish: finishRef(state.floor.finish, 'floor'), scale: state.floor.scale },
        wall: { finish: finishRef(state.wall.finish, 'wall'), scale: state.wall.scale },
        furniture: state.furniture.map(item => ({
            id: item.id,
            name: item.name,
            engine: item.engine ?? null,
            dimensions: item.dimensions,
            position: { x: round(item.position.x * 100, 1), y: round(item.position.y * 100, 1), z: round(item.position.z * 100, 1) },
            rotation: { y: round(item.rotationY * 180 / Math.PI, 1) },
            model: `models/${item.id}.glb`,
            ...(item.hasThumbnail ? { thumbnail: `thumbnails/${item.id}.png` } : {}),
        })),
    };
    return { manifest, images };
}

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function legacyFinish(kind, settings) {
    const key = settings?.preset?.nameEn ?? settings?.preset?.name;
    const preset = key ? findPreset(kind, key) : null;
    return preset ? { preset: preset.id } : null;
}

/**
 * Normalise any supported project.json into the shape the app restores.
 * Image and model references stay as zip paths.
 */
export function parseProject(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.walls)) {
        throw new Error('Not a Room Setup project');
    }
    const version = finite(data.exportVersion, 0);
    const walls = data.walls
        .filter(w => [w?.start?.x, w?.start?.y, w?.end?.x, w?.end?.y].every(Number.isFinite))
        .map(w => ({ start: point(w.start), end: point(w.end), finish: w.finish ?? null }));

    const modern = data.format === FORMAT;
    const floor = modern
        ? { finish: data.floor?.finish ?? null, scale: finite(data.floor?.scale, 1) }
        : { finish: legacyFinish('floor', data.floorTextureSettings), scale: finite(data.floorTextureSettings?.scale, 1) };
    const wall = modern
        ? { finish: data.wall?.finish ?? null, scale: finite(data.wall?.scale, 1) }
        : { finish: legacyFinish('wall', data.wallTextureSettings), scale: finite(data.wallTextureSettings?.scale, 1) };

    const furniture = (Array.isArray(data.furniture) ? data.furniture : []).map((item, i) => ({
        id: String(item.id ?? `item-${i + 1}`),
        name: typeof item.name === 'string' ? item.name : null,
        engine: item.engine ?? null,
        dimensions: {
            width: finite(item.dimensions?.width, 50),
            height: finite(item.dimensions?.height, 50),
            depth: finite(item.dimensions?.depth, 50),
        },
        position: {
            x: finite(item.position?.x, 0) / 100,
            y: finite(item.position?.y, 0) / 100,
            z: finite(item.position?.z, 0) / 100,
        },
        rotationY: finite(item.rotation?.y, 0) * Math.PI / 180,
        model: modern ? item.model : `generated/model_${item.id}.glb`,
        thumbnail: modern ? item.thumbnail ?? null : `thumbnails/${item.id}.png`,
        // v2 GLBs were exported at the origin with scale baked into the
        // vertices, so placing them at the saved position reproduces the
        // room as-is. Older ones are raw generator output that needs sizing.
        layout: modern ? 'container' : version >= 2 ? 'baked' : 'raw',
    }));

    const kinds = { door: 'hinged', window: 'sliding' };
    const openings = (modern && Array.isArray(data.openings) ? data.openings : [])
        .filter(o => o && Number.isInteger(o.wall) && o.wall >= 0 && o.wall < walls.length && o.kind in kinds)
        .map(o => ({
            wall: o.wall,
            kind: o.kind,
            preset: typeof o.preset === 'string' ? o.preset : null,
            style: typeof o.style === 'string' ? o.style : kinds[o.kind],
            offset: finite(o.offset, 50),
            width: finite(o.width, o.kind === 'door' ? 80 : 120),
            height: finite(o.height, o.kind === 'door' ? 200 : 110),
            sill: finite(o.sill, o.kind === 'door' ? 0 : 90),
            hinge: o.hinge === 'end' ? 'end' : 'start',
            side: o.side === -1 ? -1 : 1,
            ...(o.kind === 'door' && typeof o.color === 'string' ? { color: o.color } : {}),
            ...(o.kind === 'door' && Number.isFinite(o.open) ? { open: Math.max(0, Math.min(100, o.open)) } : {}),
        }));

    const lights = (modern && Array.isArray(data.lights) ? data.lights : [])
        .filter(l => l && Number.isFinite(l.x) && Number.isFinite(l.y) && typeof l.preset === 'string')
        .map(l => ({
            preset: l.preset,
            x: l.x,
            y: l.y,
            ...(Number.isFinite(l.drop) ? { drop: l.drop } : {}),
            ...(Number.isFinite(l.height) ? { height: l.height } : {}),
            lumens: finite(l.lumens, 800),
            kelvin: finite(l.kelvin, 3000),
            on: l.on !== false,
            shadows: l.shadows !== false,
            ...(l.attach && typeof l.attach.furnitureId === 'string' ? {
                attach: { furnitureId: l.attach.furnitureId, dx: finite(l.attach.dx, 0), dy: finite(l.attach.dy, 100), dz: finite(l.attach.dz, 0) },
            } : {}),
        }));
    const times = ['morning', 'day', 'evening', 'night'];

    return {
        walls,
        openings,
        lights,
        timeOfDay: times.includes(data.timeOfDay) ? data.timeOfDay : 'day',
        ceilingHeight: finite(data.ceilingHeight, 240),
        floor,
        wall,
        furniture,
    };
}
