// 2D floor-plan editor on a <canvas>. World units are centimetres.
//
// Tools: 'wall' draws walls (starting from a corner continues the outline),
// 'select' moves corners/walls/openings/furniture and pans on empty space,
// 'erase' deletes the clicked opening or wall, 'opening' places the armed
// door/window preset on the clicked wall. Middle/right drag and Space+drag pan in
// every tool; the wheel zooms around the cursor.

import { getFloorPolygon } from '../core/floor-outline.js';
import { constrainAngle, distanceToSegment, planBounds, polygonArea, snapToGrid, wallLength } from '../core/geometry.js';
import { makeWall } from '../core/store.js';
import { FLOOR_TILE_METRES, materialCanvas, findPreset } from '../core/textures.js';
import { createOpening, hitOpening, offsetOnWall, pointOnWall, wallFrame } from '../core/openings.js';
import { createLight, kelvinToRgb, lightPlacement, movePatch } from '../core/lights.js';

const HIT_PX = 9;
const WALL_THICKNESS_CM = 10;
const MIN_WALL_CM = 5;
const ZOOM_LIMITS = [0.15, 8];

const samePoint = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

export class PlanEditor {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('../core/store.js').Store} store
     * @param {{ footprints: () => any[], moveFurniture: (id: string, x: number, z: number) => void,
     *           onHud: (state: {x: number, y: number, zoom: number}) => void }} hooks
     */
    constructor(canvas, store, hooks) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.store = store;
        this.hooks = hooks;
        this.tool = 'wall';
        this.openingPreset = null;
        this.lightPreset = null;
        this.gridSize = 10;
        this.unit = 'cm';
        this.view = { scale: 1.6, x: 80, y: 80 };
        this.drag = null;
        this.hover = null;
        this.cursor = null;
        this.spaceHeld = false;
        this._frame = 0;
        this._patternCache = new Map();

        canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
        canvas.addEventListener('pointermove', e => this.onPointerMove(e));
        canvas.addEventListener('pointerup', e => this.onPointerUp(e));
        canvas.addEventListener('pointercancel', () => { this.drag = null; this.updateCursor(); this.requestRender(); });
        canvas.addEventListener('pointerleave', () => { this.cursor = null; this.hover = null; this.requestRender(); });
        canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e)) { this.spaceHeld = true; this.updateCursor(); } });
        window.addEventListener('keyup', e => { if (e.code === 'Space') { this.spaceHeld = false; this.updateCursor(); } });
        new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
        store.on('walls finish selection furniture openings lights', () => this.requestRender());
        this.resize();
    }

    // ---- view ----
    resize() {
        const { clientWidth: w, clientHeight: h } = this.canvas.parentElement;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.dpr = dpr;
        this.render();
    }

    get width() { return this.canvas.width / (this.dpr || 1); }
    get height() { return this.canvas.height / (this.dpr || 1); }

    toScreen(p) { return { x: p.x * this.view.scale + this.view.x, y: p.y * this.view.scale + this.view.y }; }
    toWorld(sx, sy) { return { x: (sx - this.view.x) / this.view.scale, y: (sy - this.view.y) / this.view.scale }; }

    eventPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    }

    zoomAt(sx, sy, factor) {
        const before = this.toWorld(sx, sy);
        this.view.scale = Math.min(ZOOM_LIMITS[1], Math.max(ZOOM_LIMITS[0], this.view.scale * factor));
        this.view.x = sx - before.x * this.view.scale;
        this.view.y = sy - before.y * this.view.scale;
        this.requestRender();
    }

    fit() {
        const bounds = planBounds(this.store.walls) ?? { minX: 0, minY: 0, width: 400, height: 300, cx: 200, cy: 150 };
        const pad = 70;
        const scale = Math.min((this.width - pad * 2) / Math.max(bounds.width, 100), (this.height - pad * 2) / Math.max(bounds.height, 100));
        this.view.scale = Math.min(ZOOM_LIMITS[1], Math.max(ZOOM_LIMITS[0], scale));
        this.view.x = this.width / 2 - bounds.cx * this.view.scale;
        this.view.y = this.height / 2 - bounds.cy * this.view.scale;
        this.requestRender();
    }

    setTool(tool) {
        this.tool = tool;
        this.cancel();
        this.updateCursor();
    }

    setGrid(size) { this.gridSize = size; this.requestRender(); }
    setUnit(unit) { this.unit = unit; this.requestRender(); }

    // ---- hit testing ----
    hitCorner(world, exceptPoint = null) {
        const tolerance = HIT_PX / this.view.scale;
        for (const wall of this.store.walls) {
            for (const point of [wall.start, wall.end]) {
                if (exceptPoint && samePoint(point, exceptPoint)) continue;
                if (Math.hypot(point.x - world.x, point.y - world.y) <= tolerance) return { x: point.x, y: point.y };
            }
        }
        return null;
    }

    hitWall(world) {
        const tolerance = Math.max(HIT_PX / this.view.scale, WALL_THICKNESS_CM / 2);
        let best = null;
        let bestDistance = tolerance;
        for (const wall of this.store.walls) {
            const d = distanceToSegment(world, wall.start, wall.end);
            if (d <= bestDistance) { best = wall; bestDistance = d; }
        }
        return best;
    }

    hitFurniture(world) {
        const prints = this.hooks.footprints();
        for (let i = prints.length - 1; i >= 0; i--) {
            const f = prints[i];
            const dx = world.x - f.x;
            const dy = world.y - f.z;
            const cos = Math.cos(f.rotation);
            const sin = Math.sin(f.rotation);
            // Three.js rotates about +Y, which is clockwise when looking down on x/z.
            const lx = dx * cos - dy * sin;
            const ly = dx * sin + dy * cos;
            if (Math.abs(lx) <= f.width / 2 && Math.abs(ly) <= f.depth / 2) return f;
        }
        return null;
    }

    snap(world, { exceptPoint = null } = {}) {
        const corner = this.hitCorner(world, exceptPoint);
        if (corner) return { point: corner, snapped: true };
        return { point: { x: snapToGrid(world.x, this.gridSize), y: snapToGrid(world.y, this.gridSize) }, snapped: false };
    }

    // ---- input ----
    onPointerDown(e) {
        const { sx, sy } = this.eventPoint(e);
        const world = this.toWorld(sx, sy);
        this.canvas.setPointerCapture(e.pointerId);

        if (e.button === 1 || e.button === 2 || this.spaceHeld) {
            this.drag = { type: 'pan', sx, sy, x: this.view.x, y: this.view.y };
            this.updateCursor();
            return;
        }
        if (e.button !== 0) return;

        if (this.tool === 'wall') {
            const { point } = this.snap(world);
            this.drag = { type: 'draw', start: point, end: point };
        } else if (this.tool === 'light') {
            if (this.lightPreset) {
                const light = createLight(this.lightPreset.id, { x: snapToGrid(world.x, this.gridSize), y: snapToGrid(world.y, this.gridSize) });
                this.store.addLight(light);
                this.store.selectLight(light.id);
                this.hooks.onLightPlaced?.(light);
            }
        } else if (this.tool === 'opening') {
            const wall = this.hitWall(world);
            if (wall && this.openingPreset) {
                const opening = createOpening(this.openingPreset, wall, this.snapAlong(wall, world), this.store.ceilingHeight, this.roomCentre());
                this.store.addOpening(opening);
                this.store.selectOpening(opening.id);
                this.hooks.onOpeningPlaced?.(opening);
            }
        } else if (this.tool === 'erase') {
            const light = this.hitLight(world);
            if (light) {
                this.store.removeLight(light.id);
                this.updateCursor();
                this.requestRender();
                return;
            }
            const opening = this.hitOpeningAt(world);
            const wall = opening ? null : this.hitWall(world);
            if (opening) this.store.removeOpening(opening.id);
            else if (wall) this.store.setWalls(this.store.walls.filter(w => w !== wall));
        } else {
            const light = this.hitLight(world);
            if (light) {
                this.store.selectLight(light.id);
                const place = this.lightAt(light);
                this.drag = { type: 'light', id: light.id, offset: { x: world.x - place.x, y: world.y - place.y }, height: place.height, moved: false };
                this.updateCursor();
                this.requestRender();
                return;
            }
            const corner = this.hitCorner(world);
            const opening = corner ? null : this.hitOpeningAt(world);
            const wall = corner || opening ? null : this.hitWall(world);
            const furniture = corner || wall || opening ? null : this.hitFurniture(world);
            if (opening) {
                this.store.selectOpening(opening.id);
                this.drag = { type: 'opening', id: opening.id, moved: false };
            } else if (corner) {
                this.drag = { type: 'corner', points: this.pointsAt(corner), origin: corner, moved: false };
            } else if (wall) {
                this.store.selectWall(wall.id);
                const points = [...this.pointsAt(wall.start), ...this.pointsAt(wall.end)];
                this.drag = { type: 'wall', points, startWorld: world, originals: points.map(p => ({ x: p.x, y: p.y })), moved: false };
            } else if (furniture) {
                this.store.selectFurniture(furniture.id);
                this.drag = { type: 'furniture', id: furniture.id, offset: { x: world.x - furniture.x, y: world.y - furniture.z } };
            } else {
                this.store.selectWall(null);
                this.store.selectFurniture(null);
                this.store.selectOpening(null);
                this.store.selectLight(null);
                this.drag = { type: 'pan', sx, sy, x: this.view.x, y: this.view.y };
            }
        }
        this.updateCursor();
        this.requestRender();
    }

    /** A point inside the room: the floor outline's centroid, else the plan's centre. */
    roomCentre() {
        const polygon = getFloorPolygon(this.store.walls);
        if (polygon) {
            return polygon.reduce((c, p) => ({ x: c.x + (p.x * 100) / polygon.length, y: c.y + (p.z * 100) / polygon.length }), { x: 0, y: 0 });
        }
        const bounds = planBounds(this.store.walls);
        return bounds ? { x: bounds.cx, y: bounds.cy } : null;
    }

    /** Plan position of a light (lights in furniture follow their item); null if hidden. */
    lightAt(light) {
        return lightPlacement(light, this.store.ceilingHeight, id => this.hooks.furniturePose?.(id));
    }

    hitLight(world) {
        const tolerance = (HIT_PX + 4) / this.view.scale;
        for (let i = this.store.lights.length - 1; i >= 0; i--) {
            const light = this.store.lights[i];
            const place = this.lightAt(light);
            if (place && Math.hypot(place.x - world.x, place.y - world.y) <= tolerance) return light;
        }
        return null;
    }

    hitOpeningAt(world) {
        const tolerance = Math.max(HIT_PX / this.view.scale, WALL_THICKNESS_CM / 2 + 2);
        return hitOpening(this.store.openings, this.store.walls, world, tolerance);
    }

    /** Grid-snapped point on `wall` nearest to `world` (snapped along the wall). */
    snapAlong(wall, world) {
        return pointOnWall(wall, snapToGrid(offsetOnWall(wall, world), this.gridSize));
    }

    /** Every endpoint object located at `point` (walls sharing a corner). */
    pointsAt(point) {
        return this.store.walls.flatMap(w => [w.start, w.end]).filter(p => samePoint(p, point));
    }

    onPointerMove(e) {
        const { sx, sy } = this.eventPoint(e);
        const world = this.toWorld(sx, sy);
        this.cursor = world;
        this.hooks.onHud?.({ x: world.x, y: world.y, zoom: this.view.scale });
        const drag = this.drag;

        if (!drag) {
            const light = this.tool === 'select' || this.tool === 'erase' ? this.hitLight(world) : null;
            const opening = !light && (this.tool === 'select' || this.tool === 'erase') ? this.hitOpeningAt(world) : null;
            this.hover = this.tool === 'wall'
                ? { corner: this.hitCorner(world) }
                : { corner: this.tool === 'select' && !light ? this.hitCorner(world) : null, opening, light,
                    wall: opening || light ? null : this.hitWall(world),
                    furniture: this.tool === 'select' && !opening ? this.hitFurniture(world) : null };
            this.updateCursor();
            this.requestRender();
            return;
        }

        if (drag.type === 'pan') {
            this.view.x = drag.x + (sx - drag.sx);
            this.view.y = drag.y + (sy - drag.sy);
        } else if (drag.type === 'draw') {
            let { point, snapped } = this.snap(world);
            if (e.shiftKey) { point = constrainAngle(drag.start, point); snapped = false; }
            drag.end = point;
            drag.snapped = snapped;
        } else if (drag.type === 'corner' || drag.type === 'wall') {
            // Record undo only once something actually moves, so a plain
            // click doesn't wipe the redo stack.
            if (!drag.moved) this.store.checkpoint();
        }
        if (drag.type === 'corner') {
            const { point } = this.snap(world, { exceptPoint: drag.points[0] });
            for (const p of drag.points) { p.x = point.x; p.y = point.y; }
            drag.moved = true;
            this.store.touchWalls();
        } else if (drag.type === 'wall') {
            const dx = snapToGrid(world.x - drag.startWorld.x, this.gridSize);
            const dy = snapToGrid(world.y - drag.startWorld.y, this.gridSize);
            drag.points.forEach((p, i) => { p.x = drag.originals[i].x + dx; p.y = drag.originals[i].y + dy; });
            drag.moved = true;
            this.store.touchWalls();
        } else if (drag.type === 'furniture') {
            if (!drag.recorded) this.store.checkpoint();
            drag.recorded = true;
            this.hooks.moveFurniture(drag.id, world.x - drag.offset.x, world.y - drag.offset.y);
        } else if (drag.type === 'light') {
            if (!drag.moved) this.store.checkpoint();
            drag.moved = true;
            const light = this.store.getLight(drag.id);
            const target = {
                x: snapToGrid(world.x - drag.offset.x, this.gridSize),
                y: snapToGrid(world.y - drag.offset.y, this.gridSize),
                height: drag.height,
            };
            this.store.updateLight(drag.id, movePatch(light, target, this.store.ceilingHeight, id => this.hooks.furniturePose?.(id)), { record: false });
        } else if (drag.type === 'opening') {
            // Slide along the wall, or hop onto another wall under the cursor.
            const opening = this.store.getOpening(drag.id);
            const wall = this.hitWall(world) ?? this.store.walls.find(w => w.id === opening?.wallId);
            if (opening && wall) {
                if (!drag.moved) this.store.checkpoint();
                drag.moved = true;
                const offset = offsetOnWall(wall, this.snapAlong(wall, world));
                this.store.updateOpening(drag.id, { wallId: wall.id, offset }, { record: false });
            }
        }
        this.requestRender();
    }

    onPointerUp(e) {
        const drag = this.drag;
        this.drag = null;
        if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
        if (drag?.type === 'draw' && Math.hypot(drag.end.x - drag.start.x, drag.end.y - drag.start.y) >= MIN_WALL_CM) {
            const wall = makeWall(drag.start, drag.end);
            this.store.setWalls([...this.store.walls, wall]);
        } else if ((drag?.type === 'corner' || drag?.type === 'wall') && drag.moved) {
            // Merge walls the drag made overlap and drop zero-length ones.
            this.store.setWalls(this.store.walls, { record: false });
        }
        this.updateCursor();
        this.requestRender();
    }

    onWheel(e) {
        e.preventDefault();
        const { sx, sy } = this.eventPoint(e);
        this.zoomAt(sx, sy, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    }

    cancel() {
        if (this.drag?.type === 'draw') this.drag = null;
        this.requestRender();
    }

    deleteSelectedWall() {
        const id = this.store.selectedWallId;
        if (id) this.store.setWalls(this.store.walls.filter(w => w.id !== id));
    }

    updateCursor() {
        const drag = this.drag;
        let cursor = 'default';
        if (drag?.type === 'pan' || this.spaceHeld) cursor = drag ? 'grabbing' : 'grab';
        else if (this.tool === 'wall') cursor = 'crosshair';
        else if (this.tool === 'opening') cursor = this.hover?.wall ? 'copy' : 'not-allowed';
        else if (this.tool === 'light') cursor = 'copy';
        else if (this.tool === 'erase') cursor = this.hover?.wall || this.hover?.opening || this.hover?.light ? 'pointer' : 'default';
        else if (drag) cursor = 'grabbing';
        else if (this.hover?.corner || this.hover?.wall || this.hover?.furniture || this.hover?.opening || this.hover?.light) cursor = 'grab';
        this.canvas.style.cursor = cursor;
    }

    // ---- drawing ----
    requestRender() {
        if (this._frame) return;
        this._frame = requestAnimationFrame(() => { this._frame = 0; this.render(); });
    }

    formatLength(cm) {
        return this.unit === 'm' ? `${(cm / 100).toFixed(2)} m` : `${Math.round(cm)} cm`;
    }

    colors() {
        const style = getComputedStyle(this.canvas);
        const v = name => style.getPropertyValue(name).trim();
        return {
            bg: v('--plan-bg'), minor: v('--plan-grid'), major: v('--plan-grid-major'),
            wall: v('--plan-wall'), accent: v('--accent'), accentSoft: v('--accent-soft'),
            danger: v('--danger'), text: v('--text'), label: v('--surface'), muted: v('--text-muted'),
            furniture: v('--plan-furniture'), font: v('--font-ui') || 'system-ui, sans-serif',
        };
    }

    render() {
        const ctx = this.ctx;
        const c = this.colors();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = c.bg;
        ctx.fillRect(0, 0, this.width, this.height);
        this.drawGrid(ctx, c);

        const polygon = getFloorPolygon(this.store.walls);
        if (polygon) this.drawFloor(ctx, polygon);
        this.drawFootprints(ctx, c);
        this.drawWalls(ctx, c, polygon);
        if (this.drag?.type === 'draw') this.drawPreview(ctx, c);
        this.drawCorners(ctx, c);
        this.drawLights(ctx, c);
    }

    drawGrid(ctx, c) {
        const { scale } = this.view;
        const topLeft = this.toWorld(0, 0);
        const bottomRight = this.toWorld(this.width, this.height);
        const lines = (step, color, width) => {
            if (step * scale < 6) return;
            ctx.beginPath();
            for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
                const sx = Math.round(x * scale + this.view.x) + 0.5;
                ctx.moveTo(sx, 0); ctx.lineTo(sx, this.height);
            }
            for (let y = Math.floor(topLeft.y / step) * step; y <= bottomRight.y; y += step) {
                const sy = Math.round(y * scale + this.view.y) + 0.5;
                ctx.moveTo(0, sy); ctx.lineTo(this.width, sy);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.stroke();
        };
        lines(this.gridSize, c.minor, 1);
        lines(100, c.major, 1);
    }

    floorPattern(ctx) {
        const { finish, scale, direction } = this.store.floor;
        const source = finish.preset ? materialCanvas('floor', findPreset('floor', finish.preset) ?? findPreset('floor', 'oak'))
            : this._imageFor(finish.image);
        if (!source || !(source.width || source.naturalWidth)) return null;
        let pattern = this._patternCache.get(source);
        if (!pattern) {
            pattern = ctx.createPattern(source, 'repeat');
            this._patternCache.set(source, pattern);
        }
        // A preset's tile covers FLOOR_TILE_METRES ÷ scale, an image's 1 m ÷ scale, matching the 3D view.
        const tilePx = ((finish.preset ? FLOOR_TILE_METRES * 100 : 100) / scale) * this.view.scale;
        const sourceSize = source.width || source.naturalWidth;
        const transform = new DOMMatrix().translateSelf(this.view.x, this.view.y);
        if (direction === 'vertical') transform.rotateSelf(90);
        pattern.setTransform(transform.scaleSelf(tilePx / sourceSize));
        return pattern;
    }

    _imageFor(src) {
        if (!src) return null;
        this._images ??= new Map();
        if (!this._images.has(src)) {
            const image = new Image();
            image.onload = () => this.requestRender();
            image.src = src;
            this._images.set(src, image);
        }
        const image = this._images.get(src);
        return image.complete ? image : null;
    }

    drawFloor(ctx, polygon) {
        ctx.beginPath();
        polygon.forEach((p, i) => {
            const s = this.toScreen({ x: p.x * 100, y: p.z * 100 });
            i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = this.floorPattern(ctx) ?? '#d9c7a7';
        ctx.fill();
        ctx.restore();
    }

    drawFootprints(ctx, c) {
        for (const f of this.hooks.footprints()) {
            const center = this.toScreen({ x: f.x, y: f.z });
            const w = f.width * this.view.scale;
            const d = f.depth * this.view.scale;
            ctx.save();
            ctx.translate(center.x, center.y);
            ctx.rotate(-f.rotation);
            ctx.beginPath();
            ctx.roundRect(-w / 2, -d / 2, w, d, Math.min(6, w / 4, d / 4));
            ctx.fillStyle = f.selected ? c.accentSoft : c.furniture;
            ctx.fill();
            ctx.lineWidth = f.selected ? 2 : 1;
            ctx.strokeStyle = f.selected ? c.accent : c.muted;
            ctx.stroke();
            // Front edge marker (the side facing +z before rotation).
            ctx.beginPath();
            ctx.moveTo(-w / 2 + 3, d / 2 - 3);
            ctx.lineTo(w / 2 - 3, d / 2 - 3);
            ctx.strokeStyle = f.selected ? c.accent : c.muted;
            ctx.globalAlpha = 0.6;
            ctx.stroke();
            ctx.restore();
            if (w > 44 && d > 18) {
                ctx.font = `500 11px ${c.font}`;
                ctx.fillStyle = c.text;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(truncate(ctx, f.name, w - 8), center.x, center.y);
            }
        }
    }

    drawWalls(ctx, c, polygon) {
        const selected = this.store.selectedWallId;
        const thickness = Math.max(3, WALL_THICKNESS_CM * this.view.scale);
        const centroid = polygon
            ? polygon.reduce((acc, p) => ({ x: acc.x + p.x * 100 / polygon.length, y: acc.y + p.z * 100 / polygon.length }), { x: 0, y: 0 })
            : null;
        ctx.lineCap = 'square';
        for (const wall of this.store.walls) {
            const a = this.toScreen(wall.start);
            const b = this.toScreen(wall.end);
            const hovered = this.hover?.wall === wall;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineWidth = thickness;
            ctx.strokeStyle = wall.id === selected || hovered ? (this.tool === 'erase' ? c.danger : c.accent) : c.wall;
            ctx.globalAlpha = hovered && wall.id !== selected ? 0.7 : 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        ctx.lineCap = 'butt';
        this.drawOpenings(ctx, c, thickness);
        for (const wall of this.store.walls) this.drawDimension(ctx, c, wall, centroid, thickness);
        const opening = this.store.getOpening(this.store.selectedOpeningId);
        const host = opening && this.store.walls.find(w => w.id === opening.wallId);
        if (host) {
            const half = opening.width / 2;
            this.drawDimension(ctx, c, { start: pointOnWall(host, opening.offset - half), end: pointOnWall(host, opening.offset + half) },
                centroid, thickness + 26, true);
        }
    }

    drawOpenings(ctx, c, thickness) {
        const walls = new Map(this.store.walls.map(w => [w.id, w]));
        for (const opening of this.store.openings) {
            const wall = walls.get(opening.wallId);
            if (wall) this.drawOpening(ctx, c, opening, wall, thickness, opening.id === this.store.selectedOpeningId || this.hover?.opening === opening);
        }
        // Placement preview for the armed preset.
        const wall = this.tool === 'opening' && !this.drag ? this.hover?.wall : null;
        if (wall && this.cursor && this.openingPreset) {
            const ghost = createOpening(this.openingPreset, wall, this.snapAlong(wall, this.cursor), this.store.ceilingHeight, this.roomCentre());
            ctx.save();
            ctx.globalAlpha = 0.55;
            this.drawOpening(ctx, c, ghost, wall, thickness, true);
            ctx.restore();
        }
    }

    /** Architectural symbol: gap in the wall, plus a swing arc, slider or glazing. */
    drawOpening(ctx, c, opening, wall, thickness, highlight) {
        const { ux, uy, nx, ny } = wallFrame(wall);
        const half = opening.width / 2;
        const a = this.toScreen(pointOnWall(wall, opening.offset - half));
        const b = this.toScreen(pointOnWall(wall, opening.offset + half));
        const t = thickness / 2;
        const w = opening.width * this.view.scale;
        const ink = highlight ? (this.tool === 'erase' ? c.danger : c.accent) : c.wall;
        const at = (p, along, across) => ({ x: p.x + ux * along + nx * across, y: p.y + uy * along + ny * across });
        const line = (p, q, width = 1.5, color = ink) => {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.lineWidth = width;
            ctx.strokeStyle = color;
            ctx.stroke();
        };

        // Cut the wall and draw the jambs.
        line(a, b, thickness + 1, c.bg);
        line(at(a, 0, -t), at(a, 0, t), 2);
        line(at(b, 0, -t), at(b, 0, t), 2);

        if (opening.kind === 'window') {
            line(at(a, 0, -t), at(b, 0, -t), 1);
            line(at(a, 0, t), at(b, 0, t), 1);
            if (opening.style === 'sliding') {
                // Two overlapping sashes on separate tracks.
                line(at(a, 0, -t * 0.25), at(a, w * 0.55, -t * 0.25), 2, highlight ? ink : c.accent);
                line(at(b, -w * 0.55, t * 0.25), at(b, 0, t * 0.25), 2, highlight ? ink : c.accent);
            } else {
                line(a, b, 2, highlight ? ink : c.accent);
            }
            return;
        }

        const side = opening.side || 1;
        const swing = (hinge, closed, radius) => {
            // Leaf drawn open at 90°, with the arc it sweeps.
            const leaf = at(hinge, 0, side * radius);
            line(hinge, leaf, 2);
            const start = Math.atan2(leaf.y - hinge.y, leaf.x - hinge.x);
            const end = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
            const cross = (leaf.x - hinge.x) * (closed.y - hinge.y) - (leaf.y - hinge.y) * (closed.x - hinge.x);
            ctx.beginPath();
            ctx.arc(hinge.x, hinge.y, radius, start, end, cross < 0);
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = ink;
            ctx.stroke();
            ctx.setLineDash([]);
        };
        if (opening.style === 'hinged') {
            const [hinge, closed] = opening.hinge === 'end' ? [b, a] : [a, b];
            swing(hinge, closed, w);
        } else if (opening.style === 'double') {
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            swing(a, mid, w / 2);
            swing(b, mid, w / 2);
        } else if (opening.style === 'sliding') {
            line(at(a, 0, t * 0.3), at(a, w * 0.55, t * 0.3), 2.5);
            line(at(b, -w * 0.55, -t * 0.3), at(b, 0, -t * 0.3), 2.5);
        }
    }

    drawDimension(ctx, c, wall, centroid, thickness, emphasise = false) {
        const length = wallLength(wall);
        if (length * this.view.scale < 36) return;
        const a = this.toScreen(wall.start);
        const b = this.toScreen(wall.end);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        let nx = -(b.y - a.y);
        let ny = b.x - a.x;
        const n = Math.hypot(nx, ny) || 1;
        nx /= n; ny /= n;
        if (centroid) {
            // Put the label outside the room.
            const cs = this.toScreen(centroid);
            if ((mid.x - cs.x) * nx + (mid.y - cs.y) * ny < 0) { nx = -nx; ny = -ny; }
        }
        const offset = thickness / 2 + 13;
        const text = this.formatLength(length);
        ctx.font = `600 11px ${c.font}`;
        const width = ctx.measureText(text).width + 12;
        const x = mid.x + nx * offset;
        const y = mid.y + ny * offset;
        ctx.beginPath();
        ctx.roundRect(x - width / 2, y - 9, width, 18, 9);
        ctx.fillStyle = emphasise ? c.accent : c.label;
        ctx.fill();
        if (!emphasise) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = c.major;
            ctx.stroke();
        }
        ctx.fillStyle = emphasise ? '#fff' : c.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y + 0.5);
    }

    drawPreview(ctx, c) {
        const { start, end, snapped } = this.drag;
        const a = this.toScreen(start);
        const b = this.toScreen(end);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(3, WALL_THICKNESS_CM * this.view.scale);
        ctx.strokeStyle = c.accent;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
        if (snapped) this.drawRing(ctx, b, c.accent);
        this.drawDimension(ctx, c, { start, end }, null, 10, true);
    }

    drawCorners(ctx, c) {
        const showAll = this.tool === 'select';
        const seen = [];
        for (const wall of this.store.walls) {
            for (const p of [wall.start, wall.end]) {
                if (seen.some(q => samePoint(p, q))) continue;
                seen.push(p);
                const hovered = this.hover?.corner && samePoint(this.hover.corner, p);
                if (!showAll && !hovered) continue;
                const s = this.toScreen(p);
                ctx.beginPath();
                ctx.arc(s.x, s.y, hovered ? 6 : 4.5, 0, Math.PI * 2);
                ctx.fillStyle = c.label;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = hovered ? c.accent : c.wall;
                ctx.stroke();
            }
        }
        if (this.tool === 'wall' && !this.drag && this.cursor) {
            const { point, snapped } = this.snap(this.cursor);
            const s = this.toScreen(point);
            if (snapped) this.drawRing(ctx, s, c.accent);
            else {
                ctx.beginPath();
                ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = c.accent;
                ctx.fill();
            }
        }
    }

    /** Lights as a bulb disc tinted by colour temperature, with rays when on. */
    drawLights(ctx, c) {
        const icon = (light, ghost = false) => {
            const place = this.lightAt(light);
            if (!place) return;
            const s = this.toScreen({ x: place.x, y: place.y });
            const [r, g, b] = kelvinToRgb(light.kelvin).map(v => Math.round(v * 255));
            const selected = light.id === this.store.selectedLightId || this.hover?.light === light;
            ctx.save();
            if (ghost) ctx.globalAlpha = 0.55;
            if (light.on) {
                ctx.beginPath();
                for (let i = 0; i < 8; i++) {
                    const a = (i * Math.PI) / 4;
                    ctx.moveTo(s.x + Math.cos(a) * 10, s.y + Math.sin(a) * 10);
                    ctx.lineTo(s.x + Math.cos(a) * 14, s.y + Math.sin(a) * 14);
                }
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = `rgb(${Math.round(r * 0.8)}, ${Math.round(g * 0.7)}, ${Math.round(b * 0.4)})`;
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = light.on ? `rgb(${r}, ${g}, ${b})` : c.label;
            ctx.fill();
            ctx.lineWidth = selected ? 2.5 : 1.5;
            ctx.strokeStyle = selected ? (this.tool === 'erase' ? c.danger : c.accent) : c.wall;
            ctx.stroke();
            ctx.restore();
        };
        for (const light of this.store.lights) icon(light);
        if (this.tool === 'light' && this.lightPreset && this.cursor && !this.drag) {
            icon({ ...createLight(this.lightPreset.id, { x: snapToGrid(this.cursor.x, this.gridSize), y: snapToGrid(this.cursor.y, this.gridSize) }), id: null }, true);
        }
    }

    drawRing(ctx, s, color) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
    }

    /** PNG data URL of the whole plan, framed to fit. */
    snapshot() {
        const saved = { ...this.view };
        const cursor = this.cursor;
        this.cursor = null;
        this.fit();
        this.render();
        const url = this.canvas.toDataURL('image/png');
        this.view = saved;
        this.cursor = cursor;
        this.render();
        return url;
    }

    floorArea() {
        const polygon = getFloorPolygon(this.store.walls);
        return polygon ? polygonArea(polygon.map(p => ({ x: p.x, y: p.z }))) : null;
    }
}

function isTyping(e) {
    const el = e.target;
    return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function truncate(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
}

export { isTyping };
