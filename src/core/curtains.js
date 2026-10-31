// Curtains on windows: what they are made of and where everything hangs.
//
//   opening.curtain = { enabled, material, color: '#rrggbb', open }   // open: 0 closed .. 100 drawn back
//
// Two panels on a rod, drawn apart from the middle. Once drawn back, each panel is
// held by a tieback, so it hangs narrow at that height and fans out above and below.
// Lengths in metres, in the wall's local frame (see scene/wall-builder.js).
// Material ids are stored in project files; never rename them.

export const CURTAIN_MATERIALS = [
    { id: 'linen', roughness: 0.95, thread: 0.0035, opacity: 1 },
    { id: 'cotton', roughness: 0.8, thread: 0.0015, opacity: 1 },
    { id: 'velvet', roughness: 0.9, thread: 0.002, opacity: 1, sheen: 1 },
    { id: 'sheer', roughness: 0.6, thread: 0.0015, opacity: 0.55 },
    { id: 'blackout', roughness: 0.65, thread: 0.0015, opacity: 1 },
];

export const DEFAULT_CURTAIN = { enabled: true, material: 'linen', color: '#d8d0c2', open: 70 };

export const findCurtainMaterial = id => CURTAIN_MATERIALS.find(m => m.id === id) ?? CURTAIN_MATERIALS[0];

/** A valid curtain from whatever a file or a person gave us. */
export function normalizeCurtain(curtain) {
    if (!curtain || typeof curtain !== 'object') return null;
    const open = Number(curtain.open);
    return {
        enabled: curtain.enabled === true,
        material: findCurtainMaterial(curtain.material).id,
        color: /^#[0-9a-fA-F]{6}$/.test(curtain.color) ? curtain.color.toLowerCase() : DEFAULT_CURTAIN.color,
        open: Number.isFinite(open) ? Math.max(0, Math.min(100, open)) : DEFAULT_CURTAIN.open,
    };
}

const ROD_OVERHANG = 0.14;     // past the frame on each side, so drawn panels clear the glass
const ROD_ABOVE = 0.1;
const STANDOFF = 0.06;         // rod in front of the wall face
const STACK = 0.24;            // a fully drawn panel takes this share of its closed width
const FLOOR_LENGTH_BELOW = 0.4; // windows starting this low get floor-length curtains
const SILL_DROP = 0.15;        // the others end this far below the sill
const TIE_AT = 0.62;           // tieback height, as a share of the way down
const TIED_FROM = 3;           // open percent; below this the panels hang free

const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Where the rod and panels go for a window spanning x0..x1, y0..y1 on a wall. */
export function curtainLayout({ x0, x1, y0, y1, wallHeight, wallHalf, thickness, side = 1, open = 100 }) {
    const rodLeft = Math.max(x0 - ROD_OVERHANG, -wallHalf + 0.02);
    const rodRight = Math.min(x1 + ROD_OVERHANG, wallHalf - 0.02);
    const rodY = Math.min(y1 + ROD_ABOVE, wallHeight - 0.03);
    const top = rodY - 0.012;
    const bottom = Math.max(0.012, y0 < FLOOR_LENGTH_BELOW ? 0.012 : y0 - SILL_DROP);
    const middle = (x0 + x1) / 2;
    const amount = Math.max(0, Math.min(100, open)) / 100;
    const panel = (outer, direction) => {
        const closed = Math.abs(middle - outer);
        const width = closed * (1 - amount * (1 - STACK));
        return { outer, direction, closed, width };
    };
    return {
        rod: { x0: rodLeft, x1: rodRight, y: rodY, z: side * (thickness / 2 + STANDOFF) },
        z: side * (thickness / 2 + STANDOFF),
        side,
        top,
        bottom,
        tied: open >= TIED_FROM,
        tieY: top - (top - bottom) * TIE_AT,
        panels: [panel(rodLeft, 1), panel(rodRight, -1)],
    };
}

/** Width (m) of a panel `down` of the way from its top (0) to its bottom (1). */
export function panelWidthAt(panel, tied, down) {
    if (!tied) return panel.width;
    const pull = smooth(0, 0.3, panel.closed - panel.width <= 0 ? 0 : (panel.closed - panel.width) / panel.closed);
    const waist = panel.width * (1 - 0.5 * pull);
    const near = 1 - Math.abs(down - TIE_AT) / (down < TIE_AT ? TIE_AT : 1 - TIE_AT);
    // Pinched at the tieback, full width at the rod, and a little fuller again at the hem.
    const pinch = smooth(0, 1, near);
    const end = down < TIE_AT ? panel.width : panel.width * 0.85;
    return end + (waist - end) * pinch;
}

/** How deep the folds are (m) where a panel hangs this wide: gathered cloth has nowhere else to go. */
export function foldDepth(panel, width) {
    return 0.022 + 0.032 * Math.max(0, Math.min(1, 1 - width / panel.closed));
}
