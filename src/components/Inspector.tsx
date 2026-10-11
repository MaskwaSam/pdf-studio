import React, { useRef } from "react";
import type { Draft, Signature } from "../state";
import type { Color, Edit, HeaderFooterSpec } from "../pdf/exporter";

const toHex = (c: Color) =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (h: string): Color => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});

interface Props {
  draft: Draft | null;
  edits: Edit[];
  onDraftChange: (d: Draft) => void;
  onApply: () => void;
  onCancelDraft: () => void;
  onDeleteDraft: () => void;
  onRemoveEdit: (id: string) => void;
  onEditImageFile: (file: File) => void;
  onJumpToEdit: (pageIndex: number) => void;
  signature: Signature | null;
  signToolActive: boolean;
  onDrawSignature: () => void;
  headerFooter: HeaderFooterSpec;
  onHeaderFooter: (h: HeaderFooterSpec) => void;
}

export default function Inspector(props: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const d = props.draft;

  const fontRow = (
    fontStem: string,
    bold: boolean,
    setStem: (s: "helv" | "times" | "cour") => void,
    setBold: (b: boolean) => void,
  ) => (
    <div className="row">
      <label>Font</label>
      <select value={fontStem} onChange={(e) => setStem(e.target.value as "helv" | "times" | "cour")}>
        <option value="helv">Helvetica</option>
        <option value="times">Times</option>
        <option value="cour">Courier</option>
      </select>
      <button className={bold ? "chip on" : "chip"} onClick={() => setBold(!bold)}>
        B
      </button>
    </div>
  );

  const colorRow = (label: string, c: Color, set: (c: Color) => void) => (
    <div className="row">
      <label>{label}</label>
      <input type="color" value={toHex(c)} onChange={(e) => set(fromHex(e.target.value))} />
      <span className="hexval">{toHex(c)}</span>
    </div>
  );

  let body: React.ReactNode = null;
  if (d?.kind === "text") {
    body = (
      <>
        <div className="panel-title">Edit text</div>
        <div className="row col">
          <textarea
            autoFocus
            value={d.newText}
            onChange={(e) => props.onDraftChange({ ...d, newText: e.target.value })}
            rows={Math.min(4, Math.max(1, d.newText.length / 40 + 1))}
          />
        </div>
        {fontRow(d.fontStem, d.bold, (s) => props.onDraftChange({ ...d, fontStem: s }), (b) =>
          props.onDraftChange({ ...d, bold: b }),
        )}
        <div className="row">
          <label>Size</label>
          <input
            type="number"
            step={0.5}
            value={+d.fontSizePt.toFixed(1)}
            onChange={(e) => props.onDraftChange({ ...d, fontSizePt: +e.target.value })}
          />
        </div>
        {colorRow("Text color", d.textColor, (c) => props.onDraftChange({ ...d, textColor: c }))}
        {colorRow("Background", d.bgColor, (c) => props.onDraftChange({ ...d, bgColor: c }))}
        <div className="row btns">
          <button className="primary" onClick={props.onApply}>
            Apply
          </button>
          <button onClick={props.onDeleteDraft}>Erase text</button>
          <button onClick={props.onCancelDraft}>Cancel</button>
        </div>
      </>
    );
  } else if (d?.kind === "image") {
    body = (
      <>
        <div className="panel-title">Replace image</div>
        {d.imagePreviewUrl ? (
          <img className="preview-img" src={d.imagePreviewUrl} alt="replacement" />
        ) : (
          <div className="hint">Choose a replacement image, or delete this one.</div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onEditImageFile(f);
            e.target.value = "";
          }}
        />
        <div className="row">
          <label>Fit</label>
          <select value={d.fit} onChange={(e) => props.onDraftChange({ ...d, fit: e.target.value as "fill" | "fit" })}>
            <option value="fill">Fill (stretch to frame)</option>
            <option value="fit">Fit (keep aspect)</option>
          </select>
        </div>
        {colorRow("Background", d.bgColor, (c) => props.onDraftChange({ ...d, bgColor: c }))}
        <div className="row btns">
          <button className="primary" onClick={() => fileRef.current?.click()}>
            Choose image…
          </button>
          <button onClick={props.onDeleteDraft}>Delete image</button>
          <button onClick={props.onCancelDraft}>Cancel</button>
        </div>
        {d.imageBytes && (
          <div className="row btns">
            <button className="primary" onClick={props.onApply}>
              Apply replacement
            </button>
          </div>
        )}
        {d.deleteOnly && (
          <div className="row btns">
            <button className="primary" onClick={props.onApply}>
              Apply delete
            </button>
          </div>
        )}
      </>
    );
  } else if (d?.kind === "addtext") {
    body = (
      <>
        <div className="panel-title">Add text</div>
        <div className="row col">
          <textarea
            autoFocus
            placeholder="Type text…"
            value={d.text}
            onChange={(e) => props.onDraftChange({ ...d, text: e.target.value })}
            rows={2}
          />
        </div>
        {fontRow(d.fontStem, d.bold, (s) => props.onDraftChange({ ...d, fontStem: s }), (b) =>
          props.onDraftChange({ ...d, bold: b }),
        )}
        <div className="row">
          <label>Size</label>
          <input
            type="number"
            step={0.5}
            value={+d.fontSizePt.toFixed(1)}
            onChange={(e) => props.onDraftChange({ ...d, fontSizePt: +e.target.value })}
          />
        </div>
        {colorRow("Text color", d.textColor, (c) => props.onDraftChange({ ...d, textColor: c }))}
        <div className="row btns">
          <button className="primary" onClick={props.onApply} disabled={!d.text.trim()}>
            Add
          </button>
          <button onClick={props.onCancelDraft}>Cancel</button>
        </div>
      </>
    );
  }

  const editCount = props.edits.length;
  return (
    <div className="inspector">
      {body ?? <div className="hint pad">Select text or an image to edit, or use a tool above.</div>}

      <div className="editlist">
        <div className="panel-title">Signature</div>
        {props.signature ? (
          <>
            <img className="preview-img sig-thumb" src={props.signature.url} alt="signature" />
            <div className="hint">{props.signToolActive ? "Click on the page to place it." : "Pick the Sign tool, then click the page."}</div>
          </>
        ) : (
          <div className="hint">Draw a signature, then click the page to stamp it.</div>
        )}
        <div className="row btns">
          <button onClick={props.onDrawSignature}>{props.signature ? "Redraw" : "Draw signature"}</button>
        </div>
      </div>

      <div className="editlist">
        <div className="panel-title">Header / footer</div>
        <div className="row">
          <label>Header</label>
          <input
            className="hf-input"
            value={props.headerFooter.header}
            onChange={(e) => props.onHeaderFooter({ ...props.headerFooter, header: e.target.value })}
            placeholder="e.g. Confidential"
          />
          <select
            value={props.headerFooter.headerAlign}
            onChange={(e) => props.onHeaderFooter({ ...props.headerFooter, headerAlign: e.target.value as HeaderFooterSpec["headerAlign"] })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <div className="row">
          <label>Footer</label>
          <input
            className="hf-input"
            value={props.headerFooter.footer}
            onChange={(e) => props.onHeaderFooter({ ...props.headerFooter, footer: e.target.value })}
            placeholder="e.g. Page {page} of {pages}"
          />
          <select
            value={props.headerFooter.footerAlign}
            onChange={(e) => props.onHeaderFooter({ ...props.headerFooter, footerAlign: e.target.value as HeaderFooterSpec["footerAlign"] })}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <div className="row">
          <label>Size</label>
          <input
            type="number"
            min={6}
            max={36}
            step={0.5}
            value={props.headerFooter.fontSize}
            onChange={(e) => props.onHeaderFooter({ ...props.headerFooter, fontSize: Math.max(1, +e.target.value || 9) })}
          />
          <label>Margin</label>
          <input
            type="number"
            min={0}
            max={200}
            value={props.headerFooter.margin}
            onChange={(e) => props.onHeaderFooter({ ...props.headerFooter, margin: Math.max(0, +e.target.value || 0) })}
          />
        </div>
        <div className="hint">{"Use {page} and {pages} for page numbers."}</div>
      </div>
      {editCount > 0 && (
        <div className="editlist">
          <div className="panel-title">Changes ({editCount})</div>
          {props.edits.map((e) => (
            <div className="editrow" key={e.id}>
              <span className="edittext" onClick={() => props.onJumpToEdit(e.pageIndex)}>
                {e.kind === "text"
                  ? e.newText == null || e.newText === ""
                    ? `Erase "${truncate(e.item.str)}"`
                    : `"${truncate(e.item.str)}" → "${truncate(e.newText)}"`
                  : e.kind === "image"
                    ? e.imageBytes
                      ? "Replace image"
                      : "Delete image"
                    : e.kind === "stamp"
                      ? "Signature"
                      : `Add "${truncate(e.text)}"`}
              </span>
              <span className="pgnum">p{e.pageIndex + 1}</span>
              <button className="x" onClick={() => props.onRemoveEdit(e.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n = 24) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
