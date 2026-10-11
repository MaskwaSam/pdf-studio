// pdfjs-dist 5.x relies on very new JS builtins that older browsers lack.
// Polyfill the small surface we need before loading pdf.js.

declare global {
  interface Uint8Array {
    toHex?: () => string;
    toBase64?: () => string;
  }
  interface Uint8ArrayConstructor {
    fromHex?: (s: string) => Uint8Array;
    fromBase64?: (s: string) => Uint8Array;
  }
  interface Math {
    sumPrecise?: (items: Iterable<number>) => number;
  }
}

const u8 = Uint8Array.prototype as Uint8Array & { toHex?: () => string; toBase64?: () => string };
const U8 = Uint8Array as Uint8ArrayConstructor & {
  fromHex?: (s: string) => Uint8Array;
  fromBase64?: (s: string) => Uint8Array;
};

if (!u8.toHex) {
  u8.toHex = function (this: Uint8Array) {
    let s = "";
    for (const b of this) s += b.toString(16).padStart(2, "0");
    return s;
  };
}

if (!U8.fromHex) {
  U8.fromHex = (s: string) => {
    const out = new Uint8Array(Math.ceil(s.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
}

if (!u8.toBase64) {
  u8.toBase64 = function (this: Uint8Array) {
    let bin = "";
    for (const b of this) bin += String.fromCharCode(b);
    return btoa(bin);
  };
}

if (!U8.fromBase64) {
  U8.fromBase64 = (s: string) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
}

const anyMap = Map.prototype as Map<unknown, unknown> & {
  getOrInsert?: (k: unknown, v: unknown) => unknown;
  getOrInsertComputed?: (k: unknown, fn: (k: unknown) => unknown) => unknown;
};
const anyWeakMap = WeakMap.prototype as WeakMap<object, object> & {
  getOrInsert?: (k: object, v: object) => object;
  getOrInsertComputed?: (k: object, fn: (k: object) => object) => object;
};
if (!anyMap.getOrInsert) {
  anyMap.getOrInsert = function (k, v) {
    if (!this.has(k)) this.set(k, v);
    return this.get(k);
  };
}
if (!anyMap.getOrInsertComputed) {
  anyMap.getOrInsertComputed = function (k, fn) {
    if (!this.has(k)) this.set(k, fn(k));
    return this.get(k);
  };
}
if (!anyWeakMap.getOrInsert) {
  anyWeakMap.getOrInsert = function (k, v) {
    if (!this.has(k)) this.set(k, v);
    return this.get(k)!;
  };
}
if (!anyWeakMap.getOrInsertComputed) {
  anyWeakMap.getOrInsertComputed = function (k, fn) {
    if (!this.has(k)) this.set(k, fn(k));
    return this.get(k)!;
  };
}

if (!Math.sumPrecise) {
  Math.sumPrecise = (items: Iterable<number>) => {
    let sum = 0;
    for (const n of items) sum += n;
    return sum;
  };
}

export {};
