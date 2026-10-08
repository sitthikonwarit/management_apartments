import { useEffect, useState } from "react";
import { useUserScope } from "./useColumnWidths";

// เมนูด้านข้างที่ผู้ใช้เลือกซ่อน เก็บใน localStorage ต่อผู้ใช้ต่อเครื่อง (key เดียวกับ pref อื่น: pref:<key>:<userId>)
// ใช้ event ภายในหน้าต่างเพื่อให้ Sidebar กับหน้า Settings อัปเดตตรงกันทันที
const EVT = "hidden-menus-changed";

export function useHiddenMenus(): [string[], (next: string[]) => void] {
  const scope = useUserScope();
  const lsKey = `pref:hiddenMenus:${scope}`;
  const read = (): string[] => {
    try { const v = JSON.parse(localStorage.getItem(lsKey) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const [hidden, setHidden] = useState<string[]>(read);

  useEffect(() => {
    setHidden(read());
    const on = () => setHidden(read());
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener("storage", on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey]);

  function save(next: string[]) {
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {}
    setHidden(next);
    window.dispatchEvent(new Event(EVT));
  }
  return [hidden, save];
}
