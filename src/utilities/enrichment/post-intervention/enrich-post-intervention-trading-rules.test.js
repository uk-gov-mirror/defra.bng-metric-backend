import { describe, expect, it } from 'vitest'

import { enrichPostInterventionWatercourseTradingRules } from './enrich-post-intervention-trading-rules.js'

// Build a post-intervention watercourse carrying only the fields the
// trading-rules aggregation reads: retention category, baseline/proposed type
// and the already-calculated units.
function piWatercourse({
  retentionCategory,
  baselineType = null,
  proposedType = null,
  units
}) {
  return {
    retentionCategory,
    units,
    baseline: { type: baselineType },
    proposed: { type: proposedType }
  }
}

function baselineWatercourse(type, units) {
  return { type, units }
}

// The BMD-995 worked example (2 dp). Baseline units per type from C-1 col R;
// delivered units split across retained (C-1 col W), enhanced (C-3 col AM) and
// created (C-2 col Z), attributed to the habitat each delivers into.
function workedExampleDocument() {
  return {
    watercourses: [
      // Ditches (Medium): retained 15.52 + enhanced 14.66 + created 10.87
      piWatercourse({
        retentionCategory: 'Retained',
        baselineType: 'Ditches',
        proposedType: 'Ditches',
        units: 15.52
      }),
      piWatercourse({
        retentionCategory: 'Enhanced',
        baselineType: 'Canals',
        proposedType: 'Ditches',
        units: 14.66
      }),
      piWatercourse({
        retentionCategory: 'Created',
        proposedType: 'Ditches',
        units: 10.87
      }),
      // Canals (Medium): retained 9.60 + enhanced 9.08
      piWatercourse({
        retentionCategory: 'Retained',
        baselineType: 'Canals',
        proposedType: 'Canals',
        units: 9.6
      }),
      piWatercourse({
        retentionCategory: 'Enhanced',
        baselineType: 'Ditches',
        proposedType: 'Canals',
        units: 9.08
      }),
      // Culvert (Low): retained 0.95
      piWatercourse({
        retentionCategory: 'Retained',
        baselineType: 'Culvert',
        proposedType: 'Culvert',
        units: 0.95
      })
    ]
  }
}

const WORKED_EXAMPLE_BASELINE = [
  baselineWatercourse('Ditches', 28.13),
  baselineWatercourse('Canals', 24.86),
  baselineWatercourse('Culvert', 22.44)
]

describe('enrichPostInterventionWatercourseTradingRules', () => {
  it('writes the worked-example watercourse trading rules onto the document', () => {
    const doc = workedExampleDocument()

    enrichPostInterventionWatercourseTradingRules(doc, WORKED_EXAMPLE_BASELINE)

    expect(doc.tradingRules.watercourses).toEqual({
      habitats: [
        {
          habitatType: 'Canals',
          distinctiveness: 'Medium',
          netUnitChange: -6.18
        },
        {
          habitatType: 'Culvert',
          distinctiveness: 'Low',
          netUnitChange: -21.49
        },
        {
          habitatType: 'Ditches',
          distinctiveness: 'Medium',
          netUnitChange: 12.92
        }
      ],
      medium: { surplus: 12.92, deficit: -6.18 },
      low: { netUnitChange: -21.49, cumulativeAvailability: -8.57 }
    })
  })

  it('attributes retained units to the baseline type even when proposed is an N/A placeholder', () => {
    const doc = {
      watercourses: [
        piWatercourse({
          retentionCategory: 'Retained',
          baselineType: 'Ditches',
          proposedType: 'N/A',
          units: 5
        })
      ]
    }

    enrichPostInterventionWatercourseTradingRules(doc, [
      baselineWatercourse('Ditches', 2)
    ])

    expect(doc.tradingRules.watercourses.habitats).toEqual([
      { habitatType: 'Ditches', distinctiveness: 'Medium', netUnitChange: 3 }
    ])
  })

  it('skips features whose units are not yet calculated (null)', () => {
    const doc = {
      watercourses: [
        piWatercourse({
          retentionCategory: 'Created',
          proposedType: 'Ditches',
          units: null
        })
      ]
    }

    enrichPostInterventionWatercourseTradingRules(doc, [])

    expect(doc.tradingRules.watercourses.habitats).toEqual([])
    expect(doc.tradingRules.watercourses.medium).toEqual({
      surplus: 0,
      deficit: 0
    })
  })

  it('produces zeroed aggregates when there are no watercourses on either side', () => {
    const doc = {}

    enrichPostInterventionWatercourseTradingRules(doc, [])

    expect(doc.tradingRules.watercourses).toEqual({
      habitats: [],
      medium: { surplus: 0, deficit: 0 },
      low: { netUnitChange: 0, cumulativeAvailability: 0 }
    })
  })

  it('preserves any sibling trading-rules modules already on the document', () => {
    const doc = { tradingRules: { hedgerows: { placeholder: true } } }

    enrichPostInterventionWatercourseTradingRules(doc, [])

    expect(doc.tradingRules.hedgerows).toEqual({ placeholder: true })
    expect(doc.tradingRules.watercourses).toBeDefined()
  })
})
