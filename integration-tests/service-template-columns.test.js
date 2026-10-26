import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { describeServiceTemplate } from '../test/helpers/template-mode.js'
import { parseProposedAdvanceDelayYears } from '../src/validation/geopackage/post-intervention/extract-post-intervention-sub-objects.js'
import { TEMPLATE_MAPPING_1_0 } from '../src/validation/geopackage/service-template/template-mapping.js'
import {
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION
} from 'bng-library/bng-service'
import { fixturePath } from './helpers/upload-fixtures.js'
import {
  callPostInterventionValidate,
  createProject,
  fetchProject,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

// The harness's valid/default-site.gpkg: every column of every table holds a
// value in at least one row, both stages hold features, the Red Line
// Boundary's site details are filled in, and one Habitat Ref repeats.
const EVERY_COLUMN = 'service-template/default-site.gpkg'

// The pipeline's logical layer, and the document key it is stored under.
const LAYERS = [
  ['areas', 'habitats'],
  ['hedgerows', 'hedgerows'],
  ['watercourses', 'watercourses']
]
const STAGES = [
  [STAGE_BASELINE, 'baseline'],
  [STAGE_POST_INTERVENTION, 'postIntervention']
]
const GEOMETRY_COLUMN = 'geom'
const FID = 'fid'
const HABITAT_REF = 'Habitat Ref'
const PROPOSED_SIGNIFICANCE = 'Proposed Strategic Significance'
// The metric's strategic significance multipliers.
const MULTIPLIERS = { Low: 1, High: 1.15 }
// What a document records about its upload rather than the file's contents.
const UPLOAD_FIELDS = ['uploadId', 'importedAt', 'filename', 'fileSize']
// Ids each project gives its own features, and so its links to them.
const PER_PROJECT_IDS = new Set(['featureId', 'parentFeatureId'])

/** Each row of a fixture's table, by fid. */
function rowsOf(filePath, table) {
  const db = new Database(filePath, { readonly: true })
  try {
    return db.prepare(`SELECT * FROM "${table}" ORDER BY fid`).all()
  } finally {
    db.close()
  }
}

const byFid = (features) =>
  new Map(features.map((feature) => [feature.properties.fid, feature]))

const ADVANCE = 'Habitat created in advance/years'
const DELAY = 'Delay in starting habitat creation/years'
const TIMING = { [ADVANCE]: DELAY, [DELAY]: ADVANCE }
const NO_YEARS = '0'
const isBlank = (value) => value === null || String(value).trim() === ''
// Years above 0, parsed as the calculation parses them.
const aboveZero = (value) => (parseProposedAdvanceDelayYears(value) ?? 0) > 0

/**
 * A column's value as the pipeline keeps it: a reference trimmed, and a timing
 * column the template greys out (blank while the other is above 0) as 0.
 */
function asKept(column, row) {
  const value = row[column]
  if (column === HABITAT_REF && typeof value === 'string') {
    return value.trim()
  }
  const other = TIMING[column]
  if (other && isBlank(value) && aboveZero(row[other])) {
    return NO_YEARS
  }
  return value
}

const USES_TIMING = new Set(['Created', 'Enhanced'])

/** Whether a timing value is years, as the calculation reads it: 30+ is 30. */
const isYears = (value) =>
  isBlank(value) || /^\d+\+?$/.test(String(value).trim())

/** The stored documents, without what changes on every upload. */
function contents(project) {
  const strip = (document) =>
    JSON.parse(
      JSON.stringify(document, (key, value) =>
        UPLOAD_FIELDS.includes(key) || PER_PROJECT_IDS.has(key)
          ? undefined
          : value
      )
    )
  return {
    baseline: strip(project.baseline),
    postIntervention: strip(project.postIntervention)
  }
}

let scratch
beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'service-template-columns-'))
})
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

async function uploadCombined(name, filePath) {
  const project = await createProject(name)
  const uploadId = await uploadFixture(EVERY_COLUMN, filePath)
  const res = await callPostInterventionValidate(uploadId, {
    projectId: project.id
  })
  expect(res.result).toEqual({ valid: true, errors: [] })
  return fetchProject(project.id)
}

/**
 * A copy of the fixture with every column the mapping drops given another
 * value, in every row of every habitat table: values the service would
 * refuse or price differently if it read them.
 */
function withDroppedColumnsChanged() {
  const filePath = path.join(scratch, 'dropped-changed.gpkg')
  copyFileSync(fixturePath(EVERY_COLUMN), filePath)
  const changed = {
    'Baseline Distinctiveness': 'V.High',
    'Proposed Distinctiveness': 'V.High',
    'Spatial risk category': 'Far from site',
    Area: 1,
    Length: 1,
    'Baseline Length': 1
  }
  const db = new Database(filePath)
  try {
    for (const [logical] of LAYERS) {
      const { table, columns } = TEMPLATE_MAPPING_1_0[logical]
      for (const [stage] of STAGES) {
        const present = new Set(
          db.pragma(`table_info("${table(stage)}")`).map(({ name }) => name)
        )
        const dropped = [...columns]
          .filter(
            ([column, target]) =>
              target === null && column in changed && present.has(column)
          )
          .map(([column]) => column)
        for (const column of dropped) {
          db.prepare(`UPDATE "${table(stage)}" SET "${column}" = ?`).run(
            changed[column]
          )
        }
      }
    }
  } finally {
    db.close()
  }
  return filePath
}

describeServiceTemplate(
  'BNG Service template, every column of every habitat table — with the service-template flag on',
  () => {
    let stored
    beforeAll(async () => {
      stored = await uploadCombined('Service template every column')
    })

    it.each(
      LAYERS.flatMap((layer) => STAGES.map((stage) => [...layer, ...stage]))
    )(
      'keeps each %s column the mapping reads, with the file’s value, and drops the rest (%s, %s)',
      (logical, documentKey, stage, documentName) => {
        const { table, columns } = TEMPLATE_MAPPING_1_0[logical]
        const rows = rowsOf(fixturePath(EVERY_COLUMN), table(stage))
        const features = byFid(stored[documentName][documentKey])
        expect(features.size).toBe(rows.length)
        for (const row of rows) {
          const { properties } = features.get(row.fid)
          for (const column of Object.keys(row)) {
            if (column === GEOMETRY_COLUMN || column === FID) {
              continue
            }
            // Every column of the table has a decision in the mapping.
            expect(columns.has(column), `${table(stage)}: ${column}`).toBe(true)
            const target = columns.get(column)
            if (target === null) {
              expect(
                properties,
                `${table(stage)}: ${column}`
              ).not.toHaveProperty([column])
            } else {
              expect(
                properties[target],
                `${table(stage)} fid ${row.fid}: ${column}`
              ).toEqual(asKept(column, row))
            }
          }
        }
      }
    )

    it('stores nothing that changes when the columns it drops change', async () => {
      const changed = await uploadCombined(
        'Service template dropped columns changed',
        withDroppedColumnsChanged()
      )

      expect(contents(changed)).toEqual(contents(stored))
    })

    // A Created or Enhanced habitat is priced once its timing is known: in
    // years, with the column the template greys out read as 0. It is saved
    // Incomplete, for the user to finish, when neither column is filled in,
    // or one holds text other than 30+ (BMD-1083).
    it('prices every post-intervention habitat whose timing is known', () => {
      for (const [, documentKey] of LAYERS) {
        for (const feature of stored.postIntervention[documentKey]) {
          const timing = [ADVANCE, DELAY].map((c) => feature.properties[c])
          const known =
            !USES_TIMING.has(feature.retentionCategory) ||
            (timing.every(isYears) && !timing.every(isBlank))
          expect(
            feature.status,
            `${documentKey} ${feature.ref}: ${timing.join(', ')}`
          ).toBe(known ? 'Complete' : 'Incomplete')
        }
      }
    })

    it('prices Low and High strategic significance on every post-intervention layer with the metric’s multipliers', () => {
      for (const [, documentKey] of LAYERS) {
        const features = stored.postIntervention[documentKey].filter(
          ({ status }) => status === 'Complete'
        )
        const seen = new Set()
        for (const feature of features) {
          const recorded = feature.properties[PROPOSED_SIGNIFICANCE]
          seen.add(recorded)
          expect(feature.proposed.strategicSignificanceScore, documentKey).toBe(
            MULTIPLIERS[recorded]
          )
        }
        expect([...seen].sort(), documentKey).toEqual(['High', 'Low'])
      }
    })

    it('reads the Red Line Boundary for its geometry alone, and no tree or vertical area habitat yet', () => {
      for (const [, documentName] of STAGES) {
        const document = stored[documentName]
        expect(document.redLine.properties).toEqual({ fid: 1 })
        expect(JSON.stringify(document.redLine)).not.toContain(
          'Oakwood Regional Development'
        )
        // Individual trees (BMD-1172) and vertical area habitats (BMD-1084)
        // are not read yet.
        expect(document.trees).toEqual([])
        expect(document).not.toHaveProperty('verticalHabitats')
      }
    })

    it('reads each area habitat’s Irreplaceable Habitat, at both stages', () => {
      for (const [, documentName] of STAGES) {
        for (const habitat of stored[documentName].habitats) {
          expect(habitat.irreplaceable, habitat.ref).toBe(false)
        }
      }
    })

    it('reads "Yes" as irreplaceable, and "No" or blank as not', async () => {
      const project = await createProject('Service template irreplaceable')
      const fixture = 'service-template/irreplaceable-area-habitat.gpkg'
      const yes = new Set(
        rowsOf(fixturePath(fixture), 'Area Habitats Baseline')
          .filter((row) => row['Irreplaceable Habitat'] === 'Yes')
          .map((row) => row.fid)
      )
      expect(yes.size).toBeGreaterThan(0)

      const res = await callPostInterventionValidate(
        await uploadFixture(fixture),
        { projectId: project.id }
      )

      expect(res.result).toEqual({ valid: true, errors: [] })
      const { baseline } = await fetchProject(project.id)
      for (const habitat of baseline.habitats) {
        expect(habitat.irreplaceable, habitat.ref).toBe(
          yes.has(habitat.properties.fid)
        )
      }
    })

    it('accepts a Habitat Ref that repeats, keeping each row as its own habitat', () => {
      const shared = stored.postIntervention.habitats.filter(
        ({ ref }) => ref === 'H003'
      )
      expect(shared).toHaveLength(2)
      expect(new Set(shared.map(({ featureId }) => featureId)).size).toBe(2)
    })
  }
)
