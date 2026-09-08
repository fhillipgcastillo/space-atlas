// Normalized BP-RP colour index to RGB tint: 0 is the hottest blue-white, 1 the coolest red.
const STOPS: [t: number, r: number, g: number, b: number][] = [
  [0.0, 0.61, 0.71, 1.0],
  [0.25, 0.79, 0.85, 1.0],
  [0.45, 1.0, 0.98, 0.95],
  [0.62, 1.0, 0.94, 0.72],
  [0.8, 1.0, 0.79, 0.52],
  [1.0, 1.0, 0.6, 0.42],
];

export function colourAt(t: number): [number, number, number] {
  const clamped = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, r1, g1, b1] = STOPS[i]!;
    if (clamped > t1) continue;
    const [t0, r0, g0, b0] = STOPS[i - 1]!;
    const k = t1 === t0 ? 0 : (clamped - t0) / (t1 - t0);
    return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
  }
  const last = STOPS[STOPS.length - 1]!;
  return [last[1], last[2], last[3]];
}

/** RGBA texels for a 1D lookup texture; alpha is always 255. */
export function buildColourRamp(size = 256): Uint8Array {
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = colourAt(size === 1 ? 0 : i / (size - 1));
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}
