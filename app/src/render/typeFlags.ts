// Mirrors pipeline/universe_pipeline/records.py. Written into tile typeFlags:
// a 4-bit class in the low nibble, flags in the high nibble.
export const CLASS_MASK = 0x0f;

export const CLASS_UNKNOWN = 0;
export const CLASS_STAR = 1;
export const CLASS_GALAXY = 2;
export const CLASS_BLACK_HOLE = 3;
export const CLASS_NEBULA = 4;
export const CLASS_CLUSTER = 5;
export const CLASS_PLANET = 6;
export const CLASS_MOON = 7;

export const FLAG_MODELED = 0x10;
export const FLAG_NO_RADIAL_VELOCITY = 0x20;
export const FLAG_NOMINAL_MAGNITUDE = 0x40;

const CLASS_NAMES: Record<number, string> = {
  [CLASS_UNKNOWN]: 'Unknown',
  [CLASS_STAR]: 'Star',
  [CLASS_GALAXY]: 'Galaxy',
  [CLASS_BLACK_HOLE]: 'Black hole',
  [CLASS_NEBULA]: 'Nebula',
  [CLASS_CLUSTER]: 'Cluster',
  [CLASS_PLANET]: 'Planet',
  [CLASS_MOON]: 'Moon',
};

export function objectClass(flags: number): number {
  return flags & CLASS_MASK;
}

export function describeType(flags: number): string {
  const name = CLASS_NAMES[objectClass(flags)] ?? 'Unknown';
  return (flags & FLAG_MODELED) !== 0 ? `${name} (modeled)` : name;
}

export function hasRadialVelocity(flags: number): boolean {
  return (flags & FLAG_NO_RADIAL_VELOCITY) === 0;
}

export function hasMeasuredMagnitude(flags: number): boolean {
  return (flags & FLAG_NOMINAL_MAGNITUDE) === 0;
}
