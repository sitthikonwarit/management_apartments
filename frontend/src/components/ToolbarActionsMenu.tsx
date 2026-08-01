import { useEffect, useRef, useState, type ReactNode } from "react";

interface ToolbarActionsMenuProps {
  children: ReactNode;
}

// รวมปุ่ม Export/Import/จัดการแท็ก/เพิ่ม... ของแถบเครื่องมือหน้ารายการ (ผู้เช่า/ห้องพัก/มิเตอร์/
// ยานพาหนะ) เป็นปุ่มเครื่องมือลอย (FAB) มุมขวาล่างตอนจอมือถือ (ดู @media max-width:576px ใน
// App.css) กดแล้วปุ่มต่างๆ กระจายขึ้นมาเรียงซ้อนเหนือปุ่มพร้อมอนิเมชัน fade+scale ไล่ทีละปุ่ม
// บนจอเดสก์ท็อปแสดงปุ่มเรียงแถวตามปกติเหมือนเดิม (FAB ถูกซ่อนไว้)
export default function ToolbarActionsMenu({ children }: ToolbarActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className={`page-list-toolbar-actions-wrap${open ? " open" : ""}`} ref={wrapRef}>
      {open && <div className="tool-fab-backdrop" onClick={() => setOpen(false)} />}
      <div className="d-flex align-items-center flex-wrap gap-2 page-list-toolbar-actions" onClick={() => setOpen(false)}>
        {children}
      </div>
      <button type="button" className="tool-fab" onClick={() => setOpen((v) => !v)} title="เมนูเครื่องมือ">
        <i className="fas fa-plus" />
      </button>
    </div>
  );
}
