// Tilt = how a model is turned inside its container to fix generators that
// return furniture upside down or lying on its side. Stored as Euler angles in
// degrees (three.js 'XYZ' order). Turns compose about the room's axes, so
// "flip upside down" after "tip forward" still flips what you see.

const RAD = Math.PI / 180;

function fromEuler({ x = 0, y = 0, z = 0 }) {
    const [c1, c2, c3] = [Math.cos(x * RAD / 2), Math.cos(y * RAD / 2), Math.cos(z * RAD / 2)];
    const [s1, s2, s3] = [Math.sin(x * RAD / 2), Math.sin(y * RAD / 2), Math.sin(z * RAD / 2)];
    return {
        x: s1 * c2 * c3 + c1 * s2 * s3,
        y: c1 * s2 * c3 - s1 * c2 * s3,
        z: c1 * c2 * s3 + s1 * s2 * c3,
        w: c1 * c2 * c3 - s1 * s2 * s3,
    };
}

function toEuler(q) {
    // Rotation matrix entries needed for XYZ decomposition.
    const m11 = 1 - 2 * (q.y * q.y + q.z * q.z);
    const m12 = 2 * (q.x * q.y - q.w * q.z);
    const m13 = 2 * (q.x * q.z + q.w * q.y);
    const m22 = 1 - 2 * (q.x * q.x + q.z * q.z);
    const m23 = 2 * (q.y * q.z - q.w * q.x);
    const m32 = 2 * (q.y * q.z + q.w * q.x);
    const m33 = 1 - 2 * (q.x * q.x + q.y * q.y);
    const y = Math.asin(Math.max(-1, Math.min(1, m13)));
    let x;
    let z;
    if (Math.abs(m13) < 0.9999999) {
        x = Math.atan2(-m23, m33);
        z = Math.atan2(-m12, m11);
    } else {
        x = Math.atan2(m32, m22);
        z = 0;
    }
    const clean = v => {
        const d = Math.round((v / RAD) * 100) / 100;
        return Object.is(d, -0) ? 0 : d;
    };
    return { x: clean(x), y: clean(y), z: clean(z) };
}

function multiply(a, b) {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

/** New tilt after turning `degrees` about the room's 'x' or 'z' axis. */
export function turnTilt(tilt, axis, degrees) {
    const half = (degrees * RAD) / 2;
    const turn = { x: 0, y: 0, z: 0, w: Math.cos(half), [axis]: Math.sin(half) };
    return toEuler(multiply(turn, fromEuler(tilt ?? {})));
}

export const TILT_TURNS = {
    flip: ['x', 180],     // upside down ↔ upright
    forward: ['x', 90],   // top tips towards the front (+z)
    backward: ['x', -90],
    left: ['z', 90],      // top tips to the left (−x)
    right: ['z', -90],
};
