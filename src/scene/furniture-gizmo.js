// Manipulators for the selected piece of furniture.
//
// Move: three.js TransformControls on a proxy placed at the item's centre,
// so the X/Y/Z arrows sit in the middle of the item instead of half under
// the floor; the item follows the proxy and never goes below the floor.
// Rotate: a full ring on the floor around the item with a knob showing which
// way its front faces, and a standing ring through the item for turning it
// vertically. Drag a ring to turn (5° steps, Shift: 15°).

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const RING_COLOR = 0x4f5bd5;
const RING_HOVER = 0x7d87f0;
const PITCH_COLOR = 0xe2725b;
const PITCH_HOVER = 0xf09a87;

export class FurnitureGizmo {
    /**
     * onDragStart/onDragEnd: called around a move. clampFloor: keep the
     * object's origin at or above y = 0 (furniture); false for lights.
     */
    constructor({ camera, domElement, scene, orbit, onChange, onDragStart, onDragEnd, onPitch, clampFloor = true }) {
        this.camera = camera;
        this.dom = domElement;
        this.orbit = orbit;
        this.onChange = onChange;
        this.onDragStart = onDragStart;
        this.onDragEnd = onDragEnd;
        this.onPitch = onPitch;
        this.clampFloor = clampFloor;
        this.object = null;
        this.mode = 'translate';
        this.dragging = false;

        // ---- move ----
        this.proxy = new THREE.Object3D();
        scene.add(this.proxy);
        this.transform = new TransformControls(camera, domElement);
        this.transform.setSize(0.75);
        this.transform.addEventListener('dragging-changed', e => {
            this.dragging = e.value;
            orbit.enabled = !e.value;
            if (e.value) {
                this._moveStart = { object: this.object.position.clone(), proxy: this.proxy.position.clone() };
                this.onDragStart?.(this.object);
            } else {
                this.onDragEnd?.(this.object);
            }
        });
        this.transform.addEventListener('objectChange', () => {
            if (!this.object || !this._moveStart) return;
            this.object.position.copy(this._moveStart.object).add(this.proxy.position).sub(this._moveStart.proxy);
            if (this.clampFloor && this.object.position.y < 0) {
                this.object.position.y = 0;
                this.proxy.position.y = this._moveStart.proxy.y - this._moveStart.object.y;
            }
            this.onChange(this.object);
        });
        scene.add(this.transform.getHelper());

        // ---- rotate ----
        this.ring = new THREE.Group();
        this.ring.visible = false;
        this.ringMaterial = new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
        this.ringMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.ringMaterial);
        this.ringPick = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
        this.knob = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 24), this.ringMaterial);
        this.knob.rotation.x = Math.PI / 2; // points along +z (the item's front)
        this.knobPivot = new THREE.Group();
        this.knobPivot.add(this.knob);
        for (const m of [this.ringMesh, this.knob]) m.renderOrder = 10;
        this.ring.add(this.ringMesh, this.ringPick, this.knobPivot);
        scene.add(this.ring);

        // A ring standing across the item, with its axis along the item's left-right.
        this.pitchRing = new THREE.Group();
        this.pitchRing.visible = false;
        this.pitchMaterial = new THREE.MeshBasicMaterial({ color: PITCH_COLOR, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
        this.pitchMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.pitchMaterial);
        this.pitchMesh.renderOrder = 10;
        this.pitchPick = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
        this.pitchRing.add(this.pitchMesh, this.pitchPick);
        scene.add(this.pitchRing);

        this._raycaster = new THREE.Raycaster();
        this._floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        domElement.addEventListener('pointerdown', e => this._onPointerDown(e), { capture: true });
        domElement.addEventListener('pointermove', e => this._onPointerMove(e));
        domElement.addEventListener('pointerup', e => this._onPointerUp(e));
        this.setMode(this.mode);
    }

    attach(object) {
        this.object = object;
        this._radius = null;
        this.update();
        this.setMode(this.mode);
    }

    detach() {
        this.object = null;
        this.transform.detach();
        this.ring.visible = false;
        this.pitchRing.visible = false;
    }

    setMode(mode) {
        this.mode = mode;
        if (this.object && mode === 'translate') this.transform.attach(this.proxy);
        else this.transform.detach();
        this.ring.visible = Boolean(this.object) && mode === 'rotate';
        this.pitchRing.visible = this.ring.visible && Boolean(this.onPitch);
    }

    /** Hide or show everything (for screenshots). */
    setVisible(visible) {
        this.transform.getHelper().visible = visible;
        this.ring.visible = visible && Boolean(this.object) && this.mode === 'rotate';
        this.pitchRing.visible = this.ring.visible && Boolean(this.onPitch);
    }

    /** Keep the handles on the item; call every frame. */
    update() {
        if (!this.object) return;
        const box = new THREE.Box3().setFromObject(this.object);
        if (box.isEmpty()) return;
        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        if (!this.dragging) this.proxy.position.copy(centre);

        this.ring.position.set(this.object.position.x, 0.01, this.object.position.z);
        // Size the ring from the item's footprint (only when it changes noticeably).
        const radius = Math.max(Math.hypot(size.x, size.z) / 2 + 0.12, 0.3);
        if (!this._radius || Math.abs(radius - this._radius) > 0.02) {
            this._radius = radius;
            this.ringMesh.geometry.dispose();
            this.ringMesh.geometry = new THREE.RingGeometry(radius, radius + 0.035, 96).rotateX(-Math.PI / 2);
            this.ringPick.geometry.dispose();
            this.ringPick.geometry = new THREE.RingGeometry(radius - 0.12, radius + 0.15, 48).rotateX(-Math.PI / 2);
            this.knob.position.set(0, 0, radius + 0.1);
        }
        this.knobPivot.rotation.y = this.object.rotation.y;

        // Held still during a drag: the angle is measured around where it started.
        if (this._pitchStart) return;
        this.pitchRing.position.copy(centre);
        this.pitchRing.rotation.y = this.object.rotation.y;
        const pitchRadius = Math.max(Math.max(size.x, size.y, size.z) / 2 + 0.1, 0.25);
        if (!this._pitchRadius || Math.abs(pitchRadius - this._pitchRadius) > 0.02) {
            this._pitchRadius = pitchRadius;
            this.pitchMesh.geometry.dispose();
            this.pitchMesh.geometry = new THREE.RingGeometry(pitchRadius, pitchRadius + 0.03, 96).rotateY(Math.PI / 2);
            this.pitchPick.geometry.dispose();
            this.pitchPick.geometry = new THREE.RingGeometry(pitchRadius - 0.1, pitchRadius + 0.13, 48).rotateY(Math.PI / 2);
        }
    }

    /** Angle of the pointer around the standing ring; the item's up towards its front is positive. */
    _pitchAngle(e) {
        const yaw = this.object.rotation.y;
        const axis = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.pitchRing.position);
        this._raycaster.setFromCamera(this._ndc(e), this.camera);
        const point = this._raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        if (!point) return null;
        point.sub(this.pitchRing.position);
        const front = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        return Math.atan2(point.dot(front), point.y);
    }

    _hitsPitchRing(e) {
        if (!this.pitchRing.visible) return false;
        this._raycaster.setFromCamera(this._ndc(e), this.camera);
        return this._raycaster.intersectObject(this.pitchPick, false).length > 0;
    }

    // ---- ring dragging ----
    _ndc(e) {
        const rect = this.dom.getBoundingClientRect();
        return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    }

    _hitsRing(e) {
        if (!this.ring.visible) return false;
        this._raycaster.setFromCamera(this._ndc(e), this.camera);
        return this._raycaster.intersectObjects([this.ringPick, this.knob], false).length > 0;
    }

    _floorAngle(e) {
        this._raycaster.setFromCamera(this._ndc(e), this.camera);
        const point = this._raycaster.ray.intersectPlane(this._floor, new THREE.Vector3());
        if (!point) return null;
        // Front faces +z at rotation 0, so the facing angle is atan2(dx, dz).
        return Math.atan2(point.x - this.ring.position.x, point.z - this.ring.position.z);
    }

    _onPointerDown(e) {
        if (e.button === 0 && this._hitsPitchRing(e)) {
            const angle = this._pitchAngle(e);
            if (angle === null) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            this.dom.setPointerCapture(e.pointerId);
            this.dragging = true;
            this.orbit.enabled = false;
            this._pitchStart = { angle, rotation: this.object.rotation.x };
            this.onDragStart?.(this.object);
            return;
        }
        if (e.button !== 0 || !this._hitsRing(e)) return;
        const angle = this._floorAngle(e);
        if (angle === null) return;
        // Keep OrbitControls (and click-to-select) from seeing this press.
        e.stopImmediatePropagation();
        e.preventDefault();
        this.dom.setPointerCapture(e.pointerId);
        this.dragging = true;
        this.orbit.enabled = false;
        this._rotateStart = { angle, rotation: this.object.rotation.y };
        this.onDragStart?.(this.object);
    }

    _onPointerMove(e) {
        if (this._pitchStart) {
            const angle = this._pitchAngle(e);
            if (angle === null) return;
            const step = THREE.MathUtils.degToRad(e.shiftKey ? 15 : 5);
            const raw = THREE.MathUtils.euclideanModulo(this._pitchStart.rotation + angle - this._pitchStart.angle + Math.PI, Math.PI * 2) - Math.PI;
            this.onPitch(this.object, Math.round(raw / step) * step);
            return;
        }
        if (this._rotateStart) {
            const angle = this._floorAngle(e);
            if (angle === null) return;
            const step = THREE.MathUtils.degToRad(e.shiftKey ? 15 : 5);
            const raw = this._rotateStart.rotation + angle - this._rotateStart.angle;
            this.object.rotation.y = Math.round(raw / step) * step;
            this.update();
            this.onChange(this.object);
            return;
        }
        if (!this.ring.visible) return;
        const overPitch = this._hitsPitchRing(e);
        const hover = !overPitch && this._hitsRing(e);
        this.ringMaterial.color.setHex(hover ? RING_HOVER : RING_COLOR);
        this.pitchMaterial.color.setHex(overPitch ? PITCH_HOVER : PITCH_COLOR);
        this.dom.style.cursor = hover || overPitch ? 'grab' : '';
    }

    _onPointerUp(e) {
        if (!this._rotateStart && !this._pitchStart) return;
        this._rotateStart = null;
        this._pitchStart = null;
        if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
        this.orbit.enabled = true;
        // Let the click handler that runs after this ignore the release.
        setTimeout(() => { this.dragging = false; });
    }
}
