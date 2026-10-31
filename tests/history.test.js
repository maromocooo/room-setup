import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, makeWall } from '../src/core/store.js';

const vector = values => ({
    values,
    toArray() { return [...this.values]; },
    fromArray(next) { this.values = [...next]; },
});
const furniture = (id, x = 0) => ({ id, name: id, object: { position: vector([x, 0, 0]), quaternion: vector([0, 0, 0, 1]) } });
const room = store => store.setWalls([makeWall({ x: 0, y: 0 }, { x: 300, y: 0 })], { record: false });

test('a deleted item comes back as it was, and redo takes it away again', () => {
    const store = new Store();
    const chair = furniture('chair', 2);
    store.addFurniture(chair);
    store.selectFurniture('chair');
    store.checkpoint();
    store.removeFurniture('chair');
    assert.equal(store.furniture.length, 0);
    assert.equal(store.selectedFurnitureId, null);
    store.undo();
    assert.equal(store.furniture[0], chair, 'the same item, model and all');
    store.redo();
    assert.equal(store.furniture.length, 0);
    store.undo();
    assert.equal(store.furniture[0], chair);
});

test('moving, turning and renaming are undone', () => {
    const store = new Store();
    const chair = furniture('chair', 1);
    store.addFurniture(chair);
    store.checkpoint();
    chair.object.position.values = [5, 0, 5];
    chair.object.quaternion.values = [0, 1, 0, 0];
    chair.name = 'renamed';
    store.undo();
    assert.deepEqual(chair.object.position.values, [1, 0, 0]);
    assert.deepEqual(chair.object.quaternion.values, [0, 0, 0, 1]);
    assert.equal(chair.name, 'chair');
    store.redo();
    assert.deepEqual(chair.object.position.values, [5, 0, 5]);
    assert.equal(chair.name, 'renamed');
});

test('finishes, ceiling height and time of day are undone', () => {
    const store = new Store();
    const floor = store.floor;
    store.setFloor({ finish: { preset: 'walnut' } });
    store.setCeilingHeight(260);
    store.setTimeOfDay('night');
    store.setWallFinish({ scale: 3 });
    assert.notEqual(store.floor, floor);
    store.undo();
    assert.equal(store.wall.scale, 1);
    store.undo();
    assert.equal(store.timeOfDay, 'day');
    store.undo();
    assert.equal(store.ceilingHeight, 240);
    store.undo();
    assert.deepEqual(store.floor.finish, { preset: 'oak' });
    assert.equal(store.canUndo, false);
    store.redo();
    assert.deepEqual(store.floor.finish, { preset: 'walnut' });
});

test('dragging a slider is one step, separate gestures are not merged', () => {
    const store = new Store();
    for (const height of [241, 242, 243, 244]) store.setCeilingHeight(height);
    assert.equal(store._undo.length, 1);
    store.undo();
    assert.equal(store.ceilingHeight, 240);
    store.setCeilingHeight(250);
    store.setFloor({ scale: 2 });
    store.setCeilingHeight(255);
    assert.equal(store._undo.length, 3, 'something else in between starts a new step');
});

test('undoing right after a slider starts a new step next time', () => {
    const store = new Store();
    store.setCeilingHeight(250);
    store.undo();
    store.setCeilingHeight(260);
    assert.equal(store._undo.length, 1);
    store.undo();
    assert.equal(store.ceilingHeight, 240);
});

test('clearing the room is one step that brings everything back', () => {
    const store = new Store();
    room(store);
    store.addFurniture(furniture('chair'));
    store.lights = [{ id: 'l1' }];
    store.clear();
    assert.deepEqual([store.walls.length, store.furniture.length, store.lights.length], [0, 0, 0]);
    store.undo();
    assert.deepEqual([store.walls.length, store.furniture.length, store.lights.length], [1, 1, 1]);
    assert.equal(store.canUndo, false);
});

test('a light inside furniture leaves and returns with it', () => {
    const store = new Store();
    store.addFurniture(furniture('lamp'));
    store.lights = [{ id: 'l1', attach: { furnitureId: 'lamp' } }, { id: 'l2' }];
    store.checkpoint();
    store.removeFurniture('lamp');
    assert.deepEqual(store.lights.map(l => l.id), ['l2']);
    store.undo();
    assert.deepEqual(store.lights.map(l => l.id), ['l1', 'l2']);
});

test('memory is released only when the history can no longer bring an item back', () => {
    const store = new Store();
    const released = [];
    store.onRemoved = item => released.push(item.id);
    store.addFurniture(furniture('kept'));
    store.addFurniture(furniture('remote'));
    store.removeFurniture('remote'); // never in the history: nothing can bring it back
    assert.deepEqual(released, ['remote']);
    store.checkpoint();
    store.removeFurniture('kept');
    assert.deepEqual(released, ['remote'], 'undo can still restore it');
    store.resetHistory();
    assert.deepEqual(released, ['remote', 'kept']);
});

test('redo is dropped by a new change, and items only it could restore are released', () => {
    const store = new Store();
    const released = [];
    store.onRemoved = item => released.push(item.id);
    store.checkpoint();                 // before adding
    store.addFurniture(furniture('chair'));
    store.undo();                       // chair now only reachable through redo
    assert.equal(store.furniture.length, 0);
    assert.deepEqual(released, []);
    store.setFloor({ scale: 2 });       // a new change drops redo
    assert.equal(store.canRedo, false);
    assert.deepEqual(released, ['chair']);
});

test('the history event fires, and marks nothing as edited', () => {
    const store = new Store();
    let fired = 0;
    store.on('history', () => { fired += 1; });
    store.dirty = false;
    store.checkpoint();
    assert.equal(fired, 1);
    assert.equal(store.dirty, false);
});

test('tilt is restored through its hook', () => {
    const store = new Store();
    const restored = [];
    store.onTiltRestored = item => restored.push(item.tilt);
    const chair = furniture('chair');
    store.addFurniture(chair);
    store.checkpoint();
    chair.tilt = { x: 180, y: 0, z: 0 };
    store.undo();
    assert.deepEqual(restored, [undefined]);
    store.redo();
    assert.deepEqual(restored, [undefined, { x: 180, y: 0, z: 0 }]);
});

test('turning a model is undone with its size, which the turn may have swapped', () => {
    const store = new Store();
    const seen = [];
    store.onTiltRestored = item => seen.push({ tilt: item.tilt, height: item.dimensions.height });
    const lamp = { ...furniture('lamp'), dimensions: { width: 30, depth: 30, height: 155 } };
    store.addFurniture(lamp);
    store.checkpoint();
    lamp.tilt = { x: 90, y: 0, z: 0 };
    lamp.dimensions = { width: 30, depth: 155, height: 30 };
    store.undo();
    assert.deepEqual(lamp.dimensions, { width: 30, depth: 30, height: 155 });
    assert.deepEqual(seen, [{ tilt: undefined, height: 155 }], 'refitted to the size it has now');
    store.redo();
    assert.deepEqual(lamp.dimensions, { width: 30, depth: 155, height: 30 });
    assert.deepEqual(lamp.tilt, { x: 90, y: 0, z: 0 });
});
