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
  const first = layers[0]!;
  const last = layers[layers.length - 1]!;

  if (distanceMetres <= outerEdge(first)) return { primary: first, secondary: null, blend: 0 };

  for (let i = 0; i < layers.length - 1; i++) {
    const inner = layers[i]!;
    const outer = layers[i + 1]!;
    const bandStart = outerEdge(inner);
    const bandEnd = innerEdge(outer);

    if (distanceMetres <= bandStart) return { primary: inner, secondary: null, blend: 0 };
    if (distanceMetres < bandEnd) {
      // Log space: a linear ramp across two decades would read as the outer
      // layer for almost the whole transition.
      const blend =
        (Math.log(distanceMetres) - Math.log(bandStart)) /
        (Math.log(bandEnd) - Math.log(bandStart));
      return { primary: inner, secondary: outer, blend: Math.min(Math.max(blend, 0), 1) };
    }
  }

  return { primary: last, secondary: null, blend: 0 };
}
