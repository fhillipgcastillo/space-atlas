export interface LayerDef {
  key: string;
  url: string;
  unit: string;
  unitInMetres: number;
  minRadius: number;
  maxRadius: number;
  origin: string;
}

export interface LayerSelection {
  primary: LayerDef;
  secondary: LayerDef | null;
  blend: number;
}

const outerEdge = (layer: LayerDef): number => layer.maxRadius * layer.unitInMetres;
const innerEdge = (layer: LayerDef): number => layer.minRadius * layer.unitInMetres;

/**
 * Least ratio a crossfade may span. The registry's radii are the pipeline's
 * data contract -- min_radius decides which objects a layer is baked with -- so
 * the band is widened here instead of by moving them. Natural bands wider than
 * this are left alone.
 */
const MIN_BAND_RATIO = 3.3;

function widen(lo: number, hi: number): [number, number] {
  if (!(lo > 0) || !(hi > lo)) return [lo, hi];
  if (hi / lo >= MIN_BAND_RATIO) return [lo, hi];
  // Geometric centre, so the band grows the same factor in each direction and
  // the log-space blend stays symmetric about the boundary.
  const centre = Math.sqrt(lo * hi);
  const half = Math.sqrt(MIN_BAND_RATIO);
  return [centre / half, centre * half];
}

export function rescalePosition(
  distance: number,
  fromUnitInMetres: number,
  toUnitInMetres: number,
): number {
  return fromUnitInMetres === toUnitInMetres
    ? distance
    : (distance * fromUnitInMetres) / toUnitInMetres;
}

export function layerScaleFactor(layer: LayerDef, active: LayerDef): number {
  return layer.unitInMetres / active.unitInMetres;
}

export function selectLayers(distanceMetres: number, layers: LayerDef[]): LayerSelection {
  const last = layers[layers.length - 1]!;

  for (let i = 0; i < layers.length - 1; i++) {
    const inner = layers[i]!;
    const outer = layers[i + 1]!;
    const edgeA = outerEdge(inner);
    const edgeB = innerEdge(outer);
    // The edges fall in either order: a gap gives edgeA < edgeB, an overlap
    // the reverse.
    const [bandLo, bandHi] = widen(Math.min(edgeA, edgeB), Math.max(edgeA, edgeB));

    if (distanceMetres <= bandLo) return { primary: inner, secondary: null, blend: 0 };
    if (distanceMetres < bandHi) {
      // Log space: a linear ramp across two decades would read as the outer
      // layer for almost the whole transition. It needs a positive lower
      // bound - log(0) is -Infinity, which yields a NaN blend that the clamp
      // does not catch and that silently hides a layer.
      const span = Math.log(bandHi) - Math.log(bandLo);
      const blend =
        bandLo > 0 && span > 0
          ? (Math.log(distanceMetres) - Math.log(bandLo)) / span
          : (distanceMetres - bandLo) / (bandHi - bandLo);
      return {
        primary: inner,
        secondary: outer,
        blend: Number.isFinite(blend) ? Math.min(Math.max(blend, 0), 1) : 1,
      };
    }
  }

  return { primary: last, secondary: null, blend: 0 };
}
