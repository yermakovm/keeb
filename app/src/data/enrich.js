/** Adds layer display names to layer-target bindings for cap rendering. */
export function enrichBinding(binding, layers) {
  if (!binding) return null
  if ('layer' in binding && binding.layer != null) {
    const l = layers[binding.layer]
    return { ...binding, layerName: l ? l.name : binding.layer }
  }
  return binding
}
