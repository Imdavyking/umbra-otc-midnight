export const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const short = (hex: string, n = 8) =>
  hex.length > n * 2 + 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};
