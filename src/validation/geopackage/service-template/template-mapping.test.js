import {
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION,
  TEMPLATE_SCHEMA
} from 'bng-library/bng-service'

import { TEMPLATE_MAPPING_1_0 } from './template-mapping.js'

const STAGES = [STAGE_BASELINE, STAGE_POST_INTERVENTION]

const templateColumns = (table) =>
  TEMPLATE_SCHEMA.tables
    .find(({ name }) => name === table)
    .columns.map(({ name }) => name)

const LAYERS_AND_STAGES = Object.keys(TEMPLATE_MAPPING_1_0).flatMap((layer) =>
  STAGES.map((stage) => [layer, stage])
)

describe('the BNG Service template 1.0 mapping', () => {
  test.each(LAYERS_AND_STAGES)(
    'names a table of the template for %s at the %s stage',
    (layer, stage) => {
      const table = TEMPLATE_MAPPING_1_0[layer].table(stage)

      expect(TEMPLATE_SCHEMA.tables.map(({ name }) => name)).toContain(table)
    }
  )

  // A column the template gains must be a decision here: read, under which
  // name, or not read. An unlisted column would be dropped without one.
  test.each(LAYERS_AND_STAGES)(
    'says how every column of the %s table is read at the %s stage',
    (layer, stage) => {
      const { table, columns } = TEMPLATE_MAPPING_1_0[layer]

      const unlisted = templateColumns(table(stage)).filter(
        (column) => !columns.has(column)
      )

      expect(unlisted).toEqual([])
    }
  )

  test('reads Habitat Ref as the pipeline’s Parcel Ref, on every habitat layer', () => {
    for (const layer of ['areas', 'hedgerows', 'watercourses']) {
      expect(TEMPLATE_MAPPING_1_0[layer].columns.get('Habitat Ref')).toBe(
        'Parcel Ref'
      )
    }
  })

  test('keeps the lineage columns under their own names', () => {
    for (const column of [
      'Parent Ref',
      'feature_uuid',
      'parent_uuid',
      'parent_geom'
    ]) {
      expect(TEMPLATE_MAPPING_1_0.areas.columns.get(column)).toBe(column)
    }
  })

  test.each([
    ['areas', 'Baseline Distinctiveness'],
    ['areas', 'Proposed Distinctiveness'],
    ['areas', 'Spatial risk category'],
    ['areas', 'Area'],
    ['hedgerows', 'Length'],
    ['hedgerows', 'Baseline Length'],
    ['watercourses', 'Length'],
    ['watercourses', 'Baseline Length']
  ])('does not read %s %s', (layer, column) => {
    expect(TEMPLATE_MAPPING_1_0[layer].columns.get(column)).toBeNull()
  })

  test('reads the Red Line Boundary for its geometry alone', () => {
    const { columns } = TEMPLATE_MAPPING_1_0.redline

    expect([...columns.values()].every((name) => name === null)).toBe(true)
  })

  test('reads no trees or vertical area habitats yet', () => {
    expect(Object.keys(TEMPLATE_MAPPING_1_0)).toEqual([
      'redline',
      'areas',
      'hedgerows',
      'watercourses'
    ])
  })
})
