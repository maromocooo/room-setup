import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messages, resolveLanguage, translate } from '../src/core/i18n.js';
import { FLOOR_PRESETS, WALL_PRESETS } from '../src/core/textures.js';
import { DOOR_COLORS, OPENING_PRESETS, STYLES } from '../src/core/openings.js';
import { KELVIN_MARKS, LIGHT_PRESETS, TIMES_OF_DAY } from '../src/core/lights.js';

test('both locales define exactly the same keys', () => {
    const ja = Object.keys(messages.ja).sort();
    const en = Object.keys(messages.en).sort();
    assert.deepEqual(ja.filter(k => !en.includes(k)), [], 'missing in en');
    assert.deepEqual(en.filter(k => !ja.includes(k)), [], 'missing in ja');
});

test('every key referenced from markup and presets exists', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(m => m[1]);
    keys.push(...[...FLOOR_PRESETS, ...WALL_PRESETS].map(p => `finish.preset.${p.id}`));
    for (const engine of ['hunyuan3d', 'trellis2', 'trellis', 'pixal3d', 'sam3d', 'mock']) keys.push(`engine.desc.${engine}`);
    keys.push(...OPENING_PRESETS.map(p => `opening.preset.${p.id}`), ...DOOR_COLORS.map(c => `opening.color.${c.id}`));
    keys.push(...LIGHT_PRESETS.map(p => `light.preset.${p.id}`), ...KELVIN_MARKS.map(m => `light.kelvin.${m.id}`), ...TIMES_OF_DAY.map(t => `time.${t}`));
    for (const [kind, styles] of Object.entries(STYLES)) keys.push(`opening.kind.${kind}`, ...styles.map(s => `opening.style.${kind}.${s}`));
    assert.deepEqual(keys.filter(k => !(k in messages.en)), []);
});

test('placeholders match between locales', () => {
    const names = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
    for (const key of Object.keys(messages.en)) assert.equal(names(messages.ja[key]), names(messages.en[key]), key);
});

test('language resolution and interpolation', () => {
    assert.equal(resolveLanguage(null, 'ja-JP'), 'ja');
    assert.equal(resolveLanguage(null, 'fr-FR'), 'en');
    assert.equal(resolveLanguage('en', 'ja-JP'), 'en');
    assert.equal(translate('en', 'wall.item', { number: 3 }), 'Wall 3');
    assert.equal(translate('ja', 'no.such.key'), 'no.such.key');
});
