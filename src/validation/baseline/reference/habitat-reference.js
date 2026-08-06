// Reference data for the Habitat Details page (BMD-315): broad habitats,
// habitat types, conditions, and trading rules. Thin readers over
// bng-metric-engine's CONDITION_SCORES and DISTINCTIVENESS_SCORES so backend
// and engine cannot drift.

import {
  CONDITION_SCORES,
  DISTINCTIVENESS_SCORES,
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from 'bng-metric-engine'
import {
  distinctivenessByHabitatType,
  distinctivenessScores
} from './habitat-distinctiveness.js'
import { createLogger } from '../../../common/helpers/logging/logger.js'
import {
  logPerfEvidence,
  perfNow
} from '../../../common/helpers/perf-evidence.js'

const logger = createLogger()

// Hedgerow scores differ from area scores at V.Low (1 vs 0) per the statutory
// metric tables, so the hedgerow path must read its own scores table.
const hedgerowDistinctivenessScores = Object.fromEntries(
  Object.entries(HEDGEROW_DISTINCTIVENESS_SCORES).map(([band, { Score }]) => [
    band,
    { score: Score }
  ])
)

// Watercourse uses its own scores table — V.High/High/Medium/Low only, with
// different Score values from the area band scale.
const watercourseDistinctivenessScores = Object.fromEntries(
  Object.entries(WATERCOURSE_DISTINCTIVENESS_SCORES).map(
    ([band, { Score }]) => [band, { score: Score }]
  )
)

export { distinctivenessScores } from './habitat-distinctiveness.js'
export { hedgerowDistinctivenessScores, watercourseDistinctivenessScores }

const NOT_POSSIBLE = 'Not Possible'

// Trading rules per AC10. Sourced from the engine's "Trading rules"
// strings so the wording stays in lockstep with the calculator.
const tradingRulesByDistinctiveness = Object.fromEntries(
  Object.entries(DISTINCTIVENESS_SCORES).map(([band, entry]) => [
    band,
    entry['Trading rules']
  ])
)

// Watercourse trading-rules wording differs from area at V.High; map is built
// from the engine's watercourse-distinctiveness-scores table to stay in lockstep
// with the calculator.
const watercourseTradingRulesByDistinctiveness = Object.fromEntries(
  Object.entries(WATERCOURSE_DISTINCTIVENESS_SCORES).map(([band, entry]) => [
    band,
    entry['Trading rules']
  ])
)

// Distinctiveness bands in scope for the BNG Beta service — only V.Low, Low and
// Medium habitats are supported (see distinctiveness-check.js, which rejects
// anything higher at upload). The area, hedgerow and watercourse dropdowns all
// filter to these bands so High and V.High habitats are never offered.
const MVS_BANDS = new Set(['V.Low', 'Low', 'Medium'])

// Split a habitat type key like 'Grassland - Lowland meadows' or
// 'Rocky shore - High energy littoral rock - on peat, clay or chalk' into
// { broadHabitat, habitatType } on the first ' - ' only.
function splitHabitatTypeKey(key) {
  const sep = ' - '
  const idx = key.indexOf(sep)
  if (idx < 0) {
    return { broadHabitat: key, habitatType: '' }
  }
  return {
    broadHabitat: key.slice(0, idx),
    habitatType: key.slice(idx + sep.length)
  }
}

/**
 * All (broad habitat, habitat type, distinctiveness) triples for area habitats.
 * Used by the broad-habitats and habitat-types reference endpoints.
 *
 * @param {{ areaOnly?: boolean }} [options]
 * @returns {Array<{ broadHabitat: string, habitatType: string, distinctiveness: string }>}
 */
function getHabitatsByBroad(options = {}) {
  const { areaOnly = false } = options
  const rows = []
  for (const [key, distinctiveness] of Object.entries(
    distinctivenessByHabitatType
  )) {
    if (areaOnly && !MVS_BANDS.has(distinctiveness)) {
      continue
    }
    const { broadHabitat, habitatType } = splitHabitatTypeKey(key)
    rows.push({ broadHabitat, habitatType, distinctiveness })
  }
  return rows
}

/**
 * The distinct list of broad habitats present in the area-habitats journey,
 * sorted alphabetically. Excludes broads with no V.Low/Low/Medium entries.
 *
 * @returns {string[]}
 */
function getAreaBroadHabitats() {
  const start = perfNow()
  const broads = new Set()
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    broads.add(row.broadHabitat)
  }
  const result = [...broads].sort((a, b) => a.localeCompare(b))
  // Evidence (Item W5 — reference lookups recompute per request, no cache
  // headers): this Set build + sort over static, per-build data runs on every
  // call. The /reference/* route handlers set no Cache-Control/ETag, so the
  // work repeats per request (buildMicros = microseconds for one rebuild).
  logPerfEvidence(logger, 'reference-recompute', {
    getter: 'areaBroadHabitats',
    resultCount: result.length,
    buildMicros: Math.round((perfNow() - start) * 1000)
  })
  return result
}

/**
 * Habitat types (sorted) within a broad habitat that qualify for the area
 * habitats journey. Each entry carries its distinctiveness band + score so
 * the frontend can render AC2 (Distinctiveness text on habitat-type change)
 * client-side without a further round trip.
 *
 * @param {string} broadHabitat
 * @returns {Array<{ name: string, distinctiveness: string, distinctivenessScore: number }>}
 */
function getAreaHabitatTypes(broadHabitat) {
  const types = []
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    if (row.broadHabitat === broadHabitat) {
      types.push({
        name: row.habitatType,
        distinctiveness: row.distinctiveness,
        distinctivenessScore: distinctivenessScores[row.distinctiveness]?.score
      })
    }
  }
  return types.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Every area habitat type grouped by broad habitat. Returned in one response
 * by /reference/habitat-types-by-broad so the BMD-480 client-side dropdown JS
 * can avoid the 1 + N round trips it would otherwise need.
 *
 * @returns {Object<string, Array<{ name: string, distinctiveness: string, distinctivenessScore: number }>>}
 */
function getAreaHabitatTypesByBroad() {
  const start = perfNow()
  const grouped = {}
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    const list = grouped[row.broadHabitat] ?? []
    list.push({
      name: row.habitatType,
      distinctiveness: row.distinctiveness,
      distinctivenessScore: distinctivenessScores[row.distinctiveness]?.score
    })
    grouped[row.broadHabitat] = list
  }
  for (const broad of Object.keys(grouped)) {
    grouped[broad].sort((a, b) => a.name.localeCompare(b.name))
  }
  // Evidence (Item W5 — reference lookups recompute per request): the full
  // group-by + per-broad sort is rebuilt on every /reference/habitat-types-by-
  // broad call, with no response cache headers to let clients skip it.
  logPerfEvidence(logger, 'reference-recompute', {
    getter: 'areaHabitatTypesByBroad',
    resultCount: Object.keys(grouped).length,
    buildMicros: Math.round((perfNow() - start) * 1000)
  })
  return grouped
}

/**
 * Condition options for a habitat type, in the engine's canonical order, with
 * "Not Possible" entries removed. Returns [] for habitat types the engine does
 * not know about.
 *
 * @param {string} habitatType
 * @returns {Array<{ condition: string, score: number }>}
 */
function getConditionsForHabitatType(habitatType) {
  const scoresByCondition = CONDITION_SCORES[habitatType]
  if (!scoresByCondition) {
    return []
  }
  const out = []
  for (const [condition, score] of Object.entries(scoresByCondition)) {
    if (score !== NOT_POSSIBLE) {
      out.push({ condition, score })
    }
  }
  return out
}

// Hedgerow reference data comes from the bundled engine (BMD-427/428).
// Shapes match the area equivalents so the frontend strategy reuses the
// same view-model code.

/**
 * Hedgerow habitat types in the MVS scope (V.Low / Low / Medium), sorted by
 * name. Each entry carries its distinctiveness band + score so the client can
 * derive distinctiveness text without a round trip.
 *
 * The `categories` parameter is exposed for tests so the logic can be
 * exercised before BMD-427/428 populates the real engine data; production
 * callers should use the default.
 *
 * @param {Object<string, string>} [categories]
 * @returns {Array<{ name: string, distinctiveness: string, distinctivenessScore: number }>}
 */
function getHedgerowHabitatTypes(
  categories = HEDGEROW_DISTINCTIVENESS_CATEGORIES
) {
  const types = []
  for (const [name, distinctiveness] of Object.entries(categories)) {
    if (!MVS_BANDS.has(distinctiveness)) {
      continue
    }
    types.push({
      name,
      distinctiveness,
      distinctivenessScore:
        hedgerowDistinctivenessScores[distinctiveness]?.score
    })
  }
  return types.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Condition options for a hedgerow habitat type, in the engine's canonical
 * order, with "Not Possible" entries removed. Returns [] for hedgerow types
 * the engine does not know about.
 *
 * The `scoresLookup` parameter is exposed for tests so the logic can be
 * exercised before BMD-427/428 populates the real engine data; production
 * callers should use the default.
 *
 * @param {string} habitatType
 * @param {Object<string, Object<string, number|string>>} [scoresLookup]
 * @returns {Array<{ condition: string, score: number }>}
 */
function conditionsFromScoreTable(habitatType, scoresLookup) {
  const scoresByCondition = scoresLookup[habitatType]
  if (!scoresByCondition) {
    return []
  }
  const out = []
  for (const [condition, score] of Object.entries(scoresByCondition)) {
    if (score !== NOT_POSSIBLE) {
      out.push({ condition, score })
    }
  }
  return out
}

function getConditionsForHedgerowType(
  habitatType,
  scoresLookup = HEDGEROW_CONDITION_SCORES
) {
  return conditionsFromScoreTable(habitatType, scoresLookup)
}

// Watercourse reference data comes from the bundled engine. Like the area and
// hedgerow journeys, the watercourse details page filters to the in-scope bands:
// High (Other rivers and streams) and V.High (Priority habitat) are dropped from
// the habitat type dropdown because they are out of scope for the BNG Beta
// service and are already rejected at upload.

/**
 * Watercourse habitat types in the MVS scope (V.Low / Low / Medium), sorted
 * alphabetically by name. Each entry carries its distinctiveness band + score
 * so the client can derive distinctiveness text without a round trip.
 *
 * The `categories` parameter is exposed for tests so the filter/sort logic can
 * be exercised independently of the engine's data choices.
 *
 * @param {Object<string, string>} [categories]
 * @returns {Array<{ name: string, distinctiveness: string, distinctivenessScore: number }>}
 */
function getWatercourseHabitatTypes(
  categories = WATERCOURSE_DISTINCTIVENESS_CATEGORIES
) {
  const types = []
  for (const [name, distinctiveness] of Object.entries(categories)) {
    if (!MVS_BANDS.has(distinctiveness)) {
      continue
    }
    types.push({
      name,
      distinctiveness,
      distinctivenessScore:
        watercourseDistinctivenessScores[distinctiveness]?.score
    })
  }
  return types.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Condition options for a watercourse habitat type, in the engine's canonical
 * order with "Not Possible" entries stripped.
 *
 * @param {string} habitatType
 * @param {Object<string, Object<string, number|string>>} [scoresLookup]
 * @returns {Array<{ condition: string, score: number }>}
 */
function getConditionsForWatercourseType(
  habitatType,
  scoresLookup = WATERCOURSE_CONDITION_SCORES
) {
  return conditionsFromScoreTable(habitatType, scoresLookup)
}

// BMD-502 story implies the encroachment options are filtered per watercourse
// habitat type ("Valid values per watercourse habitat on Reference Data -
// Habitats"). The engine bundles only the flat multiplier tables — no per-type
// filter exists today. Returning the full list keeps the page populated; if
// the per-type table later ships in the engine, swap these readers to take a
// `habitatType` argument.

/**
 * All recognised watercourse-encroachment options, in the engine's authored
 * order (No Encroachment, Minor, Major, N/A - Culvert).
 *
 * @returns {string[]}
 */
function getWatercourseEncroachmentOptions() {
  return Object.keys(WATERCOURSE_ENCROACHMENT_MULTIPLIER)
}

/**
 * All recognised riparian-encroachment options, in the engine's authored order
 * (severity descending, culvert last).
 *
 * @returns {string[]}
 */
function getRiparianEncroachmentOptions() {
  return Object.keys(WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER)
}

export {
  tradingRulesByDistinctiveness,
  watercourseTradingRulesByDistinctiveness,
  getHabitatsByBroad,
  getAreaBroadHabitats,
  getAreaHabitatTypes,
  getAreaHabitatTypesByBroad,
  getConditionsForHabitatType,
  getHedgerowHabitatTypes,
  getConditionsForHedgerowType,
  getWatercourseHabitatTypes,
  getConditionsForWatercourseType,
  getWatercourseEncroachmentOptions,
  getRiparianEncroachmentOptions,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_CONDITION_SCORES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_CONDITION_SCORES
}
