// Wall meshes with door and window openings cut out, plus the doors and
// windows themselves.
//
// A wall is a Group at the wall's midpoint on the floor, rotated so local +x
// runs from the wall's start to its end and local +z is the wall's left-hand
// normal (side +1). Units are metres.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { wallLength } from '../core/geometry.js';
import { DEFAULT_DOOR_COLOR, DEFAULT_DOOR_OPEN, DOOR_COLORS } from '../core/openings.js';
import { LEAF_THICKNESS, LEVER_HEIGHT, OPENING_OVERLAP, doorFrame, hingeHeights, leafOpening, slidingPanelZ } from '../core/door-parts.js';
import { VENEER_TILE_METRES, veneerMaps } from '../core/textures.js';

const SKIRTING_HEIGHT = 0.06;
const FRAME = 0.04; // door casing / window frame width

const materials = {
    handle: new THREE.MeshStandardMaterial({ color: 0xc4c6ca, roughness: 0.36, metalness: 0.75 }),
    sash: new THREE.MeshStandardMaterial({ color: 0x5f6369, roughness: 0.4, metalness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({
        color: 0xbcd6e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false,
    }),
    skirting: new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.6 }),
};
for (const material of Object.values(materials)) material.userData.shared = true;

const doorMaterials = new Map();

/** Door colours: wood veneer with real grain and sheen, or a smooth painted finish. */
function doorMaterial(id) {
    const finish = DOOR_COLORS.find(c => c.id === id) ?? DOOR_COLORS.find(c => c.id === DEFAULT_DOOR_COLOR);
    if (!doorMaterials.has(finish.id)) {
        const [r, g, b] = finish.color;
        let material;
        if (finish.grain) {
            const maps = veneerMaps(finish.id, finish.color);
            const texture = (canvas, colorSpace) => {
                const map = new THREE.CanvasTexture(canvas);
                map.colorSpace = colorSpace;
                map.wrapS = map.wrapT = THREE.RepeatWrapping;
                map.repeat.setScalar(1 / VENEER_TILE_METRES); // UVs are in metres
                map.anisotropy = 8;
                return map;
            };
            material = new THREE.MeshPhysicalMaterial({
                map: texture(maps.color, THREE.SRGBColorSpace),
                normalMap: texture(maps.normal, THREE.NoColorSpace),
                normalScale: new THREE.Vector2(0.4, 0.4),
                roughnessMap: texture(maps.roughness, THREE.NoColorSpace),
                roughness: 1,
                clearcoat: 0.25,
                clearcoatRoughness: 0.35,
            });
        } else {
            material = new THREE.MeshPhysicalMaterial({
                color: new THREE.Color(`rgb(${r}, ${g}, ${b})`), roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4,
            });
        }
        material.userData.shared = true;
        doorMaterials.set(finish.id, material);
    }
    return doorMaterials.get(finish.id);
}

/** A piece of joinery: softly rounded edges, with the grain running along its longest side. */
function joinery(x0, x1, y0, y1, z0, z1, radius = 0.0015) {
    const size = [x1 - x0, y1 - y0, z1 - z0];
    const geometry = new RoundedBoxGeometry(...size, 2, Math.min(radius, Math.min(...size) * 0.45));
    geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const along = size.indexOf(Math.max(...size));
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i);
        n.fromBufferAttribute(normal, i);
        // The other coordinate is whichever lies in this face and isn't along the grain.
        const facing = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
        const flat = facing.indexOf(Math.max(...facing));
        const across = [0, 1, 2].find(axis => axis !== along && axis !== flat) ?? (along + 1) % 3;
        uv.setXY(i, v.getComponent(along), v.getComponent(across));
    }
    return geometry;
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

    // The slab's opening is a little smaller than the door or window, so its edges are
    // buried in the frame and in no plane another surface shares (see core/door-parts.js).
    const cut = hole => ({
        ...hole,
        x0: hole.x0 + OPENING_OVERLAP,
        x1: hole.x1 - OPENING_OVERLAP,
        y0: hole.y0 > 0.005 ? hole.y0 + OPENING_OVERLAP : hole.y0,
        y1: hole.y1 - OPENING_OVERLAP,
    });

    // One extruded slab: floor-level openings (doors, patio windows) are
    // notches in the outline, the others are holes. Cap UVs are the shape's
    // x/y in metres, so the wallpaper runs continuously around openings.
    const outline = new THREE.Shape();
    outline.moveTo(-half, 0);
    for (const hole of holes.filter(h => h.y0 <= 0.005).map(cut)) {
        outline.lineTo(hole.x0, 0);
        outline.lineTo(hole.x0, hole.y1);
        outline.lineTo(hole.x1, hole.y1);
        outline.lineTo(hole.x1, 0);
    }
    outline.lineTo(half, 0);
    outline.lineTo(half, height);
    outline.lineTo(-half, height);
    outline.closePath();
    for (const hole of holes.filter(h => h.y0 > 0.005).map(cut)) {
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

function cylinder(radius, length, axis, x, y, z, material, segments = 24) {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, segments);
    if (axis === 'z') geometry.rotateX(Math.PI / 2);
    if (axis === 'x') geometry.rotateZ(Math.PI / 2);
    geometry.translate(x, y, z);
    return mesh(geometry, material, { shadows: false });
}

/** Lever handles on both faces of a leaf, with their roses and the key cylinder below. */
function leverHandles(along, direction) {
    const group = new THREE.Group();
    const face = LEAF_THICKNESS / 2;
    const metal = materials.handle;
    for (const sign of [-1, 1]) {
        const rose = sign * (face + 0.003);
        group.add(cylinder(0.026, 0.006, 'z', along, LEVER_HEIGHT, rose, metal, 36));
        group.add(cylinder(0.009, 0.05, 'z', along, LEVER_HEIGHT, sign * (face + 0.028), metal));
        // The lever points back towards the hinge, as real ones do.
        const lever = cylinder(0.0085, 0.115, 'x', along - direction * 0.05, LEVER_HEIGHT, sign * (face + 0.05), metal);
        group.add(lever);
        group.add(cylinder(0.0085, 0.017, 'z', along, LEVER_HEIGHT, sign * (face + 0.05), metal));
        group.add(cylinder(0.014, 0.005, 'z', along, LEVER_HEIGHT - 0.12, sign * (face + 0.0025), metal, 24));
    }
    return group;
}

function door({ opening, x0, x1, y1 }, thickness) {
    const group = new THREE.Group();
    const finish = doorMaterial(opening.color);
    const side = opening.side || 1;
    const style = opening.style;
    const frame = doorFrame({ x0, x1, y1 }, thickness, { side, withStop: style === 'hinged' || style === 'double' });
    for (const part of frame) group.add(mesh(joinery(...part.box, part.name === 'architrave' ? 0.003 : 0.001), finish));

    const space = leafOpening({ x0, x1, y1 });
    const open = (opening.open ?? DEFAULT_DOOR_OPEN) / 100;
    const leaf = (hingeX, leafWidth, direction) => {
        // direction: +1 if the leaf extends towards +x from its hinge. It
        // swings towards `side`; fully open is 90°.
        const pivot = new THREE.Group();
        pivot.position.x = hingeX;
        const [a, b] = direction > 0 ? [0, leafWidth] : [-leafWidth, 0];
        pivot.add(mesh(joinery(a, b, space.y0, space.y1, -LEAF_THICKNESS / 2, LEAF_THICKNESS / 2, 0.002), finish));
        pivot.add(leverHandles(direction * (leafWidth - 0.06), direction));
        // Hinges: the knuckles stand out on the side the leaf swings to.
        for (const y of hingeHeights(space)) {
            pivot.add(cylinder(0.006, 0.09, 'y', 0, y, side * (LEAF_THICKNESS / 2 + 0.002), materials.handle, 16));
        }
        pivot.rotation.y = -side * direction * open * Math.PI / 2;
        return pivot;
    };
    if (style === 'hinged') {
        const width = space.x1 - space.x0;
        group.add(opening.hinge === 'end' ? leaf(space.x1, width, -1) : leaf(space.x0, width, 1));
    } else if (style === 'double') {
        const width = (space.x1 - space.x0) / 2 - 0.001;
        group.add(leaf(space.x0, width, 1), leaf(space.x1, width, -1));
    } else if (style === 'sliding') {
        // A panel running on a rail in front of the wall face on the `side` side.
        // It slides towards the wall's start (hinge 'start') or end.
        const [z0, z1] = slidingPanelZ(thickness, side);
        const direction = opening.hinge === 'end' ? 1 : -1;
        const shift = direction * open * (x1 - x0 - 0.08);
        const [a, b] = [x0 + 0.005 + shift, x1 - 0.005 + shift];
        group.add(mesh(joinery(a, b, space.y0, space.y1, z0, z1, 0.002), finish));
        const railStart = Math.min(x0, x0 + direction * (x1 - x0));
        const railEnd = Math.max(x1, x1 + direction * (x1 - x0));
        group.add(mesh(box(railStart, railEnd, y1 + 0.075, y1 + 0.095, Math.min(z0, z1) - (side > 0 ? 0.03 : 0), Math.max(z0, z1) + (side > 0 ? 0 : 0.03)), materials.sash));
        // Recessed pull on the edge that trails into the opening.
        const pull = direction < 0 ? b - 0.075 : a + 0.045;
        const [p0, p1] = side > 0 ? [z1 - 0.003, z1 + 0.002] : [z0 - 0.002, z0 + 0.003];
        group.add(mesh(joinery(pull, pull + 0.03, 0.88, 1.12, p0, p1, 0.002), materials.handle, { shadows: false }));
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
