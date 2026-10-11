import "./polyfills";
import * as pdfjs from "pdfjs-dist";

// wrapper installs polyfills for older browsers, then loads the real worker bundle
pdfjs.GlobalWorkerOptions.workerSrc = new URL("/pdf-worker-wrapper.mjs", import.meta.url).href;

export const OPS = pdfjs.OPS;
export const Util = pdfjs.Util;

export interface LoadedPdf {
  doc: pdfjs.PDFDocumentProxy;
  bytes: Uint8Array;
  numPages: number;
}

export async function loadPdf(file: File | Uint8Array): Promise<LoadedPdf> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  return { doc, bytes, numPages: doc.numPages };
}

// ---------- geometric model ----------

export type Mat = [number, number, number, number, number, number];

export interface PdfPoint {
  x: number;
  y: number;
}

/** 4 corners in PDF user space: [BL, BR, TR, TL] */
export type Quad = [PdfPoint, PdfPoint, PdfPoint, PdfPoint];

export function matIdentity(): Mat {
  return [1, 0, 0, 1, 0, 0];
}

/** m1 x m2 — applies m2 first, then m1 (same convention as pdfjs Util.transform) */
export function matMul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function matApply(m: Mat, x: number, y: number): PdfPoint {
  return { x: x * m[0] + y * m[2] + m[4], y: x * m[1] + y * m[3] + m[5] };
}

/** Build the matrix mapping the unit square [0,0]-[1,1] onto the quad [BL,BR,TR,TL]. */
export function matFromQuad(q: Quad): Mat {
  const [bl, br, , tl] = q;
  return [br.x - bl.x, br.y - bl.y, tl.x - bl.x, tl.y - bl.y, bl.x, bl.y];
}

export function quadFromMat(m: Mat): Quad {
  return [matApply(m, 0, 0), matApply(m, 1, 0), matApply(m, 1, 1), matApply(m, 0, 1)];
}

export function quadBounds(q: Quad): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of q) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned quad covering bounds */
export function quadFromBounds(minX: number, minY: number, maxX: number, maxY: number): Quad {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** apply a pdf.js viewport transform (canvas px) to a pdf-space point, returning [x,y] */
export function vpApply(t: number[], x: number, y: number): [number, number] {
  return [x * t[0] + y * t[2] + t[4], x * t[1] + y * t[3] + t[5]];
}

export function quadToSvgPath(q: Quad): string {
  const f = (n: number) => +n.toFixed(4);
  return `M ${f(q[0].x)} ${f(q[0].y)} L ${f(q[1].x)} ${f(q[1].y)} L ${f(q[2].x)} ${f(q[2].y)} L ${f(q[3].x)} ${f(q[3].y)} Z`;
}

// ---------- extracted page content ----------

export type CssFamily = "sans-serif" | "serif" | "monospace";

export interface TextItem {
  id: string;
  pageIndex: number;
  str: string;
  /** user-space text matrix [a,b,c,d,e,f]; (e,f) = baseline origin */
  tr: Mat;
  fontSizePt: number;
  /** in user-space pts, ascent above / descent below the baseline */
  ascentPt: number;
  descentPt: number;
  /** advance width of the string in user-space pts */
  widthPt: number;
  /** rotation of the text in PDF space, degrees CCW */
  angleDeg: number;
  quad: Quad;
  cssFamily: CssFamily;
  /** pdf-lib standard font stem */
  fontStem: "helv" | "times" | "cour";
  isBold: boolean;
}

export type ImageKind = "xobject" | "inline" | "mask";

export interface ImageItem {
  id: string;
  pageIndex: number;
  kind: ImageKind;
  /** XObject resource name like "Im1" (xobject kind only) */
  name: string | null;
  /** matrix mapping the image's unit square onto the page */
  ctm: Mat;
  quad: Quad;
  pixelW: number;
  pixelH: number;
}

export interface PageContent {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  texts: TextItem[];
  images: ImageItem[];
}

function cssFamilyToStem(fam: string): "helv" | "times" | "cour" {
  if (fam === "monospace") return "cour";
  if (fam === "serif") return "times";
  return "helv";
}

export async function extractPageContent(page: pdfjs.PDFPageProxy, pageIndex: number): Promise<PageContent> {
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const texts: TextItem[] = [];

  for (let i = 0; i < tc.items.length; i++) {
    const raw = tc.items[i];
    if (!("str" in raw)) continue;
    const item = raw;
    if (!item.str) continue;
    const [a, b, c, d, e, f] = item.transform;
    const xScale = Math.hypot(a, b);
    const yScale = Math.hypot(c, d);
    if (xScale === 0 || yScale === 0) continue;
    const style = (tc.styles as Record<string, { fontFamily?: string; ascent?: number; descent?: number }>)[item.fontName];
    const ascentPt = Math.abs(style?.ascent ?? 0.8) * yScale;
    const descentPt = -Math.abs(style?.descent ?? 0.2) * yScale;
    const ux = a / xScale,
      uy = b / xScale,
      vx = c / yScale,
      vy = d / yScale;
    // pdf.js reports item.width already in user-space units
    const w = item.width;
    const o = { x: e, y: f };
    const quad: Quad = [
      { x: o.x + vx * descentPt, y: o.y + vy * descentPt },
      { x: o.x + ux * w + vx * descentPt, y: o.y + uy * w + vy * descentPt },
      { x: o.x + ux * w + vx * ascentPt, y: o.y + uy * w + vy * ascentPt },
      { x: o.x + vx * ascentPt, y: o.y + vy * ascentPt },
    ];
    const famRaw = style?.fontFamily ?? "sans-serif";
    const fam: CssFamily = famRaw === "monospace" ? "monospace" : famRaw === "serif" ? "serif" : "sans-serif";
    const bold = /bold|black|heavy/i.test(item.fontName) || /bold|black|heavy/i.test(famRaw);
    texts.push({
      id: `t${pageIndex}-${i}`,
      pageIndex,
      str: item.str,
      tr: item.transform.slice() as Mat,
      fontSizePt: yScale,
      ascentPt,
      descentPt,
      widthPt: w,
      angleDeg: (Math.atan2(b, a) * 180) / Math.PI,
      quad,
      cssFamily: fam,
      fontStem: cssFamilyToStem(fam),
      isBold: bold,
    });
  }

  // images via operator list
  const opList = await page.getOperatorList();
  const images: ImageItem[] = [];
  const ctmStack: Mat[] = [matIdentity()];
  const ctm = () => ctmStack[ctmStack.length - 1];
  let imgCount = 0;

  const pushImage = (kind: ImageKind, name: string | null, m: Mat, w = 0, h = 0) => {
    images.push({
      id: `i${pageIndex}-${imgCount++}`,
      pageIndex,
      kind,
      name,
      ctm: m.slice() as Mat,
      quad: quadFromMat(m),
      pixelW: w,
      pixelH: h,
    });
  };

  const fn = opList.fnArray;
  const args = opList.argsArray;
  for (let i = 0; i < fn.length; i++) {
    const op = fn[i];
    const a = args[i];
    if (op === OPS.save) {
      ctmStack.push(ctm().slice() as Mat);
    } else if (op === OPS.restore) {
      if (ctmStack.length > 1) ctmStack.pop();
    } else if (op === OPS.transform) {
      ctmStack[ctmStack.length - 1] = matMul(ctm(), a as Mat);
    } else if (op === OPS.paintFormXObjectBegin) {
      ctmStack.push(ctm().slice() as Mat);
      const m = a[1] as Mat | null;
      if (m) ctmStack[ctmStack.length - 1] = matMul(ctm(), m);
    } else if (op === OPS.paintFormXObjectEnd) {
      if (ctmStack.length > 1) ctmStack.pop();
    } else if (op === OPS.paintImageXObject) {
      pushImage("xobject", String(a[0]), ctm(), Number(a[1]) || 0, Number(a[2]) || 0);
    } else if (op === OPS.paintImageMaskXObject) {
      pushImage("mask", typeof a[0] === "string" ? a[0] : null, ctm());
    } else if (op === OPS.paintInlineImageXObject) {
      const img = a[0];
      pushImage("inline", null, ctm(), img?.width ?? 0, img?.height ?? 0);
    } else if (op === OPS.paintImageXObjectRepeat) {
      const [name, sx, sy, positions] = a;
      for (let p = 0; p + 1 < positions.length; p += 2) {
        const local: Mat = [sx, 0, 0, sy, positions[p], positions[p + 1]];
        pushImage("xobject", String(name), matMul(ctm(), local));
      }
    }
  }

  return { pageIndex, widthPt: viewport.width, heightPt: viewport.height, texts, images };
}
