import type { CSSProperties } from "react";

// พารามิเตอร์ครอปเก็บเป็นข้อความ "x% y% zoom" (เช่น "40% 30% 1.8") ไม่แก้ไฟล์รูปจริง
export interface CropParams { x: number; y: number; zoom: number }

export function parseCrop(s?: string | null): CropParams {
  const [a, b, c] = (s || "").trim().split(/\s+/).map((t) => parseFloat(t));
  const num = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  return {
    x: Math.min(100, Math.max(0, num(a, 50))),
    y: Math.min(100, Math.max(0, num(b, 50))),
    zoom: Math.min(4, Math.max(1, num(c, 1))),
  };
}

export function formatCrop(p: CropParams): string {
  return `${Math.round(p.x * 10) / 10}% ${Math.round(p.y * 10) / 10}% ${Math.round(p.zoom * 100) / 100}`;
}

// สไตล์ของ <img> ที่ใส่ในกรอบ overflow:hidden (กรอบต้อง overflow hidden)
export function cropImgStyle(s?: string | null): CSSProperties {
  const p = parseCrop(s);
  const pos = `${p.x}% ${p.y}%`;
  return {
    width: "100%", height: "100%", objectFit: "cover", objectPosition: pos,
    transformOrigin: pos, transform: p.zoom > 1 ? `scale(${p.zoom})` : undefined,
  };
}
