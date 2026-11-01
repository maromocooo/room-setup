import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanProjectName, nameFromFile } from '../src/project/file-name.js';

test('a typed name becomes a safe file name', () => {
    assert.equal(cleanProjectName('  my room  '), 'my room');
    assert.equal(cleanProjectName('my room.ZIP'), 'my room');
    assert.equal(cleanProjectName('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
    assert.equal(cleanProjectName('../secret'), '-secret');
    assert.equal(cleanProjectName('リビング案1'), 'リビング案1');
    assert.equal(cleanProjectName('x'.repeat(300)).length, 120);
});

test('nothing usable leaves an empty name', () => {
    for (const text of ['', '   ', '.zip', '...']) assert.equal(cleanProjectName(text), '');
});

test('an opened file gives its name without the download counter', () => {
    assert.equal(nameFromFile('room-project(11).zip'), 'room-project');
    assert.equal(nameFromFile('room-project (2).zip'), 'room-project');
    assert.equal(nameFromFile('リビング案（3）.zip'), 'リビング案');
    assert.equal(nameFromFile('plan2.zip'), 'plan2');
    assert.equal(nameFromFile('.zip'), 'room-project');
});
