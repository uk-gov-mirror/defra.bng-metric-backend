// Derives the relational view of the project JSONB document — the shape the
// external PowerBI / Synapse warehouse maps our payload into.
//
// This module decides *what* the tables are; warehouse-erd-render.js turns the
// result into the published markdown. Pure: the driver (gen-warehouse-erd.js)
// supplies the schema and writes the file, so every function here is
// unit-testable.
//
// Source of truth is projectSchema.describe(), the same input the data
// dictionary walks. The table layout below is the only hand-authored part; the
// columns and their types are derived, so a field added to the Joi schema shows
// up in the contract automatically — or fails the build if it lands somewhere
// the layout does not account for (see assignPathToTable).

const DOCUMENT_KEYS = Object.freeze(['baseline', 'postIntervention'])

/**
 * Columns that exist on the warehouse side but not in the JSONB document —
 * they come from the bng.projects row envelope or are the derived keys that
 * make the relational shape navigable.
 */
const PROJECT_ENVELOPE_COLUMNS = Object.freeze([
  { name: 'user_id', type: 'text', note: 'bng.projects.user_id' },
  { name: 'org_id', type: 'text', note: 'bng.projects.org_id' },
  {
    name: 'relationship_id',
    type: 'text',
    note: 'bng.projects.relationship_id'
  },
  { name: 'created_at', type: 'timestamptz', note: 'bng.projects.created_at' },
  {
    name: 'updated_at',
    type: 'timestamptz',
    note: 'bng.projects.updated_at — the row watermark for ordering deliveries'
  }
])

/**
 * The warehouse table layout.
 *
 * `sources` are JSON path prefixes; every declared leaf path is assigned to the
 * table whose longest source prefix it starts under. Two document keys sharing
 * one source list (feature_set and friends) means the two subtrees land in one
 * table discriminated by `document_key`.
 */
const TABLES = Object.freeze([
  {
    table: 'project',
    sources: [''],
    primaryKey: {
      column: 'project_id',
      type: 'uuid',
      derivation: 'bng.projects.id — the existing Postgres UUID, reused as-is'
    },
    envelope: PROJECT_ENVELOPE_COLUMNS,
    highlight: ['name'],
    description: 'One row per BNG project.'
  },
  {
    table: 'project_site',
    sources: ['site'],
    primaryKey: {
      column: 'site_id',
      type: 'text',
      derivation: '`{projectId}:site`'
    },
    parent: { table: 'project', column: 'project_id', type: 'uuid' },
    highlight: ['name', 'grid_ref'],
    description: 'Development site details. Exactly one per project.'
  },
  {
    table: 'project_units',
    sources: ['units'],
    primaryKey: {
      column: 'units_id',
      type: 'text',
      derivation: '`{projectId}:units`'
    },
    parent: { table: 'project', column: 'project_id', type: 'uuid' },
    highlight: ['habitat', 'hedgerow', 'watercourse'],
    description:
      'Project-level biodiversity unit summary. Exactly one per project.'
  },
  {
    table: 'project_details',
    sources: ['details'],
    primaryKey: {
      column: 'details_id',
      type: 'text',
      derivation: '`{projectId}:details`'
    },
    parent: { table: 'project', column: 'project_id', type: 'uuid' },
    highlight: ['local_planning_authority', 'development_type'],
    description:
      'Project details entered by the user. Exactly one per project; null until the user fills them in.'
  },
  {
    table: 'feature_set',
    sources: DOCUMENT_KEYS,
    primaryKey: {
      column: 'feature_set_id',
      type: 'text',
      derivation: '`{projectId}:{documentKey}`'
    },
    parent: { table: 'project', column: 'project_id', type: 'uuid' },
    // Up to two per project: one per document key.
    many: true,
    discriminator: {
      name: 'document_key',
      type: 'text',
      note: "'baseline' or 'postIntervention' — which subtree the row came from"
    },
    highlight: ['upload_id', 'filename', 'imported_at'],
    description:
      'One row per imported document per project: the GeoPackage upload that produced it.'
  },
  {
    table: 'feature_set_units',
    sources: DOCUMENT_KEYS.map((key) => `${key}.units`),
    primaryKey: {
      column: 'feature_set_units_id',
      type: 'text',
      derivation: '`{projectId}:{documentKey}:units`'
    },
    parent: { table: 'feature_set', column: 'feature_set_id', type: 'text' },
    highlight: ['total_units', 'habitats_total'],
    description:
      'Biodiversity unit totals for one document, summed across its features.'
  },
  {
    table: 'feature_set_habitat_sizes',
    sources: DOCUMENT_KEYS.map((key) => `${key}.habitatSizes`),
    primaryKey: {
      column: 'habitat_sizes_id',
      type: 'text',
      derivation: '`{projectId}:{documentKey}:habitatSizes`'
    },
    parent: { table: 'feature_set', column: 'feature_set_id', type: 'text' },
    highlight: [
      'area_habitats_total_square_metres',
      'site_total_square_metres'
    ],
    description:
      'Total feature sizes by module, measured from geometry in PostGIS. The five sub-groups in the JSON are flattened into one row.'
  },
  {
    table: 'feature_set_trading_rules',
    sources: ['postIntervention.tradingRules'],
    primaryKey: {
      column: 'trading_rules_id',
      type: 'text',
      derivation: '`{projectId}:postIntervention:tradingRules`'
    },
    parent: { table: 'feature_set', column: 'feature_set_id', type: 'text' },
    highlight: [
      'area_habitats_medium_surplus',
      'area_habitats_low_cumulative_availability',
      'watercourses_medium_surplus',
      'watercourses_low_cumulative_availability'
    ],
    description:
      'Trading-rules unit figures for the post-intervention document (area habitats and watercourses today; hedgerows follow). Absent on the baseline feature set.'
  },
  {
    table: 'feature_set_trading_rules_area_habitat_types',
    sources: ['postIntervention.tradingRules.areaHabitats.habitatTypes[]'],
    primaryKey: {
      column: 'trading_rules_area_habitat_type_id',
      type: 'text',
      derivation:
        '`{projectId}:postIntervention:tradingRules:areaHabitats:{habitatType}`'
    },
    parent: {
      table: 'feature_set_trading_rules',
      column: 'trading_rules_id',
      type: 'text'
    },
    many: true,
    highlight: ['habitat_type', 'broad_habitat', 'net_unit_change'],
    description:
      'Area-habitat net unit change per habitat type. One row per unique Medium or Low habitat TYPE — not per feature: the units of every parcel and tree of a type are summed before this row is written. Individual trees are included.'
  },
  {
    table: 'feature_set_trading_rules_area_broad_habitats',
    sources: [
      'postIntervention.tradingRules.areaHabitats.medium.broadHabitats[]'
    ],
    primaryKey: {
      column: 'trading_rules_area_broad_habitat_id',
      type: 'text',
      derivation:
        '`{projectId}:postIntervention:tradingRules:areaHabitats:medium:{broadHabitat}`'
    },
    parent: {
      table: 'feature_set_trading_rules',
      column: 'trading_rules_id',
      type: 'text'
    },
    many: true,
    highlight: ['broad_habitat', 'net_unit_change'],
    description:
      'Cumulative Medium-band net unit change per broad habitat, with intertidal sediment and intertidal hard structures merged into one row: the trading rules treat those two as one broad habitat.'
  },
  {
    table: 'feature_set_trading_rules_watercourse_habitats',
    sources: ['postIntervention.tradingRules.watercourses.habitats[]'],
    primaryKey: {
      column: 'trading_rules_watercourse_habitat_id',
      type: 'text',
      derivation:
        '`{projectId}:postIntervention:tradingRules:watercourses:{habitatType}`'
    },
    parent: {
      table: 'feature_set_trading_rules',
      column: 'trading_rules_id',
      type: 'text'
    },
    many: true,
    highlight: ['habitat_type', 'distinctiveness', 'net_unit_change'],
    description:
      'Per-habitat-type watercourse net unit change (BMD-995 AC1). One row per unique watercourse type.'
  }
])

/**
 * The feature layers. Baseline and post-intervention get separate tables rather
 * than one discriminated table: post-intervention features carry nested
 * `baseline` / `proposed` blocks that the baseline features do not, so a union
 * would be mostly nulls.
 */
const FEATURE_LAYERS = Object.freeze([
  { layer: 'redLine', suffix: 'red_line', singular: true },
  { layer: 'habitats', suffix: 'habitats', singular: false },
  { layer: 'trees', suffix: 'trees', singular: false },
  { layer: 'hedgerows', suffix: 'hedgerows', singular: false },
  { layer: 'watercourses', suffix: 'watercourses', singular: false }
])

const DOCUMENT_TABLE_PREFIX = Object.freeze({
  baseline: 'baseline',
  postIntervention: 'post_intervention'
})

const FEATURE_PRIMARY_KEY = Object.freeze({
  column: 'feature_id',
  type: 'uuid',
  derivation:
    "the feature's own `featureId` — also the PK of the matching PostGIS geometry row"
})

const FEATURE_HIGHLIGHT = Object.freeze(['ref', 'type', 'status', 'units'])
const RED_LINE_HIGHLIGHT = Object.freeze(['site_name', 'area'])

/**
 * Expand the ten feature tables from the layer × document-key grid.
 *
 * @returns {object[]}
 */
function featureTables() {
  const tables = []
  for (const documentKey of DOCUMENT_KEYS) {
    for (const { layer, suffix, singular } of FEATURE_LAYERS) {
      const source = singular
        ? `${documentKey}.${layer}`
        : `${documentKey}.${layer}[]`
      tables.push({
        table: `${DOCUMENT_TABLE_PREFIX[documentKey]}_${suffix}`,
        sources: [source],
        primaryKey: FEATURE_PRIMARY_KEY,
        parent: {
          table: 'feature_set',
          column: 'feature_set_id',
          type: 'text'
        },
        many: !singular,
        highlight: singular ? RED_LINE_HIGHLIGHT : FEATURE_HIGHLIGHT,
        description: singular
          ? `Red Line Boundary defining the site extent (${documentKey}). At most one per document.`
          : `${layer} in the ${documentKey} document.`
      })
    }
  }
  return tables
}

/** All tables, ordered as they should appear in the document. */
export function warehouseTables() {
  return [...TABLES, ...featureTables()]
}

// --- schema walk -----------------------------------------------------------

/**
 * True when a Joi node is an open map — `.unknown(true)` with no declared keys
 * (the verbatim `*.properties` GeoPackage blobs). These stay a single jsonb
 * column: their keys are arbitrary and vary by source file.
 */
function isOpenMap(node) {
  return node.type === 'object' && node.flags?.unknown === true && !node.keys
}

function hasRule(node, name) {
  return Boolean(node.rules?.some((rule) => rule.name === name))
}

function stringSqlType(node) {
  // Joi's .uuid() is an alias for .guid(); describe() reports the latter.
  if (hasRule(node, 'guid')) {
    return 'uuid'
  }
  if (hasRule(node, 'isoDate')) {
    return 'timestamptz'
  }
  return 'text'
}

/**
 * @param {object} node a Joi describe() node
 * @returns {string} the SQL type we advertise for the column
 */
function sqlType(node) {
  if (node.type === 'number') {
    return hasRule(node, 'integer') ? 'integer' : 'numeric'
  }
  if (node.type === 'string') {
    return stringSqlType(node)
  }
  if (node.type === 'object' || node.type === 'array') {
    return 'jsonb'
  }
  return 'text'
}

function childPath(basePath, key) {
  return basePath ? `${basePath}.${key}` : key
}

/**
 * Walk a Joi describe() tree into the flat list of leaf paths — the things that
 * become columns. Containers (objects with keys, arrays) are structure, not
 * data, so they are not emitted.
 *
 * @param {object} node
 * @param {string} path
 * @param {Array<{path: string, type: string, openMap: boolean}>} out
 */
export function schemaLeaves(node, path = '', out = []) {
  if (isOpenMap(node)) {
    out.push({ path, type: 'jsonb', openMap: true })
    return out
  }
  if (node.type === 'object' && node.keys) {
    for (const [key, child] of Object.entries(node.keys)) {
      schemaLeaves(child, childPath(path, key), out)
    }
    return out
  }
  const item = node.type === 'array' ? node.items?.[0] : undefined
  if (item) {
    schemaLeaves(item, `${path}[]`, out)
    return out
  }
  out.push({ path, type: sqlType(node), openMap: false })
  return out
}

// --- path → column mapping -------------------------------------------------

const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g

/**
 * `areaHabitats.totalSquareMetres` → `area_habitats_total_square_metres`
 *
 * @param {string} remainder path relative to the table's source prefix
 * @returns {string}
 */
export function toColumnName(remainder) {
  return remainder
    .replaceAll('[]', '')
    .replaceAll('.', '_')
    .replaceAll(CAMEL_BOUNDARY, '$1_$2')
    .toLowerCase()
}

/**
 * Source prefixes, longest first, so `baseline.habitats[]` claims a path before
 * the broader `baseline` prefix can.
 *
 * @returns {Array<{prefix: string, table: object}>}
 */
function sourcePrefixes(tables) {
  const prefixes = []
  for (const table of tables) {
    for (const prefix of table.sources) {
      prefixes.push({ prefix, table })
    }
  }
  return prefixes.sort((a, b) => b.prefix.length - a.prefix.length)
}

function matchesPrefix(path, prefix) {
  if (prefix === '') {
    // The root table claims top-level scalars only. A new nested structure must
    // be claimed by a table that names its subtree, so it fails the build
    // rather than silently flattening itself onto `project`.
    return !path.includes('.')
  }
  return path.startsWith(`${prefix}.`)
}

function remainderFor(path, prefix) {
  return prefix === '' ? path : path.slice(prefix.length + 1)
}

/**
 * Assign one leaf path to its table. Throws when nothing claims it — a new
 * field in projectSchema that the layout does not account for must fail the
 * build rather than silently vanish from a contract an external team relies on.
 *
 * @param {{path: string}} leaf
 * @param {Array<{prefix: string, table: object}>} prefixes
 */
function assignPathToTable(leaf, prefixes) {
  const hit = prefixes.find(({ prefix }) => matchesPrefix(leaf.path, prefix))
  if (!hit) {
    throw new Error(
      `warehouse-erd: no table claims the schema path "${leaf.path}". ` +
        "Add it to a table's `sources` in scripts/warehouse-erd.js."
    )
  }
  return hit
}

/**
 * @param {object} table
 * @returns {Array<object>} the non-JSON columns this table carries
 */
function syntheticColumns(table) {
  const columns = [
    {
      name: table.primaryKey.column,
      type: table.primaryKey.type,
      key: 'PK',
      note: table.primaryKey.derivation,
      jsonPaths: []
    }
  ]
  if (table.parent) {
    columns.push({
      name: table.parent.column,
      type: table.parent.type,
      key: 'FK',
      note: `→ ${table.parent.table}.${table.parent.column}`,
      jsonPaths: []
    })
  }
  if (table.discriminator) {
    columns.push({ ...table.discriminator, key: null, jsonPaths: [] })
  }
  for (const envelope of table.envelope ?? []) {
    columns.push({ ...envelope, key: null, jsonPaths: [] })
  }
  return columns
}

/**
 * Feature tables key on the JSON `featureId`, so that path is already covered
 * by the synthetic PK and must not also appear as an ordinary column.
 */
function isPrimaryKeyPath(table, columnName) {
  return columnName === 'feature_id' && table.primaryKey.column === 'feature_id'
}

/**
 * Build the full warehouse model: every table with its columns, in document
 * order, plus the JSON path each column came from.
 *
 * @param {object} describe output of projectSchema.describe()
 * @returns {{tables: object[], leafCount: number}}
 */
/**
 * Record one schema leaf as a column on its table.
 *
 * @param {object} target the table the leaf belongs to
 * @param {string} name the derived column name
 * @param {{path: string, type: string, openMap: boolean}} leaf
 */
function addLeafColumn(target, name, leaf) {
  // Feature tables key on the JSON featureId, so it is already the PK.
  if (isPrimaryKeyPath(target, name)) {
    return
  }
  // feature_set and friends are shared between the two document subtrees, so
  // the same column arrives twice. Record both source paths against the one
  // column rather than dropping the second — the contract has to name every
  // place a value can come from.
  const existing = target.columns.find((column) => column.name === name)
  if (existing) {
    existing.jsonPaths.push(leaf.path)
    return
  }
  target.columns.push({
    name,
    type: leaf.type,
    key: null,
    note: leaf.openMap ? 'verbatim GeoPackage attribute columns' : null,
    jsonPaths: [leaf.path]
  })
}

export function buildWarehouseModel(describe) {
  const tables = warehouseTables().map((table) => ({
    ...table,
    columns: syntheticColumns(table)
  }))
  const byName = new Map(tables.map((table) => [table.table, table]))
  const prefixes = sourcePrefixes(tables)
  const leaves = schemaLeaves(describe)

  for (const leaf of leaves) {
    const { prefix, table } = assignPathToTable(leaf, prefixes)
    const target = byName.get(table.table)
    addLeafColumn(target, toColumnName(remainderFor(leaf.path, prefix)), leaf)
  }

  return { tables, leafCount: leaves.length }
}
