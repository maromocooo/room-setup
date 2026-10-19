// "Room" tab: templates, ceiling height and the wall list.

import { presetRoom, wallLength } from '../core/geometry.js';
import { makeWall } from '../core/store.js';
import { t } from '../core/i18n.js';
import { icon } from './icons.js';

export function setupRoomPanel({ store, plan, onTemplate }) {
    const $ = id => document.getElementById(id);
    const ceiling = $('ceilingHeight');
    const ceilingValue = $('ceilingValue');
    const wallList = $('wallList');

    for (const button of document.querySelectorAll('[data-template]')) {
        button.addEventListener('click', () => {
            const width = Math.max(100, Number($('templateWidth').value) || 360);
            const depth = Math.max(100, Number($('templateDepth').value) || 270);
            store.setWalls(presetRoom(button.dataset.template, width, depth).map(w => makeWall(w.start, w.end)));
            onTemplate();
        });
    }

    ceiling.addEventListener('input', () => store.setCeilingHeight(Number(ceiling.value)));

    wallList.addEventListener('click', event => {
        const row = event.target.closest('[data-wall-id]');
        if (!row) return;
        const id = row.dataset.wallId;
        if (event.target.closest('[data-action="delete"]')) {
            store.setWalls(store.walls.filter(w => w.id !== id));
        } else {
            store.selectWall(store.selectedWallId === id ? null : id);
        }
    });

    const clear = $('clearAll');
    let armed = null;
    clear.addEventListener('click', () => {
        if (!armed) {
            clear.classList.add('armed');
            clear.querySelector('span').textContent = t('room.clearConfirm');
            armed = setTimeout(disarm, 3500);
            return;
        }
        disarm();
        store.clear();
    });
    function disarm() {
        clearTimeout(armed);
        armed = null;
        clear.classList.remove('armed');
        clear.querySelector('span').textContent = t('room.clear');
    }

    function render() {
        ceiling.value = store.ceilingHeight;
        ceilingValue.textContent = plan.unit === 'm' ? `${(store.ceilingHeight / 100).toFixed(2)} m` : `${store.ceilingHeight} cm`;
        $('wallEmpty').hidden = store.walls.length > 0;
        wallList.replaceChildren(...store.walls.map((wall, i) => {
            const row = document.createElement('li');
            row.className = 'list-row selectable';
            row.dataset.wallId = wall.id;
            row.setAttribute('aria-selected', String(wall.id === store.selectedWallId));
            row.innerHTML = `
                <span class="wall-swatch"${wall.finish ? ' data-custom="true"' : ''}></span>
                <span class="list-title"></span>
                <span class="list-meta"></span>
                <button type="button" class="icon-btn small" data-action="delete">${icon('erase')}</button>`;
            row.querySelector('.list-title').textContent = t('wall.item', { number: i + 1 });
            row.querySelector('.list-meta').textContent = plan.formatLength(wallLength(wall));
            row.querySelector('[data-action="delete"]').setAttribute('aria-label', t('wall.delete'));
            row.querySelector('[data-action="delete"]').title = t('wall.delete');
            return row;
        }));
        const area = plan.floorArea();
        $('roomSummary').textContent = !store.walls.length ? ''
            : area ? t('room.summary', { area: area.toFixed(1), count: store.walls.length })
            : t('room.summaryOpen', { count: store.walls.length });
    }

    store.on('walls room selection', render);
    return { render };
}
