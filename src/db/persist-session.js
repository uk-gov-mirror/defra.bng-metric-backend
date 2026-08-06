// The single sanctioned path for writing the bng.users / bng.relationships /
// bng.roles tables, and for appending the append-only bng.login_audit row.
// Called from POST /auth/session with the VERIFIED token payload (never the
// frontend's parsed claims).
//
// Everything happens in one transaction so a login can never leave a user with
// half their relationships/roles applied. Every row is UPSERTed — we never
// delete — so a relationship/role removed at the IdP arrives as a status update
// (6/7) on the next login rather than vanishing. `sql\`excluded.<col>\`` is used
// in every `set` (not the JS value) so concurrent logins for the same user
// converge on the row the database actually wrote. The login_audit append is
// de-duplicated on session_id (ON CONFLICT DO NOTHING), so a repeat login for
// the same session records nothing new but still refreshes the user row.
//
// PII safety: this module must NOT log `claims` or any token contents (email,
// names). Callers log at most the `sub`.
import { sql } from 'drizzle-orm'

import { users, relationships, roles } from './schema/index.js'
import { insertLoginAudit } from './persist-login-audit.js'
import { parseRelationships, parseRoles } from '../services/defra-id/claims.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { logPerf, perfNow } from '../common/helpers/perf-evidence.js'

const logger = createLogger()

function userValues(claims) {
  return {
    userId: claims.sub,
    email: claims.email ?? null,
    firstName: claims.firstName ?? claims.given_name ?? null,
    lastName: claims.lastName ?? claims.family_name ?? null,
    lastLogin: sql`now()`,
    sessionId: claims.sessionId ?? claims.sid ?? null,
    // The org context the user is currently acting in. Identifies which of the
    // user's relationships/roles is the active one (an Agent can hold several).
    currentRelationshipId: claims.currentRelationshipId ?? null
  }
}

async function upsertUser(tx, claims) {
  await tx
    .insert(users)
    .values(userValues(claims))
    .onConflictDoUpdate({
      target: users.userId,
      set: {
        email: sql`excluded.email`,
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        lastLogin: sql`now()`,
        sessionId: sql`excluded.session_id`,
        currentRelationshipId: sql`excluded.current_relationship_id`
        // `created` deliberately omitted — it stays at its original value.
      }
    })
}

async function upsertRelationships(tx, userId, rels) {
  for (const rel of rels) {
    await tx
      .insert(relationships)
      .values({
        userId,
        relationshipId: rel.relationshipId,
        orgId: rel.orgId ?? null,
        orgName: rel.orgName ?? null,
        relationship: rel.relationship ?? null
      })
      .onConflictDoUpdate({
        target: [relationships.userId, relationships.relationshipId],
        set: {
          orgId: sql`excluded.org_id`,
          orgName: sql`excluded.org_name`,
          relationship: sql`excluded.relationship`,
          lastUpdated: sql`now()`
        }
      })
  }
}

async function upsertRoles(tx, userId, userRoles) {
  for (const role of userRoles) {
    await tx
      .insert(roles)
      .values({
        userId,
        relationshipId: role.relationshipId,
        name: role.name,
        status: role.status
      })
      .onConflictDoUpdate({
        target: [roles.userId, roles.relationshipId, roles.name],
        set: {
          status: sql`excluded.status`,
          lastUpdated: sql`now()`
        }
      })
  }
}

/**
 * Persist the logged-in user's identity, org relationships and roles, and append
 * an immutable login-audit row, in one atomic transaction. Idempotent: a repeat
 * login upserts the user in place (no dupes, status / last_login refreshed) and
 * appends at most one login_audit row per session (de-duplicated on session_id).
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {object} claims verified Defra ID token payload (must carry `sub`)
 */
async function persistSession(drizzle, claims) {
  const rels = parseRelationships(claims)
  const userRoles = parseRoles(claims)

  const txStart = perfNow()
  await drizzle.transaction(async (tx) => {
    await upsertUser(tx, claims)
    await upsertRelationships(tx, claims.sub, rels)
    await upsertRoles(tx, claims.sub, userRoles)
    await insertLoginAudit(tx, claims)
  })

  // Evidence (Item W6 — login-time serial upserts): each relationship and role
  // is upserted in its own awaited round trip inside the login transaction, so
  // the round-trip count (and txMs) grows with the user's relationship/role
  // counts. PII-safe: only counts and timing are logged, never claims (see the
  // PII-safety note at the top of this file). ONE_ROUND_TRIP covers the single
  // user upsert and the single audit insert that bracket the loops.
  const BRACKETING_ROUND_TRIPS = 2
  logPerf(logger, 'login-serial-upserts', {
    relationshipCount: rels.length,
    roleCount: userRoles.length,
    upsertRoundTrips: BRACKETING_ROUND_TRIPS + rels.length + userRoles.length,
    txMs: Math.round(perfNow() - txStart)
  })
}

export { persistSession }
