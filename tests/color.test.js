import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsv, hsvToHex, parseHex } from '../src/core/color.js';

test('colours survive a round trip', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#d8d0c2', '#3f5566', '#8c4a3c']) {
        const { h, s, v } = hexToHsv(hex);
        assert.equal(hsvToHex(h, s, v), hex);
    }
});

test('known values', () => {
    assert.equal(hsvToHex(0, 1, 1), '#ff0000');
    assert.equal(hsvToHex(120, 1, 1), '#00ff00');
    assert.equal(hsvToHex(240, 1, 0.5), '#000080');
    assert.equal(hsvToHex(360, 1, 1), '#ff0000');
    assert.deepEqual(hexToHsv('#ff0000'), { h: 0, s: 1, v: 1 });
});

test('grey keeps the hue you were on', () => {
    assert.equal(hexToHsv('#808080', 210).h, 210);
    assert.equal(hexToHsv('#000000', 42).h, 42);
    assert.equal(hexToHsv('#ffffff', 42).h, 42);
});

test('hex text is read leniently and refused when it is not a colour', () => {
    assert.equal(parseHex('#ABCDEF'), '#abcdef');
    assert.equal(parseHex(' abcdef '), '#abcdef');
    assert.equal(parseHex('#abc'), '#aabbcc');
    for (const bad of ['', '#12', '#12345', 'red', '#ggghhh']) assert.equal(parseHex(bad), null);
});
