// Procedural, tileable floor and wall materials.
//
// Preset ids are stored in project files; never rename them. `legacyName`
// is how projects saved by the original app referred to the same preset.

import { generateWallFinish, wallSwatch } from './wallpaper.js';
import { generateWood } from './wood.js';

/** How much floor one preset texture covers at pattern scale 1. Big, so the repeat doesn't show. */
export const FLOOR_TILE_METRES = 4;
const FLOOR_TILE_PIXELS = 2048;

/** How much wall one preset texture covers at pattern scale 1. */
export const WALL_TILE_METRES = 2;
const WALL_TILE_PIXELS = 2048;

export const FLOOR_PRESETS = [
    { id: 'oak', legacyName: 'オーク', color: [185, 155, 100] },
    { id: 'hardMaple', legacyName: 'ハードメープル', color: [225, 210, 185] },
    { id: 'ashClear', legacyName: 'アッシュクリア', color: [215, 195, 165] },
    { id: 'sycamore', legacyName: 'シカモア', color: [235, 225, 200] },
    { id: 'elm', legacyName: 'ニレ', color: [180, 140, 100] },
    { id: 'acacia', legacyName: 'アカシア', color: [190, 155, 90] },
    { id: 'blackCherry', legacyName: 'ブラックチェリー', color: [130, 75, 55] },
    { id: 'blackWalnut', legacyName: 'ブラックウォールナット', color: [85, 60, 42] },
];

export const WALL_PRESETS = [
    { id: 'standard', legacyName: '白クロス', color: [240, 240, 238], finish: 'pebble' },
    { id: 'woven', legacyName: '織物調', color: [240, 239, 234], finish: 'woven' },
    { id: 'plaster', legacyName: '塗り壁調', color: [243, 240, 233], finish: 'plaster' },
    { id: 'greige', legacyName: null, color: [222, 214, 202], finish: 'pebble' },
    { id: 'sage', legacyName: null, color: [196, 205, 188], finish: 'paint' },
    { id: 'charcoal', legacyName: null, color: [88, 90, 94], finish: 'paint' },
];

export function findPreset(kind, key) {
    const presets = kind === 'floor' ? FLOOR_PRESETS : WALL_PRESETS;
    return presets.find(p => p.id === key || (p.legacyName && p.legacyName === key)) ?? null;
}

// Small deterministic PRNG so a preset always looks the same.
function random(seedText) {
    let seed = [...seedText].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
    return () => {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (r, g, b, a = 1) => `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${a})`;

function createCanvas(size = SIZE) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    return canvas;
}

function toCanvas(pixels, size) {
    const canvas = createCanvas(size);
    canvas.getContext('2d').putImageData(new ImageData(pixels, size, size), 0, 0);
    return canvas;
}

const floorCache = new Map();

/** A floor preset's colour, normal and roughness maps as canvases. Cached; treat them as read-only. */
export function floorMaps(preset) {
    if (!floorCache.has(preset.id)) {
        const maps = generateWood(preset.id, preset.color, { size: FLOOR_TILE_PIXELS, metres: FLOOR_TILE_METRES });
        floorCache.set(preset.id, {
            color: toCanvas(maps.color, FLOOR_TILE_PIXELS),
            normal: toCanvas(maps.normal, FLOOR_TILE_PIXELS),
            roughness: toCanvas(maps.roughness, FLOOR_TILE_PIXELS),
        });
    }
    return floorCache.get(preset.id);
}

const veneerCache = new Map();

/** How much door one veneer texture covers. */
export const VENEER_TILE_METRES = 3;

/** Colour, normal and roughness maps for door veneer: long, matched leaves with the grain along u. */
export function veneerMaps(id, color) {
    if (!veneerCache.has(id)) {
        const size = 2048;
        const maps = generateWood(`veneer-${id}`, color, {
            size, metres: VENEER_TILE_METRES, boardWidth: 0.3, boardLength: [VENEER_TILE_METRES, VENEER_TILE_METRES], grooves: false, pores: 0.45,
        });
        veneerCache.set(id, { color: toCanvas(maps.color, size), normal: toCanvas(maps.normal, size), roughness: toCanvas(maps.roughness, size) });
    }
    return veneerCache.get(id);
}

const wallCache = new Map();

/** A wall preset's colour, normal and roughness maps as canvases. Cached; treat them as read-only. */
export function wallMaps(preset) {
    if (!wallCache.has(preset.id)) {
        const maps = generateWallFinish(preset.id, preset.color, preset.finish, { size: WALL_TILE_PIXELS, metres: WALL_TILE_METRES });
        wallCache.set(preset.id, {
            color: toCanvas(maps.color, WALL_TILE_PIXELS),
            normal: toCanvas(maps.normal, WALL_TILE_PIXELS),
            roughness: toCanvas(maps.roughness, WALL_TILE_PIXELS),
        });
    }
    return wallCache.get(preset.id);
}

/** Colour texture for a floor preset, as the 2D plan draws it. Cached; treat it as read-only. */
export function materialCanvas(kind, preset) {
    return (kind === 'floor' ? floorMaps(preset) : wallMaps(preset)).color;
}

const swatchCache = new Map();

/** Small preview image (data URL) for swatches. Floors get their own quick little tile, not the full maps. */
export function swatchUrl(kind, preset, size = 96) {
    const key = `${kind}:${preset.id}:${size}`;
    if (swatchCache.has(key)) return swatchCache.get(key);
    const canvas = createCanvas(size);
    if (kind === 'floor') {
        // Made larger and shrunk: at swatch size the grain would alias into jagged lines.
        const large = size * 4;
        const wood = generateWood(preset.id, preset.color, { size: large, metres: 1.2 });
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(toCanvas(wood.color, large), 0, 0, size, size);
    } else {
        // Made larger and shrunk, like the floors, and lit so the relief can be seen.
        const large = size * 2;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(toCanvas(wallSwatch(preset.id, preset.color, preset.finish, large), large), 0, 0, size, size);
    }
    swatchCache.set(key, canvas.toDataURL());
    return swatchCache.get(key);
}
