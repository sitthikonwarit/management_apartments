import { useEffect } from "react";

// ── เมนูปักหมุดคอลัมน์ (ซ้าย/ขวา/เลิกปักหมุด) ที่ใช้ร่วมกันทุกตารางในระบบ (บิล/ผู้เช่า/ห้องพัก/ยานพาหนะ/
// จดมิเตอร์) — เดิมแต่ละหน้าก๊อปโค้ดเดียวกันนี้แยกกันเอง ทำให้หน้าตา/ข้อความเพี้ยนกันไปทีละหน้าได้ง่าย
// (เช่น บางหน้าเคยใช้ไอคอนลูกศรแทนหมุด ไม่มีบอกว่าอันไหนปักอยู่) รวมเป็น component เดียวตรงนี้แทน
export type PinDir = "left" | "right" | false;
export interface PinMenuState {
  colKey: string;
  x: number;
  y: number;
}

export default function PinMenuPopup({ menu, cols, onPin, onClose }: {
  menu: PinMenuState;
  cols: { key: string; pin: PinDir }[];
  onPin: (key: string, dir: PinDir) => void;
  onClose: () => void;
}) {
  const col = cols.find((c) => c.key === menu.colKey);
  const cur = col?.pin ?? false;

  useEffect(() => {
    const close = () => onClose();
    setTimeout(() => window.addEventListener("click", close), 0);
    return () => window.removeEventListener("click", close);
  }, []);

  return (
    <ul className="pinning-menu" style={{ position: "fixed", top: menu.y, left: menu.x }} onClick={(e) => e.stopPropagation()}>
      {cur && (
        <li className="disabled">
          <i className="fas fa-thumbtack" />
          {cur === "left" ? "ปักหมุดซ้าย (ใช้อยู่)" : "ปักหมุดขวา (ใช้อยู่)"}
        </li>
      )}
      {cur !== "left" && (
        <li onClick={() => { onPin(menu.colKey, "left"); onClose(); }}>
          <i className="fas fa-thumbtack" style={{ color: "var(--color-primary)" }} />ปักหมุดซ้าย
        </li>
      )}
      {cur !== "right" && (
        <li onClick={() => { onPin(menu.colKey, "right"); onClose(); }}>
          <i className="fas fa-thumbtack" style={{ color: "var(--color-danger)" }} />ปักหมุดขวา
        </li>
      )}
      {cur && (
        <li onClick={() => { onPin(menu.colKey, false); onClose(); }}>
          <i className="fas fa-times" />เลิกปักหมุด
        </li>
      )}
    </ul>
  );
}
