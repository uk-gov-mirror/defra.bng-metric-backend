// Lightweight, always-on structured logging used to gather EVIDENCE for the
// performance issues catalogued in the "System Performance Issues" spike. Each
// call emits a single structured pino line carrying a stable `perfEvidence`
// marker (the spike issue id) plus measured fields — durations in ms, byte
// sizes, feature/row counts, heap deltas — so the evidence can be pulled from
// the logs with `grep perfEvidence` or filtered in ECS on `perfEvidence:<id>`.
//
// This is instrumentation, NOT a fix: it records how bad each issue gets, it
// does not change behaviour. Kept in one place so the marker and field shape
// stay consistent across every instrumented site.

/** Field name every evidence line carries, set to the spike issue id. */
const PERF_EVIDENCE_MARKER = 'perfEvidence'

/** Bytes in a megabyte, for reporting heap usage in whole MB. */
const BYTES_PER_MB = 1024 * 1024

/**
 * High-resolution millisecond clock for measuring elapsed time. Returned values
 * are only meaningful as differences (`perfNow() - start`).
 *
 * @returns {number}
 */
function perfNow() {
  return performance.now()
}

/**
 * Current process heap usage in whole megabytes.
 *
 * @returns {number}
 */
function heapUsedMb() {
  return Math.round(process.memoryUsage().heapUsed / BYTES_PER_MB)
}

/**
 * Total UTF-8 byte length of a string, or of every string in an array (used to
 * size the serialised-geometry parameter arrays shipped to Postgres).
 *
 * @param {string | string[]} value
 * @returns {number}
 */
function utf8Bytes(value) {
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) {
      total += Buffer.byteLength(item)
    }
    return total
  }
  return Buffer.byteLength(value)
}

/**
 * Emit one structured evidence line. `logger` is any pino-like logger exposing
 * `.info(obj, msg)` — a route's `request.logger`, `server.logger`, or a
 * module-level `createLogger()`. No-ops safely when no such logger is in scope
 * (e.g. the enrich path's NO_OP_LOGGER), so callers never have to guard.
 *
 * @param {{ info?: Function } | undefined} logger
 * @param {string} id spike issue id, e.g. 'pipeline-inline'
 * @param {object} [fields] measured values to attach
 */
function logPerfEvidence(logger, id, fields = {}) {
  if (!logger?.info) {
    return
  }
  logger.info({ [PERF_EVIDENCE_MARKER]: id, ...fields }, `perf-evidence: ${id}`)
}

export {
  logPerfEvidence,
  perfNow,
  heapUsedMb,
  utf8Bytes,
  PERF_EVIDENCE_MARKER,
  BYTES_PER_MB
}
