import test from 'node:test';
import assert from 'node:assert/strict';
import earcut from 'earcut';
import { getFloorPolygon } from '../src/core/floor-outline.js';

const rectangle = [[0,0], [400,0], [400,300], [0,300]];
const lShape = [[0,0], [400,0], [400,100], [100,100], [100,300], [0,300]];
function wallsFor(points) {
    return points.map(([x,y],i) => ({start:{x,y},end:{x:points[(i+1)%points.length][0],y:points[(i+1)%points.length][1]}}));
}
function area(walls) {
    const polygon = getFloorPolygon(walls);
    if (!polygon) return 0;
    const indices = earcut(polygon.flatMap(p=>[p.x,p.z]));
    let sum = 0;
    for (let i=0;i<indices.length;i+=3) {
        const [a,b,c] = indices.slice(i,i+3).map(id=>polygon[id]);
        sum += Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))/2;
    }
    return sum;
}
function permutations(items) {
    return items.length ? items.flatMap((item,i)=>permutations(items.filter((_,j)=>j!==i)).map(rest=>[item,...rest])) : [[]];
}
test('rectangle has its full area for every drawing order and wall direction',()=>{
    for (const walls of permutations(wallsFor(rectangle))) {
        for (let mask=0;mask<16;mask++) {
            const variant=walls.map((w,i)=>mask&(1<<i)?{start:w.end,end:w.start}:w);
            assert.equal(area(variant),12);
            assert.equal(getFloorPolygon(variant).length,4);
        }
    }
});
test('concave rooms retain the notch with reversed and reordered walls',()=>{
    const walls=wallsFor(lShape);
    for (let offset=0;offset<walls.length;offset++) {
        for (let mask=0;mask<64;mask++) {
            const variant=[...walls.slice(offset),...walls.slice(0,offset)].reverse().map((w,i)=>mask&(1<<i)?{start:w.end,end:w.start}:w);
            assert.equal(area(variant),6);
        }
    }
});
test('partitions, duplicates and dangling walls do not remove floor',()=>{
    const walls=wallsFor(rectangle);
    assert.equal(area([...walls,walls[0],{start:rectanglePoint(0),end:rectanglePoint(2)},{start:rectanglePoint(1),end:{x:500,y:0}}]),12);
});
function rectanglePoint(i) { return {x:rectangle[i][0],y:rectangle[i][1]}; }
test('open outlines do not invent a triangular floor',()=>{
    assert.equal(getFloorPolygon(wallsFor(rectangle).slice(0,3)),null);
    assert.equal(getFloorPolygon([]),null);
});
test('minor floating-point endpoint noise is tolerated without mutating walls',()=>{
    const walls=wallsFor(rectangle);
    walls[1].start.x+=1e-7;
    const original=structuredClone(walls);
    assert.equal(area(walls),12);
    assert.deepEqual(walls,original);
});
