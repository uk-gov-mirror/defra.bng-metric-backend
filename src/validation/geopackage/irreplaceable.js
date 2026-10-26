import { pickProp, PROP_KEYS } from './properties.js'

/**
 * A habitat's irreplaceable status, from the BNG Service template's
 * "Irreplaceable Habitat" column (BMD-1083): true for "Yes", and false for
 * "No" or a blank cell, which the service treats as "No" (BMD-1176).
 * Undefined for a file with no such column, as a legacy file has none.
 *
 * @param {object} props a feature's attributes, as the pipeline reads them
 * @returns {boolean | undefined}
 */
export function irreplaceableFromProps(props) {
  const column = PROP_KEYS.irreplaceable.find((key) => key in (props ?? {}))
  if (column === undefined) {
    return undefined
  }
  const value = pickProp(props, PROP_KEYS.irreplaceable)
  return typeof value === 'string' && value.trim().toLowerCase() === 'yes'
}

/** `{ irreplaceable }` when the file records it, else nothing to spread. */
export function irreplaceableField(props) {
  const irreplaceable = irreplaceableFromProps(props)
  return irreplaceable === undefined ? {} : { irreplaceable }
}
