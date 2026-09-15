// Post-intervention unit enrichment. Dispatches on `feature.retentionCategory`
// to call the correct bng-library/metric post-intervention calculator. The baseline
// sub-object is always enriched with the baseline engine (informational scores);
// only the primary units calculation on the proposed side uses the new functions.
//
// For Enhanced watercourses the caller must supply a pre-built Map<ref, lengthKm>
// from the project's stored baseline watercourses — see the third argument.

import {
  addPostInterventionNetUnitChanges,
  summarizeFeatureSetUnitsTotals
} from '../../features/feature-set-units.js'
import {
  NO_OP_LOGGER,
  enrichCollectionIfNonEmpty
} from '../shared/enrich-units-shared.js'
import { enrichPostInterventionAreaHabitat } from './enrich-post-intervention-area-habitat.js'
import { enrichPostInterventionHedgerowWithUnits } from './enrich-post-intervention-hedgerow.js'
import { enrichPostInterventionWatercourseWithUnits } from './enrich-post-intervention-watercourse.js'
import { enrichPostInterventionAreaTradingRules } from './enrich-post-intervention-area-trading-rules.js'
import { enrichPostInterventionWatercourseTradingRules } from './enrich-post-intervention-trading-rules.js'

/**
 * Mutates `postInterventionDocument`: for each feature, enriches the `proposed`
 * sub-object with units and scores from the appropriate post-intervention engine
 * function (selected by `retentionCategory`), and enriches the `baseline`
 * sub-object with informational distinctiveness/conditionScore. Always sets
 * `postInterventionDocument.units` totals afterward.
 *
 * For Enhanced watercourses the engine needs the baseline feature length. Pass
 * a `Map<parcelRef, lengthKm>` built from the project's stored baseline
 * watercourses as `options.baselineLengthByRef`; if missing, Enhanced watercourse
 * features will be marked Incomplete with a warning.
 *
 * @param {{ habitats?: object[], trees?: object[], hedgerows?: object[], watercourses?: object[] }} postInterventionDocument
 * @param {{ warn: (msg: string) => void }} [logger]
 * @param {{ baselineLengthByRef?: Map<string, number>, baselineUnits?: object, baselineDocument?: object }} [options]
 * @returns {typeof postInterventionDocument}
 */
export function enrichPostInterventionDocumentWithUnits(
  postInterventionDocument,
  logger = NO_OP_LOGGER,
  { baselineLengthByRef, baselineUnits, baselineDocument } = {}
) {
  enrichCollectionIfNonEmpty(
    postInterventionDocument?.habitats,
    (habitat, log) =>
      enrichPostInterventionAreaHabitat(habitat, log, 'Habitat parcel'),
    logger
  )
  // Individual trees are a special area habitat: they enrich on the same
  // baseline/proposed area path, with each side using its own notional area.
  enrichCollectionIfNonEmpty(
    postInterventionDocument?.trees,
    (tree, log) =>
      enrichPostInterventionAreaHabitat(tree, log, 'Individual tree'),
    logger
  )
  if (
    Array.isArray(postInterventionDocument?.hedgerows) &&
    postInterventionDocument.hedgerows.length > 0
  ) {
    for (const hedgerow of postInterventionDocument.hedgerows) {
      enrichPostInterventionHedgerowWithUnits(
        hedgerow,
        logger,
        baselineLengthByRef
      )
    }
  }
  if (
    Array.isArray(postInterventionDocument?.watercourses) &&
    postInterventionDocument.watercourses.length > 0
  ) {
    for (const watercourse of postInterventionDocument.watercourses) {
      enrichPostInterventionWatercourseWithUnits(
        watercourse,
        logger,
        baselineLengthByRef
      )
    }
  }

  summarizeFeatureSetUnitsTotals(postInterventionDocument)
  addPostInterventionNetUnitChanges(postInterventionDocument, baselineUnits)
  enrichPostInterventionAreaTradingRules(
    postInterventionDocument,
    baselineDocument,
    logger
  )
  enrichPostInterventionWatercourseTradingRules(
    postInterventionDocument,
    baselineDocument?.watercourses ?? []
  )
  return postInterventionDocument
}
