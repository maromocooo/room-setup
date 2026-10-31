// Procedural, tileable floor and wall materials.
//
// Preset ids are stored in project files; never rename them. `legacyName`
// is how projects saved by the original app referred to the same preset.

import { generateWood } from './wood.js';

const SIZE = 512;

/** How much floor one preset texture covers at pattern scale 1. Big, so the repeat doesn't show. */
export const FLOOR_TILE_METRES = 4;
const FLOOR_TILE_PIXELS = 2048;

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
    { id: 'standard', legacyName: '白クロス', color: [240, 240, 240] },
    { id: 'woven', legacyName: '織物調', color: [242, 242, 240] },
    { id: 'plaster', legacyName: '塗り壁調', color: [245, 243, 240] },
    { id: 'greige', legacyName: null, color: [222, 214, 202] },
    { id: 'sage', legacyName: null, color: [196, 205, 188] },
    { id: 'charcoal', legacyName: null, color: [88, 90, 94] },
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

function drawWall(ctx, preset) {
    const rand = random(preset.id);
    const [r, g, b] = preset.color;
    if (preset.id === 'woven') {
        for (let p = 0; p < SIZE; p += 6) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
            ctx.fillRect(0, p, SIZE, 1);
            ctx.fillRect(p, 0, 1, SIZE);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.fillRect(0, p + 1, SIZE, 1);
            ctx.fillRect(p + 1, 0, 1, SIZE);
        }
        return;
    }
    if (preset.id === 'plaster') {
        for (let i = 0; i < 5000; i++) {
            const v = (rand() - 0.5) * 25;
            ctx.fillStyle = rgb(r + v, g + v, b + v, 0.3);
            ctx.beginPath();
            ctx.ellipse(rand() * SIZE, rand() * SIZE, rand() * 4 + 1, rand() * 2 + 0.5, rand() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }
    // Vinyl wallpaper: fine embossed dots.
    for (let x = 0; x < SIZE; x += 8) {
        for (let y = 0; y < SIZE; y += 8) {
            const ox = (y / 8) % 2 ? 4 : 0;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
            ctx.beginPath();
            ctx.arc(x + ox + 4, y + 5, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
            ctx.beginPath();
            ctx.arc(x + ox + 3.5, y + 3.5, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
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
export const VENEER_TILE_METRES = 2.4;

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

const cache = new Map();

/** Texture canvas for a preset. Cached; treat it as read-only. */
export function materialCanvas(kind, preset) {
    if (kind === 'floor') return floorMaps(preset).color;
    const key = `${kind}:${preset.id}`;
    if (!cache.has(key)) {
        const canvas = createCanvas();
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = rgb(...preset.color);
        ctx.fillRect(0, 0, SIZE, SIZE);
        drawWall(ctx, preset);
        cache.set(key, canvas);
    }
    return cache.get(key);
}

/** Small preview image (data URL) for swatches. Floors get their own quick little tile, not the full maps. */
export function swatchUrl(kind, preset, size = 96) {
    const canvas = createCanvas(size);
    if (kind === 'floor') {
        // Made larger and shrunk: at swatch size the grain would alias into jagged lines.
        const large = size * 4;
        const wood = generateWood(preset.id, preset.color, { size: large, metres: 1.2 });
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(toCanvas(wood.color, large), 0, 0, size, size);
    } else {
        canvas.getContext('2d').drawImage(materialCanvas(kind, preset), 0, 0, SIZE / 2, SIZE / 2, 0, 0, size, size);
    }
    return canvas.toDataURL();
}
