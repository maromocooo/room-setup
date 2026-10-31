import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, parseProject, VERSION } from '../src/project/format.js';

const walls = [
    { id: 'w1', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, finish: null },
    { id: 'w2', start: { x: 400, y: 0 }, end: { x: 400, y: 300 }, finish: { image: 'data:image/jpeg;base64,AAAA' } },
];

test('a saved project parses back to the same room', () => {
    const { manifest, images } = buildManifest({
        walls,
        ceilingHeight: 255,
        floor: { finish: { preset: 'oak' }, scale: 1.5 },
        wall: { finish: { image: 'data:image/png;base64,BBBB' }, scale: 1 },
        furniture: [{
            id: 'abc', name: 'Sofa', engine: 'trellis2', dimensions: { width: 180, depth: 85, height: 80 },
            position: { x: 1.234, y: 0, z: 2.5 }, rotationY: Math.PI / 2, hasThumbnail: true,
        }],
    });
    assert.equal(manifest.exportVersion, VERSION);
    assert.deepEqual([...images.keys()].sort(), ['textures/wall-2.jpg', 'textures/wall.png']);

    const project = parseProject(JSON.parse(JSON.stringify(manifest)));
    assert.equal(project.ceilingHeight, 255);
    assert.deepEqual(project.walls.map(w => [w.start, w.end]), walls.map(w => [w.start, w.end]));
    assert.deepEqual(project.walls[1].finish, { image: 'textures/wall-2.jpg' });
    assert.deepEqual(project.floor, { finish: { preset: 'oak' }, scale: 1.5 });
    const [item] = project.furniture;
    assert.equal(item.name, 'Sofa');
    assert.equal(item.layout, 'container');
    assert.equal(item.model, 'models/abc.glb');
    assert.ok(Math.abs(item.position.x - 1.234) < 0.001);
    assert.ok(Math.abs(item.rotationY - Math.PI / 2) < 0.001);
});

test('projects from the original Room Designer still open', () => {
    const legacy = {
        exportVersion: 2,
        walls: [{ start: { x: 100, y: 100 }, end: { x: 400, y: 100 } }, { start: { x: 'bad' }, end: {} }],
        ceilingHeight: 250,
        floorTextureSettings: { preset: { name: 'ブラックウォールナット', nameEn: 'blackWalnut' }, scale: 2 },
        wallTextureSettings: { preset: { name: '塗り壁調' }, scale: 1 },
        furniture: [{ id: 'old1', dimensions: { width: 50, height: 80, depth: 40 }, position: { x: 120, y: 0, z: 200 }, rotation: { y: 90 } }],
    };
    const project = parseProject(legacy);
    assert.equal(project.walls.length, 1, 'invalid walls are dropped');
    assert.deepEqual(project.floor, { finish: { preset: 'blackWalnut' }, scale: 2 });
    assert.deepEqual(project.wall.finish, { preset: 'plaster' });
    assert.equal(project.furniture[0].model, 'generated/model_old1.glb');
    assert.equal(project.furniture[0].layout, 'baked');
    assert.equal(project.furniture[0].position.z, 2);
});

test('garbage is rejected', () => {
    assert.throws(() => parseProject(null));
    assert.throws(() => parseProject({ walls: 'nope' }));
});

test('lights and time of day survive a save and load', () => {
    const { manifest } = buildManifest({
        walls, ceilingHeight: 240, floor: { finish: { preset: 'oak' }, scale: 1 }, wall: { finish: { preset: 'standard' }, scale: 1 },
        furniture: [], timeOfDay: 'night',
        lights: [{ id: 'l1', preset: 'pendant', x: 120, y: 80, drop: 70, lumens: 810, kelvin: 2700, on: true, shadows: false }],
    });
    const project = parseProject(JSON.parse(JSON.stringify(manifest)));
    assert.equal(project.timeOfDay, 'night');
    assert.deepEqual(project.lights, [{ preset: 'pendant', x: 120, y: 80, drop: 70, lumens: 810, kelvin: 2700, on: true, shadows: false }]);
});

test('lights inside furniture keep their attachment', () => {
    const { manifest } = buildManifest({
        walls, ceilingHeight: 240, floor: { finish: { preset: 'oak' }, scale: 1 }, wall: { finish: { preset: 'standard' }, scale: 1 },
        furniture: [], lights: [{ id: 'l2', preset: 'bulb', x: 0, y: 0, attach: { furnitureId: 'lamp1', dx: 3, dy: 130, dz: -4 }, lumens: 810, kelvin: 2700, on: true, shadows: false }],
    });
    assert.deepEqual(parseProject(JSON.parse(JSON.stringify(manifest))).lights[0].attach, { furnitureId: 'lamp1', dx: 3, dy: 130, dz: -4 });
});

test('board direction survives saving, and older projects stay horizontal', () => {
    const state = direction => ({
        walls: [], ceilingHeight: 240, floor: { finish: { preset: 'oak' }, scale: 1, ...(direction ? { direction } : {}) },
        wall: { finish: { preset: 'standard' }, scale: 1 }, furniture: [],
    });
    const saved = direction => JSON.parse(JSON.stringify(buildManifest(state(direction)).manifest));
    assert.equal(saved('vertical').floor.direction, 'vertical');
    assert.equal(parseProject(saved('vertical')).floor.direction, 'vertical');
    assert.equal(saved().floor.direction, undefined);
    assert.equal(parseProject(saved('horizontal')).floor.direction, undefined);
});
