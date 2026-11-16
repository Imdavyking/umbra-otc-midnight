import type { Logger } from "pino";

export function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const randomNonceBytes = (length: number, logger?: Logger): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  logger?.debug("generated random bytes");
  return bytes;
};

export function uint8ArrayToHex(array: Uint8Array): string {
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToUint8Array(hexStr: string): Uint8Array {
  const h = hexStr.startsWith("0x") ? hexStr.slice(2) : hexStr;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) {
    throw new Error(`Invalid hex string: ${hexStr}`);
  }
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) bytes[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return bytes;
}

/** Hex string of exactly `len` bytes, or throw. */
export function hexBytes(hexStr: string, len: number): Uint8Array {
  const b = hexToUint8Array(hexStr);
  if (b.length !== len) throw new Error(`Expected ${len} bytes, got ${b.length}`);
  return b;
}

/** Drain any ledger map/set iterable into an array. */
export const entries = <K, V>(m: { [Symbol.iterator](): Iterator<[K, V]> }): [K, V][] =>
  Array.from(m as Iterable<[K, V]>);

export default { arraysEqual, randomNonceBytes, uint8ArrayToHex, hexToUint8Array, hexBytes, entries };
