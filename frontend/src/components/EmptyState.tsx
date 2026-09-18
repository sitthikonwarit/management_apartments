// ── สถานะ "ไม่พบข้อมูล/ยังไม่มีข้อมูล" กลาง — ใช้หน้าตาเดียวกันทุกหน้า (ไอคอนจาง + ข้อความ) แทนที่แต่ละ
// หน้าเคยเขียนข้อความเปล่าๆ กันเองแบบไม่ตรงกัน (บางหน้ามีไอคอน บางหน้าไม่มี) ต้นแบบมาจากหน้าจดมิเตอร์
// (MetersPage.tsx) ที่ใช้ .file-view-empty + ไอคอนจางๆ ด้านบนข้อความอยู่แล้ว
export default function EmptyState({ icon, text, compact }: { icon: string; text: string; compact?: boolean }) {
  return (
    <div className="file-view-empty" style={{ padding: compact ? "1.5rem" : "3rem", textAlign: "center" }}>
      <i className={`fas ${icon} fa-2x mb-3 d-block opacity-25`} />
      {text}
    </div>
  );
}
