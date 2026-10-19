// Application state plus wall undo history. Views subscribe to change events:
//   'walls'      wall geometry or per-wall finishes changed
//   'openings'   doors/windows added, removed or edited
//   'lights'     light fixtures added, removed or edited
//   'lighting'   time of day changed
//   'room'       ceiling height changed
//   'finish'     floor or default wall finish changed
//   'furniture'  furniture added, removed, renamed or moved
//   'selection'  selected wall, opening or furniture changed
//
// A finish is { preset: id } or { image: dataUrl }. Openings are described in
// openings.js; undo covers walls and openings together.

import { mergeWalls } from './geometry.js';
import { clampOpening, reanchorOpenings } from './openings.js';

let nextWallId = 1;
const newWallId = () => `w${nextWallId++}`;

export function makeWall(start, end, finish = null) {
    return { id: newWallId(), start: { ...start }, end: { ...end }, finish };
}

const wallsKey = walls => walls
    .map(w => [w.start, w.end].map(p => `${p.x},${p.y}`).sort().join('|') + JSON.stringify(w.finish ?? null))
    .sort().join(';');

const cloneWalls = walls => walls.map(w => ({ ...w, start: { ...w.start }, end: { ...w.end } }));
const cloneOpenings = openings => openings.map(o => ({ ...o }));
const cloneLights = lights => lights.map(l => ({ ...l }));

export class Store extends EventTarget {
    constructor() {
        super();
        this.walls = [];
        this.ceilingHeight = 240;
        this.floor = { finish: { preset: 'oak' }, scale: 1 };
        this.wall = { finish: { preset: 'standard' }, scale: 1 };
        this.furniture = [];
        this.openings = [];
        this.lights = [];
        this.timeOfDay = 'day';
        this.selectedLightId = null;
        this.selectedWallId = null;
        this.selectedOpeningId = null;
        this.selectedFurnitureId = null;
        this.dirty = false;
        this._undo = [];
        this._redo = [];
    }

    emit(type) {
        if (type !== 'selection') this.dirty = true;
        this.dispatchEvent(new Event(type));
    }

    on(types, handler) {
        for (const type of types.split(' ')) this.addEventListener(type, handler);
    }

    // ---- walls (undoable) ----
    snapshotPlan() {
        return { walls: cloneWalls(this.walls), openings: cloneOpenings(this.openings), lights: cloneLights(this.lights) };
    }

    checkpoint() {
        this._undo.push(this.snapshotPlan());
        if (this._undo.length > 100) this._undo.shift();
        this._redo = [];
    }

    setWalls(walls, { record = true } = {}) {
        const merged = mergeWalls(walls);
        // Redrawing over an existing wall can leave the plan unchanged; that
        // shouldn't become an undo step.
        if (record && wallsKey(merged) !== wallsKey(this.walls)) this.checkpoint();
        const previous = this.walls;
        this.walls = merged.map(w => (w.id ? w : { ...w, id: newWallId() }));
        if (!this.walls.some(w => w.id === this.selectedWallId)) this.selectedWallId = null;
        const openingCount = this.openings.length;
        this.openings = reanchorOpenings(this.openings, previous, this.walls, this.ceilingHeight);
        if (!this.openings.some(o => o.id === this.selectedOpeningId)) this.selectedOpeningId = null;
        this.emit('walls');
        if (openingCount || this.openings.length) this.emit('openings');
    }

    _restorePlan(snapshot) {
        this.walls = snapshot.walls;
        this.openings = snapshot.openings;
        this.lights = snapshot.lights ?? this.lights;
        if (!this.lights.some(l => l.id === this.selectedLightId)) this.selectedLightId = null;
        if (!this.walls.some(w => w.id === this.selectedWallId)) this.selectedWallId = null;
        if (!this.openings.some(o => o.id === this.selectedOpeningId)) this.selectedOpeningId = null;
        this.emit('walls');
        this.emit('openings');
        this.emit('lights');
    }

    /** Call after mutating wall objects in place (e.g. while dragging). */
    touchWalls() {
        this.emit('walls');
    }

    resetHistory() {
        this._undo = [];
        this._redo = [];
    }

    get canUndo() { return this._undo.length > 0; }
    get canRedo() { return this._redo.length > 0; }

    undo() {
        if (!this._undo.length) return;
        this._redo.push(this.snapshotPlan());
        this._restorePlan(this._undo.pop());
    }

    redo() {
        if (!this._redo.length) return;
        this._undo.push(this.snapshotPlan());
        this._restorePlan(this._redo.pop());
    }

    // ---- doors & windows (undoable) ----
    getOpening(id) {
        return this.openings.find(o => o.id === id) ?? null;
    }

    addOpening(opening) {
        this.checkpoint();
        this.openings = [...this.openings, opening];
        this.emit('openings');
    }

    /** Apply a patch (clamped to the wall). Pass record: false while dragging. */
    updateOpening(id, patch, { record = true } = {}) {
        const opening = this.getOpening(id);
        const wall = this.walls.find(w => w.id === (patch.wallId ?? opening?.wallId));
        if (!opening || !wall) return;
        if (record) this.checkpoint();
        const updated = clampOpening({ ...opening, ...patch }, wall, this.ceilingHeight);
        this.openings = this.openings.map(o => (o.id === id ? updated : o));
        this.emit('openings');
    }

    removeOpening(id) {
        if (!this.getOpening(id)) return;
        this.checkpoint();
        this.openings = this.openings.filter(o => o.id !== id);
        if (this.selectedOpeningId === id) this.selectedOpeningId = null;
        this.emit('openings');
        this.emit('selection');
    }

    // ---- lights (undoable) ----
    getLight(id) {
        return this.lights.find(l => l.id === id) ?? null;
    }

    addLight(light) {
        this.checkpoint();
        this.lights = [...this.lights, light];
        this.emit('lights');
    }

    updateLight(id, patch, { record = true } = {}) {
        if (!this.getLight(id)) return;
        if (record) this.checkpoint();
        this.lights = this.lights.map(l => (l.id === id ? { ...l, ...patch } : l));
        this.emit('lights');
    }

    removeLight(id) {
        if (!this.getLight(id)) return;
        this.checkpoint();
        this.lights = this.lights.filter(l => l.id !== id);
        if (this.selectedLightId === id) this.selectedLightId = null;
        this.emit('lights');
        this.emit('selection');
    }

    selectLight(id) {
        if (this.selectedLightId === id) return;
        this.selectedLightId = id;
        this.emit('selection');
    }

    setTimeOfDay(time) {
        this.timeOfDay = time;
        this.emit('lighting');
    }

    selectOpening(id) {
        if (this.selectedOpeningId === id) return;
        this.selectedOpeningId = id;
        this.emit('selection');
    }

    selectWall(id) {
        if (this.selectedWallId === id) return;
        this.selectedWallId = id;
        this.emit('selection');
    }

    // ---- room ----
    setCeilingHeight(cm) {
        this.ceilingHeight = cm;
        // Tall doors and windows must still fit under the new ceiling.
        const byId = new Map(this.walls.map(w => [w.id, w]));
        this.openings = this.openings.map(o => (byId.has(o.wallId) ? clampOpening(o, byId.get(o.wallId), cm) : o));
        this.emit('room');
        if (this.openings.length) this.emit('openings');
    }

    setFloor(patch) {
        Object.assign(this.floor, patch);
        this.emit('finish');
    }

    setWallFinish(patch) {
        Object.assign(this.wall, patch);
        this.emit('finish');
    }

    // ---- furniture ----
    addFurniture(item) {
        this.furniture.push(item);
        this.emit('furniture');
    }

    removeFurniture(id) {
        const index = this.furniture.findIndex(f => f.id === id);
        if (index === -1) return null;
        const [item] = this.furniture.splice(index, 1);
        if (this.selectedFurnitureId === id) this.selectFurniture(null);
        this.emit('furniture');
        this.onRemoved?.(item);
        return item;
    }

    getFurniture(id) {
        return this.furniture.find(f => f.id === id) ?? null;
    }

    selectFurniture(id) {
        if (this.selectedFurnitureId === id) return;
        this.selectedFurnitureId = id;
        this.emit('selection');
    }

    clear() {
        this.setWalls([]);
        this.openings = [];
        this.selectedOpeningId = null;
        this.lights = [];
        this.selectedLightId = null;
        this.emit('openings');
        this.emit('lights');
        for (const item of [...this.furniture]) this.removeFurniture(item.id);
    }
}
