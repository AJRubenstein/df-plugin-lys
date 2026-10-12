import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import type { DragonfruitImportFormat, Segment, Stick, Vec3 } from '@/supports/types';
import type { SupportSettings } from '@/supports/Settings';
import { quaternionFromGlobalEulerDegrees } from '@/utils/rotation';
import { createContactAssembly } from './contactAssembly';
import { pickStickEndpointTipSettings } from './helpers';
import type { LysData, LysObject } from './types';
import { classifySupportGraph, type ClassifyOptions, type SupportClass } from './graphClassify';
import { buildSupportGraph, emissionOrder, type LysNode } from './supportGraph';

/**
 * The emit pass: one walk of the graph in host-before-child order, each node
 * built once.
 *
 * Only the classes with no host are wired so far (twig, stick): they resolve
 * against no host geometry, so they can be checked against the acceptance
 * baselines before the host-resolving classes land. A class present in the graph
 * but not yet built is reported in `notYetWired` — never silently dropped.
 *
 * The hosted classes follow the same shape, with one addition: they must publish
 * the DragonFruit skeleton their children's knots land on, which is the frame
 * mismatch of REBUILD_SCOPE section 1. That is why the knot policy lands first.
 */

/** The per-object frame a node's authored coordinates are read in. */
export interface ObjectFrame {
  /** `transformObjectPoint`: scale, then rotation, then the object's lift. */
  transformPoint(v: Vec3): THREE.Vector3;
  /** `transformObjectNormal`: inverse scale, then rotation, renormalised. */
  transformNormal(v: Vec3): THREE.Vector3;
  /**
   * World offset between a converter contact point and the same point on the
   * raycast ghost mesh, whose inner mesh is offset by `-pivot` before the group's
   * scale and rotation. Used by the twig contact-normal raycast.
   */
  meshPivotShift: THREE.Vector3;
  mesh?: THREE.Mesh;
}

/**
 * The frame the current converter builds per object. The authored rotation is
 * used as-is: the file-type path strips Z before conversion, the snapshot harness
 * does not, and this pass must reproduce whichever payload it is handed.
 */
export function makeObjectFrame(object: LysObject | undefined, mesh?: THREE.Mesh): ObjectFrame {
  const pivot = (object?.formerCenter ?? object?.center ?? { x: 0, y: 0, z: 0 }) as Vec3;
  const pos = (object?.position ?? { x: 0, y: 0, z: 0 }) as Vec3;
  const scale = (object?.scale ?? { x: 1, y: 1, z: 1 }) as Vec3;
  const rot = (object?.rotation ?? { x: 0, y: 0, z: 0 }) as Vec3;
  const q = quaternionFromGlobalEulerDegrees(rot);
  const scratch = new THREE.Vector3();

  return {
    mesh,
    transformPoint(v: Vec3): THREE.Vector3 {
      scratch.set(v.x * scale.x, v.y * scale.y, v.z * scale.z).applyQuaternion(q);
      return new THREE.Vector3(scratch.x + pos.x, scratch.y + pos.y, scratch.z + pos.z);
    },
    transformNormal(v: Vec3): THREE.Vector3 {
      scratch.set(
        v.x * (Math.abs(scale.x) > 1e-8 ? 1 / scale.x : 0),
        v.y * (Math.abs(scale.y) > 1e-8 ? 1 / scale.y : 0),
        v.z * (Math.abs(scale.z) > 1e-8 ? 1 / scale.z : 0),
      ).applyQuaternion(q);
      if (scratch.lengthSq() > 1e-8) scratch.normalize();
      return scratch.clone();
    },
    meshPivotShift: new THREE.Vector3(pivot.x * scale.x, pivot.y * scale.y, pivot.z * scale.z).applyQuaternion(q),
  };
}

export interface EmitDiagnostics {
  /** Entities built, by class. */
  emitted: Record<string, number>;
  /** Classes present in the graph that this pass does not build yet. */
  notYetWired: string[];
  /** Nodes the emitter dropped, with the reason — the converter's warn-and-skip, kept explicit. */
  skipped: string[];
}

interface EmitState {
  format: DragonfruitImportFormat;
  settings: SupportSettings;
  objects: Record<string, LysObject>;
  frames: Map<string, ObjectFrame>;
  mesh?: THREE.Mesh;
  diagnostics: EmitDiagnostics;
}

/**
 * Which object a node belongs to: the tip-side object, then the base-side one,
 * then the scene's first object — the same order the current converter resolves
 * ownership in, minus its warning (the emitter reports through `skipped`).
 */
function ownerOf(state: EmitState, node: LysNode): string {
  const tip = node.objectIdTip;
  if (tip && state.objects[tip]) return tip;
  const base = node.objectIdBase;
  if (base && state.objects[base]) return base;
  const first = Object.keys(state.objects)[0];
  return first ?? 'unknown';
}

function frameFor(state: EmitState, owner: string): ObjectFrame {
  const cached = state.frames.get(owner);
  if (cached) return cached;
  const frame = makeObjectFrame(state.objects[owner], state.mesh);
  state.frames.set(owner, frame);
  return frame;
}

/**
 * A floating two-cone stick: one segment between the two socket joints, a cone
 * at each end. Ported from the current converter's stick path so the shaft
 * signature and joint positions the acceptance snapshot records are reproduced
 * by construction rather than re-derived.
 */
function emitStick(state: EmitState, node: LysNode): void {
  const owner = ownerOf(state, node);
  const frame = frameFor(state, owner);
  const baseWorld = frame.transformPoint(node.base);
  const tipWorld = frame.transformPoint(node.tip);
  const baseNormal = node.baseNormal ? frame.transformNormal(node.baseNormal) : null;
  const tipNormal = node.tipNormal ? frame.transformNormal(node.tipNormal) : null;

  if (!baseNormal || baseNormal.lengthSq() <= 1e-8 || !tipNormal || tipNormal.lengthSq() <= 1e-8) {
    state.diagnostics.skipped.push(`${node.id}: stick without a usable normal at the ${baseNormal ? 'tip' : 'base'} end`);
    return;
  }

  const baseEndpoint = pickStickEndpointTipSettings(node, 'base');
  const tipEndpoint = pickStickEndpointTipSettings(node, 'tip');
  const tipDefaults = state.settings.tip;

  const { socketJoint: socketJointA, contactCone: contactConeA } = createContactAssembly(
    node, baseWorld, { x: tipWorld.x, y: tipWorld.y, z: tipWorld.z },
    baseEndpoint, tipDefaults, frame.mesh, true, true, baseNormal, false,
  );
  const { socketJoint: socketJointB, contactCone: contactConeB } = createContactAssembly(
    node, tipWorld, { x: baseWorld.x, y: baseWorld.y, z: baseWorld.z },
    tipEndpoint, tipDefaults, frame.mesh, true, true, tipNormal, false,
  );

  const shaftDiameter = node.settings?.base?.joinDiameter
    || baseEndpoint?.diameter
    || tipEndpoint?.diameter
    || state.settings.shaft.diameterMm;

  const segment: Segment = {
    id: uuidv4(),
    type: 'straight',
    diameter: shaftDiameter,
    bottomJoint: socketJointA,
    topJoint: socketJointB,
  };
  const stick: Stick = { id: uuidv4(), modelId: owner, segments: [segment], contactConeA, contactConeB };
  state.format.sticks = [...state.format.sticks, stick];
  state.diagnostics.emitted.stick = (state.diagnostics.emitted.stick ?? 0) + 1;
}

const EMITTERS: Partial<Record<SupportClass, (state: EmitState, node: LysNode) => void>> = {
  stick: emitStick,
};

export function emitSupportGraph(
  data: LysData,
  settings: SupportSettings,
  mesh?: THREE.Mesh,
  classifyOptions?: ClassifyOptions,
): { format: DragonfruitImportFormat; diagnostics: EmitDiagnostics } {
  const graph = buildSupportGraph(data, { strict: false });
  const objects = (data?.objects?.present?.byId ?? {}) as Record<string, LysObject>;
  const firstObject = Object.keys(objects)[0];
  const pivot = (objects[firstObject]?.formerCenter ?? objects[firstObject]?.center ?? { x: 0, y: 0, z: 0 }) as Vec3;

  const format: DragonfruitImportFormat = {
    version: 1,
    meta: { source: 'lys_conversion', objectCenter: pivot, updatedAt: Date.now() },
    roots: [], trunks: [], branches: [], leaves: [], twigs: [], sticks: [], braces: [], knots: [], kickstands: [],
  };
  const diagnostics: EmitDiagnostics = { emitted: {}, notYetWired: [], skipped: [] };
  const state: EmitState = {
    format,
    settings,
    objects,
    frames: new Map(),
    mesh,
    diagnostics,
  };
  if (!firstObject) diagnostics.skipped.push('scene has no objects');

  const options: ClassifyOptions = classifyOptions ?? {
    stickVsTwigCutoffMm: settings.meshToMesh?.stickVsTwigCutoffMm ?? 5,
    defaultTipLengthMm: settings.tip.lengthMm,
  };
  const kindById = new Map<string, SupportClass>();
  const present = new Set<SupportClass>();
  for (const classification of classifySupportGraph(graph, options)) {
    kindById.set(classification.node.id, classification.kind);
    present.add(classification.kind);
  }

  for (const node of emissionOrder(graph)) {
    const kind = kindById.get(node.id);
    if (!kind) continue;
    const emit = EMITTERS[kind];
    if (!emit) continue;
    emit(state, node);
  }

  diagnostics.notYetWired = [...present].filter((kind) => !EMITTERS[kind]).sort();
  return { format, diagnostics };
}
