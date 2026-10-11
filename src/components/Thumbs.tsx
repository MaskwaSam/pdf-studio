import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";

function Thumb({ page, index, onJump }: { page: pdfjs.PDFPageProxy; index: number; onJump: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setVisible(true)), {
      rootMargin: "200px",
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    const base = page.getViewport({ scale: 1 });
    const scale = 120 / base.width;
    const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
    canvas.style.height = `${vp.height / (window.devicePixelRatio || 1)}px`;
    const task = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp });
    return () => task.cancel();
  }, [page, visible]);

  return (
    <div ref={ref} className="thumb" onClick={() => onJump(index)}>
      <canvas ref={canvasRef} />
      <span>{index + 1}</span>
    </div>
  );
}

export default function Thumbs({ doc, onJump }: { doc: pdfjs.PDFDocumentProxy; onJump: (i: number) => void }) {
  const [pages, setPages] = useState<pdfjs.PDFPageProxy[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const arr: pdfjs.PDFPageProxy[] = [];
      for (let i = 1; i <= doc.numPages; i++) arr.push(await doc.getPage(i));
      if (!cancelled) setPages(arr);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);
  return (
    <div className="thumbs">
      {pages.map((p, i) => (
        <Thumb key={i} page={p} index={i} onJump={onJump} />
      ))}
    </div>
  );
}
