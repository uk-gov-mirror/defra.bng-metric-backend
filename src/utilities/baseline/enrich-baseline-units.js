import {
  BaselineLookupError,
  calculateAreaHabitatBaseline,
  calculateHedgerowBaseline,
  calculateWatercourseBaseline,
  isRecognisedEncroachmentValue,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from 'bng-metric-engine'

import { HABITAT_STATUS } from '../../services/baseline/calculate-habitat-statuses.js'
import { stripConditionPrefix } from './condition.js'
import { summarizeFeatureSetUnitsTotals } from '../features/feature-set-units.js'
import { logPerf, perfNow } from '../../common/helpers/perf-evidence.js'
import {
  SQ_METRES_PER_HECTARE,
  METRES_PER_KM,
  NO_OP_LOGGER,
  enrichCollectionIfNonEmpty
} from './enrich-units-shared.js'

const LOG_ENRICH_PREFIX = 'enrichBaseline: '

/**
 * Engine entry point wrapper around stripConditionPrefix that guarantees a
 * string return value — engine calculators expect a string, not null.
 */
export function normalizeConditionForEngine(condition) {
  const stripped = stripConditionPrefix(condition)
  return typeof stripped === 'string' ? stripped : ''
}

/**
 * Engine habitat keys usually match `Baseline Habitat Type`, but some rows use
 * `{Broad} - {Habitat}` while GeoPackage stores them in separate columns.
 *
 * @param {{ type?: unknown, broadType?: unknown }} habitat
 * @returns {Generator<string>}
 */
export function* engineHabitatTypeCandidates(habitat) {
  const type = typeof habitat.type === 'string' ? habitat.type.trim() : ''
  if (type) {
    yield type

    const broad =
      typeof habitat.broadType === 'string' ? habitat.broadType.trim() : ''

    if (broad) {
      const prefix = `${broad} - `
      if (type.startsWith(prefix)) {
        // type already includes the broad-type prefix
      } else {
        yield `${broad} - ${type}`
      }
    } else {
      // no broad type — only the raw habitat type was yielded above
    }
  } else {
    // empty type — generator yields nothing
  }
}

/**
 * Documents the effective encroachment multiplier used when a value is absent
 * or unrecognised. Not applied in code directly — the engine applies multiplier
 * 1 when `null` is passed for an encroachment argument, and unrecognised values
 * are coerced to `null` by {@link coerceEncroachmentForBaseline}.
 */
const DEFAULT_ENCROACHMENT_MULTIPLIER = 1

/**
 * @param {object} feature
 * @param {string} condition
 * @returns {boolean}
 */
function isLinearFeatureReadyForEnrichment(feature, condition) {
  return (
    Boolean(condition) &&
    typeof feature.sizeMetres === 'number' &&
    Number.isFinite(feature.sizeMetres) &&
    feature.sizeMetres > 0 &&
    typeof feature.type === 'string' &&
    feature.type.length > 0
  )
}

/**
 * @param {object} feature
 * @returns {number} length in kilometres
 */
function setLengthAndGetKm(feature) {
  feature.length = Math.round(feature.sizeMetres)
  return feature.length / METRES_PER_KM
}

/**
 * @param {object} feature
 * @param {object} result
 * @param {Record<string, unknown>} [extraFields]
 */
function assignBaselineUnitFields(feature, result, extraFields = {}) {
  feature.distinctiveness = result.distinctiveness
  feature.distinctivenessScore = result.distinctivenessScore
  feature.conditionScore = result.conditionScore
  feature.units = result.units
  Object.assign(feature, extraFields)
}

/**
 * @param {() => object} calculate
 * @param {object} feature
 * @param {object} [options]
 * @param {{ warn: (msg: string) => void }} [options.logger]
 * @param {string} [options.layerLabel]
 * @param {(result: object) => Record<string, unknown>} [options.mapExtraFields]
 */
function enrichFeatureWithEngineCalculation(
  calculate,
  feature,
  {
    logger = NO_OP_LOGGER,
    layerLabel = 'feature',
    mapExtraFields = () => ({})
  } = {}
) {
  try {
    const result = calculate()
    assignBaselineUnitFields(feature, result, mapExtraFields(result))
    feature.status = HABITAT_STATUS.COMPLETE
  } catch (error) {
    if (error instanceof BaselineLookupError) {
      feature.status = HABITAT_STATUS.INCOMPLETE
      const featureId = feature.featureId ?? 'unknown'
      logger.warn(
        `${LOG_ENRICH_PREFIX}${layerLabel} featureId ${featureId} could not be calculated: ${error.message}`
      )
    } else {
      throw error
    }
  }
}

export function calculateAreaHabitatWithCandidates(sizeHa, habitat, condition) {
  let lastError = null
  for (const engineType of engineHabitatTypeCandidates(habitat)) {
    try {
      return calculateAreaHabitatBaseline(sizeHa, engineType, condition)
    } catch (error) {
      if (error instanceof BaselineLookupError) {
        lastError = error
      } else {
        throw error
      }
    }
  }
  if (lastError) {
    throw lastError
  } else {
    throw new BaselineLookupError('Habitat type is empty or unrecognised')
  }
}

function enrichHabitatParcelWithUnits(habitat, logger = NO_OP_LOGGER) {
  const condition = normalizeConditionForEngine(habitat.condition)
  const { area } = habitat

  if (
    condition &&
    typeof area === 'number' &&
    Number.isFinite(area) &&
    area > 0
  ) {
    const sizeHa = area / SQ_METRES_PER_HECTARE
    enrichFeatureWithEngineCalculation(
      () => calculateAreaHabitatWithCandidates(sizeHa, habitat, condition),
      habitat,
      { logger, layerLabel: 'Habitat parcel' }
    )
  } else {
    // condition or area missing / invalid — skip enrichment for this feature
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatUnrecognisedEncroachmentValue(value) {
  if (typeof value === 'object') {
    // null is handled upstream by isRecognisedEncroachmentValue, so value is a non-null object here
    return JSON.stringify(value)
  } else {
    return String(value) // NOSONAR S6551 — typeof guard above proves value is a primitive
  }
}

/**
 * @param {unknown} value
 * @param {Record<string, number>} lookupMap
 * @param {string} label
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {string | null}
 */
function coerceEncroachmentForBaseline(value, lookupMap, label, logger) {
  if (isRecognisedEncroachmentValue(value, lookupMap)) {
    return typeof value === 'string' ? value : null
  } else {
    logger.warn(
      `${LOG_ENRICH_PREFIX}unrecognised ${label} "${formatUnrecognisedEncroachmentValue(value)}" — defaulting encroachment multiplier to ${DEFAULT_ENCROACHMENT_MULTIPLIER}`
    )
    return null
  }
}

/**
 * @param {object} feature
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {{ watercourseEncroachment: string | null, riparianEncroachment: string | null }}
 */
export function resolvedWatercourseEncroachments(feature, logger) {
  return {
    watercourseEncroachment: coerceEncroachmentForBaseline(
      feature.watercourseEncroachment,
      WATERCOURSE_ENCROACHMENT_MULTIPLIER,
      'watercourse encroachment',
      logger
    ),
    riparianEncroachment: coerceEncroachmentForBaseline(
      feature.riparianEncroachment,
      WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
      'riparian encroachment',
      logger
    )
  }
}

/**
 * Enrich a hedgerow or watercourse feature with baseline units from the engine.
 *
 * @param {object} feature
 * @param {object} config
 * @param {(lengthKm: number, type: string, condition: string, context: { feature: object, logger: { warn: (msg: string) => void } }) => object} config.calculate
 *   Engine calculation function. Always receives `context` — hedgerow
 *   implementations can ignore it; watercourse implementations use it to
 *   resolve encroachment values from the feature and log warnings.
 * @param {{ warn: (msg: string) => void }} [config.logger]
 * @param {string} config.layerLabel
 * @param {(result: object) => Record<string, unknown>} [config.mapExtraFields]
 */
function enrichLinearFeatureWithUnits(
  feature,
  { calculate, logger = NO_OP_LOGGER, layerLabel, mapExtraFields = () => ({}) }
) {
  const condition = normalizeConditionForEngine(feature.condition)
  if (isLinearFeatureReadyForEnrichment(feature, condition)) {
    const lengthKm = setLengthAndGetKm(feature)
    enrichFeatureWithEngineCalculation(
      () => calculate(lengthKm, feature.type, condition, { feature, logger }),
      feature,
      { logger, layerLabel, mapExtraFields }
    )
  } else {
    // feature not ready for enrichment (missing type, condition, or size)
  }
}

function createWatercourseEnrichmentConfig(logger) {
  return {
    logger,
    layerLabel: 'Watercourse',
    calculate: (lengthKm, type, condition, { feature, logger: log }) => {
      const encroachments = resolvedWatercourseEncroachments(feature, log)
      return calculateWatercourseBaseline(
        lengthKm,
        type,
        condition,
        encroachments.watercourseEncroachment,
        encroachments.riparianEncroachment
      )
    },
    mapExtraFields: (result) => ({
      waterEncroachmentMultiplier: result.waterEncroachmentMultiplier,
      riparianEncroachmentMultiplier: result.riparianEncroachmentMultiplier
    })
  }
}

/**
 * Mutates `baselineDocument`: for each habitat parcel with a non-empty type,
 * condition, and positive finite `area` (m²), sets `distinctiveness`,
 * `distinctivenessScore`, `conditionScore`, and `units` from the engine. For
 * each hedgerow and watercourse feature with a non-empty type, condition, and
 * positive finite `sizeMetres`, sets the same fields (watercourses also get
 * `waterEncroachmentMultiplier` and `riparianEncroachmentMultiplier`). Rows
 * that lack required fields keep their extracted attributes and do not get
 * a `units` field. Rows where the engine rejects a lookup get
 * `status: 'Incomplete'` and a warning is logged. Always sets
 * `baselineDocument.units` totals afterward.
 *
 * Individual trees are enriched on the same path as area-habitat parcels.
 *
 * @param {{ habitats?: object[], trees?: object[], hedgerows?: object[], watercourses?: object[] }} baselineDocument
 * @param {{ warn: (msg: string) => void }} [logger]
 * @returns {typeof baselineDocument}
 */
export function enrichBaselineDocumentWithUnits(
  baselineDocument,
  logger = NO_OP_LOGGER
) {
  // Evidence (Item 8 — engine enrichment loops every feature inline): count the
  // features enriched and time the whole pass. Linear cost, but it runs on the
  // same synchronous request handler, stacking on top of parse + validate.
  const enrichStart = perfNow()
  const enrichedFeatureCount =
    (baselineDocument?.habitats?.length ?? 0) +
    (baselineDocument?.trees?.length ?? 0) +
    (baselineDocument?.hedgerows?.length ?? 0) +
    (baselineDocument?.watercourses?.length ?? 0)
  // Area-habitat parcels and individual trees enrich on the same path: a tree is
  // a special area habitat whose notional area (set on import from the per-size
  // reference) feeds the area-habitat unit calculation, with the engine resolving
  // "Individual trees - Urban/Rural tree" from its broad/habitat type.
  enrichCollectionIfNonEmpty(
    baselineDocument?.habitats,
    enrichHabitatParcelWithUnits,
    logger
  )
  enrichCollectionIfNonEmpty(
    baselineDocument?.trees,
    enrichHabitatParcelWithUnits,
    logger
  )

  const hedgerowConfig = {
    logger,
    layerLabel: 'Hedgerow',
    calculate: (lengthKm, type, condition) =>
      calculateHedgerowBaseline(lengthKm, type, condition)
  }
  enrichCollectionIfNonEmpty(
    baselineDocument?.hedgerows,
    (hedgerow) => enrichLinearFeatureWithUnits(hedgerow, hedgerowConfig),
    logger
  )

  const watercourseConfig = createWatercourseEnrichmentConfig(logger)
  enrichCollectionIfNonEmpty(
    baselineDocument?.watercourses,
    (watercourse) =>
      enrichLinearFeatureWithUnits(watercourse, watercourseConfig),
    logger
  )

  summarizeFeatureSetUnitsTotals(baselineDocument)
  logPerf(logger, 'enrich-inline-loop', {
    enrichedFeatureCount,
    enrichMs: Math.round(perfNow() - enrichStart)
  })
  return baselineDocument
}
