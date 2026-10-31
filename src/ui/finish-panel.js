// "Finishes" tab: flooring and wallpaper swatches, pattern scale, and
// custom images. Wallpaper applies to every wall or only the selected one.

import { FLOOR_PRESETS, WALL_PRESETS, swatchUrl } from '../core/textures.js';
import { t } from '../core/i18n.js';
import { icon } from './icons.js';

const MAX_TEXTURE_PX = 1024;

export function setupFinishPanel({ store, toast }) {
    const $ = id => document.getElementById(id);
    const fileInput = $('customTextureInput');
    let scope = 'all';
    let uploadKind = 'floor';

    function currentFinish(kind) {
        if (kind === 'floor') return store.floor.finish;
        const wall = scope === 'selected' && store.walls.find(w => w.id === store.selectedWallId);
        return wall ? (wall.finish ?? store.wall.finish) : store.wall.finish;
    }

    function choose(kind, finish) {
        if (kind === 'floor') return store.setFloor({ finish });
        const wall = scope === 'selected' && store.walls.find(w => w.id === store.selectedWallId);
        if (wall) {
            store.checkpoint();
            wall.finish = finish;
            store.touchWalls();
        } else {
            store.setWallFinish({ finish });
        }
    }

    function buildSwatches(kind, container, presets) {
        container.replaceChildren();
        for (const preset of presets) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'swatch';
            button.dataset.preset = preset.id;
            button.setAttribute('role', 'radio');
            button.innerHTML = `<span class="swatch-image" style="background-image:url(${swatchUrl(kind, preset)})"></span><span class="swatch-label" data-i18n="finish.preset.${preset.id}"></span>`;
            button.querySelector('.swatch-label').textContent = t(`finish.preset.${preset.id}`);
            button.addEventListener('click', () => choose(kind, { preset: preset.id }));
            container.appendChild(button);
        }
        const custom = document.createElement('button');
        custom.type = 'button';
        custom.className = 'swatch custom';
        custom.setAttribute('role', 'radio');
        custom.innerHTML = `<span class="swatch-image">${icon('plus')}</span><span class="swatch-label" data-i18n="finish.custom"></span>`;
        custom.querySelector('.swatch-label').textContent = t('finish.custom');
        custom.addEventListener('click', () => {
            uploadKind = kind;
            fileInput.click();
        });
        container.appendChild(custom);
    }

    buildSwatches('floor', $('floorSwatches'), FLOOR_PRESETS);
    buildSwatches('wall', $('wallSwatches'), WALL_PRESETS);

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) return toast(t('toast.invalidImage'), { type: 'error' });
        choose(uploadKind, { image: await downscale(file) });
    });

    for (const [kind, id] of [['floor', 'floorScale'], ['wall', 'wallScale']]) {
        const input = $(id);
        input.addEventListener('input', () => {
            const scale = Number(input.value);
            kind === 'floor' ? store.setFloor({ scale }) : store.setWallFinish({ scale });
        });
    }

    for (const button of document.querySelectorAll('#wallScope [data-scope]')) {
        button.addEventListener('click', () => { scope = button.dataset.scope; render(); });
    }

    for (const button of document.querySelectorAll('#floorDirection [data-direction]')) {
        button.addEventListener('click', () => store.setFloor({ direction: button.dataset.direction }));
    }

    function markSelected(container, finish) {
        for (const swatch of container.querySelectorAll('.swatch')) {
            const selected = finish?.preset ? swatch.dataset.preset === finish.preset : Boolean(finish?.image) && swatch.classList.contains('custom');
            swatch.setAttribute('aria-checked', String(selected));
            if (swatch.classList.contains('custom')) {
                const image = swatch.querySelector('.swatch-image');
                image.style.backgroundImage = finish?.image ? `url(${finish.image})` : '';
                image.classList.toggle('has-image', Boolean(finish?.image));
            }
        }
    }

    function render() {
        markSelected($('floorSwatches'), store.floor.finish);
        markSelected($('wallSwatches'), currentFinish('wall'));
        $('floorScale').value = store.floor.scale;
        for (const button of document.querySelectorAll('#floorDirection [data-direction]')) {
            button.setAttribute('aria-pressed', String(button.dataset.direction === (store.floor.direction ?? 'horizontal')));
        }
        $('wallScale').value = store.wall.scale;
        $('floorScaleValue').textContent = `×${store.floor.scale.toFixed(2)}`;
        $('wallScaleValue').textContent = `×${store.wall.scale.toFixed(2)}`;
        const hasSelection = Boolean(store.selectedWallId);
        if (!hasSelection && scope === 'selected') scope = 'all';
        for (const button of document.querySelectorAll('#wallScope [data-scope]')) {
            button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
            if (button.dataset.scope === 'selected') button.disabled = !hasSelection;
        }
    }

    function relabel() {
        for (const label of document.querySelectorAll('.swatch-label[data-i18n]')) label.textContent = t(label.dataset.i18n);
    }

    store.on('finish walls selection', render);
    return { render, relabel };
}

/** Read an image file as a data URL no larger than MAX_TEXTURE_PX. */
async function downscale(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_TEXTURE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.9);
}
