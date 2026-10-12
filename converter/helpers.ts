import * as THREE from 'three';
import type { LysSupport, LysSupportSettings } from './types';

/**
 * The settings-selection rules the emit pass needs.
 *
 * What is left after the authored-graph rebuild: everything these replace —
 * parent inference, attachment projection, brace pairing, slice placement — is
 * either stated by the graph or answered by `knotPolicy`. An LYS payload offers
 * several settings blocks for the same endpoint and the block that applies is a
 * priority choice, so it lives here rather than being spelled out at each call.
 */

/**
 * The column height a grid/platform girder is drawn to, or null for an ordinary
 * support, whose `joinLength` is just the joint-collar default.
 */
export function gridColumnHeightMm(s: LysSupport): number | null {
  const node = s.gridNodeIndex;
  if (node === null || node === undefined) return null;
  const joinLength = s.settings?.base?.joinLength;
  if (!Number.isFinite(joinLength as number) || (joinLength as number) <= 5) return null;
  return joinLength as number;
}

/** Selects the most relevant tip settings block from available LYS variants. */
export function pickContactTipSettings(s: LysSupport): LysSupportSettings['tip'] | LysSupportSettings['baseTip'] | undefined {
  return s.settings?.tip ?? s.settings?.baseTip;
}

/** The block describing the end named, for a support that carries both. */
export function pickStickEndpointTipSettings(
  s: LysSupport,
  endpoint: 'base' | 'tip',
): LysSupportSettings['tip'] | LysSupportSettings['baseTip'] | undefined {
  if (endpoint === 'base') {
    return s.settings?.baseTip ?? s.settings?.tip;
  }
  return s.settings?.tip ?? s.settings?.baseTip;
}

/**
 * Chooses which endpoint should be treated as the contact tip based on proximity.
 */
export function inferLeafTipEndpoint(
  tipPoint: THREE.Vector3,
  basePoint: THREE.Vector3,
  sourceTipPoint: THREE.Vector3,
): 'base' | 'tip' {
  const distToBaseSq = tipPoint.distanceToSquared(basePoint);
  const distToTipSq = tipPoint.distanceToSquared(sourceTipPoint);
  return distToTipSq <= distToBaseSq ? 'tip' : 'base';
}

/**
 * Determines endpoint diameter with priority ordering from endpoint/body/base settings.
 */
export function pickLeafEndpointDiameter(
  s: LysSupport,
  endpoint: 'base' | 'tip',
  fallback: number,
): number {
  const endpointSettings = endpoint === 'tip' ? s.settings?.tip : s.settings?.baseTip;
  const pointDiameter = endpointSettings?.pointDiameter;
  if (Number.isFinite(pointDiameter as number) && (pointDiameter as number) > 0) {
    return pointDiameter as number;
  }

  const bodyDiameter = endpointSettings?.diameter;
  if (Number.isFinite(bodyDiameter as number) && (bodyDiameter as number) > 0) {
    return bodyDiameter as number;
  }

  if (endpoint === 'base') {
    const joinDiameter = s.settings?.base?.joinDiameter;
    if (Number.isFinite(joinDiameter as number) && (joinDiameter as number) > 0) {
      return joinDiameter as number;
    }
  }

  return fallback;
}
