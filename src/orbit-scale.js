// Only glyph sizes are softened; positions always follow the camera.
export function dimensioniGalassia(physicalScale) {
  const scale = Math.max(0, physicalScale)
  return {
    product: Math.max(0.45, 22 * Math.tanh(16 * scale ** 0.65 / 22)),
    center: Math.max(1.5, 30 * Math.tanh(24 * scale ** 0.55 / 30)),
  }
}
