// Keeps the browser's room in sync with the gateway's shared room document
// (server/scene.py), so an assistant using the MCP server and the person in
// the app edit the same room. It also restores the room after a reload and
// answers screenshot requests.
//
// Local edits are pushed (debounced) with the last revision we saw; remote
// changes arrive as server-sent events and are applied without echoing back.

import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { makeWall } from '../core/store.js';
import { adoptSavedObject, disposeObject, loadGltfScene, makeFurnitureObject, makePlaceholder, setTilt } from '../scene/furniture.js';

const PUSH_DELAY_MS = 400;
const DEG = Math.PI / 180;
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function setupSceneSync({ store, scene, plan, nameFor }) {
    const clientId = `browser:${Math.random().toString(36).slice(2, 10)}`;
    const exporter = new GLTFExporter();
    let revision = null;
    let applying = 0;
    let pushTimer = 0;
    let pushing = null;
    let dirtyAgain = false;
    let online = false;

    // ---- document ⇄ store ----
    function toDocument() {
        return {
            ceilingHeight: store.ceilingHeight,
            walls: store.walls.map(w => ({ id: w.id, start: w.start, end: w.end, finish: w.finish ?? null })),
            floor: store.floor,
            wall: store.wall,
            openings: store.openings,
            lights: store.lights,
            timeOfDay: store.timeOfDay,
            furniture: store.furniture.map(item => ({
                id: item.id,
                name: item.name,
                engine: item.engine ?? null,
                status: item.status ?? 'ready',
                job_id: item.jobId ?? null,
                error: item.error ?? null,
                model_url: item.modelUrl ?? null,
                model_layout: item.modelLayout ?? 'container',
                dimensions: item.dimensions,
                position: {
                    x: round(item.object.position.x * 100),
                    y: round(item.object.position.y * 100),
                    z: round(item.object.position.z * 100),
                },
                facing: round((((item.object.rotation.y / DEG) % 360) + 360) % 360),
                tilt: item.tilt ?? null,
                thumbnail_url: item.thumbnail && !item.thumbnail.startsWith('data:') ? item.thumbnail : null,
            })),
        };
    }

    const wallsKey = walls => JSON.stringify(walls.map(w => [w.start, w.end, w.finish ?? null]));

    function withoutEcho(fn) {
        applying++;
        try { return fn(); } finally { applying--; }
    }

    function place(object, entry) {
        object.position.set((entry.position?.x ?? 0) / 100, (entry.position?.y ?? 0) / 100, (entry.position?.z ?? 0) / 100);
        object.rotation.y = (entry.facing ?? 0) * DEG;
        object.userData.furnitureId = entry.id;
    }

    function sameDimensions(a, b) {
        return a && b && ['width', 'depth', 'height'].every(k => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.5);
    }

    function swapObject(item, object) {
        object.position.copy(item.object.position);
        object.rotation.copy(item.object.rotation);
        object.userData.furnitureId = item.id;
        const old = item.object;
        item.object = object;
        delete item.footprint;
        disposeObject(old);
        scene.syncFurniture();
    }

    async function loadModel(item, entry) {
        const url = entry.model_url;
        item.modelUrl = url;
        item.modelLayout = entry.model_layout ?? 'raw';
        item.loadedDimensions = { ...entry.dimensions };
        try {
            const model = await loadGltfScene(url);
            if (item.modelUrl !== url || !store.furniture.includes(item)) return; // superseded
            const object = item.modelLayout === 'raw' ? makeFurnitureObject(model, entry.dimensions, entry.tilt) : adoptSavedObject(model);
            withoutEcho(() => {
                swapObject(item, object);
                store.emit('furniture');
            });
        } catch (error) {
            console.warn(`Could not load ${url}`, error);
        }
    }

    function applyFurniture(entries) {
        const byId = new Map(store.furniture.map(f => [f.id, f]));
        const wanted = new Set(entries.map(e => e.id));
        for (const item of [...store.furniture]) {
            if (!wanted.has(item.id)) store.removeFurniture(item.id);
        }
        for (const entry of entries) {
            let item = byId.get(entry.id);
            if (!item) {
                item = {
                    id: entry.id,
                    name: entry.name ?? nameFor(),
                    dimensions: { ...entry.dimensions },
                    object: makePlaceholder(entry.dimensions),
                    thumbnail: entry.thumbnail_url ?? null,
                };
                store.furniture.push(item);
            }
            Object.assign(item, {
                name: entry.name ?? item.name,
                engine: entry.engine ?? item.engine,
                status: entry.status ?? 'ready',
                error: entry.error ?? null,
                jobId: entry.job_id ?? null,
                thumbnail: item.thumbnail ?? entry.thumbnail_url ?? null,
            });
            const resized = !sameDimensions(item.dimensions, entry.dimensions);
            item.dimensions = { ...entry.dimensions };
            place(item.object, entry);
            if (entry.model_url && (entry.model_url !== item.modelUrl
                || (resized && item.modelLayout === 'raw' && !sameDimensions(item.loadedDimensions, entry.dimensions)))) {
                loadModel(item, entry);
            } else if (!entry.model_url && !item.modelUrl && (resized || !item.object.userData.placeholder)) {
                swapObject(item, makePlaceholder(entry.dimensions));
            } else if (item.modelLayout === 'raw' && !item.object.userData.placeholder
                && JSON.stringify(entry.tilt ?? null) !== JSON.stringify(item.tilt ?? null)) {
                setTilt(item.object, entry.tilt ?? { x: 0, y: 0, z: 0 }, item.dimensions);
            }
            item.tilt = entry.tilt ?? item.tilt ?? null;
            delete item.footprint;
        }
        scene.syncFurniture();
    }

    function apply(document) {
        withoutEcho(() => {
            const walls = (document.walls ?? []).map(w => {
                const wall = makeWall(w.start, w.end, w.finish ?? null);
                if (w.id) wall.id = w.id;
                return wall;
            });
            if (wallsKey(walls) !== wallsKey(store.walls)) store.setWalls(walls, { record: false });
            const openings = (document.openings ?? []).filter(o => store.walls.some(w => w.id === o.wallId));
            if (JSON.stringify(openings) !== JSON.stringify(store.openings)) {
                store.openings = openings;
                if (!openings.some(o => o.id === store.selectedOpeningId)) store.selectedOpeningId = null;
                store.emit('openings');
            }
            store.ceilingHeight = document.ceilingHeight ?? store.ceilingHeight;
            const lights = document.lights ?? [];
            if (JSON.stringify(lights) !== JSON.stringify(store.lights)) {
                store.lights = lights;
                if (!lights.some(l => l.id === store.selectedLightId)) store.selectedLightId = null;
                store.emit('lights');
            }
            if (document.timeOfDay && document.timeOfDay !== store.timeOfDay) store.setTimeOfDay(document.timeOfDay, { record: false });
            if (document.floor) store.floor = { ...document.floor };
            if (document.wall) store.wall = { ...document.wall };
            applyFurniture(document.furniture ?? []);
            for (const type of ['room', 'finish', 'furniture', 'selection']) store.emit(type);
        });
        revision = document.revision;
    }

    // ---- pushing local edits ----
    function schedulePush() {
        if (applying || !online) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(push, PUSH_DELAY_MS);
    }

    async function uploadMissingModels() {
        for (const item of store.furniture) {
            if (item.modelUrl || item.object.userData.placeholder || item.status === 'generating') continue;
            const copy = item.object.clone(true);
            copy.position.set(0, 0, 0);
            copy.rotation.set(0, 0, 0);
            const glb = await exporter.parseAsync(copy, { binary: true });
            const response = await fetch('/api/models', { method: 'POST', body: glb, headers: { 'content-type': 'model/gltf-binary' } });
            if (!response.ok) throw new Error(`model upload failed (${response.status})`);
            const { model_url: url } = await response.json();
            item.modelUrl = url;
            item.modelLayout = 'container';
        }
    }

    async function push() {
        if (pushing) { dirtyAgain = true; return; }
        pushing = (async () => {
            try {
                await uploadMissingModels();
                const response = await fetch('/api/scene', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ scene: toDocument(), base_revision: revision, origin: clientId }),
                });
                const body = await response.json();
                if (response.status === 409) apply(body.scene); // someone else wrote first; take theirs
                else if (response.ok) revision = body.revision;
            } catch (error) {
                console.warn('Room sync failed', error);
            }
        })();
        await pushing;
        pushing = null;
        if (dirtyAgain) { dirtyAgain = false; schedulePush(); }
    }

    // ---- screenshots ----
    async function render(id, view) {
        try {
            const url = view?.mode === 'plan' ? plan.snapshot() : scene.snapshot(view ?? {});
            const blob = await (await fetch(url)).blob();
            await fetch(`/api/scene/render/${id}`, { method: 'POST', body: blob, headers: { 'content-type': 'image/png' } });
        } catch (error) {
            console.warn('Render request failed', error);
        }
    }

    // ---- connection ----
    async function pull() {
        const response = await fetch('/api/scene');
        if (response.ok) apply(await response.json());
    }

    async function start() {
        // Keep trying: the API may start (or be restarted) after the page loads.
        const retry = () => setTimeout(start, 5000);
        try {
            const response = await fetch('/api/scene');
            if (!response.ok) return retry();
            const document = await response.json();
            online = true;
            const hasContent = document.walls?.length || document.furniture?.length;
            if (hasContent) apply(document);
            else { revision = document.revision; if (store.walls.length || store.furniture.length) schedulePush(); }
        } catch {
            return retry(); // API offline: the app works standalone meanwhile
        }
        const events = new EventSource('/api/scene/events');
        events.onmessage = message => {
            const event = JSON.parse(message.data);
            if (event.type === 'render') render(event.id, event.view);
            else if (event.type === 'hello' && event.revision !== revision) pull();
            else if (event.type === 'scene' && event.origin !== clientId && event.revision > (revision ?? -1)) pull();
        };
    }

    store.on('walls room finish furniture openings lights lighting', schedulePush);
    start();

    return {
        get online() { return online; },
        /** Call after an item's geometry changed locally (shape edits). */
        invalidateModel(item) {
            item.modelUrl = null;
            item.modelLayout = 'container';
            schedulePush();
        },
    };
}
