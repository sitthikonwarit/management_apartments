import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

const WIDTHS_PREFIX = "colWidths:";
const VISIBILITY_PREFIX = "colVisible:";
const ROW_ORDER_PREFIX = "rowOrder:";

// ── เก็บความกว้าง/การซ่อน-แสดงคอลัมน์ที่ผู้ใช้ปรับเองไว้ใน localStorage "ต่อผู้ใช้ต่อเครื่อง" (ใส่ user id
// ต่อท้าย key เสมอ) — ไม่งั้นถ้าใช้เครื่องเดียวกันหลายคน (สลับบัญชีพนักงาน) การปรับของคนหนึ่งจะไปทับ/ปนกับ
// อีกคนโดยไม่ตั้งใจ คนที่ยังไม่ได้ล็อกอิน (user เป็น null ตอนโหลดหน้าแรกๆ) ใช้ scope "anon" ไปพลางก่อน
export function useUserScope(): string {
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

// ── เก็บว่าคอลัมน์ไหนเปิด/ปิดอยู่ (ติ๊กในดรอปดาวน์ "แสดง N / M คอลัมน์") + ปักหมุดซ้าย/ขวาไว้ตรงไหน ต่อผู้ใช้
// ต่อเครื่องเหมือนกัน — รับ "นิยามคอลัมน์เริ่มต้น" (มี key/visible/pin ค่าเริ่มต้นติดมากับตัว col def อยู่แล้ว)
// แล้วคืน state รายการคอลัมน์ที่ overlay ค่า visible/pin จาก localStorage ทับค่าเริ่มต้น + setCols ที่ persist
// ให้เองทุกครั้งที่เรียก (ใช้ร่วมกันทั้งตอนติ๊กเปิด/ปิดคอลัมน์ และตอนกดปักหมุดจากเมนู PinMenuPopup)
type StoredColState = { visible: boolean; pin?: unknown };
export function useColumnVisibility<T extends { key: string; visible: boolean; pin?: unknown }>(
  storageKey: string,
  defaultCols: T[]
) {
  const scope = useUserScope();
  const lsKey = `${VISIBILITY_PREFIX}${storageKey}:${scope}`;

  function applyStored(base: T[]): T[] {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return base;
      // ค่าเก่าก่อนรองรับปักหมุด เก็บเป็น boolean ล้วน (แค่ visible) — ยังอ่านเข้ากันได้อยู่ ไม่ต้อง migrate
      const stored: Record<string, boolean | StoredColState> = JSON.parse(raw);
      const withOverrides = base.map((c) => {
        const s = stored[c.key];
        if (s === undefined) return c;
        if (typeof s === "boolean") return { ...c, visible: s };
        return { ...c, visible: s.visible ?? c.visible, pin: s.pin !== undefined ? s.pin : c.pin };
      });
      // จัดลำดับคอลัมน์ตามลำดับ key ที่เคยบันทึกไว้ — persist() เขียน object ตามลำดับ array ตอนนั้นเสมอ พอ
      // JSON.stringify/parse ของ object ที่ key เป็น string ธรรมดา (ไม่ใช่ตัวเลข) ลำดับ key จะถูกรักษาไว้เป๊ะ
      // จึงยืมลำดับ key ของ map เดิมมาใช้เป็น "ลำดับคอลัมน์ที่ลากจัดไว้" ได้เลย ไม่ต้องเก็บ field แยกต่างหาก
      // คอลัมน์ใหม่ที่ยังไม่เคยอยู่ใน map (เพิ่งเพิ่มเข้ามาทีหลังในโค้ด) ต่อท้ายตามลำดับเดิมของมันเอง
      const storedKeys = Object.keys(stored);
      const byKey = new Map(withOverrides.map((c) => [c.key, c]));
      const result: T[] = [];
      storedKeys.forEach((k) => { const c = byKey.get(k); if (c) { result.push(c); byKey.delete(k); } });
      withOverrides.forEach((c) => { if (byKey.has(c.key)) result.push(c); });
      return result;
    } catch {
      return base;
    }
  }

  const [cols, setColsState] = useState<T[]>(() => applyStored(defaultCols));

  function persist(next: T[]) {
    try {
      const map: Record<string, StoredColState> = {};
      next.forEach((c) => { map[c.key] = { visible: c.visible, pin: c.pin }; });
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

  // ลากหัวคอลัมน์ (th) เพื่อสลับตำแหน่งคอลัมน์ — draggedKey ไปแทนที่ตำแหน่งของ targetKey ใน array ดิบ
  // (ก่อนแบ่งกลุ่มซ้าย/ไม่ปักหมุด/ขวา) แต่ละหน้ายังคงแบ่งกลุ่มตาม pin เหมือนเดิมตอน render ดังนั้นลากข้ามกลุ่ม
  // ปักหมุดจะแค่เปลี่ยนตำแหน่งภายในกลุ่มเดิมของมันเอง ไม่ได้ย้ายข้ามไปปักหมุดใหม่ให้ (ต้องกดปักหมุดแยกต่างหาก)
  function moveColumn(draggedKey: string, targetKey: string) {
    if (draggedKey === targetKey) return;
    setCols((prev) => {
      const from = prev.findIndex((c) => c.key === draggedKey);
      const to = prev.findIndex((c) => c.key === targetKey);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return [cols, setCols, moveColumn] as const;
}

// ── ลากสลับลำดับแถวในตาราง — จำลำดับที่ลากไว้ต่อผู้ใช้ต่อเครื่องเหมือนความกว้าง/การซ่อนคอลัมน์ (เก็บแค่
// "ลำดับ id" ใน localStorage ไม่แก้ลำดับจริงในฐานข้อมูล จึงไม่กระทบคนอื่นที่ดูตารางเดียวกัน) รับรายการข้อมูล
// ดิบ (ตามลำดับที่ backend ส่งมา) + ฟังก์ชันดึง key เฉพาะของแต่ละแถว แล้วคืนรายการที่เรียงตามลำดับที่บันทึกไว้
// (รายการใหม่ที่ยังไม่เคยลากจัดลำดับ จะต่อท้ายตามลำดับเดิมของมันเสมอ ไม่ได้หายไปไหน)
//
// bypass (ค่าเริ่มต้น false): ตั้งเป็น true ตอนหน้ากำลังค้นหา/กรองข้อมูลอยู่ (เช่น พิมพ์ในช่องค้นหา หรือติ๊ก
// ตัวกรองสถานะ) — ลำดับที่ลากไว้เอาไปใช้กับ "ทุกแถวแบบไม่กรอง" เท่านั้น ถ้าเอาไปใช้กับชุดข้อมูลที่ถูกกรอง
// เหลือแค่บางส่วน ตำแหน่งจะสับสน (ตำแหน่งที่ 3 หมายถึงคนละแถวกันระหว่างตอนกรอง/ไม่กรอง) ผลคือดูเหมือน
// "ตัวกรองใช้ไม่ได้" เพราะลำดับเพี้ยนไปจากที่ควรจะกรองได้ — ตอน bypass=true จะคืนรายการตามลำดับเดิมจาก
// backend ตรงๆ (ไม่จัดเรียงตาม order ที่บันทึกไว้) ทันทีที่เลิกกรอง (bypass=false) จะกลับไปใช้ลำดับที่ลากไว้เหมือนเดิม
export function useRowOrder<T>(storageKey: string, items: T[], getKey: (item: T) => string, bypass = false) {
  const scope = useUserScope();
  const lsKey = `${ROW_ORDER_PREFIX}${storageKey}:${scope}`;
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const ordered = useMemo(() => {
    if (bypass || order.length === 0) return items;
    const byKey = new Map(items.map((it) => [getKey(it), it]));
    const result: T[] = [];
    order.forEach((k) => {
      const it = byKey.get(k);
      if (it) { result.push(it); byKey.delete(k); }
    });
    // รายการที่เหลือ (ใหม่/ไม่เคยอยู่ในลำดับที่บันทึกไว้) ต่อท้ายตามลำดับเดิมของมันเอง
    items.forEach((it) => { if (byKey.has(getKey(it))) result.push(it); });
    return result;
  }, [items, order, bypass]);

  function persist(next: string[]) {
    setOrder(next);
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
  }

  // ลากแถว draggedKey ไปวางที่ตำแหน่งของแถว targetKey — อ้างอิงจากลำดับที่แสดงผลอยู่ปัจจุบัน (ordered)
  // ไม่ใช่ลำดับดิบจาก backend เพื่อให้ตรงกับที่ผู้ใช้เห็นบนจอจริงๆ
  function moveRow(draggedKey: string, targetKey: string) {
    if (draggedKey === targetKey) return;
    const keys = ordered.map(getKey);
    const from = keys.indexOf(draggedKey);
    const to = keys.indexOf(targetKey);
    if (from === -1 || to === -1) return;
    const next = [...keys];
    next.splice(from, 1);
    next.splice(to, 0, draggedKey);
    persist(next);
  }

  function resetRowOrder() {
    persist([]);
  }

  return { ordered, moveRow, resetRowOrder };
}

const PERSISTED_PREFIX = "pref:";

// ── เก็บค่าที่ผู้ใช้ตั้งไว้ (ไม่ใช่คอลัมน์ตาราง/ลำดับแถวโดยตรง) "ต่อผู้ใช้ต่อเครื่อง" เหมือนฮุคด้านบน —
// ใช้กับค่าตั้งค่าทั่วไปที่อยากจำไว้ข้ามเซสชัน เช่น checkbox คอลัมน์ในป็อปอัพตั้งค่าการพิมพ์ ไม่ต้องมาติ๊กใหม่
// ทุกครั้ง — serialize ผ่าน JSON.stringify เสมอ ใช้ได้กับทั้งค่าเดี่ยว (string) และโครงสร้าง (array/object)
export function usePersistedPref<T>(storageKey: string, initial: T): [T, (v: T) => void] {
  const scope = useUserScope();
  const lsKey = `${PERSISTED_PREFIX}${storageKey}:${scope}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  function setPersisted(v: T) {
    setValue(v);
    try { localStorage.setItem(lsKey, JSON.stringify(v)); } catch {}
  }

  return [value, setPersisted];
}
