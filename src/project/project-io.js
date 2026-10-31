// Saving and opening project ZIPs (project.json + models + images).

import JSZip from 'jszip';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { makeWall } from '../core/store.js';
import { newOpeningId } from '../core/openings.js';
import { newLightId } from '../core/lights.js';
import { adoptSavedObject, disposeObject, loadGltfScene, makeFurnitureObject } from '../scene/furniture.js';
import { buildManifest, parseProject } from './format.js';

const exporter = new GLTFExporter();

async function dataUrlToBlob(url) {
    return (await fetch(url)).blob();
}

async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/** @param {import('../core/store.js').Store} store */
export async function saveProject(store) {
    // Furniture still being generated has no model yet.
    const furniture = store.furniture.filter(item => !item.object.userData.placeholder);
    const { manifest, images } = buildManifest({
        walls: store.walls,
        openings: store.openings,
        lights: store.lights,
        timeOfDay: store.timeOfDay,
        ceilingHeight: store.ceilingHeight,
        floor: store.floor,
        wall: store.wall,
        furniture: furniture.map(item => ({
            id: item.id,
            name: item.name,
            engine: item.engine,
            dimensions: item.dimensions,
            position: item.object.position,
            rotationY: item.object.rotation.y,
            hasThumbnail: Boolean(item.thumbnail),
        })),
    });

    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(manifest, null, 2));
    for (const [path, url] of images) zip.file(path, await dataUrlToBlob(url));

    for (const item of furniture) {
        // Export the container without its placement; project.json has that.
        const copy = item.object.clone(true);
        copy.position.set(0, 0, 0);
        copy.rotation.set(0, 0, 0);
        const glb = await exporter.parseAsync(copy, { binary: true });
        zip.file(`models/${item.id}.glb`, glb);
        if (item.thumbnail) zip.file(`thumbnails/${item.id}.png`, await dataUrlToBlob(item.thumbnail));
    }
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/**
 * Read a project ZIP. Returns the restored pieces; the caller swaps them
 * into the store so a failed open leaves the current room untouched.
 */
export async function openProject(file) {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file('project.json');
    if (!manifestFile) {
        const error = new Error('project.json missing');
        error.code = 'missing-manifest';
        throw error;
    }
    const project = parseProject(JSON.parse(await manifestFile.async('string')));

    const imageAt = async path => {
        const entry = path && zip.file(path);
        if (!entry) return null;
        const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[path.split('.').pop().toLowerCase()] ?? 'image/png';
        return blobToDataUrl(new Blob([await entry.async('uint8array')], { type }));
    };
    const resolveFinish = async finish => {
        if (!finish) return null;
        if (finish.preset) return { preset: finish.preset };
        const image = await imageAt(finish.image);
        return image ? { image } : null;
    };

    const walls = [];
    for (const wall of project.walls) walls.push(makeWall(wall.start, wall.end, await resolveFinish(wall.finish)));

    const furniture = [];
    const failed = [];
    for (const entry of project.furniture) {
        const model = entry.model && zip.file(entry.model);
        if (!model) { failed.push(entry.id); continue; }
        const url = URL.createObjectURL(await model.async('blob'));
        try {
            const scene = await loadGltfScene(url);
            const object = entry.layout === 'raw' ? makeFurnitureObject(scene, entry.dimensions) : adoptSavedObject(scene);
            object.position.set(entry.position.x, entry.position.y, entry.position.z);
            object.rotation.y = entry.rotationY;
            furniture.push({ ...entry, object, thumbnail: await imageAt(entry.thumbnail) });
        } catch (error) {
            console.warn(`Could not load furniture ${entry.id}`, error);
            failed.push(entry.id);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    const openings = project.openings.map(({ wall, ...rest }) => ({ ...rest, id: newOpeningId(), wallId: walls[wall].id }));

    return {
        walls,
        openings,
        lights: project.lights.map(light => ({ ...light, id: newLightId() })),
        timeOfDay: project.timeOfDay,
        ceilingHeight: project.ceilingHeight,
        floor: { ...project.floor, finish: (await resolveFinish(project.floor.finish)) ?? { preset: 'oak' }, scale: project.floor.scale },
        wall: { finish: (await resolveFinish(project.wall.finish)) ?? { preset: 'standard' }, scale: project.wall.scale },
        furniture,
        failed,
        dispose: () => furniture.forEach(f => disposeObject(f.object)),
    };
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
