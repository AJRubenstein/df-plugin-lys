import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import type { Joint, Stump, Vec3 } from '@/supports/types';
import type { TipProfile } from '@/supports/Settings';
import { getFinalSocketPosition } from '@/supports/SupportPrimitives/ContactCone';
import type { LysSupport, LysTipSettings } from './types';
import { createContactAssembly } from './contactAssembly';

/**
 * The host's near-plate band: a contact below this claims `stump`, at or above
 * it claims `trunk` (supportTypeRegistry placementRule, ANCHOR_HEIGHT_THRESHOLD_MM).
 */
export const STUMP_TIP_HEIGHT_MAX_MM = 5.0;

// Mirrors src/supports/SupportTypes/Stump/stumpBuilder.ts so an imported stump
// matches a natively placed one.
const STUMP_ROOT_BASE_DIAMETER_MM = 2.0;
const STUMP_ROOT_TOP_DIAMETER_MM = 1.5;
const STUMP_ROOT_HEIGHT_MM = 1.0;
const STUMP_JOINT_DIAMETER_MM = 1.5;
const STUMP_DISK_HEIGHT_MM = 0.1;

/** Where the frustum's cap sits, which the joint rides and the cone must reach down to. */
const STUMP_JOINT_Z_MM = STUMP_DISK_HEIGHT_MM + STUMP_ROOT_HEIGHT_MM;

export interface StumpFromLysInput {
  s: LysSupport;
  objectId: string;
  tipWorld: THREE.Vector3;
  baseRefWorld: THREE.Vector3;
  tipSettings: LysTipSettings;
  tipDefaults: TipProfile;
  transformedTipNormal?: THREE.Vector3 | null;
  mesh?: THREE.Mesh;
  /**
   * The drop the importer applies after conversion. Joints and cones are
   * authored in pre-offset space and shifted by it later; the frustum root is
   * pinned to the plate and is not, so plate-space heights subtract it here.
   */
  plateDropZ: number;
}

/**
 * Builds a stump from a grounded LYS support whose contact sits in the host's
 * near-plate band, or null when the stub would be malformed.
 *
 * The frustum root is the stump's own lower end, so no `Roots` row is filed.
 * `segments` stays empty and the cone is stretched to span contact-to-joint,
 * as the host builder does -- an export walks the segments, so a short cone
 * over an empty list would leave the contact floating above the frustum.
 *
 * Returning null is the import's equivalent of the host refusing to place one:
 * a contact at or under the frustum cap cannot carry a stump, and the caller
 * keeps it as a trunk rather than emitting an inverted stub.
 */
export function buildStumpFromLysSupport(input: StumpFromLysInput): Stump | null {
  const {
    s, objectId, tipWorld, baseRefWorld, tipSettings, tipDefaults,
    transformedTipNormal, mesh, plateDropZ,
  } = input;

  // Pre-offset Z of the frustum cap, so the importer's drop lands it there.
  const jointZ = STUMP_JOINT_Z_MM - plateDropZ;

  // A contact level with or below the frustum cap leaves no room for the stub.
  if (tipWorld.z <= jointZ + 1e-3) return null;

  const jointPos: Vec3 = { x: baseRefWorld.x, y: baseRefWorld.y, z: jointZ };

  const { contactCone } = createContactAssembly(
    s,
    tipWorld,
    jointPos,
    tipSettings,
    tipDefaults,
    mesh,
    true,
    true,
    transformedTipNormal,
    true,
    STUMP_JOINT_DIAMETER_MM,
  );

  // The cone body carries the run down to the joint, so it is sized off the
  // joint rather than the LYS tip diameter.
  contactCone.profile.bodyDiameterMm = STUMP_JOINT_DIAMETER_MM - 0.1;

  // Stretch the cone from its authored length down to the frustum cap along its
  // own axis, so the two meet. The disk offset is already folded into the
  // socket the host computes, so solve the length against that.
  const axis = contactCone.normal;
  if (axis.z >= -1e-6) return null; // not pointing down at the plate
  const socketAtAuthored = getFinalSocketPosition(contactCone);
  const dropNeeded = socketAtAuthored.z - jointZ;
  const coneLength = contactCone.profile.lengthMm + dropNeeded / -axis.z;
  if (!Number.isFinite(coneLength) || coneLength <= 0) return null;
  contactCone.profile.lengthMm = coneLength;

  const socketPos = getFinalSocketPosition(contactCone);
  // The stub must hang below its contact, never reach back up through it.
  if (socketPos.z > contactCone.pos.z + 1e-3) return null;

  const joint: Joint = {
    id: uuidv4(),
    pos: socketPos,
    diameter: STUMP_JOINT_DIAMETER_MM,
  };
  contactCone.socketJointId = joint.id;

  return {
    id: uuidv4(),
    modelId: objectId,
    rootPos: { x: socketPos.x, y: socketPos.y, z: 0 },
    rootBaseDiameter: STUMP_ROOT_BASE_DIAMETER_MM,
    rootTopDiameter: STUMP_ROOT_TOP_DIAMETER_MM,
    rootHeight: STUMP_ROOT_HEIGHT_MM,
    joint,
    segments: [],
    contactCone,
  };
}
