import { asc, desc, sql } from 'drizzle-orm'
import Joi from 'joi'
import { projects } from '../db/schema/index.js'
import { visibleToUser } from '../db/project-visibility.js'
import { logPerf, perfNow, utf8Bytes } from '../common/helpers/perf-evidence.js'

const orderDirections = { asc, desc }

const sortColumns = {
  created_at: projects.createdAt,
  updated_at: projects.updatedAt,
  name: sql`${projects.project}->>'name'`
}

/**
 * @openapi
 * /users/{userId}/projects:
 *   get:
 *     tags:
 *       - Users
 *     summary: List the authenticated user's visible projects
 *     description: |
 *       The user is taken from the verified Bearer token (`sub`); the {userId}
 *       path segment is retained for routing only and is not trusted. Returns
 *       projects the user owns whose latest role for the project's relationship
 *       is approved (status 3), plus their legacy projects with no relationship.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [created_at, updated_at, name]
 *           default: updated_at
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Returns an array of the user's visible projects
 *       401:
 *         description: Missing or invalid bearer token
 */
const getUserProjects = {
  method: 'GET',
  path: '/users/{userId}/projects',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        // Defra ID `sub` is not a UUID; the value is not trusted (we use the
        // token `sub`), so accept any non-empty string for routing.
        userId: Joi.string().required()
      }),
      query: Joi.object({
        sort: Joi.string()
          .valid('created_at', 'updated_at', 'name')
          .default('updated_at'),
        order: Joi.string().valid('asc', 'desc').default('desc')
      })
    }
  },
  handler: async (request, _h) => {
    const { sub } = request.auth.credentials
    const { sort, order } = request.query

    const queryStart = perfNow()
    const rows = await request.drizzle
      .select()
      .from(projects)
      .where(visibleToUser(sub))
      .orderBy(orderDirections[order](sortColumns[sort]))
    const queryMs = Math.round(perfNow() - queryStart)

    // Evidence (Item W2 — no index on projects.user_id): the list filters on
    // user_id with no supporting index (only the id PK exists), so this is a
    // sequential scan whose queryMs grows with the projects table size.
    logPerf(request.logger, 'projects-user-id-seqscan', {
      rowCount: rows.length,
      queryMs
    })
    // Evidence (Item W1 — project list returns the entire JSONB doc): every
    // visible project's full metric document is selected (no projection, no
    // limit). responseBytes is what gets shipped to and re-parsed by the
    // frontend, though the list view needs only id/name/timestamps.
    logPerf(request.logger, 'project-list-full-jsonb', {
      rowCount: rows.length,
      responseBytes: utf8Bytes(JSON.stringify(rows))
    })
    // Evidence (Item W6 — sort=name orders on a JSONB-derived value): sorting on
    // project->>'name' cannot use a b-tree index, so it is an unindexed
    // expression sort over the full JSONB rows above.
    if (sort === 'name') {
      logPerf(request.logger, 'jsonb-name-sort', {
        rowCount: rows.length,
        queryMs
      })
    }

    return rows
  }
}

export { getUserProjects }
