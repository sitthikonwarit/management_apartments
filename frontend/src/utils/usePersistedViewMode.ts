import { useState } from "react";

const PREFIX = "viewMode:";

// เก็บโหมดการแสดงผล (list/grid/table ฯลฯ) ไว้ใน localStorage ตาม key ของแต่ละหน้า
// เพื่อให้สลับหน้าไปมาแล้วโหมดที่เลือกไว้ยังคงเดิม ไม่รีเซ็ตกลับเป็นค่าเริ่มต้น
export function usePersistedViewMode<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[]
): [T, (v: T) => void] {
  const storageKey = PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved && (allowed as readonly string[]).includes(saved) ? (saved as T) : initial;
    } catch {
      return initial;
    }
  });

  function setPersisted(v: T) {
    setValue(v);
    try { localStorage.setItem(storageKey, v); } catch {}
  }

  return [value, setPersisted];
}
