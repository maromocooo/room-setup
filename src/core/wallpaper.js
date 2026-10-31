// Wall finishes generated pixel by pixel. A real wall's texture is mostly relief,
// seen only as light slides across it, so most of the work here is in the normal
// and roughness maps; the colour map stays close to plain. No browser APIs, so it
// can be tested. Every layer repeats a whole number of times across the tile, so
// the tile has no seam.

function hash32(seedText) {
    let h = 2166136261;
    for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
}

/** Value noise in 0..1 that repeats every `cellsX` × `cellsY` lattice cells. */
function tilingNoise(seed) {
    let state = seed;
    const rand = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const size = 1024;
    const table = new Float32Array(size * size);
    for (let i = 0; i < table.length; i++) table[i] = rand();
    return (u, v, cellsX, cellsY = cellsX, layer = 0) => {
        const x = u * cellsX;
        const y = v * cellsY;
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        let fx = x - xi;
        let fy = y - yi;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        const wrap = (value, period) => ((value % period) + period) % period;
        const at = (cx, cy) => table[((wrap(cy, cellsY) + layer * 131) % size) * size + ((wrap(cx, cellsX) + layer * 37) % size)];
        const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
        const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
        return top + (bottom - top) * fy;
    };
}

// Each finish gives, for a point on the tile (u, v in 0..1), its relief in arbitrary units.
// Frequencies are cycles per tile; `metres` is passed in so physical sizes stay right.
const FINISHES = {
    // Vinyl wall covering: a fine, irregular pebbled emboss.
    pebble: { relief: 0.9, roughness: 0.78, cavity: 0.05, height(noise, u, v, m) {
        const c = Math.round(m * 190);
        const grain = noise(u, v, c, c, 1);
        const pit = noise(u, v, Math.round(m * 95), Math.round(m * 95), 2);
        return grain * 0.65 + pit * pit * 0.9 + noise(u, v, Math.round(m * 400), Math.round(m * 400), 3) * 0.14;
    } },
    // Woven cloth: threads about 4 mm apart going over and under each other, slightly uneven.
    woven: { relief: 0.75, roughness: 0.86, cavity: 0.08, height(noise, u, v, m) {
        const threads = Math.round(m * 240);
        const wobble = noise(u, v, Math.round(m * 22), Math.round(m * 22), 4) - 0.5;
        const a = u * threads + wobble * 0.35;
        const b = v * threads - wobble * 0.35;
        const warp = Math.sin(a * Math.PI * 2);
        const weft = Math.sin(b * Math.PI * 2);
        const over = (Math.floor(a) + Math.floor(b)) % 2 === 0;
        const thread = over ? Math.abs(warp) * 1 : Math.abs(weft) * 1;
        return thread + (noise(u, v, Math.round(m * 500), Math.round(m * 40), 5) - 0.5) * 0.35;
    } },
    // Trowelled plaster: broad, soft sweeps with a fine sandy grain on top.
    plaster: { relief: 0.9, roughness: 0.88, cavity: 0.025, height(noise, u, v, m) {
        const sway = (noise(u, v, Math.round(m * 3), Math.round(m * 3), 6) - 0.5) * 0.09;
        const broad = noise(u + sway, v - sway, Math.round(m * 6), Math.round(m * 11), 7);
        const strokes = noise(u - sway, v + sway, Math.round(m * 16), Math.round(m * 44), 8);
        const sand = noise(u, v, Math.round(m * 300), Math.round(m * 300), 9);
        return broad * 0.9 + strokes * 0.3 + sand * 0.3;
    } },
    // Painted wall: barely any texture, a slight roller orange-peel.
    paint: { relief: 0.45, roughness: 0.66, cavity: 0.015, height(noise, u, v, m) {
        return noise(u, v, Math.round(m * 110), Math.round(m * 110), 10) * 0.8 + noise(u, v, Math.round(m * 260), Math.round(m * 260), 11) * 0.25;
    } },
};

/**
 * Maps for a tile `metres` wide and `size` pixels. Returns RGBA Uint8ClampedArrays
 * { color, normal, roughness } (roughness is in the green channel, as three.js reads it).
 */
export function generateWallFinish(id, baseColor, kind = 'pebble', { size = 2048, metres = 2 } = {}) {
    const finish = FINISHES[kind] ?? FINISHES.pebble;
    const noise = tilingNoise(hash32(id));
    const [r, g, b] = baseColor;
    const height = new Float32Array(size * size);
    let low = Infinity;
    let high = -Infinity;
    for (let y = 0; y < size; y++) {
        const v = (y + 0.5) / size;
        for (let x = 0; x < size; x++) {
            const h = finish.height(noise, (x + 0.5) / size, v, metres);
            height[y * size + x] = h;
            if (h < low) low = h;
            if (h > high) high = h;
        }
    }
    const range = Math.max(high - low, 1e-6);
    const color = new Uint8ClampedArray(size * size * 4);
    const normal = new Uint8ClampedArray(size * size * 4);
    const roughness = new Uint8ClampedArray(size * size * 4);
    const pixelsPerMetreFix = (size / metres) / 1024; // relief is tuned at 1 px per mm
    const strength = finish.relief * pixelsPerMetreFix;
    for (let y = 0; y < size; y++) {
        const above = ((y + size - 1) % size) * size;
        const below = ((y + 1) % size) * size;
        const line = y * size;
        for (let x = 0; x < size; x++) {
            const dx = height[line + ((x + 1) % size)] - height[line + ((x + size - 1) % size)];
            const dy = height[below + x] - height[above + x];
            // Image y runs down and texture v up, so the green channel takes +dy.
            const nx = -dx * strength;
            const ny = dy * strength;
            const scale = 1 / Math.hypot(nx, ny, 1);
            const i = (line + x) * 4;
            normal[i] = (nx * scale * 0.5 + 0.5) * 255;
            normal[i + 1] = (ny * scale * 0.5 + 0.5) * 255;
            normal[i + 2] = (scale * 0.5 + 0.5) * 255;
            normal[i + 3] = 255;

            // Dirt and shadow settle in the low spots, very slightly.
            const raised = (height[line + x] - low) / range;
            const shade = 1 - finish.cavity * (1 - raised);
            color[i] = r * shade;
            color[i + 1] = g * shade;
            color[i + 2] = b * shade;
            color[i + 3] = 255;

            const rough = finish.roughness - (raised - 0.5) * 0.08;
            roughness[i] = roughness[i + 1] = roughness[i + 2] = rough * 255;
            roughness[i + 3] = 255;
        }
    }
    return { color, normal, roughness };
}

/**
 * A preview for swatches: the colour lit from one side, since relief alone
 * would look flat. RGBA Uint8ClampedArray, `size` square.
 */
export function wallSwatch(id, baseColor, kind, size = 192) {
    // A small patch of wall, enlarged enough for the relief to read at swatch size.
    const { color, normal } = generateWallFinish(id, baseColor, kind, { size, metres: 0.4 });
    const out = new Uint8ClampedArray(color.length);
    for (let i = 0; i < color.length; i += 4) {
        const nx = normal[i] / 127.5 - 1;
        const ny = normal[i + 1] / 127.5 - 1;
        const light = 1 + (nx * -0.6 + ny * 0.6) * 1.1;
        out[i] = color[i] * light;
        out[i + 1] = color[i + 1] * light;
        out[i + 2] = color[i + 2] * light;
        out[i + 3] = 255;
    }
    return out;
}
