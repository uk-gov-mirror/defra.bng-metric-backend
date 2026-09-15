/**
 * Joi sub-schemas shared between project.js (baseline) and
 * post-intervention/project-post-intervention-schema.js.
 *
 * Extracted here to avoid circular imports between the two schema files.
 */
import Joi from 'joi'

import { MAX_FILE_SIZE_BYTES } from '../services/s3/download-file.js'

export const MAX_FILENAME_LENGTH = 255

// Whitelist-only approach addresses seven classes of attack in one rule:
//   1. Extension spoofing  — bidi overrides (U+202E etc.) not in [a-zA-Z0-9 ._()-]
//   2. Path traversal      — / excluded, so `../` cannot appear in the name
//   3. Log injection       — \n, \r and other control chars not in the set
//   4. Wrong extension     — \.gpkg$ is mandatory (case-insensitive)
//   5. Invisible chars      — zero-width / formatting codepoints not in the set
//   6. SQL injection       — ' " ; not in the set
//   7. Empty-looking names — the stem must hold at least one alphanumeric, so
//      `..gpkg` and `   .gpkg` are rejected, while `-copy.gpkg` is accepted
// Parentheses are included so browser/OS duplicate names such as
// `survey (1).gpkg` are accepted. Hyphen is last in each class so it is literal.
export const SAFE_FILENAME_RE = /^[ ._()-]*[a-z0-9][a-z0-9 ._()-]*\.gpkg$/i

/**
 * Every ref-keyed feature's `featureId` carries the same guarantee, so the
 * prose is shared. It is published in the data dictionary and read by the
 * external relational consumers as the row's primary key, so it needs to say
 * plainly what the id survives.
 *
 * @param {string} geometryRow the PostGIS table this id also keys
 * @returns {string}
 */
export const featureIdDescription = (geometryRow) =>
  `Stable UUID for the feature; join key to the ${geometryRow} geometry row and the primary key used by downstream relational consumers. Assigned on first import, preserved when the feature is edited, and carried forward on re-upload whenever the feature's ref is unchanged. Regenerated only when the feature is new, or when its ref is blank or shared with another feature.`

export const habitatSizesSummarySchema = Joi.object({
  areaHabitats: Joi.object({
    totalSquareMetres: Joi.number()
      .required()
      .description(
        'Total area-habitat size in m². On the baseline this is the headline "Area habitats" total and includes individual trees (parcels + trees); the per-document Site size excludes special habitats.'
      )
  }).required(),
  hedgerows: Joi.object({
    totalMetres: Joi.number()
      .required()
      .description('Total length of all hedgerows, in metres.')
  }).required(),
  watercourses: Joi.object({
    totalMetres: Joi.number()
      .required()
      .description('Total length of all watercourses, in metres.')
  }).required(),
  trees: Joi.object({
    totalSquareMetres: Joi.number()
      .required()
      .description('Total notional area of all individual trees, in m².'),
    urbanSquareMetres: Joi.number()
      .required()
      .description('Total notional area of urban trees, in m².'),
    ruralSquareMetres: Joi.number()
      .required()
      .description('Total notional area of rural trees, in m².')
  }).description(
    'Individual tree areas (notional, per-size reference). Absent when there are no trees (e.g. post-intervention).'
  ),
  site: Joi.object({
    totalSquareMetres: Joi.number()
      .required()
      .description(
        'Site size in m²: the sum of all habitat parcel areas, EXCLUDING special habitats (currently individual trees). For a valid GeoPackage this effectively equals the red line boundary area, so it is the figure checked against the RLB.'
      )
  }).description(
    'Site size (habitat parcels only, excluding special habitats such as individual trees). Absent when there are no trees.'
  )
})
  .allow(null)
  .description(
    'Total feature sizes by module, measured from geometry in PostGIS. Null until a baseline is imported.'
  )

export const baselineUnitsTotalsSchema = Joi.object({
  totalUnits: Joi.number()
    .required()
    .description('Sum of habitat, hedgerow and watercourse baseline units.'),
  habitatsTotal: Joi.number()
    .required()
    .description('Sum of baseline units across all area habitats.'),
  hedgerowsTotal: Joi.number()
    .required()
    .description('Sum of baseline units across all hedgerows.'),
  watercoursesTotal: Joi.number()
    .required()
    .description('Sum of baseline units across all watercourses.'),
  treesTotal: Joi.number()
    .required()
    .description('Sum of baseline units across all individual trees.'),
  treesUrbanTotal: Joi.number()
    .required()
    .description('Sum of baseline units across urban trees.'),
  treesRuralTotal: Joi.number()
    .required()
    .description('Sum of baseline units across rural trees.'),
  habitatsNetUnitChange: Joi.number().description(
    'Post-intervention only: total post-intervention area units minus total baseline area units.'
  ),
  habitatsNetUnitChangePercentage: Joi.number()
    .allow(null)
    .description(
      'Post-intervention only: area net unit change as a percentage of baseline area units. Null when the baseline area total is zero or unavailable.'
    ),
  hedgerowsNetUnitChange: Joi.number().description(
    'Post-intervention only: total post-intervention hedgerow units minus total baseline hedgerow units.'
  ),
  hedgerowsNetUnitChangePercentage: Joi.number()
    .allow(null)
    .description(
      'Post-intervention only: hedgerow net unit change as a percentage of baseline hedgerow units. Null when the baseline hedgerow total is zero or unavailable.'
    ),
  watercoursesNetUnitChange: Joi.number().description(
    'Post-intervention only: total post-intervention watercourse units minus total baseline watercourse units.'
  ),
  watercoursesNetUnitChangePercentage: Joi.number()
    .allow(null)
    .description(
      'Post-intervention only: watercourse net unit change as a percentage of baseline watercourse units. Null when the baseline watercourse total is zero or unavailable.'
    )
}).description('Baseline biodiversity unit totals, summed across features.')

// Trading rules. The per-habitat net-unit-change item is the area-habitat shape:
// habitat type plus the broad-habitat keys that module trades on. Watercourses
// use a smaller item of their own in the post-intervention schema.
export const tradingRulesHabitatNetChangeSchema = Joi.object({
  habitatType: Joi.string()
    .required()
    .description(
      'Engine habitat type the net unit change is aggregated for, as "{Broad habitat} - {Habitat type}" (e.g. "Lakes - Reservoirs").'
    ),
  broadHabitat: Joi.string()
    .required()
    .description(
      'Broad habitat the habitat type belongs to, taken from the part of the habitat type before the first " - " (e.g. "Lakes"). Not merged: this is the habitat\'s own broad habitat.'
    ),
  tradingBroadHabitat: Joi.string()
    .required()
    .description(
      'Broad habitat this habitat\'s net unit change is cumulated under for trading. It is the habitat\'s own broad habitat, except for a Medium habitat in one of the two intertidal broad habitats, which instead carries the merged group "Intertidal sediment and hard structures" — the trading rules treat those two as one. The merge is Medium-only: the Low band trades on distinctiveness alone, with no broad-habitat constraint, so a Low intertidal habitat keeps its own broad habitat. Grouping the Medium habitats by this field reproduces the cumulative broad-habitat figures exactly.'
    ),
  distinctiveness: Joi.string()
    .required()
    .description(
      'Distinctiveness band resolved from the bng-library/metric reference data. Only "Medium" and "Low" appear: Very Low habitats hold no units to trade, and the metric defines no traded figure for High or Very High.'
    ),
  netUnitChange: Joi.number()
    .required()
    .description(
      'Net unit change for the habitat type: summed retained + created + enhanced post-intervention units (attributed to the delivered habitat) minus summed baseline units. Positive is a surplus, negative a deficit.'
    )
}).description(
  'Net unit change for a single area habitat type across baseline and post-intervention.'
)

export const redLineSchema = Joi.object({
  featureId: Joi.string()
    .uuid()
    .required()
    .description(
      'Stable UUID for the Red Line Boundary; join key to the bng.baseline_red_line geometry row. There is at most one per document, so it is carried forward on re-upload without needing a ref.'
    ),
  siteName: Joi.string()
    .allow(null, '')
    .description('Site name from the GeoPackage Red Line Boundary layer.'),
  area: Joi.number()
    .allow(null)
    .description(
      'Site area as recorded in the GeoPackage Red Line Boundary layer (Area column).'
    ),
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Red Line Boundary layer.'
    )
})
  .allow(null)
  .description(
    'Red Line Boundary feature defining the site extent. Null until a baseline is imported.'
  )

export const featureDataEnvelopeFields = {
  uploadId: Joi.string()
    .uuid()
    .allow(null)
    .description(
      'CDP Uploader upload ID for the source GeoPackage. Null until a baseline is imported.'
    ),
  filename: Joi.string()
    .max(MAX_FILENAME_LENGTH)
    .pattern(SAFE_FILENAME_RE)
    .allow(null)
    .description(
      'Original filename of the uploaded GeoPackage. Constrained to a safe `*.gpkg` pattern.'
    ),
  fileSize: Joi.number()
    .integer()
    .min(0)
    .max(MAX_FILE_SIZE_BYTES)
    .allow(null)
    .description('Size of the uploaded GeoPackage, in bytes.'),
  importedAt: Joi.string()
    .isoDate()
    .description('ISO 8601 timestamp of when the data was imported.')
}
