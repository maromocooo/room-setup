// Three.js view of the room. Created lazily the first time the 3D view is
// shown; it keeps running in the background only while visible.
//
// Units: metres in the scene, centimetres in the store. Plan y → scene z.

import * as THREE from 'three';
import earcut from 'earcut';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FurnitureGizmo } from './furniture-gizmo.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getFloorPolygon } from '../core/floor-outline.js';
import { planBounds, wallLength } from '../core/geometry.js';
import { findPreset, materialCanvas } from '../core/textures.js';
import { buildWall } from './wall-builder.js';
import { Lighting } from './lighting.js';

const WALL_THICKNESS = 0.1;
const CUTAWAY_HEIGHT = 0.18;

export class RoomScene {
    /**
     * @param {HTMLElement} host
     * @param {import('../core/store.js').Store} store
     */
    constructor(host, store) {
        this.host = host;
        this.store = store;
        this.ready = false;
        this.visible = false;
        this.wallMode = 'ghost';
        this.brightness = 1;
        this.gizmoMode = 'translate';
        this.wallMeshes = [];
        this._textures = new Map();
        this._needsFraming = true;
        this.onSelect = null;
        this.onTransform = null;
    }

    init() {
        if (this.ready) return;
        this.ready = true;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.NeutralToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.host.appendChild(renderer.domElement);
        this.renderer = renderer;

        const scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.45;
        pmrem.dispose();
        this.scene = scene;

        this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
        this.camera.position.set(6, 5, 7);

        this.controls = new OrbitControls(this.camera, renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI * 0.495;
        this.controls.screenSpacePanning = true;

        this.hemi = new THREE.HemisphereLight(0xfdfbf7, 0xb9ada0, 0.7);
        scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xfff3e3, 2.4);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.02;
        scene.add(this.sun, this.sun.target);

        // Ground that only shows shadows, so the room sits on something.
        this.ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -0.002;
        this.ground.receiveShadow = true;
        scene.add(this.ground);

        this.roomGroup = new THREE.Group();
        this.furnitureGroup = new THREE.Group();
        scene.add(this.roomGroup, this.furnitureGroup);
        this.lighting = new Lighting(scene, { hemi: this.hemi, sun: this.sun });

        this.gizmo = new FurnitureGizmo({
            camera: this.camera, domElement: renderer.domElement, scene, orbit: this.controls,
            onChange: object => this.onTransform?.(object.userData.furnitureId),
        });
        // Arrows for moving the selected light (including lights in furniture).
        this.lightGizmo = new FurnitureGizmo({
            camera: this.camera, domElement: renderer.domElement, scene, orbit: this.controls, clampFloor: false,
            onDragStart: object => { this._lightDrag = { id: object.userData.lightId, base: object.position.clone() }; },
            onChange: object => this._lightDrag && this.onLightMove?.(this._lightDrag.id, object.position.clone().sub(this._lightDrag.base), false),
            onDragEnd: object => {
                const drag = this._lightDrag;
                this._lightDrag = null;
                if (drag) this.onLightMove?.(drag.id, object.position.clone().sub(drag.base), true);
            },
        });
        this.setGizmoMode(this.gizmoMode);

        this._bindPicking();
        new ResizeObserver(() => this.resize()).observe(this.host);
        this.applyTheme();
        this.setBrightness(this.brightness);
        this.rebuildRoom();
        this.syncFurniture();
        this.syncLights();
        this.resize();
    }

    // ---- lifecycle ----
    show() {
        this.init();
        this.visible = true;
        this.resize();
        if (this._needsFraming && this.store.walls.length) this.setCamera('orbit');
        this.renderer.setAnimationLoop(() => this.frame());
    }

    hide() {
        this.visible = false;
        this.renderer?.setAnimationLoop(null);
    }

    resize() {
        if (!this.ready) return;
        const { clientWidth: w, clientHeight: h } = this.host;
        if (!w || !h) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    frame() {
        this.controls.update();
        this.gizmo.update();
        this.lightGizmo.update();
        if (this.wallMode === 'ghost') this._updateCutaway();
        this.renderer.render(this.scene, this.camera);
    }

    applyTheme() {
        if (!this.ready) return;
        const style = getComputedStyle(document.documentElement);
        this.scene.background = new THREE.Color(this.lighting.background ?? (style.getPropertyValue('--room-bg').trim() || '#e8ebef'));
    }

    // ---- room geometry ----
    rebuildRoom() {
        if (!this.ready) return;
        for (const child of [...this.roomGroup.children]) {
            this.roomGroup.remove(child);
            child.traverse(o => {
                if (!o.isMesh) return;
                o.geometry.dispose();
                for (const m of [o.material].flat()) {
                    if (m.userData.shared) continue; // cached door/window materials are reused
                    m.map?.dispose();
                    m.dispose();
                }
            });
        }
        this.wallMeshes = [];
        const walls = this.store.walls;
        if (!walls.length) { this._needsFraming = true; return; }

        const polygon = getFloorPolygon(walls);
        const centroid = polygon
            ? polygon.reduce((c, p) => c.set(c.x + p.x / polygon.length, c.y + p.z / polygon.length), new THREE.Vector2())
            : new THREE.Vector2(planBounds(walls).cx / 100, planBounds(walls).cy / 100);
        const height = this.store.ceilingHeight / 100;
        if (polygon) this.roomGroup.add(this._floorMesh(polygon), this._ceilingMesh(polygon, height));
        for (const wall of walls) this._addWall(wall, height, centroid);
        this._fitShadows();
        this.applyWallMode();
        if (this._needsFraming && this.visible) this.setCamera('orbit');
    }

    _texture(finish, kind) {
        const key = finish.preset ? `${kind}:${finish.preset}` : finish.image;
        if (!key) return null;
        if (!this._textures.has(key)) {
            let texture;
            if (finish.preset) {
                const preset = findPreset(kind, finish.preset) ?? findPreset(kind, kind === 'floor' ? 'oak' : 'standard');
                texture = new THREE.CanvasTexture(materialCanvas(kind, preset));
            } else {
                texture = new THREE.TextureLoader().load(finish.image, () => this.rebuildRoom());
            }
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            this._textures.set(key, texture);
        }
        return this._textures.get(key);
    }

    _material(finish, kind, repeatX, repeatY, roughness) {
        const base = this._texture(finish, kind);
        const map = base?.clone(); // shares the image; only repeat differs
        if (map) map.repeat.set(repeatX, repeatY);
        return new THREE.MeshStandardMaterial({ map, roughness, color: map ? 0xffffff : 0xeeeeee });
    }

    _floorMesh(polygon) {
        const scale = this.store.floor.scale;
        const indices = earcut(polygon.flatMap(p => [p.x, p.z]));
        const positions = [];
        const uvs = [];
        for (const i of indices) {
            const p = polygon[i];
            positions.push(p.x, 0, p.z);
            uvs.push(p.x, -p.z); // one tile per metre; repeat applies the scale
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeVertexNormals();
        if (geometry.attributes.normal.getY(0) < 0) flipWinding(geometry);
        const material = this._material(this.store.floor.finish, 'floor', scale, scale, 0.75);
        const floor = new THREE.Mesh(geometry, material);
        floor.receiveShadow = true;
        floor.userData.kind = 'floor';
        return floor;
    }

    /** Ceiling facing down: seen from inside, invisible from above, still casts shadows. */
    _ceilingMesh(polygon, height) {
        const indices = earcut(polygon.flatMap(p => [p.x, p.z]));
        const positions = indices.flatMap(i => [polygon[i].x, height, polygon[i].z]);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
        geometry.computeVertexNormals();
        if (geometry.attributes.normal.getY(0) > 0) flipWinding(geometry);
        this._ceilingMaterial ??= Object.assign(new THREE.MeshStandardMaterial({ color: 0xf6f5f2, roughness: 0.95 }), { userData: { shared: true } });
        const ceiling = new THREE.Mesh(geometry, this._ceilingMaterial);
        ceiling.castShadow = ceiling.receiveShadow = true;
        ceiling.userData.kind = 'ceiling';
        return ceiling;
    }

    _addWall(wall, height, centroid) {
        const finish = wall.finish ?? this.store.wall.finish;
        const scale = this.store.wall.scale;
        // Wall UVs are in metres, so the texture repeats `scale` times per metre.
        const material = this._material(finish, 'wall', scale, scale, 0.9);
        const openings = this.store.openings.filter(o => o.wallId === wall.id);
        const group = buildWall(wall, openings, height, WALL_THICKNESS, material);
        const mid = new THREE.Vector2((wall.start.x + wall.end.x) / 200, (wall.start.y + wall.end.y) / 200);
        const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
        group.position.set(mid.x, 0, mid.y);
        group.rotation.y = -angle;

        // Outward normal (away from the room centre), used by the cutaway mode.
        let normal = new THREE.Vector2(-Math.sin(angle), Math.cos(angle));
        if (normal.dot(mid.clone().sub(centroid)) < 0) normal = normal.negate();
        Object.assign(group.userData, { kind: 'wall', wallId: wall.id, mid, normal, height });

        this.roomGroup.add(group);
        this.wallMeshes.push(group);
    }

    _fitShadows() {
        const bounds = planBounds(this.store.walls);
        const size = Math.max(bounds.width, bounds.height) / 100 + 2;
        const center = new THREE.Vector3(bounds.cx / 100, 0, bounds.cy / 100);
        const cam = this.sun.shadow.camera;
        cam.left = cam.bottom = -size;
        cam.right = cam.top = size;
        cam.near = 0.5;
        cam.far = size * 4;
        cam.updateProjectionMatrix();
        this._sunFrame = { center, size };
        this.lighting.setTimeOfDay(this.store.timeOfDay, center, size);
        this.applyTheme();
        this.ground.position.x = center.x;
        this.ground.position.z = center.z;
    }

    // ---- view options ----
    setWallMode(mode) {
        this.wallMode = mode;
        this.applyWallMode();
    }

    applyWallMode() {
        for (const mesh of this.wallMeshes) {
            mesh.visible = this.wallMode !== 'hidden';
            this._setWallCut(mesh, false);
        }
    }

    /** Lower a wall to a low stub (or restore it), like a dollhouse cutaway. */
    _setWallCut(wall, cut) {
        if (wall.userData.cut === cut) return;
        wall.userData.cut = cut;
        const height = wall.userData.height;
        wall.scale.y = cut ? Math.min(CUTAWAY_HEIGHT, height) / height : 1;
        wall.userData.fittings.visible = !cut;
    }

    _updateCutaway() {
        const cam = new THREE.Vector2(this.camera.position.x, this.camera.position.z);
        for (const mesh of this.wallMeshes) {
            const { mid, normal } = mesh.userData;
            this._setWallCut(mesh, normal.dot(cam.clone().sub(mid)) > 0.05);
        }
    }

    setBrightness(value) {
        this.brightness = value;
        if (!this.ready) return;
        this.renderer.toneMappingExposure = value;
    }

    setGizmoMode(mode) {
        this.gizmoMode = mode;
        this.gizmo?.setMode(mode);
    }

    /** Re-frame the camera on the room (now if visible, else on next show). */
    requestFraming() {
        this._needsFraming = true;
        if (this.visible) this.setCamera('orbit');
    }

    setCamera(preset) {
        if (!this.ready) return;
        const bounds = planBounds(this.store.walls) ?? { cx: 200, cy: 150, width: 400, height: 300 };
        const center = new THREE.Vector3(bounds.cx / 100, 0, bounds.cy / 100);
        const size = Math.max(bounds.width, bounds.height, 200) / 100;
        const ceiling = this.store.ceilingHeight / 100;
        const target = center.clone().setY(preset === 'inside' ? ceiling * 0.55 : ceiling * 0.3);
        if (preset === 'top') {
            this.camera.position.set(center.x, size * 1.9 + ceiling, center.z + 0.01);
        } else if (preset === 'inside') {
            const eye = Math.min(1.55, ceiling * 0.62);
            const offset = new THREE.Vector3(-bounds.width / 100 * 0.3, 0, bounds.height / 100 * 0.3);
            this.camera.position.copy(center).add(offset).setY(eye);
            target.copy(center).sub(offset).setY(eye * 0.9);
        } else {
            const fov = THREE.MathUtils.degToRad(this.camera.fov);
            const diagonal = Math.hypot(bounds.width, bounds.height) / 100;
            const distance = (Math.max(diagonal, ceiling * 1.5) / 2 / Math.tan(fov / 2)) * 1.2 / Math.min(1, this.camera.aspect);
            this.camera.position.copy(target).add(new THREE.Vector3(0.55, 0.78, 0.9).normalize().multiplyScalar(distance));
        }
        this.controls.target.copy(target);
        this.controls.update();
        this._needsFraming = false;
    }

    // ---- furniture ----
    syncFurniture() {
        if (!this.ready) return;
        // Compare objects, not ids: an item's object is swapped when its
        // placeholder is replaced by the generated model.
        const current = new Set(this.store.furniture.map(f => f.object));
        for (const child of [...this.furnitureGroup.children]) {
            if (!current.has(child)) this.furnitureGroup.remove(child);
        }
        for (const item of this.store.furniture) {
            if (item.object.parent !== this.furnitureGroup) this.furnitureGroup.add(item.object);
        }
        this.syncSelection();
    }

    syncLights() {
        if (!this.ready) return;
        this.lighting.sync(this.store.lights, this.store.ceilingHeight, this.store.selectedLightId,
            id => this.furniturePose(id), this._lightDrag?.id);
        const selected = this.store.selectedLightId && this.lighting.objectFor(this.store.selectedLightId);
        if (selected && this.lightGizmo.object !== selected) this.lightGizmo.attach(selected);
        else if (!selected && this.lightGizmo.object) this.lightGizmo.detach();
    }

    /** Plan position (cm), base height (cm) and yaw of a piece of furniture, or null. */
    furniturePose(id) {
        const item = this.store.getFurniture(id);
        if (!item) return null;
        const p = item.object.position;
        return { x: p.x * 100, z: p.z * 100, y: p.y * 100, yaw: item.object.rotation.y };
    }

    setTimeOfDay(time) {
        if (!this.ready) return;
        this.lighting.setTimeOfDay(time, this._sunFrame?.center, this._sunFrame?.size);
        this.applyTheme();
    }

    syncSelection() {
        if (!this.ready) return;
        // One set of handles at a time: a selected light wins over furniture.
        const item = !this.store.selectedLightId && this.store.getFurniture(this.store.selectedFurnitureId);
        if (item) this.gizmo.attach(item.object);
        else this.gizmo.detach();
    }

    _bindPicking() {
        const canvas = this.renderer.domElement;
        const raycaster = new THREE.Raycaster();
        let down = null;
        canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
        canvas.addEventListener('pointerup', e => {
            if (!down || e.button !== 0 || this.gizmo.dragging || this.lightGizmo.dragging) { down = null; return; }
            const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
            const quick = performance.now() - down.t < 400;
            down = null;
            if (moved > 5 || !quick) return;
            const rect = canvas.getBoundingClientRect();
            const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(ndc, this.camera);
            const hit = raycaster.intersectObjects([...this.furnitureGroup.children, ...this.lighting.group.children], true)[0];
            let object = hit?.object;
            while (object && object.parent !== this.furnitureGroup && object.parent !== this.lighting.group) object = object.parent;
            if (object?.userData.lightId) return this.onSelectLight?.(object.userData.lightId);
            this.onSelect?.(object?.userData.furnitureId ?? null);
        });
    }

    /** Plan-view rectangles for every furniture item (centimetres). */
    footprints() {
        return this.store.furniture.map(item => {
            const fp = footprint(item);
            const o = item.object;
            const cos = Math.cos(o.rotation.y);
            const sin = Math.sin(o.rotation.y);
            return {
                id: item.id,
                name: item.name,
                selected: item.id === this.store.selectedFurnitureId,
                rotation: o.rotation.y,
                width: fp.width * 100,
                depth: fp.depth * 100,
                x: (o.position.x + fp.offsetX * cos + fp.offsetZ * sin) * 100,
                z: (o.position.z - fp.offsetX * sin + fp.offsetZ * cos) * 100,
            };
        });
    }

    /** Move an item so its footprint centre lands on plan point (x, z) in cm. */
    moveFurnitureTo(item, x, z) {
        const fp = footprint(item);
        const o = item.object;
        const cos = Math.cos(o.rotation.y);
        const sin = Math.sin(o.rotation.y);
        o.position.x = x / 100 - (fp.offsetX * cos + fp.offsetZ * sin);
        o.position.z = z / 100 - (-fp.offsetX * sin + fp.offsetZ * cos);
    }

    /**
     * Render one frame from a given viewpoint to a PNG data URL without
     * disturbing the user's camera. view.mode: overview | top | inside | custom
     * (custom uses eye/target in plan centimetres, y = height, and fov).
     */
    snapshot(view = {}) {
        this.init();
        const width = Math.min(Math.max(view.width ?? 1280, 256), 2048);
        const height = Math.min(Math.max(view.height ?? 800, 256), 2048);
        const saved = {
            position: this.camera.position.clone(), target: this.controls.target.clone(),
            fov: this.camera.fov, aspect: this.camera.aspect, framing: this._needsFraming,
            size: this.renderer.getSize(new THREE.Vector2()),
        };
        this.camera.aspect = width / height;
        if (view.mode === 'custom' && view.eye && view.target) {
            this.camera.position.set(view.eye.x / 100, (view.eye.y ?? 150) / 100, view.eye.z / 100);
            this.controls.target.set(view.target.x / 100, (view.target.y ?? 100) / 100, view.target.z / 100);
            this.camera.fov = view.fov ?? 60;
        } else {
            this.setCamera({ overview: 'orbit', top: 'top', inside: 'inside' }[view.mode] ?? 'orbit');
        }
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(this.controls.target);
        this.gizmo.setVisible(false);
        this.lightGizmo.setVisible(false);
        this.renderer.setSize(width, height, false);
        if (this.wallMode === 'ghost') this._updateCutaway();
        this.renderer.render(this.scene, this.camera);
        const url = this.renderer.domElement.toDataURL('image/png');

        this.camera.position.copy(saved.position);
        this.controls.target.copy(saved.target);
        this.camera.fov = saved.fov;
        this.camera.aspect = saved.aspect;
        this.camera.updateProjectionMatrix();
        this._needsFraming = saved.framing;
        this.renderer.setSize(saved.size.x, saved.size.y, false);
        this.gizmo.setVisible(true);
        this.lightGizmo.setVisible(true);
        this.resize();
        return url;
    }

    roomCenter() {
        const bounds = planBounds(this.store.walls);
        return bounds ? { x: bounds.cx / 100, z: bounds.cy / 100 } : { x: 2, z: 1.5 };
    }
}

/**
 * Size of an item with its rotation removed, plus the offset from its origin
 * to the centre of that box (metres). Cached on the item; delete
 * item.footprint after changing the geometry or scale.
 */
export function footprint(item) {
    if (item.footprint) return item.footprint;
    const o = item.object;
    const saved = { position: o.position.clone(), rotation: o.rotation.y };
    o.position.set(0, 0, 0);
    o.rotation.y = 0;
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    o.position.copy(saved.position);
    o.rotation.y = saved.rotation;
    o.updateMatrixWorld(true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    item.footprint = { width: size.x, depth: size.z, height: size.y, offsetX: center.x, offsetZ: center.z, bottom: box.min.y };
    return item.footprint;
}

function flipWinding(geometry) {
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i += 3) {
        for (const attr of [pos, uv]) {
            const size = attr.itemSize;
            for (let k = 0; k < size; k++) {
                const a = attr.array[(i + 1) * size + k];
                attr.array[(i + 1) * size + k] = attr.array[(i + 2) * size + k];
                attr.array[(i + 2) * size + k] = a;
            }
        }
    }
    geometry.computeVertexNormals();
}
