import Boom from '@hapi/boom'
import { and, eq, sql } from 'drizzle-orm'

import { PG_LOCK_NOT_AVAILABLE } from '../../db/postgres-error-codes.js'
import { visibleToUser } from '../../db/project-visibility.js'
import {
  projects,
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses,
  baselineTrees,
  postInterventionRedLine,
  postInterventionHabitats,
  postInterventionHedgerows,
  postInterventionWatercourses,
  postInterventionTrees
} from '../../db/schema/index.js'
import { setProjectHabitatData } from '../../db/persist-project.js'
import { EPSG_BNG } from '../../validation/baseline/geopackage-constants.js'
import { logPerfEvidence } from '../../common/helpers/perf-evidence.js'

/** Cap rows per INSERT to keep statement size bounded for PostGIS bulk loads. */
const INSERT_BATCH_SIZE = 500

/** Maximum wait for the project row lock during concurrent baseline uploads. */
const PERSIST_LOCK_TIMEOUT = '5s'

const BASELINE_FEATURE_TABLES = Object.freeze({
  redLine: baselineRedLine,
  habitats: baselineHabitats,
  hedgerows: baselineHedgerows,
  watercourses: baselineWatercourses,
  trees: baselineTrees
})

const POST_INTERVENTION_FEATURE_TABLES = Object.freeze({
  redLine: postInterventionRedLine,
  habitats: postInterventionHabitats,
  hedgerows: postInterventionHedgerows,
  watercourses: postInterventionWatercourses,
  trees: postInterventionTrees
})

const FEATURE_TABLE_SETS = Object.freeze({
  baseline: BASELINE_FEATURE_TABLES,
  postIntervention: POST_INTERVENTION_FEATURE_TABLES
})

function transformToBngMultiGeomSql(geomJson, sourceSrid) {
  return sql`ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), ${sourceSrid}), ${sql.raw(String(EPSG_BNG))}))`
}

function geometryRowValues(projectId, row, serStats) {
  const geomJson = JSON.stringify(row.geometry)
  // Evidence (Item 7): reuse the already-computed geomJson to size the third
  // serialization (per-row on persist) without re-stringifying — the caller
  // logs the accumulated total once the transaction is built.
  if (serStats) {
    serStats.count += 1
    serStats.bytes += Buffer.byteLength(geomJson)
  }
  return sql`(
    ${row.featureId}::uuid,
    ${projectId}::uuid,
    ${row.ref ?? null},
    ${transformToBngMultiGeomSql(geomJson, row.srid)}
  )`
}

async function insertGeometryRowsBatched(tx, table, projectId, rows, serStats) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const values = batch.map((row) =>
      geometryRowValues(projectId, row, serStats)
    )
    await tx.execute(sql`
      INSERT INTO ${table} (id, project_id, ref, geom)
      VALUES ${sql.join(values, sql`, `)}
    `)
  }
}

async function insertRedLineRow(tx, table, projectId, row, serStats) {
  const geomJson = JSON.stringify(row.geometry)
  if (serStats) {
    serStats.count += 1
    serStats.bytes += Buffer.byteLength(geomJson)
  }
  await tx.execute(sql`
    INSERT INTO ${table} (id, project_id, geom)
    VALUES (
      ${row.featureId}::uuid,
      ${projectId}::uuid,
      ${transformToBngMultiGeomSql(geomJson, row.srid)}
    )
  `)
}

async function deleteExistingFeatureRows(tx, projectId, featureTables) {
  for (const table of Object.values(featureTables)) {
    await tx.delete(table).where(eq(table.projectId, projectId))
  }
}

// Lock the project row for update — but only if it is visible to the requesting
// user. `visibleToUser(sub)` scopes to ownership AND an approved (status 3) role
// for the project's relationship, i.e. the user's CURRENT org context. A project
// the user doesn't own (or holds no approved current-relationship role for) is
// indistinguishable from a missing one: it returns 404 without writing, matching
// the sibling write paths (features.js, habitats.js, projects.js PATCH).
async function assertProjectExistsForUpdate(tx, projectId, sub) {
  const projectRows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), visibleToUser(sub)))
    .for('update')
    .limit(1)
  if (projectRows.length === 0) {
    throw Boom.notFound(`Project ${projectId} not found`)
  }
}

async function persistGeometryLayers(
  tx,
  projectId,
  geometries,
  featureTables,
  serStats
) {
  if (geometries.redLine) {
    await insertRedLineRow(
      tx,
      featureTables.redLine,
      projectId,
      geometries.redLine,
      serStats
    )
  }
  await insertGeometryRowsBatched(
    tx,
    featureTables.habitats,
    projectId,
    geometries.habitats,
    serStats
  )
  await insertGeometryRowsBatched(
    tx,
    featureTables.hedgerows,
    projectId,
    geometries.hedgerows,
    serStats
  )
  await insertGeometryRowsBatched(
    tx,
    featureTables.watercourses,
    projectId,
    geometries.watercourses,
    serStats
  )
  await insertGeometryRowsBatched(
    tx,
    featureTables.trees,
    projectId,
    geometries.trees ?? [],
    serStats
  )
}

async function updateProjectDocumentSection(
  tx,
  projectId,
  document,
  projectDocumentKey
) {
  await setProjectHabitatData(tx, projectId, document, projectDocumentKey)
}

async function runPersistTransaction(
  drizzle,
  projectId,
  document,
  geometries,
  { projectDocumentKey, featureTables, sub, serStats }
) {
  await drizzle.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL lock_timeout = '${PERSIST_LOCK_TIMEOUT}'`)
    )

    await assertProjectExistsForUpdate(tx, projectId, sub)
    await deleteExistingFeatureRows(tx, projectId, featureTables)
    await persistGeometryLayers(
      tx,
      projectId,
      geometries,
      featureTables,
      serStats
    )
    await updateProjectDocumentSection(
      tx,
      projectId,
      document,
      projectDocumentKey
    )
  })
}

function rethrowPersistError(err, uploadLabel) {
  if (err?.isBoom) {
    throw err
  } else if (err?.code === PG_LOCK_NOT_AVAILABLE) {
    throw Boom.conflict(
      `Another ${uploadLabel} upload for this project is in progress`
    )
  } else {
    throw err
  }
}

/**
 * Replace the persisted baseline document and geometry rows for a project.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {string} projectId
 * @param {object} document
 * @param {object} geometries
 * @param {object} context
 * @param {string} context.uploadId
 * @param {{ info: (msg: string) => void }} context.logger
 * @param {string} context.sub verified token subject; the write is scoped to a
 *   project visible to this user (ownership + approved current-relationship role)
 */
async function persistBaseline(
  drizzle,
  projectId,
  document,
  geometries,
  {
    uploadId,
    logger,
    sub,
    projectDocumentKey = 'baseline',
    uploadLabel = 'baseline',
    featureTables = FEATURE_TABLE_SETS[projectDocumentKey]
  }
) {
  const serStats = { count: 0, bytes: 0 }
  try {
    await runPersistTransaction(drizzle, projectId, document, geometries, {
      projectDocumentKey,
      featureTables,
      sub,
      serStats
    })
  } catch (err) {
    rethrowPersistError(err, uploadLabel)
  }

  // Evidence (Item 7 — geometries re-serialized to JSON three times): third and
  // final site — every geometry is JSON.stringify'd again per row on persist.
  // serializedBytes is the geometry text shipped to Postgres for the inserts.
  logPerfEvidence(logger, 'geom-serialized-thrice', {
    stage: 'persist',
    featureCount: serStats.count,
    serializedBytes: serStats.bytes
  })

  logger.info(
    `${uploadLabel}: persisted ${uploadLabel} for projectId ${projectId} from uploadId ${uploadId}`
  )
}

export { persistBaseline, FEATURE_TABLE_SETS }
