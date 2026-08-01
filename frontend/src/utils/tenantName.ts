// คำนำหน้าชื่อที่มีให้เลือกเป็นค่าเริ่มต้น — ผู้ใช้พิมพ์คำอื่นเองเพิ่มได้ผ่าน CustomCreatableSelect2
export const TENANT_TITLE_OPTIONS = ["คุณ", "นาย", "นาง", "นางสาว"];

interface NamedPerson {
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

// ชื่อเต็มไม่มีคำนำหน้า เช่น "สมชาย ใจดี"
export function tenantFullName(t: NamedPerson | null | undefined): string {
  if (!t) return "";
  return `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim();
}

// ชื่อพร้อมคำนำหน้า เช่น "นาย สมชาย ใจดี" — ถ้าผู้เช่ายังไม่ได้ตั้งคำนำหน้า ใช้ "คุณ" เป็นค่าเริ่มต้น
// (พฤติกรรมเดิมของระบบก่อนมีฟีเจอร์นี้) คืนค่าว่างถ้าไม่มีชื่อเลย (เช่น ห้องว่าง)
export function tenantDisplayName(t: NamedPerson | null | undefined): string {
  const full = tenantFullName(t);
  if (!full) return "";
  const title = (t?.title || "คุณ").trim();
  return title ? `${title} ${full}` : full;
}
