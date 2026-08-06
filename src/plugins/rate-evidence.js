// Observability-only plugin that gathers EVIDENCE for the "no rate limiting
// anywhere" spike issue (Item W3). It NEVER throttles, rejects, or delays a
// request — there is no limiter here. It simply counts requests per client IP
// in a sliding window and logs when a client crosses a burst threshold, so the
// logs demonstrate a scripted client driving an uncapped request rate (point a
// load tool at /reference/* and watch the count climb with no 429 in sight).
//
// If this instead enforced a cap it would BE the fix; keeping it purely
// observational is deliberate — the spike wants to measure the problem, not
// solve it.
import { logPerfEvidence } from '../common/helpers/perf-evidence.js'

/** Sliding window over which requests are counted, in milliseconds. */
const WINDOW_MS = 10_000

/** Requests-per-window above which a client is logged as an uncapped burst. */
const BURST_THRESHOLD = 30

/** Minimum gap between burst logs for one client, to bound log volume. */
const LOG_COOLDOWN_MS = 1_000

/** Cap on tracked client entries before expired ones are swept. */
const MAX_TRACKED_CLIENTS = 10_000

/** Trim expired timestamps for one client and record the current request. */
function recordRequest(entry, now, cutoff) {
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
  entry.timestamps.push(now)
}

/** Drop client entries whose most recent request has aged out of the window. */
function pruneExpired(windows, cutoff) {
  for (const [key, value] of windows) {
    const last = value.timestamps.at(-1) ?? 0
    if (last <= cutoff) {
      windows.delete(key)
    }
  }
}

/** Log a single evidence line when a client is over the burst threshold. */
function maybeLogBurst(server, request, entry, now) {
  if (
    entry.timestamps.length <= BURST_THRESHOLD ||
    now - entry.lastLoggedAt <= LOG_COOLDOWN_MS
  ) {
    return
  }
  entry.lastLoggedAt = now
  logPerfEvidence(server.logger, 'no-rate-limit', {
    clientIp: request.info.remoteAddress ?? 'unknown',
    windowRequests: entry.timestamps.length,
    windowMs: WINDOW_MS,
    path: request.path,
    method: request.method
  })
}

const rateEvidence = {
  plugin: {
    name: 'rate-evidence',
    register(server) {
      // clientIp -> { timestamps: number[], lastLoggedAt: number }
      const windows = new Map()

      server.ext('onRequest', (request, h) => {
        const now = Date.now()
        const cutoff = now - WINDOW_MS
        const ip = request.info.remoteAddress ?? 'unknown'
        const entry = windows.get(ip) ?? { timestamps: [], lastLoggedAt: 0 }
        windows.set(ip, entry)

        recordRequest(entry, now, cutoff)
        maybeLogBurst(server, request, entry, now)

        if (windows.size > MAX_TRACKED_CLIENTS) {
          pruneExpired(windows, cutoff)
        }
        return h.continue
      })
    }
  }
}

export { rateEvidence }
