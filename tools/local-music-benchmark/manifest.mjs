import { createHash } from 'node:crypto';

import { assertExecutableClosureIntegrity } from './dynamic-linker.mjs';
import { deriveSummary, spikeManifestSchema } from './schema.mjs';

export const ADAPTER_PROTOCOL = 'lofiever-benchmark-jsonl-v1';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(canonicalize(manifest), null, 2)}\n`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Receipt(value) {
  return `sha256:${sha256(value)}`;
}

function sameValue(left, right) {
  return serializeManifest(left) === serializeManifest(right);
}

export class BenchmarkManifestIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BenchmarkManifestIntegrityError';
    this.code = 'manifest_integrity_failed';
    this.details = details;
  }
}

export function adapterCommand(adapter) {
  return [
    adapter.executable?.realpath ?? '$PINNED_PYTHON',
    '-P',
    adapter.script?.realpath ?? '$PINNED_ADAPTER_SCRIPT',
    '--protocol',
    ADAPTER_PROTOCOL,
  ];
}

export function adapterWorkingDirectory(adapter) {
  return adapter.workingDirectory ?? '$PINNED_WORKING_DIRECTORY';
}

export function deriveCommandIdentity({ adapter, environment }) {
  return {
    transport: 'persistent-jsonl-v1',
    command: adapterCommand(adapter),
    workingDirectory: adapterWorkingDirectory(adapter),
    environment,
  };
}

export function deriveCommandSha256({ adapter, environment }) {
  return sha256Receipt(serializeManifest(deriveCommandIdentity({ adapter, environment })));
}

export function createCommandReceipt({ adapter, environment }) {
  const identity = deriveCommandIdentity({ adapter, environment });
  return {
    ...identity,
    commandSha256: sha256Receipt(serializeManifest(identity)),
    requestSha256: null,
    executed: false,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    signal: null,
    stdoutSha256: null,
    stderrSha256: null,
    stdoutBytes: null,
    stderrBytes: null,
    sidecar: null,
    previousAttemptReceiptSha256: null,
    attemptReceiptSha256: null,
  };
}

export function recordPaths({ cell, phase, index, attempt }) {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new TypeError('recordPaths requires a positive attempt number.');
  }
  const cellDirectory = `cells/d${cell.durationSeconds}-b${cell.batchSizeRequested}`;
  const recordDirectory = `${cellDirectory}/${phase}-${index}/attempt-${attempt}`;
  return {
    artifactDirectory: `${recordDirectory}/artifacts`,
    recordDirectory,
    resultJsonPath: `${recordDirectory}/executor-result.json`,
    consumedResultJsonPath: `${recordDirectory}/executor-result.consumed.json`,
  };
}

function createPlannedRecord({ adapter, cell, environment, mode, phase, index }) {
  const unavailable = mode === 'dry-run' ? 'dry_run' : 'not_executed';
  return {
    phase,
    index,
    attempt: 0,
    discarded: phase === 'warmup',
    status: 'planned',
    wallTimeSeconds: null,
    rtf: null,
    peakMemoryBytes: null,
    energyWh: null,
    batchSizeRequested: cell.batchSizeRequested,
    batchSizeEffective: null,
    audioDurationSeconds: null,
    commandReceipt: createCommandReceipt({ adapter, environment }),
    attemptReceipts: [],
    candidates: [],
    error: null,
    metricUnavailableReason: {
      wallTimeSeconds: unavailable,
      rtf: unavailable,
      peakMemoryBytes: unavailable,
      energyWh: unavailable,
      batchSizeEffective: unavailable,
      audioDurationSeconds: unavailable,
    },
  };
}

function unavailableIdentity(identity, adapter) {
  return {
    harnessRepository:
      identity.runtime.harnessRepositoryPath === null ? 'dry_run' : null,
    engineRepository: identity.engine.repositoryPath === null ? 'dry_run' : null,
    modelWeights: identity.model.weights === null ? 'dry_run' : null,
    lmWeights: identity.model.lm.weights === null ? 'dry_run' : null,
    adapter:
      adapter.workingDirectory === null ||
      adapter.executable === null ||
      adapter.script === null
        ? 'dry_run'
        : null,
    toolchain: Object.values(identity.toolchain).some((tool) => tool === null)
      ? 'dry_run'
      : null,
    environment: identity.environmentSha256 === null ? 'dry_run' : null,
  };
}

export function deriveConfiguration(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    benchmarkId: manifest.benchmarkId,
    host: manifest.host,
    engine: manifest.engine,
    model: manifest.model,
    runtime: manifest.runtime,
    toolchain: manifest.toolchain,
    environment: manifest.environment,
    environmentSha256: manifest.environmentSha256,
    adapter: manifest.adapter,
    unavailableIdentity: manifest.unavailableIdentity,
    factors: {
      durationSeconds: manifest.factors.durationSeconds,
      batchSizeRequested: manifest.factors.batchSizeRequested,
      warmup: manifest.factors.warmup,
      repetitions: manifest.factors.repetitions,
    },
    energyCollection: {
      requested: manifest.energyCollection.requested,
      source: manifest.energyCollection.source,
    },
  };
}

export function deriveRequestIdentity(manifest, record, attempt = record.attempt) {
  return {
    runId: manifest.runId,
    configurationSha256: manifest.configurationSha256,
    durationSeconds: manifest.factors.durationSeconds,
    batchSizeRequested: manifest.factors.batchSizeRequested,
    phase: record.phase,
    index: record.index,
    attempt,
    commandSha256: record.commandReceipt.commandSha256,
  };
}

export function deriveRequestSha256(manifest, record, attempt = record.attempt) {
  return sha256Receipt(
    serializeManifest(deriveRequestIdentity(manifest, record, attempt)),
  );
}

function terminalCommandEvidence(commandReceipt) {
  return {
    executed: commandReceipt.executed,
    startedAt: commandReceipt.startedAt,
    finishedAt: commandReceipt.finishedAt,
    exitCode: commandReceipt.exitCode,
    signal: commandReceipt.signal,
    stdoutSha256: commandReceipt.stdoutSha256,
    stderrSha256: commandReceipt.stderrSha256,
    stdoutBytes: commandReceipt.stdoutBytes,
    stderrBytes: commandReceipt.stderrBytes,
    sidecar: commandReceipt.sidecar,
  };
}

function terminalResultEvidence(record) {
  return {
    status: record.status,
    wallTimeSeconds: record.wallTimeSeconds,
    rtf: record.rtf,
    peakMemoryBytes: record.peakMemoryBytes,
    energyWh: record.energyWh,
    batchSizeRequested: record.batchSizeRequested,
    batchSizeEffective: record.batchSizeEffective,
    audioDurationSeconds: record.audioDurationSeconds,
    candidates: record.candidates,
    error: record.error,
    metricUnavailableReason: record.metricUnavailableReason,
  };
}

function attemptReceiptPayload(manifest, record, receipt) {
  return {
    request: deriveRequestIdentity(manifest, record, receipt.attempt),
    requestSha256: receipt.requestSha256,
    previousAttemptReceiptSha256: receipt.previousAttemptReceiptSha256,
    commandEvidence: receipt.commandEvidence,
    result: receipt.result,
  };
}

export function createAttemptReceipt(manifest, record) {
  const receipt = {
    attempt: record.attempt,
    requestSha256: record.commandReceipt.requestSha256,
    previousAttemptReceiptSha256:
      record.commandReceipt.previousAttemptReceiptSha256,
    commandEvidence: terminalCommandEvidence(record.commandReceipt),
    result: terminalResultEvidence(record),
  };
  return {
    ...receipt,
    attemptReceiptSha256: sha256Receipt(
      serializeManifest(attemptReceiptPayload(manifest, record, receipt)),
    ),
  };
}

export function deriveAttemptReceiptSha256(manifest, record) {
  return createAttemptReceipt(manifest, record).attemptReceiptSha256;
}

export function createSidecarIdentity(manifest, record, attempt = record.attempt) {
  const identity = deriveRequestIdentity(manifest, record, attempt);
  return {
    ...identity,
    requestSha256: deriveRequestSha256(manifest, record, attempt),
  };
}

export function createDryRunManifest({
  identity,
  adapter,
  cell,
  repetitions,
  energyCollection = { source: 'none' },
  executionMode = 'dry-run',
}) {
  const effectiveAdapter = {
    ...adapter,
    pythonRuntime: adapter.pythonRuntime ?? null,
    dynamicLinker: adapter.dynamicLinker ?? null,
  };
  const base = {
    schemaVersion: '1.0.0',
    manifestType: 'lofiever.local-music-spike-run',
    benchmarkId: identity.benchmarkId,
    host: identity.host,
    engine: identity.engine,
    model: identity.model,
    runtime: {
      ...identity.runtime,
      runDirectoryIdentity: identity.runtime.runDirectoryIdentity ?? null,
    },
    toolchain: identity.toolchain,
    environment: identity.environment ?? [],
    environmentSha256: identity.environmentSha256 ?? null,
    adapter: effectiveAdapter,
    unavailableIdentity: unavailableIdentity(identity, effectiveAdapter),
    factors: {
      durationSeconds: cell.durationSeconds,
      batchSizeRequested: cell.batchSizeRequested,
      batchSizeEffective: null,
      warmup: 1,
      repetitions,
    },
    energyCollection: {
      requested: energyCollection.source === 'executor',
      source: energyCollection.source,
      unavailableReason:
        energyCollection.source === 'executor' ? 'not_reported_yet' : 'not_requested',
    },
  };
  const configurationSha256 = sha256Receipt(serializeManifest(deriveConfiguration(base)));
  const runId = sha256(configurationSha256);
  const manifest = {
    ...base,
    runId,
    configurationSha256,
    executionMode,
    state: 'planned',
    warmup: createPlannedRecord({
      adapter: effectiveAdapter,
      cell,
      environment: base.environment,
      mode: executionMode,
      phase: 'warmup',
      index: 0,
    }),
    repetitions: Array.from({ length: repetitions }, (_, offset) =>
      createPlannedRecord({
        adapter: effectiveAdapter,
        cell,
        environment: base.environment,
        mode: executionMode,
        phase: 'repetition',
        index: offset + 1,
      }),
    ),
    summary: null,
  };
  manifest.summary = deriveSummary(manifest);
  return spikeManifestSchema.parse(manifest);
}

function assertRecordReceipt(manifest, record) {
  const expectedIdentity = deriveCommandIdentity({
    adapter: manifest.adapter,
    environment: manifest.environment,
  });
  const actualIdentity = {
    transport: record.commandReceipt.transport,
    command: record.commandReceipt.command,
    workingDirectory: record.commandReceipt.workingDirectory,
    environment: record.commandReceipt.environment,
  };
  if (!sameValue(actualIdentity, expectedIdentity)) {
    throw new BenchmarkManifestIntegrityError('Command receipt changed from the pinned adapter.');
  }
  const expectedCommandSha256 = sha256Receipt(serializeManifest(expectedIdentity));
  if (record.commandReceipt.commandSha256 !== expectedCommandSha256) {
    throw new BenchmarkManifestIntegrityError('Command receipt digest does not match its identity.');
  }
  if (record.attempt === 0) {
    if (
      record.commandReceipt.requestSha256 !== null ||
      record.commandReceipt.previousAttemptReceiptSha256 !== null ||
      record.commandReceipt.attemptReceiptSha256 !== null
    ) {
      throw new BenchmarkManifestIntegrityError('An unattempted record cannot carry a request hash.');
    }
    if (record.attemptReceipts.length !== 0) {
      throw new BenchmarkManifestIntegrityError('An unattempted record cannot carry attempt receipts.');
    }
  } else {
    const expectedRequestSha256 = deriveRequestSha256(manifest, record);
    if (record.commandReceipt.requestSha256 !== expectedRequestSha256) {
      throw new BenchmarkManifestIntegrityError('Request receipt digest does not match its attempt.');
    }
    let previousAttemptReceiptSha256 = null;
    for (let index = 0; index < record.attemptReceipts.length; index += 1) {
      const receipt = record.attemptReceipts[index];
      if (
        receipt.attempt !== index + 1 ||
        receipt.previousAttemptReceiptSha256 !== previousAttemptReceiptSha256 ||
        receipt.requestSha256 !== deriveRequestSha256(manifest, record, receipt.attempt)
      ) {
        throw new BenchmarkManifestIntegrityError('Attempt receipt chain is incomplete.');
      }
      const expectedReceiptSha256 = sha256Receipt(
        serializeManifest(attemptReceiptPayload(manifest, record, receipt)),
      );
      if (receipt.attemptReceiptSha256 !== expectedReceiptSha256) {
        throw new BenchmarkManifestIntegrityError('Stored attempt receipt digest is inconsistent.');
      }
      if (receipt.attempt < record.attempt) {
        const interruption = receipt.result.error;
        if (
          receipt.result.status !== 'interrupted' ||
          interruption?.category !== 'interrupted' ||
          interruption.retryable !== true ||
          interruption.allocationFailure !== false ||
          receipt.commandEvidence.sidecar !== null ||
          receipt.result.candidates.length !== 0
        ) {
          throw new BenchmarkManifestIntegrityError(
            'Only sidecar-free retryable interruptions may precede the current attempt.',
          );
        }
      }
      previousAttemptReceiptSha256 = receipt.attemptReceiptSha256;
    }
    const expectedPreviousAttemptReceiptSha256 =
      record.attempt === 1
        ? null
        : record.attemptReceipts[record.attempt - 2]?.attemptReceiptSha256 ?? null;
    if (
      record.commandReceipt.previousAttemptReceiptSha256 !==
      expectedPreviousAttemptReceiptSha256
    ) {
      throw new BenchmarkManifestIntegrityError('Current attempt does not extend the stored receipt chain.');
    }
    if (['completed', 'failed', 'interrupted'].includes(record.status)) {
      if (record.attemptReceipts.length !== record.attempt) {
        throw new BenchmarkManifestIntegrityError('Every terminal attempt requires one stored receipt.');
      }
      const currentReceipt = record.attemptReceipts.at(-1);
      const expectedCurrentReceipt = createAttemptReceipt(manifest, record);
      if (
        record.commandReceipt.attemptReceiptSha256 !== currentReceipt.attemptReceiptSha256 ||
        !sameValue(currentReceipt, expectedCurrentReceipt)
      ) {
        throw new BenchmarkManifestIntegrityError('Attempt receipt digest is inconsistent.');
      }
    } else if (
      record.commandReceipt.attemptReceiptSha256 !== null ||
      record.attemptReceipts.length !== record.attempt - 1
    ) {
      throw new BenchmarkManifestIntegrityError(
        'A non-terminal attempt cannot carry a terminal attempt receipt.',
      );
    }
  }
}

export function assertManifestIntegrity(manifest, { schemaAlreadyValidated = false } = {}) {
  if (!schemaAlreadyValidated) {
    const validation = spikeManifestSchema.safeParse(manifest);
    if (!validation.success) {
      throw new BenchmarkManifestIntegrityError('Manifest does not satisfy its schema.', {
        issues: validation.error.issues,
      });
    }
  }
  const expectedEnvironmentSha256 =
    manifest.environment.length === 0
      ? manifest.executionMode === 'dry-run'
        ? null
        : sha256Receipt(serializeManifest([]))
      : sha256Receipt(serializeManifest(manifest.environment));
  if (manifest.environmentSha256 !== expectedEnvironmentSha256) {
    throw new BenchmarkManifestIntegrityError('Environment receipt digest is inconsistent.');
  }
  const closurePins = [
    [manifest.adapter.dynamicLinker, manifest.adapter.executable],
    [manifest.toolchain.uv?.dynamicLinker, manifest.toolchain.uv],
    [manifest.toolchain.ffprobe?.dynamicLinker, manifest.toolchain.ffprobe],
  ];
  for (const [closure, executable] of closurePins) {
    if (closure === null || closure === undefined) continue;
    try {
      assertExecutableClosureIntegrity(closure);
      if (
        executable === null ||
        closure.root.realpath !== executable.realpath ||
        closure.root.sha256 !== executable.sha256
      ) {
        throw new Error('Closure root does not match its executable pin.');
      }
    } catch (error) {
      throw new BenchmarkManifestIntegrityError(
        'Dynamic-linker closure receipt is inconsistent.',
        { cause: error?.message ?? String(error), code: error?.code ?? null },
      );
    }
  }
  const expectedConfigurationSha256 = sha256Receipt(
    serializeManifest(deriveConfiguration(manifest)),
  );
  if (manifest.configurationSha256 !== expectedConfigurationSha256) {
    throw new BenchmarkManifestIntegrityError('Configuration digest is inconsistent.');
  }
  if (manifest.runId !== sha256(expectedConfigurationSha256)) {
    throw new BenchmarkManifestIntegrityError('Run identity is inconsistent.');
  }
  for (const record of [manifest.warmup, ...manifest.repetitions]) {
    assertRecordReceipt(manifest, record);
  }
  if (!sameValue(manifest.summary, deriveSummary(manifest))) {
    throw new BenchmarkManifestIntegrityError('Summary is inconsistent.');
  }
  return manifest;
}

export function validateManifest(manifest) {
  const parsed = spikeManifestSchema.safeParse(manifest);
  if (!parsed.success) return parsed;
  try {
    assertManifestIntegrity(parsed.data, { schemaAlreadyValidated: true });
    return parsed;
  } catch (error) {
    return { success: false, error };
  }
}
