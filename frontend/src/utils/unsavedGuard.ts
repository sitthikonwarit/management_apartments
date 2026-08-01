// กลไกกลางสำหรับดักการออกจากหน้าที่มีการแก้ไขค้างอยู่ยังไม่ได้บันทึก (เช่น หน้าจัดการใบแจ้งหนี้)
// ใช้เป็น singleton เดี่ยว ไม่ใช่ React context เพราะ Sidebar กับหน้าที่ถือ state "dirty" อยู่คนละ component
// กัน ไม่ได้อยู่ใน tree เดียวกันโดยตรง แค่ต้องคุยกันตอนคลิกเมนู/กดปุ่มย้อนกลับของเบราว์เซอร์เท่านั้น
type ConfirmHandler = (onLeave: () => void) => void;

let dirty = false;
let confirmHandler: ConfirmHandler | null = null;

// หน้าที่มีการแก้ไขเรียกอันนี้ทุกครั้งที่ dirty เปลี่ยน พร้อมฟังก์ชันที่จะโชว์ dialog ยืนยันของหน้านั้นเอง
export function setUnsavedGuard(isDirty: boolean, handler?: ConfirmHandler) {
  dirty = isDirty;
  confirmHandler = isDirty ? (handler ?? null) : null;
}

export function clearUnsavedGuard() {
  dirty = false;
  confirmHandler = null;
}

export function isUnsavedGuardDirty() {
  return dirty;
}

// เรียกก่อนจะนำทางออกจากหน้าปัจจุบัน (เช่น คลิกเมนู sidebar) — คืนค่า true = ไปได้เลยทันที (ไม่มีอะไรค้าง)
// false = ถูกดักไว้แล้ว หน้าที่ลงทะเบียน handler ไว้จะโชว์ dialog เอง แล้วเรียก onLeave ให้เองถ้าผู้ใช้ยืนยันออก
export function guardNavigation(onLeave: () => void): boolean {
  if (!dirty) return true;
  if (confirmHandler) {
    confirmHandler(onLeave);
    return false;
  }
  return true;
}
