// ── สถานะสัญญาเช่าใกล้หมดอายุ/หมดอายุแล้ว ───────────────────────────────────────
// ใช้ร่วมกันทั้งหน้ารายชื่อผู้เช่า (TenantsPage.tsx, components/TenantTableView.tsx) เตือนพนักงานล่วงหน้า
// ก่อนสัญญาหมด จะได้ติดต่อผู้เช่าต่อสัญญา/แจ้งย้ายออกทันเวลา ไม่ใช่มารู้ตัวหลังหมดสัญญาไปแล้ว
export const CONTRACT_WARNING_DAYS = 30;

export interface ContractStatus { kind: "expired" | "soon"; days: number }

// contractEndDate เก็บเป็น "YYYY-MM-DD" (ค.ศ.) เสมอในฐานข้อมูล ไม่ว่าหน้าตั้งค่าจะเลือกแสดงผล พ.ศ./ค.ศ.
// ก็ตาม (ดูคอมเมนต์ที่ ThaiDatePicker.tsx) จึง new Date(...) ตรงๆ ได้เลยไม่ต้องแปลงปี
export function getContractStatus(contractEndDate: string | undefined | null): ContractStatus | null {
  if (!contractEndDate) return null;
  const end = new Date(contractEndDate);
  if (isNaN(end.getTime())) return null;
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { kind: "expired", days };
  if (days <= CONTRACT_WARNING_DAYS) return { kind: "soon", days };
  return null;
}
