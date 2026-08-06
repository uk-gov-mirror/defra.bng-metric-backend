import Boom from '@hapi/boom'
import { and, eq, sql } from 'drizzle-orm'

import { projects } from '../db/schema/index.js'
import { setProjectFeature } from '../db/persist-project.js'
import { visibleToUser } from '../db/project-visibility.js'
import { PG_LOCK_NOT_AVAILABLE } from '../db/postgres-error-codes.js'
import {
  APPLY_RESULT,
  applyFeatureUpdate
} from '../utilities/features/apply-feature-update.js'
import { findFeature } from '../utilities/features/find-feature.js'
import { outOfScopeDistinctivenessError } from './out-of-scope-error.js'
import { featureEditPayload, projectFeatureIdParams } from './shared-params.js'
import { logPerf, utf8Bytes } from '../common/helpers/perf-evidence.js'

/**
 * @openapi
 * /projects/{projectId}/features/{featureId}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a single baseline feature regardless of layer
 *     description: |
 *       Scans habitats, hedgerows and watercourses and returns the matching
 *       feature with a `type` discriminator. Lets the frontend address any
 *       baseline feature by featureId alone - the data tells the caller what
 *       kind of feature it is.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     responses:
 *       200:
 *         description: Returns the feature with its type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [habitat, tree, hedgerow, watercourse]
 *                 feature:
 *                   type: object
 *       404:
 *         description: Project or feature not found
 */
/**
 * @openapi
 * /projects/{projectId}/post-intervention/features/{featureId}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a single post-intervention feature regardless of layer
 *     description: |
 *       Scans post-intervention habitats, hedgerows and watercourses and
 *       returns the matching feature with a `type` discriminator. Lets the
 *       frontend address any post-intervention feature by featureId alone.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     responses:
 *       200:
 *         description: Returns the feature with its type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [habitat, tree, hedgerow, watercourse]
 *                 feature:
 *                   type: object
 *       404:
 *         description: Project or feature not found
 */
function createGetFeatureRoute({ path, documentKey }) {
  return {
    method: 'GET',
    path,
    options: {
      auth: 'defra-jwt',
      validate: {
        params: projectFeatureIdParams
      }
    },
    handler: async (request, _h) => {
      const { sub } = request.auth.credentials
      const { projectId, featureId } = request.params
      const rows = await request.drizzle
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), visibleToUser(sub)))

      if (rows.length === 0) {
        throw Boom.notFound(`Project ${projectId} not found`)
      }

      const featureSet = rows[0].project?.[documentKey]
      const found = findFeature(featureSet, featureId)
      if (!found) {
        throw Boom.notFound(
          `Feature ${featureId} not found in project ${projectId}`
        )
      }
      // Evidence (Item W4 — single-feature reads fetch the whole document): the
      // entire project JSONB was shipped and deserialised to return one feature.
      // docBytes is the whole document; featureBytes is what the caller gets.
      logPerf(request.logger, 'single-feature-full-doc', {
        documentKey,
        docBytes: utf8Bytes(JSON.stringify(rows[0].project ?? {})),
        featureBytes: utf8Bytes(JSON.stringify(found.feature))
      })
      return { type: found.type, feature: found.feature }
    }
  }
}

const getFeature = createGetFeatureRoute({
  path: '/projects/{projectId}/features/{featureId}',
  documentKey: 'baseline'
})

const getPostInterventionFeature = createGetFeatureRoute({
  path: '/projects/{projectId}/post-intervention/features/{featureId}',
  documentKey: 'postIntervention'
})

/**
 * @openapi
 * /projects/{projectId}/features/{featureId}:
 *   put:
 *     tags:
 *       - Projects
 *     summary: Save dropdown edits to one baseline feature
 *     description: |
 *       Persists habitat-type / condition (and broad-type for area habitats)
 *       selections, recomputes distinctiveness / condition score / units /
 *       status, refreshes the project-level units totals, then returns
 *       `{ type, feature }`. The feature type is discovered from the data,
 *       so a single endpoint handles habitats, hedgerows and watercourses.
 *       Watercourse edits also persist the watercourse/riparian encroachment
 *       selections and recompute units from the engine's encroachment
 *       multipliers (BMD-597).
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               broadType:
 *                 type: string
 *                 nullable: true
 *               habitatType:
 *                 type: string
 *                 nullable: true
 *               condition:
 *                 type: string
 *                 nullable: true
 *               watercourseEncroachment:
 *                 type: string
 *                 nullable: true
 *               riparianEncroachment:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Returns the updated feature with its type
 *       400:
 *         description: Feature type is not editable via this endpoint (e.g. an individual tree)
 *       404:
 *         description: Project or feature not found
 *       422:
 *         description: Habitat distinctiveness is out of scope for the BNG Beta service (High / V.High)
 *       409:
 *         description: Another edit for this project is in progress
 */
const updateFeature = {
  method: 'PUT',
  path: '/projects/{projectId}/features/{featureId}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: projectFeatureIdParams,
      payload: featureEditPayload
    }
  },
  handler: async (request, _h) => {
    const { sub } = request.auth.credentials
    const { projectId, featureId } = request.params

    try {
      return await request.drizzle.transaction((tx) =>
        runFeatureUpdate(tx, {
          projectId,
          featureId,
          edits: request.payload,
          sub
        })
      )
    } catch (err) {
      if (err?.isBoom) {
        throw err
      }
      if (err?.code === PG_LOCK_NOT_AVAILABLE) {
        throw Boom.conflict('Another edit for this project is in progress')
      }
      throw err
    }
  }
}

async function runFeatureUpdate(tx, { projectId, featureId, edits, sub }) {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)

  const [row] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), visibleToUser(sub)))
    .for('update')
    .limit(1)
  if (!row) {
    throw Boom.notFound(`Project ${projectId} not found`)
  }

  const result = applyFeatureUpdate(row.project ?? {}, { featureId, edits })
  if (result.status === APPLY_RESULT.FEATURE_NOT_FOUND) {
    throw Boom.notFound(
      `Feature ${featureId} not found in project ${projectId}`
    )
  }
  if (result.status === APPLY_RESULT.UNSUPPORTED_TYPE) {
    throw Boom.badRequest(
      `Feature type ${result.type} is not editable via this endpoint`
    )
  }
  if (result.status === APPLY_RESULT.OUT_OF_SCOPE) {
    throw outOfScopeDistinctivenessError(result.distinctiveness)
  }

  await setProjectFeature(tx, projectId, {
    documentKey: 'baseline',
    layer: result.layer,
    index: result.index,
    feature: result.feature,
    unitsTotals: result.unitsTotals
  })

  return { type: result.type, feature: result.feature }
}

export { getFeature, getPostInterventionFeature, updateFeature, findFeature }
