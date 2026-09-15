import { describe, expect, it } from 'vitest'
import Joi from 'joi'

import {
  buildWarehouseModel,
  schemaLeaves,
  toColumnName,
  warehouseTables
} from './warehouse-erd.js'
import { renderErdMarkdown } from './warehouse-erd-render.js'
import { schemaPaths } from '../src/validation/data-dictionary-paths.js'
import { projectSchema } from '../src/validation/project.js'

const model = buildWarehouseModel(projectSchema.describe())
const tableByName = new Map(model.tables.map((table) => [table.table, table]))

const columnNames = (table) =>
  tableByName.get(table).columns.map((column) => column.name)

describe('#toColumnName', () => {
  it.each([
    ['featureId', 'feature_id'],
    ['sizeSquareMetres', 'size_square_metres'],
    ['areaHabitats.totalSquareMetres', 'area_habitats_total_square_metres'],
    ['baseline.type', 'baseline_type'],
    ['name', 'name'],
    ['grid_ref', 'grid_ref']
  ])('maps %s to %s', (remainder, expected) => {
    expect(toColumnName(remainder)).toBe(expected)
  })
})

describe('#schemaLeaves', () => {
  it('emits leaves, not containers', () => {
    const schema = Joi.object({
      outer: Joi.object({ inner: Joi.string() })
    })

    const paths = schemaLeaves(schema.describe()).map((leaf) => leaf.path)

    expect(paths).toEqual(['outer.inner'])
  })

  it('collapses array indices and descends into the item schema', () => {
    const schema = Joi.object({
      rows: Joi.array().items(Joi.object({ id: Joi.string().uuid() }))
    })

    expect(schemaLeaves(schema.describe())).toEqual([
      { path: 'rows[].id', type: 'uuid', openMap: false }
    ])
  })

  it('treats an open map as one opaque jsonb leaf', () => {
    const schema = Joi.object({ properties: Joi.object().unknown(true) })

    expect(schemaLeaves(schema.describe())).toEqual([
      { path: 'properties', type: 'jsonb', openMap: true }
    ])
  })

  it.each([
    [Joi.string().uuid(), 'uuid'],
    [Joi.string().isoDate(), 'timestamptz'],
    [Joi.string(), 'text'],
    [Joi.number(), 'numeric'],
    [Joi.number().integer(), 'integer']
  ])('types %# as %s', (schema, expected) => {
    const [leaf] = schemaLeaves(Joi.object({ field: schema }).describe())
    expect(leaf.type).toBe(expected)
  })
})

describe('#buildWarehouseModel — schema coverage', () => {
  // The contract guard: a field added to projectSchema that no table claims
  // must fail the build rather than silently vanish from what we publish.
  it('maps every leaf path declared by projectSchema', () => {
    const declared = new Set()
    const openPaths = new Set()
    schemaPaths(projectSchema.describe(), '', declared, openPaths)

    const mapped = new Set(
      model.tables.flatMap((table) =>
        table.columns.flatMap((column) => column.jsonPaths)
      )
    )
    // featureId is consumed as each feature table's primary key.
    const leafPaths = schemaLeaves(projectSchema.describe()).map(
      (leaf) => leaf.path
    )
    const unmapped = leafPaths.filter(
      (path) => !mapped.has(path) && !path.endsWith('.featureId')
    )

    expect(unmapped).toEqual([])
  })

  it('throws when a new nested subtree falls outside every table', () => {
    const orphan = Joi.object({
      mystery: Joi.object({ field: Joi.string() })
    })

    expect(() => buildWarehouseModel(orphan.describe())).toThrow(
      /no table claims the schema path "mystery.field"/
    )
  })

  it('lands a new top-level scalar on the project table', () => {
    const extended = Joi.object({ nickname: Joi.string() })

    const built = buildWarehouseModel(extended.describe())
    const project = built.tables.find((table) => table.table === 'project')

    expect(project.columns.map((column) => column.name)).toContain('nickname')
  })
})

describe('#buildWarehouseModel — keys', () => {
  it('gives every table a primary key and every child a foreign key', () => {
    for (const table of model.tables) {
      const keys = table.columns.filter((column) => column.key)
      expect(keys.some((column) => column.key === 'PK')).toBe(true)
      if (table.parent) {
        expect(keys.some((column) => column.key === 'FK')).toBe(true)
      }
    }
  })

  it('reuses the project UUID as the top-level key', () => {
    const project = tableByName.get('project')

    expect(project.primaryKey.column).toBe('project_id')
    expect(project.primaryKey.type).toBe('uuid')
    expect(project.primaryKey.derivation).toContain('bng.projects.id')
  })

  it('keys feature tables on the feature UUID, not a derived string', () => {
    const habitats = tableByName.get('baseline_habitats')

    expect(habitats.primaryKey.column).toBe('feature_id')
    expect(habitats.primaryKey.type).toBe('uuid')
  })

  it('does not emit feature_id twice on a feature table', () => {
    const names = columnNames('baseline_habitats')

    expect(names.filter((name) => name === 'feature_id')).toHaveLength(1)
  })

  it('carries ref on every feature table — it is the carry-forward key', () => {
    const featureTables = model.tables.filter(
      (table) => table.primaryKey.column === 'feature_id' && table.many
    )

    expect(featureTables.length).toBeGreaterThan(0)
    for (const table of featureTables) {
      expect(columnNames(table.table)).toContain('ref')
    }
  })
})

const WAREHOUSE_TABLES = [
  'project',
  'project_site',
  'project_units',
  'project_details',
  'feature_set',
  'feature_set_units',
  'feature_set_habitat_sizes',
  'feature_set_trading_rules',
  'feature_set_trading_rules_area_habitat_types',
  'feature_set_trading_rules_area_broad_habitats',
  'feature_set_trading_rules_watercourse_habitats',
  'baseline_red_line',
  'baseline_habitats',
  'baseline_trees',
  'baseline_hedgerows',
  'baseline_watercourses',
  'post_intervention_red_line',
  'post_intervention_habitats',
  'post_intervention_trees',
  'post_intervention_hedgerows',
  'post_intervention_watercourses'
]

describe('#buildWarehouseModel — column layout', () => {
  it('flattens the post-intervention baseline/proposed blocks by prefix', () => {
    const names = columnNames('post_intervention_habitats')

    expect(names).toContain('baseline_type')
    expect(names).toContain('proposed_type')
    expect(names).not.toContain('baseline')
    expect(names).not.toContain('proposed')
  })

  it('flattens the five habitatSizes sub-groups into one table', () => {
    const names = columnNames('feature_set_habitat_sizes')

    expect(names).toContain('area_habitats_total_square_metres')
    expect(names).toContain('trees_urban_square_metres')
    expect(names).toContain('site_total_square_metres')
  })

  it('merges both documents into the shared feature_set table exactly once', () => {
    const names = columnNames('feature_set')

    expect(names.filter((name) => name === 'upload_id')).toHaveLength(1)
    expect(names).toContain('document_key')
  })

  it('keeps trading-rules leaves off feature_set (they are their own tables)', () => {
    const names = columnNames('feature_set')

    expect(names.some((name) => name.includes('trading_rules'))).toBe(false)
    expect(columnNames('feature_set_trading_rules')).toEqual(
      expect.arrayContaining([
        'watercourses_medium_surplus',
        'watercourses_medium_deficit',
        'watercourses_low_net_unit_change',
        'watercourses_low_cumulative_availability'
      ])
    )
    expect(
      columnNames('feature_set_trading_rules_watercourse_habitats')
    ).toEqual(
      expect.arrayContaining([
        'habitat_type',
        'distinctiveness',
        'net_unit_change'
      ])
    )
  })

  it('keeps properties as a single jsonb column', () => {
    const properties = tableByName
      .get('baseline_habitats')
      .columns.find((column) => column.name === 'properties')

    expect(properties.type).toBe('jsonb')
  })

  it('separates baseline and post-intervention feature tables', () => {
    expect(tableByName.has('baseline_habitats')).toBe(true)
    expect(tableByName.has('post_intervention_habitats')).toBe(true)
  })

  it('builds the expected table set', () => {
    expect(model.tables.map((table) => table.table)).toEqual(WAREHOUSE_TABLES)
  })
})

describe('#renderErdMarkdown', () => {
  const markdown = renderErdMarkdown(model)

  it('opens a mermaid fence', () => {
    expect(markdown).toContain('```mermaid')
    expect(markdown).toContain('erDiagram')
  })

  it('declares an entity block for every table', () => {
    for (const { table } of warehouseTables()) {
      expect(markdown).toContain(`    ${table} {`)
    }
  })

  it('uses one-to-many for arrays and one-to-one for singletons', () => {
    expect(markdown).toContain(
      '    feature_set ||--o| feature_set_trading_rules : "has"'
    )
    expect(markdown).toContain(
      '    feature_set_trading_rules ||--o{ feature_set_trading_rules_watercourse_habitats : "contains"'
    )
    expect(markdown).toContain(
      '    feature_set ||--o{ baseline_habitats : "contains"'
    )
    expect(markdown).toContain(
      '    feature_set ||--o| baseline_red_line : "has"'
    )
    expect(markdown).toContain('    project ||--o{ feature_set : "contains"')
  })

  it('never emits a double quote inside a mermaid attribute comment', () => {
    const trailingComment = /"([^"]*)"\s*$/
    const diagram = markdown.split('```mermaid')[1].split('```')[0]
    for (const line of diagram.split('\n')) {
      const comment = trailingComment.exec(line)
      if (comment) {
        expect(comment[1]).not.toContain('"')
      }
    }
  })

  it('documents the derived key for each 1:1 table', () => {
    expect(markdown).toContain('`{projectId}:site`')
    expect(markdown).toContain('`{projectId}:{documentKey}`')
    expect(markdown).toContain('`{projectId}:{documentKey}:habitatSizes`')
    expect(markdown).toContain('`{projectId}:postIntervention:tradingRules`')
  })

  it('states the update and stability semantics', () => {
    expect(markdown).toContain('full snapshot')
    expect(markdown).toContain('bng_project_version` is not a revision counter')
    expect(markdown).toContain('survives edits')
  })

  it('lists the JSON path each mapped column came from', () => {
    expect(markdown).toContain('`baseline.habitats[].sizeSquareMetres`')
  })
})
