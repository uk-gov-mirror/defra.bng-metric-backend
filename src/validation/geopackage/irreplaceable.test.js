import { describe, expect, it } from 'vitest'

import { irreplaceableField, irreplaceableFromProps } from './irreplaceable.js'

const COLUMN = 'Irreplaceable Habitat'

describe('irreplaceableFromProps', () => {
  it.each([
    ['Yes', true],
    [' yes ', true],
    ['No', false],
    ['', false],
    ['   ', false],
    [null, false]
  ])('reads %j as %s', (value, expected) => {
    expect(irreplaceableFromProps({ [COLUMN]: value })).toBe(expected)
  })

  it('is undefined for a file with no such column, as a legacy file has none', () => {
    expect(irreplaceableFromProps({ 'Parcel Ref': 'H001' })).toBeUndefined()
    expect(irreplaceableFromProps(undefined)).toBeUndefined()
  })
})

describe('irreplaceableField', () => {
  it('gives the status to spread onto a feature, or nothing', () => {
    expect(irreplaceableField({ [COLUMN]: 'Yes' })).toEqual({
      irreplaceable: true
    })
    expect(irreplaceableField({})).toEqual({})
  })
})
