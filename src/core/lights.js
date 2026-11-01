// Light fixtures and time of day.
//
//   { id, preset, x, y,        // plan position (cm)
//     drop | height,           // cm below the ceiling / above the floor
//     lumens, kelvin, on, shadows,
//     length?, rotation?, emit? // tape light only: cm; degrees clockwise on the plan, 0 =
//                              //   along +x; which way it shines. Its lumens are per metre,
//                              //   as on a real tape's label, so it brightens as it lengthens.
//     attach? }                // { furnitureId, dx, dy, dz }: a light inside a piece of
//                              //   furniture (a lamp you generated). dx/dz are cm in the
//                              //   item's own frame (dz = towards its front), dy = cm above
//                              //   the item's base. The light then moves with the item.
//
// Ceiling-mounted presets follow the ceiling height (height is derived);
// floor and table lamps keep their own height. Preset ids are stored in
// project files; never rename them.

export const LIGHT_PRESETS = [
    { id: 'ceiling', mount: 'ceiling', drop: 8, lumens: 3800, kelvin: 5000, kind: 'point' },
    { id: 'pendant', mount: 'ceiling', drop: 70, lumens: 810, kelvin: 2700, kind: 'point' },
    { id: 'downlight', mount: 'ceiling', drop: 2, lumens: 600, kelvin: 3000, kind: 'spot', angle: 70 },
    { id: 'spot', mount: 'ceiling', drop: 20, lumens: 500, kelvin: 3000, kind: 'spot', angle: 35 },
    { id: 'floor', mount: 'floor', height: 150, lumens: 810, kelvin: 2700, kind: 'point' },
    { id: 'table', mount: 'floor', height: 65, lumens: 440, kelvin: 2700, kind: 'point' },
    { id: 'tape', mount: 'free', height: 100, lumens: 500, kelvin: 3000, kind: 'strip', length: 100 },
    // Light source inside a piece of furniture; no fixture of its own.
    { id: 'bulb', mount: 'furniture', lumens: 810, kelvin: 2700, kind: 'point' },
];

/** Presets offered for placing on their own (the bulb is added from furniture). */
export const FIXTURE_PRESETS = LIGHT_PRESETS.filter(p => p.mount !== 'furniture');

export const findLightPreset = id => LIGHT_PRESETS.find(p => p.id === id) ?? LIGHT_PRESETS[0];

export const isTape = light => light.preset === 'tape';

export const TAPE_MIN_CM = 5;
export const TAPE_MAX_CM = 2000;
/** Which way a tape shines. "side" is towards its front: 90° clockwise from its direction on the plan. */
export const TAPE_EMITS = ['side', 'up', 'down'];

export const clampTapeLength = cm => Math.round(Math.max(TAPE_MIN_CM, Math.min(TAPE_MAX_CM, cm)));
export const normalizeDegrees = degrees => Math.round((((degrees % 360) + 360) % 360) * 10) / 10;

/** The two ends of a tape centred on `centre` ({ x, y } plan cm). */
export function tapeEnds(light, centre = light) {
    const half = (light.length ?? 100) / 2;
    const angle = ((light.rotation ?? 0) * Math.PI) / 180;
    const along = { x: Math.cos(angle) * half, y: Math.sin(angle) * half };
    return [{ x: centre.x - along.x, y: centre.y - along.y }, { x: centre.x + along.x, y: centre.y + along.y }];
}

/** Patch that stretches a tape between two points, or nothing if they are too close together. */
export function tapeBetween(a, b) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < TAPE_MIN_CM || length > TAPE_MAX_CM) return {};
    const degrees = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, length: Math.round(length * 10) / 10, rotation: normalizeDegrees(degrees) };
}

export const TIMES_OF_DAY = ['morning', 'day', 'evening', 'night'];

/** Common colour temperatures with their Japanese lamp names (for the UI). */
export const KELVIN_MARKS = [
    { kelvin: 2700, id: 'warm' },     // 電球色
    { kelvin: 3500, id: 'warmWhite' }, // 温白色
    { kelvin: 5000, id: 'neutral' },  // 昼白色
    { kelvin: 6500, id: 'daylight' }, // 昼光色
];

let nextId = 1;
export const newLightId = () => `l${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Height (cm) of the light source, following the ceiling for mounted fixtures. */
export function lightHeight(light, ceilingHeight) {
    const preset = findLightPreset(light.preset);
    if (preset.mount === 'furniture') return light.attach?.dy ?? 100;
    if (preset.mount === 'ceiling') return Math.max(20, ceilingHeight - (light.drop ?? preset.drop));
    return Math.min(light.height ?? preset.height, ceilingHeight - (preset.mount === 'free' ? 1 : 5));
}

export function createLight(presetId, point) {
    const preset = findLightPreset(presetId);
    return {
        id: newLightId(),
        preset: preset.id,
        x: point.x,
        y: point.y,
        ...(preset.mount === 'ceiling' ? { drop: preset.drop } : { height: preset.height }),
        lumens: preset.lumens,
        kelvin: preset.kelvin,
        on: true,
        shadows: preset.kind !== 'strip', // three.js area lights cannot cast shadows
        ...(preset.kind === 'strip' ? { length: preset.length, rotation: 0, emit: 'side' } : {}),
    };
}

/**
 * Where a light is: plan x/y and height above the floor (cm). For attached
 * lights `pose(furnitureId)` gives the item's { x, z, y } in cm and yaw in
 * radians; returns null if the item is gone.
 */
export function lightPlacement(light, ceilingHeight, pose) {
    if (!light.attach) return { x: light.x, y: light.y, height: lightHeight(light, ceilingHeight) };
    const p = pose(light.attach.furnitureId);
    if (!p) return null;
    const { dx = 0, dy = 100, dz = 0 } = light.attach;
    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    // Same convention as three.js: rotating (dx, dz) by yaw about +Y.
    return { x: p.x + dx * cos + dz * sin, y: p.z - dx * sin + dz * cos, height: Math.min(p.y + dy, ceilingHeight - 2) };
}

/** Inverse of lightPlacement's offset: plan point → item-relative dx/dz. */
export function attachOffset(point, p) {
    const wx = point.x - p.x;
    const wz = point.y - p.z;
    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    return { dx: wx * cos - wz * sin, dz: wx * sin + wz * cos };
}

/** New light inside a piece of furniture, near the top of it. */
export function createAttachedLight(furnitureId, itemHeight) {
    const preset = findLightPreset('bulb');
    return {
        id: newLightId(), preset: 'bulb', x: 0, y: 0,
        attach: { furnitureId, dx: 0, dy: Math.max(10, Math.round(itemHeight * 0.85)), dz: 0 },
        lumens: preset.lumens, kelvin: preset.kelvin, on: true,
        // Generated meshes are usually closed, so a light inside would be
        // fully blocked by its own lamp if it cast shadows.
        shadows: false,
    };
}

/**
 * Approximate sRGB colour of a black body at `kelvin` (Tanner Helland's fit),
 * as [r, g, b] in 0..1.
 */
export function kelvinToRgb(kelvin) {
    const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
    const clamp = v => Math.max(0, Math.min(255, v)) / 255;
    const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [clamp(r), clamp(g), clamp(b)];
}

/**
 * Patch that puts `light` at `target` ({ x, y } plan cm, height cm above the
 * floor), keeping its mounting: ceiling lights change how far they hang,
 * lamps their height, lights in furniture their offset from the item.
 */
export function movePatch(light, target, ceilingHeight, pose) {
    if (light.attach) {
        const p = pose(light.attach.furnitureId);
        if (!p) return {};
        const { dx, dz } = attachOffset(target, p);
        return { attach: { ...light.attach, dx: Math.round(dx), dz: Math.round(dz), dy: Math.max(0, Math.round(target.height - p.y)) } };
    }
    const preset = findLightPreset(light.preset);
    const position = { x: Math.round(target.x), y: Math.round(target.y) };
    if (preset.mount === 'ceiling') return { ...position, drop: Math.max(0, Math.round(ceilingHeight - target.height)) };
    return { ...position, height: Math.max(5, Math.round(target.height)) };
}
