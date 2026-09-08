/** Tile format v1 decoder. See docs/tile-format.md — this file is a contract. */

const MAGIC = 0x31544d55; // "UMT1" read as little-endian uint32
const VERSION = 1;
const ATTRIBUTE_MASK_V1 = 0x3f;
const HEADER_BYTES = 64;
const QUANT_MAX = 65535;

export interface DecodedTile {
  pointCount: number;
  bboxMin: Float64Array;
  bboxMax: Float64Array;
  /** uint16 fractions of the bounding box; interleaved xyz. */
  positionQuantized: Uint16Array;
  /** Raw float16 bits, interleaved xyz. */
  velocity: Uint16Array;
  colorIndex: Uint16Array;
  /** Raw float16 bits. */
  absMag: Uint16Array;
  typeFlags: Uint8Array;
  localId: Uint32Array;
}

const align4 = (n: number): number => n + ((4 - (n % 4)) % 4);

export function decodeTile(buffer: ArrayBuffer): DecodedTile {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error('bad tile magic: not a UMT1 tile');
  }
  const version = view.getUint32(4, true);
  if (version !== VERSION) {
    throw new Error(`unsupported tile format version ${version}`);
  }
  const pointCount = view.getUint32(8, true);
  const attributeMask = view.getUint32(12, true);
  if (attributeMask !== ATTRIBUTE_MASK_V1) {
    throw new Error(`unsupported attribute mask 0x${attributeMask.toString(16)}`);
  }

  const bboxMin = new Float64Array(3);
  const bboxMax = new Float64Array(3);
  for (let i = 0; i < 3; i++) {
    bboxMin[i] = view.getFloat64(16 + i * 8, true);
    bboxMax[i] = view.getFloat64(40 + i * 8, true);
  }

  let offset = HEADER_BYTES;
  const read = <T>(
    make: (buf: ArrayBuffer, off: number, len: number) => T,
    len: number,
    bytesPer: number,
  ): T => {
    const byteLength = len * bytesPer;
    const slice = buffer.slice(offset, offset + byteLength);
    const arr = make(slice, 0, len);
    offset = align4(offset + byteLength);
    return arr;
  };

  const positionQuantized = read((b, o, l) => new Uint16Array(b, o, l), pointCount * 3, 2);
  const velocity = read((b, o, l) => new Uint16Array(b, o, l), pointCount * 3, 2);
  const colorIndex = read((b, o, l) => new Uint16Array(b, o, l), pointCount, 2);
  const absMag = read((b, o, l) => new Uint16Array(b, o, l), pointCount, 2);
  const typeFlags = read((b, o, l) => new Uint8Array(b, o, l), pointCount, 1);
  const localId = read((b, o, l) => new Uint32Array(b, o, l), pointCount, 4);

  return {
    pointCount,
    bboxMin,
    bboxMax,
    positionQuantized,
    velocity,
    colorIndex,
    absMag,
    typeFlags,
    localId,
  };
}

export function dequantizePosition(
  tile: DecodedTile,
  index: number,
  out: Float64Array,
): Float64Array {
  for (let axis = 0; axis < 3; axis++) {
    const lo = tile.bboxMin[axis]!;
    const hi = tile.bboxMax[axis]!;
    const q = tile.positionQuantized[index * 3 + axis]!;
    out[axis] = lo + (q / QUANT_MAX) * (hi - lo);
  }
  return out;
}

/** IEEE 754 half-precision bits to a JavaScript number. */
export function decodeFloat16(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;

  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (mantissa + 1024) * 2 ** (exponent - 25);
}
