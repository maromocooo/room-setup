// Time of day (sun, sky, environment) and the room's light fixtures.
//
// Fixture lights are physically based three.js lights (candela, inverse
// square falloff). LUMEN_SCALE maps real lumens onto the same exposure as the
// daylight setup, so a typical 3,800 lm ceiling light lights a room at night
// about as brightly as daylight does.

import * as THREE from 'three';
import { findLightPreset, kelvinToRgb, lightPlacement } from '../core/lights.js';

const LUMEN_SCALE = 0.02;
const MAX_SHADOW_LIGHTS = 4; // point-light shadows render six times each

const TIMES = {
    //            sun azimuth/elevation (deg), colour, intensity; sky, ground, hemisphere; environment
    morning: { azimuth: 70, elevation: 18, sun: 0xffe0bd, sunIntensity: 2.2, sky: 0xdfe8ff, ground: 0xb9ada0, hemi: 0.75, env: 0.4 },
    day: { azimuth: 160, elevation: 55, sun: 0xfff3e3, sunIntensity: 2.6, sky: 0xfdfbf7, ground: 0xb9ada0, hemi: 0.9, env: 0.45 },
    evening: { azimuth: 255, elevation: 9, sun: 0xff9a55, sunIntensity: 1.8, sky: 0xffd2b0, ground: 0x8c7a6b, hemi: 0.35, env: 0.2, background: 0xc9a48c },
    night: { azimuth: 0, elevation: -10, sun: 0x000000, sunIntensity: 0, sky: 0x2a3550, ground: 0x15130f, hemi: 0.05, env: 0.06, background: 0x141922 },
};

const fixtureMaterial = new THREE.MeshStandardMaterial({ color: 0xf1efea, roughness: 0.5 });
const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.35, metalness: 0.7 });

export class Lighting {
    constructor(scene, { hemi, sun }) {
        this.scene = scene;
        this.hemi = hemi;
        this.sun = sun;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.time = 'day';
        this.entries = new Map(); // light id → { group, key }
    }

    /** Colour seen outside the windows, or null to use the theme's background. */
    get background() {
        return TIMES[this.time].background ?? null;
    }

    /** Sun and sky for a time of day. `centre`/`size` frame the sun's shadow camera. */
    setTimeOfDay(time, centre, size) {
        this.time = TIMES[time] ? time : 'day';
        const t = TIMES[this.time];
        this.hemi.color.setHex(t.sky);
        this.hemi.groundColor.setHex(t.ground);
        this.hemi.intensity = t.hemi;
        this.scene.environmentIntensity = t.env;
        this.sun.visible = t.sunIntensity > 0;
        this.sun.color.setHex(t.sun);
        this.sun.intensity = t.sunIntensity;
        if (centre) {
            const az = THREE.MathUtils.degToRad(t.azimuth);
            const el = THREE.MathUtils.degToRad(Math.max(t.elevation, 5));
            const direction = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
            this.sun.position.copy(centre).addScaledVector(direction, size * 2);
            this.sun.target.position.copy(centre);
        }
    }

    /**
     * Bring fixtures in line with `lights`. Fixtures are rebuilt only when
     * something other than their position changed; `pose(furnitureId)` places
     * lights attached to furniture; `frozenId` is a light being dragged in 3D,
     * left exactly where the drag put it.
     */
    sync(lights, ceilingHeight, selectedId, pose, frozenId = null) {
        const seen = new Set();
        let shadowBudget = MAX_SHADOW_LIGHTS;
        for (const light of lights) {
            const place = lightPlacement(light, ceilingHeight, pose);
            if (!place) continue; // its furniture was removed
            seen.add(light.id);
            const castShadow = light.on && light.shadows && shadowBudget-- > 0;
            let entry = this.entries.get(light.id);
            if (light.id === frozenId && entry) continue;
            const key = JSON.stringify([light.preset, light.lumens, light.kelvin, light.on, castShadow,
                light.id === selectedId, ceilingHeight, Math.round(place.height)]);
            if (!entry || entry.key !== key) {
                if (entry) this._dispose(entry.group);
                entry = { group: this._fixture(light, ceilingHeight, castShadow, light.id === selectedId, place.height), key };
                this.entries.set(light.id, entry);
                this.group.add(entry.group);
            }
            entry.group.position.set(place.x / 100, 0, place.y / 100);
        }
        for (const [id, entry] of this.entries) {
            if (!seen.has(id)) {
                this._dispose(entry.group);
                this.entries.delete(id);
            }
        }
    }

    objectFor(id) {
        return this.entries.get(id)?.group ?? null;
    }

    _dispose(group) {
        this.group.remove(group);
        group.traverse(o => {
            if (o.isLight) o.shadow?.map?.dispose();
            if (o.isMesh) {
                o.geometry.dispose();
                if (o.material !== fixtureMaterial && o.material !== metalMaterial) o.material.dispose();
            }
        });
    }

    _fixture(light, ceilingHeight, castShadow, selected, heightCm) {
        const preset = findLightPreset(light.preset);
        const height = heightCm / 100;
        const ceiling = ceilingHeight / 100;
        const colour = new THREE.Color(...kelvinToRgb(light.kelvin));
        const group = new THREE.Group();
        group.userData.lightId = light.id;

        const glow = new THREE.MeshStandardMaterial({
            color: 0xffffff, emissive: light.on ? colour : new THREE.Color(0x3a3a3a),
            emissiveIntensity: light.on ? 1.6 : 1, roughness: 0.3,
        });
        // Fixtures never cast shadows: a shade blocking the room's other lights
        // looks wrong at shadow-map resolution and costs a lot.
        const add = (geometry, material, y) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = y;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            group.add(mesh);
            return mesh;
        };

        switch (preset.id) {
            case 'ceiling':
                add(new THREE.CylinderGeometry(0.26, 0.28, 0.07, 48), fixtureMaterial, ceiling - 0.035);
                add(new THREE.CylinderGeometry(0.24, 0.24, 0.005, 48), glow, ceiling - 0.072);
                break;
            case 'pendant': {
                add(new THREE.CylinderGeometry(0.004, 0.004, ceiling - height - 0.12, 6), metalMaterial, (ceiling + height + 0.12) / 2);
                const shade = add(new THREE.ConeGeometry(0.18, 0.2, 40, 1, true), metalMaterial, height + 0.04);
                shade.material = metalMaterial;
                shade.geometry.computeVertexNormals();
                add(new THREE.SphereGeometry(0.045, 20, 12), glow, height);
                break;
            }
            case 'downlight':
                add(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 32), glow, ceiling - 0.006);
                add(new THREE.TorusGeometry(0.065, 0.008, 8, 32).rotateX(Math.PI / 2), fixtureMaterial, ceiling - 0.006);
                break;
            case 'spot':
                add(new THREE.CylinderGeometry(0.01, 0.01, ceiling - height - 0.05, 6), metalMaterial, (ceiling + height + 0.05) / 2);
                add(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 24), metalMaterial, height + 0.04);
                add(new THREE.CylinderGeometry(0.045, 0.045, 0.004, 24), glow, height - 0.02);
                break;
            case 'bulb':
                // Inside a piece of furniture: just a small glowing bulb.
                add(new THREE.SphereGeometry(0.025, 16, 10), glow, height);
                if (selected) {
                    const marker = add(new THREE.SphereGeometry(0.09, 16, 10),
                        new THREE.MeshBasicMaterial({ color: 0x4f5bd5, wireframe: true, depthTest: false, transparent: true, opacity: 0.8 }), height);
                    marker.renderOrder = 10;
                }
                break;
            default: { // floor and table lamps
                const shadeHeight = preset.id === 'table' ? 0.18 : 0.26;
                add(new THREE.CylinderGeometry(0.13, 0.15, 0.025, 32), metalMaterial, 0.0125);
                add(new THREE.CylinderGeometry(0.011, 0.011, height - 0.05, 8), metalMaterial, (height - 0.05) / 2 + 0.02);
                const shade = add(new THREE.CylinderGeometry(shadeHeight * 0.45, shadeHeight * 0.7, shadeHeight, 40, 1, true),
                    new THREE.MeshStandardMaterial({ color: 0xf3ead9, side: THREE.DoubleSide, emissive: light.on ? colour : 0x000000, emissiveIntensity: light.on ? 0.35 : 0 }),
                    height);
                shade.receiveShadow = false;
                add(new THREE.SphereGeometry(0.035, 16, 10), glow, height - 0.02);
            }
        }

        if (selected && preset.id !== 'bulb') {
            const ring = add(new THREE.RingGeometry(0.2, 0.235, 48).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({ color: 0x4f5bd5, depthTest: false, transparent: true }), 0.012);
            ring.renderOrder = 10;
        }

        if (light.on) {
            const source = this._light(preset, light, colour);
            source.position.y = height - (preset.kind === 'spot' ? 0.03 : 0);
            source.castShadow = castShadow;
            group.add(source);
            if (source.isSpotLight) {
                source.target.position.set(0, -1, 0);
                group.add(source.target);
                source.target.position.y = source.position.y - 1;
            }
        }
        return group;
    }

    _light(preset, light, colour) {
        if (preset.kind === 'spot') {
            const half = THREE.MathUtils.degToRad(preset.angle / 2);
            const candela = light.lumens / (2 * Math.PI * (1 - Math.cos(half)));
            const spot = new THREE.SpotLight(colour, candela * LUMEN_SCALE, 0, half, 0.45, 2);
            spot.shadow.mapSize.set(1024, 1024);
            spot.shadow.camera.near = 0.05;
            spot.shadow.bias = -0.0005;
            spot.shadow.normalBias = 0.02;
            return spot;
        }
        const point = new THREE.PointLight(colour, (light.lumens / (4 * Math.PI)) * LUMEN_SCALE, 0, 2);
        point.shadow.mapSize.set(512, 512);
        point.shadow.camera.near = 0.08;
        point.shadow.bias = -0.002;
        point.shadow.normalBias = 0.03;
        return point;
    }
}
