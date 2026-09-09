// Beyond a million years p₀ + v·t stops being physical: galactic orbits curve.
export const MAX_YEARS = 1_000_000;
export const MIN_YEARS = -1_000_000;

// Julian year, the year the light-year is defined against.
const SECONDS_PER_YEAR = 31_557_600;
const METRES_PER_KM = 1000;

let currentYears = 0;

export function clampYears(years: number): number {
  if (Number.isNaN(years)) return 0;
  return Math.min(Math.max(years, MIN_YEARS), MAX_YEARS);
}

export function formatYears(years: number): string {
  const rounded = Math.round(years);
  if (rounded === 0) return 'present day';
  const magnitude = Math.abs(rounded);
  const noun = magnitude === 1 ? 'year' : 'years';
  return `${rounded > 0 ? '+' : '−'}${magnitude.toLocaleString('en-US')} ${noun}`;
}

/** km/s to layer units per year, so the shader scales velocity with one multiply. */
export function velocityScaleForLayer(unitInMetres: number): number {
  return (METRES_PER_KM * SECONDS_PER_YEAR) / unitInMetres;
}

export function getTimeYears(): number {
  return currentYears;
}

export function setTimeYears(years: number): number {
  currentYears = clampYears(years);
  return currentYears;
}
