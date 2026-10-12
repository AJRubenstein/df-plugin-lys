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

describe('graphEmit — twig', () => {
  it('builds a twig whose joints sit off the disk centres along the surface normal', () => {
    // Floating with a 1mm span: a twig. No mesh in this path, so each disk keeps
    // its authored normal (the raycast fallback).
    const { format, diagnostics } = emitSupportGraph(
      sceneOf({ s: floating({ id: 's', objectIdTip: 'o1', tip: { x: 0, y: 0, z: 11 } }) }),
      settings as never,
    );

    assert.equal(format.twigs.length, 1);
    assert.deepEqual(diagnostics.notYetWired, []);
    const twig = format.twigs[0];
    assert.equal(twig.contactDiskA.pos.z, 10);
    assert.equal(twig.contactDiskB.pos.z, 11);

    const segment = twig.segments[0];
    // Each joint is the disk centre pushed along that disk's surface normal.
    assert.ok(segment.bottomJoint);
    assert.ok(segment.topJoint);
    assert.notEqual(segment.bottomJoint.pos.z, twig.contactDiskA.pos.z);
    assert.equal(segment.bottomJoint.pos.x, twig.contactDiskA.pos.x);
    assert.ok(segment.bottomJoint.diameter > 0);
  });

  it('sizes a twig joint by the multiplicative taper rule, not the additive one', () => {
    const { format } = emitSupportGraph(
      sceneOf({
        s: floating({ id: 's', objectIdTip: 'o1', tip: { x: 0, y: 0, z: 11 }, settings: { tip: { pointDiameter: 2 }, baseTip: { pointDiameter: 2 } } }),
      }),
      settings as never,
    );

    const segment = format.twigs[0].segments[0];
    assert.ok(Math.abs((segment.bottomJoint?.diameter ?? 0) - 2 * 1.1) < 1e-9);
    assert.ok(Math.abs((segment.topJoint?.diameter ?? 0) - 2 * 1.1) < 1e-9);
    assert.equal(segment.diameter, 2);
  });

  it('clears the joint radius when it offsets a joint off its disk', () => {
    const { format } = emitSupportGraph(
      sceneOf({ s: floating({ id: 's', objectIdTip: 'o1', tip: { x: 0, y: 0, z: 11 } }) }),
      settings as never,
    );

    const twig = format.twigs[0];
    const jointRadius = (twig.segments[0].bottomJoint?.diameter ?? 0) / 2;
    assert.ok((twig.contactDiskA.diskLengthOverride ?? 0) >= jointRadius + 0.05 - 1e-9);
  });
});

describe('graphEmit — trunk', () => {
  const grounded = (over: Partial<LysSupport>): LysSupport => support({
    base: { x: 2, y: 3, z: 0.1 },
    tip: { x: 0, y: 0, z: 30 },
    ...over,
  });

  it('builds a root and a trunk whose collar clears the root geometry', () => {
    const { format, diagnostics } = emitSupportGraph(
      sceneOf({ s: grounded({ id: 's', objectIdTip: 'o1' }) }),
      settings as never,
    );

    assert.equal(format.trunks.length, 1);
    assert.equal(format.roots.length, 1);
    assert.deepEqual(diagnostics.notYetWired, []);

    const trunk = format.trunks[0];
    assert.equal(trunk.rootId, format.roots[0].id);
    assert.equal(trunk.segments.length, 2);
    // The first segment runs from the root collar, so it has no bottom joint.
    assert.equal(trunk.segments[0].bottomJoint, undefined);
    const collar = trunk.segments[0].topJoint;
    assert.ok(collar);
    assert.equal(collar.pos.z, settings.roots.diskHeightMm + settings.roots.coneHeightMm + 0.05);
    assert.equal(trunk.segments[1].bottomJoint?.id, collar.id);
    assert.ok(trunk.segments[1].topJoint);
  });

  it('carries the object position into the root, which is not put through the object transform', () => {
    const data = sceneOf({ s: grounded({ id: 's', objectIdTip: 'o1' }) });
    data.objects = { present: { byId: { o1: { id: 'o1', position: { x: 10, y: 20, z: 5 }, scale: { x: 2, y: 2, z: 2 }, rotation: { x: 0, y: 0, z: 90 }, center: { x: 0, y: 0, z: 0 } } } } };

    const { format } = emitSupportGraph(data, settings as never);

    // Scale and rotation must NOT touch the root: only the object's own XY moves it.
    assert.deepEqual(format.roots[0].transform.pos, { x: 12, y: 23, z: 0 });
  });

  it('takes the collar height from the authored join length when it exceeds the minima', () => {
    const { format } = emitSupportGraph(
      sceneOf({ s: grounded({ id: 's', objectIdTip: 'o1', settings: { base: { joinLength: 50 } } }) }),
      settings as never,
    );

    assert.equal(format.trunks[0].segments[0].topJoint?.pos.z, 50);
  });

  it('sizes the collar joint from the pillar, and the pillar from the join diameter', () => {
    const { format } = emitSupportGraph(
      sceneOf({ s: grounded({ id: 's', objectIdTip: 'o1', settings: { base: { joinDiameter: 2 } } }) }),
      settings as never,
    );

    const trunk = format.trunks[0];
    assert.equal(trunk.segments[0].diameter, 2);
    assert.equal(trunk.segments[0].topJoint?.diameter, 2.1);
    assert.equal(trunk.contactCone.profile.bodyDiameterMm, 2);
  });
});

describe('graphEmit — pending classes', () => {
  it('names a class present in the graph that the pass does not build yet', () => {
    // A member spanning two hosts: a brace, which is still pending.
    const { format, diagnostics } = emitSupportGraph(
      sceneOf({
        hostA: support({ id: 'hostA', objectIdTip: 'o1', base: { x: 0, y: 0, z: 0.1 }, tip: { x: 0, y: 0, z: 30 } }),
        hostB: support({ id: 'hostB', objectIdTip: 'o1', base: { x: 10, y: 0, z: 0.1 }, tip: { x: 10, y: 0, z: 30 } }),
        span: support({ id: 'span', objectIdTip: 'o1', parentBaseId: 'hostA', parentTipId: 'hostB', base: { x: 0, y: 0, z: 10 }, tip: { x: 10, y: 0, z: 10 } }),
      }),
      settings as never,
    );

    assert.deepEqual(diagnostics.notYetWired, ['brace']);
    assert.equal(format.braces.length, 0);
    // Both hosts are still emitted, so the pending class does not take them with it.
    assert.equal(format.trunks.length, 2);
  });

  it('reports a scene with no objects rather than inventing an owner', () => {
    const { diagnostics } = emitSupportGraph({ supports: { present: { byId: { s: floating({ id: 's' }) } } } }, settings as never);

    assert.match(diagnostics.skipped.join(' '), /scene has no objects/);
  });
});
