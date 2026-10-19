// "Doors & windows" card on the Room tab: preset picker and the inspector
// for the selected opening.

import { DEFAULT_DOOR_COLOR, DEFAULT_DOOR_OPEN, DOOR_COLORS, OPENING_PRESETS, STYLES } from '../core/openings.js';
import { t } from '../core/i18n.js';

// Small plan-symbol previews for the preset buttons (64×40 viewBox).
const PREVIEWS = {
    hinged: '<path d="M8 32h48M14 32V8"/><path d="M14 8a24 24 0 0 1 24 24" stroke-dasharray="3 3"/>',
    double: '<path d="M8 32h48M12 32V14M52 32V14"/><path d="M12 14a20 20 0 0 1 20 18M52 14a20 20 0 0 0-20 18" stroke-dasharray="3 3"/>',
    sliding: '<path d="M8 32h48M12 26h24M28 20h24"/>',
    opening: '<path d="M8 32h12M44 32h12M20 26v12M44 26v12"/>',
    'window-sliding': '<rect x="8" y="10" width="48" height="22" rx="1"/><path d="M32 10v22M8 21h24" stroke-opacity=".35"/>',
    'window-patio': '<rect x="10" y="4" width="44" height="32" rx="1"/><path d="M32 4v32"/>',
    'window-tall': '<rect x="10" y="3" width="44" height="29" rx="1"/><path d="M32 3v29M6 37h52" /><path d="M6 37h52" stroke-opacity=".35"/>',
    'window-fixed': '<rect x="16" y="8" width="32" height="24" rx="1"/>',
    'window-casement': '<rect x="22" y="6" width="20" height="28" rx="1"/><path d="M38 18v4"/>',
    'window-high': '<rect x="10" y="8" width="44" height="8" rx="1"/><path d="M6 36h52" stroke-opacity=".35"/>',
};

export function setupOpeningsPanel({ store, plan, onArm }) {
    const $ = id => document.getElementById(id);
    const presets = $('openingPresets');

    for (const preset of OPENING_PRESETS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'template opening-preset';
        button.dataset.preset = preset.id;
        const art = PREVIEWS[preset.kind === 'door' ? preset.style : preset.id];
        button.innerHTML = `<svg viewBox="0 0 64 40" aria-hidden="true">${art}</svg><span></span><small></small>`;
        button.addEventListener('click', () => {
            const armed = plan.tool === 'opening' && plan.openingPreset === preset;
            onArm(armed ? null : preset);
        });
        presets.appendChild(button);
    }

    const chips = $('openingColors');
    for (const finish of DOOR_COLORS) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'color-chip';
        chip.dataset.color = finish.id;
        chip.setAttribute('role', 'radio');
        const [r, g, b] = finish.color;
        const shade = c => Math.max(0, c - 28);
        chip.style.background = finish.grain
            ? `repeating-linear-gradient(90deg, rgb(${r} ${g} ${b}) 0 5px, rgb(${shade(r)} ${shade(g)} ${shade(b)}) 5px 6px, rgb(${r} ${g} ${b}) 6px 9px)`
            : `rgb(${r} ${g} ${b})`;
        chip.addEventListener('click', () => update({ color: finish.id }));
        chips.appendChild(chip);
    }

    const selected = () => store.getOpening(store.selectedOpeningId);
    const update = patch => { const o = selected(); if (o) store.updateOpening(o.id, patch); };
    const numeric = (id, apply) => $(id).addEventListener('change', () => {
        const value = Number($(id).value);
        if (Number.isFinite(value)) apply(value);
        render();
    });
    numeric('openingWidth', width => {
        // Keep the left edge where it was while resizing.
        const o = selected();
        if (o) update({ width, offset: o.offset - o.width / 2 + width / 2 });
    });
    numeric('openingHeight', height => update({ height }));
    numeric('openingSill', sill => update({ sill }));
    numeric('openingOffset', left => { const o = selected(); if (o) update({ offset: left + o.width / 2 }); });
    // One undo step per slider gesture, live updates while dragging.
    const openSlider = $('openingOpen');
    let recordOpen = true;
    openSlider.addEventListener('pointerdown', () => { recordOpen = true; });
    openSlider.addEventListener('keydown', () => { recordOpen = true; });
    openSlider.addEventListener('input', () => {
        const o = selected();
        if (!o) return;
        store.updateOpening(o.id, { open: Number(openSlider.value) }, { record: recordOpen });
        recordOpen = false;
    });
    $('openingStyle').addEventListener('change', () => update({ style: $('openingStyle').value }));
    $('openingFlipHinge').addEventListener('click', () => { const o = selected(); if (o) update({ hinge: o.hinge === 'end' ? 'start' : 'end' }); });
    $('openingFlipSide').addEventListener('click', () => { const o = selected(); if (o) update({ side: -(o.side || 1) }); });
    $('openingDelete').addEventListener('click', () => { const o = selected(); if (o) store.removeOpening(o.id); });
    $('openingClose').addEventListener('click', () => store.selectOpening(null));

    function render() {
        for (const button of presets.children) {
            const preset = OPENING_PRESETS.find(p => p.id === button.dataset.preset);
            button.querySelector('span').textContent = t(`opening.preset.${preset.id}`);
            button.querySelector('small').textContent = `${preset.width}×${preset.height}`;
            button.setAttribute('aria-pressed', String(plan.tool === 'opening' && plan.openingPreset === preset));
        }

        const opening = selected();
        const card = $('openingInspector');
        const appeared = card.hidden && opening;
        card.hidden = !opening;
        if (!opening) return;
        if (appeared) card.scrollIntoView({ block: 'nearest' });
        $('openingTitle').textContent = t(`opening.kind.${opening.kind}`);
        const style = $('openingStyle');
        style.replaceChildren(...STYLES[opening.kind].map(id => new Option(t(`opening.style.${opening.kind}.${id}`), id)));
        style.value = opening.style;
        const active = document.activeElement;
        const set = (id, value) => { if (active !== $(id)) $(id).value = Math.round(value); };
        set('openingWidth', opening.width);
        set('openingHeight', opening.height);
        set('openingSill', opening.sill);
        set('openingOffset', opening.offset - opening.width / 2);
        const isDoor = opening.kind === 'door';
        $('openingColorField').hidden = !isDoor;
        for (const chip of chips.children) {
            const label = t(`opening.color.${chip.dataset.color}`);
            chip.title = label;
            chip.setAttribute('aria-label', label);
            chip.setAttribute('aria-checked', String(chip.dataset.color === (opening.color ?? DEFAULT_DOOR_COLOR)));
        }
        $('openingSillField').hidden = isDoor;
        $('openingDoorControls').hidden = !isDoor || opening.style === 'opening';
        $('openingFlipHinge').hidden = opening.style !== 'hinged' && opening.style !== 'sliding';
        $('openingFlipHingeLabel').textContent = t(opening.style === 'sliding' ? 'opening.flipSlide' : 'opening.flipHinge');
        const open = opening.open ?? DEFAULT_DOOR_OPEN;
        $('openingOpenField').hidden = !isDoor || opening.style === 'opening';
        if (active !== openSlider) openSlider.value = open;
        $('openingOpenValue').textContent = `${Math.round(open)}%`;
    }

    store.on('openings selection walls room', render);
    return { render };
}
