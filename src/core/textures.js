// Procedural, tileable floor and wall materials.
//
// Preset ids are stored in project files; never rename them. `legacyName`
// is how projects saved by the original app referred to the same preset.

const SIZE = 512;

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

function drawPlanks(ctx, preset) {
    const rand = random(preset.id);
    const [r, g, b] = preset.color;
    const rows = 5;
    const rowHeight = SIZE / rows;
    for (let row = 0; row < rows; row++) {
        const y = row * rowHeight;
        // Two boards per row with staggered butt joints, wrapped so it tiles.
        const joint = rand() * SIZE;
        const length = SIZE * (0.4 + rand() * 0.2);
        for (const [start, width] of [[0, SIZE], [joint, length]]) {
            const shade = (rand() - 0.5) * 22;
            ctx.fillStyle = rgb(r + shade, g + shade, b + shade);
            for (const offset of [0, -SIZE]) ctx.fillRect(start + offset, y, width, rowHeight);
        }
        // Grain: long, slightly wavy strokes.
        for (let i = 0; i < 14; i++) {
            const gy = y + 3 + rand() * (rowHeight - 6);
            const dark = 10 + rand() * 25;
            ctx.strokeStyle = rgb(r - dark, g - dark, b - dark, 0.22 + rand() * 0.2);
            ctx.lineWidth = 0.6 + rand() * 1.2;
            ctx.beginPath();
            ctx.moveTo(0, gy);
            for (let x = 0; x <= SIZE; x += 64) ctx.lineTo(x, gy + Math.sin(x / 80 + i) * (0.5 + rand()));
            ctx.stroke();
        }
        // Joints and seams.
        ctx.fillStyle = rgb(r - 55, g - 55, b - 55, 0.75);
        ctx.fillRect(0, y, SIZE, 1.5);
        for (const x of [joint, (joint + length) % SIZE]) ctx.fillRect(x, y, 1.5, rowHeight);
    }
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

const cache = new Map();

/** Full-size texture canvas for a preset. Cached; treat it as read-only. */
export function materialCanvas(kind, preset) {
    const key = `${kind}:${preset.id}`;
    if (!cache.has(key)) {
        const canvas = createCanvas();
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = rgb(...preset.color);
        ctx.fillRect(0, 0, SIZE, SIZE);
        (kind === 'floor' ? drawPlanks : drawWall)(ctx, preset);
        cache.set(key, canvas);
    }
    return cache.get(key);
}

/** Small preview image (data URL) for swatches. */
export function swatchUrl(kind, preset, size = 96) {
    const canvas = createCanvas(size);
    canvas.getContext('2d').drawImage(materialCanvas(kind, preset), 0, 0, SIZE / 2, SIZE / 2, 0, 0, size, size);
    return canvas.toDataURL();
}
