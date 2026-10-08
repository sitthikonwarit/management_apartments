import { useEffect, useRef, useState } from "react";
import { formatCrop, parseCrop } from "../utils/imageCrop";

// ปรับมุมมองรูปแบบแอปแต่งรูปบนมือถือ: กรอบล็อก 16:9 ลากเพื่อเลื่อน ซูมด้วยสไลเดอร์/ล้อเมาส์/ปุ่ม +-
// ไม่ตัดไฟล์จริง เก็บแค่ค่า "x% y% zoom" แล้วนำไปใช้ตอนแสดงผล (object-position + scale)
const ASPECT = 16 / 9;
const MAX_ZOOM = 4;

export default function ImageCropper({ src, initial, onCancel, onConfirm }: {
  src: string;
  initial?: string;
  onCancel: () => void;
  onConfirm: (crop: string) => void;
}) {
  const W = Math.min(520, Math.max(240, window.innerWidth - 64));
  const H = Math.round(W / ASPECT);
  const init = parseCrop(initial);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(init.zoom);
  const [pos, setPos] = useState({ x: init.x, y: init.y });
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  // ขนาดรูปแบบ cover ในกรอบ
  const base = nat ? Math.max(W / nat.w, H / nat.h) : 1;
  const Sw = nat ? nat.w * base : W;
  const Sh = nat ? nat.h * base : H;
  const clamp01 = (v: number) => Math.min(100, Math.max(0, v));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    // ตำแหน่งจุดในรูป = p*(กรอบ - ขนาดรูป*zoom) + a*zoom → ลากเท่าไรต้องเลื่อน p เท่านี้
    const kx = W - Sw * zoom, ky = H - Sh * zoom;
    setPos({
      x: Math.abs(kx) > 0.5 ? clamp01(d.px + (dx / kx) * 100) : d.px,
      y: Math.abs(ky) > 0.5 ? clamp01(d.py + (dy / ky) * 100) : d.py,
    });
  }

  const origin = `${pos.x}% ${pos.y}%`;
  return (
    <div className="confirm-overlay" style={{ zIndex: 1500 }} onClick={onCancel}>
      <div className="confirm-dialog" style={{ maxWidth: W + 48, width: "100%", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <h6 className="mb-1"><i className="fas fa-crop-alt me-2 text-primary" />ปรับมุมมองรูป</h6>
        <div className="text-muted small mb-2">ลากเพื่อเลื่อนรูป · ซูมด้วยสไลเดอร์/ล้อเมาส์ (กรอบล็อก 16:9 · ไม่แก้ไฟล์รูปต้นฉบับ)</div>
        <div
          style={{ width: W, height: H, margin: "0 auto", position: "relative", overflow: "hidden", borderRadius: 10, background: "#000", touchAction: "none", cursor: "grab", userSelect: "none" }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y }; }}
          onPointerMove={move}
          onPointerUp={() => { drag.current = null; }}
          onWheel={(e) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z - e.deltaY * 0.002)))}
        >
          <img
            src={src} alt="" draggable={false}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: origin, transformOrigin: origin, transform: `scale(${zoom})`, pointerEvents: "none" }}
          />
          {/* เส้นกริด 3x3 ช่วยจัดองค์ประกอบ */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", border: "2px solid rgba(255,255,255,0.8)", borderRadius: 10,
            backgroundImage: "linear-gradient(to right, transparent 33%, rgba(255,255,255,.35) 33%, rgba(255,255,255,.35) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.35) 66%, rgba(255,255,255,.35) calc(66% + 1px), transparent calc(66% + 1px)), linear-gradient(to bottom, transparent 33%, rgba(255,255,255,.35) 33%, rgba(255,255,255,.35) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.35) 66%, rgba(255,255,255,.35) calc(66% + 1px), transparent calc(66% + 1px))" }} />
        </div>
        <div className="d-flex align-items-center gap-2 mt-3 px-2">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setZoom((z) => Math.max(1, z - 0.25))}><i className="fas fa-minus" /></button>
          <input type="range" className="form-range flex-grow-1" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.25))}><i className="fas fa-plus" /></button>
          <button type="button" className="btn btn-sm btn-outline-secondary" title="รีเซ็ต" onClick={() => { setZoom(1); setPos({ x: 50, y: 50 }); }}><i className="fas fa-rotate-left" /></button>
        </div>
        <div className="d-flex gap-2 justify-content-end mt-3">
          <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>ยกเลิก</button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(formatCrop({ x: pos.x, y: pos.y, zoom }))} disabled={!nat}><i className="fas fa-check me-1" />ใช้ค่านี้</button>
        </div>
      </div>
    </div>
  );
}
