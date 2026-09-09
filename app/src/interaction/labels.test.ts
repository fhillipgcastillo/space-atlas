import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildCandidates,
  declutter,
  labelPriority,
  type LabelCandidate,
  type NamedObject,
} from './labels.js';

const BOX = { width: 100, height: 20 };

const candidate = (
  text: string,
  screenX: number,
  screenY: number,
  priority: number,
): LabelCandidate => ({ text, screenX, screenY, priority });

describe('declutter', () => {
  it('returns nothing for no candidates', () => {
    expect(declutter([], BOX, 10)).toEqual([]);
  });

  it('keeps the higher priority of two overlapping labels and drops the other', () => {
    const winner = candidate('Sirius', 500, 300, 10);
    const loser = candidate('Rigel', 520, 305, 2);

    expect(declutter([loser, winner], BOX, 10)).toEqual([winner]);
    expect(declutter([winner, loser], BOX, 10)).toEqual([winner]);
  });

  it('drops the loser entirely rather than shifting it', () => {
    const placed = declutter(
      [candidate('A', 100, 100, 1), candidate('B', 130, 100, 5)],
      BOX,
      10,
    );
    expect(placed.map((c) => c.text)).toEqual(['B']);
    expect(placed[0]).toEqual({ text: 'B', screenX: 130, screenY: 100, priority: 5 });
  });

  it('keeps every candidate when none overlap', () => {
    const candidates = [
      candidate('A', 0, 0, 1),
      candidate('B', 200, 0, 2),
      candidate('C', 400, 0, 3),
      candidate('D', 0, 60, 4),
    ];
    expect(declutter(candidates, BOX, 10)).toHaveLength(4);
  });

  it('respects maxLabels even when nothing overlaps', () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate(`L${i}`, i * 200, 0, i),
    );
    const placed = declutter(candidates, BOX, 5);
    expect(placed).toHaveLength(5);
    expect(placed.map((c) => c.text)).toEqual(['L19', 'L18', 'L17', 'L16', 'L15']);
  });

  it('returns nothing when maxLabels is zero or negative', () => {
    const candidates = [candidate('A', 0, 0, 1)];
    expect(declutter(candidates, BOX, 0)).toEqual([]);
    expect(declutter(candidates, BOX, -3)).toEqual([]);
  });

  it('treats boxes that touch exactly at an edge as not overlapping', () => {
    const left = candidate('left', 0, 0, 1);
    const right = candidate('right', BOX.width, 0, 2);
    expect(declutter([left, right], BOX, 10)).toHaveLength(2);

    const below = candidate('below', 0, BOX.height, 2);
    expect(declutter([left, below], BOX, 10)).toHaveLength(2);
  });

  it('drops a label one pixel inside the touching separation', () => {
    const left = candidate('left', 0, 0, 1);
    const right = candidate('right', BOX.width - 1, 0, 2);
    expect(declutter([left, right], BOX, 10)).toEqual([right]);
  });

  it('is deterministic for identical input', () => {
    const build = (): LabelCandidate[] =>
      Array.from({ length: 60 }, (_, i) =>
        candidate(`N${i}`, (i * 37) % 900, (i * 53) % 500, (i * 7) % 11),
      );
    const first = declutter(build(), BOX, 12);
    const second = declutter(build(), BOX, 12);
    expect(second).toEqual(first);
    expect(declutter(build(), BOX, 12)).toEqual(first);
  });

  it('breaks priority ties by input order', () => {
    const first = candidate('first', 100, 100, 3);
    const second = candidate('second', 140, 100, 3);
    expect(declutter([first, second], BOX, 10)).toEqual([first]);
    expect(declutter([second, first], BOX, 10)).toEqual([second]);
  });

  it('refuses a candidate with no text', () => {
    const placed = declutter([candidate('', 0, 0, 99), candidate('  ', 500, 0, 98)], BOX, 10);
    expect(placed).toEqual([]);
  });
});

describe('labelPriority', () => {
  it('ranks the nearer of two equally bright objects first', () => {
    expect(labelPriority(1e16)).toBeGreaterThan(labelPriority(1e18));
  });

  it('ranks the brighter of two equally distant objects first', () => {
    expect(labelPriority(1e16, -26)).toBeGreaterThan(labelPriority(1e16, 5));
  });

  it('stays finite at zero distance', () => {
    expect(Number.isFinite(labelPriority(0))).toBe(true);
  });
});

describe('buildCandidates', () => {
  const camera = (): PerspectiveCamera => {
    const c = new PerspectiveCamera(60, 2, 0.1, 10000);
    c.position.set(0, 0, 100);
    c.updateMatrixWorld();
    return c;
  };

  const object = (name: string, z: number, unitInMetres = 1): NamedObject => ({
    name,
    position: [0, 0, z],
    unitInMetres,
  });

  it('projects a point on the axis to the centre of the screen', () => {
    const placed = buildCandidates([object('Vega', 0)], camera(), 800, 400, 1);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.screenX).toBeCloseTo(400);
    expect(placed[0]!.screenY).toBeCloseTo(200);
  });

  it('excludes points behind the camera', () => {
    expect(buildCandidates([object('Behind', 200)], camera(), 800, 400, 1)).toEqual([]);
  });

  it('excludes points outside the viewport', () => {
    const off: NamedObject = { name: 'Off', position: [10000, 0, 0], unitInMetres: 1 };
    expect(buildCandidates([off], camera(), 800, 400, 1)).toEqual([]);
  });

  it('excludes objects without a name, so modeled points can never be labelled', () => {
    expect(buildCandidates([object('', 0), object('   ', 0)], camera(), 800, 400, 1)).toEqual(
      [],
    );
  });

  it('rescales a position from its own layer into the active layer units', () => {
    const outer: NamedObject = { name: 'Far', position: [0, 0, 25], unitInMetres: 2 };
    const inner: NamedObject = { name: 'Near', position: [0, 0, 50], unitInMetres: 1 };
    const [a, b] = buildCandidates([outer, inner], camera(), 800, 400, 1);
    expect(a!.priority).toBeCloseTo(b!.priority);
  });

  it('gives the nearer object the higher priority', () => {
    const [near, far] = buildCandidates(
      [object('Near', 50), object('Far', -400)],
      camera(),
      800,
      400,
      1,
    );
    expect(near!.priority).toBeGreaterThan(far!.priority);
  });
});
