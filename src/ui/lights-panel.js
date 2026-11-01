// "Lighting" tab: time of day, light presets, the selected light's settings
// and the list of placed lights.

import { FIXTURE_PRESETS, KELVIN_MARKS, TAPE_MAX_CM, TAPE_MIN_CM, clampTapeLength, findLightPreset, isTape, kelvinToRgb, lightHeight, normalizeDegrees } from '../core/lights.js';
import { t } from '../core/i18n.js';
import { icon } from './icons.js';

// Small previews for the preset buttons (64×40 viewBox).
const PREVIEWS = {
    ceiling: '<path d="M8 6h48"/><rect x="18" y="6" width="28" height="7" rx="3"/><path d="M24 20l-4 6M32 20v8M40 20l4 6" stroke-opacity=".5"/>',
    pendant: '<path d="M8 4h48M32 4v12"/><path d="M22 26l5-10h10l5 10z"/><path d="M27 31l-2 4M32 31v5M37 31l2 4" stroke-opacity=".5"/>',
    downlight: '<path d="M8 6h48"/><path d="M27 6h10"/><path d="M24 12l-8 22M40 12l8 22" stroke-opacity=".5"/>',
    spot: '<path d="M8 4h48M32 4v6"/><rect x="27" y="10" width="10" height="9" rx="2"/><path d="M28 21l-8 15M36 21l8 15" stroke-opacity=".5"/>',
    floor: '<path d="M24 8h16l4 10H20z"/><path d="M32 18v17M24 36h16"/>',
    table: '<path d="M25 12h14l3 9H22z"/><path d="M32 21v10M26 32h12M14 36h36"/>',
    tape: '<rect x="6" y="17" width="52" height="6" rx="2"/><path d="M14 20h.01M24 20h.01M34 20h.01M44 20h.01M54 20h.01" stroke-width="2.5" stroke-linecap="round"/><path d="M14 28v5M24 28v5M34 28v5M44 28v5M54 28v5" stroke-opacity=".5"/>',
};

export function setupLightsPanel({ store, plan, onArm }) {
    const $ = id => document.getElementById(id);
    const presets = $('lightPresets');

    for (const preset of FIXTURE_PRESETS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'template opening-preset';
        button.dataset.lightPreset = preset.id;
        button.innerHTML = `<svg viewBox="0 0 64 40" aria-hidden="true">${PREVIEWS[preset.id]}</svg><span></span><small></small>`;
        button.addEventListener('click', () => {
            const armed = plan.tool === 'light' && plan.lightPreset === preset;
            onArm(armed ? null : preset);
        });
        presets.appendChild(button);
    }

    for (const button of document.querySelectorAll('#timeOfDay [data-time]')) {
        button.addEventListener('click', () => store.setTimeOfDay(button.dataset.time));
    }
    $('timeOfDayQuick').addEventListener('change', e => store.setTimeOfDay(e.target.value));

    const selected = () => store.getLight(store.selectedLightId);
    const update = (patch, record = true) => { const l = selected(); if (l) store.updateLight(l.id, patch, { record }); };

    // Sliders: one undo step per gesture, live updates while dragging.
    for (const [id, key] of [['lightLumens', 'lumens'], ['lightKelvin', 'kelvin']]) {
        const input = $(id);
        let record = true;
        input.addEventListener('pointerdown', () => { record = true; });
        input.addEventListener('keydown', () => { record = true; });
        input.addEventListener('input', () => { update({ [key]: Number(input.value) }, record); record = false; });
    }
    $('lightOn').addEventListener('change', () => update({ on: $('lightOn').checked }));
    $('lightShadows').addEventListener('change', () => update({ shadows: $('lightShadows').checked }));
    // For lights in furniture the three fields are offsets from the item:
    // left/right, front/back and height above its base.
    const attachPatch = (light, key, value) => ({ attach: { ...light.attach, [key]: value } });
    $('lightX').addEventListener('change', () => {
        const light = selected();
        if (light) update(light.attach ? attachPatch(light, 'dx', Number($('lightX').value)) : { x: Number($('lightX').value) });
    });
    $('lightY').addEventListener('change', () => {
        const light = selected();
        if (light) update(light.attach ? attachPatch(light, 'dz', Number($('lightY').value)) : { y: Number($('lightY').value) });
    });
    $('lightHeight').addEventListener('change', () => {
        const light = selected();
        if (!light) return;
        const value = Math.max(0, Number($('lightHeight').value));
        if (light.attach) return update(attachPatch(light, 'dy', value));
        update(findLightPreset(light.preset).mount === 'ceiling' ? { drop: value } : { height: value });
    });
    $('lightLength').min = TAPE_MIN_CM;
    $('lightLength').max = TAPE_MAX_CM;
    $('lightLength').addEventListener('change', () => {
        const value = Number($('lightLength').value);
        if (value > 0) update({ length: clampTapeLength(value) });
        render();
    });
    $('lightRotation').addEventListener('change', () => {
        update({ rotation: normalizeDegrees(Number($('lightRotation').value) || 0) });
        render();
    });
    $('lightEmit').addEventListener('change', () => update({ emit: $('lightEmit').value }));
    $('lightDelete').addEventListener('click', () => { const l = selected(); if (l) store.removeLight(l.id); });
    $('lightClose').addEventListener('click', () => store.selectLight(null));

    $('lightList').addEventListener('click', event => {
        const row = event.target.closest('[data-light-id]');
        if (!row) return;
        if (event.target.closest('[data-action="toggle"]')) {
            const light = store.getLight(row.dataset.lightId);
            store.updateLight(light.id, { on: !light.on });
        } else {
            store.selectLight(store.selectedLightId === row.dataset.lightId ? null : row.dataset.lightId);
        }
    });

    const kelvinName = kelvin => {
        const mark = KELVIN_MARKS.reduce((a, b) => (Math.abs(b.kelvin - kelvin) < Math.abs(a.kelvin - kelvin) ? b : a));
        return t(`light.kelvin.${mark.id}`);
    };
    const swatch = kelvin => `rgb(${kelvinToRgb(kelvin).map(v => Math.round(v * 255)).join(' ')})`;

    const unit = ({ kind, preset }) => (kind === 'strip' || preset === 'tape' ? 'lm/m' : 'lm');

    function render() {
        for (const button of presets.children) {
            const preset = findLightPreset(button.dataset.lightPreset);
            button.querySelector('span').textContent = t(`light.preset.${preset.id}`);
            button.querySelector('small').textContent = `${preset.lumens} ${unit(preset)}`;
            button.setAttribute('aria-pressed', String(plan.tool === 'light' && plan.lightPreset === preset));
        }
        for (const button of document.querySelectorAll('#timeOfDay [data-time]')) {
            button.setAttribute('aria-pressed', String(button.dataset.time === store.timeOfDay));
        }
        $('timeOfDayQuick').value = store.timeOfDay;

        $('lightEmpty').hidden = store.lights.length > 0;
        $('lightList').replaceChildren(...store.lights.map((light, i) => {
            const row = document.createElement('li');
            row.className = 'list-row selectable';
            row.dataset.lightId = light.id;
            row.setAttribute('aria-selected', String(light.id === store.selectedLightId));
            row.innerHTML = `<span class="light-dot"></span><span class="list-title"></span><span class="list-meta"></span>
                <button type="button" class="icon-btn small" data-action="toggle">${icon(light.on ? 'sun' : 'moon')}</button>`;
            row.querySelector('.light-dot').style.background = light.on ? swatch(light.kelvin) : 'transparent';
            const host = light.attach && store.getFurniture(light.attach.furnitureId);
            row.querySelector('.list-title').textContent = host ? t('light.inItem', { name: host.name }) : `${t(`light.preset.${light.preset}`)} ${i + 1}`;
            row.querySelector('.list-meta').textContent = isTape(light)
                ? `${light.length / 100} m · ${light.lumens} lm/m · ${light.kelvin}K`
                : `${light.lumens} lm · ${light.kelvin}K`;
            row.querySelector('[data-action="toggle"]').title = t('light.on');
            return row;
        }));

        const light = selected();
        const card = $('lightInspector');
        const appeared = card.hidden && light;
        card.hidden = !light;
        if (!light) return;
        if (appeared) card.scrollIntoView({ block: 'nearest' });
        const preset = findLightPreset(light.preset);
        const active = document.activeElement;
        const set = (id, value) => { if (active !== $(id)) $(id).value = value; };
        const host = light.attach && store.getFurniture(light.attach.furnitureId);
        $('lightTitle').textContent = host ? t('light.inItem', { name: host.name }) : t(`light.preset.${light.preset}`);
        $('lightAttached').hidden = !light.attach;
        $('lightAttached').textContent = light.attach ? t(host ? 'light.attachedHint' : 'light.orphaned') : '';
        $('lightOn').checked = light.on;
        $('lightShadows').checked = light.shadows;
        set('lightLumens', light.lumens);
        set('lightKelvin', light.kelvin);
        $('lightLumensValue').textContent = `${light.lumens} ${unit(light)}`;
        const tape = isTape(light);
        $('lightTapeFields').hidden = !tape;
        $('lightShadowsRow').hidden = tape;
        if (tape) {
            set('lightLength', light.length);
            set('lightRotation', light.rotation ?? 0);
            $('lightEmit').value = light.emit ?? 'side';
            $('lightTapeHint').textContent = t('light.tapeHint', { total: Math.round((light.lumens * light.length) / 100) });
        }
        $('lightKelvinValue').textContent = `${light.kelvin}K ${kelvinName(light.kelvin)}`;
        $('lightKelvinValue').style.boxShadow = `inset 3px 0 0 ${swatch(light.kelvin)}`;
        const ceilingMounted = preset.mount === 'ceiling';
        $('lightXLabel').textContent = light.attach ? t('light.dx') : 'X';
        $('lightYLabel').textContent = light.attach ? t('light.dz') : 'Y';
        $('lightHeightLabel').textContent = t(ceilingMounted ? 'light.drop' : 'light.height');
        set('lightX', Math.round(light.attach ? light.attach.dx : light.x));
        set('lightY', Math.round(light.attach ? light.attach.dz : light.y));
        set('lightHeight', Math.round(ceilingMounted ? (light.drop ?? preset.drop) : lightHeight(light, store.ceilingHeight)));
    }

    store.on('lights lighting selection room furniture', render);
    return { render };
}
