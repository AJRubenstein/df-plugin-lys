import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createDefaultSettings } from '@/supports/Settings/types';
import { emitSupportGraph } from './graphEmit';
import type { LysData, LysSupport } from './types';

const settings = createDefaultSettings();

const support = (over: Partial<LysSupport>): LysSupport => ({
  id: 'x',
  base: { x: 0, y: 0, z: 0 },
  tip: { x: 0, y: 0, z: 1 },
  ...over,
});

/** A floating two-contact support well above the plate. */
const floating = (over: Partial<LysSupport>): LysSupport => support({
  baseNormal: { x: 0, y: 0, z: 1 },
  tipNormal: { x: 0, y: 0, z: -1 },
  base: { x: 0, y: 0, z: 10 },
  tip: { x: 0, y: 0, z: 16 },
  ...over,
});

const sceneOf = (byId: Record<string, LysSupport>): LysData => ({
  supports: { present: { byId } },
  objects: { present: { byId: { o1: { id: 'o1', position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 } } } } },
});

describe('graphEmit — stick', () => {
  it('builds one stick with both contacts, and reports nothing unbuilt', () => {
    const { format, diagnostics } = emitSupportGraph(
      sceneOf({ s: floating({ id: 's', objectIdTip: 'o1' }) }),
      settings as never,
    );

    assert.equal(format.sticks.length, 1);
    assert.equal(format.sticks[0].contactConeA.pos.z, 10);
    assert.equal(format.sticks[0].contactConeB.pos.z, 16);
    assert.equal(format.sticks[0].modelId, 'o1');
    assert.deepEqual(diagnostics.notYetWired, []);
    assert.deepEqual(diagnostics.skipped, []);

    const segment = format.sticks[0].segments[0];
    assert.ok(segment.bottomJoint && segment.topJoint);
    assert.ok(segment.diameter > 0);
    assert.ok(segment.bottomJoint.diameter > segment.diameter * 0.9);
  });

  it('reads a shaft diameter from the authored join diameter first', () => {
    const { format } = emitSupportGraph(
      sceneOf({ s: floating({ id: 's', objectIdTip: 'o1', settings: { base: { joinDiameter: 3 } } }) }),
      settings as never,
    );

    assert.equal(format.sticks[0].segments[0].diameter, 3);
  });

  it('applies the object transform to both endpoints', () => {
    const data = sceneOf({ s: floating({ id: 's', objectIdTip: 'o1' }) });
    data.objects = { present: { byId: { o1: { id: 'o1', position: { x: 5, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 } } } } };

    const { format } = emitSupportGraph(data, settings as never);

    assert.equal(format.sticks[0].contactConeA.pos.x, 5);
    assert.equal(format.sticks[0].contactConeA.pos.z, 20);
  });

  it('drops a stick whose normal the transform collapses, naming it', () => {
    // The authored normal is usable (so this classifies as a stick), but the
    // object's zero Y scale collapses it during the transform — the guard's
    // real job, since a zero authored normal classifies as a trunk instead.
    const data = sceneOf({
      s: floating({ id: 's', objectIdTip: 'o1', tipNormal: { x: 0, y: 1, z: 0 } }),
    });
    data.objects = { present: { byId: { o1: { id: 'o1', position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 } } } } };

    const { format, diagnostics } = emitSupportGraph(data, settings as never);

    assert.equal(format.sticks.length, 0);
    assert.match(diagnostics.skipped.join(' '), /s: stick without a usable normal at the tip end/);
  });
});

describe('graphEmit — pending classes', () => {
  it('names a class present in the graph that the pass does not build yet', () => {
    // Both normals, floating, span 1mm: a twig, which this pass does not wire.
    const { format, diagnostics } = emitSupportGraph(
      sceneOf({ s: floating({ id: 's', objectIdTip: 'o1', tip: { x: 0, y: 0, z: 11 } }) }),
      settings as never,
    );

    assert.deepEqual(diagnostics.notYetWired, ['twig']);
    assert.equal(format.twigs.length, 0);
  });

  it('reports a scene with no objects rather than inventing an owner', () => {
    const { diagnostics } = emitSupportGraph({ supports: { present: { byId: { s: floating({ id: 's' }) } } } }, settings as never);

    assert.match(diagnostics.skipped.join(' '), /scene has no objects/);
  });
});
