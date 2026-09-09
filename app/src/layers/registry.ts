import type { LayerDef } from './stack.js';

const LY_IN_METRES = 9460730472580800;

// Ordered inner to outer. Must agree with pipeline/universe_pipeline/config.py.
export const LAYERS: LayerDef[] = [
  {
    key: 'solar-system',
    url: '/data/solar-system',
    unit: 'AU',
    unitInMetres: 149597870700,
    minRadius: 0,
    maxRadius: 100,
    origin: 'Sun',
  },
  {
    key: 'stellar-neighbourhood',
    url: '/data/stellar-neighbourhood',
    unit: 'ly',
    unitInMetres: LY_IN_METRES,
    minRadius: 0.01,
    maxRadius: 5000,
    origin: 'Sol',
  },
  {
    key: 'milky-way',
    url: '/data/milky-way',
    unit: 'ly',
    unitInMetres: LY_IN_METRES,
    minRadius: 3000,
    maxRadius: 400000,
    origin: 'Sol',
  },
  {
    key: 'local-universe',
    url: '/data/local-universe',
    unit: 'Mly',
    unitInMetres: LY_IN_METRES * 1e6,
    minRadius: 0.3,
    maxRadius: 300,
    origin: 'Milky Way',
  },
];
