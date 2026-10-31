// Top-level wiring: views, tabs, theme, language, keyboard shortcuts and
// project save/open.

import { applyTranslations, getLanguage, setLanguage, t } from './core/i18n.js';
import { Store } from './core/store.js';
import { PlanEditor, isTyping } from './plan/plan-editor.js';
import { RoomScene, footprint } from './scene/room-scene.js';
import { MeshEditor } from './scene/mesh-editor.js';
import { cloneFurnitureObject, disposeObject, turnFurniture } from './scene/furniture.js';
import { TILT_TURNS, turnTilt } from './core/tilt.js';
import { createAttachedLight, lightPlacement, movePatch } from './core/lights.js';
import { downloadBlob, openProject, saveProject } from './project/project-io.js';
import { hydrateIcons, icon } from './ui/icons.js';
import { createToasts } from './ui/toasts.js';
import { setupRoomPanel } from './ui/room-panel.js';
import { setupFinishPanel } from './ui/finish-panel.js';
import { setupGenerationPanel } from './ui/generation-panel.js';
import { setupFurniturePanel } from './ui/furniture-panel.js';
import { setupSceneSync } from './sync/scene-sync.js';
import { setupOpeningsPanel } from './ui/openings-panel.js';
import { setupLightsPanel } from './ui/lights-panel.js';
import { reanchorOpenings } from './core/openings.js';

const THEME_KEY = 'room-setup.theme';

export function startApp() {
    hydrateIcons();
    const $ = id => document.getElementById(id);
    const store = new Store();
    const toast = createToasts($('toasts'));
    const scene = new RoomScene($('roomCanvas'), store);

    const plan = new PlanEditor($('planCanvas'), store, {
        footprints: () => scene.footprints(),
        moveFurniture: (id, x, z) => {
            const item = store.getFurniture(id);
            if (item) { scene.moveFurnitureTo(item, x, z); store.emit('furniture'); }
        },
        onOpeningPlaced: () => setTool('select'),
        onLightPlaced: () => setTool('select'),
        furniturePose: id => scene.furniturePose(id),
        onHud: ({ x, y, zoom }) => {
            $('planHud').textContent = t('plan.hud', { x: plan.formatLength(x), y: plan.formatLength(y), zoom: Math.round(zoom * 100 / 1.6) });
        },
    });

    // ---- furniture actions ----
    let furnitureCounter = 0;
    const nextName = () => t('furniture.defaultName', { number: ++furnitureCounter });

    function placeFurniture({ id, object, dimensions, thumbnail, engine, modelUrl = null }) {
        const center = scene.roomCenter();
        const n = store.furniture.length;
        object.position.set(center.x + (n % 3) * 0.35, 0, center.z + Math.floor(n / 3) % 3 * 0.35);
        const item = { id, name: nextName(), object, dimensions, thumbnail, engine, modelUrl, modelLayout: 'raw', loadedDimensions: { ...dimensions } };
        object.userData.furnitureId = id;
        store.addFurniture(item);
        scene.syncFurniture();
        store.selectFurniture(id);
        return item;
    }

    function duplicate(item) {
        const object = cloneFurnitureObject(item.object);
        object.position.x += 0.3;
        object.position.z += 0.3;
        const id = `${item.id}-${Date.now().toString(36)}`;
        object.userData.furnitureId = id;
        store.addFurniture({ ...item, id, name: t('furniture.copyName', { name: item.name }), object, footprint: undefined });
        scene.syncFurniture();
        store.selectFurniture(id);
    }

    // Removed furniture stays in memory briefly so "Undo" can bring it back,
    // then its GPU resources are released.
    const DISPOSE_DELAY_MS = 15000;
    let dismissUndo = null;
    store.onRemoved = item => {
        setTimeout(() => {
            if (store.furniture.includes(item)) return; // brought back with Undo
            disposeObject(item.object);
            // Lights that lived in this item go too.
            if (store.lights.some(l => l.attach?.furnitureId === item.id)) {
                store.lights = store.lights.filter(l => l.attach?.furnitureId !== item.id);
                store.emit('lights');
            }
        }, DISPOSE_DELAY_MS);
    };

    function remove(item) {
        const index = store.furniture.indexOf(item);
        store.removeFurniture(item.id);
        scene.syncFurniture();
        dismissUndo?.();
        dismissUndo = toast(t('toast.deleted', { name: item.name }), {
            action: {
                label: t('toast.undo'),
                onClick: () => {
                    store.furniture.splice(Math.min(index, store.furniture.length), 0, item);
                    store.emit('furniture');
                    scene.syncFurniture();
                    store.selectFurniture(item.id);
                },
            },
        });
    }

    const meshEditor = new MeshEditor($('meshEditor'), {
        onApply: item => { sync.invalidateModel(item); store.emit('furniture'); },
    });

    setupRoomPanel({ store, plan, onTemplate: () => { plan.fit(); scene.requestFraming(); } });
    const finishes = setupFinishPanel({ store, toast });
    const lightsPanel = setupLightsPanel({
        store, plan,
        onArm: preset => {
            if (!preset) return setTool('select');
            plan.lightPreset = preset;
            setTool('light');
            showView('plan');
        },
    });
    const openingsPanel = setupOpeningsPanel({
        store, plan,
        onArm: preset => {
            if (!preset) return setTool('select');
            plan.openingPreset = preset;
            setTool('opening');
            showView('plan');
        },
    });
    const generation = setupGenerationPanel({ store, toast, placeFurniture });
    const furniturePanel = setupFurniturePanel({
        store, onEdit: item => meshEditor.open(item), onDuplicate: duplicate, onDelete: remove, onTilt: tilt,
        onAddLight: item => {
            const light = createAttachedLight(item.id, footprint(item).height * 100);
            store.addLight(light);
            store.selectFurniture(null);
            store.selectLight(light.id);
        },
    });

    // Turn a piece of furniture: to lay it down, or to fix a model that was generated
    // upside down or on its side.
    function tilt(item, turn) {
        const orient = item.object.getObjectByName('rs-orient');
        if (!item.tilt && orient) {
            const deg = r => Math.round(r * 180 / Math.PI * 100) / 100;
            item.tilt = { x: deg(orient.rotation.x), y: deg(orient.rotation.y), z: deg(orient.rotation.z) };
        }
        item.tilt = turnTilt(item.tilt, ...TILT_TURNS[turn]);
        item.dimensions = turnFurniture(item.object, item.tilt, item.dimensions, turn);
        item.loadedDimensions = { ...item.dimensions };
        delete item.footprint;
        // Generated ('raw') models are rebuilt from their tilt everywhere;
        // others carry it baked into their geometry, so upload them again.
        if (item.modelLayout !== 'raw') sync.invalidateModel(item);
        store.emit('furniture');
    }

    const sync = setupSceneSync({ store, scene, plan, nameFor: nextName });

    scene.onSelect = id => { store.selectFurniture(id); if (id) store.selectLight(null); };
    scene.onSelectLight = id => { store.selectLight(id); store.selectFurniture(null); };
    // Dragging a light's arrows in 3D: `delta` is metres from where the drag began.
    let lightDrag = null;
    scene.onLightMove = (id, delta, final) => {
        if (lightDrag?.id !== id) {
            const light = store.getLight(id);
            const pose = fid => scene.furniturePose(fid);
            lightDrag = { id, light: structuredClone(light), place: lightPlacement(light, store.ceilingHeight, pose) };
            store.checkpoint();
        }
        const { light, place } = lightDrag;
        const target = { x: place.x + delta.x * 100, y: place.y + delta.z * 100, height: place.height + delta.y * 100 };
        store.updateLight(id, movePatch(light, target, store.ceilingHeight, fid => scene.furniturePose(fid)), { record: false });
        if (final) lightDrag = null;
    };
    scene.onTransform = () => { store.emit('furniture'); };

    store.on('walls room finish openings', () => scene.rebuildRoom());
    store.on('lights room furniture', () => scene.syncLights());
    store.on('selection', () => scene.syncLights());
    store.on('lighting', () => scene.setTimeOfDay(store.timeOfDay));
    store.on('furniture', () => scene.syncFurniture());
    store.on('selection', () => scene.syncSelection());
    store.on('walls', updateEmptyStates);
    store.on('walls', updateUndo);
    let lastSelection = {};
    store.on('selection', () => {
        // Jump to the tab that edits whatever was just selected.
        if (store.selectedFurnitureId && store.selectedFurnitureId !== lastSelection.furniture) showTab('furniture');
        if (store.selectedOpeningId && store.selectedOpeningId !== lastSelection.opening) showTab('room');
        if (store.selectedLightId && store.selectedLightId !== lastSelection.light) showTab('lights');
        lastSelection = { furniture: store.selectedFurnitureId, opening: store.selectedOpeningId, light: store.selectedLightId };
    });

    // ---- views ----
    let view = 'plan';
    function showView(next) {
        view = next;
        for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-selected', String(button.dataset.view === next));
        $('planView').dataset.active = String(next === 'plan');
        $('roomView').dataset.active = String(next === 'room');
        if (next === 'room') scene.show(); else { scene.hide(); plan.resize(); }
        syncToolbars();
    }
    for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => showView(button.dataset.view));

    // ---- plan toolbar ----
    function setTool(tool) {
        plan.setTool(tool);
        syncToolbars();
        openingsPanel.render();
        lightsPanel.render();
    }
    for (const button of document.querySelectorAll('[data-tool]')) button.addEventListener('click', () => setTool(button.dataset.tool));
    $('undo').addEventListener('click', () => store.undo());
    $('redo').addEventListener('click', () => store.redo());
    $('zoomFit').addEventListener('click', () => plan.fit());
    $('gridSize').addEventListener('change', e => plan.setGrid(Number(e.target.value)));
    $('unitSelect').addEventListener('change', e => {
        plan.setUnit(e.target.value);
        // Display-only change: notify without marking the project as edited.
        for (const type of ['room', 'walls']) store.dispatchEvent(new Event(type));
    });

    // ---- 3D toolbar ----
    for (const button of document.querySelectorAll('[data-camera]')) button.addEventListener('click', () => scene.setCamera(button.dataset.camera));
    for (const button of document.querySelectorAll('[data-walls]')) button.addEventListener('click', () => { scene.setWallMode(button.dataset.walls); syncToolbars(); });
    for (const button of document.querySelectorAll('[data-gizmo]')) button.addEventListener('click', () => { scene.setGizmoMode(button.dataset.gizmo); syncToolbars(); });
    $('brightness').addEventListener('input', e => scene.setBrightness(Number(e.target.value)));
    $('walkExit').addEventListener('click', () => scene.stopWalk());
    let walkUnlockedAt = 0;
    scene.onWalkChange = () => {
        if (scene.walk && !scene.walk.locked) walkUnlockedAt = performance.now();
        syncToolbars();
    };

    function syncToolbars() {
        for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === plan.tool));
        for (const b of document.querySelectorAll('[data-walls]')) b.setAttribute('aria-pressed', String(b.dataset.walls === scene.wallMode));
        for (const b of document.querySelectorAll('[data-gizmo]')) b.setAttribute('aria-pressed', String(b.dataset.gizmo === scene.gizmoMode));
        $('walkToggle').setAttribute('aria-pressed', String(scene.walking));
        const locked = scene.walking && scene.walk.locked;
        $('walkBar').hidden = !scene.walking;
        $('walkCrosshair').hidden = !locked;
        $('roomHint').hidden = scene.walking;
        $('walkHint').dataset.i18n = locked ? 'walk.hintLocked' : 'walk.hint';
        $('walkHint').textContent = t($('walkHint').dataset.i18n);
    }

    function updateUndo() {
        $('undo').disabled = !store.canUndo;
        $('redo').disabled = !store.canRedo;
    }

    function updateEmptyStates() {
        $('planEmpty').hidden = store.walls.length > 0;
        $('roomEmpty').hidden = store.walls.length > 0;
    }

    // ---- tabs ----
    function showTab(name) {
        for (const tab of document.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
        for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
        generation.setActive(name === 'furniture');
    }
    for (const tab of document.querySelectorAll('[data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));

    // ---- theme & language ----
    function currentTheme() {
        return document.documentElement.dataset.theme
            ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    function renderThemeButton() {
        $('themeToggle').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
    }
    $('themeToggle').addEventListener('click', () => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch { /* not persisted */ }
        onThemeChange();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onThemeChange);
    function onThemeChange() {
        renderThemeButton();
        plan.requestRender();
        scene.applyTheme();
    }

    $('languageSelect').addEventListener('change', e => {
        setLanguage(e.target.value);
        refreshLanguage();
    });
    function refreshLanguage() {
        document.documentElement.lang = getLanguage();
        $('languageSelect').value = getLanguage();
        applyTranslations();
        finishes.relabel();
        generation.relabel();
        store.emit('selection');
        for (const type of ['walls', 'furniture']) store.dispatchEvent(new Event(type));
    }

    // ---- project files ----
    $('saveProject').addEventListener('click', async () => {
        try {
            downloadBlob(await saveProject(store), 'room-project.zip');
            store.dirty = false;
            toast(t('toast.saved'), { type: 'success' });
        } catch (error) {
            console.error(error);
            toast(t('toast.saveFailed', { message: error.message }), { type: 'error' });
        }
    });
    $('openProject').addEventListener('click', () => $('openProjectInput').click());
    $('openProjectInput').addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const project = await openProject(file);
            dismissUndo?.();
            for (const item of store.furniture) disposeObject(item.object);
            store.furniture = [];
            store.selectFurniture(null);
            store.ceilingHeight = project.ceilingHeight;
            store.floor = project.floor;
            store.wall = project.wall;
            store.setWalls(project.walls, { record: false });
            store.openings = reanchorOpenings(project.openings, project.walls, store.walls, store.ceilingHeight);
            store.selectedOpeningId = null;
            store.lights = project.lights;
            store.selectedLightId = null;
            store.timeOfDay = project.timeOfDay;
            store.resetHistory();
            furnitureCounter = 0;
            for (const entry of project.furniture) {
                entry.object.userData.furnitureId = entry.id;
                store.furniture.push({ ...entry, name: entry.name ?? nextName() });
            }
            store.emit('room');
            store.emit('finish');
            store.emit('openings');
            store.emit('lights');
            store.emit('lighting');
            store.emit('furniture');
            store.dirty = false;
            plan.fit();
            scene.requestFraming();
            updateUndo();
            if (project.failed.length) toast(t('toast.openPartial', { count: project.failed.length }), { type: 'error' });
            else toast(t('toast.opened'), { type: 'success' });
        } catch (error) {
            console.error(error);
            const message = error.code === 'missing-manifest' ? t('toast.projectMissing') : error.message;
            toast(t('toast.openFailed', { message }), { type: 'error' });
        }
    });

    // ---- keyboard ----
    window.addEventListener('keydown', e => {
        if (isTyping(e) || $('meshEditor').open) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
        if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
        if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('saveProject').click(); return; }
        if (mod || e.altKey) return;
        const key = e.key.toLowerCase();
        if (view === 'plan' && key === 'w') setTool('wall');
        else if (view === 'plan' && key === 'v') setTool('select');
        else if (view === 'plan' && key === 'e') setTool('erase');
        else if (view === 'plan' && key === 'f') plan.fit();
        else if (key === 'escape' && scene.walking) {
            // The Esc that released the mouse should not also end the walk.
            if (!scene.walk.locked && performance.now() - walkUnlockedAt > 300) scene.stopWalk();
        } else if (key === 'escape') {
            plan.cancel();
            if (plan.tool === 'opening' || plan.tool === 'light') setTool('select');
            store.selectFurniture(null);
            store.selectWall(null);
            store.selectOpening(null);
            store.selectLight(null);
        } else if (key === 'delete' || key === 'backspace') {
            const item = store.getFurniture(store.selectedFurnitureId);
            if (store.selectedOpeningId) store.removeOpening(store.selectedOpeningId);
            else if (store.selectedLightId) store.removeLight(store.selectedLightId);
            else if (item) remove(item);
            else if (view === 'plan') plan.deleteSelectedWall();
        } else if (key === 'r' && store.selectedFurnitureId) {
            const item = store.getFurniture(store.selectedFurnitureId);
            item.object.rotation.y += (e.shiftKey ? -1 : 1) * Math.PI / 2;
            store.emit('furniture');
        } else if (view === 'room' && key === 't') { scene.setGizmoMode('translate'); syncToolbars(); }
    });

    window.addEventListener('beforeunload', e => {
        // With the API running the room is kept server-side; otherwise warn.
        if (!sync.online && store.dirty && (store.walls.length || store.furniture.length)) e.preventDefault();
    });

    // ---- start ----
    refreshLanguage();
    renderThemeButton();
    updateUndo();
    updateEmptyStates();
    showTab('room');
    showView('plan');
    store.setCeilingHeight(store.ceilingHeight);
    store.dirty = false;
    requestAnimationFrame(() => plan.fit());

    // Handy for debugging from the console; not used by the app itself.
    window.roomSetup = { store, plan, scene, footprint };
}
