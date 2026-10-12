/**
 * Dumps a stable, id-independent summary of a converted .lys file so a
 * conversion change can be diffed before/after. Ids are excluded because they
 * are regenerated every run; geometry and topology are what must match.
 *
 * Usage: node --import tsx plugins/lys-import/tools/snapshotLys.ts <file.lys> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { LysParser } from '../LysParser';
import { emitSupportGraph } from '../converter/graphEmit';
import { createDefaultSettings } from '@/supports/Settings';

const q = (n: number | undefined) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : null);
const qp = (p: { x: number; y: number; z: number } | undefined) =>
  p ? `${q(p.x)},${q(p.y)},${q(p.z)}` : null;

async function main() {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) throw new Error('usage: snapshotLys.ts <file.lys> <out.json>');

  const buf = readFileSync(inPath);
  const data: any = await LysParser.parse(new File([new Uint8Array(buf)], 'input.lys'));

  const warnings: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); };
  let out: any;
  try {
    out = emitSupportGraph(data.sceneData, createDefaultSettings() as any).format;
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }

  const knotById = new Map<string, any>((out.knots ?? []).map((k: any) => [k.id, k]));

  // Shaft ids are generated per run, so name a segment by its own geometry.
  const shaftSig = new Map<string, string>();
  const addShafts = (entities: any[], kind: string) => {
    for (const e of entities ?? []) {
      for (const seg of e.segments ?? []) {
        shaftSig.set(seg.id, `${kind}[${qp(seg.bottomJoint?.pos)}->${qp(seg.topJoint?.pos)}]`);
      }
    }
  };
  addShafts(out.trunks, 'trunk');
  addShafts(out.branches, 'branch');
  addShafts(out.twigs, 'twig');
  addShafts(out.sticks, 'stick');
  for (const kb of out.kickstands ?? []) addShafts([kb.kickstand], 'kickstand');

  // Describe a knot by what it IS, not by its id.
  const knotSig = (id: string | undefined) => {
    if (!id) return null;
    const k = knotById.get(id);
    if (!k) return `DANGLING`;
    const shaft = shaftSig.get(k.parentShaftId) ?? `UNRESOLVED-SHAFT`;
    return `${shaft}@${q(k.t)}|${qp(k.pos)}|d=${q(k.diameter)}`;
  };

  // Braces keyed by their endpoint signatures — the thing that must not change.
  const braces = (out.braces ?? [])
    .map((b: any) => `${knotSig(b.startKnotId)} <-> ${knotSig(b.endKnotId)} | d=${q(b.profile?.diameter)}`)
    .sort();

  const knotSites = new Map<string, number>();
  for (const k of out.knots ?? []) {
    const key = `${shaftSig.get(k.parentShaftId) ?? 'UNRESOLVED'}|${qp(k.pos)}|d=${q(k.diameter)}`;
    knotSites.set(key, (knotSites.get(key) ?? 0) + 1);
  }

  const referenced = new Set<string>();
  for (const b of out.braces ?? []) { if (b.startKnotId) referenced.add(b.startKnotId); if (b.endKnotId) referenced.add(b.endKnotId); }
  for (const b of out.branches ?? []) if (b.parentKnotId) referenced.add(b.parentKnotId);
  for (const l of out.leaves ?? []) if (l.parentKnotId) referenced.add(l.parentKnotId);
  for (const k of out.kickstands ?? []) if (k.hostKnot?.id) referenced.add(k.hostKnot.id);

  const snapshot = {
    counts: {
      roots: out.roots?.length ?? 0,
      trunks: out.trunks?.length ?? 0,
      branches: out.branches?.length ?? 0,
      leaves: out.leaves?.length ?? 0,
      twigs: out.twigs?.length ?? 0,
      sticks: out.sticks?.length ?? 0,
      braces: out.braces?.length ?? 0,
      kickstands: out.kickstands?.length ?? 0,
      knots: out.knots?.length ?? 0,
    },
    knotIntegrity: {
      distinctSites: knotSites.size,
      duplicateKnots: [...knotSites.values()].reduce((a, b) => a + b - 1, 0),
      danglingReferences: [...referenced].filter((id) => !knotById.has(id)).length,
      orphanKnots: (out.knots ?? []).filter((k: any) => !referenced.has(k.id)).length,
    },
    warnings: warnings.map((w) => w.replace(/[0-9a-f-]{36}/g, '<id>')).sort(),
    braces,
  };

  writeFileSync(outPath, JSON.stringify(snapshot, null, 1));
  console.log(`wrote ${outPath}`);
  console.log('counts:', JSON.stringify(snapshot.counts));
  console.log('knot integrity:', JSON.stringify(snapshot.knotIntegrity));
}

main();
