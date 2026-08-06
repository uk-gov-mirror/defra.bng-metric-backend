import Boom from '@hapi/boom'
import { and, eq } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'
import { insertProject, setProjectName } from '../db/persist-project.js'
import { visibleToUser } from '../db/project-visibility.js'
import { currentOrgContext } from '../services/defra-id/claims.js'
import {
  toProjectResponse,
  toProjectResponses
} from '../utilities/project/to-project-response.js'
import { projectSchema } from '../validation/project.js'
import { logPerf, perfNow, utf8Bytes } from '../common/helpers/perf-evidence.js'

/**
 * @openapi
 * /projects:
 *   get:
 *     tags:
 *       - Projects
 *     summary: List the requesting user's visible projects
 *     description: |
 *       Returns only projects the authenticated user owns whose latest role for
 *       the project's relationship is approved (status 3), plus their legacy
 *       projects with no relationship.
 *
 *       Each row carries `projectId` — an explicit alias of `id` — as the
 *       primary key for downstream relational consumers.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Returns an array of the user's visible projects
 *       401:
 *         description: Missing or invalid bearer token
 *
 * /projects/{id}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a project by ID
 *     description: |
 *       The response carries `projectId` — an explicit alias of `id` — as the
 *       primary key for downstream relational consumers. Nested features are
 *       keyed by their own `featureId`, which is stable across edits and across
 *       re-uploads that keep the same `ref`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Returns the project
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Project not found or not visible to the user
 *   patch:
 *     tags:
 *       - Projects
 *     summary: Update a project name
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project
 *             properties:
 *               project:
 *                 type: object
 *                 required:
 *                   - name
 *                 properties:
 *                   name:
 *                     type: string
 *     responses:
 *       200:
 *         description: Returns the updated project
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Project not found or not visible to the user
 *
 * /projects/{projectId}/habitats/{featureId}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a single habitat document from a project's baseline
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: featureId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Returns the habitat document
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Project or habitat not found
 *
 * /projects/new:
 *   post:
 *     tags:
 *       - Projects
 *     summary: Create a new project
 *     description: |
 *       The owner, org id and relationship id are derived from the verified
 *       Bearer token — the request body carries only the project document.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project
 *             properties:
 *               project:
 *                 type: object
 *     responses:
 *       200:
 *         description: Returns the created project
 *       401:
 *         description: Missing or invalid bearer token
 */
const getProjects = {
  method: 'GET',
  path: '/projects',
  options: {
    auth: 'defra-jwt'
  },
  handler: async (request, _h) => {
    const { sub } = request.auth.credentials
    const queryStart = perfNow()
    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(visibleToUser(sub))
    // Evidence (Item W1 — project list returns the entire JSONB doc): SELECT *
    // of the full metric document per visible project, no projection/limit.
    // Item W2 (unindexed user_id filter) shows as queryMs growing with table
    // size.
    logPerf(request.logger, 'project-list-full-jsonb', {
      rowCount: rows.length,
      responseBytes: utf8Bytes(JSON.stringify(rows)),
      queryMs: Math.round(perfNow() - queryStart)
    })
    return toProjectResponses(rows)
  }
}

const getProject = {
  method: 'GET',
  path: '/projects/{id}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        id: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, _h) => {
    const { sub } = request.auth.credentials
    const { id } = request.params
    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), visibleToUser(sub)))

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${id} not found`)
    }

    return toProjectResponse(rows[0])
  }
}

const createProject = {
  method: 'POST',
  path: '/projects/new',
  options: {
    auth: 'defra-jwt',
    validate: {
      payload: Joi.object({
        project: projectSchema.required()
      })
    }
  },
  handler: async (request, _h) => {
    const claims = request.auth.credentials
    const { project } = request.payload
    const { relationshipId, orgId } = currentOrgContext(claims)
    const row = await insertProject(request.drizzle, {
      project,
      userId: claims.sub,
      orgId,
      relationshipId
    })
    return toProjectResponse(row)
  }
}

const getHabitat = {
  method: 'GET',
  path: '/projects/{projectId}/habitats/{featureId}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        projectId: Joi.string().uuid().required(),
        featureId: Joi.string().uuid().required()
      })
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

    const habitats = rows[0].project?.baseline?.habitats ?? []
    const habitat = habitats.find((h) => h.featureId === featureId)
    if (!habitat) {
      throw Boom.notFound(
        `Habitat ${featureId} not found in project ${projectId}`
      )
    }
    // Evidence (Item W4 — single-feature reads fetch the whole document): the
    // full project JSONB was selected and deserialised just to find() one
    // habitat. docBytes is the whole document shipped from Postgres; only
    // featureBytes is returned to the caller.
    logPerf(request.logger, 'single-feature-full-doc', {
      habitatCount: habitats.length,
      docBytes: utf8Bytes(JSON.stringify(rows[0].project ?? {})),
      featureBytes: utf8Bytes(JSON.stringify(habitat))
    })
    return habitat
  }
}

const updateProject = {
  method: 'PATCH',
  path: '/projects/{id}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        id: Joi.string().uuid().required()
      }),
      payload: Joi.object({
        project: Joi.object({
          name: Joi.string().trim().min(1).required()
        }).required()
      })
    }
  },
  handler: async (request, _h) => {
    const { sub } = request.auth.credentials
    const { id } = request.params
    const {
      project: { name }
    } = request.payload
    const row = await setProjectName(
      request.drizzle,
      id,
      name,
      and(eq(projects.id, id), visibleToUser(sub))
    )
    if (!row) {
      throw Boom.notFound(`Project ${id} not found`)
    }
    return toProjectResponse(row)
  }
}

export { getProjects, getProject, getHabitat, createProject, updateProject }
