// First-person walking: WASD / arrow keys to move, the mouse to look around.
//
// Clicking the view captures the mouse (Pointer Lock) so it turns your head
// like a game; Esc releases it. Dragging also looks around (the view follows
// the hand, as in the orbit camera), for browsers that refuse the lock. Movement is resolved in plan centimetres by core/walk.js,
// so walls and tall furniture stop you and doors let you through.
//
// Input only produces a heading and a move; a WebXR session could later
// drive the same camera with a headset and thumbsticks.

import * as THREE from 'three';
import { walkStep } from '../core/walk.js';

const WALK_SPEED = 1.4;   // m/s
const RUN_SPEED = 3;      // m/s with Shift
const LOOK_SPEED = 0.0022; // radians per pixel
const MAX_PITCH = THREE.MathUtils.degToRad(85);

const KEYS = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
};

export class WalkControls {
    /**
     * obstacles(): blocking segments from core/walk.js (plan cm), read every frame.
     * onLockChange(locked): the mouse was captured or released.
     */
    constructor({ camera, domElement, obstacles, onLockChange }) {
        this.camera = camera;
        this.dom = domElement;
        this.obstacles = obstacles;
        this.onLockChange = onLockChange;
        this.enabled = false;
        this.locked = false;
        this.yaw = 0;
        this.pitch = 0;
        this.eye = 1.55;
        this._held = new Set();
        this._run = false;
        this._drag = null;

        this._onKey = e => this._key(e);
        window.addEventListener('keydown', this._onKey);
        window.addEventListener('keyup', this._onKey);
        window.addEventListener('blur', () => this._held.clear());
        document.addEventListener('pointerlockchange', () => {
            this.locked = document.pointerLockElement === this.dom;
            this.onLockChange?.(this.locked);
        });
        document.addEventListener('mousemove', e => {
            if (this.enabled && this.locked) this._look(e.movementX, e.movementY);
        });
        domElement.addEventListener('pointerdown', e => {
            if (!this.enabled || this.locked || e.button !== 0) return;
            this._drag = { x: e.clientX, y: e.clientY, moved: 0 };
        });
        domElement.addEventListener('pointermove', e => {
            if (!this._drag) return;
            const dx = e.clientX - this._drag.x;
            const dy = e.clientY - this._drag.y;
            this._drag = { x: e.clientX, y: e.clientY, moved: this._drag.moved + Math.abs(dx) + Math.abs(dy) };
            // Dragging grabs the view (like the orbit camera); a captured mouse turns your head.
            this._look(-dx, -dy);
        });
        domElement.addEventListener('pointerup', () => {
            // A plain click captures the mouse; a drag was just looking around.
            if (this._drag && this._drag.moved < 5) this.lock();
            this._drag = null;
        });
    }

    /** Start walking at `position` (scene metres, y ignored) facing `yaw`. */
    enable(position, yaw, eye) {
        this.enabled = true;
        this.eye = eye;
        this.yaw = yaw;
        this.pitch = 0;
        this.camera.position.set(position.x, eye, position.z);
        this._apply();
    }

    disable() {
        this.enabled = false;
        this._held.clear();
        this._drag = null;
        this.unlock();
    }

    lock() {
        if (!this.enabled || this.locked) return;
        // Some browsers return a promise that rejects (e.g. right after Esc); ignore it.
        this.dom.requestPointerLock?.()?.catch?.(() => {});
    }

    unlock() {
        if (document.pointerLockElement === this.dom) document.exitPointerLock();
    }

    /** Advance by `dt` seconds; call every frame. */
    update(dt) {
        if (!this.enabled) return;
        const forward = (this._held.has('forward') ? 1 : 0) - (this._held.has('back') ? 1 : 0);
        const strafe = (this._held.has('right') ? 1 : 0) - (this._held.has('left') ? 1 : 0);
        if (!forward && !strafe) return;
        const length = Math.hypot(forward, strafe);
        const distance = (this._run ? RUN_SPEED : WALK_SPEED) * Math.min(dt, 0.1) * 100; // cm
        // Camera looks along −z at yaw 0; forward on the floor is (−sin, −cos).
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        const dx = (-sin * forward + cos * strafe) / length * distance;
        const dy = (-cos * forward - sin * strafe) / length * distance;
        const from = { x: this.camera.position.x * 100, y: this.camera.position.z * 100 };
        const to = walkStep(from, { x: dx, y: dy }, this.obstacles());
        this.camera.position.set(to.x / 100, this.eye, to.y / 100);
    }

    _look(dx, dy) {
        this.yaw -= dx * LOOK_SPEED;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SPEED, -MAX_PITCH, MAX_PITCH);
        this._apply();
    }

    _apply() {
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }

    _key(e) {
        this._run = e.shiftKey;
        if (!this.enabled) return;
        const target = e.target;
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        const action = KEYS[e.code];
        if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        if (e.type === 'keydown') this._held.add(action);
        else this._held.delete(action);
    }
}
