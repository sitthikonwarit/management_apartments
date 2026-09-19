export type YearFormat = "BE" | "CE";

const BE_OFFSET = 543;

// ค่ากลาง (global) เก็บรูปแบบปีที่ผู้ใช้เลือกไว้ในหน้าตั้งค่า ให้ helper ต่างๆ ในไฟล์อื่น
// (หลายไฟล์เป็นฟังก์ชัน/คอมโพเนนต์แยกที่ไม่ได้รับ config เป็น prop) อ่านได้โดยตรง
// โดยไม่ต้องส่ง config ผ่านทุกชั้น — ถูกซิงก์แบบ synchronous ใน AppConfigProvider ทุกครั้งที่ render
// เพื่อไม่ให้ค่านี้ค้าง (stale) ตอนสลับการตั้งค่า
let current: YearFormat = "BE";

export function setGlobalYearFormat(f: YearFormat) {
  current = f;
}

export function getGlobalYearFormat(): YearFormat {
  return current;
}

// แปลงปีจาก "ฐานเดิมของค่านั้น" (from) ให้เป็นปีที่ควรแสดงผลตามการตั้งค่าปัจจุบัน
export function toDisplayYear(year: number, from: YearFormat): number {
  if (from === current) return year;
  return from === "BE" ? year - BE_OFFSET : year + BE_OFFSET;
}

// ปีที่รับมาอาจเป็น พ.ศ. (ข้อมูลเก่า/ผู้ใช้พิมพ์เข้ามาเอง เช่นตอน import CSV) — normalize ให้เป็น
// ค.ศ. เสมอก่อนใช้งานภายใน (internal storage/keying ของระบบยึด ค.ศ. เป็นหลักเสมอ)
export function normalizeYearToCE(year: number): number {
  return year > 2400 ? year - BE_OFFSET : year;
}

function thaiLocale(): string {
  return current === "CE" ? "th-TH-u-ca-gregory" : "th-TH";
}

export function thaiDateTimeString(d: Date): string {
  return d.toLocaleString(thaiLocale());
}

export function thaiDateOnlyString(d: Date): string {
  return d.toLocaleDateString(thaiLocale());
}

const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

// วันที่เต็ม "D เดือนไทย ปี" (เช่น "2 มีนาคม 2569") ต่างจาก thaiDateOnlyString ด้านบนที่ได้ตัวเลขล้วน
// (เช่น "2/3/2569") — ใช้บนเอกสารพิมพ์ที่อยากให้อ่านง่ายเป็นทางการ (เช่น BillSlipPretty ใน BillsPage.tsx)
export function thaiFullDateString(d: Date): string {
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${toDisplayYear(d.getFullYear(), "CE")}`;
}

// checkInDate ของผู้เช่า: ปัจจุบัน backend เก็บเป็น ISO (ค.ศ.) เหมือน contract date แต่ข้อมูลเก่าที่
// import จาก Google Sheets เก็บเป็น "D/M/YYYY" หรือ "D/M/YYYY, H:MM:SS" (ปีเป็น ค.ศ. อยู่แล้ว) — รองรับ
// ทั้งคู่ แปลงปีตามที่ตั้งค่าไว้ (พ.ศ./ค.ศ.) แค่ตอนแสดงผล ฟอร์แมตที่ parse ไม่ได้จะโชว์ข้อความเดิมแทนการเดาให้ผิด
export function formatCheckInDate(str: string): string {
  if (!str) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-").map((n) => parseInt(n, 10));
    return `${d} ${THAI_MONTHS[m - 1]} ${toDisplayYear(y, "CE")}`;
  }
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*\d{1,2}:\d{2}:\d{2})?$/);
  if (m1) {
    const d = parseInt(m1[1], 10), mo = parseInt(m1[2], 10), y = normalizeYearToCE(parseInt(m1[3], 10));
    if (mo >= 1 && mo <= 12) return `${d} ${THAI_MONTHS[mo - 1]} ${toDisplayYear(y, "CE")}`;
  }
  return str;
}
