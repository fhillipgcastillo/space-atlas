import { decodeTile, type DecodedTile } from './format.js';

export interface TileNode {
  path: string;
  boundingBox: { min: number[]; max: number[] };
  geometricError: number;
  pointCount: number;
  totalPointCount: number;
  children: TileNode[];
}

export interface Tileset {
  formatVersion: number;
  layer: string;
  unit: string;
  unitInMetres: number;
  frame: string;
  origin: string;
  pointCount: number;
  root: TileNode;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseNode(raw: unknown, where: string): TileNode {
  if (!isRecord(raw)) throw new Error(`tileset: ${where} is not an object`);
  const box = raw['boundingBox'];
  if (
    !isRecord(box) ||
    !Array.isArray(box['min']) ||
    !Array.isArray(box['max']) ||
    box['min'].length !== 3 ||
    box['max'].length !== 3
  ) {
    throw new Error(`tileset: ${where} has a malformed bounding box`);
  }
  const children = Array.isArray(raw['children']) ? raw['children'] : [];
  return {
    path: String(raw['path']),
    boundingBox: { min: box['min'] as number[], max: box['max'] as number[] },
    geometricError: Number(raw['geometricError']),
    pointCount: Number(raw['pointCount']),
    totalPointCount: Number(raw['totalPointCount']),
    children: children.map((child, i) => parseNode(child, `${String(raw['path'])}/child ${i}`)),
  };
}

export function parseTileset(json: unknown): Tileset {
  if (!isRecord(json)) throw new Error('tileset: payload is not an object');
  if (json['formatVersion'] !== 1) {
    throw new Error(`tileset: unsupported format version ${String(json['formatVersion'])}`);
  }
  if (!isRecord(json['root'])) throw new Error('tileset: missing root node');

  return {
    formatVersion: 1,
    layer: String(json['layer']),
    unit: String(json['unit']),
    unitInMetres: Number(json['unitInMetres']),
    frame: String(json['frame']),
    origin: String(json['origin']),
    pointCount: Number(json['pointCount']),
    root: parseNode(json['root'], 'root'),
  };
}

export async function fetchTileset(baseUrl: string): Promise<Tileset> {
  const response = await fetch(`${baseUrl}/tileset.json`);
  if (!response.ok) throw new Error(`tileset: HTTP ${response.status} for ${baseUrl}`);
  return parseTileset(await response.json());
}

export async function fetchTile(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<DecodedTile> {
  const response = await fetch(`${baseUrl}/${path}.bin`, { signal });
  if (!response.ok) throw new Error(`tile: HTTP ${response.status} for ${path}`);
  return decodeTile(await response.arrayBuffer());
}
