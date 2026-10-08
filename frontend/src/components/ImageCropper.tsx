import { useEffect, useRef, useState } from "react";

// ตัดรูปแบบแอปแต่งรูปบนมือถือ: กรอบล็อกสัดส่วน 16:9 ลากรูปเพื่อเลื่อน ซูมด้วยสไลเดอร์/ล้อเมาส์/ปุ่ม +- แล้วกดใช้รูป
// จะได้ไฟล์ที่ถูกครอปจริง (JPEG 1280x720) ไม่ใช่แค่จำตำแหน่ง ใช้ได้กับ data URL และรูปจากโดเมนเดียวกัน
const ASPECT = 16 / 9;
const OUT_W = 1280;
const MAX_ZOOM = 4;

export default function ImageCropper({ src, onCancel, onConfirm, onSkip }: {
  src: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
  onSkip?: () => void;
}) {
  const W = Math.min(520, Math.max(240, window.innerWidth - 64));
  const H = Math.round(W / ASPECT);
  const imgRef = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const base = nat ? Math.max(W / nat.w, H / nat.h) : 1;
  const scale = base * zoom;

  function clamp(p: { x: number; y: number }, z = zoom) {
    if (!nat) return p;
    const s = base * z;
    const mx = Math.max(0, (nat.w * s - W) / 2);
    const my = Math.max(0, (nat.h * s - H) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  }
  function changeZoom(z: number) {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(nz);
    setPos((p) => clamp(p, nz));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function confirm() {
    const img = imgRef.current;
    if (!img || !nat) return;
    const k = OUT_W / W;
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = Math.round(H * k);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const dw = nat.w * scale * k;
    const dh = nat.h * scale * k;
    ctx.drawImage(img, (W / 2 + pos.x) * k - dw / 2, (H / 2 + pos.y) * k - dh / 2, dw, dh);
    onConfirm(canvas.toDataURL("image/jpeg", 0.9));
  }

  return (
    <div className="confirm-overlay" style={{ zIndex: 1500 }} onClick={onCancel}>
      <div className="confirm-dialog" style={{ maxWidth: W + 48, width: "100%", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <h6 className="mb-1"><i className="fas fa-crop-alt me-2 text-primary" />ตัดรูป</h6>
        <div className="text-muted small mb-2">ลากเพื่อเลื่อนรูป · ซูมด้วยสไลเดอร์/ล้อเมาส์ (กรอบล็อกสัดส่วน 16:9)</div>
        <div
          style={{ width: W, height: H, margin: "0 auto", position: "relative", overflow: "hidden", borderRadius: 10, background: "#000", touchAction: "none", cursor: "grab", userSelect: "none" }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y }; }}
          onPointerMove={(e) => { if (drag.current) setPos(clamp({ x: drag.current.px + e.clientX - drag.current.sx, y: drag.current.py + e.clientY - drag.current.sy })); }}
          onPointerUp={() => { drag.current = null; }}
          onWheel={(e) => changeZoom(zoom - e.deltaY * 0.002)}
        >
          <img
            ref={imgRef} src={src} alt="" draggable={false}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={nat ? {
              position: "absolute", left: "50%", top: "50%", width: nat.w, height: nat.h, maxWidth: "none",
              transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transformOrigin: "center", pointerEvents: "none",
            } : { display: "none" }}
          />
          {/* เส้นกริด 3x3 ช่วยจัดองค์ประกอบ */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", border: "2px solid rgba(255,255,255,0.8)", borderRadius: 10,
            backgroundImage: "linear-gradient(to right, transparent 33%, rgba(255,255,255,.35) 33%, rgba(255,255,255,.35) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.35) 66%, rgba(255,255,255,.35) calc(66% + 1px), transparent calc(66% + 1px)), linear-gradient(to bottom, transparent 33%, rgba(255,255,255,.35) 33%, rgba(255,255,255,.35) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.35) 66%, rgba(255,255,255,.35) calc(66% + 1px), transparent calc(66% + 1px))" }} />
        </div>
        <div className="d-flex align-items-center gap-2 mt-3 px-2">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => changeZoom(zoom - 0.25)}><i className="fas fa-minus" /></button>
          <input type="range" className="form-range flex-grow-1" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => changeZoom(Number(e.target.value))} />
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => changeZoom(zoom + 0.25)}><i className="fas fa-plus" /></button>
          <button type="button" className="btn btn-sm btn-outline-secondary" title="รีเซ็ต" onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }); }}><i className="fas fa-rotate-left" /></button>
        </div>
        <div className="d-flex gap-2 justify-content-end mt-3">
          <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>ยกเลิก</button>
          {onSkip && <button type="button" className="btn btn-outline-secondary" onClick={onSkip}>ใช้รูปเดิม</button>}
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={!nat}><i className="fas fa-check me-1" />ใช้รูปนี้</button>
        </div>
      </div>
    </div>
  );
}
