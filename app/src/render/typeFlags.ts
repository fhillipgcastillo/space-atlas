// Mirrors pipeline/universe_pipeline/records.py. Written into tile typeFlags.
export const FLAG_MODELED = 1 << 0;
export const TYPE_STAR = 1 << 1;
export const TYPE_GALAXY = 1 << 2;
export const TYPE_BLACK_HOLE = 1 << 3;
export const TYPE_NEBULA = 1 << 4;
export const TYPE_CLUSTER = 1 << 5;
export const FLAG_NO_RADIAL_VELOCITY = 1 << 6;

const CLASS_NAMES: [bit: number, name: string][] = [
  [TYPE_STAR, 'Star'],
  [TYPE_GALAXY, 'Galaxy'],
  [TYPE_BLACK_HOLE, 'Black hole'],
  [TYPE_NEBULA, 'Nebula'],
  [TYPE_CLUSTER, 'Cluster'],
];

export function describeType(flags: number): string {
  const name = CLASS_NAMES.find(([bit]) => (flags & bit) !== 0)?.[1] ?? 'Unknown';
  return (flags & FLAG_MODELED) !== 0 ? `${name} (modeled)` : name;
}

export function hasRadialVelocity(flags: number): boolean {
  return (flags & FLAG_NO_RADIAL_VELOCITY) === 0;
}
