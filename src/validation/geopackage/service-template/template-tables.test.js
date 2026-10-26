import {
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION
} from 'bng-library/bng-service'

import { readGeoPackage } from '../geopackage.js'
import { FEATURE_READ_MODE } from '../read-feature-tables.js'
import { resolveTemplateTables, templateReadSource } from './template-tables.js'
import {
  buildServiceTemplateBuffer,
  populatedBaselineRows,
  populatedPostInterventionRows
} from '../../../../test/helpers/service-template-gpkg.js'
import {
  fullReadBuffer,
  withTempGpkgFile
} from '../../../../test/helpers/gpkg.js'

const BASELINE_SOURCE = templateReadSource('1.0', STAGE_BASELINE)

/** Read a BNG Service template file built from `options`. */
function read(
  options,
  mode = FEATURE_READ_MODE.properties,
  source = BASELINE_SOURCE
) {
  return withTempGpkgFile(buildServiceTemplateBuffer(options), (filePath) =>
    readGeoPackage(filePath, mode, source)
  )
}

describe('reading a BNG Service template file', () => {
  test('reads each layer from its Baseline table', async () => {
    const layers = await read({ rows: populatedBaselineRows() })

    expect(layers.redline).toHaveLength(1)
    expect(layers.areas).toHaveLength(1)
    expect(layers.hedgerows).toHaveLength(1)
    expect(layers.watercourses).toHaveLength(1)
    expect(layers.layerTables).toEqual({
      redline: 'Red Line Boundary',
      areas: 'Area Habitats Baseline',
      hedgerows: 'Hedgerows Baseline',
      watercourses: 'Watercourses Baseline'
    })
  })

  test('reads no trees or IGGIs yet', async () => {
    const layers = await read({ rows: populatedBaselineRows() })

    expect(layers.trees).toEqual([])
    expect(layers.iggis).toEqual([])
  })

  test('carries a habitat’s columns under the names the pipeline reads, and drops those it does not', async () => {
    const layers = await read({ rows: populatedBaselineRows() })

    expect(layers.areas[0].properties).toEqual({
      fid: 1,
      'Parcel Ref': 'H001',
      'Baseline Broad Habitat Type': 'Grassland',
      'Baseline Habitat Type': 'Other lowland acid grassland',
      'Baseline Condition': 'Fairly Poor',
      'Baseline Strategic Significance': 'Low',
      'Irreplaceable Habitat': 'No',
      Comment: null,
      feature_uuid: 'de9d1450-90f7-584a-9710-edf7ec189de4'
    })
  })

  test('drops a linear habitat’s measured length', async () => {
    const layers = await read({ rows: populatedBaselineRows() })

    expect(layers.hedgerows[0].properties).not.toHaveProperty('Length')
    expect(layers.watercourses[0].properties).toMatchObject({
      'Parcel Ref': 'R001',
      'Baseline Encroachment into Watercourse': 'N/A - Culvert'
    })
  })

  test('reads the Red Line Boundary for its geometry alone', async () => {
    const layers = await read(
      { rows: populatedBaselineRows() },
      FEATURE_READ_MODE.serialised
    )

    expect(layers.redline[0].properties).toEqual({ fid: 1 })
    expect(JSON.parse(layers.redline[0].geometryJson).type).toBe('Polygon')
  })

  test('decodes the geometry in full, for the GEOS checks', async () => {
    const layers = await read(
      { rows: populatedBaselineRows() },
      FEATURE_READ_MODE.full
    )

    expect(layers.areas[0].nativeGeometry.type).toBe('Polygon')
    expect(layers.hedgerows[0].nativeGeometry.type).toBe('LineString')
  })

  test('does not read the Post-Intervention tables at the baseline stage', async () => {
    const layers = await read({
      rows: {
        ...populatedBaselineRows(),
        'Area Habitats Post-Intervention': [{ 'Habitat Ref': 'H001a' }]
      }
    })

    expect(layers.areas.map((f) => f.properties['Parcel Ref'])).toEqual([
      'H001'
    ])
  })

  test('reads the Post-Intervention tables at that stage', async () => {
    const layers = await read(
      {
        rows: {
          ...populatedBaselineRows(),
          'Area Habitats Post-Intervention': [
            {
              'Habitat Ref': 'H001a',
              'Parent Ref': 'H001',
              'Retention Category': 'Retained',
              parent_uuid: 'de9d1450-90f7-584a-9710-edf7ec189de4'
            }
          ]
        }
      },
      FEATURE_READ_MODE.properties,
      templateReadSource('1.0', STAGE_POST_INTERVENTION)
    )

    expect(layers.layerTables.areas).toBe('Area Habitats Post-Intervention')
    expect(layers.areas[0].properties).toMatchObject({
      'Parcel Ref': 'H001a',
      'Parent Ref': 'H001',
      'Retention Category': 'Retained',
      parent_uuid: 'de9d1450-90f7-584a-9710-edf7ec189de4'
    })
  })

  // The template's form greys out one timing column while the other is above
  // 0, so the surveyor leaves it blank: 0 years.
  test.each([
    ['years in advance', '5', null, '5', '0'],
    ['a delay', null, '3', '0', '3'],
    ['30+ years in advance', '30+', '', '30+', '0'],
    ['neither', null, null, null, null],
    ['both at 0', '0', '0', '0', '0'],
    ['N/A', 'N/A', null, 'N/A', null],
    ['0.0', '0.0', null, '0.0', null],
    ['a negative number', '-1', null, '-1', null],
    [' 0 ', ' 0 ', null, ' 0 ', null]
  ])(
    'beside %s, reads a blank timing column as 0 years only when the other is above 0',
    async (_, advance, delay, readAdvance, readDelay) => {
      const rows = {
        ...populatedBaselineRows(),
        ...populatedPostInterventionRows()
      }
      Object.assign(rows['Area Habitats Post-Intervention'][0], {
        'Habitat created in advance/years': advance,
        'Delay in starting habitat creation/years': delay
      })

      const layers = await read(
        { rows },
        FEATURE_READ_MODE.properties,
        templateReadSource('1.0', STAGE_POST_INTERVENTION)
      )

      expect(layers.areas[0].properties).toMatchObject({
        'Habitat created in advance/years': readAdvance,
        'Delay in starting habitat creation/years': readDelay
      })
    }
  )

  test('reports a layer whose table is missing', async () => {
    const layers = await read({ omitTables: ['Hedgerows Baseline'] })

    expect(layers.missingLayers).toEqual(['hedgerows'])
    expect(layers.hedgerows).toEqual([])
  })

  test('leaves a legacy read as it was', async () => {
    const layers = await withTempGpkgFile(fullReadBuffer(), (filePath) =>
      readGeoPackage(filePath, FEATURE_READ_MODE.properties)
    )

    expect(layers.areas).toHaveLength(1)
    expect(layers).not.toHaveProperty('layerTables')
  })
})

describe('resolveTemplateTables', () => {
  test('refuses a version the service does not read', () => {
    expect(() =>
      resolveTemplateTables([], templateReadSource('2.0', STAGE_BASELINE))
    ).toThrow('template version 2.0')
  })

  test('refuses a source that is not the BNG Service template', () => {
    expect(() =>
      resolveTemplateTables([], {
        format: 'legacy',
        version: '1.0',
        stage: STAGE_BASELINE
      })
    ).toThrow('Cannot read a legacy file')
  })
})
