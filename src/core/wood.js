// Wood flooring generated pixel by pixel: boards with their own growth rings,
// fibres and pores, plus the normal and roughness maps that make light behave
// as it does on a real varnished floor. No browser APIs, so it can be tested.
//
// Each board is drawn in its own coordinates, so the tile repeats without a
// seam: a board crossing the edge just continues on the other side.

const BOARD_WIDTH = 0.2;              // metres at pattern scale 1
const BOARD_LENGTH = [1.1, 2.1];      // metres
const BEVEL = 0.0028;                 // metres; the small V groove between boards

function hash32(seedText) {
    let h = 2166136261;
    for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
}

function generator(seed) {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth value noise in 0..1. */
function noiseField(seed) {
    const rand = generator(seed);
    const size = 1024;
    const table = new Float32Array(size * size);
    for (let i = 0; i < table.length; i++) table[i] = rand();
    const mask = size - 1;
    return (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        let fx = x - xi;
        let fy = y - yi;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        const x0 = xi & mask;
        const x1 = (xi + 1) & mask;
        const y0 = (yi & mask) * size;
        const y1 = ((yi + 1) & mask) * size;
        const top = table[y0 + x0] + (table[y0 + x1] - table[y0 + x0]) * fx;
        const bottom = table[y1 + x0] + (table[y1 + x1] - table[y1 + x0]) * fx;
        return top + (bottom - top) * fy;
    };
}

const mix = (a, b, t) => a + (b - a) * t;
const smooth = (low, high, v) => {
    const t = Math.max(0, Math.min(1, (v - low) / (high - low)));
    return t * t * (3 - 2 * t);
};

/** Boards of one row: [{ start, length, ... }] in pixels, summing exactly to the tile width. */
function layoutRow(rand, size, metres) {
    const [shortest, longest] = BOARD_LENGTH;
    const boards = [];
    let left = metres;
    while (left > 0) {
        let length = mix(shortest, longest, rand());
        if (left - length < shortest) length = left; // never leave a sliver at the end
        boards.push(length);
        left -= length;
    }
    const offset = rand() * size;
    let at = 0;
    return boards.map(length => {
        const board = {
            start: (offset + (at / metres) * size) % size,
            pixels: (length / metres) * size,
            tone: (rand() - 0.5) * 0.15,
            warmth: (rand() - 0.5) * 0.05,
            seedU: rand() * 900,
            seedV: rand() * 900,
            // Where the tree's centre lies across this board: near it the rings sweep
            // into the arches of flat-sawn wood, far from it they run straight.
            centre: (rand() - 0.5) * BOARD_WIDTH * (rand() < 0.55 ? 0.8 : 4),
            rings: 34 + rand() * 40,
            sweep: 0.6 + rand() * 1.6,
        };
        at += length;
        return board;
    });
}

/**
 * Maps for a tile `metres` wide and `size` pixels. Returns RGBA Uint8ClampedArrays:
 * { color, normal, roughness } (roughness is in the green channel, as three.js reads it).
 */
export function generateWood(id, baseColor, { size = 2048, metres = 4 } = {}) {
    const seed = hash32(id);
    const rand = generator(seed);
    const noise = noiseField(seed ^ 0x9e3779b9);
    const rows = Math.max(1, Math.round(metres / BOARD_WIDTH));
    const rowPixels = size / rows;
    const metresPerPixel = metres / size;
    const [r, g, b] = baseColor;
    const light = [r * 1.2, g * 1.17, b * 1.13];
    const dark = [r * 0.56, g * 0.5, b * 0.45];

    const color = new Uint8ClampedArray(size * size * 4);
    const roughness = new Uint8ClampedArray(size * size * 4);
    const height = new Float32Array(size * size);

    for (let row = 0; row < rows; row++) {
        const boards = layoutRow(rand, size, metres);
        const top = Math.round(row * rowPixels);
        const bottom = Math.round((row + 1) * rowPixels);
        const across = (bottom - top) * metresPerPixel;
        for (let y = top; y < bottom; y++) {
            const v = (y - top + 0.5) * metresPerPixel; // metres from the board's edge
            const line = y * size;
            for (const board of boards) {
                const end = Math.ceil(board.pixels);
                for (let px = 0; px < end; px++) {
                    const x = Math.floor(board.start + px) % size;
                    const u = px * metresPerPixel;
                    const fromCentre = v - across / 2 - board.centre;

                    // Growth rings, bent by slow noise so they wander as real grain does.
                    const wander = (noise(u * 1.3 + board.seedU, v * 9 + board.seedV) - 0.5) * 0.05
                        + (noise(u * 4.1 + board.seedV, v * 26 + board.seedU) - 0.5) * 0.012;
                    const distance = Math.abs(fromCentre + wander);
                    const phase = Math.sqrt(distance * distance + 0.00008) * board.rings * 5
                        + u * board.sweep * (1 + 4 * smooth(0.14, 0, distance))
                        + noise(u * 0.7 + board.seedV, v * 3) * 1.6;
                    const ring = phase - Math.floor(phase);
                    const late = ring * ring * ring; // pale earlywood darkening into latewood

                    const fibre = noise(u * 26 + board.seedU, v * 1300 + board.seedV);
                    const mottle = noise(u * 2.4 + board.seedV, v * 13 + board.seedU);
                    const poreNoise = noise(u * 75 + board.seedV, v * 1500 + board.seedU);
                    const pore = smooth(0.74, 0.86, poreNoise);

                    const shade = 0.12 + late * 0.42 + (fibre - 0.5) * 0.3 + (mottle - 0.5) * 0.55 - board.tone * 2.2;
                    const t = Math.max(0, Math.min(1, shade));
                    const dim = 1 - pore * 0.26;

                    // The groove around each board: a soft dark line, not a painted stroke.
                    const edge = Math.min(v, across - v, u, (board.pixels - px) * metresPerPixel);
                    const groove = smooth(BEVEL, 0, edge);

                    const shadow = 1 - groove * 0.72;
                    const i = (line + x) * 4;
                    color[i] = mix(light[0], dark[0], t) * dim * shadow * (1 + board.warmth);
                    color[i + 1] = mix(light[1], dark[1], t) * dim * shadow;
                    color[i + 2] = mix(light[2], dark[2], t) * dim * shadow * (1 - board.warmth);
                    color[i + 3] = 255;

                    // Satin varnish: smooth, a little rougher in the pores and latewood.
                    const rough = 0.42 + late * 0.06 + pore * 0.12 + (mottle - 0.5) * 0.12 + groove * 0.4;
                    roughness[i] = roughness[i + 1] = roughness[i + 2] = rough * 255;
                    roughness[i + 3] = 255;

                    height[line + x] = -groove * 0.55 - pore * 0.035 - late * 0.02 + (fibre - 0.5) * 0.012;
                }
            }
        }
    }

    const normal = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
        const above = ((y + size - 1) % size) * size;
        const below = ((y + 1) % size) * size;
        const line = y * size;
        for (let x = 0; x < size; x++) {
            const dx = height[line + ((x + 1) % size)] - height[line + ((x + size - 1) % size)];
            const dy = height[below + x] - height[above + x];
            // Image y runs down and texture v up, so the green channel takes +dy.
            const nx = -dx * 2.2;
            const ny = dy * 2.2;
            const scale = 1 / Math.hypot(nx, ny, 1);
            const i = (line + x) * 4;
            normal[i] = (nx * scale * 0.5 + 0.5) * 255;
            normal[i + 1] = (ny * scale * 0.5 + 0.5) * 255;
            normal[i + 2] = (scale * 0.5 + 0.5) * 255;
            normal[i + 3] = 255;
        }
    }
    return { color, normal, roughness };
}
