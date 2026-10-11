import type { TextItem, ImageItem } from "./pdf/model";
import type { Color, Edit, FontStem } from "./pdf/exporter";

/** one pdf page's rendered canvas, registered for color sampling */
export const canvasRegistry = new Map<number, HTMLCanvasElement>();
export const viewportRegistry = new Map<number, { transform: number[] }>();

export type Tool = "edit" | "addtext" | "sign";

/** AcroForm field name -> overlay value */
export type FormValues = Record<string, string | boolean | string[] | null>;

export interface Signature {
  bytes: Uint8Array; // PNG with alpha
  url: string;
  /** drawn aspect ratio w/h */
  aspect: number;
}

export interface TextDraft {
  kind: "text";
  item: TextItem;
  newText: string;
  fontStem: FontStem;
  bold: boolean;
  fontSizePt: number;
  textColor: Color;
  bgColor: Color;
}

export interface ImageDraft {
  kind: "image";
  item: ImageItem;
  imageBytes: Uint8Array | null;
  imageExt: "png" | "jpg";
  imagePreviewUrl: string | null;
  fit: "fill" | "fit";
  bgColor: Color;
  deleteOnly: boolean;
}

export interface AddTextDraft {
  kind: "addtext";
  pageIndex: number;
  xPt: number;
  yPt: number;
  text: string;
  fontStem: FontStem;
  bold: boolean;
  fontSizePt: number;
  textColor: Color;
}

export type Draft = TextDraft | ImageDraft | AddTextDraft;

/** stable edit id helpers — one edit per underlying item */
export const textEditId = (itemId: string) => `et-${itemId}`;
export const imageEditId = (itemId: string) => `ei-${itemId}`;
export const addTextEditId = (page: number, n: number) => `ea-${page}-${n}`;
export const stampEditId = (n: number) => `es-${n}`;

export function upsertEdit(edits: Edit[], next: Edit): Edit[] {
  const i = edits.findIndex((e) => e.id === next.id);
  if (i >= 0) {
    const copy = edits.slice();
    copy[i] = next;
    return copy;
  }
  return [...edits, next];
}

export function removeEdit(edits: Edit[], id: string): Edit[] {
  return edits.filter((e) => e.id !== id);
}
