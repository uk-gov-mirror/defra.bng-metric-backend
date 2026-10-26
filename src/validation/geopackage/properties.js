// Property keys as written by Natural England QGIS templates. Lookups are
// case-insensitive (see pickProp) because some real-world files use
// underscored variants ("parcel_ref") or different casing.
export const PROPOSED_PROP_KEYS = {
  habitatType: ['Proposed Habitat Type'],
  broadHabitat: ['Proposed Broad Habitat Type'],
  hedgerowType: ['Proposed Hedge Type'],
  riverType: ['Proposed River Type'],
  condition: ['Proposed Condition'],
  strategicSignificance: ['Proposed Strategic Significance'],
  watercourseEncroachment: ['Proposed Encroachment into Watercourse'],
  riparianEncroachment: ['Proposed Encroachment into riparian zone'],
  advanceYears: ['Habitat created in advance/years'],
  delayYears: ['Delay in starting habitat creation/years']
}

// The Urban Trees layer names its advance/delay columns differently from the
// Habitats, Hedgerows and Rivers layers (see gpkg-template.schema.json), so
// trees read these instead of PROPOSED_PROP_KEYS.advanceYears/delayYears.
export const TREE_ADVANCE_DELAY_KEYS = {
  advanceYears: ['Habitat Created/Enhanced in advance/years'],
  delayYears: ['Delay in starting habitat creation/enhancement in years']
}

export const PROP_KEYS = {
  parcelRef: ['Parcel Ref', 'Parcel_Ref', 'parcel_ref'],
  habitatType: ['Baseline Habitat Type', 'Baseline_Habitat_Type'],
  broadHabitat: ['Baseline Broad Habitat Type', 'Baseline_Broad_Habitat_Type'],
  hedgerowType: ['Baseline Hedge Type', 'Baseline_Hedge_Type'],
  riverType: ['Baseline River Type', 'Baseline_River_Type'],
  condition: ['Baseline Condition', 'Baseline_Condition'],
  strategicSignificance: [
    'Baseline Strategic Significance',
    'Baseline_Strategic_Significance'
  ],
  watercourseEncroachment: [
    'Baseline Encroachment into Watercourse',
    'Baseline_Encroachment_into_Watercourse'
  ],
  riparianEncroachment: [
    'Baseline Encroachment into riparian zone',
    'Baseline_Encroachment_into_riparian_zone'
  ],
  retentionCategory: ['Retention Category', 'Retention_Category'],
  // BNG Service template area habitats only: the legacy template has none.
  irreplaceable: ['Irreplaceable Habitat'],
  area: ['Area', 'Shape_Area'],
  length: ['Length', 'Shape_Length'],
  // Survey / provenance / planning metadata columns shared (with minor
  // spelling differences) across the Habitats, Hedgerows and Rivers layers.
  // Promoted to named fields by BMD-498 so the baseline record carries them
  // explicitly rather than only inside the verbatim `properties` blob.
  siteName: ['Site Name', 'Site_Name'],
  surveyDate: ['Survey Date', 'Survey_Date'],
  surveyDetails: ['Survey Details', 'Survey_Details'],
  // Habitats spell it "Comment"; Hedgerows and Rivers use "Comments".
  comment: ['Comment', 'Comments', 'Comment_s'],
  mappedBy: ['Mapped by', 'Mapped_by'],
  company: ['Company'],
  baseMap: ['Base Map', 'Base_Map'],
  location: ['Location'],
  spatialRiskCategory: ['Spatial risk category', 'Spatial_risk_category'],
  habitatCreatedInAdvanceYears: [
    'Habitat created in advance/years',
    'Habitat_created_in_advance/years'
  ],
  delayInStartingHabitatCreationYears: [
    'Delay in starting habitat creation/years',
    'Delay_in_starting_habitat_creation/years'
  ],
  baselineDistinctiveness: [
    'Baseline Distinctiveness',
    'Baseline_Distinctiveness'
  ],
  // Rivers layer only.
  enhancementType: ['Enhancement Type', 'Enhancement_Type'],
  // Urban Trees layer. `ref`, condition, strategic significance, retention and
  // metadata reuse the shared keys above; these are tree-specific columns.
  treeRef: ['Tree Ref', 'Tree_Ref', 'tree_ref'],
  treeSize: ['Baseline Tree Size', 'Baseline_Tree_Size'],
  treeType: ['Baseline Tree Type', 'Baseline_Tree_Type'],
  ruralOrUrbanTree: [
    'Baseline Rural or Urban Tree',
    'Baseline_Rural_or_Urban_Tree'
  ],
  treeCount: ['Count'],
  proposedTreeSize: ['Proposed Tree Size', 'Proposed_Tree_Size'],
  proposedTreeType: ['Proposed Tree Type', 'Proposed_Tree_Type'],
  proposedRuralOrUrbanTree: [
    'Proposed Rural or Urban Tree',
    'Proposed_Rural_or_Urban_Tree'
  ],
  // Proposed (post-intervention) counterparts of the baseline-prefixed columns.
  // The NE template carries the proposed design in these columns; the
  // post-intervention save path reads them instead of the Baseline* columns
  // (see featureKeysForVariant).
  proposedHabitatType: ['Proposed Habitat Type', 'Proposed_Habitat_Type'],
  proposedBroadHabitat: [
    'Proposed Broad Habitat Type',
    'Proposed_Broad_Habitat_Type'
  ],
  proposedHedgerowType: ['Proposed Hedge Type', 'Proposed_Hedge_Type'],
  proposedRiverType: ['Proposed River Type', 'Proposed_River_Type'],
  proposedCondition: ['Proposed Condition', 'Proposed_Condition'],
  proposedStrategicSignificance: [
    'Proposed Strategic Significance',
    'Proposed_Strategic_Significance'
  ],
  proposedWatercourseEncroachment: [
    'Proposed Encroachment into Watercourse',
    'Proposed_Encroachment_into_Watercourse'
  ],
  proposedRiparianEncroachment: [
    'Proposed Encroachment into riparian zone',
    'Proposed_Encroachment_into_riparian_zone'
  ],
  proposedDistinctiveness: [
    'Proposed Distinctiveness',
    'Proposed_Distinctiveness'
  ],
  // fid is a GeoPackage-mandated lowercase column, so no real spelling
  // variants — listed here for consistency with the other property reads.
  fid: ['fid']
}

/** Document variants that select which set of attribute columns to read. */
export const EXTRACT_VARIANT = {
  BASELINE: 'baseline',
  POST_INTERVENTION: 'postIntervention'
}

// Logical fields read from a single shared column regardless of variant.
const SHARED_FEATURE_KEYS = ['parcelRef', 'treeRef']

// Logical fields whose source column differs between the baseline and
// post-intervention (proposed) documents, mapped to their [baseline, proposed]
// PROP_KEYS entries.
const VARIANT_FEATURE_KEYS = {
  habitatType: ['habitatType', 'proposedHabitatType'],
  broadHabitat: ['broadHabitat', 'proposedBroadHabitat'],
  hedgerowType: ['hedgerowType', 'proposedHedgerowType'],
  riverType: ['riverType', 'proposedRiverType'],
  condition: ['condition', 'proposedCondition'],
  strategicSignificance: [
    'strategicSignificance',
    'proposedStrategicSignificance'
  ],
  watercourseEncroachment: [
    'watercourseEncroachment',
    'proposedWatercourseEncroachment'
  ],
  riparianEncroachment: [
    'riparianEncroachment',
    'proposedRiparianEncroachment'
  ],
  rawDistinctiveness: ['baselineDistinctiveness', 'proposedDistinctiveness'],
  treeSize: ['treeSize', 'proposedTreeSize'],
  treeType: ['treeType', 'proposedTreeType'],
  ruralOrUrbanTree: ['ruralOrUrbanTree', 'proposedRuralOrUrbanTree']
}

/**
 * Resolve the logical attribute fields whose source column differs between the
 * baseline and post-intervention (proposed) documents. Fields not listed here
 * (parcel ref, retention category, survey/provenance metadata, enhancement
 * type, area/length) come from a single shared column regardless of variant
 * and are read with PROP_KEYS directly.
 *
 * @param {string} [variant] one of EXTRACT_VARIANT; defaults to baseline
 * @returns {Record<string, string[]>}
 */
export function featureKeysForVariant(variant = EXTRACT_VARIANT.BASELINE) {
  const proposed = variant === EXTRACT_VARIANT.POST_INTERVENTION
  const keys = {}
  for (const field of SHARED_FEATURE_KEYS) {
    keys[field] = PROP_KEYS[field]
  }
  for (const [field, [baselineKey, proposedKey]] of Object.entries(
    VARIANT_FEATURE_KEYS
  )) {
    keys[field] = PROP_KEYS[proposed ? proposedKey : baselineKey]
  }
  return keys
}

/**
 * lowercased key -> original key, per properties bag.
 *
 * The case-insensitive fallback below used to rebuild this index on every call.
 * pickProp runs ~17 times per feature (six named columns plus the shared
 * metadata block) and most of those miss the exact-match pass on a real file,
 * so a large upload rebuilt the index tens of thousands of times — profiling a
 * 40k-parcel extract put pickProp at 50% of all CPU. Building it once per bag
 * costs one Map per feature and took that extract from ~1425ms to ~370ms.
 *
 * Keyed on the properties object itself and holding no strong reference, so an
 * entry lives exactly as long as the feature it belongs to. Safe because
 * nothing in the pipeline mutates a properties bag after parsing — the index
 * describes which keys exist, not their values.
 */
const loweredKeysByProperties = new WeakMap()

function loweredKeys(properties) {
  const cached = loweredKeysByProperties.get(properties)
  if (cached) {
    return cached
  }
  const lowered = new Map(
    Object.keys(properties).map((k) => [k.toLowerCase(), k])
  )
  // Always an object by this point: the exact-match pass above uses `in`,
  // which throws on a primitive, so a non-object bag never reaches here.
  loweredKeysByProperties.set(properties, lowered)
  return lowered
}

export function pickProp(properties, candidates) {
  if (!properties) {
    return null
  }
  for (const key of candidates) {
    if (key in properties && properties[key] != null) {
      return properties[key]
    }
  }
  const lowered = loweredKeys(properties)
  for (const key of candidates) {
    const hit = lowered.get(key.toLowerCase())
    if (hit && properties[hit] != null) {
      return properties[hit]
    }
  }
  return null
}

const BROAD_TYPE_SEPARATOR = ' - '

/**
 * Build the habitat lookup key used by getDistinctiveness — the full
 * "<broad> - <type>" string the reference table is keyed on. Real
 * QGIS-authored GeoPackages split this across two columns (broad habitat +
 * habitat type), so we read both and concatenate. Some legacy fixtures (and a
 * few inputs in the wild) already store the full name in the habitat-type
 * column; those are passed through unchanged so the lookup still works.
 *
 * `keys` selects which columns to read (Baseline* vs Proposed*) so the same
 * lookup works for both the baseline and post-intervention documents; it
 * defaults to the baseline columns.
 *
 * Returns null when neither column carries a usable value.
 *
 * @param {object} properties
 * @param {{ habitatType: string[], broadHabitat: string[] }} [keys]
 */
export function buildHabitatLookupKey(
  properties,
  keys = featureKeysForVariant()
) {
  const habitatType = pickProp(properties, keys.habitatType)
  if (!habitatType || typeof habitatType !== 'string') {
    return null
  }
  if (habitatType.includes(BROAD_TYPE_SEPARATOR)) {
    return habitatType
  }
  const broad = pickProp(properties, keys.broadHabitat)
  if (!broad || typeof broad !== 'string') {
    return habitatType
  }
  return `${broad}${BROAD_TYPE_SEPARATOR}${habitatType}`
}
