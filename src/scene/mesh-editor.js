// "Adjust shape" dialog: overall X/Y/Z proportions plus local deformation of
// vertices picked on the mesh. Works on a copy; Apply swaps the edited
// geometry into the real item.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cloneFurnitureObject } from './furniture.js';
import { t } from '../core/i18n.js';

const HIGHLIGHT = new THREE.Color(1, 0.45, 0.12);
const AXES = ['X', 'Y', 'Z'];

export class MeshEditor {
    constructor(dialog, { onApply }) {
        this.dialog = dialog;
        this.view = dialog.querySelector('#meshEditorView');
        this.onApply = onApply;
        this.$ = id => dialog.querySelector(`#${id}`);

        this.renderer = null;
        this.overall = { x: 1, y: 1, z: 1 };
        this.partial = { scale: { x: 1, y: 1, z: 1 }, offset: { x: 0, y: 0, z: 0 } };

        for (const axis of AXES) {
            this._slider(`editScale${axis}`, v => { this.overall[axis.toLowerCase()] = v; this._applyOverall(); });
            this._slider(`editPartial${axis}`, v => { this.partial.scale[axis.toLowerCase()] = v; this._applyPartial(); });
            this._slider(`editOffset${axis}`, v => { this.partial.offset[axis.toLowerCase()] = v; this._applyPartial(); });
        }
        this._slider('editRadius', () => {});
        this.$('editScaleReset').addEventListener('click', () => {
            this.overall = { x: 1, y: 1, z: 1 };
            for (const axis of AXES) this._setSlider(`editScale${axis}`, 1);
            this._applyOverall();
        });
        this.$('editDeselect').addEventListener('click', () => this._clearSelection());
        this.$('editCancel').addEventListener('click', () => this.close());
        this.$('editApply').addEventListener('click', () => this.apply());
        dialog.addEventListener('cancel', e => { e.preventDefault(); this.close(); });
    }

    _slider(id, onChange) {
        const input = this.$(id);
        input.addEventListener('input', () => {
            const value = parseFloat(input.value);
            input.nextElementSibling.textContent = value.toFixed(2);
            onChange(value);
        });
    }

    _setSlider(id, value) {
        const input = this.$(id);
        input.value = value;
        input.nextElementSibling.textContent = Number(value).toFixed(2);
    }

    open(item) {
        this.item = item;
        this.copy = cloneFurnitureObject(item.object);
        this.copy.position.set(0, 0, 0);
        this.copy.rotation.set(0, 0, 0);
        this.baseScale = this.copy.scale.clone();
        this.overall = { x: 1, y: 1, z: 1 };
        this.selection = null;
        for (const axis of AXES) this._setSlider(`editScale${axis}`, 1);
        this.$('editSelection').hidden = true;

        this.dialog.showModal();
        this._setupScene();
        this.renderer.setAnimationLoop(() => {
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        });
    }

    _setupScene() {
        const { clientWidth: w, clientHeight: h } = this.view;
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.view.replaceChildren(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--editor-bg').trim() || '#202226');
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(3, 5, 4);
        this.scene.add(sun);
        this.scene.add(new THREE.GridHelper(4, 40, 0x666666, 0x3a3a3a));
        this.scene.add(this.copy);

        const box = new THREE.Box3().setFromObject(this.copy);
        const center = box.getCenter(new THREE.Vector3());
        const size = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0.3);
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
        this.camera.position.copy(center).add(new THREE.Vector3(size * 1.3, size * 0.9, size * 1.6));
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.copy(center);
        this.controls.enableDamping = true;

        const raycaster = new THREE.Raycaster();
        let down = null;
        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
        canvas.addEventListener('pointerup', e => {
            if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
            const rect = canvas.getBoundingClientRect();
            raycaster.setFromCamera(new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1,
            ), this.camera);
            const hit = raycaster.intersectObject(this.copy, true)[0];
            if (hit) this._pick(hit, e.shiftKey);
        });
    }

    _applyOverall() {
        this.copy.scale.set(this.baseScale.x * this.overall.x, this.baseScale.y * this.overall.y, this.baseScale.z * this.overall.z);
    }

    _pick(hit, additive) {
        const mesh = hit.object;
        const local = mesh.worldToLocal(hit.point.clone());
        const worldScale = mesh.getWorldScale(new THREE.Vector3());
        const radius = parseFloat(this.$('editRadius').value) / ((worldScale.x + worldScale.y + worldScale.z) / 3);
        const position = mesh.geometry.attributes.position;
        const v = new THREE.Vector3();
        const picked = [];
        for (let i = 0; i < position.count; i++) {
            if (v.fromBufferAttribute(position, i).distanceTo(local) <= radius) picked.push(i);
        }
        if (!picked.length) return;

        this._bake();
        const indices = additive && this.selection?.mesh === mesh ? [...new Set([...this.selection.indices, ...picked])] : picked;
        if (this.selection && this.selection.mesh !== mesh) this._restoreColors();
        this._select(mesh, indices);
    }

    _select(mesh, indices) {
        const position = mesh.geometry.attributes.position;
        const center = new THREE.Vector3();
        const v = new THREE.Vector3();
        const originals = indices.map(i => { v.fromBufferAttribute(position, i); center.add(v); return v.clone(); });
        center.divideScalar(indices.length);
        this.selection = { mesh, indices, center, originals };
        this.partial = { scale: { x: 1, y: 1, z: 1 }, offset: { x: 0, y: 0, z: 0 } };
        for (const axis of AXES) { this._setSlider(`editPartial${axis}`, 1); this._setSlider(`editOffset${axis}`, 0); }
        this._highlight(mesh, indices);
        this.$('editSelection').hidden = false;
        this.$('editVertexCount').textContent = t('edit.vertexCount', { count: indices.length });
    }

    _highlight(mesh, indices) {
        const geometry = mesh.geometry;
        if (!this.colorBackup || this.colorBackup.mesh !== mesh) {
            const had = Boolean(geometry.attributes.color);
            if (!had) {
                const colors = new Float32Array(geometry.attributes.position.count * 3).fill(1);
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                for (const m of [mesh.material].flat()) { m.vertexColors = true; m.needsUpdate = true; }
            }
            this.colorBackup = { mesh, had, original: geometry.attributes.color.array.slice() };
        }
        const color = geometry.attributes.color;
        color.array.set(this.colorBackup.original);
        for (const i of indices) color.setXYZ(i, HIGHLIGHT.r, HIGHLIGHT.g, HIGHLIGHT.b);
        color.needsUpdate = true;
    }

    _restoreColors() {
        const backup = this.colorBackup;
        if (!backup) return;
        const geometry = backup.mesh.geometry;
        if (backup.had) {
            geometry.attributes.color.array.set(backup.original);
            geometry.attributes.color.needsUpdate = true;
        } else {
            geometry.deleteAttribute('color');
            for (const m of [backup.mesh.material].flat()) { m.vertexColors = false; m.needsUpdate = true; }
        }
        this.colorBackup = null;
    }

    _applyPartial() {
        const sel = this.selection;
        if (!sel) return;
        const { scale, offset } = this.partial;
        const position = sel.mesh.geometry.attributes.position;
        sel.indices.forEach((index, i) => {
            const o = sel.originals[i];
            position.setXYZ(index,
                sel.center.x + (o.x - sel.center.x) * scale.x + offset.x,
                sel.center.y + (o.y - sel.center.y) * scale.y + offset.y,
                sel.center.z + (o.z - sel.center.z) * scale.z + offset.z);
        });
        position.needsUpdate = true;
        sel.mesh.geometry.computeBoundingBox();
        sel.mesh.geometry.computeBoundingSphere();
    }

    /** Make the current partial transform the new baseline for the selection. */
    _bake() {
        const sel = this.selection;
        if (!sel) return;
        this._applyPartial();
        const position = sel.mesh.geometry.attributes.position;
        sel.originals = sel.indices.map(i => new THREE.Vector3().fromBufferAttribute(position, i));
        this.partial = { scale: { x: 1, y: 1, z: 1 }, offset: { x: 0, y: 0, z: 0 } };
    }

    _clearSelection() {
        this._bake();
        this._restoreColors();
        this.selection = null;
        this.$('editSelection').hidden = true;
    }

    apply() {
        this._bake();
        this._restoreColors();
        const target = this.item.object;
        target.scale.copy(this.copy.scale);
        // Swap the edited (already private) geometry into the real meshes.
        const edited = [];
        this.copy.traverse(c => { if (c.isMesh) edited.push(c); });
        const originals = [];
        target.traverse(c => { if (c.isMesh) originals.push(c); });
        originals.forEach((mesh, i) => {
            const source = edited[i];
            if (!source || source.geometry.attributes.position.count !== mesh.geometry.attributes.position.count) return;
            mesh.geometry.dispose();
            mesh.geometry = source.geometry;
            source.geometry = new THREE.BufferGeometry(); // keep close() from disposing it
        });
        // Keep the item standing on the floor.
        const savedY = target.position.y;
        target.position.y = 0;
        target.updateMatrixWorld(true);
        const bottom = new THREE.Box3().setFromObject(target).min.y;
        target.position.y = Math.max(0, savedY) - bottom;
        delete this.item.footprint;
        const item = this.item;
        this.close();
        this.onApply?.(item);
    }

    close() {
        this._restoreColors();
        this.renderer?.setAnimationLoop(null);
        this.controls?.dispose();
        this.renderer?.dispose();
        this.renderer?.forceContextLoss(); // dispose() alone keeps the WebGL context
        this.renderer = null;
        this.view.replaceChildren();
        this.copy = null;
        this.item = null;
        this.selection = null;
        if (this.dialog.open) this.dialog.close();
    }
}
