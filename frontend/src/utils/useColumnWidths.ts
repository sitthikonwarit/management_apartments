import { useState } from "react";

const PREFIX = "colWidths:";

// เก็บความกว้างคอลัมน์ที่ผู้ใช้ปรับเองไว้ใน localStorage ต่อตาราง (ต่อเครื่อง)
// ตารางที่ table-layout: fixed ต้องมีความกว้างเริ่มต้น (defaults) ของทุกคอลัมน์เสมอ
// ไม่งั้นคอลัมน์ที่ยังไม่เคยปรับจะแบ่งพื้นที่เท่าๆ กันแทนที่จะตามสัดส่วนเนื้อหาเดิม
export function useColumnWidths(storageKey: string, defaults: Record<string, number>) {
  const lsKey = PREFIX + storageKey;
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
