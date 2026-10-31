// A colour picker in the page. Browsers' own pickers may be separate dialogs that only
// report a colour once closed (Firefox on Linux does), and here the room must change
// while the colour is being chosen.

import { hexToHsv, hsvToHex, parseHex } from '../core/color.js';
import { t } from '../core/i18n.js';

/**
 * onChange(color, { record }): record is true for the first change of each gesture,
 * so one drag is one undo step.
 */
export function createColorPicker(host, { onChange }) {
    const element = (tag, className, parent = host) => {
        const node = document.createElement(tag);
        node.className = className;
        parent.appendChild(node);
        return node;
    };
    const area = element('div', 'picker-area');
    area.tabIndex = 0;
    area.setAttribute('role', 'slider');
    const thumb = element('span', 'picker-thumb', area);
    const hue = element('input', 'picker-hue');
    hue.type = 'range';
    hue.min = 0;
    hue.max = 360;
    const row = element('div', 'picker-row');
    const preview = element('span', 'picker-preview', row);
    const hex = element('input', 'picker-hex', row);
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;

    let hsv = { h: 0, s: 0, v: 1 };
    let color = '#ffffff';
    let record = true;

    function paint() {
        area.style.setProperty('--picker-hue', `hsl(${hsv.h} 100% 50%)`);
        thumb.style.left = `${hsv.s * 100}%`;
        thumb.style.top = `${(1 - hsv.v) * 100}%`;
        thumb.style.background = color;
        preview.style.background = color;
        hue.value = hsv.h;
        if (document.activeElement !== hex) hex.value = color;
        area.setAttribute('aria-label', t('curtain.color'));
        area.setAttribute('aria-valuetext', color);
        hue.setAttribute('aria-label', t('picker.hue'));
        hex.setAttribute('aria-label', t('picker.hex'));
    }

    function choose(next) {
        hsv = next;
        const chosen = hsvToHex(hsv.h, hsv.s, hsv.v);
        paint();
        if (chosen === color) return;
        color = chosen;
        paint();
        onChange(color, { record });
        record = false;
    }

    function fromPointer(event) {
        const box = area.getBoundingClientRect();
        const s = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
        const v = 1 - Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
        choose({ ...hsv, s, v });
    }

    let dragging = false;
    area.addEventListener('pointerdown', event => {
        record = true;
        dragging = true;
        area.setPointerCapture(event.pointerId);
        fromPointer(event);
    });
    area.addEventListener('pointermove', event => { if (dragging) fromPointer(event); });
    for (const type of ['pointerup', 'pointercancel']) area.addEventListener(type, () => { dragging = false; });
    area.addEventListener('keydown', event => {
        const steps = { ArrowLeft: ['s', -0.02], ArrowRight: ['s', 0.02], ArrowUp: ['v', 0.02], ArrowDown: ['v', -0.02] };
        const step = steps[event.key];
        if (!step) return;
        event.preventDefault();
        record = true;
        choose({ ...hsv, [step[0]]: Math.max(0, Math.min(1, hsv[step[0]] + step[1])) });
    });
    for (const type of ['pointerdown', 'keydown']) hue.addEventListener(type, () => { record = true; });
    hue.addEventListener('input', () => choose({ ...hsv, h: Number(hue.value) }));
    hex.addEventListener('input', () => {
        const parsed = parseHex(hex.value);
        if (!parsed || parsed === color) return;
        record = true;
        color = parsed;
        hsv = hexToHsv(parsed, hsv.h);
        paint();
        onChange(color, { record });
        record = false;
    });
    hex.addEventListener('blur', () => { hex.value = color; });

    return {
        /** Show a colour chosen elsewhere. While dragging, the picker already knows. */
        set(next) {
            if (next === color) { paint(); return; }
            color = next;
            hsv = hexToHsv(next, hsv.h);
            paint();
        },
    };
}
