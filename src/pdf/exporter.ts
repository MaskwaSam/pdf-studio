import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  concatTransformationMatrix,
  drawObject,
  pushGraphicsState,
  popGraphicsState,
  setFillingRgbColor,
  moveTo,
  lineTo,
  closePath,
  fill,
  PDFName,
  PDFArray,
  PDFRef,
  PDFRadioGroup,
} from "pdf-lib";
import type { RGB, PDFPage, PDFFont, PDFForm, PDFRef as PDFRefT } from "pdf-lib";
import { matFromQuad } from "./model";
import type { Quad, ImageItem, TextItem, PdfPoint } from "./model";

export interface Color {
  r: number; // 0..1
  g: number;
  b: number;
}

export const WHITE: Color = { r: 1, g: 1, b: 1 };
export const BLACK: Color = { r: 0, g: 0, b: 0 };

export type FontStem = "helv" | "times" | "cour";

export function standardFont(stem: FontStem, bold: boolean): StandardFonts {
  if (stem === "times") return bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman;
  if (stem === "cour") return bold ? StandardFonts.CourierBold : StandardFonts.Courier;
  return bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
}

// ---------- edits ----------

export interface TextEdit {
  kind: "text";
  id: string;
  pageIndex: number;
  itemId: string;
  item: TextItem;
  newText: string | null; // null => erase (cover only)
  fontStem: FontStem;
  bold: boolean;
  fontSizePt: number;
  textColor: Color;
  bgColor: Color;
}

export interface ImageEdit {
  kind: "image";
  id: string;
  pageIndex: number;
  itemId: string;
  item: ImageItem;
  /** replacement image; null => delete */
  imageBytes: Uint8Array | null;
  imageExt: "png" | "jpg";
  /** how the replacement maps onto the original quad */
  fit: "fill" | "fit";
  bgColor: Color;
}

export interface AddTextEdit {
  kind: "addtext";
  id: string;
  pageIndex: number;
  xPt: number;
  yPt: number; // baseline
  text: string;
  fontStem: FontStem;
  bold: boolean;
  fontSizePt: number;
  textColor: Color;
}

/** a signature/image stamp placed freely on a page */
export interface StampEdit {
  kind: "stamp";
  id: string;
  pageIndex: number;
  quad: Quad;
  imageBytes: Uint8Array; // PNG with alpha
}

export type Edit = TextEdit | ImageEdit | AddTextEdit | StampEdit;

export type FormValue = string | boolean | string[] | null;

export type Align = "left" | "center" | "right";

export interface HeaderFooterSpec {
  header: string;
  footer: string;
  headerAlign: Align;
  footerAlign: Align;
  fontSize: number;
  margin: number;
  color: Color;
}

export interface ExportExtras {
  formValues?: Record<string, FormValue>;
  headerFooter?: HeaderFooterSpec | null;
}

export interface RadioWidgetMeta {
  optionIndex: number;
  optionValue: string;
}

// ---------- export ----------

function toRGB(c: Color): RGB {
  return rgb(c.r, c.g, c.b);
}

/**
 * Map radio widget object numbers to their option index/value.
 * pdf.js reports a radio widget's appearance state ("0","1") as buttonValue;
 * pdf-lib needs the option value from the field's /Opt (kid order matches).
 */
export async function inspectFormDoc(bytes: Uint8Array): Promise<Map<number, RadioWidgetMeta>> {
  const map = new Map<number, RadioWidgetMeta>();
  try {
    const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
    const form = doc.getForm();
    for (const f of form.getFields()) {
      if (!(f instanceof PDFRadioGroup)) continue;
      const opts = f.getOptions();
      const kids = f.acroField.dict.get(PDFName.of("Kids"));
      if (!(kids instanceof PDFArray)) continue;
      for (let i = 0; i < kids.size(); i++) {
        const k = kids.get(i);
        if (k instanceof PDFRef && opts[i] !== undefined) {
          map.set(k.objectNumber, { optionIndex: i, optionValue: opts[i] });
        }
      }
    }
  } catch {
    // no form or unreadable — leave empty
  }
  return map;
}

/** Write collected overlay values into the doc's real AcroForm fields. */
export function fillFormValues(
  doc: PDFDocument,
  values: Record<string, FormValue>,
  font: PDFFont,
): void {
  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  for (const [name, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    try {
      if (typeof v === "boolean") {
        const cb = form.getCheckBox(name);
        if (v) cb.check();
        else cb.uncheck();
        continue;
      }
      if (Array.isArray(v)) {
        try {
          form.getOptionList(name).select(v);
        } catch {
          /* not an option list */
        }
        continue;
      }
      const s = String(v);
      try {
        form.getTextField(name).setText(s);
        continue;
      } catch {
        /* not a text field */
      }
      try {
        form.getRadioGroup(name).select(s);
        continue;
      } catch {
        /* not a radio group */
      }
      try {
        form.getDropdown(name).select(s);
        continue;
      } catch {
        /* not a dropdown */
      }
      try {
        form.getOptionList(name).select(s);
      } catch {
        /* no matching field */
      }
    } catch {
      /* field missing entirely */
    }
  }
  try {
    form.updateFieldAppearances(font);
  } catch {
    /* appearance regen is best-effort */
  }
}

function drawHeaderFooter(
  pages: PDFPage[],
  spec: HeaderFooterSpec,
  font: PDFFont,
): void {
  const n = pages.length;
  const subst = (s: string, i: number) =>
    s.replaceAll("{page}", String(i + 1)).replaceAll("{pages}", String(n));
  pages.forEach((p, i) => {
    const w = p.getWidth(),
      h = p.getHeight();
    const draw = (raw: string, align: Align, y: number) => {
      const t = subst(raw, i).trim();
      if (!t) return;
      const tw = font.widthOfTextAtSize(t, spec.fontSize);
      const x = align === "left" ? spec.margin : align === "right" ? w - spec.margin - tw : (w - tw) / 2;
      p.drawText(t, { x, y, size: spec.fontSize, font, color: toRGB(spec.color) });
    };
    if (spec.header) draw(spec.header, spec.headerAlign, h - spec.margin);
    if (spec.footer) draw(spec.footer, spec.footerAlign, spec.margin);
  });
}

/** Opaque cover over a quad, emitted in PDF user space (drawSvgPath y-flips SVG-space coords — don't use it). */
function coverQuad(page: PDFPage, quad: Quad, color: Color): void {
  const [bl, br, tr, tl] = quad;
  page.pushOperators(
    pushGraphicsState(),
    setFillingRgbColor(color.r, color.g, color.b),
    moveTo(bl.x, bl.y),
    lineTo(br.x, br.y),
    lineTo(tr.x, tr.y),
    lineTo(tl.x, tl.y),
    closePath(),
    fill(),
    popGraphicsState(),
  );
}

/**
 * Shrink `quad` along one axis so the result has aspect `aspect` (w/h), centered.
 * The quad maps a unit square: u-axis = BL->BR (width), v-axis = BL->TL (height).
 */
function letterboxQuad(quad: Quad, aspect: number): Quad {
  const [bl, br, , tl] = quad;
  const uLen = Math.hypot(br.x - bl.x, br.y - bl.y);
  const vLen = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  if (uLen === 0 || vLen === 0) return quad;
  const qAspect = uLen / vLen;
  const ux = (br.x - bl.x) / uLen,
    uy = (br.y - bl.y) / uLen,
    vx = (tl.x - bl.x) / vLen,
    vy = (tl.y - bl.y) / vLen;
  let newU = uLen,
    newV = vLen;
  if (aspect > qAspect) newV = uLen / aspect;
  else newU = vLen * aspect;
  const du = (uLen - newU) / 2,
    dv = (vLen - newV) / 2;
  const base: PdfPoint = { x: bl.x + ux * du + vx * dv, y: bl.y + uy * du + vy * dv };
  return [
    base,
    { x: base.x + ux * newU, y: base.y + uy * newU },
    { x: base.x + ux * newU + vx * newV, y: base.y + uy * newU + vy * newV },
    { x: base.x + vx * newV, y: base.y + vy * newV },
  ];
}

function drawXObjectInQuad(page: PDFPage, imgRef: PDFRefT, quad: Quad, counter: number): void {
  const m = matFromQuad(quad);
  // newXObject appends a uniqueness suffix — use the name it returns
  const name = page.node.newXObject(`PsImg${counter}`, imgRef);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]),
    drawObject(name),
    popGraphicsState(),
  );
}

export async function exportPdf(
  sourceBytes: Uint8Array,
  edits: Edit[],
  extrasArg?: ExportExtras,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const pages = doc.getPages();
  let imgCounter = 0;

  const fontCache = new Map<string, Awaited<ReturnType<PDFDocument["embedFont"]>>>();
  const getFont = async (stem: FontStem, bold: boolean) => {
    const key = `${stem}-${bold}`;
    let f = fontCache.get(key);
    if (!f) {
      f = await doc.embedFont(standardFont(stem, bold));
      fontCache.set(key, f);
    }
    return f;
  };

  for (const edit of edits) {
    const page = pages[edit.pageIndex];
    if (!page) continue;

    if (edit.kind === "text") {
      // cover original glyphs
      coverQuad(page, edit.item.quad, edit.bgColor);
      if (edit.newText && edit.newText.length > 0) {
        const font = await getFont(edit.fontStem, edit.bold);
        page.drawText(edit.newText, {
          x: edit.item.tr[4],
          y: edit.item.tr[5],
          size: edit.fontSizePt,
          font,
          color: toRGB(edit.textColor),
          rotate: degrees(edit.item.angleDeg),
        });
      }
    } else if (edit.kind === "addtext") {
      const font = await getFont(edit.fontStem, edit.bold);
      page.drawText(edit.text, {
        x: edit.xPt,
        y: edit.yPt,
        size: edit.fontSizePt,
        font,
        color: toRGB(edit.textColor),
      });
    } else if (edit.kind === "image") {
      // cover the original quad (bgColor only needed in fit mode, cheap anyway)
      coverQuad(page, edit.item.quad, edit.bgColor);
      if (edit.imageBytes) {
        const img =
          edit.imageExt === "jpg"
            ? await doc.embedJpg(edit.imageBytes)
            : await doc.embedPng(edit.imageBytes);
        let quad = edit.item.quad;
        if (edit.fit === "fit") {
          const aspect = img.width / img.height;
          quad = letterboxQuad(quad, aspect);
        }
        drawXObjectInQuad(page, img.ref, quad, imgCounter++);
      }
    } else if (edit.kind === "stamp") {
      const img = await doc.embedPng(edit.imageBytes);
      drawXObjectInQuad(page, img.ref, edit.quad, imgCounter++);
    }
  }

  const extras = extrasArg ?? {};
  const needsUiFont =
    (extras.formValues && Object.keys(extras.formValues).length > 0) ||
    (extras.headerFooter && (extras.headerFooter.header || extras.headerFooter.footer));
  if (needsUiFont) {
    const uiFont = await getFont("helv", false);
    if (extras.formValues) fillFormValues(doc, extras.formValues, uiFont);
    if (extras.headerFooter) drawHeaderFooter(pages, extras.headerFooter, uiFont);
  }

  return doc.save();
}

// ---------- canvas color sampling ----------

/** median of samples as a Color */
function medianColor(samples: Uint8ClampedArray[]): Color {
  if (samples.length === 0) return WHITE;
  const rs = samples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = samples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = samples.map((s) => s[2]).sort((a, b) => a - b);
  const mid = (arr: number[]) => arr[Math.floor(arr.length / 2)] / 255;
  return { r: mid(rs), g: mid(gs), b: mid(bs) };
}

function pixelAt(data: Uint8ClampedArray, w: number, x: number, y: number): Uint8ClampedArray {
  const i = (y * w + x) * 4;
  return data.subarray(i, i + 4);
}

/**
 * Sample the rendered page canvas around `bbox` (canvas px):
 * - bgColor: median of a ring around the box (what's behind/around the content)
 * - fgColor: median of the darkest quartile inside the box (the glyphs)
 */
export function sampleTextColors(
  canvas: HTMLCanvasElement,
  bbox: { x: number; y: number; w: number; h: number },
): { textColor: Color; bgColor: Color } {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { textColor: BLACK, bgColor: WHITE };
  // bbox is in CSS px; the backing store may be dpr-scaled
  const cssW = canvas.getBoundingClientRect().width || canvas.width;
  const ratio = canvas.width / cssW;
  const b = { x: bbox.x * ratio, y: bbox.y * ratio, w: bbox.w * ratio, h: bbox.h * ratio };
  const W = canvas.width,
    H = canvas.height;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi - 1, Math.round(v)));
  const x0 = clamp(b.x, W),
    x1 = clamp(b.x + b.w, W),
    y0 = clamp(b.y, H),
    y1 = clamp(b.y + b.h, H);
  const ring = Math.max(2, Math.round(b.h * 0.25));
  const rx0 = Math.max(0, x0 - ring),
    rx1 = Math.min(W - 1, x1 + ring),
    ry0 = Math.max(0, y0 - ring),
    ry1 = Math.min(H - 1, y1 + ring);
  if (x1 <= x0 || y1 <= y0) return { textColor: BLACK, bgColor: WHITE };
  const data = ctx.getImageData(rx0, ry0, rx1 - rx0 + 1, ry1 - ry0 + 1).data;
  const rw = rx1 - rx0 + 1;
  const bg: Uint8ClampedArray[] = [];
  const inside: Uint8ClampedArray[] = [];
  for (let y = 0; y <= ry1 - ry0; y++) {
    for (let x = 0; x <= rx1 - rx0; x++) {
      const gx = rx0 + x,
        gy = ry0 + y;
      const p = pixelAt(data, rw, x, y);
      if (gx < x0 || gx > x1 || gy < y0 || gy > y1) bg.push(p);
      else inside.push(p);
    }
  }
  // darkest quartile = glyphs
  inside.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const fg = inside.slice(0, Math.max(1, Math.floor(inside.length * 0.25)));
  return { textColor: medianColor(fg), bgColor: medianColor(bg) };
}

/** median color of the ring around a bbox — background behind an image */
export function sampleBgColor(
  canvas: HTMLCanvasElement,
  bbox: { x: number; y: number; w: number; h: number },
): Color {
  return sampleTextColors(canvas, bbox).bgColor;
}
