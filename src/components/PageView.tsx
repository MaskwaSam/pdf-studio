import React, { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import {
  extractPageContent,
  vpApply,
} from "../pdf/model";
import type { PageContent, TextItem, ImageItem, Quad, FormField, RadioMeta } from "../pdf/model";
import type { Edit, ImageEdit, TextEdit, AddTextEdit, HeaderFooterSpec } from "../pdf/exporter";
import { canvasRegistry, viewportRegistry } from "../state";
import type { Draft, Tool, FormValues } from "../state";

const css = (c: { r: number; g: number; b: number }) =>
  `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;

// pdf.js forbids concurrent render() calls on one canvas; serialize per canvas
// so cleanup/StrictMode re-runs never touch a canvas mid-paint (displayed-texture corruption)
const renderQueue = new WeakMap<HTMLCanvasElement, Promise<unknown>>();

export const stemToCss = (s: string) =>
  s === "times" ? '"Times New Roman", Times, serif' : s === "cour" ? '"Courier New", Courier, monospace' : 'Helvetica, Arial, sans-serif';

/** CSS transform mapping a 1x1px div onto the given canvas-space quad */
function quadCss(q: Quad, scale: number, vpTransform: number[]): string {
  // canvas-space quad: transform pdf pts by viewport matrix
  const pts = q.map((p) => vpApply(vpTransform, p.x, p.y));
  const [bl, br, , tl] = pts;
  const a = br[0] - bl[0],
    b = br[1] - bl[1],
    c = tl[0] - bl[0],
    d = tl[1] - bl[1],
    e = bl[0],
    f = bl[1];
  void scale;
  return `matrix(${a},${b},${c},${d},${e},${f})`;
}

/** canvas-space bbox of a pdf-space quad */
function quadCanvasBounds(q: Quad, vpTransform: number[]) {
  const pts = q.map((p) => vpApply(vpTransform, p.x, p.y));
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    maxX = Math.max(...xs),
    maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

interface Props {
  page: pdfjs.PDFPageProxy;
  pageIndex: number;
  scale: number;
  tool: Tool;
  content: PageContent | null;
  edits: Edit[];
  draft: Draft | null;
  matchItemIds: Set<string>;
  radioMeta: RadioMeta;
  formValues: FormValues;
  headerFooter: HeaderFooterSpec | null;
  numPages: number;
  onContent: (pageIndex: number, c: PageContent) => void;
  onTextItemClick: (item: TextItem) => void;
  onImageItemClick: (item: ImageItem) => void;
  onPageClick: (pageIndex: number, xPt: number, yPt: number) => void;
  onSignClick: (pageIndex: number, xPt: number, yPt: number) => void;
  onFormValue: (f: FormField, v: string | boolean | string[]) => void;
}

export default function PageView(props: Props) {
  const { page, pageIndex, scale } = props;
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const viewport = page.getViewport({ scale });
  const vpTransform = viewport.transform as number[];

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // register canvas + viewport for sampling / coordinate conversion
  useEffect(() => {
    if (canvasRef.current) canvasRegistry.set(pageIndex, canvasRef.current);
    viewportRegistry.set(pageIndex, { transform: vpTransform });
  }, [pageIndex, vpTransform, visible]);

  // render (serialized per canvas — see renderQueue above)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    let cancelled = false;
    const dpr = window.devicePixelRatio || 1;
    const renderVp = page.getViewport({ scale: scale * dpr });
    const ctx = canvas.getContext("2d")!;
    let task: pdfjs.RenderTask | null = null;
    const prev = renderQueue.get(canvas) ?? Promise.resolve();
    const current = prev
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        canvas.width = Math.ceil(renderVp.width);
        canvas.height = Math.ceil(renderVp.height);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        task = page.render({ canvas, canvasContext: ctx, viewport: renderVp });
        return task.promise;
      })
      .catch(() => {});
    renderQueue.set(canvas, current);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [page, scale, visible]);

  // extract content lazily once
  useEffect(() => {
    if (props.content || !visible) return;
    let cancelled = false;
    extractPageContent(page, pageIndex, props.radioMeta).then((c) => {
      if (!cancelled) props.onContent(pageIndex, c);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageIndex, visible, props.content]);

  const content = props.content;
  const pageEdits = props.edits.filter((e) => e.pageIndex === pageIndex);
  const draftHere = props.draft && (props.draft.kind === "addtext" ? props.draft.pageIndex === pageIndex : props.draft.item.pageIndex === pageIndex) ? props.draft : null;

  const handleCanvasClick = (ev: React.MouseEvent) => {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const [xPt, yPt] = viewport.convertToPdfPoint(x, y);
    if (props.tool === "sign") {
      props.onSignClick(pageIndex, xPt, yPt);
      return;
    }
    if (props.tool !== "addtext") return;
    props.onPageClick(pageIndex, xPt, yPt);
  };

  return (
    <div
      className="page-holder"
      ref={holderRef}
      style={{ width: viewport.width, height: viewport.height }}
      onClick={handleCanvasClick}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
      {content && (
        <div className="overlay">
          {/* committed edit previews (under hit layers, over canvas) */}
          {pageEdits.map((e) => {
            if (e.kind === "text") {
              const b = quadCanvasBounds(e.item.quad, vpTransform);
              const bg = quadCss(e.item.quad, scale, vpTransform);
              const fontPx = e.fontSizePt * scale;
              return (
                <React.Fragment key={e.id}>
                  <div className="cover" style={{ transform: bg, background: css(e.bgColor) }} />
                  {e.newText != null && e.newText !== "" && (
                    <div
                      className="edit-text-preview"
                      style={{
                        left: b.x,
                        top: b.y,
                        width: b.w,
                        height: b.h,
                        fontSize: fontPx * 0.92,
                        fontFamily: stemToCss(e.fontStem),
                        fontWeight: e.bold ? 700 : 400,
                        color: css(e.textColor),
                        lineHeight: `${b.h}px`,
                        transform: `rotate(${-e.item.angleDeg}deg)`,
                        transformOrigin: `0 ${b.h / 2}px`,
                      }}
                    >
                      {e.newText}
                    </div>
                  )}
                </React.Fragment>
              );
            }
            if (e.kind === "image") {
              const bg = quadCss(e.item.quad, scale, vpTransform);
              return (
                <React.Fragment key={e.id}>
                  <div className="cover" style={{ transform: bg, background: css(e.bgColor) }} />
                  {e.imageBytes && (
                    <img
                      className="edit-image-preview"
                      style={{ transform: bg, objectFit: e.fit === "fill" ? "fill" : "contain" }}
                      src={URL.createObjectURL(new Blob([e.imageBytes.slice().buffer as ArrayBuffer]))}
                      alt=""
                    />
                  )}
                </React.Fragment>
              );
            }
            if (e.kind === "stamp") {
              const bg = quadCss(e.quad, scale, vpTransform);
              return (
                <img
                  key={e.id}
                  className="edit-image-preview"
                  style={{ transform: bg, objectFit: "fill" }}
                  src={URL.createObjectURL(new Blob([e.imageBytes.slice().buffer as ArrayBuffer]))}
                  alt=""
                />
              );
            }
            if (e.kind === "addtext") {
              const [cx, cy] = vpApply(vpTransform, e.xPt, e.yPt);
              return (
                <div
                  key={e.id}
                  className="edit-text-preview"
                  style={{
                    left: cx,
                    top: cy - e.fontSizePt * scale,
                    fontSize: e.fontSizePt * scale,
                    fontFamily: stemToCss(e.fontStem),
                    fontWeight: e.bold ? 700 : 400,
                    color: css(e.textColor),
                    lineHeight: `${e.fontSizePt * scale}px`,
                  }}
                >
                  {e.text}
                </div>
              );
            }
            return null;
          })}

          {/* AcroForm fields — interactive overlays above everything else */}
          {content.fields.map((f) => {
            const [x1, y1, x2, y2] = f.rect;
            const p1 = vpApply(vpTransform, x1, y1),
              p2 = vpApply(vpTransform, x2, y2);
            const style: React.CSSProperties = {
              left: Math.min(p1[0], p2[0]),
              top: Math.min(p1[1], p2[1]),
              width: Math.abs(p2[0] - p1[0]),
              height: Math.abs(p2[1] - p1[1]),
            };
            const v = props.formValues[f.name];
            const stop = (ev: React.SyntheticEvent) => ev.stopPropagation();
            if (f.type === "checkbox") {
              return (
                <input
                  key={f.id}
                  type="checkbox"
                  className="ff ff-check"
                  style={style}
                  disabled={f.readOnly}
                  checked={v === undefined ? f.value === true : v === true}
                  onClick={stop}
                  onChange={(e) => props.onFormValue(f, e.target.checked)}
                />
              );
            }
            if (f.type === "radio") {
              const opt = f.optionValue ?? String(f.optionIndex ?? 0);
              return (
                <input
                  key={f.id}
                  type="radio"
                  className="ff ff-check"
                  style={style}
                  disabled={f.readOnly}
                  checked={v === undefined ? !!f.selected : v === opt}
                  onClick={stop}
                  onChange={() => props.onFormValue(f, opt)}
                />
              );
            }
            if (f.type === "combo" || f.type === "listbox") {
              const cur = v === undefined ? f.value : v;
              return (
                <select
                  key={f.id}
                  className="ff"
                  style={{ ...style, fontSize: Math.max(8, style.height as number * 0.55) }}
                  disabled={f.readOnly}
                  multiple={f.type === "listbox" && !!f.multiSelect}
                  value={cur as string | string[]}
                  onClick={stop}
                  onChange={(e) =>
                    props.onFormValue(
                      f,
                      f.multiSelect
                        ? Array.from(e.target.selectedOptions).map((o) => o.value)
                        : e.target.value,
                    )
                  }
                >
                  {(f.options ?? []).map((o) => (
                    <option key={o.exportValue} value={o.exportValue}>
                      {o.displayValue}
                    </option>
                  ))}
                </select>
              );
            }
            const fsPx = Math.max(8, (style.height as number) * (f.type === "multiline" ? 0.4 : 0.6));
            if (f.type === "multiline") {
              return (
                <textarea
                  key={f.id}
                  className="ff"
                  style={{ ...style, fontSize: fsPx }}
                  disabled={f.readOnly}
                  value={v === undefined ? String(f.value ?? "") : String(v ?? "")}
                  onClick={stop}
                  onChange={(e) => props.onFormValue(f, e.target.value)}
                />
              );
            }
            return (
              <input
                key={f.id}
                type="text"
                className="ff"
                style={{ ...style, fontSize: fsPx }}
                disabled={f.readOnly}
                value={v === undefined ? String(f.value ?? "") : String(v ?? "")}
                onClick={stop}
                onChange={(e) => props.onFormValue(f, e.target.value)}
              />
            );
          })}

          {/* header / footer preview */}
          {props.headerFooter &&
            (() => {
              const hf = props.headerFooter;
              const fpx = hf.fontSize * scale;
              const subst = (s: string) =>
                s.replaceAll("{page}", String(pageIndex + 1)).replaceAll("{pages}", String(props.numPages));
              return (
                <>
                  {hf.header.trim() !== "" && (
                    <div
                      className="hf-preview"
                      style={{
                        top: hf.margin * scale - fpx * 1.15,
                        left: hf.margin * scale,
                        right: hf.margin * scale,
                        fontSize: fpx,
                        textAlign: hf.headerAlign,
                        color: css(hf.color),
                      }}
                    >
                      {subst(hf.header)}
                    </div>
                  )}
                  {hf.footer.trim() !== "" && (
                    <div
                      className="hf-preview"
                      style={{
                        top: viewport.height - hf.margin * scale - fpx * 0.25,
                        left: hf.margin * scale,
                        right: hf.margin * scale,
                        fontSize: fpx,
                        textAlign: hf.footerAlign,
                        color: css(hf.color),
                      }}
                    >
                      {subst(hf.footer)}
                    </div>
                  )}
                </>
              );
            })()}

          {/* find/replace match highlights */}
          {content.texts
            .filter((t) => props.matchItemIds.has(t.id))
            .map((t) => {
              const b = quadCanvasBounds(t.quad, vpTransform);
              return <div key={`m-${t.id}`} className="match-hl" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />;
            })}

          {/* item hit layers in edit mode */}
          {props.tool === "edit" &&
            content.texts.map((t) => (
              <div
                key={`h-${t.id}`}
                className="hit hit-text"
                style={{ transform: quadCss(t.quad, scale, vpTransform) }}
                title={t.str}
                onClick={(ev) => {
                  ev.stopPropagation();
                  props.onTextItemClick(t);
                }}
              />
            ))}
          {props.tool === "edit" &&
            content.images.map((im) => (
              <div
                key={`h-${im.id}`}
                className="hit hit-image"
                style={{ transform: quadCss(im.quad, scale, vpTransform) }}
                title="Image"
                onClick={(ev) => {
                  ev.stopPropagation();
                  props.onImageItemClick(im);
                }}
              />
            ))}

          {/* draft previews */}
          {draftHere?.kind === "text" &&
            (() => {
              const d = draftHere;
              const bg = quadCss(d.item.quad, scale, vpTransform);
              const b = quadCanvasBounds(d.item.quad, vpTransform);
              return (
                <>
                  <div className="cover draft" style={{ transform: bg, background: css(d.bgColor) }} />
                  {d.newText !== "" && (
                    <div
                      className="edit-text-preview draft"
                      style={{
                        left: b.x,
                        top: b.y,
                        width: b.w,
                        height: b.h,
                        fontSize: d.fontSizePt * scale * 0.92,
                        fontFamily: stemToCss(d.fontStem),
                        fontWeight: d.bold ? 700 : 400,
                        color: css(d.textColor),
                        lineHeight: `${b.h}px`,
                        transform: `rotate(${-d.item.angleDeg}deg)`,
                        transformOrigin: `0 ${b.h / 2}px`,
                      }}
                    >
                      {d.newText}
                    </div>
                  )}
                </>
              );
            })()}
          {draftHere?.kind === "image" &&
            (() => {
              const d = draftHere;
              const bg = quadCss(d.item.quad, scale, vpTransform);
              return (
                <>
                  <div className="cover draft" style={{ transform: bg, background: css(d.bgColor) }} />
                  {d.imagePreviewUrl && (
                    <img
                      className="edit-image-preview draft"
                      style={{ transform: bg, objectFit: d.fit === "fill" ? "fill" : "contain" }}
                      src={d.imagePreviewUrl}
                      alt=""
                    />
                  )}
                </>
              );
            })()}
          {draftHere?.kind === "addtext" &&
            (() => {
              const d = draftHere;
              const [cx, cy] = vpApply(vpTransform, d.xPt, d.yPt);
              return (
                <div
                  className="edit-text-preview draft"
                  style={{
                    left: cx,
                    top: cy - d.fontSizePt * scale,
                    fontSize: d.fontSizePt * scale,
                    fontFamily: stemToCss(d.fontStem),
                    fontWeight: d.bold ? 700 : 400,
                    color: css(d.textColor),
                    lineHeight: `${d.fontSizePt * scale}px`,
                  }}
                >
                  {d.text}
                  <span className="addtext-caret" />
                </div>
              );
            })()}
        </div>
      )}
      {!props.content && visible && <div className="page-loading">…</div>}
    </div>
  );
}

export type { TextEdit, ImageEdit, AddTextEdit };
