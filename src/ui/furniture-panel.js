// Placed furniture list and the inspector for the selected item.

import { t } from '../core/i18n.js';
import { footprint } from '../scene/room-scene.js';

export function setupFurniturePanel({ store, onEdit, onDuplicate, onDelete, onTilt, onAddLight }) {
    const $ = id => document.getElementById(id);
    const list = $('furnitureList');
    const inspector = $('inspector');
    const fields = {
        name: $('itemName'), x: $('itemX'), z: $('itemZ'), y: $('itemY'),
        rotation: $('itemRotation'), rotationValue: $('itemRotationValue'),
    };

    list.addEventListener('click', event => {
        const row = event.target.closest('[data-id]');
        if (row) store.selectFurniture(store.selectedFurnitureId === row.dataset.id ? null : row.dataset.id);
    });

    const selected = () => store.getFurniture(store.selectedFurnitureId);

    fields.name.addEventListener('input', () => {
        const item = selected();
        if (!item) return;
        item.name = fields.name.value.trim() || item.name;
        renderList();
        store.emit('furniture');
    });

    for (const axis of ['x', 'y', 'z']) {
        fields[axis].addEventListener('change', () => {
            const item = selected();
            const value = Number(fields[axis].value);
            if (!item || !Number.isFinite(value)) return;
            item.object.position[axis] = axis === 'y' ? Math.max(0, value / 100) : value / 100;
            store.emit('furniture');
        });
    }

    const setRotation = degrees => {
        const item = selected();
        if (!item || !Number.isFinite(degrees)) return;
        item.object.rotation.y = THREE_DEG * (((degrees % 360) + 360) % 360);
        store.emit('furniture');
    };
    fields.rotation.addEventListener('input', () => setRotation(Number(fields.rotation.value)));
    fields.rotationValue.addEventListener('change', () => setRotation(Number(fields.rotationValue.value)));

    $('inspectorClose').addEventListener('click', () => store.selectFurniture(null));
    $('itemEdit').addEventListener('click', () => selected() && onEdit(selected()));
    $('itemDuplicate').addEventListener('click', () => selected() && onDuplicate(selected()));
    $('itemDelete').addEventListener('click', () => selected() && onDelete(selected()));
    $('itemAddLight').addEventListener('click', () => selected() && onAddLight(selected()));
    for (const button of document.querySelectorAll('#tiltButtons [data-tilt]')) {
        button.addEventListener('click', () => selected() && onTilt(selected(), button.dataset.tilt));
    }

    function renderList() {
        const badge = $('furnitureBadge');
        badge.hidden = store.furniture.length === 0;
        badge.textContent = store.furniture.length;
        $('furnitureEmpty').hidden = store.furniture.length > 0;
        list.replaceChildren(...store.furniture.map(item => {
            const fp = footprint(item);
            const row = document.createElement('li');
            row.className = 'list-row selectable furniture-row';
            row.dataset.id = item.id;
            row.setAttribute('aria-selected', String(item.id === store.selectedFurnitureId));
            row.innerHTML = '<img class="thumb" alt=""><span class="list-title"></span><span class="list-meta"></span>';
            if (item.thumbnail) row.querySelector('img').src = item.thumbnail;
            else row.querySelector('img').classList.add('placeholder');
            row.querySelector('.list-title').textContent = item.name;
            row.querySelector('.list-meta').textContent = item.status === 'generating' ? t('furniture.generating')
                : item.status === 'failed' ? t('furniture.failed') : t('inspector.size', sizeOf(fp));
            row.dataset.status = item.status ?? 'ready';
            return row;
        }));
    }

    function renderInspector() {
        const item = selected();
        inspector.hidden = !item;
        if (!item) return;
        const o = item.object;
        const active = document.activeElement;
        const set = (field, value) => { if (active !== field) field.value = value; };
        set(fields.name, item.name);
        set(fields.x, Math.round(o.position.x * 100));
        set(fields.z, Math.round(o.position.z * 100));
        set(fields.y, Math.round(o.position.y * 100));
        const degrees = Math.round(((o.rotation.y / THREE_DEG) % 360 + 360) % 360) % 360;
        set(fields.rotation, degrees);
        set(fields.rotationValue, degrees);
        $('itemSize').textContent = item.status === 'failed' ? `${t('furniture.failed')}: ${item.error ?? ''}`
            : item.status === 'generating' ? t('furniture.generating') : t('inspector.size', sizeOf(footprint(item)));
        $('itemEdit').disabled = Boolean(item.object.userData.placeholder);
        for (const button of document.querySelectorAll('#tiltButtons [data-tilt]')) button.disabled = Boolean(item.object.userData.placeholder);
    }

    function render() {
        renderList();
        renderInspector();
    }

    store.on('furniture selection', render);
    return { render, renderInspector };
}

const THREE_DEG = Math.PI / 180;

function sizeOf(fp) {
    return { w: Math.round(fp.width * 100), d: Math.round(fp.depth * 100), h: Math.round(fp.height * 100) };
}
