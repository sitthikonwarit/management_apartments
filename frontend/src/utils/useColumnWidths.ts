import { useState } from "react";
import { useAuth } from "../context/AuthContext";

const WIDTHS_PREFIX = "colWidths:";
const VISIBILITY_PREFIX = "colVisible:";

// ── เก็บความกว้าง/การซ่อน-แสดงคอลัมน์ที่ผู้ใช้ปรับเองไว้ใน localStorage "ต่อผู้ใช้ต่อเครื่อง" (ใส่ user id
// ต่อท้าย key เสมอ) — ไม่งั้นถ้าใช้เครื่องเดียวกันหลายคน (สลับบัญชีพนักงาน) การปรับของคนหนึ่งจะไปทับ/ปนกับ
// อีกคนโดยไม่ตั้งใจ คนที่ยังไม่ได้ล็อกอิน (user เป็น null ตอนโหลดหน้าแรกๆ) ใช้ scope "anon" ไปพลางก่อน
function useUserScope(): string {
  const { user } = useAuth();
  return user?.id || "anon";
}

// ตารางที่ table-layout: fixed ต้องมีความกว้างเริ่มต้น (defaults) ของทุกคอลัมน์เสมอ
// ไม่งั้นคอลัมน์ที่ยังไม่เคยปรับจะแบ่งพื้นที่เท่าๆ กันแทนที่จะตามสัดส่วนเนื้อหาเดิม
export function useColumnWidths(storageKey: string, defaults: Record<string, number>) {
  const scope = useUserScope();
  const lsKey = `${WIDTHS_PREFIX}${storageKey}:${scope}`;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
    } catch {
      return { ...defaults };
    }
  });

  function persist(updater: (prev: Record<string, number>) => Record<string, number>) {
    setWidths((prev) => {
      const next = updater(prev);
      try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // ลากขอบคอลัมน์เพื่อปรับความกว้าง — วาง onMouseDown นี้ไว้ใน handle ที่อยู่ในสุดของ <th>
  function startResize(colKey: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest("th");
    if (!th) return;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    document.body.classList.add("col-resizing");

    function onMove(ev: MouseEvent) {
      const w = Math.max(50, Math.round(startWidth + (ev.clientX - startX)));
      (th as HTMLElement).style.width = `${w}px`;
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
      const finalWidth = Math.round((th as HTMLElement).getBoundingClientRect().width);
      persist((prev) => ({ ...prev, [colKey]: finalWidth }));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function resetWidths() {
    persist(() => ({ ...defaults }));
  }

  return { widths, startResize, resetWidths };
}

// ── เก็บว่าคอลัมน์ไหนเปิด/ปิดอยู่ (ติ๊กในดรอปดาวน์ "แสดง N / M คอลัมน์") ต่อผู้ใช้ต่อเครื่องเหมือนกัน
// รับ "นิยามคอลัมน์เริ่มต้น" (มี key/visible ค่าเริ่มต้นติดมากับตัว col def อยู่แล้ว) แล้วคืน state
// รายการคอลัมน์ที่ overlay ค่า visible จาก localStorage ทับค่าเริ่มต้น + ฟังก์ชันสลับเปิด/ปิดที่ persist ให้เอง
export function useColumnVisibility<T extends { key: string; visible: boolean }>(
  storageKey: string,
  defaultCols: T[]
) {
  const scope = useUserScope();
  const lsKey = `${VISIBILITY_PREFIX}${storageKey}:${scope}`;

  function applyStored(base: T[]): T[] {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return base;
      const stored: Record<string, boolean> = JSON.parse(raw);
      return base.map((c) => (c.key in stored ? { ...c, visible: stored[c.key] } : c));
    } catch {
      return base;
    }
  }

  const [cols, setColsState] = useState<T[]>(() => applyStored(defaultCols));

  function persist(next: T[]) {
    try {
      const map: Record<string, boolean> = {};
      next.forEach((c) => { map[c.key] = c.visible; });
      localStorage.setItem(lsKey, JSON.stringify(map));
    } catch {}
  }

  function setCols(updater: T[] | ((prev: T[]) => T[])) {
    setColsState((prev) => {
      const next = typeof updater === "function" ? (updater as (p: T[]) => T[])(prev) : updater;
      persist(next);
      return next;
    });
  }

  return [cols, setCols] as const;
}
