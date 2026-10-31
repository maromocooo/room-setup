// Application state plus undo history. Views subscribe to change events:
//   'walls'      wall geometry or per-wall finishes changed
//   'openings'   doors/windows added, removed or edited
//   'lights'     light fixtures added, removed or edited
//   'lighting'   time of day changed
//   'room'       ceiling height changed
//   'finish'     floor or default wall finish changed
//   'furniture'  furniture added, removed, renamed or moved
//   'selection'  selected wall, opening or furniture changed
//   'history'    what can be undone or redone changed
//
// A finish is { preset: id } or { image: dataUrl }. Openings are described in
// openings.js. Undo covers everything a person edits: the plan, finishes, lights,
// and furniture being added, removed, moved or renamed. A furniture model's own
// shape (the mesh editor) is not covered, and neither are changes that arrive from
// outside (the assistant): undoing goes back to a state as it was saved here.

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

const HISTORY_LIMIT = 100;
const COALESCE_MS = 700;

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
        this._removed = new Set(); // furniture taken out, kept while the history can bring it back
    }

    emit(type) {
        if (type !== 'selection' && type !== 'history') this.dirty = true;
        this.dispatchEvent(new Event(type));
    }

    on(types, handler) {
        for (const type of types.split(' ')) this.addEventListener(type, handler);
    }

    // ---- undo ----
    snapshot() {
        return {
            walls: cloneWalls(this.walls),
            openings: cloneOpenings(this.openings),
            lights: cloneLights(this.lights),
            ceilingHeight: this.ceilingHeight,
            floor: { ...this.floor },
            wall: { ...this.wall },
            timeOfDay: this.timeOfDay,
            // The item itself, not a copy: a removed one comes back with its model.
            furniture: this.furniture.map(item => ({
                item,
                name: item.name,
                position: item.object.position.toArray(),
                quaternion: item.object.quaternion.toArray(),
                tilt: item.tilt ? { ...item.tilt } : item.tilt,
            })),
        };
    }

    /**
     * Remember the state before a change. Repeated calls with the same `gesture`
     * in quick succession (a slider being dragged) count as one step.
     */
    checkpoint(gesture = null) {
        const now = Date.now();
        const continuing = gesture && this._gesture === gesture && now - this._gestureAt < COALESCE_MS;
        this._gesture = gesture;
        this._gestureAt = now;
        if (continuing) return;
        this._undo.push(this.snapshot());
        if (this._undo.length > HISTORY_LIMIT) this._undo.shift();
        this._redo = [];
        this._release();
        this.emit('history');
    }

    /** Hand back furniture the history can no longer reach, so its memory can be freed. */
    _release() {
        if (!this._removed.size) return;
        const reachable = new Set();
        for (const state of [...this._undo, ...this._redo]) for (const entry of state.furniture) reachable.add(entry.item);
        for (const item of this._removed) {
            if (this.furniture.includes(item)) this._removed.delete(item);
            else if (!reachable.has(item)) {
                this._removed.delete(item);
                this.onRemoved?.(item);
            }
        }
    }

    // ---- walls ----

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

    _restore(state) {
        this.walls = state.walls;
        this.openings = state.openings;
        this.lights = state.lights;
        this.ceilingHeight = state.ceilingHeight;
        this.floor = state.floor;
        this.wall = state.wall;
        const timeChanged = this.timeOfDay !== state.timeOfDay;
        this.timeOfDay = state.timeOfDay;
        for (const item of this.furniture) if (!state.furniture.some(entry => entry.item === item)) this._removed.add(item);
        this.furniture = state.furniture.map(entry => {
            const { item } = entry;
            this._removed.delete(item);
            item.name = entry.name;
            item.object.position.fromArray(entry.position);
            item.object.quaternion.fromArray(entry.quaternion);
            if (JSON.stringify(entry.tilt ?? null) !== JSON.stringify(item.tilt ?? null)) {
                item.tilt = entry.tilt;
                this.onTiltRestored?.(item);
            }
            return item;
        });
        if (!this.lights.some(l => l.id === this.selectedLightId)) this.selectedLightId = null;
        if (!this.walls.some(w => w.id === this.selectedWallId)) this.selectedWallId = null;
        if (!this.openings.some(o => o.id === this.selectedOpeningId)) this.selectedOpeningId = null;
        if (!this.furniture.some(f => f.id === this.selectedFurnitureId)) this.selectedFurnitureId = null;
        this.emit('room');
        this.emit('finish');
        this.emit('walls');
        this.emit('openings');
        this.emit('lights');
        if (timeChanged) this.emit('lighting');
        this.emit('furniture');
        this.emit('selection');
    }

    /** Call after mutating wall objects in place (e.g. while dragging). */
    touchWalls() {
        this.emit('walls');
    }

    resetHistory() {
        this._undo = [];
        this._redo = [];
        this._release();
        this.emit('history');
    }

    get canUndo() { return this._undo.length > 0; }
    get canRedo() { return this._redo.length > 0; }

    undo() {
        if (!this._undo.length) return;
        this._gesture = null;
        this._redo.push(this.snapshot());
        this._restore(this._undo.pop());
        this.emit('history');
    }

    redo() {
        if (!this._redo.length) return;
        this._gesture = null;
        this._undo.push(this.snapshot());
        this._restore(this._redo.pop());
        this.emit('history');
    }

    // ---- doors & windows ----
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

    // ---- lights ----
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

    setTimeOfDay(time, { record = true } = {}) {
        if (record && time !== this.timeOfDay) this.checkpoint();
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
    setCeilingHeight(cm, { record = true } = {}) {
        if (record && cm !== this.ceilingHeight) this.checkpoint('ceiling');
        this.ceilingHeight = cm;
        // Tall doors and windows must still fit under the new ceiling.
        const byId = new Map(this.walls.map(w => [w.id, w]));
        this.openings = this.openings.map(o => (byId.has(o.wallId) ? clampOpening(o, byId.get(o.wallId), cm) : o));
        this.emit('room');
        if (this.openings.length) this.emit('openings');
    }

    setFloor(patch) {
        this.checkpoint('floor');
        this.floor = { ...this.floor, ...patch };
        this.emit('finish');
    }

    setWallFinish(patch) {
        this.checkpoint('wall');
        this.wall = { ...this.wall, ...patch };
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
        // Lights that lived in this item go with it, and come back with it too.
        if (this.lights.some(l => l.attach?.furnitureId === id)) {
            this.lights = this.lights.filter(l => l.attach?.furnitureId !== id);
            if (!this.lights.some(l => l.id === this.selectedLightId)) this.selectedLightId = null;
            this.emit('lights');
        }
        this.emit('furniture');
        this._removed.add(item);
        this._release();
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
        this.checkpoint();
        this.setWalls([], { record: false });
        this.openings = [];
        this.selectedOpeningId = null;
        this.lights = [];
        this.selectedLightId = null;
        this.emit('openings');
        this.emit('lights');
        for (const item of [...this.furniture]) this.removeFurniture(item.id);
    }
}
