import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { normalizeGeometryLookupKey, resolveObjectGeometryMatch } from './fileTypeHandlers';

function makeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  return g;
}

describe('normalizeGeometryLookupKey', () => {
  it('strips .bin extension and lowercases', () => {
    assert.strictEqual(normalizeGeometryLookupKey('o15.bin'), 'o15');
    assert.strictEqual(normalizeGeometryLookupKey('O15.BIN'), 'o15');
  });

  it('strips path components (forward slash)', () => {
    assert.strictEqual(normalizeGeometryLookupKey('models/o15.bin'), 'o15');
  });

  it('strips path components (backslash)', () => {
    assert.strictEqual(normalizeGeometryLookupKey('models\\o15.bin'), 'o15');
  });

  it('handles keys without .bin extension', () => {
    assert.strictEqual(normalizeGeometryLookupKey('9d7a614f'), '9d7a614f');
  });

  it('lowercases UUID-style hash keys', () => {
    assert.strictEqual(normalizeGeometryLookupKey('9D7A614F'), '9d7a614f');
  });

  it('returns empty string for empty input', () => {
    assert.strictEqual(normalizeGeometryLookupKey(''), '');
  });

  it('returns empty string for whitespace-only input', () => {
    assert.strictEqual(normalizeGeometryLookupKey('   '), '');
  });
});

describe('resolveObjectGeometryMatch - match priority', () => {
  it('matches via direct object-id key (priority 1)', () => {
    const geom = makeGeometry();
    const map = new Map([['o15', geom]]);
    const result = resolveObjectGeometryMatch('o15', {}, map);
    assert.strictEqual(result.matchSource, 'object-id');
    assert.strictEqual(result.geometry, geom);
    assert.strictEqual(result.matchKey, 'o15');
  });

  it('matches object-id key case-insensitively', () => {
    const geom = makeGeometry();
    const map = new Map([['o15', geom]]);
    const result = resolveObjectGeometryMatch('O15', {}, map);
    assert.strictEqual(result.matchSource, 'object-id');
  });

  it('matches via properties.hash for multi-model scenes (priority 2)', () => {
    const geom = makeGeometry();
    const hashKey = '9d7a614f';
    const map = new Map([[hashKey, geom]]);
    const obj = { properties: { hash: `${hashKey}.bin` } };
    const result = resolveObjectGeometryMatch('unknown-id', obj, map);
    assert.strictEqual(result.matchSource, 'properties-hash');
    assert.strictEqual(result.geometry, geom);
    assert.strictEqual(result.matchKey, hashKey);
  });

  it('properties.hash strips path components before lookup', () => {
    const geom = makeGeometry();
    const map = new Map([['abc', geom]]);
    const obj = { properties: { hash: 'models/abc.bin' } };
    const result = resolveObjectGeometryMatch('unknown', obj, map);
    assert.strictEqual(result.matchSource, 'properties-hash');
    assert.strictEqual(result.geometry, geom);
  });

  it('skips properties.hash when it does not match any geometry key', () => {
    const geom = makeGeometry();
    const map = new Map([['only-key', geom]]);
    const obj = { properties: { hash: 'nonexistent-hash.bin' } };
    const result = resolveObjectGeometryMatch('unknown', obj, map);
    assert.strictEqual(result.matchSource, 'single-shared-geometry-fallback');
  });

  it('ignores properties.hash when value is not a string', () => {
    const geom = makeGeometry();
    const map = new Map([['only-key', geom]]);
    const obj = { properties: { hash: 42 } };
    const result = resolveObjectGeometryMatch('unknown', obj as any, map);
    assert.strictEqual(result.matchSource, 'single-shared-geometry-fallback');
  });

  it('matches via object field candidate (priority 3)', () => {
    const geom = makeGeometry();
    const map = new Map([['abc', geom]]);
    const obj = { meshFile: 'abc.bin' };
    const result = resolveObjectGeometryMatch('unknown', obj, map);
    assert.strictEqual(result.matchSource, 'object-field-candidate');
    assert.strictEqual(result.geometry, geom);
  });

  it('falls back to single-shared-geometry when no direct, hash, or field match', () => {
    const geom = makeGeometry();
    const map = new Map([['unrelated-key', geom]]);
    const result = resolveObjectGeometryMatch('no-match', {}, map);
    assert.strictEqual(result.matchSource, 'single-shared-geometry-fallback');
    assert.strictEqual(result.geometry, geom);
  });

  it('returns null geometry and matchSource=none when map is empty', () => {
    const result = resolveObjectGeometryMatch('o15', {}, new Map());
    assert.strictEqual(result.matchSource, 'none');
    assert.strictEqual(result.geometry, null);
  });

  it('prioritizes object-id over properties.hash when both would match', () => {
    const directGeom = makeGeometry();
    const hashGeom = makeGeometry();
    const map = new Map([
      ['o15', directGeom],
      ['somehash', hashGeom],
    ]);
    const obj = { properties: { hash: 'somehash.bin' } };
    const result = resolveObjectGeometryMatch('o15', obj, map);
    assert.strictEqual(result.matchSource, 'object-id');
    assert.strictEqual(result.geometry, directGeom);
  });

  it('prefers non-hollowing geometry as single-geometry fallback', () => {
    const primaryGeom = makeGeometry();
    const hollowingGeom = makeGeometry();
    const map = new Map([
      ['abc', primaryGeom],
      ['abc_hollowing', hollowingGeom],
    ]);
    const result = resolveObjectGeometryMatch('no-match', {}, map);
    assert.strictEqual(result.matchSource, 'single-shared-geometry-fallback');
    assert.strictEqual(result.geometry, primaryGeom,
      'Single-geometry fallback should return the non-hollowing geometry when both variants are present');
  });
});
