import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  logPerf,
  perfNow,
  utf8Bytes
} from '../../common/helpers/perf-evidence.js'

const logger = createLogger()

const HABITAT_SIZE_LAYERS = ['areas', 'hedgerows', 'watercourses']

const CALCULATE_HABITAT_SIZES_QUERY = /* sql */ `
WITH features_in AS (
  SELECT layer,
         feature_id,
         ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), srid), 27700) AS geom
  FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
    AS t(layer, feature_id, g, srid)
)
SELECT layer,
       feature_id,
       CASE
         WHEN layer = 'areas' THEN ST_Area(ST_MakeValid(geom))
         ELSE ST_Length(ST_MakeValid(geom))
       END AS size_value
FROM features_in
ORDER BY layer, feature_id
`

function buildLayerArrays(layers) {
  const layerNames = []
  const featureIds = []
  const geoms = []
  const srids = []

  for (const layerName of HABITAT_SIZE_LAYERS) {
    const features = layers[layerName] ?? []

    for (const feature of features) {
      if (!feature?.nativeGeometry) {
        continue
      }

      layerNames.push(layerName)
      featureIds.push(feature.featureId)
      geoms.push(JSON.stringify(feature.nativeGeometry))
      srids.push(feature.nativeSrid)
    }
  }

  return { layerNames, featureIds, geoms, srids }
}

function emptyResult() {
  return {
    areaHabitats: {
      individualSquareMetres: [],
      totalSquareMetres: 0
    },
    hedgerows: {
      individualMetres: [],
      totalMetres: 0
    },
    watercourses: {
      individualMetres: [],
      totalMetres: 0
    }
  }
}

function mapLayerToKey(layerName) {
  if (layerName === 'areas') {
    return 'areaHabitats'
  }
  if (layerName === 'hedgerows') {
    return 'hedgerows'
  }
  if (layerName === 'watercourses') {
    return 'watercourses'
  }

  return null
}

function appendCalculatedSizes(result, rows) {
  for (const row of rows) {
    const key = mapLayerToKey(row.layer)
    if (!key) {
      continue
    }

    const sizeValue = Number(row.size_value)
    if (key === 'areaHabitats') {
      result[key].individualSquareMetres.push({
        featureId: row.feature_id,
        sizeSquareMetres: sizeValue
      })
      result[key].totalSquareMetres += sizeValue
    } else {
      result[key].individualMetres.push({
        featureId: row.feature_id,
        sizeMetres: sizeValue
      })
      result[key].totalMetres += sizeValue
    }
  }
}

async function calculateHabitatSizes(pool, layers) {
  if (!pool) {
    throw new Error('calculateHabitatSizes requires a pg pool')
  }

  const { layerNames, featureIds, geoms, srids } = buildLayerArrays(layers)

  if (layerNames.length === 0) {
    return emptyResult()
  }

  // Evidence (Item 7 — geometries re-serialized to JSON three times): second of
  // the three sites — the sizing param array re-stringifies the same geometries.
  logPerf(logger, 'geom-serialized-thrice', {
    stage: 'sizing',
    featureCount: geoms.length,
    serializedBytes: utf8Bytes(geoms)
  })

  const queryStart = perfNow()
  const { rows } = await pool.query(CALCULATE_HABITAT_SIZES_QUERY, [
    layerNames,
    featureIds,
    geoms,
    srids
  ])
  // Evidence (Item 6 — the union work overlaps a second PostGIS pass): this
  // sizing query is a separate round trip that recomputes ST_MakeValid per
  // feature, duplicating validation's geometry-repair work.
  logPerf(logger, 'postgis-sizing-query', {
    featureCount: geoms.length,
    queryMs: Math.round(perfNow() - queryStart)
  })

  const result = emptyResult()
  appendCalculatedSizes(result, rows)
  return result
}

export {
  HABITAT_SIZE_LAYERS,
  CALCULATE_HABITAT_SIZES_QUERY,
  buildLayerArrays,
  calculateHabitatSizes
}
