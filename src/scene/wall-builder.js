// Wall meshes with door and window openings cut out, plus the doors and
// windows themselves.
//
// A wall is a Group at the wall's midpoint on the floor, rotated so local +x
// runs from the wall's start to its end and local +z is the wall's left-hand
// normal (side +1). Units are metres.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wallLength } from '../core/geometry.js';
import { DEFAULT_DOOR_COLOR, DEFAULT_DOOR_OPEN, DOOR_COLORS } from '../core/openings.js';

const SKIRTING_HEIGHT = 0.06;
const FRAME = 0.04; // door casing / window frame width

const materials = {
    handle: new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.3, metalness: 0.8 }),
    sash: new THREE.MeshStandardMaterial({ color: 0x5f6369, roughness: 0.4, metalness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({
        color: 0xbcd6e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false,
    }),
    skirting: new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.6 }),
};
for (const material of Object.values(materials)) material.userData.shared = true;

const doorMaterials = new Map();

/** Leaf/casing material for a door colour; wood colours get a vertical grain. */
function doorMaterial(id) {
    const finish = DOOR_COLORS.find(c => c.id === id) ?? DOOR_COLORS.find(c => c.id === DEFAULT_DOOR_COLOR);
    if (!doorMaterials.has(finish.id)) {
        const [r, g, b] = finish.color;
        let map = null;
        if (finish.grain) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(0, 0, 256, 512);
            let seed = r * 31 + g * 7 + b;
            const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
            for (let i = 0; i < 90; i++) {
                const x = rand() * 256;
                const dark = 12 + rand() * 30;
                ctx.strokeStyle = `rgba(${r - dark}, ${g - dark}, ${b - dark}, ${0.25 + rand() * 0.35})`;
                ctx.lineWidth = 0.5 + rand() * 2;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                for (let y = 0; y <= 512; y += 32) ctx.lineTo(x + Math.sin(y / 70 + i) * (1 + rand() * 2), y);
                ctx.stroke();
            }
            map = new THREE.CanvasTexture(canvas);
            map.colorSpace = THREE.SRGBColorSpace;
            map.wrapS = map.wrapT = THREE.RepeatWrapping;
        }
        const material = new THREE.MeshStandardMaterial({
            map, color: map ? 0xffffff : new THREE.Color(`rgb(${r}, ${g}, ${b})`), roughness: map ? 0.65 : 0.5,
        });
        material.userData.shared = true;
        doorMaterials.set(finish.id, material);
    }
    return doorMaterials.get(finish.id);
}

/** Box from x0..x1, y0..y1, z0..z1 with UVs in metres so textures line up across pieces. */
function box(x0, x1, y0, y1, z0, z1) {
    const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
        const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
        if (Math.abs(normal.getZ(i)) > 0.5) uv.setXY(i, x, y);
        else if (Math.abs(normal.getX(i)) > 0.5) uv.setXY(i, z, y);
        else uv.setXY(i, x, z);
    }
    return geometry;
}

function mesh(geometry, material, { shadows = true } = {}) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadows;
    m.receiveShadow = true;
    return m;
}

/** Openings on this wall as local spans (metres), clipped and non-overlapping. */
function spans(openings, length, height) {
    return openings
        .map(o => {
            const centre = o.offset / 100 - length / 2;
            const sill = Math.min(o.sill / 100, height - 0.05);
            return { opening: o, x0: centre - o.width / 200, x1: centre + o.width / 200, y0: sill, y1: Math.min(height, sill + o.height / 100) };
        })
        .sort((a, b) => a.x0 - b.x0)
        .filter((s, i, all) => i === 0 || s.x0 >= all[i - 1].x1 - 1e-6);
}

/**
 * @param {object} wall          plan wall (cm)
 * @param {object[]} openings    openings on this wall
 * @param {number} height        wall height (m)
 * @param {number} thickness     wall thickness (m)
 * @param {THREE.Material} material wall material; its map should repeat once per metre (× scale)
 */
export function buildWall(wall, openings, height, thickness, material) {
    const length = wallLength(wall) / 100;
    const half = length / 2 + thickness / 2; // overlap the neighbours so corners close
    const t = thickness / 2;
    const holes = spans(openings, length, height);

    // One extruded slab: floor-level openings (doors, patio windows) are
    // notches in the outline, the others are holes. Cap UVs are the shape's
    // x/y in metres, so the wallpaper runs continuously around openings.
    const outline = new THREE.Shape();
    outline.moveTo(-half, 0);
    for (const hole of holes.filter(h => h.y0 <= 0.005)) {
        outline.lineTo(hole.x0, 0);
        outline.lineTo(hole.x0, hole.y1);
        outline.lineTo(hole.x1, hole.y1);
        outline.lineTo(hole.x1, 0);
    }
    outline.lineTo(half, 0);
    outline.lineTo(half, height);
    outline.lineTo(-half, height);
    outline.closePath();
    for (const hole of holes.filter(h => h.y0 > 0.005)) {
        const path = new THREE.Path();
        path.moveTo(hole.x0, hole.y0);
        path.lineTo(hole.x0, hole.y1);
        path.lineTo(hole.x1, hole.y1);
        path.lineTo(hole.x1, hole.y0);
        path.closePath();
        outline.holes.push(path);
    }
    const slab = new THREE.ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false });
    slab.translate(0, 0, -t);

    const group = new THREE.Group();
    group.add(mesh(slab, material));

    // Skirting board on both faces, interrupted by doors and floor-level windows.
    const skirting = [];
    let from = -half;
    for (const hole of holes.filter(h => h.y0 < 0.01)) {
        if (hole.x0 > from) skirting.push(box(from, hole.x0, 0, SKIRTING_HEIGHT, -t - 0.008, t + 0.008));
        from = hole.x1;
    }
    if (from < half) skirting.push(box(from, half, 0, SKIRTING_HEIGHT, -t - 0.008, t + 0.008));
    const fittings = new THREE.Group();
    if (skirting.length) fittings.add(mesh(mergeGeometries(skirting), materials.skirting, { shadows: false }));

    for (const hole of holes) fittings.add(hole.opening.kind === 'door' ? door(hole, thickness) : windowUnit(hole, thickness));
    group.add(fittings);
    group.userData.fittings = fittings;
    return group;
}

function door({ opening, x0, x1, y1 }, thickness) {
    const group = new THREE.Group();
    const finish = doorMaterial(opening.color);
    const depth = thickness + 0.02;
    // Casing: two jambs and a head.
    group.add(mesh(box(x0 - FRAME, x0, 0, y1 + FRAME, -depth / 2, depth / 2), finish));
    group.add(mesh(box(x1, x1 + FRAME, 0, y1 + FRAME, -depth / 2, depth / 2), finish));
    group.add(mesh(box(x0 - FRAME, x1 + FRAME, y1, y1 + FRAME, -depth / 2, depth / 2), finish));

    const width = x1 - x0;
    const height = y1 - 0.01;
    const side = opening.side || 1;
    const open = (opening.open ?? DEFAULT_DOOR_OPEN) / 100;
    const leaf = (hingeX, leafWidth, direction) => {
        // direction: +1 if the leaf extends towards +x from its hinge. It
        // swings towards `side`; fully open is 90°.
        const pivot = new THREE.Group();
        pivot.position.x = hingeX;
        const [a, b] = direction > 0 ? [0, leafWidth] : [-leafWidth, 0];
        pivot.add(mesh(box(a, b, 0.005, height, -0.0175, 0.0175), finish));
        const knob = direction * (leafWidth - 0.07);
        const lever = [knob, knob - direction * 0.12].sort((p, q) => p - q);
        for (const [z0, z1] of [[0.0175, 0.06], [-0.06, -0.0175]]) {
            pivot.add(mesh(box(lever[0], lever[1], 0.988, 1.012, z0, z1), materials.handle, { shadows: false }));
        }
        pivot.rotation.y = -side * direction * open * Math.PI / 2;
        return pivot;
    };
    if (opening.style === 'hinged') {
        group.add(opening.hinge === 'end' ? leaf(x1, width, -1) : leaf(x0, width, 1));
    } else if (opening.style === 'double') {
        group.add(leaf(x0, width / 2, 1), leaf(x1, width / 2, -1));
    } else if (opening.style === 'sliding') {
        // A panel running in front of the wall face on the `side` side. It
        // slides towards the wall's start (hinge 'start') or end.
        const face = side * (thickness / 2 + 0.005);
        const [z0, z1] = side > 0 ? [face, face + 0.035] : [face - 0.035, face];
        const direction = opening.hinge === 'end' ? 1 : -1;
        const shift = direction * open * (width - 0.08);
        const [a, b] = [x0 + 0.005 + shift, x1 - 0.005 + shift];
        group.add(mesh(box(a, b, 0.005, height, z0, z1), finish));
        // Recessed pull on the edge that trails into the opening.
        const pull = direction < 0 ? b - 0.09 : a + 0.06;
        const [p0, p1] = side > 0 ? [z1, z1 + 0.006] : [z0 - 0.006, z0];
        group.add(mesh(box(pull, pull + 0.03, 0.9, 1.1, p0, p1), materials.handle, { shadows: false }));
    }
    return group;
}

function windowUnit({ opening, x0, x1, y0, y1 }, thickness) {
    const group = new THREE.Group();
    const depth = Math.min(0.07, thickness * 0.8);
    const frame = (a, b, c, d, z0, z1, width = FRAME) => {
        group.add(mesh(box(a, b, c, c + width, z0, z1), materials.sash));      // bottom
        group.add(mesh(box(a, b, d - width, d, z0, z1), materials.sash));      // top
        group.add(mesh(box(a, a + width, c, d, z0, z1), materials.sash));      // left
        group.add(mesh(box(b - width, b, c, d, z0, z1), materials.sash));      // right
    };
    const pane = (a, b, c, d, z) => group.add(mesh(box(a, b, c, d, z - 0.003, z + 0.003), materials.glass, { shadows: false }));

    frame(x0, x1, y0, y1, -depth / 2, depth / 2);
    const inner = { a: x0 + FRAME, b: x1 - FRAME, c: y0 + FRAME, d: y1 - FRAME };
    if (opening.style === 'sliding') {
        // Two sashes on separate tracks, overlapping in the middle.
        const w = (inner.b - inner.a) * 0.52;
        for (const [a, b, z] of [[inner.a, inner.a + w, -0.012], [inner.b - w, inner.b, 0.012]]) {
            frame(a, b, inner.c, inner.d, z - 0.01, z + 0.01, 0.025);
            pane(a + 0.025, b - 0.025, inner.c + 0.025, inner.d - 0.025, z);
        }
    } else {
        if (opening.style === 'casement') {
            frame(inner.a, inner.b, inner.c, inner.d, -0.012, 0.012, 0.025);
            group.add(mesh(box(inner.b - 0.06, inner.b - 0.045, (inner.c + inner.d) / 2 - 0.05, (inner.c + inner.d) / 2 + 0.05, 0.012, 0.03),
                materials.handle, { shadows: false }));
        }
        pane(inner.a + 0.01, inner.b - 0.01, inner.c + 0.01, inner.d - 0.01, 0);
    }
    return group;
}
