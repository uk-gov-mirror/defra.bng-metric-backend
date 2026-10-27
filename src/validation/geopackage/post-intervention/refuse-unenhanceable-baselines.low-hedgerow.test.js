// AC5: a Low hedgerow in Good condition whose type the metric's G-6 data lets
// become no Medium hedgerow. Line of trees - associated with bank or ditch is
// the one: its only Medium target, Native hedgerow with trees, is refused by
// G-6's allowed-moves table (AT14), though the time-to-target table gives the
// move 12 years (Y14).

import { UNENHANCEABLE_BASELINE } from 'bng-library/metric'
import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import { refuseUnenhanceableBaselines } from './refuse-unenhanceable-baselines.js'

const LINE_OF_TREES_BANK = 'Line of trees - associated with bank or ditch'

function enhancedHedgerow(type, condition) {
  return {
    ref: 'HG1',
    retentionCategory: 'Enhanced',
    baseline: { type, condition },
    proposed: { type: 'Native hedgerow with trees', condition: 'Good' }
  }
}

describe('refuseUnenhanceableBaselines, AC5', () => {
  it(`refuses an enhanced ${LINE_OF_TREES_BANK} in Good condition`, () => {
    const error = refuseUnenhanceableBaselines({
      hedgerows: [enhancedHedgerow(LINE_OF_TREES_BANK, '3. Good')]
    })

    expect(error.code).toBe(ERROR_CODES.BASELINE_NOT_ENHANCEABLE)
    expect(error.details.sample).toEqual([
      {
        layer: 'hedgerows',
        feature_ref: 'HG1',
        habitat_type: LINE_OF_TREES_BANK,
        condition: 'Good',
        distinctiveness: 'Low',
        rule: UNENHANCEABLE_BASELINE.LOW_HEDGEROW_GOOD_NO_MEDIUM_TARGET,
        mvsOnly: true
      }
    ])
  })

  it(`accepts an enhanced ${LINE_OF_TREES_BANK} in Moderate condition, whose condition can still improve`, () => {
    expect(
      refuseUnenhanceableBaselines({
        hedgerows: [enhancedHedgerow(LINE_OF_TREES_BANK, 'Moderate')]
      })
    ).toBeNull()
  })

  it.each(['Native hedgerow', 'Line of trees'])(
    'accepts an enhanced %s in Good condition, which can become a Medium hedgerow',
    (type) => {
      expect(
        refuseUnenhanceableBaselines({
          hedgerows: [enhancedHedgerow(type, 'Good')]
        })
      ).toBeNull()
    }
  )
})
