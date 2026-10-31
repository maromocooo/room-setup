// A curtain, its rod and tiebacks. Positions come from core/curtains.js; this turns
// them into cloth: a grid of vertices with folds, in any colour and fabric.

import * as THREE from 'three';
import { curtainLayout, findCurtainMaterial, foldDepth, panelWidthAt } from '../core/curtains.js';

const ROWS = 36;
const SEGMENTS_PER_FOLD = 8;
const FOLD_PITCH = 0.11; // m of closed width per fold

const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.4, metalness: 0.75 });
metal.userData.shared = true;

const textures = new Map();

/** Grey weave that tints with any colour, tiled in metres. */
function fabricTexture(spec) {
    if (textures.has(spec.id)) return textures.get(spec.id);
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    const image = context.createImageData(size, size);
    const threads = spec.id === 'velvet' ? 0 : 32;
    // Seeded, so a reload shows the same cloth.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let shade = 240 + random() * 12;
            if (threads) {
                const cellX = (x * threads) / size;
                const cellY = (y * threads) / size;
                const over = (Math.floor(cellX) + Math.floor(cellY)) % 2 === 0;
                const across = over ? Math.sin((cellY % 1) * Math.PI) : Math.sin((cellX % 1) * Math.PI);
                shade *= 0.94 + 0.06 * across;
                // Linen's thread thickness varies, which is what makes it look like linen.
                if (spec.id === 'linen') shade *= 0.97 + 0.03 * Math.sin(y * 0.7 + random() * 2);
            }
            const i = (y * size + x) * 4;
            image.data[i] = image.data[i + 1] = image.data[i + 2] = shade;
            image.data[i + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.setScalar(1 / (spec.thread * 32)); // uvs are in metres
    texture.anisotropy = 4;
    textures.set(spec.id, texture);
    return texture;
}

function cloth(spec, color) {
    const options = {
        color, map: fabricTexture(spec), roughness: spec.roughness, side: THREE.DoubleSide,
        transparent: spec.opacity < 1, opacity: spec.opacity, depthWrite: spec.opacity >= 1,
    };
    if (spec.sheen) {
        const sheen = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
        return new THREE.MeshPhysicalMaterial({ ...options, sheen: spec.sheen, sheenRoughness: 0.45, sheenColor: sheen });
    }
    return new THREE.MeshStandardMaterial(options);
}

/** One panel: `outer` hangs from the rod's end, and the rest gathers towards it. */
function panelGeometry(panel, layout) {
    const folds = Math.max(3, Math.round(panel.closed / FOLD_PITCH));
    const columns = folds * SEGMENTS_PER_FOLD;
    const positions = [];
    const uvs = [];
    const indices = [];
    const drop = layout.top - layout.bottom;
    const cloth = panel.closed; // the cloth's real width, whatever it is gathered to
    for (let row = 0; row <= ROWS; row++) {
        const down = row / ROWS;
        const width = panelWidthAt(panel, layout.tied, down);
        const depth = foldDepth(panel, width);
        const y = layout.top - drop * down;
        for (let column = 0; column <= columns; column++) {
            const across = column / columns;
            const x = panel.outer + panel.direction * across * width;
            // Folds wander a little as they fall, as real ones do.
            const wander = 0.25 * Math.sin(down * 5 + across * 9) * down;
            const z = layout.z + layout.side * depth * Math.sin((across * folds + wander) * Math.PI * 2);
            positions.push(x, y, z);
            uvs.push(across * cloth, y);
        }
    }
    const stride = columns + 1;
    for (let row = 0; row < ROWS; row++) {
        for (let column = 0; column < columns; column++) {
            const a = row * stride + column;
            indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function cylinderX(x0, x1, y, z, radius, material) {
    const geometry = new THREE.CylinderGeometry(radius, radius, x1 - x0, 16).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, y, z);
    return new THREE.Mesh(geometry, material);
}

/** The band around a gathered panel, and the tassel hanging from it. */
function tieback(panel, layout, material, shadows) {
    const group = new THREE.Group();
    const down = (layout.top - layout.tieY) / (layout.top - layout.bottom);
    const width = panelWidthAt(panel, true, down);
    const depth = foldDepth(panel, width) + 0.012;
    const x = panel.outer + panel.direction * width / 2;
    const band = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 40).rotateX(Math.PI / 2), material);
    band.scale.set(width / 2 + 0.008, 1, depth);
    band.position.set(x, layout.tieY, layout.z);
    group.add(band);
    // The tassel hangs on the room side, towards the window.
    const hang = new THREE.Group();
    hang.position.set(x, layout.tieY, layout.z + layout.side * depth);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), material);
    knot.position.y = -0.022;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.022, 0.085, 14), material);
    skirt.position.y = -0.08;
    hang.add(knot, skirt);
    group.add(hang);
    group.traverse(o => { if (o.isMesh) o.castShadow = shadows; });
    return group;
}

/** `hole` is the window's span on the wall, as wall-builder.js computes it. */
export function curtainFor({ opening, x0, x1, y0, y1 }, { thickness, wallHeight, wallHalf }) {
    const curtain = opening.curtain;
    const group = new THREE.Group();
    const spec = findCurtainMaterial(curtain.material);
    const layout = curtainLayout({ x0, x1, y0, y1, wallHeight, wallHalf, thickness, side: opening.side || 1, open: curtain.open });
    const fabric = cloth(spec, curtain.color);
    const shadows = spec.opacity >= 1; // sheer lets the daylight through
    for (const panel of layout.panels) {
        const mesh = new THREE.Mesh(panelGeometry(panel, layout), fabric);
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        group.add(mesh);
    }

    const { rod } = layout;
    group.add(cylinderX(rod.x0, rod.x1, rod.y, rod.z, 0.011, metal));
    for (const [x, direction] of [[rod.x0, -1], [rod.x1, 1]]) {
        const finial = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), metal);
        finial.position.set(x + direction * 0.012, rod.y, rod.z);
        group.add(finial);
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, Math.abs(rod.z)), metal);
        bracket.position.set(x - direction * 0.05, rod.y, rod.z / 2);
        group.add(bracket);
    }

    if (layout.tied) {
        // A shade darker than the cloth, as a matching tieback usually is.
        const trim = new THREE.MeshStandardMaterial({
            color: new THREE.Color(curtain.color).multiplyScalar(0.72), roughness: 0.75,
        });
        for (const panel of layout.panels) group.add(tieback(panel, layout, trim, shadows));
    }
    return group;
}
