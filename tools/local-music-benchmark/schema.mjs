import { z } from 'zod';

import { PINNED_ENGINE_COMMIT } from './config.mjs';
import { MAX_ADAPTER_OUTPUT_BYTES } from './limits.mjs';

const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const immutableOrUnavailableRevision = z.union([gitCommit, z.literal('not-installed')]);
const isoTimestamp = z.string().datetime({ offset: true });
const nullablePositiveNumber = z.number().positive().finite().nullable();
const nullablePositiveInteger = z.number().int().positive().nullable();
const canonicalDurationSeconds = z.union([
  z.literal(150),
  z.literal(180),
  z.literal(184),
]);
const canonicalBatchSize = z.union([z.literal(1), z.literal(2), z.literal(4)]);
export const CANDIDATE_DURATION_TOLERANCE_SECONDS = 1;

export function candidateDurationsWithinTolerance({
  measuredDurationSeconds,
  adapterDeclaredDurationSeconds,
  requestedDurationSeconds,
}) {
  return (
    [measuredDurationSeconds, adapterDeclaredDurationSeconds, requestedDurationSeconds]
      .every((value) => Number.isFinite(value) && value > 0) &&
    Math.abs(measuredDurationSeconds - requestedDurationSeconds) <=
      CANDIDATE_DURATION_TOLERANCE_SECONDS &&
    Math.abs(adapterDeclaredDurationSeconds - requestedDurationSeconds) <=
      CANDIDATE_DURATION_TOLERANCE_SECONDS &&
    Math.abs(adapterDeclaredDurationSeconds - measuredDurationSeconds) <=
      CANDIDATE_DURATION_TOLERANCE_SECONDS
  );
}
const safeRelativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !pathIsAbsolute(value) &&
      !value.split(/[\\/]/u).includes('..') &&
      !value.includes('\0'),
    { message: 'Expected a confined relative path.' },
  );

function pathIsAbsolute(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value);
}

export const pinnedPathSchema = z
  .object({
    path: z.string().min(1),
    realpath: z.string().min(1),
    sha256,
  })
  .strict();

const dynamicLinkerImagePinSchema = pinnedPathSchema
  .extend({
    device: z.string().regex(/^\d+$/u),
    inode: z.string().regex(/^\d+$/u),
  })
  .strict();

const dynamicLinkerDependencySchema = z
  .object({
    command: z.enum([
      'LC_LOAD_DYLIB',
      'LC_LOAD_WEAK_DYLIB',
      'LC_REEXPORT_DYLIB',
      'LC_LOAD_UPWARD_DYLIB',
      'LC_LAZY_LOAD_DYLIB',
      'LC_LOAD_DYLINKER',
    ]),
    installName: z.string().min(1),
    classification: z.enum(['system', 'pinned']),
    resolvedPath: z.string().min(1),
    resolvedRealpath: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((dependency, context) => {
    if (
      (dependency.classification === 'system' && dependency.resolvedRealpath !== null) ||
      (dependency.classification === 'pinned' && dependency.resolvedRealpath === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Dynamic-linker dependency classification must match its resolved identity.',
      });
    }
  });

export const executableClosureSchema = z
  .object({
    schemaVersion: z.literal('macho-closure-v1'),
    format: z.enum(['mach-o', 'not-mach-o']),
    platform: z.string().min(1),
    architecture: z.string().min(1),
    osBuild: z.string().min(1).nullable(),
    root: dynamicLinkerImagePinSchema,
    images: z.array(
      dynamicLinkerImagePinSchema
        .extend({
          sliceArchitecture: z.string().min(1),
          rpaths: z.array(z.string().min(1)),
          dependencies: z.array(dynamicLinkerDependencySchema),
        })
        .strict(),
    ),
    systemLoadPaths: z.array(z.string().min(1)),
    closureSha256: sha256,
  })
  .strict()
  .superRefine((closure, context) => {
    if (
      (closure.format === 'mach-o' && closure.images.length === 0) ||
      (closure.format === 'not-mach-o' && closure.images.length !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Dynamic-linker closure format must match its image set.',
      });
    }
  });

export const pinnedToolSchema = pinnedPathSchema
  .extend({
    version: z.string().min(1),
  })
  .strict();

const pinnedToolWithExecutableClosureSchema = pinnedToolSchema
  .extend({ dynamicLinker: executableClosureSchema.optional() })
  .strict();

const runtimeDirectoryPinSchema = pinnedPathSchema
  .extend({
    device: z.string().regex(/^\d+$/u),
    inode: z.string().regex(/^\d+$/u),
  })
  .strict();

const pythonRuntimeSchema = z
  .object({
    sourceLibrary: runtimeDirectoryPinSchema,
    snapshotLibrary: runtimeDirectoryPinSchema,
    virtualEnvironment: z
      .object({
        rootRealpath: z.string().min(1),
        device: z.string().regex(/^\d+$/u),
        inode: z.string().regex(/^\d+$/u),
        launcherPath: z.string().min(1),
        configuration: pinnedPathSchema,
        sitePackages: runtimeDirectoryPinSchema.nullable(),
        snapshotRootRealpath: z.string().min(1),
        snapshotConfiguration: pinnedPathSchema,
        snapshotSitePackages: runtimeDirectoryPinSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .nullable();

export const directoryIdentitySchema = z
  .object({
    realpath: z.string().min(1),
    device: z.string().regex(/^\d+$/u),
    inode: z.string().regex(/^\d+$/u),
    parent: z
      .object({
        realpath: z.string().min(1),
        device: z.string().regex(/^\d+$/u),
        inode: z.string().regex(/^\d+$/u),
      })
      .strict(),
  })
  .strict();

export const structuredErrorSchema = z
  .object({
    code: z.string().min(1),
    category: z.enum(['executor', 'measurement', 'allocation', 'interrupted', 'validation']),
    message: z.string().min(1),
    retryable: z.boolean(),
    allocationFailure: z.boolean(),
    detailsSha256: sha256.nullable(),
  })
  .strict()
  .superRefine((error, context) => {
    if (error.allocationFailure !== (error.category === 'allocation')) {
      context.addIssue({
        code: 'custom',
        path: ['allocationFailure'],
        message: 'Allocation category and allocationFailure must agree.',
      });
    }
    if (error.retryable !== (error.category === 'interrupted')) {
      context.addIssue({
        code: 'custom',
        path: ['retryable'],
        message: 'Only explicitly interrupted failures are retryable.',
      });
    }
  });

export const outputArtifactSchema = z
  .object({
    relativePath: safeRelativePath,
    sha256,
    bytes: z.number().int().nonnegative(),
    device: z.string().regex(/^\d+$/u),
    inode: z.string().regex(/^\d+$/u),
  })
  .strict();

export const candidateSchema = z
  .object({
    index: z.number().int().positive(),
    durationSeconds: z.number().positive().finite(),
    adapterDeclaredDurationSeconds: z.number().positive().finite(),
    wallTimeSeconds: z.number().positive().finite(),
    artifact: outputArtifactSchema,
  })
  .strict();

export const sidecarIdentitySchema = z
  .object({
    runId: z.string().regex(/^[a-f0-9]{64}$/u),
    configurationSha256: sha256,
    durationSeconds: canonicalDurationSeconds,
    batchSizeRequested: canonicalBatchSize,
    phase: z.enum(['warmup', 'repetition']),
    index: z.number().int().nonnegative(),
    attempt: z.number().int().positive(),
    commandSha256: sha256,
    requestSha256: sha256,
  })
  .strict();

export const executorResultSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    identity: sidecarIdentitySchema,
    status: z.enum(['success', 'failure']),
    metrics: z
      .object({
        peakMemoryBytes: nullablePositiveInteger,
        energyWh: nullablePositiveNumber,
      })
      .strict(),
    metricUnavailableReason: z
      .object({
        peakMemoryBytes: z.string().min(1).optional(),
        energyWh: z.string().min(1).optional(),
      })
      .strict(),
    candidates: z.array(
      z
        .object({
          index: z.number().int().positive(),
          durationSeconds: z.number().positive().finite(),
          wallTimeSeconds: z.number().positive().finite(),
          outputFile: safeRelativePath,
        })
        .strict(),
    ),
    error: structuredErrorSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    for (const [index, candidate] of result.candidates.entries()) {
      if (
        Math.abs(candidate.durationSeconds - result.identity.durationSeconds) >
        CANDIDATE_DURATION_TOLERANCE_SECONDS
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidates', index, 'durationSeconds'],
          message: 'Adapter-declared candidate duration must match the requested cell.',
        });
      }
    }
    for (const metric of ['peakMemoryBytes', 'energyWh']) {
      const hasValue = result.metrics[metric] !== null;
      const hasReason = typeof result.metricUnavailableReason[metric] === 'string';
      if (hasValue === hasReason) {
        context.addIssue({
          code: 'custom',
          path: ['metricUnavailableReason', metric],
          message: `${metric} requires exactly one of a measured value or an unavailable reason.`,
        });
      }
    }
    if (
      result.candidates.some((candidate, index) => candidate.index !== index + 1) ||
      result.candidates.length > result.identity.batchSizeRequested
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'Candidate indices must be contiguous from one and fit the requested batch.',
      });
    }
    if (new Set(result.candidates.map((candidate) => candidate.outputFile)).size !== result.candidates.length) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'Candidate output paths must be unique.',
      });
    }
    if (result.status === 'success') {
      const artifactPrefix = `cells/d${result.identity.durationSeconds}-b${result.identity.batchSizeRequested}/${result.identity.phase}-${result.identity.index}/attempt-${result.identity.attempt}/artifacts/`;
      if (
        result.error !== null ||
        result.candidates.length === 0 ||
        result.candidates.some(
          (candidate) => !candidate.outputFile.startsWith(artifactPrefix),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'A successful GenerationResult requires candidates and no error.',
        });
      }
    } else if (result.error === null || result.candidates.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'A failed GenerationResult requires a structured error and no candidates.',
      });
    }
  });

export const commandReceiptSchema = z
  .object({
    transport: z.literal('persistent-jsonl-v1'),
    command: z.array(z.string()).min(2),
    workingDirectory: z.string().min(1),
    environment: z.array(
      z
        .object({
          name: z.string().min(1),
          valueSha256: sha256,
        })
        .strict(),
    ),
    commandSha256: sha256,
    requestSha256: sha256.nullable(),
    executed: z.boolean(),
    startedAt: isoTimestamp.nullable(),
    finishedAt: isoTimestamp.nullable(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    stdoutSha256: sha256.nullable(),
    stderrSha256: sha256.nullable(),
    stdoutBytes: z.number().int().nonnegative().nullable(),
    stderrBytes: z.number().int().nonnegative().nullable(),
    sidecar: outputArtifactSchema.nullable(),
    previousAttemptReceiptSha256: sha256.nullable(),
    attemptReceiptSha256: sha256.nullable(),
  })
  .strict();

const metricUnavailableReasonSchema = z
  .object({
    wallTimeSeconds: z.string().min(1).nullable(),
    rtf: z.string().min(1).nullable(),
    peakMemoryBytes: z.string().min(1).nullable(),
    energyWh: z.string().min(1).nullable(),
    batchSizeEffective: z.string().min(1).nullable(),
    audioDurationSeconds: z.string().min(1).nullable(),
  })
  .strict();

const terminalCommandEvidenceSchema = z
  .object({
    executed: z.literal(true),
    startedAt: isoTimestamp,
    finishedAt: isoTimestamp,
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    stdoutSha256: sha256,
    stderrSha256: sha256,
    stdoutBytes: z.number().int().nonnegative(),
    stderrBytes: z.number().int().nonnegative(),
    sidecar: outputArtifactSchema.nullable(),
  })
  .strict();

const terminalResultEvidenceSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'interrupted']),
    wallTimeSeconds: nullablePositiveNumber,
    rtf: nullablePositiveNumber,
    peakMemoryBytes: nullablePositiveInteger,
    energyWh: nullablePositiveNumber,
    batchSizeRequested: z.number().int().positive(),
    batchSizeEffective: nullablePositiveInteger,
    audioDurationSeconds: nullablePositiveNumber,
    candidates: z.array(candidateSchema),
    error: structuredErrorSchema.nullable(),
    metricUnavailableReason: metricUnavailableReasonSchema,
  })
  .strict();

export const attemptReceiptSchema = z
  .object({
    attempt: z.number().int().positive(),
    requestSha256: sha256,
    previousAttemptReceiptSha256: sha256.nullable(),
    commandEvidence: terminalCommandEvidenceSchema,
    result: terminalResultEvidenceSchema,
    attemptReceiptSha256: sha256,
  })
  .strict();

export const executionRecordSchema = z
  .object({
    phase: z.enum(['warmup', 'repetition']),
    index: z.number().int().nonnegative(),
    attempt: z.number().int().nonnegative(),
    discarded: z.boolean(),
    status: z.enum(['planned', 'running', 'completed', 'failed', 'skipped', 'interrupted']),
    wallTimeSeconds: nullablePositiveNumber,
    rtf: nullablePositiveNumber,
    peakMemoryBytes: nullablePositiveInteger,
    energyWh: nullablePositiveNumber,
    batchSizeRequested: z.number().int().positive(),
    batchSizeEffective: nullablePositiveInteger,
    audioDurationSeconds: nullablePositiveNumber,
    commandReceipt: commandReceiptSchema,
    attemptReceipts: z.array(attemptReceiptSchema),
    candidates: z.array(candidateSchema),
    error: structuredErrorSchema.nullable(),
    metricUnavailableReason: metricUnavailableReasonSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const terminal = ['completed', 'failed', 'interrupted'].includes(record.status);
    for (const metric of [
      'wallTimeSeconds',
      'rtf',
      'peakMemoryBytes',
      'energyWh',
      'batchSizeEffective',
      'audioDurationSeconds',
    ]) {
      const hasValue = record[metric] !== null;
      const hasReason = record.metricUnavailableReason[metric] !== null;
      if (hasValue === hasReason) {
        context.addIssue({
          code: 'custom',
          path: ['metricUnavailableReason', metric],
          message: `${metric} requires exactly one of a measured value or an unavailable reason.`,
        });
      }
    }
    if (record.batchSizeEffective !== null) {
      if (
        record.batchSizeEffective < 1 ||
        record.batchSizeEffective > record.batchSizeRequested
      ) {
        context.addIssue({
          code: 'custom',
          path: ['batchSizeEffective'],
          message: 'Effective batch must be between one and the requested batch.',
        });
      }
    }
    if (
      record.candidates.some((candidate, index) => candidate.index !== index + 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'Candidate indices must be contiguous from one.',
      });
    }
    if (
      new Set(record.candidates.map((candidate) => `${candidate.artifact.device}:${candidate.artifact.inode}`)).size !==
        record.candidates.length ||
      new Set(record.candidates.map((candidate) => candidate.artifact.sha256)).size !==
        record.candidates.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'Candidate artifacts must have unique file identities and digests.',
      });
    }
    if (record.status === 'planned') {
      if (
        record.attempt !== 0 ||
        record.commandReceipt.executed ||
        record.commandReceipt.previousAttemptReceiptSha256 !== null ||
        record.commandReceipt.attemptReceiptSha256 !== null ||
        record.attemptReceipts.length !== 0 ||
        record.error !== null ||
        record.candidates.length !== 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Planned records cannot contain execution evidence.',
        });
      }
    }
    if (record.status === 'running') {
      if (
        record.attempt < 1 ||
        !record.commandReceipt.executed ||
        record.commandReceipt.startedAt === null ||
        record.commandReceipt.attemptReceiptSha256 !== null ||
        record.attemptReceipts.length !== record.attempt - 1
      ) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Running records require a started attempt receipt.',
        });
      }
    }
    if (terminal) {
      if (
        record.attempt < 1 ||
        !record.commandReceipt.executed ||
        record.commandReceipt.startedAt === null ||
        record.commandReceipt.finishedAt === null ||
        record.commandReceipt.stdoutSha256 === null ||
        record.commandReceipt.stderrSha256 === null ||
        record.commandReceipt.attemptReceiptSha256 === null ||
        record.attemptReceipts.length !== record.attempt
      ) {
        context.addIssue({
          code: 'custom',
          path: ['commandReceipt'],
          message: 'Terminal executed records require a complete command receipt.',
        });
      }
    }
    if (record.status === 'completed') {
      const totalDuration = record.candidates.reduce(
        (total, candidate) => total + candidate.durationSeconds,
        0,
      );
      const expectedRtf =
        record.wallTimeSeconds === null || totalDuration === 0
          ? null
          : record.wallTimeSeconds / totalDuration;
      if (
        record.error !== null ||
        record.commandReceipt.sidecar === null ||
        record.batchSizeEffective !== record.candidates.length ||
        record.audioDurationSeconds === null ||
        Math.abs(record.audioDurationSeconds - totalDuration) > 1e-9 ||
        record.rtf === null ||
        expectedRtf === null ||
        Math.abs(record.rtf - expectedRtf) > 1e-9
      ) {
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Completed records require consistent candidates, duration, batch, and RTF.',
        });
      }
    }
    if (
      (record.attempt <= 1 && record.commandReceipt.previousAttemptReceiptSha256 !== null) ||
      (record.attempt > 1 && record.commandReceipt.previousAttemptReceiptSha256 === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['commandReceipt', 'previousAttemptReceiptSha256'],
        message: 'Retried attempts must retain the previous terminal attempt receipt.',
      });
    }
    if (['failed', 'interrupted', 'skipped'].includes(record.status) && record.error === null) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Failed, interrupted, and skipped records require a structured error.',
      });
    }
    if (
      record.status === 'interrupted' &&
      (record.error?.category !== 'interrupted' || !record.error.retryable)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Only an explicitly retryable interrupted record can resume.',
      });
    }
    if (record.status === 'skipped' && record.commandReceipt.executed) {
      context.addIssue({
        code: 'custom',
        path: ['commandReceipt'],
        message: 'Skipped records cannot claim execution.',
      });
    }
  });

export function deriveSummary(manifest) {
  const records = manifest.repetitions;
  const completed = records.filter((record) => record.status === 'completed');
  const failed = records.filter((record) => record.status === 'failed');
  const skipped = records.filter((record) => record.status === 'skipped');
  const pending = records.filter((record) =>
    ['planned', 'running', 'interrupted'].includes(record.status),
  );
  const rtfValues = completed.map((record) => record.rtf).filter((value) => value !== null);
  const rtfMean =
    rtfValues.length === 0
      ? null
      : rtfValues.reduce((total, value) => total + value, 0) / rtfValues.length;
  const rtfStdDev =
    rtfValues.length < 2
      ? null
      : Math.sqrt(
          rtfValues.reduce((total, value) => total + (value - rtfMean) ** 2, 0) /
            rtfValues.length,
        );
  const energyValues = completed.map((record) => record.energyWh);
  const energyRequested = manifest.energyCollection.source === 'executor';
  const energyComplete =
    energyRequested &&
    completed.length > 0 &&
    energyValues.every((value) => value !== null);

  return {
    totalRepetitions: records.length,
    completedRepetitions: completed.length,
    failedRepetitions: failed.length,
    skippedRepetitions: skipped.length,
    pendingRepetitions: pending.length,
    rtfMean,
    rtfStdDev,
    allocationFailures: [manifest.warmup, ...records].filter(
      (record) => record.error?.allocationFailure,
    ).length,
    energyWhTotal: energyComplete
      ? energyValues.reduce((total, value) => total + value, 0)
      : null,
    energyUnavailableReason: energyComplete
      ? null
      : !energyRequested
        ? 'not_requested'
        : manifest.executionMode === 'dry-run'
          ? 'dry_run'
          : completed.length === 0
            ? 'no_completed_repetitions'
            : 'not_available_for_all_completed_repetitions',
  };
}

const summarySchema = z
  .object({
    totalRepetitions: z.number().int().min(3),
    completedRepetitions: z.number().int().nonnegative(),
    failedRepetitions: z.number().int().nonnegative(),
    skippedRepetitions: z.number().int().nonnegative(),
    pendingRepetitions: z.number().int().nonnegative(),
    rtfMean: nullablePositiveNumber,
    rtfStdDev: z.number().nonnegative().finite().nullable(),
    allocationFailures: z.number().int().nonnegative(),
    energyWhTotal: nullablePositiveNumber,
    energyUnavailableReason: z.string().min(1).nullable(),
  })
  .strict();

const engineSchema = z
  .object({
    name: z.string().min(1),
    repositoryPath: z.string().min(1).nullable(),
    repoCommit: z.literal(PINNED_ENGINE_COMMIT),
    clean: z.boolean().nullable(),
  })
  .strict();

const modelSchema = z
  .object({
    id: z.string().min(1),
    revision: immutableOrUnavailableRevision,
    weights: pinnedPathSchema.nullable(),
    lm: z
      .object({
        id: z.string().min(1),
        revision: immutableOrUnavailableRevision,
        weights: pinnedPathSchema.nullable(),
      })
      .strict(),
  })
  .strict();

const adapterSchema = z
  .object({
    kind: z.literal('persistent-jsonl-v1'),
    workingDirectory: z.string().min(1).nullable(),
    executable: pinnedPathSchema.nullable(),
    script: pinnedPathSchema.nullable(),
    pythonRuntime: pythonRuntimeSchema,
    dynamicLinker: executableClosureSchema.nullable(),
    requestTimeoutSeconds: z.number().positive().finite(),
    terminateGraceSeconds: z.number().positive(),
    maxOutputBytes: z.number().int().positive().max(MAX_ADAPTER_OUTPUT_BYTES),
  })
  .strict();

export const spikeManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    manifestType: z.literal('lofiever.local-music-spike-run'),
    benchmarkId: z.string().min(1),
    runId: z.string().regex(/^[a-f0-9]{64}$/u),
    configurationSha256: sha256,
    executionMode: z.enum(['dry-run', 'execute']),
    state: z.enum(['planned', 'running', 'completed', 'completed_with_errors', 'interrupted']),
    host: z
      .object({
        machine: z.string().min(1),
        chip: z.string().min(1).nullable(),
        memoryBytes: nullablePositiveInteger,
        osVersion: z.string().min(1).nullable(),
      })
      .strict(),
    engine: engineSchema,
    model: modelSchema,
    runtime: z
      .object({
        device: z.string().min(1),
        lmBackend: z.string().min(1),
        vaeChunk: nullablePositiveInteger,
        harnessCommit: gitCommit,
        harnessRepositoryPath: z.string().min(1).nullable(),
        harnessClean: z.boolean().nullable(),
        runDirectory: z.string().min(1).nullable(),
        runDirectoryIdentity: directoryIdentitySchema.nullable(),
        serverCommit: gitCommit.nullable(),
      })
      .strict(),
    toolchain: z
      .object({
        git: pinnedToolSchema.nullable(),
        node: pinnedToolSchema.nullable(),
        python: pinnedToolSchema.nullable(),
        uv: pinnedToolWithExecutableClosureSchema.nullable(),
        ffmpeg: pinnedToolSchema.nullable(),
        ffprobe: pinnedToolWithExecutableClosureSchema.nullable(),
      })
      .strict(),
    environment: z.array(
      z
        .object({
          name: z.string().min(1),
          valueSha256: sha256,
        })
        .strict(),
    ),
    environmentSha256: sha256.nullable(),
    adapter: adapterSchema,
    unavailableIdentity: z
      .object({
        harnessRepository: z.string().min(1).nullable(),
        engineRepository: z.string().min(1).nullable(),
        modelWeights: z.string().min(1).nullable(),
        lmWeights: z.string().min(1).nullable(),
        adapter: z.string().min(1).nullable(),
        toolchain: z.string().min(1).nullable(),
        environment: z.string().min(1).nullable(),
      })
      .strict(),
    factors: z
      .object({
        durationSeconds: canonicalDurationSeconds,
        batchSizeRequested: canonicalBatchSize,
        batchSizeEffective: nullablePositiveInteger,
        warmup: z.literal(1),
        repetitions: z.number().int().min(3),
      })
      .strict(),
    energyCollection: z
      .object({
        requested: z.boolean(),
        source: z.enum(['none', 'executor']),
        unavailableReason: z.string().min(1).nullable(),
      })
      .strict(),
    warmup: executionRecordSchema,
    repetitions: z.array(executionRecordSchema).min(3),
    summary: summarySchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const records = [manifest.warmup, ...manifest.repetitions];
    for (const [recordIndex, record] of records.entries()) {
      for (const [candidateIndex, candidate] of record.candidates.entries()) {
        if (
          !candidateDurationsWithinTolerance({
            measuredDurationSeconds: candidate.durationSeconds,
            adapterDeclaredDurationSeconds: candidate.adapterDeclaredDurationSeconds,
            requestedDurationSeconds: manifest.factors.durationSeconds,
          })
        ) {
          context.addIssue({
            code: 'custom',
            path: [
              recordIndex === 0 ? 'warmup' : 'repetitions',
              ...(recordIndex === 0 ? [] : [recordIndex - 1]),
              'candidates',
              candidateIndex,
              'durationSeconds',
            ],
            message: 'Measured and adapter-declared candidate durations must match the requested cell.',
          });
        }
      }
    }
    if (manifest.repetitions.length !== manifest.factors.repetitions) {
      context.addIssue({
        code: 'custom',
        path: ['repetitions'],
        message: 'Repetition records must match factors.repetitions.',
      });
    }
    if (
      manifest.warmup.phase !== 'warmup' ||
      manifest.warmup.index !== 0 ||
      !manifest.warmup.discarded
    ) {
      context.addIssue({
        code: 'custom',
        path: ['warmup'],
        message: 'Warmup must use index zero and be discarded.',
      });
    }
    const expectedIndices = manifest.repetitions.map((_, index) => index + 1);
    if (
      manifest.repetitions.some(
        (record, index) =>
          record.phase !== 'repetition' ||
          record.discarded ||
          record.index !== expectedIndices[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['repetitions'],
        message: 'Measured repetition indices must be unique and contiguous from one.',
      });
    }
    if (
      records.some(
        (record) => record.batchSizeRequested !== manifest.factors.batchSizeRequested,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['factors', 'batchSizeRequested'],
        message: 'Every record must retain the requested batch.',
      });
    }
    const expectedSummary = deriveSummary(manifest);
    if (JSON.stringify(manifest.summary) !== JSON.stringify(expectedSummary)) {
      context.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'Summary must be recalculated from repetition records.',
      });
    }
    if (
      ['completed', 'completed_with_errors'].includes(manifest.state) &&
      manifest.energyCollection.unavailableReason !==
        expectedSummary.energyUnavailableReason
    ) {
      context.addIssue({
        code: 'custom',
        path: ['energyCollection', 'unavailableReason'],
        message: 'Terminal manifests require a finalized energy availability reason.',
      });
    }
    if (
      manifest.energyCollection.requested !==
      (manifest.energyCollection.source === 'executor')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['energyCollection', 'requested'],
        message: 'Energy requested must agree with the configured collection source.',
      });
    }
    const effectiveBatches = manifest.repetitions
      .filter((record) => record.status === 'completed')
      .map((record) => record.batchSizeEffective);
    const uniqueEffective = [...new Set(effectiveBatches)];
    const expectedEffective = uniqueEffective.length === 1 ? uniqueEffective[0] : null;
    if (
      ['completed', 'completed_with_errors'].includes(manifest.state) &&
      uniqueEffective.length > 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['factors', 'batchSizeEffective'],
        message: 'A terminal cell cannot contain divergent effective batches.',
      });
    }
    if (manifest.factors.batchSizeEffective !== expectedEffective) {
      context.addIssue({
        code: 'custom',
        path: ['factors', 'batchSizeEffective'],
        message: 'Effective factor must agree with completed repetitions.',
      });
    }
    const statuses = records.map((record) => record.status);
    const stateValid =
      (manifest.state === 'planned' && statuses.every((status) => status === 'planned')) ||
      (manifest.state === 'running' &&
        !statuses.includes('interrupted') &&
        statuses.some((status) => ['planned', 'running'].includes(status)) &&
        !statuses.every((status) => status === 'planned')) ||
      (manifest.state === 'interrupted' &&
        statuses.includes('interrupted') &&
        !statuses.includes('running')) ||
      (manifest.state === 'completed' &&
        statuses.every((status) => status === 'completed')) ||
      (manifest.state === 'completed_with_errors' &&
        statuses.every((status) => ['completed', 'failed', 'skipped'].includes(status)) &&
        statuses.some((status) => ['failed', 'skipped'].includes(status)));
    if (!stateValid) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Manifest state must agree with all record states.',
      });
    }
    if (manifest.executionMode === 'execute') {
      const executableClosures = [
        manifest.adapter.dynamicLinker,
        manifest.toolchain.uv?.dynamicLinker,
        manifest.toolchain.ffprobe?.dynamicLinker,
      ];
      if (Object.values(manifest.unavailableIdentity).some((value) => value !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['unavailableIdentity'],
          message: 'Execute manifests cannot claim unavailable effective identity.',
        });
      }
      if (
        manifest.host.chip === null ||
        manifest.host.memoryBytes === null ||
        manifest.host.osVersion === null ||
        manifest.runtime.device !== 'mps' ||
        manifest.runtime.lmBackend !== 'mlx' ||
        manifest.engine.repositoryPath === null ||
        manifest.engine.clean !== true ||
        manifest.runtime.harnessRepositoryPath === null ||
        manifest.runtime.harnessClean !== true ||
        manifest.runtime.runDirectory === null ||
        manifest.runtime.runDirectoryIdentity === null ||
        manifest.runtime.vaeChunk === null ||
        manifest.model.revision === 'not-installed' ||
        manifest.model.weights === null ||
        manifest.model.lm.revision === 'not-installed' ||
        manifest.model.lm.weights === null ||
        manifest.adapter.executable === null ||
        manifest.adapter.script === null ||
        manifest.adapter.dynamicLinker === null ||
        manifest.toolchain.uv?.dynamicLinker === undefined ||
        manifest.toolchain.ffprobe?.dynamicLinker === undefined ||
        Object.values(manifest.toolchain).some((tool) => tool === null) ||
        manifest.environmentSha256 === null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['executionMode'],
          message: 'Execute manifests require complete effective identity.',
        });
      }
      if (executableClosures.every((closure) => closure !== null && closure !== undefined)) {
        const [baselineClosure] = executableClosures;
        if (
          baselineClosure.platform === 'darwin' &&
          executableClosures.some(
            (closure) => closure.format !== 'mach-o' || closure.osBuild === null,
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['executionMode'],
            message: 'Execute manifests require native Darwin Mach-O closure evidence.',
          });
        }
        if (
          baselineClosure.platform !== 'darwin' &&
          executableClosures.some(
            (closure) => closure.format !== 'not-mach-o' || closure.osBuild !== null,
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['executionMode'],
            message: 'Non-Darwin execute closures must record non-Mach-O platform evidence.',
          });
        }
        if (
          executableClosures.some(
            (closure) =>
              closure.platform !== baselineClosure.platform ||
              closure.architecture !== baselineClosure.architecture ||
              closure.osBuild !== baselineClosure.osBuild,
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['executionMode'],
            message: 'Execute closure platform identities must agree.',
          });
        }
      }
    }
  });

export function createManifestJsonSchema() {
  const schema = z.toJSONSchema(spikeManifestSchema, {
    target: 'draft-7',
    io: 'output',
  });
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://lofiever.local/schemas/local-music-spike-manifest.v1.schema.json',
    title: 'Lofiever local music spike run manifest',
    $comment:
      'Structural schema only. Run cli.mjs --validate-evidence with the trusted execute config and pinned output root to validate terminal filesystem evidence.',
    'x-lofiever-validation-scope': 'structural-schema-only',
    ...schema,
    allOf: [
      {
        if: {
          properties: { executionMode: { const: 'execute' } },
          required: ['executionMode'],
        },
        then: {
          properties: {
            host: {
              properties: {
                chip: { type: 'string', minLength: 1 },
                memoryBytes: { type: 'integer', minimum: 1 },
                osVersion: { type: 'string', minLength: 1 },
              },
              required: ['chip', 'memoryBytes', 'osVersion'],
            },
            runtime: {
              properties: {
                device: { const: 'mps' },
                lmBackend: { const: 'mlx' },
                vaeChunk: { type: 'integer', minimum: 1 },
              },
              required: ['vaeChunk'],
            },
            unavailableIdentity: {
              properties: Object.fromEntries(
                [
                  'harnessRepository',
                  'engineRepository',
                  'modelWeights',
                  'lmWeights',
                  'adapter',
                  'toolchain',
                  'environment',
                ].map((name) => [name, { type: 'null' }]),
              ),
            },
            adapter: {
              properties: {
                dynamicLinker: {
                  type: 'object',
                  allOf: [{
                    if: {
                      properties: { platform: { const: 'darwin' } },
                      required: ['platform'],
                    },
                    then: {
                      properties: {
                        format: { const: 'mach-o' },
                        osBuild: { type: 'string', minLength: 1 },
                      },
                    },
                  }],
                },
              },
              required: ['dynamicLinker'],
            },
            toolchain: {
              properties: {
                ffprobe: {
                  type: 'object',
                  properties: {
                    dynamicLinker: {
                      type: 'object',
                      allOf: [{
                        if: {
                          properties: { platform: { const: 'darwin' } },
                          required: ['platform'],
                        },
                        then: {
                          properties: {
                            format: { const: 'mach-o' },
                            osBuild: { type: 'string', minLength: 1 },
                          },
                        },
                      }],
                    },
                  },
                  required: ['dynamicLinker'],
                },
                uv: {
                  type: 'object',
                  properties: {
                    dynamicLinker: {
                      type: 'object',
                      allOf: [{
                        if: {
                          properties: { platform: { const: 'darwin' } },
                          required: ['platform'],
                        },
                        then: {
                          properties: {
                            format: { const: 'mach-o' },
                            osBuild: { type: 'string', minLength: 1 },
                          },
                        },
                      }],
                    },
                  },
                  required: ['dynamicLinker'],
                },
              },
            },
          },
        },
      },
      {
        if: {
          properties: {
            energyCollection: {
              properties: { source: { const: 'executor' } },
              required: ['source'],
            },
          },
          required: ['energyCollection'],
        },
        then: {
          properties: {
            energyCollection: {
              properties: { requested: { const: true } },
            },
          },
        },
        else: {
          properties: {
            energyCollection: {
              properties: { requested: { const: false } },
            },
          },
        },
      },
    ],
  };
}

export function createExecutorResultJsonSchema() {
  const schema = z.toJSONSchema(executorResultSchema, {
    target: 'draft-7',
    io: 'output',
  });
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://lofiever.local/schemas/executor-result.v1.schema.json',
    title: 'Lofiever persistent benchmark adapter sidecar',
    $comment:
      'Structural schema only. Run cli.mjs --validate-evidence against the containing manifest, trusted execute config, and pinned output root for terminal evidence.',
    'x-lofiever-validation-scope': 'structural-schema-only',
    ...schema,
  };
}
