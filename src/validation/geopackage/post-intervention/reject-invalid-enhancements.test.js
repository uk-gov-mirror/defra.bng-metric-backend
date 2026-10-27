import { ENHANCEMENT_RULE, UNENHANCEABLE_BASELINE } from 'bng-library/metric'
import { describe, expect, it, vi } from 'vitest'

import {
  extractAndValidateDocument,
  saveHandlersForConfig
} from '../../../services/upload/save-upload-for-project.js'
import { ERROR_CODES } from '../errors.js'
import {
  ENHANCEMENT_INVALID_EVENT,
  rejectInvalidEnhancements
} from './reject-invalid-enhancements.js'
import {
  SAMPLE_LINESTRING,
  feature
} from './extract-post-intervention.test-fixtures.js'

const LOW_STRATEGIC_SIGNIFICANCE =
  'Area/compensation not in local strategy/ no local strategy'
const PARCEL_SQM = 5000
const HEDGEROW_M = 120
const WATERCOURSE_M = 250

function enhancedHabitat({ baseline, proposed, ref = 'H1' }) {
  return {
    featureId: `feature-${ref}`,
    ref,
    retentionCategory: 'Enhanced',
    status: 'Complete',
    units: null,
    baseline: { broadType: 'Grassland', ...baseline },
    proposed: {
      broadType: 'Grassland',
      strategicSignificance: LOW_STRATEGIC_SIGNIFICANCE,
      advanceYears: 2,
      delayYears: 0,
      distinctiveness: null,
      ...proposed
    },
    properties: { 'Parcel Ref': ref }
  }
}

function enhancedWatercourse({ baseline, proposed }) {
  return {
    featureId: 'feature-W1',
    ref: 'W1',
    retentionCategory: 'Enhanced',
    status: 'Complete',
    baseline,
    proposed: {
      strategicSignificance: LOW_STRATEGIC_SIGNIFICANCE,
      watercourseEncroachment: 'No Encroachment',
      riparianEncroachment: 'No Encroachment',
      advanceYears: 0,
      delayYears: 1,
      ...proposed
    }
  }
}

describe('rejectInvalidEnhancements', () => {
  it('nulls every proposed attribute of an invalid enhancement and saves it Incomplete', () => {
    const habitat = enhancedHabitat({
      baseline: { type: 'Modified grassland', condition: 'Moderate' },
      proposed: { type: 'Modified grassland', condition: 'Poor' }
    })
    const document = { habitats: [habitat] }

    expect(rejectInvalidEnhancements(document)).toBe(1)

    expect(habitat).toEqual({
      featureId: 'feature-H1',
      ref: 'H1',
      retentionCategory: 'Enhanced',
      status: 'Incomplete',
      units: null,
      invalidEnhancement: ENHANCEMENT_RULE.LOW_AREA,
      baseline: {
        broadType: 'Grassland',
        type: 'Modified grassland',
        condition: 'Moderate'
      },
      proposed: {
        broadType: null,
        type: null,
        condition: null,
        strategicSignificance: null,
        advanceYears: null,
        delayYears: null,
        distinctiveness: null
      },
      properties: { 'Parcel Ref': 'H1' }
    })
  })

  it('nulls the encroachments of an invalid watercourse enhancement', () => {
    const watercourse = enhancedWatercourse({
      baseline: { type: 'Ditches', condition: 'Moderate' },
      proposed: { type: 'Canals', condition: 'Good' }
    })

    rejectInvalidEnhancements({ watercourses: [watercourse] })

    expect(watercourse.invalidEnhancement).toBe(
      ENHANCEMENT_RULE.MEDIUM_WATERCOURSE
    )
    expect(Object.values(watercourse.proposed).every((v) => v === null)).toBe(
      true
    )
    expect(watercourse.proposed).toHaveProperty('watercourseEncroachment')
    expect(watercourse.proposed).toHaveProperty('riparianEncroachment')
  })

  it('checks hedgerows', () => {
    const hedgerow = {
      retentionCategory: 'Enhanced',
      baseline: { type: 'Native hedgerow', condition: 'Moderate' },
      proposed: { type: 'Native hedgerow', condition: 'Moderate' }
    }

    rejectInvalidEnhancements({ hedgerows: [hedgerow] })

    expect(hedgerow.invalidEnhancement).toBe(ENHANCEMENT_RULE.LOW_HEDGEROW)
    expect(hedgerow.proposed).toEqual({ type: null, condition: null })
  })

  // G-6's allowed-moves table, which the metric checks before it calculates
  // anything, refuses these moves, though a time-to-target table has years
  // for each.
  it.each([
    [
      'another Medium hedgerow type',
      { type: 'Native hedgerow with trees', condition: 'Moderate' },
      { type: 'Species-rich native hedgerow', condition: 'Good' },
      ENHANCEMENT_RULE.MEDIUM_HEDGEROW
    ],
    [
      'a hedgerow without the bank or ditch (G-6 AT14 against Y14)',
      {
        type: 'Line of trees - associated with bank or ditch',
        condition: 'Moderate'
      },
      { type: 'Native hedgerow with trees', condition: 'Good' },
      ENHANCEMENT_RULE.LOW_HEDGEROW
    ]
  ])(
    'nulls an enhancement of a hedgerow into %s, which the metric does not allow',
    (_, baseline, proposed, rule) => {
      const hedgerow = {
        retentionCategory: 'Enhanced',
        baseline,
        proposed: { ...proposed }
      }

      expect(rejectInvalidEnhancements({ hedgerows: [hedgerow] })).toBe(1)
      expect(hedgerow.invalidEnhancement).toBe(rule)
      expect(hedgerow.status).toBe('Incomplete')
      expect(hedgerow.proposed).toEqual({ type: null, condition: null })
    }
  )

  it('leaves a valid enhancement as it is', () => {
    const habitat = enhancedHabitat({
      baseline: { type: 'Modified grassland', condition: 'Moderate' },
      proposed: { type: 'Modified grassland', condition: 'Good' }
    })
    const before = structuredClone(habitat)

    expect(rejectInvalidEnhancements({ habitats: [habitat] })).toBe(0)
    expect(habitat).toEqual(before)
  })

  it.each(['Retained', 'Created'])(
    'leaves a %s habitat alone, whatever its proposed side',
    (retentionCategory) => {
      const habitat = {
        ...enhancedHabitat({
          baseline: { type: 'Modified grassland', condition: 'Moderate' },
          proposed: { type: 'Modified grassland', condition: 'Poor' }
        }),
        retentionCategory
      }
      const before = structuredClone(habitat)

      expect(rejectInvalidEnhancements({ habitats: [habitat] })).toBe(0)
      expect(habitat).toEqual(before)
    }
  )

  it('reads the intervention type from the baseline when the feature has none at its root', () => {
    const habitat = enhancedHabitat({
      baseline: {
        type: 'Modified grassland',
        condition: 'Moderate',
        retentionCategory: 'Enhanced'
      },
      proposed: { type: 'Modified grassland', condition: 'Poor' }
    })
    delete habitat.retentionCategory

    expect(rejectInvalidEnhancements({ habitats: [habitat] })).toBe(1)
    expect(habitat.invalidEnhancement).toBe(ENHANCEMENT_RULE.LOW_AREA)
  })

  it('leaves an enhancement no rule can check to the other validation', () => {
    const habitat = enhancedHabitat({
      baseline: { type: 'Modified grassland', condition: 'Moderate' },
      proposed: { type: null, condition: 'Poor' }
    })
    const before = structuredClone(habitat)

    expect(rejectInvalidEnhancements({ habitats: [habitat] })).toBe(0)
    expect(habitat).toEqual(before)
  })

  it('does not check individual trees', () => {
    const tree = {
      retentionCategory: 'Enhanced',
      baseline: { type: 'Urban tree', broadType: 'Individual trees' },
      proposed: { type: 'Urban tree', broadType: 'Individual trees' }
    }

    expect(rejectInvalidEnhancements({ trees: [tree] })).toBe(0)
    expect(tree).not.toHaveProperty('invalidEnhancement')
  })

  it('copes with a document missing layers', () => {
    expect(rejectInvalidEnhancements({})).toBe(0)
    expect(rejectInvalidEnhancements(null)).toBe(0)
  })

  it('logs each rejection as a structured warning', () => {
    const logger = { warn: vi.fn() }
    const habitat = enhancedHabitat({
      baseline: { type: 'Other neutral grassland', condition: 'Moderate' },
      proposed: {
        broadType: 'Heathland and shrub',
        type: 'Mixed scrub',
        condition: 'Good'
      }
    })

    rejectInvalidEnhancements({ habitats: [habitat] }, logger)

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: ENHANCEMENT_INVALID_EVENT,
        layer: 'habitats',
        featureId: 'feature-H1',
        ref: 'H1',
        rule: ENHANCEMENT_RULE.MEDIUM_AREA,
        baseline: {
          habitat: 'Grassland - Other neutral grassland',
          condition: 'Moderate',
          distinctiveness: 'Medium'
        },
        proposed: {
          habitat: 'Heathland and shrub - Mixed scrub',
          condition: 'Good',
          distinctiveness: 'Medium'
        }
      },
      expect.stringContaining('breaks rule medium-area')
    )
  })
})

describe('importing a post-intervention file', () => {
  const FEATURE_IDS = {
    VALID: '11111111-1111-4111-8111-000000000001',
    INVALID: '11111111-1111-4111-8111-000000000002',
    W1: '11111111-1111-4111-8111-000000000003'
  }

  function withFeatureId(row, ref) {
    return { ...row, featureId: FEATURE_IDS[ref] }
  }

  function areaRow(
    ref,
    {
      proposedType,
      proposedCondition,
      baselineType = 'Modified grassland',
      baselineCondition = 'Moderate',
      extra = {}
    }
  ) {
    const row = feature({
      ...extra,
      'Parcel Ref': ref,
      'Retention Category': 'Enhanced',
      'Baseline Broad Habitat Type': 'Grassland',
      'Baseline Habitat Type': baselineType,
      'Baseline Condition': baselineCondition,
      'Proposed Broad Habitat Type': 'Grassland',
      'Proposed Habitat Type': proposedType,
      'Proposed Condition': proposedCondition,
      'Proposed Strategic Significance': LOW_STRATEGIC_SIGNIFICANCE,
      'Habitat created in advance/years': 0,
      'Delay in starting habitat creation/years': 0
    })
    return withFeatureId(row, ref)
  }

  function riverRow(ref, { proposedType, proposedCondition }) {
    const row = feature(
      {
        'Parcel Ref': ref,
        'Retention Category': 'Enhanced',
        'Baseline River Type': 'Ditches',
        'Baseline Condition': 'Moderate',
        'Baseline Encroachment into Watercourse': 'No Encroachment',
        'Baseline Encroachment into riparian zone': 'No Encroachment',
        'Proposed River Type': proposedType,
        'Proposed Condition': proposedCondition,
        'Proposed Encroachment into Watercourse': 'No Encroachment',
        'Proposed Encroachment into riparian zone': 'No Encroachment',
        'Proposed Strategic Significance': LOW_STRATEGIC_SIGNIFICANCE
      },
      SAMPLE_LINESTRING
    )
    return withFeatureId(row, ref)
  }

  function importDocument(layers, { template, baselineDocument } = {}) {
    return extractAndValidateDocument({
      handlers: saveHandlersForConfig({
        projectDocumentKey: 'postIntervention'
      }),
      layersWithIds: {
        redline: [],
        hedgerows: [],
        trees: [],
        ...layers
      },
      storedProject: {
        baseline: {
          watercourses: [{ ref: 'W1', sizeMetres: WATERCOURSE_M }]
        }
      },
      context: {
        uploadId: '11111111-1111-4111-8111-111111111111',
        filename: 'post.gpkg',
        fileSize: 1,
        template
      },
      ...(baselineDocument ? { baselineDocument } : {}),
      logger: { warn: vi.fn(), info: vi.fn() },
      config: { projectDocumentKey: 'postIntervention' },
      habitatSizes: {
        areaHabitats: {
          totalSquareMetres: PARCEL_SQM * layers.areas.length,
          individualSquareMetres: layers.areas.map(({ featureId }) => ({
            featureId,
            sizeSquareMetres: PARCEL_SQM
          }))
        },
        hedgerows: { totalMetres: HEDGEROW_M, individualMetres: [] },
        watercourses: {
          totalMetres: WATERCOURSE_M * layers.watercourses.length,
          individualMetres: layers.watercourses.map(({ featureId }) => ({
            featureId,
            sizeMetres: WATERCOURSE_M
          }))
        }
      }
    })
  }

  it('saves an invalid enhancement with only its shape, ref and intervention type, and prices a valid one', () => {
    const { document, geometries, schemaError } = importDocument({
      areas: [
        areaRow('VALID', {
          proposedType: 'Modified grassland',
          proposedCondition: 'Good'
        }),
        areaRow('INVALID', {
          proposedType: 'Modified grassland',
          proposedCondition: 'Poor'
        })
      ],
      watercourses: [
        riverRow('W1', { proposedType: 'Canals', proposedCondition: 'Good' })
      ]
    })

    expect(schemaError).toBeUndefined()

    const [valid, invalid] = document.habitats
    expect(valid).not.toHaveProperty('invalidEnhancement')
    expect(valid.status).toBe('Complete')
    expect(valid.units).toBeGreaterThan(0)

    expect(invalid).toMatchObject({
      ref: 'INVALID',
      retentionCategory: 'Enhanced',
      invalidEnhancement: ENHANCEMENT_RULE.LOW_AREA,
      status: 'Incomplete'
    })
    expect(invalid.proposed).toMatchObject({
      broadType: null,
      type: null,
      condition: null,
      strategicSignificance: null,
      advanceYears: null,
      delayYears: null
    })
    expect(geometries.habitats).toHaveLength(2)

    const [watercourse] = document.watercourses
    expect(watercourse).toMatchObject({
      invalidEnhancement: ENHANCEMENT_RULE.MEDIUM_WATERCOURSE,
      status: 'Incomplete'
    })
    expect(watercourse.proposed).toMatchObject({
      type: null,
      condition: null,
      watercourseEncroachment: null,
      riparianEncroachment: null
    })
    expect(geometries.watercourses).toHaveLength(1)
  })

  describe('BMD-1182: an enhanced baseline the service cannot enhance', () => {
    const NEUTRAL_GRASSLAND = 'Other neutral grassland'
    const PARENT_ID = '11111111-1111-4111-8111-0000000000aa'
    const PARENT_UUID = '22222222-2222-4222-8222-0000000000aa'
    const TEMPLATE = { name: 'bng-service', version: '1.0.0' }

    function enhancedNeutralGrassland(baselineCondition, extra) {
      return areaRow('VALID', {
        baselineType: NEUTRAL_GRASSLAND,
        baselineCondition,
        proposedType: NEUTRAL_GRASSLAND,
        proposedCondition: 'Good',
        extra
      })
    }

    function templateBaseline(condition) {
      return {
        habitats: [
          {
            featureId: PARENT_ID,
            ref: 'VALID',
            broadType: 'Grassland',
            type: NEUTRAL_GRASSLAND,
            condition,
            properties: { feature_uuid: PARENT_UUID }
          }
        ],
        watercourses: []
      }
    }

    it('refuses a legacy file, reading its Baseline columns, before anything is priced', () => {
      const { document, validationError, schemaError } = importDocument({
        areas: [enhancedNeutralGrassland('3. Good')],
        watercourses: []
      })

      expect(schemaError).toBeUndefined()
      expect(validationError).toMatchObject({
        code: ERROR_CODES.BASELINE_NOT_ENHANCEABLE,
        details: {
          count: 1,
          sample: [
            expect.objectContaining({
              feature_ref: 'VALID',
              habitat_type: 'Grassland - Other neutral grassland',
              condition: 'Good',
              rule: UNENHANCEABLE_BASELINE.MEDIUM_AREA_GOOD
            })
          ]
        }
      })
      expect(document.habitats[0].units).toBeNull()
      expect(document.habitats[0]).not.toHaveProperty('invalidEnhancement')
    })

    it("refuses a template file whose row's parent is in Good condition, though the row's copy says Moderate", () => {
      const { validationError } = importDocument(
        {
          areas: [
            enhancedNeutralGrassland('Moderate', { parent_uuid: PARENT_UUID })
          ],
          watercourses: []
        },
        { template: TEMPLATE, baselineDocument: templateBaseline('Good') }
      )

      expect(validationError).toMatchObject({
        code: ERROR_CODES.BASELINE_NOT_ENHANCEABLE,
        details: { sample: [expect.objectContaining({ condition: 'Good' })] }
      })
    })

    it("accepts a template file whose row's parent can be enhanced", () => {
      const { validationError, document } = importDocument(
        {
          areas: [
            enhancedNeutralGrassland('Good', { parent_uuid: PARENT_UUID })
          ],
          watercourses: []
        },
        { template: TEMPLATE, baselineDocument: templateBaseline('Moderate') }
      )

      expect(validationError).toBeUndefined()
      expect(document.habitats[0].parentFeatureId).toBe(PARENT_ID)
    })
  })
})
