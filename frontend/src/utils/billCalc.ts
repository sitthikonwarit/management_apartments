import type { AppConfig } from "../context/AppConfigContext";
import { toDisplayYear, normalizeYearToCE } from "./yearFormat";
import { tenantOccupiesRoom } from "./tenantRoom";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BillTagItem { id: string; name: string; price: number; color?: string; icon?: string }
export interface BillVehicleItem { id: string; plate: string; name: string; price: number }
export interface BillLineItem { id: string; name: string; price: number }
export interface OutstandingItem { monthYear: string; amount: number }
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
  isOverdue: boolean;
  overdueDays: number;
  total: number;
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

    // หักยอดที่จ่ายมาแล้วบางส่วนออกก่อน (ถ้ามี) ไม่งั้นเดือนถัดไปจะเรียกเก็บซ้ำเต็มจำนวน
    const amt = (Number(roomBill.total) || 0) - (Number(roomBill.paidAmount) || 0);
    if (amt > 0) {
      amount += amt;
      items.push({ monthYear: group.monthYear, amount: amt });
    }
  }
  return { amount, items };
}

// ── ปิดยอดค้างชำระเดือนก่อน ────────────────────────────────────────────────────
// ตั้งสถานะบิลเดือนเก่าที่เลือกเป็น "จ่ายแล้ว" ไปพร้อมกับการบันทึกชำระเงินของเดือนปัจจุบัน (ดูป็อปอัพ
// บันทึกการชำระเงิน) เพราะปกติ outstandingAmount ที่ยกมารวมในบิลเดือนนี้ไม่เคยไปอัปเดตสถานะบิลต้นทาง
// เดือนเก่าให้เอง ทำให้ถ้าไม่ปิดตรงนี้ ยอดเดิมจะค้างวนเป็น outstanding ซ้ำในบิลเดือนถัดๆ ไปอีก
// คืนเฉพาะกลุ่มบิลที่มีการแก้ไขจริง (ให้ผู้เรียกเอาไปเซฟทีละกลุ่มด้วย billsApi.update ต่อ)
export function closeOutstandingBills(
  allBills: BillGroup[], roomId: string, tenantId: string | null, tenantName: string, monthYears: string[]
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
    const nextData = data.map((r, i) => (i === idx ? { ...r, paidAmount: r.total, status: "paid" as const } : r));
    result.push({ group, data: nextData });
  }
  return result;
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

// ── ค่าปรับล่าช้า ──────────────────────────────────────────────────────────────
export function calculateOverdueFine(item: BillItem, overdue: AppConfig["overdue"] | undefined, monthYear: string) {
  item.fineAmount = 0;
  item.isOverdue = false;
  item.overdueDays = 0;
  if (item.status === "paid") return;
  if (!overdue?.enabled) return;

  const [mStr, yStr] = monthYear.split("/");
  const yearAD = normalizeYearToCE(parseInt(yStr, 10)); // รองรับทั้งปี พ.ศ. และ ค.ศ.
  const monthIndex = parseInt(mStr, 10) - 1;
  const dueDate = overdue.day === 0
    ? new Date(yearAD, monthIndex + 1, 0)
    : new Date(yearAD, monthIndex + 1, overdue.day);
  dueDate.setHours(23, 59, 59, 999);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (today > dueDate) {
    item.isOverdue = true;
    const diffDays = Math.ceil(Math.abs(today.getTime() - dueDate.getTime()) / 86400000);
    item.overdueDays = diffDays;
    const rawFine = overdue.type === "fixed" ? (Number(overdue.amount) || 0) : diffDays * (Number(overdue.amount) || 0);
    item.fineAmount = Math.max(0, rawFine - (Number(item.fineWaived) || 0));
  }
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
export interface WaterElectricRow {
  kind: "electric" | "electricFee" | "water" | "waterFee";
  label: string;
  unit: number;
  rate: number;
  price: number;
}

export function buildWaterElectricRows(item: BillItem): WaterElectricRow[] {
  const svc = item.serviceFeeConfig;
  const separate = !!svc?.enabled && svc.displayMode === "separate";
  const rows: WaterElectricRow[] = [];

  if (item.electricActive) {
    const fee = separate ? (Number(item.electricServiceFee) || 0) : 0;
    rows.push({ kind: "electric", label: "ค่าไฟ", unit: item.meterElectric.unit, rate: item.electricRate, price: item.priceElectric - fee });
    if (fee > 0) rows.push({ kind: "electricFee", label: "ค่าบริการไฟ", unit: item.meterElectric.unit, rate: svc!.electricRate, price: fee });
  }
  if (item.waterActive) {
    const fee = separate ? (Number(item.waterServiceFee) || 0) : 0;
    rows.push({ kind: "water", label: "ค่าน้ำ", unit: item.meterWater.unit, rate: item.waterRate, price: item.priceWater - fee });
    if (fee > 0) rows.push({ kind: "waterFee", label: "ค่าบริการน้ำ", unit: item.meterWater.unit, rate: svc!.waterRate, price: fee });
  }
  return rows;
}

// ── Recalc หนึ่งแถว (หลังแก้มิเตอร์/สูตร/รายการ) ─────────────────────────────
export function recalcItem(
  item: BillItem,
  config: AppConfig,
  defaults: { water: string; electric: string },
  monthYear: string,
  tenant?: any
) {
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
    displayMode: config.serviceFee?.displayMode === "separate" ? "separate" : "combined",
  };
  item.serviceFeeConfig = svcCfg;

  const wf = item.waterFormula || waterDefault;
  const ef = item.electricFormula || electricDefault;
  item.waterServiceFee = item.waterActive && svcCfg.enabled ? item.meterWater.unit * svcCfg.waterRate : 0;
  item.electricServiceFee = item.electricActive && svcCfg.enabled ? item.meterElectric.unit * svcCfg.electricRate : 0;
  item.priceWater = (item.waterActive ? calculateComplexPrice(item.meterWater.unit, item.waterRate, wf) : 0) + item.waterServiceFee;
  item.priceElectric = (item.electricActive ? calculateComplexPrice(item.meterElectric.unit, item.electricRate, ef) : 0) + item.electricServiceFee;
  item.priceVehicle = (item.billVehicleItems || []).reduce((s, v) => s + (Number(v.price) || 0), 0);

  calculateOverdueFine(item, overdueCfg, monthYear);
  item.total = calcItemTotal(item);
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
    recalcItem(item, ctx.config, defaults, monthYear);
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
    isOverdue: !!raw?.isOverdue,
    overdueDays: Number(raw?.overdueDays) || 0,
    total: Number(raw?.total) || 0,
    status: raw?.status === "paid" ? "paid" : "unpaid",
    paidAmount: raw?.paidAmount !== undefined
      ? Number(raw.paidAmount) || 0
      : (raw?.status === "paid" ? Number(raw?.total) || 0 : 0),
    waterDefaultFormula: raw?.waterDefaultFormula !== undefined ? String(raw.waterDefaultFormula) : undefined,
    electricDefaultFormula: raw?.electricDefaultFormula !== undefined ? String(raw.electricDefaultFormula) : undefined,
    overdueConfig: raw?.overdueConfig ? { ...raw.overdueConfig } : undefined,
    serviceFeeConfig: raw?.serviceFeeConfig ? { ...raw.serviceFeeConfig } : undefined,
    sendLogs: Array.isArray(raw?.sendLogs) ? raw.sendLogs : [],
  };
}

// ── รีเฟรชยอดค้างชำระ + ค่าปรับ + รวม ของบิลที่โหลดมาแก้ไข ─────────────────────
export function refreshDerivedFields(items: BillItem[], monthYear: string, ctx: GenCtx) {
  const defaults = resolveDefaultFormulas(ctx.formulas);
  items.forEach((item) => {
    const outstanding = getOutstandingBalance(ctx.allBills, item.roomId, monthYear, item.tenantId, item.tenantName);
    item.outstandingAmount = outstanding.amount;
    item.outstandingItems = outstanding.items;
    const tenant = item.tenantId ? ctx.tenants.find((t) => String(t.id) === String(item.tenantId)) : undefined;
    recalcItem(item, ctx.config, defaults, monthYear, tenant);
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
  recalcItem(item, ctx.config, defaults, monthYear, tenant);
  return item;
}
