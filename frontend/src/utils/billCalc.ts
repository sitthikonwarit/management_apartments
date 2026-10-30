import type { AppConfig } from "../context/AppConfigContext";
import { toDisplayYear, normalizeYearToCE } from "./yearFormat";
import { tenantOccupiesRoom } from "./tenantRoom";
import { calcTariff, normalizeTariff, describeTariff, type Tariff } from "./tariff";
export { calcTariff, normalizeTariff, type Tariff };

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BillTagItem { id: string; name: string; price: number; color?: string; icon?: string }
export interface BillVehicleItem { id: string; plate: string; name: string; price: number }
export interface BillLineItem { id: string; name: string; price: number }
// fineAmount = ค่าปรับล่าช้าปัจจุบันของบิลเดือนนั้น (หลังหักค่าปรับที่เคยยกเว้นไปก่อนแล้วถ้ามี) — ไว้ให้ป็อปอัพ
// บันทึกการชำระเงินรู้ว่ายกเว้นค่าปรับของเดือนนี้เพิ่มได้อีกไม่เกินเท่าไหร่ (ดู PaymentModal ใน BillsPage.tsx)
export interface OutstandingItem { monthYear: string; amount: number; fineAmount: number }
export interface BillSendLog { timestamp: string; method: "manual" | "auto"; by?: string; status: "success" | "error"; detail: string }

export interface BillItem {
  customBillId: string;
  roomId: string;
  roomNumber: string;
  tenantId: string | null;
  tenantName: string;
  tenantTitle: string; // คำนำหน้าชื่อผู้เช่า (คุณ/นาย/นาง/นางสาว/...) ใช้แทนคำว่า "คุณ" ที่เคย hardcode ไว้บนบิล
  // จำนวนคนที่ร่วมพักอาศัยจริง ณ ตอนออกบิล (ผู้เช่าหลัก + ผู้ร่วมพักอาศัย) — ใช้แสดงส่วนแบ่งต่อคนของ
  // ยอดชำระสุทธิทั้งบิลเท่านั้น ไม่กระทบยอดเรียกเก็บจริง และถูกแช่แข็งไว้กับบิลแต่ละใบเหมือนฟิลด์อื่นๆ ไม่ตามจำนวนคนปัจจุบัน
  residentCount: number;
  priceRoom: number;
  waterRate: number;
  electricRate: number;
  waterFormula: string;
  electricFormula: string;
  waterActive: boolean;
  electricActive: boolean;
  meterWater: { prev: number; curr: number; unit: number };
  meterElectric: { prev: number; curr: number; unit: number };
  priceWater: number;
  priceElectric: number;
  // ค่าบริการต่อหน่วย (ส่วนเพิ่มจากค่าน้ำ/ค่าไฟฐาน) ที่ถูกรวมไว้ใน priceWater/priceElectric ด้านบนแล้วเสมอ
  // (ไม่กระทบยอดรวม) แยกเก็บไว้ต่างหากแค่ให้หน้ารายละเอียดบิลรู้ว่าต้องหักออกมาแสดงเป็นบรรทัดแยกหรือไม่ ตาม
  // serviceFeeConfig.displayMode ด้านล่าง — ดู recalcItem
  waterServiceFee: number;
  electricServiceFee: number;
  priceVehicle: number;
  billVehicleItems: BillVehicleItem[];
  billTagItems: BillTagItem[];
  billTenantTagItems: BillTagItem[];
  customItems: BillLineItem[];
  discountItems: BillLineItem[];
  outstandingAmount: number;
  outstandingItems: OutstandingItem[];
  fineAmount: number;
  // ยอดค่าปรับล่าช้าที่ยกเว้น/ปรับลดให้สะสม (หักออกจากค่าปรับที่คำนวณอัตโนมัติใน calculateOverdueFine เสมอ)
  // — ตั้งผ่านป็อปอัพบันทึกการชำระเงิน เพื่อลดหย่อนค่าปรับให้ผู้เช่าเป็นกรณีๆ ไป โดยไม่กระทบค่าเริ่มต้นของระบบ
  fineWaived: number;
  // ตั้งค่าปรับล่าช้า "เฉพาะบิลใบนี้" ทับกติกากลาง (หน้า Settings) / กติกาต่อผู้เช่า — ตั้งจากหน้ารายละเอียดบิล
  //   undefined หรือ mode "auto" = คิดค่าปรับอัตโนมัติตามกติกาปกติ
  //   "off"    = ไม่คิดค่าปรับล่าช้าสำหรับบิลใบนี้ (ยังโชว์ป้าย "เกินกำหนด" ตามจริง แต่ยอดค่าปรับ = 0)
  //   "manual" = กรอกจำนวนเงินค่าปรับเอง (ไม่สนวันครบกำหนด/อัตราต่อวัน) ยังหัก fineWaived ต่อได้ตามปกติ
  fineOverride?: { mode: "auto" | "off" | "manual"; amount: number };
  isOverdue: boolean;
  overdueDays: number;
  total: number;
  // ยอดรวมสุทธิ "ตอนสร้างบิลครั้งแรก" แช่แข็งไว้ถาวร ไม่ขยับตามการหักค่าปรับ/เพิ่มส่วนลดภายหลัง (ตอนบันทึกการ
  // ชำระเงิน) ต่างจาก total ด้านบนที่เป็นยอดปัจจุบันหลังปรับแล้ว — ใช้โชว์เป็นยอดค้างชำระ/ยอดเรียกเก็บแบบตายตัว
  // ในแดชบอร์ดสรุปยอดของหน้ารายการบิล (ดู recalcItem: ล็อกด้วยรูปแบบ ?? เหมือน waterDefaultFormula ด้านล่าง)
  // undefined = บิลเก่าก่อนมีระบบนี้ (จะถูก backfill ด้วยค่า total ปัจจุบันครั้งแรกที่เปิด แล้วล็อกไว้ตั้งแต่นั้น)
  originalTotal?: number;
  // ผู้เช่าทดสอบ (ตั้งที่หน้าแก้ไขผู้เช่า) — โชว์ในตารางบิลตามปกติแต่ไม่นับรวมใน Dashboard/ผลประกอบการ/ภาษี
  isTest?: boolean;
  status: "unpaid" | "paid";
  // ยอดที่รับชำระสะสมแล้วสำหรับบิลนี้ (รองรับจ่ายไม่ครบยอด/จ่ายเป็นงวด) — ยอดคงเหลือที่ต้องชำระ = total - paidAmount
  // เมื่อ paidAmount >= total ถือว่าจ่ายครบ (status เปลี่ยนเป็น paid) ส่วนที่ยังขาดจะค้างไว้ให้จ่ายในครั้งถัดไป
  paidAmount: number;
  // ค่า "สแนปช็อต" ของสูตรพื้นฐาน/กติกาค่าปรับ ณ ตอนสร้าง(หรือเปิดแก้ไขครั้งแรก)บิลนี้
  // เพื่อล็อกยอดบิลเก่าไว้ไม่ให้เปลี่ยนตามภายหลัง แม้จะไปแก้ "ค่าเริ่มต้น" ในหน้าตั้งค่าก็ตาม
  // undefined = บิลเก่าก่อนมีระบบนี้ (จะถูก backfill ด้วยค่าปัจจุบันครั้งแรกที่เปิด แล้วล็อกไว้ตั้งแต่นั้น)
  waterDefaultFormula?: string;
  electricDefaultFormula?: string;
  overdueConfig?: AppConfig["overdue"];
  serviceFeeConfig?: AppConfig["serviceFee"];
  // อัตราน้ำ/ไฟแบบก้าวหน้าตามจริง ที่ล็อกไว้กับบิล (แก้เฉพาะบิลนี้ได้ ไม่ตามการแก้ Settings ภายหลัง)
  waterTariff?: Tariff;
  electricTariff?: Tariff;
  // ── ปัดเศษยอดบิลลง (ก่อนถึงวันครบกำหนดชำระเท่านั้น) — ล็อกไว้กับบิลเหมือน overdueConfig/serviceFeeConfig
  // ด้านบน เพื่อไม่ให้การแก้ "ค่าเริ่มต้น" ในหน้าตั้งค่าภายหลัง ย้อนไปเปลี่ยนยอดบิลเก่าที่ปิดไปแล้ว
  roundingConfig?: AppConfig["rounding"];
  // ผู้ใช้เคยลบรายการ "ปัดเศษ" (อัตโนมัติ) ออกจากรายการส่วนลดของบิลใบนี้เองหรือไม่ — ถ้าเคยลบ ห้าม
  // คำนวณแล้วเพิ่มรายการปัดเศษกลับเข้ามาใหม่อีก (ดู applyBillRounding ด้านล่าง)
  roundingDismissed?: boolean;
  // ประวัติการส่งบิลทาง LINE ของห้องนี้ (ใหม่สุดอยู่หน้าสุด) — backend เป็นคนเขียนให้ตอนส่งสำเร็จ/ไม่สำเร็จ
  sendLogs?: BillSendLog[];
}

export interface BillGroup {
  id: string | null;
  monthYear: string;
  data: BillItem[];
  createdAt?: string;
  updatedAt?: string;
  scheduledDate?: string;
}

// ── ส่วนลดพิเศษเฉพาะห้อง (ตั้งจากหน้าบิล — ดู SpecialDiscountsModal ใน BillsPage.tsx) ──────────────────────
// คิดซ้ำเข้าบิลทุกเดือนอัตโนมัติให้ทุกห้องที่เลือกไว้ จนกว่าจะถึงเดือนหลัง expiryDate (ว่าง = ไม่มีวันหมดอายุ)
export interface SpecialDiscount {
  id: string;
  name: string;
  type: "fixed" | "percent";
  value: number;
  roomIds: string[];
  expiryDate: string; // "YYYY-MM-DD" ว่าง = ไม่หมดอายุ
  startMonth?: string; // "MM/YYYY" เดือนแรกที่เริ่มใช้ — เดือนก่อนหน้านี้ไม่คิด (ว่าง = ดูจากวันที่สร้าง)
  createdAt?: string;
}

export interface GenCtx {
  rooms: any[];
  tenants: any[];
  vehicles: any[];
  roomTags: any[];
  tenantTags: any[];
  meterReadings: any[];
  formulas: any[];
  config: AppConfig;
  allBills: BillGroup[];
  specialDiscounts: SpecialDiscount[];
}

// ── Date / label helpers ──────────────────────────────────────────────────────
export const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export function padZ(n: number) { return String(n).padStart(2, "0"); }

// หมายเหตุ: monthYear ของบิลเก็บเป็นปี ค.ศ. ตรงๆ (ดูคอมเมนต์ใน BillsPage.tsx) — label นี้แปลง
// เป็นปีที่ผู้ใช้เลือกไว้ในหน้าตั้งค่า (พ.ศ./ค.ศ.) แค่ตอนแสดงผลเท่านั้น ไม่กระทบข้อมูลที่เก็บจริง
export function monthYearLabel(my: string) {
  if (!my) return "";
  const [m, y] = my.split("/");
  const yearOut = toDisplayYear(parseInt(y, 10) || 0, "CE");
  return `${THAI_MONTHS[parseInt(m, 10) - 1] ?? m} ${yearOut}`;
}

export function myScore(my: string) {
  const [m, y] = my.split("/");
  return (parseInt(y, 10) || 0) * 100 + (parseInt(m, 10) || 0);
}

export function prevMY(my: string) {
  if (!my) return "";
  const [m, y] = my.split("/");
  let mi = parseInt(m, 10) - 1, yi = parseInt(y, 10);
  if (mi <= 0) { mi = 12; yi--; }
  return `${padZ(mi)}/${yi}`;
}

// ── Numeric helpers ───────────────────────────────────────────────────────────
function numOr(v: any, fallback: number): number {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// มิเตอร์วนรอบ (เช่น เลขมิเตอร์ 5 หลัก: 99999 -> 0) — base ปรับตามจำนวนหลักที่ตั้งไว้ใน Settings
export function calcUnit(curr: number, prev: number, base = 10000): number {
  return curr >= prev ? curr - prev : (curr + base) - prev;
}

export function calculateComplexPrice(unit: number, rate: number, formulaStr: string): number {
  if (!formulaStr || !formulaStr.trim()) return unit * rate;
  try {
    const safeFormula = formulaStr.includes("return") ? formulaStr : `return ${formulaStr};`;
    // eslint-disable-next-line no-new-func
    const calcFunc = new Function("u", "r", `try { ${safeFormula} } catch(e) { return 0; }`);
    const result = calcFunc(unit, rate);
    return parseFloat(result) || 0;
  } catch {
    return unit * rate;
  }
}

export function resolveDefaultFormulas(formulas: any[]) {
  return {
    water: formulas.find((f) => f.type === "water" && f.isDefault)?.formula ?? "",
    electric: formulas.find((f) => f.type === "electric" && f.isDefault)?.formula ?? "",
  };
}

// ── Outstanding balance (ยอดค้างชำระยกมา) ─────────────────────────────────────
function sameOutstandingTenant(roomBill: BillItem, tenantId: string | null, tenantName: string): boolean {
  if (tenantId && roomBill.tenantId) return String(tenantId) === String(roomBill.tenantId);
  const oldName = (roomBill.tenantName || "").trim();
  const newName = (tenantName || "").trim();
  return !!oldName && !!newName && oldName === newName;
}

export function getOutstandingBalance(
  allBills: BillGroup[], roomId: string, monthYear: string,
  tenantId: string | null, tenantName: string
): { amount: number; items: OutstandingItem[] } {
  const currentVal = myScore(monthYear);
  let amount = 0;
  const items: OutstandingItem[] = [];
  for (const group of allBills) {
    if (myScore(group.monthYear) >= currentVal) continue;
    const roomBill = (group.data || []).find((r) => String(r.roomId) === String(roomId));
    if (!roomBill || roomBill.status === "paid") continue;
    if (!sameOutstandingTenant(roomBill, tenantId, tenantName)) continue;

    // total ของบิลเดือนนั้นๆ มักรวมยอดค้างที่ยกมาจากเดือนก่อนหน้ามันเองไว้แล้ว (ผ่าน outstandingAmount ที่ล็อก
    // ไว้ตอนสร้างบิลเดือนนั้น — ดู recalcItem/calcItemTotal) ต้องหัก outstandingAmount ของมันเองออกก่อน เอาเฉพาะ
    // ส่วนที่ "เพิ่มขึ้นใหม่" จริงๆ ของเดือนนั้นมานับ ไม่งั้นถ้ามีหลายเดือนติดกันค้างพร้อมกัน (เช่น มิ.ย.+ก.ค.
    // ยังไม่จ่ายทั้งคู่) ยอดของ มิ.ย. จะถูกนับซ้ำอีกรอบตอนบวกกับยอดของ ก.ค. (ที่มี มิ.ย. ฝังอยู่ในตัวเองอยู่แล้ว)
    // ทำให้ยอดรวมพองขึ้นเป็นสองเท่า (บั๊กเดิม) จากนั้นค่อยหักยอดที่จ่ายมาแล้วบางส่วนออก (ถ้ามี) ไม่งั้นเดือนถัดไป
    // จะเรียกเก็บซ้ำเต็มจำนวน
    const ownAmount = (Number(roomBill.total) || 0) - (Number(roomBill.outstandingAmount) || 0);
    const amt = Math.max(0, ownAmount - (Number(roomBill.paidAmount) || 0));
    if (amt > 0) {
      amount += amt;
      items.push({ monthYear: group.monthYear, amount: amt, fineAmount: Number(roomBill.fineAmount) || 0 });
    }
  }
  return { amount, items };
}

// ── ปรับ outstandingItems ที่แช่แข็งไว้ให้ตรงกับความจริง ────────────────────────
// outstandingAmount/outstandingItems ถูก "แช่แข็ง" ไว้กับบิลตอนสร้าง และ refreshDerivedFields จงใจไม่คำนวณใหม่
// (ดูคอมเมนต์ยาวที่ refreshDerivedFields) แต่ถ้าผู้ใช้ไปกดปิดยอดบิลเดือนเก่าจาก "หน้าของเดือนนั้นเอง" โดยตรง
// (ไม่ได้ปิดผ่านป็อปอัพชำระเงินของเดือนนี้) หรือจ่ายบางส่วนของเดือนเก่าผ่าน applyPartialOutstandingPayment
// snapshot นี้จะไม่ถูกอัปเดต ทำให้เดือนนี้ยังโชว์ยอดค้าง/ให้เลือกปิดเต็มจำนวนเดิม ทั้งที่จริงๆ ปิดไปแล้ว (เต็มหรือ
// บางส่วน) — ฟังก์ชันนี้เทียบ outstandingItems กับสถานะจริงของบิลต้นทางแต่ละเดือน แล้วแยกเป็นเดือนที่ยัง
// "ค้างจริง" (pending — amount ถูกปรับเป็นยอดคงเหลือสดๆ แล้วถ้าจ่ายมาบางส่วน) กับยอดรวมของเดือนที่ "ปิดไปแล้ว
// เต็มจำนวน" (settledAmount) ให้ผู้เรียกเอาไปหักออก
export function reconcileOutstandingItems(
  allBills: BillGroup[], roomId: string, tenantId: string | null, tenantName: string,
  outstandingItems: OutstandingItem[]
): { pending: OutstandingItem[]; settled: OutstandingItem[]; settledAmount: number } {
  const pending: OutstandingItem[] = [];
  const settled: OutstandingItem[] = [];
  let settledAmount = 0;
  for (const o of outstandingItems) {
    const group = allBills.find((b) => b.monthYear === o.monthYear);
    const roomBill = (group?.data || []).find((r) => String(r.roomId) === String(roomId));
    const sameTenant = !!roomBill && sameOutstandingTenant(roomBill, tenantId, tenantName);
    const isSettled = sameTenant
      && (roomBill!.status === "paid" || (Number(roomBill!.paidAmount) || 0) >= (Number(roomBill!.total) || 0) - 0.005);
    if (isSettled) {
      settled.push(o); settledAmount += Number(o.amount) || 0;
    } else if (sameTenant) {
      const ownAmount = (Number(roomBill!.total) || 0) - (Number(roomBill!.outstandingAmount) || 0);
      const liveAmount = Math.max(0, ownAmount - (Number(roomBill!.paidAmount) || 0));
      pending.push({ ...o, amount: liveAmount });
    } else {
      pending.push(o);
    }
  }
  return { pending, settled, settledAmount };
}

// ยกเว้นค่าปรับ/เพิ่มส่วนลดให้บิลเดือนก่อนหน้าที่กำลังจะปิดยอด (ตั้งค่าได้จากป็อปอัพบันทึกการชำระเงินของเดือน
// ปัจจุบัน โดยไม่ต้องย้อนไปเปิดบิลเดือนนั้นแก้เอง) — key เป็น monthYear ของกลุ่มบิลที่จะปรับ
export interface OutstandingAdjustment { fineWaiveAmount: number; discountItems: BillLineItem[] }

// ยอดค้างของเดือนนั้นๆ หลังหักค่าปรับที่ยกเว้น/ส่วนลดที่เพิ่มไว้ (ถ้ามี adjustment ของเดือนนั้น) — ใช้ร่วมกันทั้ง
// ในป็อปอัพบันทึกการชำระเงิน (คำนวณยอดที่ต้องเก็บวันนี้สดๆ) และตอนบันทึกจริง (คำนวณเงินทอน/ยอดที่นับเป็น
// "จ่ายจริง" ให้ตรงกับที่ป็อปอัพแสดง) กันตรรกะสองที่เพี้ยนไม่ตรงกัน
export function adjustedOutstandingAmount(o: OutstandingItem, adjustments?: Record<string, OutstandingAdjustment>): number {
  const adj = adjustments?.[o.monthYear];
  if (!adj) return o.amount;
  const discSum = adj.discountItems.reduce((s, d) => s + (Number(d.price) || 0), 0);
  return Math.max(0, o.amount - adj.fineWaiveAmount - discSum);
}

// ── ปิดยอดค้างชำระเดือนก่อน ────────────────────────────────────────────────────
// ตั้งสถานะบิลเดือนเก่าที่เลือกเป็น "จ่ายแล้ว" ไปพร้อมกับการบันทึกชำระเงินของเดือนปัจจุบัน (ดูป็อปอัพ
// บันทึกการชำระเงิน) เพราะปกติ outstandingAmount ที่ยกมารวมในบิลเดือนนี้ไม่เคยไปอัปเดตสถานะบิลต้นทาง
// เดือนเก่าให้เอง ทำให้ถ้าไม่ปิดตรงนี้ ยอดเดิมจะค้างวนเป็น outstanding ซ้ำในบิลเดือนถัดๆ ไปอีก
// คืนเฉพาะกลุ่มบิลที่มีการแก้ไขจริง (ให้ผู้เรียกเอาไปเซฟทีละกลุ่มด้วย billsApi.update ต่อ)
// adjustments (ถ้ามี) = ยกเว้นค่าปรับ/เพิ่มส่วนลดให้เดือนนั้นก่อนปิดยอด — total ของบิลเดือนก่อนหน้าจะลดลงตาม
// จริง (ไม่ใช่แค่ยอดที่ยกมารวมในเดือนนี้) และ originalTotal ของบิลเดือนนั้นจะไม่ถูกแตะต้อง (ยังคงเป็นยอด
// ตายตัวตอนสร้างบิลครั้งแรกเหมือนเดิม — ดู recalcItem)
export function closeOutstandingBills(
  allBills: BillGroup[], roomId: string, tenantId: string | null, tenantName: string, monthYears: string[],
  adjustments?: Record<string, OutstandingAdjustment>
): { group: BillGroup; data: BillItem[] }[] {
  const wanted = new Set(monthYears);
  const result: { group: BillGroup; data: BillItem[] }[] = [];
  for (const group of allBills) {
    if (!wanted.has(group.monthYear)) continue;
    const data = group.data || [];
    const idx = data.findIndex((r) =>
      String(r.roomId) === String(roomId) && r.status !== "paid" && sameOutstandingTenant(r, tenantId, tenantName)
    );
    if (idx === -1) continue;
    const target = data[idx];
    const adj = adjustments?.[group.monthYear];
    const fineWaive = Math.max(0, Math.min(Number(target.fineAmount) || 0, adj?.fineWaiveAmount || 0));
    const extraDiscounts = adj?.discountItems ?? [];
    const extraDiscountSum = extraDiscounts.reduce((s, d) => s + (Number(d.price) || 0), 0);
    const adjustedTotal = Math.max(0, (Number(target.total) || 0) - fineWaive - extraDiscountSum);
    const nextData = data.map((r, i) => (i === idx ? {
      ...r,
      fineAmount: Math.max(0, (Number(r.fineAmount) || 0) - fineWaive),
      fineWaived: (Number(r.fineWaived) || 0) + fineWaive,
      discountItems: [...(r.discountItems || []), ...extraDiscounts],
      total: adjustedTotal,
      paidAmount: adjustedTotal,
      status: "paid" as const,
    } : r));
    result.push({ group, data: nextData });
  }
  return result;
}

// ── ชำระยอดค้างเดือนก่อนแบบบางส่วน ──────────────────────────────────────────────
// ใช้เมื่อเงินที่รับจริงไม่พอปิดยอดค้างเดือนนั้นเต็มจำนวน — ต่างจาก closeOutstandingBills ตรงที่แค่เพิ่ม
// paidAmount ของบิลต้นทางเดือนนั้น ไม่ตั้งสถานะเป็น "จ่ายแล้ว" และไม่ยกเว้นค่าปรับ/เพิ่มส่วนลด (เพราะยังไม่ปิดยอดจริง
// ยอดที่เหลือยังต้องคำนวณเป็นค้างชำระต่อไปตามปกติผ่าน getOutstandingBalance ซึ่งหัก paidAmount ออกจาก total อยู่แล้ว)
export function applyPartialOutstandingPayment(
  allBills: BillGroup[], roomId: string, tenantId: string | null, tenantName: string,
  monthYear: string, amount: number
): { group: BillGroup; data: BillItem[] } | null {
  const group = allBills.find((b) => b.monthYear === monthYear);
  if (!group) return null;
  const data = group.data || [];
  const idx = data.findIndex((r) =>
    String(r.roomId) === String(roomId) && r.status !== "paid" && sameOutstandingTenant(r, tenantId, tenantName)
  );
  if (idx === -1) return null;
  const nextData = data.map((r, i) => (i === idx ? { ...r, paidAmount: (Number(r.paidAmount) || 0) + amount } : r));
  return { group, data: nextData };
}

// ── ค่าปรับล่าช้าเฉพาะบุคคล ────────────────────────────────────────────────────
// ผู้เช่าแต่ละคนตั้งค่าเกินกำหนดของตัวเองได้ (ผ่านหน้ารายละเอียดผู้เช่า) หรือจะไม่ตั้งก็ได้ — ถ้าไม่ตั้ง
// (tenant.overdue.override = false/ไม่มี) ให้ใช้ค่ากลางจากหน้า Settings ตามปกติ
export function resolveOverdueConfig(tenant: any, config: AppConfig): AppConfig["overdue"] {
  if (tenant?.overdue?.override) {
    return {
      enabled: !!tenant.overdue.enabled,
      day: Number(tenant.overdue.day) || 0,
      type: tenant.overdue.type === "daily" ? "daily" : "fixed",
      amount: Number(tenant.overdue.amount) || 0,
    };
  }
  return config.overdue;
}

// ── วันครบกำหนดชำระของงวดบิล (ใช้ร่วมกันทั้งค่าปรับล่าช้าและระบบปัดเศษด้านล่าง) ─────────────────
// day === 0 หมายถึง "ทุกสิ้นเดือน" (ดูสวิตช์ "ทุกสิ้นเดือน" ในหน้า Settings)
export function computeDueDate(monthYear: string, day: number): Date {
  const [mStr, yStr] = monthYear.split("/");
  const yearAD = normalizeYearToCE(parseInt(yStr, 10)); // รองรับทั้งปี พ.ศ. และ ค.ศ.
  const monthIndex = parseInt(mStr, 10) - 1;
  const dueDate = day === 0 ? new Date(yearAD, monthIndex + 1, 0) : new Date(yearAD, monthIndex + 1, day);
  dueDate.setHours(23, 59, 59, 999);
  return dueDate;
}

function isPastDueDate(monthYear: string, day: number): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today > computeDueDate(monthYear, day);
}

// ── ค่าปรับล่าช้า ──────────────────────────────────────────────────────────────
export function calculateOverdueFine(item: BillItem, overdue: AppConfig["overdue"] | undefined, monthYear: string) {
  item.isOverdue = false;
  item.overdueDays = 0;
  if (item.status === "paid") { item.fineAmount = 0; return; }

  const mode = item.fineOverride?.mode ?? "auto";

  // ป้าย "เกินกำหนด X วัน" / ตัวกรอง = ข้อเท็จจริงว่าเลยวันครบกำหนดของงวดนี้จริงหรือยัง คิดตามกติกาวันครบ
  // กำหนดเสมอ (ถ้ากติกาเปิดอยู่) ไม่ขึ้นกับ override — override คุมแค่ "ยอดเงินค่าปรับ" เท่านั้น
  const pastDue = (() => {
    if (!overdue?.enabled) return false;
    const dueDate = computeDueDate(monthYear, overdue.day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today <= dueDate) return false;
    item.isOverdue = true;
    item.overdueDays = Math.ceil(Math.abs(today.getTime() - dueDate.getTime()) / 86400000);
    return true;
  })();

  if (mode === "off") { item.fineAmount = 0; return; } // ปิดค่าปรับเฉพาะบิลใบนี้

  if (mode === "manual") {
    const amt = Math.max(0, Number(item.fineOverride?.amount) || 0);
    item.fineAmount = Math.max(0, amt - (Number(item.fineWaived) || 0));
    return;
  }

  // auto — คิดอัตโนมัติตามกติกา ต่อเมื่อเลยวันครบกำหนดจริงเท่านั้น
  if (!pastDue || !overdue?.enabled) { item.fineAmount = 0; return; }

  // จ่ายครบทุกอย่างแล้ว (ค่าเช่า/น้ำ/ไฟ/รถ/Tag/รายการอื่นๆ/ยอดค้างยกมา หักส่วนลดแล้ว) เหลือแต่ค่าปรับที่ยัง
  // ไม่ครบ — แช่แข็งค่าปรับไว้เท่าที่เป็นอยู่ตอนนี้ ไม่คำนวณเพิ่มตามจำนวนวันที่ผ่านไปอีก แม้สถานะบิลจะยังเป็น
  // "ค้างชำระ" อยู่ก็ตาม (ไม่งั้นค่าปรับจะโตไม่มีที่สิ้นสุดทุกวันที่ผ่านไป ทั้งที่ผู้เช่าจ่ายทุกอย่างที่เรียกเก็บ
  // จริงครบแล้ว) ถ้าต้องการเก็บเพิ่มให้พนักงานปรับเองผ่าน fineOverride แทน
  const principal = calcItemTotal({ ...item, fineAmount: 0 });
  if ((Number(item.paidAmount) || 0) >= principal - 0.005) return; // คงค่า item.fineAmount เดิมไว้ ไม่แตะ

  const rawFine = overdue.type === "fixed"
    ? (Number(overdue.amount) || 0)
    : item.overdueDays * (Number(overdue.amount) || 0);
  item.fineAmount = Math.max(0, rawFine - (Number(item.fineWaived) || 0));
}

// ── ปัดเศษยอดบิลลง ────────────────────────────────────────────────────────────
// ปัดยอดสุทธิลงให้ลงท้ายด้วยหลักที่ตั้งไว้ (เช่น หลัก 5 บาท: 4127 -> 4125) เฉพาะตอนที่ "ยังไม่เลยวันครบกำหนด
// ชำระ" ของงวดนั้น (ใช้วันครบกำหนดเดียวกับค่าปรับล่าช้า — ดู computeDueDate ด้านบน) และบิลยังไม่ได้จ่ายแล้ว
// แสดงผลเป็นรายการ "ส่วนลด" ปกติ (id คงที่ = ROUNDING_DISCOUNT_ID) เพื่อให้ลบออกได้จากหน้าแก้ไขบิลเหมือน
// ส่วนลดทั่วไป — ถ้าผู้ใช้ลบเอง (ดู BillsPage.tsx) จะตั้ง roundingDismissed ไว้กันไม่ให้คำนวณรอบถัดไปเพิ่ม
// รายการปัดเศษกลับเข้ามาใหม่ในบิลใบเดิม
export const ROUNDING_DISCOUNT_ID = "auto-rounding";

export function applyBillRounding(item: BillItem, monthYear: string) {
  // บิลที่จ่ายแล้ว: คงรายการเดิมไว้ตามที่ปิดยอดจริง ไม่คำนวณ/แก้ไขส่วนลดปัดเศษซ้ำอีก
  if (item.status === "paid") return;

  const others = (item.discountItems || []).filter((d) => d.id !== ROUNDING_DISCOUNT_ID);
  const cfg = item.roundingConfig;
  const unit = Math.max(1, Number(cfg?.unit) || 5);
  const dueDay = Number(item.overdueConfig?.day) || 0;
  const eligible = !!cfg?.enabled && !item.roundingDismissed && !isPastDueDate(monthYear, dueDay);

  const rawTotal = calcItemTotal({ ...item, discountItems: others });
  const remainder = eligible ? rawTotal % unit : 0;

  item.discountItems = remainder > 0
    ? [...others, { id: ROUNDING_DISCOUNT_ID, name: "ปัดเศษ", price: remainder }]
    : others;
}

// ── ยอดรวมสุทธิ ────────────────────────────────────────────────────────────────
export function calcItemTotal(item: BillItem): number {
  const tagsTotal = (item.billTagItems || []).reduce((s, t) => s + (Number(t.price) || 0), 0)
    + (item.billTenantTagItems || []).reduce((s, t) => s + (Number(t.price) || 0), 0);
  const customTotal = (item.customItems || []).reduce((s, c) => s + (Number(c.price) || 0), 0);
  const discountTotal = (item.discountItems || []).reduce((s, d) => s + (Number(d.price) || 0), 0);
  return (item.priceRoom || 0) + (item.priceWater || 0) + (item.priceElectric || 0) + (item.priceVehicle || 0)
    + tagsTotal + customTotal + (item.fineAmount || 0) + (item.outstandingAmount || 0) - discountTotal;
}

// ── บรรทัดค่าน้ำ/ค่าไฟสำหรับแสดงในรายละเอียดบิล ───────────────────────────────
// priceWater/priceElectric รวมค่าบริการต่อหน่วยไว้แล้วเสมอ (ไม่กระทบยอดรวม) ฟังก์ชันนี้แค่จัดรูปแบบว่าจะโชว์
// เป็นบรรทัดเดียว (รวมยอด) หรือแยกเป็นบรรทัดค่าบริการต่างหาก ตาม serviceFeeConfig.displayMode ที่ล็อกไว้กับบิล
// กรณี "รวม" บรรทัดเดียว: rate ที่คืนเป็นอัตรารวม (ค่าน้ำ/ไฟฐาน + ค่าบริการ) ให้ตรงกับราคาที่แสดงจริง พร้อม note
// อธิบายว่ารวมมาจากอะไรบ้าง (เช่น "ค่าไฟ 4.00 + ค่าบริการ 3.00 บาท/หน่วย") ให้ผู้เช่าเห็นที่มาของยอดชัดเจน
export interface WaterElectricRow {
  kind: "electric" | "electricFee" | "water" | "waterFee";
  label: string;
  unit: number;
  rate: number;
  price: number;
  note?: string;
  flat?: boolean;     // แถวค่าบริการแบบเหมาจ่าย — ไม่แสดงจำนวนหน่วย/หน่วยละ
  formula?: string;   // แถวค่าน้ำ/ไฟแบบอัตราก้าวหน้า — แสดงสูตรแทน "หน่วยละ"
}

// ชื่อแถว/คำอธิบายใต้ชื่อของแถวน้ำ-ไฟ ใช้ร่วมกันทุกที่ที่แสดงบิล (ตัวอย่างบิล, ใบแจ้งหนี้, ใบพิมพ์)
export function waterElectricRowName(r: WaterElectricRow): string {
  return r.flat ? `${r.label} (เหมาจ่าย)` : `${r.label} (${r.unit} หน่วย)`;
}
export function waterElectricRowSub(r: WaterElectricRow, prev?: number, curr?: number, arrow = " → "): string {
  if (r.flat) return "เหมาจ่าย";
  const isFee = r.kind === "electricFee" || r.kind === "waterFee";
  const head = isFee ? "" : `เดือนก่อน ${prev ?? 0}${arrow}เดือนนี้ ${curr ?? 0} · `;
  if (r.formula) return head + r.formula;
  return head + `หน่วยละ ${(Number(r.rate) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท` + (r.note ? ` (${r.note})` : "");
}

export function buildWaterElectricRows(item: BillItem): WaterElectricRow[] {
  const svc = item.serviceFeeConfig;
  const feeEnabled = !!svc?.enabled;
  const separate = feeEnabled && svc!.displayMode === "separate";

  function money2(n: number) { return (Number(n) || 0).toFixed(2); }

  const rows: WaterElectricRow[] = [];
  const tieredElec = !item.electricFormula && item.electricTariff?.mode === "tiered";
  const tieredWater = !item.waterFormula && item.waterTariff?.mode === "tiered";
  const flatFee = !!svc && svc.mode === "flat";
  const elecFormula = tieredElec ? describeTariff(item.electricTariff!) : undefined;
  const waterFormula = tieredWater ? describeTariff(item.waterTariff!) : undefined;

  if (item.electricActive) {
    const fee = feeEnabled ? (Number(item.electricServiceFee) || 0) : 0;
    if (separate) {
      rows.push({ kind: "electric", label: "ค่าไฟ", unit: item.meterElectric.unit, rate: item.electricRate, price: item.priceElectric - fee, formula: elecFormula });
      if (fee > 0) rows.push({ kind: "electricFee", label: "ค่าบริการไฟ", unit: item.meterElectric.unit, rate: svc!.electricRate, price: fee, flat: flatFee });
    } else {
      rows.push({
        kind: "electric", label: "ค่าไฟ", unit: item.meterElectric.unit,
        rate: item.electricRate + (fee > 0 && !flatFee ? svc!.electricRate : 0), price: item.priceElectric, formula: elecFormula,
        note: fee > 0 ? (flatFee ? `รวมค่าบริการเหมาจ่าย ${money2(fee)} บาท` : `ค่าไฟ ${money2(item.electricRate)} + ค่าบริการ ${money2(svc!.electricRate)} บาท/หน่วย`) : undefined,
      });
    }
  }
  if (item.waterActive) {
    const fee = feeEnabled ? (Number(item.waterServiceFee) || 0) : 0;
    if (separate) {
      rows.push({ kind: "water", label: "ค่าน้ำ", unit: item.meterWater.unit, rate: item.waterRate, price: item.priceWater - fee, formula: waterFormula });
      if (fee > 0) rows.push({ kind: "waterFee", label: "ค่าบริการน้ำ", unit: item.meterWater.unit, rate: svc!.waterRate, price: fee, flat: flatFee });
    } else {
      rows.push({
        kind: "water", label: "ค่าน้ำ", unit: item.meterWater.unit,
        rate: item.waterRate + (fee > 0 && !flatFee ? svc!.waterRate : 0), price: item.priceWater, formula: waterFormula,
        note: fee > 0 ? (flatFee ? `รวมค่าบริการเหมาจ่าย ${money2(fee)} บาท` : `ค่าน้ำ ${money2(item.waterRate)} + ค่าบริการ ${money2(svc!.waterRate)} บาท/หน่วย`) : undefined,
      });
    }
  }
  return rows;
}

// ── ส่วนลดพิเศษเฉพาะห้อง — ไม่หมดอายุในเดือนนี้หรือยังไม่มีวันหมดอายุเลย = ยังใช้ได้ ──
// เดือนเริ่มต้นของส่วนลด: ใช้ startMonth ที่ตั้งไว้ ถ้าไม่มี (ส่วนลดเก่า) ใช้เดือนก่อนเดือนที่สร้าง (บิลมักออกของเดือนก่อนหน้า)
// กันไม่ให้ส่วนลดที่เพิ่งตั้งไปย้อนปนในบิลเดือนเก่าที่ปิดไปแล้ว
function specialDiscountStart(d: SpecialDiscount): string {
  if (d.startMonth) return d.startMonth;
  const t = d.createdAt ? new Date(d.createdAt) : null;
  if (!t || Number.isNaN(t.getTime())) return "";
  return prevMY(`${padZ(t.getMonth() + 1)}/${t.getFullYear()}`);
}

export function specialDiscountExpiredToday(d: { expiryDate: string }): boolean {
  if (!d.expiryDate) return false;
  const end = new Date(`${d.expiryDate}T23:59:59`).getTime();
  return !Number.isNaN(end) && Date.now() > end;
}

function specialDiscountActiveForMonth(d: SpecialDiscount, monthYear: string): boolean {
  const start = specialDiscountStart(d);
  if (start && myScore(monthYear) < myScore(start)) return false;
  if (!d.expiryDate) return true;
  const [m, y] = monthYear.split("/");
  const monthStart = new Date(Number(y), Number(m) - 1, 1).getTime();
  const expiry = new Date(d.expiryDate).getTime();
  if (Number.isNaN(expiry)) return true;
  return monthStart <= expiry;
}

// สมานรายการ "ส่วนลดพิเศษ" (id ขึ้นต้นด้วย "special-") ในบิลให้ตรงกับส่วนลดพิเศษที่ตั้งไว้จริง ณ ตอนนี้ — ลบ
// รายการที่ไม่มีสิทธิ์แล้ว (ห้องถูกถอดออก/หมดอายุ/ถูกลบส่วนลดทิ้ง) เพิ่มรายการที่มีสิทธิ์ใหม่ และอัปเดตยอดของ
// รายการเดิมให้ตรง (เผื่อแก้ไขมูลค่า/เปอร์เซ็นต์ทีหลัง) ไม่แตะรายการส่วนลดอื่นที่พนักงานเพิ่มเอง (discFromStaff)
// — ส่วนลดแบบเปอร์เซ็นต์คิดจากยอดก่อนหักส่วนลดทั้งหมด (ค่าเช่า+น้ำ+ไฟ+รถ+Tag+รายการอื่นๆ+ค่าปรับ+ยอดค้างยกมา)
export function applySpecialDiscounts(item: BillItem, monthYear: string, discounts: SpecialDiscount[]) {
  const others = (item.discountItems || []).filter((d) => !d.id.startsWith("special-"));
  // หมดอายุตามวันที่จริง (วันนี้เลยวันหมดอายุไปแล้ว) = ไม่ให้ส่วนลดกับบิลที่ยังไม่จ่าย — แต่บิลที่จ่ายไปแล้ว/จ่ายบางส่วน
  // ต้องคงส่วนลดเดิมไว้ตามที่เคยคิดตอนนั้น ไม่ให้ยอดย้อนหลังเปลี่ยน
  const applicable = discounts.filter((d) => {
    if (!d.roomIds.includes(item.roomId) || !specialDiscountActiveForMonth(d, monthYear)) return false;
    if (!specialDiscountExpiredToday(d)) return true;
    const had = (item.discountItems || []).some((x) => x.id === `special-${d.id}`);
    return had && (item.status === "paid" || (Number(item.paidAmount) || 0) > 0);
  });
  if (applicable.length === 0) { item.discountItems = others; return; }
  const base = calcItemTotal({ ...item, discountItems: [] });
  const specialItems: BillLineItem[] = applicable.map((d) => ({
    id: `special-${d.id}`,
    name: d.name,
    price: Math.max(0, d.type === "percent" ? base * ((Number(d.value) || 0) / 100) : Number(d.value) || 0),
  }));
  item.discountItems = [...others, ...specialItems];
}

// ── Recalc หนึ่งแถว (หลังแก้มิเตอร์/สูตร/รายการ) ─────────────────────────────
// แถวบิลของผู้เช่าทดสอบหรือไม่ — ใช้ flag ในแถวเอง (ตั้งตอนเปิด/คำนวณบิล) หรือค้นจากรายชื่อผู้เช่าถ้าส่งมา (บิลดิบที่ยังไม่ได้เปิด)
export function isTestItem(item: { isTest?: boolean; tenantId?: string | null }, tenants?: any[]): boolean {
  if (item.isTest) return true;
  if (!tenants || !item.tenantId) return false;
  return !!tenants.find((t) => String(t.id) === String(item.tenantId))?.isTest;
}

export function recalcItem(
  item: BillItem,
  config: AppConfig,
  defaults: { water: string; electric: string },
  monthYear: string,
  tenant?: any,
  specialDiscounts?: SpecialDiscount[]
) {
  if (tenant) item.isTest = !!tenant.isTest;
  const meterBase = Math.pow(10, config.meterDigits || 4);
  item.meterWater.unit = item.waterActive ? calcUnit(item.meterWater.curr, item.meterWater.prev, meterBase) : 0;
  item.meterElectric.unit = item.electricActive ? calcUnit(item.meterElectric.curr, item.meterElectric.prev, meterBase) : 0;

  // ล็อกสูตรพื้นฐาน/กติกาค่าปรับที่ใช้จริงไว้กับตัวบิล (ครั้งแรกที่เจอค่าที่ยังไม่เคย snapshot เท่านั้น)
  // เพื่อไม่ให้การแก้ "ค่าเริ่มต้น" ในหน้าตั้งค่าภายหลัง ย้อนไปเปลี่ยนยอดบิลเก่าที่ปิดไปแล้ว
  const waterDefault = item.waterDefaultFormula ?? defaults.water;
  const electricDefault = item.electricDefaultFormula ?? defaults.electric;
  item.waterDefaultFormula = waterDefault;
  item.electricDefaultFormula = electricDefault;
  const overdueCfg = item.overdueConfig ?? resolveOverdueConfig(tenant, config);
  item.overdueConfig = overdueCfg;

  // ล็อกค่าบริการต่อหน่วย (เปิด/ปิด, อัตรา, รูปแบบการแสดงผล) ไว้กับตัวบิลเหมือนสูตร/ค่าปรับด้านบน เพื่อไม่ให้
  // การแก้ไขค่าเริ่มต้นในหน้าตั้งค่าภายหลัง ย้อนไปเปลี่ยนยอดบิลเก่าที่ปิดไปแล้ว
  const svcCfg = item.serviceFeeConfig ?? {
    enabled: !!config.serviceFee?.enabled,
    waterRate: Number(config.serviceFee?.waterRate) || 0,
    electricRate: Number(config.serviceFee?.electricRate) || 0,
    mode: config.serviceFee?.mode === "flat" ? "flat" : "unit",
    waterFlat: Number(config.serviceFee?.waterFlat) || 0,
    electricFlat: Number(config.serviceFee?.electricFlat) || 0,
    displayMode: config.serviceFee?.displayMode === "separate" ? "separate" : "combined",
  };
  item.serviceFeeConfig = svcCfg;

  // ล็อกค่าปัดเศษ (เปิด/ปิด, ปัดลงทีละกี่บาท) ไว้กับตัวบิลเหมือนค่าปรับล่าช้า/ค่าบริการต่อหน่วยด้านบน
  const roundingCfg = item.roundingConfig ?? {
    enabled: !!config.rounding?.enabled,
    unit: Math.max(1, Number(config.rounding?.unit) || 5),
  };
  item.roundingConfig = roundingCfg;

  const waterTariff = item.waterTariff ?? normalizeTariff(config.waterTariff);
  const electricTariff = item.electricTariff ?? normalizeTariff(config.electricTariff);
  item.waterTariff = waterTariff;
  item.electricTariff = electricTariff;
  const wf = item.waterFormula || waterDefault;
  const ef = item.electricFormula || electricDefault;
  item.waterServiceFee = item.waterActive && svcCfg.enabled ? (svcCfg.mode === "flat" ? Number(svcCfg.waterFlat) || 0 : item.meterWater.unit * svcCfg.waterRate) : 0;
  item.electricServiceFee = item.electricActive && svcCfg.enabled ? (svcCfg.mode === "flat" ? Number(svcCfg.electricFlat) || 0 : item.meterElectric.unit * svcCfg.electricRate) : 0;
  item.priceWater = (item.waterActive ? (!item.waterFormula && waterTariff.mode === "tiered" ? calcTariff(item.meterWater.unit, waterTariff) : calculateComplexPrice(item.meterWater.unit, item.waterRate, wf)) : 0) + item.waterServiceFee;
  item.priceElectric = (item.electricActive ? (!item.electricFormula && electricTariff.mode === "tiered" ? calcTariff(item.meterElectric.unit, electricTariff) : calculateComplexPrice(item.meterElectric.unit, item.electricRate, ef)) : 0) + item.electricServiceFee;
  item.priceVehicle = (item.billVehicleItems || []).reduce((s, v) => s + (Number(v.price) || 0), 0);

  calculateOverdueFine(item, overdueCfg, monthYear);
  // specialDiscounts ไม่ได้ส่งมา = ไม่แตะรายการส่วนลดพิเศษที่มีอยู่เดิมเลย (เผื่อ caller ที่ยังไม่รู้จักฟีเจอร์นี้
  // เรียก recalcItem ตรงๆ โดยไม่ผ่าน ctx — ถ้า default เป็น [] จะลบส่วนลดพิเศษที่เคยใส่ไว้ทิ้งโดยไม่ตั้งใจ)
  if (specialDiscounts !== undefined) applySpecialDiscounts(item, monthYear, specialDiscounts);
  applyBillRounding(item, monthYear);
  item.total = calcItemTotal(item);
  item.originalTotal = item.originalTotal ?? item.total;
  return item;
}

// ห้องที่ยังไม่ได้จดมิเตอร์ของเดือนนี้ (แต่เปิดใช้มิเตอร์น้ำหรือไฟอยู่) — ใช้แสดงเตือนก่อนสร้างบิลจริง
// ว่าห้องไหนบ้างที่ generateBillForMonth จะข้ามไปเพราะยังไม่มีข้อมูลมิเตอร์ให้คำนวณ
export function getRoomsAwaitingMeterReading(monthYear: string, ctx: GenCtx): any[] {
  const meterGroup = ctx.meterReadings.find((m) => m.monthYear === monthYear);
  const meterData: Record<string, any> = meterGroup?.data ?? {};
  const EXCLUDED_STATUSES = new Set(["ว่าง", "ปิดปรับปรุง", "ปรับปรุง"]);
  return ctx.rooms.filter((room) => {
    if (room.isActive === false || EXCLUDED_STATUSES.has(room.status)) return false;
    const reading = meterData[room.number];
    const waterOk = room.meterWaterActive === false || (reading?.currWater !== undefined && reading?.currWater !== "");
    const electricOk = room.meterElectricActive === false || (reading?.currElectric !== undefined && reading?.currElectric !== "");
    return !(waterOk && electricOk);
  }).sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true, sensitivity: "base" }));
}

// ── สร้างบิลใหม่ทั้งเดือนจากข้อมูลห้อง/ผู้เช่า/มิเตอร์/รถ ────────────────────
export function generateBillForMonth(monthYear: string, ctx: GenCtx): BillItem[] {
  const defaults = resolveDefaultFormulas(ctx.formulas);
  const meterGroup = ctx.meterReadings.find((m) => m.monthYear === monthYear);
  const meterData: Record<string, any> = meterGroup?.data ?? {};
  const prevMeterGroup = ctx.meterReadings.find((m) => m.monthYear === prevMY(monthYear));
  const prevMeterData: Record<string, any> = prevMeterGroup?.data ?? {};

  // สร้างบิลเฉพาะห้องที่ยังให้เช่าอยู่จริง: ห้องที่ปิดใช้งานมิเตอร์น้ำ/ไฟ (แต่มีผู้เช่า) ยังต้องออกบิลตามปกติ
  // ส่วนห้องที่ "ว่าง" หรือ "ปิดปรับปรุง" ไม่มีผู้เช่าอยู่จริง จึงไม่ต้องออกบิล
  // หมายเหตุ: ออกบิลให้ทุกห้องเสมอแม้ยังไม่ได้จดมิเตอร์ของเดือนนี้ (ค่าน้ำ/ไฟจะเป็น 0 ไปก่อนจนกว่าจะจดมิเตอร์
  // แล้วมาแก้ไขบิลภายหลัง) เพื่อไม่ให้บางห้องหายไปจากรอบบิลของเดือนนั้นๆ
  const EXCLUDED_STATUSES = new Set(["ว่าง", "ปิดปรับปรุง", "ปรับปรุง"]);
  const activeRooms = ctx.rooms
    .filter((r) => r.isActive !== false && !EXCLUDED_STATUSES.has(r.status))
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true, sensitivity: "base" }));

  return activeRooms.map((room, idx) => {
    const tenant = ctx.tenants.find((t) => tenantOccupiesRoom(t, room));
    const tenantId: string | null = tenant?.id ?? null;
    const tenantName = tenant ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() : "ว่าง";
    const tenantTitle = tenant?.title || "คุณ";
    const residentCount = 1 + (Array.isArray(tenant?.coResidents) ? tenant.coResidents.length : 0);

    const billTagItems: BillTagItem[] = (room.tags ?? [])
      .map((tid: string) => ctx.roomTags.find((t) => String(t.id) === String(tid)))
      .filter((t: any) => t && Number(t.price) > 0)
      .map((t: any) => ({ id: t.id, name: t.name, price: Number(t.price), color: t.color, icon: t.icon }));

    const billTenantTagItems: BillTagItem[] = tenant
      ? (tenant.tags ?? [])
          .map((tid: string) => ctx.tenantTags.find((t) => String(t.id) === String(tid)))
          .filter((t: any) => t && Number(t.price) > 0)
          .map((t: any) => ({ id: t.id, name: t.name, price: Number(t.price), color: t.color, icon: t.icon }))
      : [];

    const billVehicleItems: BillVehicleItem[] = tenantId
      ? ctx.vehicles
          .filter((v) => String(v.customerId) === String(tenantId) && (Number(v.parkingFee) || 0) > 0)
          .map((v) => ({
            id: v.id,
            plate: v.licensePlate,
            name: `ที่จอดรถ (${v.licensePlate})${v.brand ? " - " + v.brand : ""}`,
            price: Number(v.parkingFee) || 0,
          }))
      : [];

    const reading = meterData[room.number] ?? {};
    const prevReading = prevMeterData[room.number] ?? {};
    const waterPrev = numOr(reading.prevWater, numOr(prevReading.currWater, 0));
    const waterCurr = numOr(reading.currWater, waterPrev);
    const elecPrev = numOr(reading.prevElectric, numOr(prevReading.currElectric, 0));
    const elecCurr = numOr(reading.currElectric, elecPrev);

    const outstanding = getOutstandingBalance(ctx.allBills, room.id, monthYear, tenantId, tenantName);

    const item: BillItem = {
      customBillId: `B${idx + 1}-${room.id}-${monthYear.replace("/", "")}`,
      roomId: room.id,
      roomNumber: room.number,
      tenantId,
      tenantName,
      tenantTitle,
      residentCount,
      priceRoom: Number(room.price) || 0,
      waterRate: Number(ctx.config.waterRate) || 0,
      electricRate: Number(ctx.config.electricRate) || 0,
      waterFormula: "",
      electricFormula: "",
      waterDefaultFormula: defaults.water,
      electricDefaultFormula: defaults.electric,
      overdueConfig: resolveOverdueConfig(tenant, ctx.config),
      roundingConfig: {
        enabled: !!ctx.config.rounding?.enabled,
        unit: Math.max(1, Number(ctx.config.rounding?.unit) || 5),
      },
      roundingDismissed: false,
      waterActive: room.meterWaterActive !== false,
      electricActive: room.meterElectricActive !== false,
      meterWater: { prev: waterPrev, curr: waterCurr, unit: 0 },
      meterElectric: { prev: elecPrev, curr: elecCurr, unit: 0 },
      priceWater: 0,
      priceElectric: 0,
      waterServiceFee: 0,
      electricServiceFee: 0,
      priceVehicle: 0,
      billVehicleItems,
      billTagItems,
      billTenantTagItems,
      customItems: [],
      discountItems: [],
      outstandingAmount: outstanding.amount,
      outstandingItems: outstanding.items,
      fineAmount: 0,
      fineWaived: 0,
      isOverdue: false,
      overdueDays: 0,
      total: 0,
      status: "unpaid",
      paidAmount: 0,
    };
    recalcItem(item, ctx.config, defaults, monthYear, undefined, ctx.specialDiscounts);
    return item;
  });
}

// ── ทำให้ข้อมูลบิลเก่า (ที่ migrate มาจาก Google Sheets และอาจขาดบางฟิลด์) ────
// ครบตามรูปแบบ BillItem ปัจจุบัน ก่อนนำมาแสดง/แก้ไข ป้องกันหน้าเว็บพังจากข้อมูลเก่า
function normTagArray(v: any): BillTagItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((t: any) => ({
    id: String(t?.id ?? t?.name ?? Math.random()),
    name: String(t?.name ?? ""),
    price: Number(t?.price) || 0,
    color: t?.color,
    icon: t?.icon,
  }));
}

function normLineArray(v: any): BillLineItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((c: any) => ({
    id: String(c?.id ?? `${c?.name ?? "item"}-${Math.random()}`),
    name: String(c?.name ?? ""),
    price: Number(c?.price) || 0,
  }));
}

export function normalizeBillItem(raw: any): BillItem {
  const discountItems = normLineArray(raw?.discountItems);
  // ข้อมูลเก่าบางระบบเก็บส่วนลดเป็นตัวเลขเดี่ยว (discount) แทนที่จะเป็นรายการ — แปลงเป็นรายการเพื่อไม่ให้ยอดหาย
  if (discountItems.length === 0 && Number(raw?.discount) > 0) {
    discountItems.push({ id: "legacy-discount", name: "ส่วนลด", price: Number(raw.discount) || 0 });
  }
  return {
    customBillId: String(raw?.customBillId ?? `${raw?.roomId ?? ""}-legacy`),
    roomId: String(raw?.roomId ?? ""),
    roomNumber: String(raw?.roomNumber ?? ""),
    tenantId: raw?.tenantId && String(raw.tenantId) !== "0" ? String(raw.tenantId) : null,
    tenantName: String(raw?.tenantName ?? "ว่าง"),
    tenantTitle: String(raw?.tenantTitle ?? "") || "คุณ",
    residentCount: Number(raw?.residentCount) > 0 ? Number(raw.residentCount) : 1,
    priceRoom: Number(raw?.priceRoom) || 0,
    waterRate: Number(raw?.waterRate) || 0,
    electricRate: Number(raw?.electricRate) || 0,
    waterFormula: String(raw?.waterFormula ?? ""),
    electricFormula: String(raw?.electricFormula ?? ""),
    waterActive: raw?.waterActive !== false,
    electricActive: raw?.electricActive !== false,
    meterWater: {
      prev: Number(raw?.meterWater?.prev) || 0,
      curr: Number(raw?.meterWater?.curr) || 0,
      unit: Number(raw?.meterWater?.unit) || 0,
    },
    meterElectric: {
      prev: Number(raw?.meterElectric?.prev) || 0,
      curr: Number(raw?.meterElectric?.curr) || 0,
      unit: Number(raw?.meterElectric?.unit) || 0,
    },
    priceWater: Number(raw?.priceWater) || 0,
    priceElectric: Number(raw?.priceElectric) || 0,
    waterServiceFee: Number(raw?.waterServiceFee) || 0,
    electricServiceFee: Number(raw?.electricServiceFee) || 0,
    priceVehicle: Number(raw?.priceVehicle) || 0,
    billVehicleItems: Array.isArray(raw?.billVehicleItems)
      ? raw.billVehicleItems.map((v: any) => ({
          id: String(v?.id ?? v?.plate ?? Math.random()),
          plate: String(v?.plate ?? ""),
          name: String(v?.name ?? ""),
          price: Number(v?.price) || 0,
        }))
      : [],
    billTagItems: normTagArray(raw?.billTagItems),
    billTenantTagItems: normTagArray(raw?.billTenantTagItems),
    customItems: normLineArray(raw?.customItems),
    discountItems,
    outstandingAmount: Number(raw?.outstandingAmount) || 0,
    outstandingItems: Array.isArray(raw?.outstandingItems)
      ? raw.outstandingItems.map((o: any) => ({ monthYear: String(o?.monthYear ?? ""), amount: Number(o?.amount) || 0 }))
      : [],
    fineAmount: Number(raw?.fineAmount) || 0,
    fineWaived: Number(raw?.fineWaived) || 0,
    fineOverride: (raw?.fineOverride?.mode === "off" || raw?.fineOverride?.mode === "manual")
      ? { mode: raw.fineOverride.mode, amount: Number(raw.fineOverride.amount) || 0 }
      : undefined,
    isOverdue: !!raw?.isOverdue,
    overdueDays: Number(raw?.overdueDays) || 0,
    total: Number(raw?.total) || 0,
    originalTotal: raw?.originalTotal !== undefined ? Number(raw.originalTotal) : undefined,
    status: raw?.status === "paid" ? "paid" : "unpaid",
    paidAmount: raw?.paidAmount !== undefined
      ? Number(raw.paidAmount) || 0
      : (raw?.status === "paid" ? Number(raw?.total) || 0 : 0),
    waterDefaultFormula: raw?.waterDefaultFormula !== undefined ? String(raw.waterDefaultFormula) : undefined,
    electricDefaultFormula: raw?.electricDefaultFormula !== undefined ? String(raw.electricDefaultFormula) : undefined,
    overdueConfig: raw?.overdueConfig ? { ...raw.overdueConfig } : undefined,
    // บิลเก่าก่อนมีระบบ "ค่าบริการต่อหน่วย" (ไม่เคยมีฟิลด์นี้เก็บไว้เลย) ต้องล็อกเป็น "ปิดใช้งาน" ถาวรตรงนี้
    // ห้ามปล่อยเป็น undefined เหมือนสูตร/ค่าปรับด้านบน เพราะ recalcItem จะ backfill ด้วยค่าปัจจุบันจาก Settings
    // ทันทีที่เปิดบิลเก่ามาแก้/รีเฟรช ทำให้บิลเก่าโดนบวกค่าบริการย้อนหลังทั้งที่ตอนออกบิลจริงยังไม่มีระบบนี้
    // บิลเก่าก่อนมีอัตราก้าวหน้า ล็อกเป็น "อัตราเดียว" ถาวร (เหตุผลเดียวกับ serviceFeeConfig ด้านล่าง)
    waterTariff: raw?.waterTariff ? normalizeTariff(raw.waterTariff) : normalizeTariff(null),
    electricTariff: raw?.electricTariff ? normalizeTariff(raw.electricTariff) : normalizeTariff(null),
    serviceFeeConfig: raw?.serviceFeeConfig
      ? { ...raw.serviceFeeConfig }
      : { enabled: false, waterRate: 0, electricRate: 0, displayMode: "combined" },
    // บิลเก่าก่อนมีระบบ "ปัดเศษ" (ไม่เคยมีฟิลด์นี้เก็บไว้เลย) ต้องล็อกเป็น "ปิดใช้งาน" ถาวรตรงนี้ ห้ามปล่อย
    // เป็น undefined เหมือนสูตร/ค่าปรับด้านบน เพราะ recalcItem จะ backfill ด้วยค่าปัจจุบันจาก Settings ทันที
    // ที่เปิดบิลเก่ามาแก้/รีเฟรช ทำให้บิลเก่าโดนปัดเศษย้อนหลังทั้งที่ตอนออกบิลจริงยังไม่มีระบบนี้
    roundingConfig: raw?.roundingConfig ? { ...raw.roundingConfig } : { enabled: false, unit: 5 },
    roundingDismissed: !!raw?.roundingDismissed,
    sendLogs: Array.isArray(raw?.sendLogs) ? raw.sendLogs : [],
  };
}

// ── รีเฟรชค่าปรับ + ยอดรวม ของบิลที่โหลดมาแก้ไข (ไม่แตะยอดค้างชำระยกมา) ─────────
// ยอดค้างชำระยกมา (outstandingAmount/outstandingItems) ต้องคงค่าเดิมที่ล็อกไว้ตอนสร้าง/บันทึกบิลนั้นเสมอ ห้าม
// คำนวณใหม่จาก getOutstandingBalance ทุกครั้งที่เปิดบิลซ้ำ เพราะถ้าบิลเดือนก่อนหน้าที่เป็นต้นตอของยอดค้างถูกปิด
// ยอดไปแล้ว (เช่น ผ่านการชำระเงินพร้อมติ๊กปิดยอดเดือนเก่า — ดู closeOutstandingBills) getOutstandingBalance จะไม่
// นับเป็นค้างอีกต่อไป ทำให้ยอดค้างที่เคยรวมอยู่ในยอดรวมสุทธิของบิลนี้ (ที่ออกใบแจ้งหนี้และเก็บเงินไปแล้ว) หายไป
// ตอนเปิดบิลซ้ำ/รีเฟรชหน้า ทำให้ยอดรวมสุทธิหดลงทั้งที่รับเงินเต็มจำนวนไปแล้ว (บั๊กเดิม) ยอดค้างของบิลนี้จะเปลี่ยน
// ได้ก็ต่อเมื่อผู้ใช้กดชำระเงิน/ปิดยอดผ่านป็อปอัพบันทึกการชำระเงินเท่านั้น (ดู handleConfirmPayment) หรือกด
// "ซิงค์ผู้เช่า" เมื่อเปลี่ยนผู้เช่าห้อง (ดู syncTenantForItem) ซึ่งทั้งคู่ตั้งค่า outstandingAmount/outstandingItems
// ของบิลนี้ตรงๆ อยู่แล้ว ไม่ผ่านฟังก์ชันนี้
export function refreshDerivedFields(items: BillItem[], monthYear: string, ctx: GenCtx) {
  const defaults = resolveDefaultFormulas(ctx.formulas);
  items.forEach((item) => {
    const tenant = item.tenantId ? ctx.tenants.find((t) => String(t.id) === String(item.tenantId)) : undefined;
    recalcItem(item, ctx.config, defaults, monthYear, tenant, ctx.specialDiscounts);
  });
  return items;
}

// ── ซิงค์ข้อมูลผู้เช่าล่าสุดจาก master data เข้าแถวบิล ────────────────────────
export function syncTenantForItem(item: BillItem, ctx: GenCtx, monthYear: string): BillItem {
  const tenant = ctx.tenants.find((t) => tenantOccupiesRoom(t, { id: item.roomId, number: item.roomNumber }));
  const tenantId: string | null = tenant?.id ?? null;
  const tenantName = tenant ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() : "ว่าง";

  const changedTenant = String(item.tenantId ?? "") !== String(tenantId ?? "");

  item.tenantId = tenantId;
  item.tenantName = tenantName;
  item.tenantTitle = tenant?.title || "คุณ";
  item.residentCount = 1 + (Array.isArray(tenant?.coResidents) ? tenant.coResidents.length : 0);

  item.billTenantTagItems = tenant
    ? (tenant.tags ?? [])
        .map((tid: string) => ctx.tenantTags.find((t) => String(t.id) === String(tid)))
        .filter((t: any) => t && Number(t.price) > 0)
        .map((t: any) => ({ id: t.id, name: t.name, price: Number(t.price), color: t.color, icon: t.icon }))
    : [];

  if (changedTenant) {
    item.billVehicleItems = tenantId
      ? ctx.vehicles
          .filter((v) => String(v.customerId) === String(tenantId) && (Number(v.parkingFee) || 0) > 0)
          .map((v) => ({
            id: v.id,
            plate: v.licensePlate,
            name: `ที่จอดรถ (${v.licensePlate})${v.brand ? " - " + v.brand : ""}`,
            price: Number(v.parkingFee) || 0,
          }))
      : [];
  }

  const outstanding = getOutstandingBalance(ctx.allBills, item.roomId, monthYear, tenantId, tenantName);
  item.outstandingAmount = outstanding.amount;
  item.outstandingItems = outstanding.items;

  const defaults = resolveDefaultFormulas(ctx.formulas);
  recalcItem(item, ctx.config, defaults, monthYear, tenant, ctx.specialDiscounts);
  return item;
}

// ── แปลงจำนวนเงินเป็นตัวหนังสือไทย ("บาทถ้วน") — ใช้บนใบพิมพ์บิลแบบสวย (BillSlipPretty ใน BillsPage.tsx) ──
const THAI_DIGITS = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const THAI_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
function thaiIntegerText(n: number): string {
  if (n === 0) return "ศูนย์";
  let result = "";
  const numStr = String(n);
  const len = numStr.length;
  for (let i = 0; i < len; i++) {
    const digit = Number(numStr[i]);
    const placeFromRight = len - i - 1;
    if (digit === 0) continue;
    const place = placeFromRight % 6; // ทุก 6 หลักวนกลับมา "ล้าน" ใหม่ (ล้านล้าน ฯลฯ)
    if (place === 0 && digit === 1 && len > 1) result += "เอ็ด";
    else if (place === 1 && digit === 1) result += "สิบ";
    else if (place === 1 && digit === 2) result += "ยี่สิบ";
    else result += THAI_DIGITS[digit] + THAI_PLACES[place];
    if (placeFromRight > 0 && placeFromRight % 6 === 0) result += "ล้าน";
  }
  return result;
}
export function thaiBahtText(amount: number): string {
  const n = Math.max(0, Number(amount) || 0);
  const baht = Math.floor(n);
  const satang = Math.round((n - baht) * 100);
  const bahtText = thaiIntegerText(baht) + "บาท";
  if (satang === 0) return bahtText + "ถ้วน";
  return bahtText + thaiIntegerText(satang) + "สตางค์";
}
