import { randomUUID } from 'node:crypto'

import { normaliseEncroachmentLabel } from 'bng-library/metric'

import { PROP_KEYS, featureKeysForVariant, pickProp } from '../properties.js'
import { cleanHabitatRef } from '../habitat-ref-check.js'
import {
  areaStatus,
  hedgerowStatus,
  watercourseStatus
} from '../../../services/baseline/calculate-baseline-statuses.js'
import {
  INDIVIDUAL_TREES_BROAD_HABITAT,
  treeHabitatTypeFromRuralUrban
} from '../tree-constants.js'
import { treeAreaFields } from '../tree-sizes.js'
import {
  splitFeatures,
  embedBaselineHabitatSizes,
  buildExtractResult
} from '../extract-shared.js'
import { stripConditionPrefix } from '../../../utilities/enrichment/shared/condition.js'
import { irreplaceableField } from '../irreplaceable.js'

// Survey / provenance / planning metadata columns common to the Habitats,
// Hedgerows and Rivers layers. These are single shared columns (no
// baseline/proposed variant), so they are read the same way for both document
// variants. Each entry is [documentField, propertyKeyAliases]; the matching
// Joi keys live in project.js (metadataSchemaKeys).
const METADATA_PROPS = [
  ['siteName', PROP_KEYS.siteName],
  ['surveyDate', PROP_KEYS.surveyDate],
  ['surveyDetails', PROP_KEYS.surveyDetails],
  ['comment', PROP_KEYS.comment],
  ['mappedBy', PROP_KEYS.mappedBy],
  ['company', PROP_KEYS.company],
  ['baseMap', PROP_KEYS.baseMap],
  ['location', PROP_KEYS.location],
  ['spatialRiskCategory', PROP_KEYS.spatialRiskCategory],
  ['habitatCreatedInAdvanceYears', PROP_KEYS.habitatCreatedInAdvanceYears],
  [
    'delayInStartingHabitatCreationYears',
    PROP_KEYS.delayInStartingHabitatCreationYears
  ]
]

/**
 * Resolve a list of [fieldName, keyAliases] entries against a properties bag.
 *
 * @param {object} props
 * @param {Array<[string, string[]]>} entries
 * @returns {Record<string, unknown>}
 */
function pickProps(props, entries) {
  return Object.fromEntries(
    entries.map(([name, keys]) => [name, pickProp(props, keys)])
  )
}

function buildHabitat(feature, keys) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const habitatType = pickProp(props, keys.habitatType)
  const ref = cleanHabitatRef(pickProp(props, keys.parcelRef))

  // NOTE: distinctiveness and distinctivenessScore are not included here because
  // they are calculated separately by the metric engine. rawDistinctiveness is
  // the verbatim GeoPackage distinctiveness column (Baseline/Proposed by variant),
  // preserved for reference only.
  // NOTE2: area is set from PostGIS habitatSizes (sizeSquareMetres) in extractHabitatData.

  const document = {
    featureId,
    ref,
    type: habitatType,
    broadType: pickProp(props, keys.broadHabitat),
    condition: stripConditionPrefix(pickProp(props, keys.condition)),
    strategicSignificance: pickProp(props, keys.strategicSignificance),
    retentionCategory: pickProp(props, PROP_KEYS.retentionCategory),
    ...irreplaceableField(props),
    rawDistinctiveness: pickProp(props, keys.rawDistinctiveness),
    ...pickProps(props, METADATA_PROPS),
    properties: props
  }
  document.status = areaStatus(document)
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    geometryJson: feature.geometryJson,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildTree(feature, keys) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const ref = pickProp(props, keys.treeRef)
  const treeSize = pickProp(props, keys.treeSize)
  const ruralOrUrban = pickProp(props, keys.ruralOrUrbanTree)

  const document = {
    featureId,
    ref,
    // Trees are treated as an area habitat: broad "Individual trees" with an
    // urban/rural habitat type that the engine reference data is keyed on.
    type: treeHabitatTypeFromRuralUrban(ruralOrUrban),
    broadType: INDIVIDUAL_TREES_BROAD_HABITAT,
    treeSize,
    treeSpecies: pickProp(props, keys.treeType),
    ruralOrUrban,
    count: pickProp(props, PROP_KEYS.treeCount),
    condition: stripConditionPrefix(pickProp(props, keys.condition)),
    strategicSignificance: pickProp(props, keys.strategicSignificance),
    retentionCategory: pickProp(props, PROP_KEYS.retentionCategory),
    ...pickProps(props, METADATA_PROPS),
    properties: props
  }
  const { sizeSquareMetres, area } = treeAreaFields(treeSize, document.count)
  document.sizeSquareMetres = sizeSquareMetres
  document.area = area
  document.status = areaStatus(document)

  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    geometryJson: feature.geometryJson,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildLinearFeature(
  feature,
  keys,
  typeKey,
  extraProperties,
  statusForDocument
) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const ref = cleanHabitatRef(pickProp(props, keys.parcelRef))
  const extraDocumentProperties = pickProps(props, extraProperties)

  const document = {
    featureId,
    ref,
    type: pickProp(props, typeKey),
    condition: stripConditionPrefix(pickProp(props, keys.condition)),
    ...extraDocumentProperties,
    properties: props
  }
  document.status = statusForDocument(document)
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    geometryJson: feature.geometryJson,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildHedgerow(feature, keys) {
  return buildLinearFeature(
    feature,
    keys,
    keys.hedgerowType,
    [
      ['strategicSignificance', keys.strategicSignificance],
      ['retentionCategory', PROP_KEYS.retentionCategory],
      ['rawDistinctiveness', keys.rawDistinctiveness],
      ...METADATA_PROPS
    ],
    hedgerowStatus
  )
}

function buildWatercourse(feature, keys) {
  const { document, geometryRow } = buildLinearFeature(
    feature,
    keys,
    keys.riverType,
    [
      ['riparianEncroachment', keys.riparianEncroachment],
      ['watercourseEncroachment', keys.watercourseEncroachment],
      ['strategicSignificance', keys.strategicSignificance],
      ['retentionCategory', PROP_KEYS.retentionCategory],
      ['enhancementType', PROP_KEYS.enhancementType],
      ['rawDistinctiveness', keys.rawDistinctiveness],
      ...METADATA_PROPS
    ],
    watercourseStatus
  )
  if (typeof document.riparianEncroachment === 'string') {
    document.riparianEncroachment = normaliseEncroachmentLabel(
      document.riparianEncroachment
    )
  }
  if (typeof document.watercourseEncroachment === 'string') {
    document.watercourseEncroachment = normaliseEncroachmentLabel(
      document.watercourseEncroachment
    )
  }
  return { document, geometryRow }
}

function buildRedLine(features) {
  const feature = features?.[0]
  if (!feature) {
    return { document: null, geometryRow: null }
  }
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  return {
    document: {
      featureId,
      siteName: pickProp(props, PROP_KEYS.siteName),
      area: pickProp(props, PROP_KEYS.area),
      properties: props
    },
    geometryRow: {
      featureId,
      geometry: feature.nativeGeometry,
      geometryJson: feature.geometryJson,
      srid: feature.nativeSrid
    }
  }
}

/**
 * Shape an already-parsed `layers` object (from readGeoPackage) into
 * (a) the JSONB document persisted onto bng.projects.project.baseline (attribute
 * data only, no geometry), and (b) the parallel geometry rows for the four
 * bng.baseline_* PostGIS tables.
 *
 * Each feature carries a UUID `featureId` that appears in both halves; it is
 * the join key between the JSONB document and the geometry tables. It is
 * stamped upstream by assign-feature-ids.js, which reuses the id already stored
 * for a matching `ref` so a re-upload does not re-key the whole site.
 *
 * @param {object} layers
 * @param {object[]} layers.redline
 * @param {object[]} layers.areas
 * @param {object[]} layers.hedgerows
 * @param {object[]} layers.watercourses
 * @param {object} [meta]
 * @param {string} [meta.uploadId]
 * @param {string} [meta.filename]
 * @param {number} [meta.fileSize]
 * @param {string} [meta.importedAt] ISO timestamp; defaults to now
 * @param {object} [meta.habitatSizes] pre-calculated habitat sizes from calculateHabitatSizes
 * @returns {{
 *   document: object,
 *   geometries: {
 *     redLine: object|null,
 *     habitats: object[],
 *     hedgerows: object[],
 *     watercourses: object[]
 *   }
 * }}
 */
export function extractHabitatData(layers, meta = {}) {
  // `meta.variant` selects which attribute columns to read: the baseline
  // document reads the Baseline* columns, the post-intervention document reads
  // the Proposed* columns. Shared columns (ref, retention, metadata) are read
  // the same way for both.
  const keys = featureKeysForVariant(meta.variant)
  const redLine = buildRedLine(layers.redline)
  const habitats = splitFeatures(layers.areas ?? [], buildHabitat, keys)
  const hedgerows = splitFeatures(layers.hedgerows ?? [], buildHedgerow, keys)
  const watercourses = splitFeatures(
    layers.watercourses ?? [],
    buildWatercourse,
    keys
  )
  const trees = splitFeatures(layers.trees ?? [], buildTree, keys)

  // Embed the PostGIS-calculated size directly onto each feature document so
  // consumers (e.g. the frontend) can read habitat.sizeSquareMetres without a
  // secondary join. featureId is the join key between the sizes result and the documents.
  let habitatSizesSummary = null
  if (meta.habitatSizes) {
    habitatSizesSummary = embedBaselineHabitatSizes(
      { habitats, hedgerows, watercourses, trees },
      meta.habitatSizes
    )
  }

  return buildExtractResult(
    meta,
    { redLine, habitats, hedgerows, watercourses, trees },
    habitatSizesSummary
  )
}
