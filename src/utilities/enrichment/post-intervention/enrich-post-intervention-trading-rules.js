// Post-intervention trading-rules enrichment (BMD-995).
//
// Runs after per-feature units and the unit totals are in place. It aggregates
// the already-computed unit figures by habitat type and distinctiveness band,
// then calls the bng-library/metric trading-rules calculator and writes the
// result under `postInterventionDocument.tradingRules.watercourses`.
//
// Baseline units per type come from the project's stored baseline document, not
// the post-intervention document: Lost baseline stretches still count towards a
// habitat's baseline total but are excluded from the post-intervention feature
// set, so they cannot be reconstructed from it.
//
// This module derives no Met / Not-met statuses (that is BMD-1002); it persists
// the unit figures only. The engine primitives are band-agnostic, so hedgerows
// and areas can add sibling keys under `tradingRules` following this pattern.

import { calculateWatercourseTradingRules } from 'bng-library/metric'

import {
  RETENTION_RETAINED,
  resolveRetentionCategory
} from './retention-category.js'

/**
 * The habitat type a post-intervention feature's units are attributed to.
 * Enhancement and creation deliver into the proposed habitat; a retained
 * feature keeps its baseline habitat (its proposed columns may be an "N/A"
 * placeholder, so the baseline type is authoritative).
 *
 * @param {object} feature
 * @returns {string | null | undefined}
 */
function deliveredTypeOf(feature) {
  if (resolveRetentionCategory(feature) === RETENTION_RETAINED) {
    return feature?.baseline?.type
  }
  return feature?.proposed?.type
}

/**
 * Sum the finite `units` of features grouped by a type accessor. Features with
 * a blank type or a non-finite unit value are skipped, mirroring the leniency
 * of the unit summariser (uncalculated rows never poison a total).
 *
 * @param {object[] | undefined} features
 * @param {(feature: object) => (string | null | undefined)} typeOf
 * @returns {Record<string, number>} type -> summed units
 */
function sumUnitsByType(features, typeOf) {
  const unitsByType = {}
  if (!Array.isArray(features)) {
    return unitsByType
  }
  for (const feature of features) {
    const type = typeOf(feature)
    const units = feature?.units
    if (
      typeof type === 'string' &&
      type.length > 0 &&
      typeof units === 'number' &&
      Number.isFinite(units)
    ) {
      unitsByType[type] = (unitsByType[type] ?? 0) + units
    }
  }
  return unitsByType
}

/**
 * Mutates `postInterventionDocument`: computes the watercourse trading-rules
 * unit figures (AC1 net unit change per habitat, AC2/AC3 Medium surplus and
 * deficit, AC4/AC5 Low net change and cumulative availability) and stores them
 * under `postInterventionDocument.tradingRules.watercourses`.
 *
 * Delivered units are grouped by the habitat type each feature delivers into:
 * the proposed type for created and enhanced features (enhancement moves units
 * between habitats), and the baseline type for retained features. Baseline
 * units are grouped by the baseline watercourse type from the stored baseline
 * document.
 *
 * @param {{ watercourses?: object[], tradingRules?: object }} postInterventionDocument
 * @param {object[]} [baselineWatercourses] the stored baseline watercourse features
 * @returns {typeof postInterventionDocument}
 */
export function enrichPostInterventionWatercourseTradingRules(
  postInterventionDocument,
  baselineWatercourses = []
) {
  const deliveredUnitsByType = sumUnitsByType(
    postInterventionDocument?.watercourses,
    deliveredTypeOf
  )
  const baselineUnitsByType = sumUnitsByType(
    baselineWatercourses,
    (feature) => feature?.type
  )

  const watercourses = calculateWatercourseTradingRules(
    baselineUnitsByType,
    deliveredUnitsByType
  )

  postInterventionDocument.tradingRules = {
    ...postInterventionDocument.tradingRules,
    watercourses
  }
  return postInterventionDocument
}
