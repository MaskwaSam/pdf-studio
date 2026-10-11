import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { loadPdf, extractPageContent, vpApply } from "./pdf/model";
import type { PageContent, TextItem, ImageItem, LoadedPdf } from "./pdf/model";
import { exportPdf, sampleTextColors, sampleBgColor } from "./pdf/exporter";
import type { Edit, TextEdit, ImageEdit, AddTextEdit } from "./pdf/exporter";
import {
  canvasRegistry,
  viewportRegistry,
  textEditId,
  imageEditId,
  addTextEditId,
  upsertEdit,
  removeEdit,
} from "./state";
import type { Draft, Tool } from "./state";
import PageView from "./components/PageView";
import Thumbs from "./components/Thumbs";
import Inspector from "./components/Inspector";
import "./styles.css";

export default function App() {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<pdfjs.PDFPageProxy[]>([]);
  const [contents, setContents] = useState<Record<number, PageContent>>({});
  const contentsRef = useRef<Record<number, PageContent>>({});
  const [tool, setTool] = useState<Tool>("edit");
  const [scale, setScale] = useState(1.25);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [findStr, setFindStr] = useState("");
  const [replaceStr, setReplaceStr] = useState("");
  const [matchItemIds, setMatchItemIds] = useState<Set<string>>(new Set());
  const addCounter = useRef(0);
  const mainRef = useRef<HTMLDivElement>(null);

  const resetDoc = useCallback(() => {
    setEdits([]);
    setDraft(null);
    setContents({});
    contentsRef.current = {};
    setMatchItemIds(new Set());
    canvasRegistry.clear();
    viewportRegistry.clear();
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const loaded = await loadPdf(file);
        resetDoc();
        setPdf(loaded);
        setFileName(file.name.replace(/\.pdf$/i, ""));
        const arr: pdfjs.PDFPageProxy[] = [];
        for (let i = 1; i <= loaded.numPages; i++) arr.push(await loaded.doc.getPage(i));
        setPages(arr);
      } catch (e) {
        alert(`Could not open PDF: ${e}`);
      } finally {
        setBusy(false);
      }
    },
    [resetDoc],
  );

  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && /\.pdf$/i.test(f.name)) openFile(f);
    };
    const onDrag = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDrag);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDrag);
    };
  }, [openFile]);

  const onContent = useCallback((i: number, c: PageContent) => {
    contentsRef.current[i] = c;
    setContents((m) => ({ ...m, [i]: c }));
  }, []);

  const canvasBboxForQuad = (pageIndex: number, q: { x: number; y: number }[]) => {
    const t = viewportRegistry.get(pageIndex)?.transform;
    if (!t) return { x: 0, y: 0, w: 0, h: 0 };
    const pts = q.map((p) => vpApply(t, p.x, p.y));
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs),
      minY = Math.min(...ys),
      maxX = Math.max(...xs),
      maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  const onTextItemClick = useCallback((item: TextItem) => {
    const canvas = canvasRegistry.get(item.pageIndex);
    const bbox = canvasBboxForQuad(item.pageIndex, item.quad);
    const sampled = canvas ? sampleTextColors(canvas, bbox) : { textColor: { r: 0, g: 0, b: 0 }, bgColor: { r: 1, g: 1, b: 1 } };
    setDraft({
      kind: "text",
      item,
      newText: item.str,
      fontStem: item.fontStem,
      bold: item.isBold,
      fontSizePt: item.fontSizePt,
      textColor: sampled.textColor,
      bgColor: sampled.bgColor,
    });
  }, []);

  const onImageItemClick = useCallback((item: ImageItem) => {
    const canvas = canvasRegistry.get(item.pageIndex);
    const bbox = canvasBboxForQuad(item.pageIndex, item.quad);
    const bg = canvas ? sampleBgColor(canvas, bbox) : { r: 1, g: 1, b: 1 };
    setDraft({ kind: "image", item, imageBytes: null, imageExt: "png", imagePreviewUrl: null, fit: "fill", bgColor: bg, deleteOnly: false });
  }, []);

  const onPageClick = useCallback((pageIndex: number, xPt: number, yPt: number) => {
    setDraft({
      kind: "addtext",
      pageIndex,
      xPt,
      yPt,
      text: "",
      fontStem: "helv",
      bold: false,
      fontSizePt: 16,
      textColor: { r: 0, g: 0, b: 0 },
    });
  }, []);

  const onEditImageFile = useCallback(
    async (file: File) => {
      if (!draft || draft.kind !== "image") return;
      let ext: "png" | "jpg" = "png";
      let bytes: Uint8Array;
      if (file.type === "image/jpeg") {
        ext = "jpg";
        bytes = new Uint8Array(await file.arrayBuffer());
      } else if (file.type === "image/png") {
        ext = "png";
        bytes = new Uint8Array(await file.arrayBuffer());
      } else {
        // convert other formats to png via canvas
        const bmp = await createImageBitmap(file);
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")!.drawImage(bmp, 0, 0);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
        bytes = new Uint8Array(await blob!.arrayBuffer());
      }
      setDraft({ ...draft, imageBytes: bytes, imageExt: ext, imagePreviewUrl: URL.createObjectURL(file), deleteOnly: false });
    },
    [draft],
  );

  const onApply = useCallback(() => {
    if (!draft) return;
    if (draft.kind === "text") {
      const e: TextEdit = {
        kind: "text",
        id: textEditId(draft.item.id),
        pageIndex: draft.item.pageIndex,
        itemId: draft.item.id,
        item: draft.item,
        newText: draft.newText,
        fontStem: draft.fontStem,
        bold: draft.bold,
        fontSizePt: draft.fontSizePt,
        textColor: draft.textColor,
        bgColor: draft.bgColor,
      };
      setEdits((es) => upsertEdit(es, e));
    } else if (draft.kind === "image") {
      if (!draft.imageBytes && !draft.deleteOnly) {
        setDraft(null);
        return;
      }
      const e: ImageEdit = {
        kind: "image",
        id: imageEditId(draft.item.id),
        pageIndex: draft.item.pageIndex,
        itemId: draft.item.id,
        item: draft.item,
        imageBytes: draft.deleteOnly ? null : draft.imageBytes,
        imageExt: draft.imageExt,
        fit: draft.fit,
        bgColor: draft.bgColor,
      };
      setEdits((es) => upsertEdit(es, e));
    } else {
      const e: AddTextEdit = {
        kind: "addtext",
        id: addTextEditId(draft.pageIndex, addCounter.current++),
        pageIndex: draft.pageIndex,
        xPt: draft.xPt,
        yPt: draft.yPt,
        text: draft.text,
        fontStem: draft.fontStem,
        bold: draft.bold,
        fontSizePt: draft.fontSizePt,
        textColor: draft.textColor,
      };
      setEdits((es) => upsertEdit(es, e));
    }
    setDraft(null);
  }, [draft]);

  const onDeleteDraft = useCallback(() => {
    if (!draft) return;
    if (draft.kind === "text") setDraft({ ...draft, newText: "" });
    else if (draft.kind === "image") setDraft({ ...draft, deleteOnly: true, imageBytes: null });
  }, [draft]);

  const onRemoveEdit = useCallback((id: string) => setEdits((es) => removeEdit(es, id)), []);

  const onUndo = useCallback(() => setEdits((es) => es.slice(0, -1)), []);

  // find & replace
  const computeMatches = useCallback(async (needle: string) => {
    if (!pdf || !needle) {
      setMatchItemIds(new Set());
      return new Set<string>();
    }
    const ids = new Set<string>();
    const lower = needle.toLowerCase();
    for (let i = 0; i < pdf.numPages; i++) {
      const c = contentsRef.current[i] ?? (await extractPageContent(await pdf.doc.getPage(i + 1), i));
      contentsRef.current[i] = c;
      for (const t of c.texts) if (t.str.toLowerCase().includes(lower)) ids.add(t.id);
    }
    setContents({ ...contentsRef.current });
    setMatchItemIds(ids);
    return ids;
  }, [pdf]);

  useEffect(() => {
    const t = setTimeout(() => void computeMatches(findStr), 300);
    return () => clearTimeout(t);
  }, [findStr, computeMatches]);

  const replaceAll = useCallback(async () => {
    if (!findStr) return;
    const ids = await computeMatches(findStr);
    if (ids.size === 0) return;
    const re = new RegExp(findStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    setEdits((es) => {
      let next = es;
      for (const c of Object.values(contentsRef.current)) {
        for (const t of c.texts) {
          if (!ids.has(t.id)) continue;
          const replaced = t.str.replace(re, replaceStr);
          const e: TextEdit = {
            kind: "text",
            id: textEditId(t.id),
            pageIndex: t.pageIndex,
            itemId: t.id,
            item: t,
            newText: replaced,
            fontStem: t.fontStem,
            bold: t.isBold,
            fontSizePt: t.fontSizePt,
            textColor: { r: 0, g: 0, b: 0 },
            bgColor: { r: 1, g: 1, b: 1 },
          };
          next = upsertEdit(next, e);
        }
      }
      return next;
    });
  }, [findStr, replaceStr, computeMatches]);

  const onDownload = useCallback(async () => {
    if (!pdf) return;
    setBusy(true);
    try {
      const out = await exportPdf(pdf.bytes, edits);
      const blob = new Blob([out.slice().buffer as ArrayBuffer], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fileName || "document"}-edited.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert(`Export failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }, [pdf, edits, fileName]);

  const jumpTo = (i: number) => {
    document.getElementById(`page-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">PDF Studio</span>
        <label className="btn">
          Open PDF
          <input
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])}
          />
        </label>
        {pdf && (
          <>
            <div className="sep" />
            <button className={tool === "edit" ? "btn on" : "btn"} onClick={() => setTool("edit")}>
              Edit
            </button>
            <button className={tool === "addtext" ? "btn on" : "btn"} onClick={() => setTool("addtext")}>
              + Text
            </button>
            <button className={showFind ? "btn on" : "btn"} onClick={() => setShowFind(!showFind)}>
              Find / Replace
            </button>
            <div className="sep" />
            <button className="btn" onClick={() => setScale((s) => Math.max(0.4, +(s - 0.25).toFixed(2)))}>
              −
            </button>
            <span className="zoom">{Math.round(scale * 100)}%</span>
            <button className="btn" onClick={() => setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)))}>
              +
            </button>
            <div className="sep" />
            <button className="btn" onClick={onUndo} disabled={edits.length === 0}>
              Undo
            </button>
            <div className="spacer" />
            <span className="fname">{fileName}.pdf</span>
            <button className="btn primary" onClick={onDownload} disabled={busy}>
              {busy ? "Working…" : `Download PDF${edits.length ? ` (${edits.length})` : ""}`}
            </button>
          </>
        )}
      </header>

      {showFind && pdf && (
        <div className="findbar">
          <input placeholder="Find text…" value={findStr} onChange={(e) => setFindStr(e.target.value)} />
          <input placeholder="Replace with…" value={replaceStr} onChange={(e) => setReplaceStr(e.target.value)} />
          <button className="btn" onClick={replaceAll} disabled={!findStr || matchItemIds.size === 0}>
            Replace all ({matchItemIds.size})
          </button>
        </div>
      )}

      <div className="main">
        {!pdf ? (
          <div className="dropzone">
            <div className="dz-inner">
              <h1>PDF Studio</h1>
              <p>Drop a PDF here or click “Open PDF”.</p>
              <p className="sub">Edit text · replace images · add text — all in your browser, nothing uploaded.</p>
            </div>
          </div>
        ) : (
          <>
            {pdf.numPages > 1 && <Thumbs doc={pdf.doc} onJump={jumpTo} />}
            <div className="pages" ref={mainRef}>
              {pages.map((p, i) => (
                <div id={`page-${i}`} key={i}>
                  <PageView
                    page={p}
                    pageIndex={i}
                    scale={scale}
                    tool={tool}
                    content={contents[i] ?? null}
                    edits={edits}
                    draft={draft}
                    matchItemIds={matchItemIds}
                    onContent={onContent}
                    onTextItemClick={onTextItemClick}
                    onImageItemClick={onImageItemClick}
                    onPageClick={onPageClick}
                  />
                </div>
              ))}
            </div>
            <Inspector
              draft={draft}
              edits={edits}
              onDraftChange={setDraft}
              onApply={onApply}
              onCancelDraft={() => setDraft(null)}
              onDeleteDraft={onDeleteDraft}
              onRemoveEdit={onRemoveEdit}
              onEditImageFile={onEditImageFile}
              onJumpToEdit={jumpTo}
            />
          </>
        )}
      </div>
    </div>
  );
}
