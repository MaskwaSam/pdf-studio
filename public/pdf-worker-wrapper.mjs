// polyfills for pdf.js 5.x on older browsers, then the real worker
if (!Uint8Array.prototype.toHex) {
  Uint8Array.prototype.toHex = function () {
    let s = "";
    for (const b of this) s += b.toString(16).padStart(2, "0");
    return s;
  };
}
if (!Uint8Array.fromHex) {
  Uint8Array.fromHex = (s) => {
    const out = new Uint8Array(Math.ceil(s.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
}
if (!Uint8Array.prototype.toBase64) {
  Uint8Array.prototype.toBase64 = function () {
    let bin = "";
    for (const b of this) bin += String.fromCharCode(b);
    return btoa(bin);
  };
}
if (!Uint8Array.fromBase64) {
  Uint8Array.fromBase64 = (s) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
}
if (!Math.sumPrecise) {
  Math.sumPrecise = (items) => {
    let sum = 0;
    for (const n of items) sum += n;
    return sum;
  };
}

if (!Map.prototype.getOrInsert) {
  Map.prototype.getOrInsert = function (key, v) {
    if (!this.has(key)) this.set(key, v);
    return this.get(key);
  };
}
if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function (key, fn) {
    if (!this.has(key)) this.set(key, fn(key));
    return this.get(key);
  };
}
if (!WeakMap.prototype.getOrInsert) {
  WeakMap.prototype.getOrInsert = function (key, v) {
    if (!this.has(key)) this.set(key, v);
    return this.get(key);
  };
}
if (!WeakMap.prototype.getOrInsertComputed) {
  WeakMap.prototype.getOrInsertComputed = function (key, fn) {
    if (!this.has(key)) this.set(key, fn(key));
    return this.get(key);
  };
}

import "./pdf.worker.min.mjs";
