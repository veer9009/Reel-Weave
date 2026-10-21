import { expect, it } from 'vitest';
import {
  createFullProjectDocumentFixture,
  createProjectDocumentFixture,
} from '../test/projectFileFixtures';
import { prepareRelinkedProject, serializeProjectCapture } from './projectFile';
import type { AcceptedRelink } from './projectFile';
import {
  buildAdvancedMergeRequest,
  buildV3MergeRequest,
  requiresV3,
} from './advancedManifest';
import { materializeSnapshot } from './historyProjection';
import { buildAdvancedTimeline } from './advancedTimeline';
import type { ProjectDocument } from './projectFileTypes';
import type { PreparedProject } from './projectContext';
import type { LocalMediaMetadata, ProjectMediaVerifier } from './projectMedia';
import type { OverlayState } from './overlays';
const limits = { max_clips: 20, max_file_size_mb: 200 };
const verifier: ProjectMediaVerifier = {
  async fingerprint() {
    return {
      ok: true,
      value: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    };
  },
  async inspect() {
    return { ok: true, value: { mediaType: 'image', width: 32, height: 32 } };
  },
  dispose() {},
};
function prepare(document: ProjectDocument, prefix: string) {
  const matches = new Map<string, AcceptedRelink>();
  let serial = 0;
  for (const source of document.sources) {
    const file = new File(['abc'], source.originalName, {
      type: source.mimeType,
      lastModified: 0,
    });
    const metadata: LocalMediaMetadata =
      source.mediaType === 'image'
        ? {
            mediaType: 'image',
            width: source.metadata.width,
            height: source.metadata.height,
          }
        : source.mediaType === 'audio'
          ? {
              mediaType: 'audio',
              durationSeconds: source.metadata.durationSeconds,
            }
          : {
              mediaType: 'video',
              durationSeconds: source.metadata.durationSeconds,
              width: source.metadata.width ?? 320,
              height: source.metadata.height ?? 180,
            };
    matches.set(source.id, {
      sourceId: source.id,
      evidence: { file, metadata, sha256: source.sha256 },
      renamedConfirmed: false,
    });
  }
  const result = prepareRelinkedProject(
    document,
    matches,
    limits,
    () => `${prefix}_${++serial}`,
  );
  if (!result.ok) throw new Error(result.issue.message);
  return result.value;
}
function overlays(p: PreparedProject): OverlayState {
  const image = p.envelope.projectContext.imageOverlay;
  const r = image ? p.sources.get(image.sourceId)! : null;
  return {
    video: materializeSnapshot(p.envelope, p.sources).pip,
    image:
      image && r
        ? {
            ...image,
            kind: 'image',
            file: r.file,
            url: p.sources.ensureUrl(image.sourceId),
            metadataStatus: 'ready',
          }
        : null,
  };
}
function identities(p: PreparedProject): Map<string, string> {
  const ids = new Map<string, string>();
  const e = p.envelope;
  for (const lane of ['video1', 'video2', 'music', 'independentAudio'] as const)
    e[lane].forEach((v, i) => ids.set(v.id, `${lane}:${i}`));
  const add = (sourceId: string) =>
    ids.set(sourceId, `source:${p.sources.get(sourceId)!.file.name}`);
  e.independentAudio.forEach((v, i) => {
    if (v.detachedFrom && !ids.has(v.detachedFrom.clipId))
      ids.set(v.detachedFrom.clipId, `historical:${v.detachedFrom.track}:${i}`);
  });
  [...e.video1, ...e.video2, ...e.music].forEach((v) => add(v.sourceId));
  e.independentAudio.forEach((v) => add(v.source.sourceId));
  return ids;
}
function normalized(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => normalized(v, ids));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalized(v, ids)]),
    );
  return value;
}
it.each([false, true])(
  'unchanged manifest builders produce identical decisions after full relinking, V3=%s',
  async (advanced) => {
    const document = advanced
      ? createFullProjectDocumentFixture()
      : createProjectDocumentFixture();
    const before = prepare(document, 'before');
    const captured = new Map(
      document.sources.map((_source, i) => {
        const key = `before_${i + 1}`;
        const r = before.sources.get(key)!;
        return [key, r] as const;
      }),
    );
    const saved = await serializeProjectCapture(
      { envelope: before.envelope, sources: captured, capturedAt: new Date() },
      verifier,
      limits,
      new AbortController().signal,
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.issue.message);
    expect(saved.value.sources).toHaveLength(document.sources.length);
    expect(saved.value.edit.video1.map((v) => v.speed)).toEqual(
      advanced ? [1, 0.5] : [1],
    );
    const after = prepare(saved.value, 'after');
    const a = advanced
      ? buildV3MergeRequest(
          before.envelope,
          before.sources,
          30,
          overlays(before),
          document.exportSettings.formats,
          limits,
        )
      : buildAdvancedMergeRequest(
          before.envelope,
          before.sources,
          30,
          overlays(before),
        );
    const b = advanced
      ? buildV3MergeRequest(
          after.envelope,
          after.sources,
          30,
          overlays(after),
          document.exportSettings.formats,
          limits,
        )
      : buildAdvancedMergeRequest(
          after.envelope,
          after.sources,
          30,
          overlays(after),
        );
    expect(normalized(b.manifest, identities(after))).toEqual(
      normalized(a.manifest, identities(before)),
    );
    expect(b.videoFiles.map((f) => [f.name, f.size])).toEqual(
      a.videoFiles.map((f) => [f.name, f.size]),
    );
    expect(requiresV3(after.envelope, document.exportSettings.formats)).toBe(
      advanced,
    );
    const timeline = buildAdvancedTimeline(
      after.envelope,
      after.sources,
      overlays(after),
    );
    expect(timeline.base.totalFrames).toBe(advanced ? 90 : 60);
    expect(timeline.renderErrors).toEqual([]);
    if (advanced) {
      expect(saved.value.edit.independentAudio[0].sourceStartSample).toBe(9600);
      expect(saved.value.imageOverlay?.endFrame).toBe(39);
      expect(saved.value.edit.music).toHaveLength(2);
    }
    before.dispose();
    after.dispose();
  },
);
