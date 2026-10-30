// Loading generated models and turning them into placeable furniture.
//
// Each item's `object` is a container Group whose origin sits at the
// bottom-centre of the model; position/rotation live on the container,
// scale and centring on the model inside it. Rotating therefore spins the
// item in place, and the container exports cleanly to GLB.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

export async function loadGltfScene(url) {
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
}

function prepareMaterials(root) {
    root.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        for (const material of [child.material].flat()) {
            // Generated meshes are not reliably closed or consistently wound.
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
        }
    });
}

/**
 * Wrap a freshly generated model in a container, scaled so its bounding box
 * matches the requested size in centimetres. The longer horizontal side of
 * the model is paired with the longer of width/depth, so a sofa generated
 * sideways is not squashed.
 *
 * Layers: container (placement) → 'rs-fit' (scale, centring) → 'rs-orient'
 * (tilt fix for models generated upside down or on their side) → model.
 * `tilt` is { x, y, z } in degrees (see core/tilt.js).
 */
export function makeFurnitureObject(model, dimensions, tilt = null) {
    prepareMaterials(model);
    const container = useYawOrder(new THREE.Group());
    const { orient } = ensureLayers(container);
    orient.add(model);
    setTilt(container, tilt ?? { x: 0, y: 0, z: 0 }, dimensions);
    return container;
}

/** Size of a loaded model in centimetres as stored in the file (1 unit = 1 m), or null if it is empty. */
export function modelSizeCm(model) {
    model.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (!(size.x > 0 && size.y > 0 && size.z > 0)) return null;
    return { width: size.x * 100, height: size.y * 100, depth: size.z * 100 };
}

/** The fit/orient layers inside a container, wrapping its current content if missing. */
function ensureLayers(container) {
    let fit = container.getObjectByName('rs-fit');
    let orient = container.getObjectByName('rs-orient');
    if (!fit || !orient) {
        fit = new THREE.Group();
        fit.name = 'rs-fit';
        orient = new THREE.Group();
        orient.name = 'rs-orient';
        for (const child of [...container.children]) orient.add(child);
        fit.add(orient);
        container.add(fit);
    }
    return { fit, orient };
}

/** Bounding box of `target` in the container's own (unplaced) frame. */
function localBox(container, target) {
    const saved = { position: container.position.clone(), quaternion: container.quaternion.clone(), parent: container.parent };
    container.position.set(0, 0, 0);
    container.quaternion.identity();
    container.updateMatrixWorld(true);
    // Ignore any parent transform too.
    const parentMatrix = saved.parent?.matrixWorld.clone();
    if (saved.parent) { saved.parent.matrixWorld.identity(); container.updateMatrixWorld(true); }
    const box = new THREE.Box3().setFromObject(target);
    if (saved.parent) saved.parent.matrixWorld.copy(parentMatrix);
    container.position.copy(saved.position);
    container.quaternion.copy(saved.quaternion);
    container.updateMatrixWorld(true);
    return box;
}

/** Scale and centre the content to `dimensions` (cm), standing on y = 0. */
function fitToDimensions(container, dimensions) {
    const { fit } = ensureLayers(container);
    fit.scale.set(1, 1, 1);
    fit.position.set(0, 0, 0);
    const size = localBox(container, fit).getSize(new THREE.Vector3());
    if (dimensions && size.x > 0 && size.y > 0 && size.z > 0) {
        const long = Math.max(dimensions.width, dimensions.depth) / 100;
        const short = Math.min(dimensions.width, dimensions.depth) / 100;
        const xIsLong = size.x >= size.z;
        fit.scale.set((xIsLong ? long : short) / size.x, dimensions.height / 100 / size.y, (xIsLong ? short : long) / size.z);
    }
    const box = localBox(container, fit);
    const centre = box.getCenter(new THREE.Vector3());
    fit.position.set(-centre.x, -box.min.y, -centre.z);
}

/**
 * Turn the model inside its container (e.g. flip one that came out upside
 * down), then fit it to `dimensions` again. Keeps placement and yaw.
 */
export function setTilt(container, tilt, dimensions) {
    const { orient } = ensureLayers(container);
    const rad = THREE.MathUtils.degToRad;
    orient.rotation.set(rad(tilt.x || 0), rad(tilt.y || 0), rad(tilt.z || 0));
    fitToDimensions(container, dimensions);
}

/** A container loaded from a saved project: transforms are already baked in. */
export function adoptSavedObject(root) {
    prepareMaterials(root);
    return useYawOrder(root);
}

// Furniture only turns about +Y. With the default XYZ order, a yaw past 90°
// set through the gizmo's quaternion reads back as (π, 180°−θ, π), which
// breaks everything that uses rotation.y. YXZ keeps the yaw in rotation.y.
function useYawOrder(object) {
    object.rotation.order = 'YXZ';
    return object;
}

/** Deep copy whose geometry and materials can be edited independently. */
export function cloneFurnitureObject(object) {
    const copy = object.clone(true);
    copy.traverse(child => {
        if (!child.isMesh) return;
        child.geometry = child.geometry.clone();
        child.material = Array.isArray(child.material) ? child.material.map(m => m.clone()) : child.material.clone();
    });
    return copy;
}

export function disposeObject(object) {
    object.traverse(child => {
        if (!child.isMesh) return;
        child.geometry.dispose();
        for (const material of [child.material].flat()) {
            for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
            material.dispose();
        }
    });
}

/** Square thumbnail (data URL) of an image source, for lists and saving. */
export async function thumbnailFromBlob(blob, size = 160) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    bitmap.close();
    return canvas.toDataURL('image/png');
}

/** Translucent box standing in for furniture that is still being generated. */
export function makePlaceholder(dimensions) {
    const w = Math.max(dimensions.width, 1) / 100;
    const h = Math.max(dimensions.height, 1) / 100;
    const d = Math.max(dimensions.depth, 1) / 100;
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(0, h / 2, 0);
    const box = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0x7d87f0, transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.6,
    }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x4f5bd5 }));
    // A small marker on the front face so orientation is visible.
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, h * 0.12), new THREE.MeshBasicMaterial({ color: 0x4f5bd5 }));
    front.position.set(0, h * 0.5, d / 2 + 0.002);
    const container = new THREE.Group();
    container.add(box, edges, front);
    container.userData.placeholder = true;
    return useYawOrder(container);
}
