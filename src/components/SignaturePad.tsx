import React, { useEffect, useRef, useState } from "react";

interface Props {
  onSave: (png: Uint8Array, url: string, aspect: number) => void;
  onCancel: () => void;
}

/** Modal drawing pad — captures a signature, crops to ink, returns a transparent PNG. */
export default function SignaturePad(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const bbox = useRef({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const [empty, setEmpty] = useState(true);
  const W = 520,
    H = 170;

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#152a63";
    ctx.lineWidth = 2.6;
  }, []);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const grow = (x: number, y: number) => {
    const b = bbox.current;
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };

  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    hasInk.current = true;
    setEmpty(false);
    canvasRef.current!.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current!.getContext("2d")!;
    const [x, y] = pos(e);
    grow(x, y);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const [x, y] = pos(e);
    grow(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const up = () => {
    drawing.current = false;
  };

  const clear = () => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.beginPath();
    bbox.current = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    hasInk.current = false;
    setEmpty(true);
  };

  const save = async () => {
    if (!hasInk.current) return;
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    // crop to ink + padding
    const pad = 8;
    const b = bbox.current;
    const cx = Math.max(0, Math.floor(b.minX - pad)),
      cy = Math.max(0, Math.floor(b.minY - pad)),
      cw = Math.min(W - cx, Math.ceil(b.maxX - b.minX + pad * 2)),
      ch = Math.min(H - cy, Math.ceil(b.maxY - b.minY + pad * 2));
    const out = document.createElement("canvas");
    out.width = Math.max(1, cw * dpr);
    out.height = Math.max(1, ch * dpr);
    out.getContext("2d")!.drawImage(c, cx * dpr, cy * dpr, cw * dpr, ch * dpr, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    props.onSave(bytes, URL.createObjectURL(blob), cw / ch);
  };

  return (
    <div className="sigpad-backdrop" onClick={props.onCancel}>
      <div className="sigpad" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">Draw your signature</div>
        <canvas
          ref={canvasRef}
          className="sigpad-canvas"
          style={{ width: W, height: H }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
        />
        <div className="row btns">
          <button className="primary" onClick={save} disabled={empty}>
            Use signature
          </button>
          <button onClick={clear}>Clear</button>
          <button onClick={props.onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
