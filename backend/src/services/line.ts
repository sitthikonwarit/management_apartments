// ── ส่งบิลแจ้งเตือนทาง LINE (LINE Messaging API — Push Message) ──────────────────
// ตั้งค่า Channel Access Token + เปิด/ปิดใช้งานได้จากหน้า Settings (ตาราง app_config)
// ใช้ทั้งตอนกดส่งเอง (bills.ts: POST /bills/:id/send-line) และตอนส่งอัตโนมัติตามวันนัด (runLineAutoSend)
import { and, eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import { db } from "../db";
import { appConfig, bills, chatMessages, lineProfiles, payments, tenants } from "../db/schema";
import { broadcastChange } from "../lib/wsHub";
import { listAllOrgIds } from "../lib/orgContext";
import { decryptField, signUploadPath } from "../lib/encryption";

const LINE_PROFILE_VERIFY_URL = "https://api.line.me/v2/profile";

// ตรวจสอบ LIFF access token ของผู้ใช้ (จาก liff.getAccessToken() ฝั่ง frontend) กับ LINE โดยตรง — ไม่เชื่อ
// lineUserId ที่ client ส่งมาตรงๆ (ปลอมง่าย) ต้องให้ LINE เป็นคนยืนยันตัวตนคืน userId ที่แท้จริงมาให้เท่านั้น
// ใช้ตอนผู้เช่าเปิดหน้า LIFF Login/Payment (ดู routes/liff.ts) คืนค่า null ถ้า token ไม่ถูกต้อง/หมดอายุ
export async function verifyLiffAccessToken(accessToken: string): Promise<{ userId: string; displayName: string; pictureUrl: string } | null> {
  try {
    const res = await fetch(LINE_PROFILE_VERIFY_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.userId) return null;
    return { userId: String(data.userId), displayName: String(data.displayName ?? ""), pictureUrl: String(data.pictureUrl ?? "") };
  } catch {
    return null;
  }
}

// แปลง "MM/YYYY" เป็นตัวเลขเทียบลำดับได้ (พอร์ตมาจาก frontend/src/utils/billCalc.ts myScore())
function myScore(my: string): number {
  const [m, y] = (my || "").split("/");
  return (parseInt(y, 10) || 0) * 100 + (parseInt(m, 10) || 0);
}

// ยอดของบิลใบนี้ "เฉพาะของเดือนนี้เอง" ไม่นับยอดค้างชำระที่ยกมาจากเดือนก่อนหน้า (item.outstandingAmount ที่ถูก
// ฝังรวมไว้ใน item.total ตอนสร้าง/รีเฟรชบิลฝั่งแอดมิน — ดู getOutstandingBalance ใน
// frontend/src/utils/billCalc.ts) เดือนก่อนที่ยังค้างอยู่จริงจะถูกนับซ้ำไปเรื่อยๆ ทุกเดือนถัดไปที่ยังไม่จ่าย
// (เดือนถัดไปจะยกยอดของเดือนนี้ที่ "รวมยอดยกมา" ไปแล้วมาบวกซ้ำอีกที) ทำให้ยอดพอกพูนทวีคูณผิดความจริงยิ่งค้าง
// จ่ายนานเท่าไหร่ — ฝั่งผู้เช่า (LIFF/บิลอิเล็กทรอนิกส์ LINE) จึงต้องใช้ยอดเฉพาะเดือนนั้นๆ เท่านั้น ส่วนเดือนก่อน
// ที่ยังค้างอยู่จะแยกไปแสดงเป็นรายการของตัวเองต่างหาก (ดู getOutstandingBillsForTenant ด้านล่าง) จ่ายแยกอิสระ
// ต่อบิลได้อยู่แล้วจากรายการนั้น ไม่ต้องพึ่งยอดที่ยกมารวมในบิลใหม่ล่าสุดอีกต่อไป
function ownChargeAmount(item: any): number {
  return (Number(item?.total) || 0) - (Number(item?.outstandingAmount) || 0);
}

// ตัดยอดค้างชำระยกมาออกจากบิลก่อนส่งให้ผู้เช่าดู (หน้า LIFF Payment/Profile + "บิลอิเล็กทรอนิกส์ (LINE)" ที่
// ใช้ BillLinePreview เรนเดอร์) ไม่กระทบข้อมูลจริงที่บันทึกในฐานข้อมูล (แค่ปรับสำเนาก่อนส่งออกเท่านั้น ฝั่ง
// แอดมินยังเห็นยอดเต็มตามปกติในหน้า Bills) — บิลที่ "จ่ายแล้ว" ไม่ปรับ เพราะยอดที่บันทึกไว้คือยอดจริงที่เรียก
// เก็บ/จ่ายไปแล้วตอนนั้น (ประวัติ ไม่ใช่ยอดที่ยังต้องตัดสินใจจ่ายอีก)
function stripCarriedOutstanding(item: any) {
  if (item?.status === "paid") return item;
  return { ...item, total: ownChargeAmount(item), outstandingAmount: 0, outstandingItems: [] };
}

export interface OutstandingBillItem {
  billId: string;
  roomId: string;
  monthYear: string;
  roomNumber: string;
  total: number;
  paidAmount: number;
  amount: number;
}

// ยอดค้างชำระทั้งหมดของผู้เช่าคนหนึ่ง (ทุกบิลที่ยังไม่จ่ายครบ ไม่จำกัดแค่เดือนก่อนหน้า) — ใช้ทั้งจากหน้า
// แชท (routes/chat.ts) และหน้า LIFF Payment (routes/liff.ts) เลยแยกมาไว้ที่เดียวกันไม่ให้ query ต่างกัน
export async function getOutstandingBillsForTenant(orgId: string, tenantId: string): Promise<{ items: OutstandingBillItem[]; total: number }> {
  const billRows = await db.select().from(bills).where(eq(bills.orgId, orgId));
  const items: OutstandingBillItem[] = [];
  for (const row of billRows) {
    let data: any[] = [];
    try { data = row.data ? JSON.parse(row.data) : []; } catch { data = []; }
    for (const item of data) {
      if (String(item?.tenantId ?? "") !== tenantId) continue;
      const total = ownChargeAmount(item);
      const paidAmount = Number(item?.paidAmount) || 0;
      const amount = total - paidAmount;
      if (amount > 0.005) {
        items.push({ billId: row.id, roomId: String(item?.roomId ?? ""), monthYear: row.monthYear, roomNumber: String(item?.roomNumber ?? ""), total, paidAmount, amount });
      }
    }
  }
  items.sort((a, b) => myScore(b.monthYear) - myScore(a.monthYear));
  const total = items.reduce((sum, it) => sum + it.amount, 0);
  return { items, total };
}

export interface TenantBillSummary {
  billId: string;
  roomId: string;
  monthYear: string;
  roomNumber: string;
  total: number;
  paidAmount: number;
  status: string;
}

// บิลทุกใบของผู้เช่าคนหนึ่ง (ทั้งจ่ายแล้วและยังไม่จ่าย) เรียงใหม่ไปเก่า — ใช้ในหน้า LIFF Profile ให้ผู้เช่า
// ดูประวัติบิลของตัวเองย้อนหลังได้ทั้งหมด ต่างจาก getOutstandingBillsForTenant ที่กรองเอาแต่ใบที่ค้างอยู่
export async function getAllBillsForTenant(orgId: string, tenantId: string): Promise<TenantBillSummary[]> {
  const billRows = await db.select().from(bills).where(eq(bills.orgId, orgId));
  const result: TenantBillSummary[] = [];
  for (const row of billRows) {
    let data: any[] = [];
    try { data = row.data ? JSON.parse(row.data) : []; } catch { data = []; }
    for (const item of data) {
      if (String(item?.tenantId ?? "") !== tenantId) continue;
      // บิลที่ยังไม่จ่าย: โชว์ยอดเฉพาะเดือนนั้นๆ เอง (ไม่รวมยอดยกมาจากเดือนก่อน กันนับซ้ำ — ดู
      // stripCarriedOutstanding) ให้ตรงกับยอดที่เห็นตอนกดเข้าไปดูรายละเอียดบิลใบเดียวกัน (getBillItemForTenant)
      // ส่วนบิลที่จ่ายแล้วคงยอดจริงตามประวัติไว้เหมือนเดิม
      const isPaid = item?.status === "paid";
      result.push({
        billId: row.id,
        roomId: String(item?.roomId ?? ""),
        monthYear: row.monthYear,
        roomNumber: String(item?.roomNumber ?? ""),
        total: isPaid ? Number(item?.total) || 0 : ownChargeAmount(item),
        paidAmount: Number(item?.paidAmount) || 0,
        status: String(item?.status ?? "unpaid"),
      });
    }
  }
  result.sort((a, b) => myScore(b.monthYear) - myScore(a.monthYear));
  return result;
}

export interface TenantPaymentRecord {
  id: string;
  paymentDate: string;
  monthYear: string;
  roomNumber: string;
  method: string;
  amount: number;
  note: string;
  slipUrl: string;
  cancelled: boolean;
}

// ประวัติการชำระเงินทุกรายการของผู้เช่าคนหนึ่ง เรียงใหม่ไปเก่า — ใช้ในหน้า LIFF Profile
export async function getPaymentHistoryForTenant(orgId: string, tenantId: string): Promise<TenantPaymentRecord[]> {
  const rows = await db.select().from(payments).where(and(eq(payments.orgId, orgId), eq(payments.tenantId, tenantId)));
  const result: TenantPaymentRecord[] = rows.map((r) => {
    let data: any = {};
    try { data = r.data ? JSON.parse(r.data) : {}; } catch { data = {}; }
    return {
      id: r.id,
      paymentDate: r.paymentDate,
      monthYear: String(data?.monthYear ?? ""),
      roomNumber: String(data?.roomNumber ?? ""),
      method: String(data?.method ?? ""),
      amount: Number(data?.amount) || 0,
      note: String(data?.note ?? ""),
      slipUrl: String(data?.slipUrl ?? ""),
      cancelled: !!data?.cancelled,
    };
  });
  result.sort((a, b) => new Date(b.paymentDate || 0).getTime() - new Date(a.paymentDate || 0).getTime());
  return result;
}

// ดึงรายการห้องหนึ่งรายการในบิลกลุ่มหนึ่ง พร้อมตรวจว่าเป็นของผู้เช่าคนนี้จริง (กันผู้เช่าคนอื่นดู/จ่ายบิล
// ของคนอื่นได้แค่เดา billId/roomId) — ใช้ในหน้า LIFF Payment ทั้งตอนดูรายละเอียดบิลและตอนสร้าง QR ชำระเงิน
export async function getBillItemForTenant(orgId: string, billId: string, roomId: string, tenantId: string): Promise<{ item: any; monthYear: string } | null> {
  const [row] = await db.select().from(bills).where(and(eq(bills.id, billId), eq(bills.orgId, orgId)));
  if (!row) return null;
  let data: any[] = [];
  try { data = row.data ? JSON.parse(row.data) : []; } catch { data = []; }
  const item = data.find((it) => String(it?.roomId) === roomId);
  if (!item || String(item?.tenantId ?? "") !== tenantId) return null;
  return { item: stripCarriedOutstanding(item), monthYear: row.monthYear };
}

// ถอดรหัสเลขบัตร ปชช./ที่อยู่ (เข้ารหัสไว้ในฐานข้อมูล — ดู lib/encryption.ts) ก่อนคืนแถวผู้เช่าออกจากไฟล์นี้
// เสมอ — findTenantByLineUserId/findTenantsByPhone คืนแถวดิบตรงๆ ไม่ผ่าน parseTenant() ของ routes/tenants.ts
// (เช่น routes/liff.ts /profile/full ต้องใช้ tenant.idLicense ที่ถอดรหัสแล้วมาตัดเอา 4 ตัวท้ายเทียบยืนยันตัวตน)
function decryptTenantRow<T extends { idLicense: string | null; houseNo: string | null; soi: string | null; road: string | null; province: string | null; amphoe: string | null; tambon: string | null; zipcode: string | null; address: string | null }>(t: T): T {
  return {
    ...t,
    idLicense: decryptField(t.idLicense ?? ""),
    houseNo: decryptField(t.houseNo ?? ""),
    soi: decryptField(t.soi ?? ""),
    road: decryptField(t.road ?? ""),
    province: decryptField(t.province ?? ""),
    amphoe: decryptField(t.amphoe ?? ""),
    tambon: decryptField(t.tambon ?? ""),
    zipcode: decryptField(t.zipcode ?? ""),
    address: decryptField(t.address ?? ""),
  };
}

// หาผู้เช่าที่ผูก lineUserId นี้ไว้ (ผู้ทำสัญญาหลักหรือผู้ร่วมพักอาศัยก็ได้) — ไม่เจอคืน null เฉยๆ
// ใช้ทั้งใน webhook (หาชื่อผู้ส่ง) และหน้าแชท (หาบิลค้างชำระของ tenant ที่ผูกกับ conversation นี้)
export async function findTenantByLineUserId(orgId: string, lineUserId: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.orgId, orgId));
  for (const t of rows) {
    if ((t.lineUserId ?? "").trim() === lineUserId) return decryptTenantRow(t);
    try {
      const coResidents = t.coResidents ? JSON.parse(t.coResidents) : [];
      if (Array.isArray(coResidents) && coResidents.some((c: any) => String(c?.lineId ?? "").trim() === lineUserId)) {
        return decryptTenantRow(t);
      }
    } catch {
      // co-residents parse ไม่ได้ ข้ามไปเช็คคนถัดไป
    }
  }
  return null;
}

// เหลือแต่ตัวเลข + ปรับรูปแบบเบอร์ไทยให้เทียบกันได้ (คนละฟอร์แมต เช่น "081-234-5678" กับ "0812345678"
// หรือ "66812345678" ต้องนับเป็นเบอร์เดียวกัน) ใช้ตอนผู้เช่าพิมพ์เบอร์เข้ามาผูกบัญชี LINE เอง (ดู
// findTenantsByPhone ด้านล่าง + routes/liff.ts)
function normalizePhone(raw: string): string {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length === 11) digits = "0" + digits.slice(2);
  return digits;
}

// หาผู้เช่าทั้งหมดที่เบอร์โทร (tenants.tel) ตรงกับเบอร์ที่กรอกมา — ปกติควรเจอแค่คนเดียว (1 เบอร์ต่อ 1 คน)
// แต่คืนเป็น array เผื่อข้อมูลเดิมมีเบอร์ซ้ำกันหลายคน ให้ผู้เรียกตัดสินใจว่าจะปฏิเสธ/แจ้งเตือนอย่างไร
export async function findTenantsByPhone(orgId: string, phone: string) {
  const target = normalizePhone(phone);
  if (!target) return [];
  const rows = await db.select().from(tenants).where(eq(tenants.orgId, orgId));
  return rows.filter((t) => normalizePhone(t.tel || "") === target).map(decryptTenantRow);
}

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_PROFILE_URL = "https://api.line.me/v2/bot/profile";
const LINE_CONTENT_URL = "https://api-data.line.me/v2/bot/message";
const LINE_BOT_INFO_URL = "https://api.line.me/v2/bot/info";

// ดึง LINE User ID ของบอทเจ้าของ channel access token นี้เอง — เรียกตอนบันทึกการตั้งค่า LINE Messaging ใน
// หน้า Settings (ดู routes/settings.ts) เพื่อแคชไว้ที่ appConfig.lineBotUserId ใช้จับคู่ payload.destination
// ที่ LINE Webhook ส่งมากับองค์กรเจ้าของช่องทางจริง (ดู resolveOrgIdByDestination ใน lib/orgContext.ts)
// best-effort เฉยๆ (คืน null ถ้า token ผิด/เรียกไม่สำเร็จ) ไม่ควรบล็อกการบันทึกค่าตั้งค่าอื่นๆ
export async function getBotUserId(token: string): Promise<string | null> {
  try {
    const res = await fetch(LINE_BOT_INFO_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.userId ? String(data.userId) : null;
  } catch {
    return null;
  }
}

// id ของแถว app_config "คือ" orgId ตรงๆ (เดิมเป็น sentinel "default" แถวเดียวทั้งระบบ — ดูคอมเมนต์ที่
// ตาราง appConfig ใน db/schema.ts) แถวไม่มี = องค์กรนี้ยังไม่เคยเปิดหน้า Settings เลย ใช้ค่าเริ่มต้นทั้งหมด
export async function getLineSettings(orgId: string) {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, orgId));
  return {
    enabled: row?.lineMessagingEnabled === "true",
    autoSendEnabled: row?.lineAutoSendEnabled === "true",
    // token/channelSecret เข้ารหัสไว้ในฐานข้อมูล (ดู lib/encryption.ts) ต้องถอดรหัสตรงนี้ — chokepoint
    // เดียวที่ทุก route (lineWebhook.ts, chat.ts, ส่งบิล) เรียกอ่านค่าตั้งค่า LINE Messaging ผ่าน
    token: decryptField(row?.lineChannelAccessToken ?? ""),
    channelSecret: decryptField(row?.lineChannelSecret ?? ""),
    appName: row?.appName ?? "",
    logoUrl: row?.logoUrl ?? "",
    yearFormat: (row?.yearFormat === "CE" ? "CE" : "BE") as "BE" | "CE",
    splitRentByResidents: row?.splitRentByResidents === "true",
    sendBillToCoResidents: row?.lineSendBillToCoResidents !== "false",
    liffPaymentUrl: row?.liffPaymentUrl ?? "",
  };
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
}

// สีต้องตรงกับตัวแปร CSS ในหน้าเว็บ (frontend/src/App.css :root) เพราะ Flex Message ฝัง hex ตรงๆ ไม่ได้อ่าน CSS var
const COLOR_PRIMARY = "#6C9BCF";
const COLOR_TEXT = "#333333";
const COLOR_MUTED = "#888888";
const COLOR_RED = "#FF0060";
const COLOR_SUCCESS = "#1B9C85";
const BG_BODY = "#FAFAFA";
const BG_FINE = "#FFE1EC"; // พื้นหลังสีแดงอ่อน (ค่าปรับ/ค้างชำระ) — Flex ไม่รองรับ rgba จึงใช้ hex ทึบที่ใกล้เคียง

// ไอคอนจาก icons8 (CDN สาธารณะ, URL https:// จริง) — ใช้แทนอิโมจิ/กล่องสีเพราะ LINE เรนเดอร์อิโมจิเดี่ยวๆ
// ใหญ่ผิดสัดส่วนแบบ "สติกเกอร์" และปฏิเสธ backgroundColor/cornerRadius ที่ผิดรูปแบบบนกล่องซ้อนลึก (ดู
// คอมเมนต์เก่าที่เคยพังด้วย error "invalid property") รูปโลโก้ของระบบเองเป็น base64 (ดู isUsableImageUrl
// ด้านล่าง) จึงใช้ไม่ได้กับ LINE โดยตรง — ไอคอน "บ้าน" นี้เป็น fallback สาธารณะสำหรับหัวข้อความแทน
const ICONS = {
  HOME: "https://img.icons8.com/fluency/96/home.png",
  BED: "https://img.icons8.com/fluency/96/bedroom.png",
  ELEC: "https://img.icons8.com/color/48/flash-on.png",
  WATER: "https://img.icons8.com/fluency/96/water.png",
  CAR: "https://img.icons8.com/fluency/96/car.png",
  PLUS: "https://img.icons8.com/fluency/96/plus-math.png",
  TAG: "https://img.icons8.com/fluency/96/price-tag.png",
  USER: "https://img.icons8.com/fluency/96/user-group-man-man.png",
  FINE: "https://img.icons8.com/fluency/96/high-priority.png",
  DISCOUNT: "https://img.icons8.com/fluency/48/discount.png",
  RECEIPT: "https://img.icons8.com/fluency/96/receipt.png",
  CASH: "https://img.icons8.com/fluency/96/money.png",
  SCAN: "https://img.icons8.com/fluency/96/qr-code.png",
  CALENDAR: "https://img.icons8.com/fluency/96/calendar.png",
  NOTE: "https://img.icons8.com/fluency/96/note.png",
  // ตราปั๊มขอบหยักทรงเหรียญตรา (ขอบซิกแซกแบบตราประทับจริง) สีตามพารามิเตอร์ hex ใน URL (icons8 รองรับ)
  // ใช้เป็นฐานของตราประทับ "ชำระเรียบร้อย" แทนไอคอนตรายางสำเร็จรูป เพราะต้องเขียนข้อความไทยเองทับ
  // ด้านล่างเครื่องหมายถูก จะฝังไปกับรูปภาพสำเร็จรูปไม่ได้
  STAMP_FAINT_RED: "https://img.icons8.com/fluency-systems-regular/200/ff8fab/verified-badge.png",
};

// สีแดงจางๆ ของตราประทับ+ตัวหนังสือ "ชำระเรียบร้อย" (ต้องตรงกับ hex ใน URL ของ ICONS.STAMP_FAINT_RED ด้านบน)
const COLOR_WATERMARK = "#FF8FAB";

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

// พอร์ตมาจาก frontend/src/utils/billCalc.ts monthYearLabel() — ต้องคำนวณ พ.ศ./ค.ศ. ตาม yearFormat
// เดียวกับที่ตั้งไว้ในหน้าตั้งค่า ไม่งั้นเดือน/ปีที่โชว์ในบิล LINE จะไม่ตรงกับตัวอย่างในหน้าเว็บ
function monthYearLabel(my: string, yearFormat: "BE" | "CE") {
  if (!my) return "";
  const [m, y] = my.split("/");
  const yearCE = parseInt(y, 10) || 0;
  const yearOut = yearFormat === "CE" ? yearCE : yearCE + 543;
  return `${THAI_MONTHS[parseInt(m, 10) - 1] ?? m} ${yearOut}`;
}

// พอร์ตมาจาก dueDateLabel() ในหน้า BillsPage.tsx — ใช้ overdueConfig ที่แช่แข็งไว้กับตัวบิลแต่ละใบ
function dueDateLabel(overdueConfig: any) {
  const day = Number(overdueConfig?.day ?? 5);
  return day === 0 ? "กำหนดชำระภายในสิ้นเดือน" : `กำหนดชำระภายในวันที่ ${day} ของเดือน`;
}

// วันที่ (ISO "YYYY-MM-DD" จาก ThaiDatePicker) เป็นข้อความไทย ตาม yearFormat เดียวกับที่อื่นในไฟล์นี้
function thaiDateLabel(dateStr: string, yearFormat: "BE" | "CE") {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const yearOut = yearFormat === "CE" ? d.getFullYear() : d.getFullYear() + 543;
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${yearOut}`;
}

// ขนาดไอคอน — ลดลงจาก "xs" มาเป็น "xxs" (เล็กสุดของ keyword Flex) ตามที่ปรับ
const ICON_SIZE = "xxs";
const ICON_SIZE_HIGHLIGHT = "14px"; // เดิมก็เล็กสุด ("xxs") อยู่แล้ว ลดต่อด้วยพิกเซลตรงๆ
const ICON_SIZE_HEADER = "xxs";

// แถวรายการปกติ (ค่าห้อง/แท็ก/รายการอื่นๆ/รถ) — ไอคอนรูปจริง + ชื่อรายการ + ยอด ในบรรทัดเดียว
// isMoney=false ใช้กับแถวข้อมูลทั่วไปที่ไม่ใช่จำนวนเงิน (เช่น ช่องทาง/วันที่ ในใบเสร็จ) — ไม่ต่อ "฿" ต่อท้าย
// amountText ว่าง = ไม่แสดงคอลัมน์ขวาเลย (ใช้กับแถวข้อความล้วน เช่น "ชำระครบถ้วนแล้ว")
function createFlexRow(label: string, amountText: string, color: string, iconUrl: string, isMoney = true) {
  const contents: any[] = [
    { type: "image", url: iconUrl, size: ICON_SIZE, aspectRatio: "1:1", flex: 0 },
    { type: "text", text: label, size: "sm", color, margin: "sm", flex: 1, wrap: true },
  ];
  if (amountText) {
    contents.push({ type: "text", text: isMoney ? `${amountText} ฿` : amountText, size: "sm", color, align: "end" });
  }
  return { type: "box", layout: "horizontal", margin: "md", alignItems: "center", contents };
}

// แถวมิเตอร์ (ค่าไฟ/ค่าน้ำ) — เหมือน createFlexRow แต่มีบรรทัดย่อยบอกเลขมิเตอร์เก่า/ใหม่ + ราคาต่อหน่วย
function createFlexMeterRow(label: string, unitText: string, meterDetail: string, amountText: string, iconUrl: string) {
  return {
    type: "box", layout: "horizontal", margin: "md", alignItems: "center",
    contents: [
      { type: "image", url: iconUrl, size: ICON_SIZE, aspectRatio: "1:1", flex: 0 },
      {
        type: "box", layout: "vertical", margin: "sm", flex: 1,
        contents: [
          { type: "text", text: `${label} ${unitText}`, size: "sm", color: COLOR_TEXT, wrap: true },
          { type: "text", text: meterDetail, size: "xxs", color: COLOR_MUTED, wrap: true, margin: "xs" },
        ],
      },
      { type: "text", text: `${amountText} ฿`, size: "sm", color: COLOR_TEXT, align: "end" },
    ],
  };
}

// แถวไฮไลต์พื้นหลังชมพู (ค่าปรับ/ยอดค้างชำระ) — ทรงเดียวกับกล่อง rgba(255,0,96,0.08) ใน BillLinePreview
// หมายเหตุ: เดิม cornerRadius/paddingAll เคยใส่เป็นพิกเซล ("8px") ทำให้ LINE API ปฏิเสธทั้งข้อความ
// (error "invalid property" ที่ backgroundColor แม้ตัวการจริงคือ cornerRadius) ต้องใช้คีย์เวิร์ด (sm/md/...) เท่านั้น
// amountText ว่าง = ไม่แสดงคอลัมน์ขวา (ใช้กับข้อความล้วน เช่น "ชำระครบถ้วนแล้ว" ในใบเสร็จที่ไม่มีตัวเลขคู่)
function createFlexHighlightRow(label: string, amountText: string, iconUrl: string = ICONS.FINE) {
  const contents: any[] = [
    { type: "image", url: iconUrl, size: ICON_SIZE_HIGHLIGHT, aspectRatio: "1:1", flex: 0 },
    { type: "text", text: label, size: "sm", weight: "bold", color: COLOR_RED, margin: "sm", flex: 1, wrap: true },
  ];
  if (amountText) {
    contents.push({ type: "text", text: `${amountText} ฿`, size: "sm", weight: "bold", color: COLOR_RED, align: "end" });
  }
  return {
    type: "box", layout: "horizontal", margin: "md", backgroundColor: BG_FINE, cornerRadius: "md", paddingAll: "sm", alignItems: "center",
    contents,
  };
}

// ตราประทับขอบหยักสีแดงจางๆ เขียนว่า "ชำระเรียบร้อย" ทับบนเนื้อหาใบเสร็จ (เหมือนตรายางทรงเหรียญตราบนใบเสร็จกระดาษจริง)
// — กล่องนอกวาง position: "absolute" ให้ลอยอยู่เหนือแถวข้อมูลปกติโดยไม่ไปเบียดเลย์เอาต์ (แถวอื่นๆ จัดเรียง
// เหมือนไม่มีกล่องนี้อยู่) ข้างในมีตราขอบหยัก+เครื่องหมายถูกจางๆ (ICONS.STAMP_FAINT_RED) เป็นฐาน แล้ววางข้อความไทย
// ทับด้านล่างเครื่องหมายถูกอีกที ด้วย position: "absolute" อีกชั้น (อ้างอิงจากมุมบนซ้ายของกล่องนอกเดียวกัน) —
// ข้อความอยู่ต่ำกว่าเครื่องหมายถูก (ไม่ทับกึ่งกลาง) เพราะไอคอนมีเครื่องหมายถูกวางอยู่แล้วช่วงกลางตรา
function createPaidWatermark() {
  return {
    type: "box", layout: "vertical", position: "absolute",
    offsetTop: "18%", offsetStart: "25%", width: "50%",
    contents: [
      { type: "image", url: ICONS.STAMP_FAINT_RED, size: "full", aspectRatio: "1:1", aspectMode: "fit" },
      {
        type: "text", text: "ชำระเรียบร้อย", weight: "bold", size: "xs", color: COLOR_WATERMARK,
        align: "center", wrap: true, position: "absolute", offsetTop: "68%", offsetStart: "8%", offsetEnd: "8%",
      },
    ],
  };
}

// URL รูปโลโก้ที่ตั้งค่าไว้ในหน้าตั้งค่าปกติจะเป็น base64 data URI (อัปโหลดแล้วเก็บตรงๆ ไม่มี endpoint แยก)
// ซึ่ง LINE Flex Message component "image" รองรับเฉพาะ URL https:// ที่เซิร์ฟเวอร์ LINE ดึงได้จริงเท่านั้น
// ฝัง data: URI ไปจะทำให้ LINE API ปฏิเสธข้อความทั้งฉบับ จึงต้องกรองให้เหลือแต่ URL ที่ใช้ได้จริงก่อนเสมอ
// (ถ้าไม่มี URL จริงใช้ ICONS.HOME แทน — ยังเป็นไอคอนจริง ไม่ใช่ตัวอักษร/อิโมจิ)
function isUsableImageUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

// path สลิปที่อัปโหลดถูกเก็บเป็น path สัมพัทธ์เสมอ (เช่น "/uploads/payments/xxx.jpg" ดู uploadPaymentSlip
// ใน routes/bills.ts) เพราะ frontend พร็อกซี /uploads ไปที่ backend เอง แต่ปุ่ม "uri" action ของ LINE ต้องเป็น
// URL แบบเต็มที่เซิร์ฟเวอร์ LINE (และมือถือผู้เช่า) เปิดได้จริงจากนอกวง LAN — ต้องตั้ง PUBLIC_BASE_URL ใน .env
// ชี้ไปที่โดเมน/URL สาธารณะของระบบก่อนปุ่มถึงจะโชว์ ถ้าไม่ได้ตั้งไว้จะไม่แสดงปุ่มเลย (เหมือน isUsableImageUrl
// ด้านบนที่ต้องกรอง URL ที่ไม่ใช่ https:// ทิ้งเช่นกัน)
function resolveSlipUrl(slipUrl: string | undefined): string {
  return toPublicUrl(slipUrl ?? "");
}

// ตัวช่วยกลาง — แปลง path สัมพัทธ์ (เช่น "/uploads/chat/xxx.jpg") เป็น URL เต็มโดยเติม PUBLIC_BASE_URL
// (ใช้ร่วมกันทั้งปุ่ม "ดูสลิป" ในใบเสร็จ และรูปภาพ/ไฟล์แนบที่พนักงานส่งผ่านหน้าแชท) ถ้าเป็น URL https:// อยู่แล้ว
// (เช่นโลโก้ที่กรอกเป็นลิงก์ตรงๆ) คืนค่าเดิมไม่แตะต้อง ถ้าไม่มี PUBLIC_BASE_URL ตั้งไว้ คืนค่าว่าง (ไม่ส่งลิงก์
// ที่ LINE/มือถือผู้เช่าเปิดไม่ได้จริงออกไป)
export function toPublicUrl(path: string): string {
  if (!path) return "";
  if (isUsableImageUrl(path)) return path;
  // เซ็นลายเซ็นก่อนต่อ PUBLIC_BASE_URL เสมอ (ดู lib/encryption.ts) — signUploadPath เองจะข้าม path ที่ไม่ใช่
  // /uploads/... ให้อัตโนมัติอยู่แล้ว (เผื่อ path หน้าตาแปลกๆ ที่ไม่ใช่ URL https แต่ก็ไม่ใช่ path อัปโหลดจริง)
  const signedPath = signUploadPath(path);
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!isUsableImageUrl(`${base}/`)) return "";
  return `${base}${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
}

interface LineAppearanceSettings {
  appName: string;
  logoUrl: string;
  yearFormat: "BE" | "CE";
  splitRentByResidents: boolean;
  liffPaymentUrl: string;
}

// สร้าง Flex Message ใบแจ้งค่าเช่า จากข้อมูลห้องหนึ่งห้อง (BillItem ฝั่ง frontend/billCalc.ts) — ไม่ฝังตัวเลข
// รายละเอียด/ยอดสุทธิลงในข้อความที่ส่งไปแล้วโดยตรง (เดิมเคยฝังไว้ทั้งหมด) เพราะถ้าพนักงานแก้ไขบิล (เช่น
// แก้เลขมิเตอร์ผิด/ปรับส่วนลด) หลังส่งไปแล้ว ตัวเลขในแชทที่ผู้เช่าเห็นจะค้างเป็นค่าเก่าที่ผิดไปตลอดกาล — เปลี่ยน
// เป็นการ์ดแจ้งเตือนสั้นๆ + ปุ่มลิงก์ไปหน้า LIFF Payment (พร้อม billId/roomId ใน query string ให้เปิดตรงไปที่
// รายละเอียดบิลใบนี้ทันที ดู handling ฝั่ง frontend ใน LiffPaymentPage.tsx) ซึ่งดึงข้อมูลบิลสดจาก DB ทุกครั้งที่
// กดเข้าไปดู รับประกันว่าเห็นเลขล่าสุดเสมอ ไม่มีทางค้างเป็นค่าเก่า
function buildBillFlexMessage(item: any, monthYear: string, settings: LineAppearanceSettings, billId: string) {
  const monthLabel = monthYearLabel(monthYear, settings.yearFormat);
  const logoUrl = isUsableImageUrl(settings.logoUrl) ? settings.logoUrl : ICONS.HOME;
  const detailUrl = `${settings.liffPaymentUrl}${settings.liffPaymentUrl.includes("?") ? "&" : "?"}billId=${encodeURIComponent(billId)}&roomId=${encodeURIComponent(String(item.roomId ?? ""))}`;

  return {
    type: "flex",
    altText: `แจ้งบิลค่าเช่าห้อง ${item.roomNumber} ประจำเดือน ${monthLabel} — กดดูรายละเอียดในแชท`,
    contents: {
      type: "bubble",
      size: "giga", // ขยายบับเบิลให้กว้างสุดที่ Flex Message รองรับ (เต็มความกว้างจอมือถือ)
      header: {
        type: "box", layout: "vertical", backgroundColor: COLOR_PRIMARY, paddingAll: "20px",
        contents: [
          {
            type: "box", layout: "horizontal", alignItems: "center",
            contents: [
              { type: "image", url: logoUrl, size: ICON_SIZE_HEADER, aspectRatio: "1:1", flex: 0 },
              { type: "text", text: " แจ้งค่าเช่าห้อง", weight: "bold", color: "#ffffff", size: "xl", margin: "md" },
            ],
          },
          { type: "text", text: `${item.tenantTitle || "คุณ"} ${item.tenantName || "-"}`, weight: "bold", color: "#ffffff", size: "lg", margin: "md" },
          { type: "text", text: `ห้อง ${item.roomNumber} (ประจำเดือน ${monthLabel})`, color: "#ffffffcc", size: "sm", margin: "sm" },
        ],
      },
      body: {
        type: "box", layout: "vertical", backgroundColor: BG_BODY, paddingAll: "20px", alignItems: "center",
        contents: [
          { type: "image", url: ICONS.RECEIPT, size: "xl", aspectRatio: "1:1", aspectMode: "fit" },
          { type: "text", text: "บิลค่าเช่าของคุณพร้อมแล้ว", weight: "bold", size: "md", color: COLOR_TEXT, align: "center", margin: "lg", wrap: true },
          { type: "text", text: "กดปุ่มด้านล่างเพื่อดูรายละเอียดค่าใช้จ่ายและยอดที่ต้องชำระล่าสุด", size: "sm", color: COLOR_MUTED, align: "center", margin: "sm", wrap: true },
          { type: "separator", margin: "lg", color: "#E0E0E0" },
          { type: "text", text: dueDateLabel(item.overdueConfig), size: "xs", color: COLOR_MUTED, align: "center", margin: "lg" },
        ],
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "12px",
        contents: [
          {
            type: "button", style: "primary", height: "md", color: COLOR_PRIMARY,
            action: { type: "uri", label: "ดูรายละเอียดบิล & ชำระเงิน", uri: detailUrl },
          },
        ],
      },
    },
  };
}

// สรุปข้อมูลบิลเป็น JSON เก็บลงประวัติแชท (chat_messages.text ตอน messageType="bill") ให้หน้าแชทฝั่งเว็บ
// เรนเดอร์เป็นการ์ดหน้าตาเหมือนบิลที่ส่งจริงทาง LINE (ดู buildBillFlexMessage ด้านบน) แถวรายการ/ยอด/เงื่อนไข
// ต้องตรงกับที่นั่นเป๊ะๆ ต่างกันแค่ใช้ไอคอน FontAwesome (เว็บเรามีอยู่แล้ว) แทนรูปไอคอนของ Flex Message
// export ไว้ให้ routes/liff.ts ใช้ต่อ (หน้า LIFF Payment "ดูรายละเอียดบิล" เรนเดอร์ด้วยคอมโพเนนต์
// ChatBillMessage ตัวเดียวกับที่หน้าแชทใช้ หน้าตาต้องตรงกันเป๊ะๆ จึงใช้ shape/ตัวสร้างข้อมูลตัวเดียวกัน)
export function buildChatBillSnapshot(item: any, monthYear: string, settings: LineAppearanceSettings) {
  const rows: { icon: string; name: string; sub?: string; price: number }[] = [];
  rows.push({ icon: ICONS.BED, name: "ค่าห้อง/ค่าเช่า", price: Number(item.priceRoom) || 0 });
  // ค่าบริการต่อหน่วย (ถ้าเปิดใช้งาน) รวมอยู่ใน priceElectric/priceWater แล้วเสมอ (ไม่กระทบยอดรวม) — ตัดออกมา
  // แสดงเป็นบรรทัดแยกต่างหากก็ต่อเมื่อตอนสร้าง/แก้บิลตั้ง serviceFeeConfig.displayMode ไว้เป็น "separate" ส่วน
  // กรณี "รวม" บรรทัดเดียว (combined) จะโชว์อัตรารวม (ฐาน+ค่าบริการ) พร้อมวงเล็บอธิบายที่มาของยอด ให้ตรงกับที่
  // frontend/src/utils/billCalc.ts (buildWaterElectricRows) ทำ — ล็อกค่าไว้กับตัวบิลตั้งแต่ตอนคำนวณฝั่ง frontend แล้ว
  const svc = item.serviceFeeConfig;
  const feeEnabled = !!svc?.enabled;
  const separateFee = feeEnabled && svc?.displayMode === "separate";
  if (item.electricActive) {
    const fee = feeEnabled ? (Number(item.electricServiceFee) || 0) : 0;
    const feeSeparate = separateFee ? fee : 0;
    const electricRate = fee > 0 && !separateFee ? (Number(item.electricRate) || 0) + (Number(svc?.electricRate) || 0) : item.electricRate;
    const note = fee > 0 && !separateFee ? ` (ค่าไฟ ${fmtMoney(item.electricRate)} + ค่าบริการ ${fmtMoney(svc?.electricRate)} บาท/หน่วย)` : "";
    rows.push({
      icon: ICONS.ELEC, name: `ค่าไฟ (${item.meterElectric?.unit ?? 0} หน่วย)`,
      sub: `เดือนก่อน ${item.meterElectric?.prev ?? 0} → เดือนนี้ ${item.meterElectric?.curr ?? 0} · หน่วยละ ${fmtMoney(electricRate)} บาท${note}`,
      price: (Number(item.priceElectric) || 0) - feeSeparate,
    });
    if (feeSeparate > 0) {
      rows.push({ icon: ICONS.ELEC, name: `ค่าบริการไฟ (${item.meterElectric?.unit ?? 0} หน่วย)`, sub: `หน่วยละ ${fmtMoney(svc!.electricRate)} บาท`, price: feeSeparate });
    }
  }
  if (item.waterActive) {
    const fee = feeEnabled ? (Number(item.waterServiceFee) || 0) : 0;
    const feeSeparate = separateFee ? fee : 0;
    const waterRate = fee > 0 && !separateFee ? (Number(item.waterRate) || 0) + (Number(svc?.waterRate) || 0) : item.waterRate;
    const note = fee > 0 && !separateFee ? ` (ค่าน้ำ ${fmtMoney(item.waterRate)} + ค่าบริการ ${fmtMoney(svc?.waterRate)} บาท/หน่วย)` : "";
    rows.push({
      icon: ICONS.WATER, name: `ค่าน้ำ (${item.meterWater?.unit ?? 0} หน่วย)`,
      sub: `เดือนก่อน ${item.meterWater?.prev ?? 0} → เดือนนี้ ${item.meterWater?.curr ?? 0} · หน่วยละ ${fmtMoney(waterRate)} บาท${note}`,
      price: (Number(item.priceWater) || 0) - feeSeparate,
    });
    if (feeSeparate > 0) {
      rows.push({ icon: ICONS.WATER, name: `ค่าบริการน้ำ (${item.meterWater?.unit ?? 0} หน่วย)`, sub: `หน่วยละ ${fmtMoney(svc!.waterRate)} บาท`, price: feeSeparate });
    }
  }
  (item.billTagItems ?? []).forEach((t: any) => {
    if (Number(t.price) > 0) rows.push({ icon: ICONS.TAG, name: t.name, price: Number(t.price) });
  });
  (item.billTenantTagItems ?? []).forEach((t: any) => {
    if (Number(t.price) > 0) rows.push({ icon: ICONS.USER, name: t.name, price: Number(t.price) });
  });
  (item.customItems ?? []).forEach((c: any) => {
    if (Number(c.price) > 0) rows.push({ icon: ICONS.PLUS, name: c.name, price: Number(c.price) });
  });
  (item.billVehicleItems ?? []).forEach((v: any) => {
    if (Number(v.price) > 0) rows.push({ icon: ICONS.CAR, name: v.plate || v.name, price: Number(v.price) });
  });

  const outstandingItems = Array.isArray(item.outstandingItems)
    ? item.outstandingItems.map((o: any) => ({ label: monthYearLabel(o.monthYear, settings.yearFormat), amount: Number(o.amount) || 0 }))
    : [];
  const discountItems = (item.discountItems ?? [])
    .filter((d: any) => Number(d.price) > 0)
    .map((d: any) => ({ name: d.name, price: Number(d.price) || 0 }));

  return {
    kind: "bill",
    logoUrl: isUsableImageUrl(settings.logoUrl) ? settings.logoUrl : ICONS.HOME,
    fineIcon: ICONS.FINE,
    discountIcon: ICONS.DISCOUNT,
    roomNumber: String(item.roomNumber ?? ""),
    tenantTitle: item.tenantTitle || "คุณ",
    tenantName: item.tenantName || "-",
    monthLabel: monthYearLabel(monthYear, settings.yearFormat),
    rows,
    fineAmount: Number(item.fineAmount) || 0,
    overdueDays: Number(item.overdueDays) || 0,
    outstandingItems,
    outstandingAmount: outstandingItems.length === 0 ? Number(item.outstandingAmount) || 0 : 0,
    discountItems,
    total: Number(item.total) || 0,
    residentCount: Number(item.residentCount) || 1,
    showSplit: !!(settings.splitRentByResidents && Number(item.residentCount) > 1),
    dueDateLabel: dueDateLabel(item.overdueConfig),
  };
}

export async function pushLineMessage(token: string, to: string, messages: any[]) {
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LINE API Error (${res.status}): ${text}`);
  }
}

// ส่งข้อความตัวอักษรธรรมดา — ใช้ตอนพนักงานตอบแชทจากหน้า Inbox (ดู routes/chat.ts)
export async function sendTextMessage(token: string, to: string, text: string) {
  await pushLineMessage(token, to, [{ type: "text", text }]);
}

// ส่งรูปภาพ — publicImageUrl ต้องเป็น URL https:// เต็มที่ LINE ดึงได้จริงแล้วเท่านั้น (ผ่าน toPublicUrl มาก่อน)
// ใช้ URL เดียวกันทั้ง originalContentUrl/previewImageUrl เพื่อลดความซับซ้อน (ไม่ทำ thumbnail แยก)
export async function sendImageMessage(token: string, to: string, publicImageUrl: string) {
  await pushLineMessage(token, to, [{ type: "image", originalContentUrl: publicImageUrl, previewImageUrl: publicImageUrl }]);
}

// ส่งสติกเกอร์ทางการของ LINE (packageId/stickerId ต้องเป็นคู่ที่ LINE รองรับให้ส่งจริง — ดู whitelist
// ALLOWED_STICKERS ใน routes/chat.ts ที่ validate ก่อนเรียกฟังก์ชันนี้)
export async function sendStickerMessage(token: string, to: string, packageId: string, stickerId: string) {
  await pushLineMessage(token, to, [{ type: "sticker", packageId, stickerId }]);
}

// LINE Messaging API ไม่มี message type "file" สำหรับส่งออก (บอทส่งไฟล์ดิบแบบที่ผู้ใช้ส่งเข้ามาไม่ได้)
// จึงส่งเป็นข้อความตัวอักษรที่มีชื่อไฟล์ + ลิงก์ดาวน์โหลดแทน (LINE render ลิงก์เป็นปุ่มกดเปิดในเบราว์เซอร์ให้เอง)
export async function sendFileLinkMessage(token: string, to: string, publicFileUrl: string, fileName: string) {
  await sendTextMessage(token, to, `📎 ${fileName}\n${publicFileUrl}`);
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

// สัดส่วนจริงของรูป (w:h ที่ลดรูปแล้ว) ให้การ์ด Flex แสดงตามสัดส่วนจริงของรูปที่อัปโหลด ไม่ใช่ครอปตามอัตราส่วน
// ตายตัว — LINE รองรับ aspectRatio ระหว่าง 1:3 ถึง 3:1 เท่านั้น (นอกช่วงนี้ต้อง clamp ไม่งั้น LINE ปฏิเสธข้อความ
// ทั้งฉบับ) ไม่มีขนาดจริงส่งมา (เช่น อ่านไม่สำเร็จฝั่ง frontend) ใช้ 1:1 เป็นค่าเริ่มต้นแทน
function resolveImageAspectRatio(width?: number, height?: number): string {
  if (!width || !height || width <= 0 || height <= 0) return "1:1";
  const clamped = Math.max(1 / 3, Math.min(3, width / height));
  // แปลงอัตราส่วนที่ clamp แล้วกลับเป็นเศษส่วนจำนวนเต็ม (คูณ 1000 แล้วลดรูปด้วย gcd) กัน string ยาวเกินไป
  const w = Math.round(clamped * 1000);
  const h = 1000;
  const g = gcd(w, h) || 1;
  return `${w / g}:${h / g}`;
}

// รูปภาพขนาดใหญ่ (ใช้กับฟีเจอร์ส่งประกาศหลายห้องพร้อมกัน — ดู POST /chat/broadcast) ไม่แปะลิงก์ = ส่งเป็น
// LINE image message ธรรมดา (แตะเปิดแล้วขยายเต็มจอเองอยู่แล้วตามพฤติกรรมปกติของแอป LINE ตามสัดส่วนจริงของรูป
// อยู่แล้วโดยไม่ต้องกำหนดเอง) แปะลิงก์ = ต้องห่อด้วย Flex bubble รูปใหญ่ (hero) + ปุ่มลิงก์แทน เพราะ image
// message ธรรมดาไม่รองรับ action ให้กดเปิดลิงก์ได้ — กรณีนี้ต้องกำหนด aspectRatio เอง (ดู resolveImageAspectRatio)
// ให้ตรงกับสัดส่วนจริงของรูป ไม่งั้น Flex จะครอปรูปตามอัตราส่วนตายตัว ทำให้รูปเพี้ยน/โดนตัดขอบ
export function buildBroadcastImageMessage(publicImageUrl: string, linkUrl: string, width?: number, height?: number): any {
  if (!linkUrl) {
    return { type: "image", originalContentUrl: publicImageUrl, previewImageUrl: publicImageUrl };
  }
  return {
    type: "flex",
    altText: "📷 รูปภาพประกาศ — กดดูรายละเอียด",
    contents: {
      type: "bubble",
      size: "giga",
      hero: {
        type: "image", url: publicImageUrl, size: "full",
        aspectRatio: resolveImageAspectRatio(width, height), aspectMode: "cover",
        action: { type: "uri", uri: linkUrl },
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "12px",
        contents: [
          { type: "button", style: "primary", height: "md", color: COLOR_PRIMARY, action: { type: "uri", label: "เปิดลิงก์", uri: linkUrl } },
        ],
      },
    },
  };
}

// ข้อความประกาศแบบการ์ดใหญ่ — โทนสี/เลย์เอาต์เดียวกับการ์ดแจ้งบิล (ดู buildBillFlexMessage ด้านบน) เพื่อให้
// ผู้เช่าคุ้นตาว่าเป็นข้อความทางการจากระบบ ไม่ใช่แค่ข้อความตัวอักษรธรรมดา — มีปุ่มลิงก์ท้ายการ์ดได้ถ้าระบุมา
export function buildAnnouncementFlexMessage(settings: LineAppearanceSettings, title: string, bodyText: string, linkUrl: string): any {
  const logoUrl = isUsableImageUrl(settings.logoUrl) ? settings.logoUrl : ICONS.HOME;
  const footer = linkUrl
    ? {
        type: "box", layout: "vertical", paddingAll: "12px",
        contents: [
          { type: "button", style: "primary", height: "md", color: COLOR_PRIMARY, action: { type: "uri", label: "ดูเพิ่มเติม", uri: linkUrl } },
        ],
      }
    : undefined;
  return {
    type: "flex",
    altText: `${title || "ประกาศ"} — กดดูรายละเอียดในแชท`,
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box", layout: "vertical", backgroundColor: COLOR_PRIMARY, paddingAll: "20px",
        contents: [
          {
            type: "box", layout: "horizontal", alignItems: "center",
            contents: [
              { type: "image", url: logoUrl, size: ICON_SIZE_HEADER, aspectRatio: "1:1", flex: 0 },
              { type: "text", text: ` ${title || "ประกาศ"}`, weight: "bold", color: "#ffffff", size: "xl", margin: "md", wrap: true },
            ],
          },
        ],
      },
      body: {
        type: "box", layout: "vertical", backgroundColor: BG_BODY, paddingAll: "20px",
        contents: [
          { type: "text", text: bodyText || "-", size: "md", color: COLOR_TEXT, wrap: true },
        ],
      },
      ...(footer ? { footer } : {}),
    },
  };
}

// ตรวจลายเซ็น webhook (header "x-line-signature") — ต้องคำนวณจาก raw body ตรงๆ ก่อนแปลงเป็น JSON
// (ดูคอมเมนต์ใน routes/lineWebhook.ts เรื่องทำไมต้องอ่าน raw body ก่อน) เทียบแบบ timing-safe กันโจมตี
export function verifyLineSignature(channelSecret: string, rawBody: string, signatureHeader: string | undefined): boolean {
  if (!channelSecret || !signatureHeader) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ดึงโปรไฟล์ LINE ของผู้ใช้ (ชื่อ + รูปโปรไฟล์) — ใช้ตอนหาไม่เจอผู้เช่าที่ผูก lineUserId นี้ไว้ และตอนแคช
// รูปโปรไฟล์ไว้แสดงในหน้าแชท (best-effort เฉยๆ ไม่ throw คืนค่าว่างถ้าดึงไม่สำเร็จ)
export async function getLineProfile(token: string, userId: string): Promise<{ displayName: string; pictureUrl: string }> {
  try {
    const res = await fetch(`${LINE_PROFILE_URL}/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { displayName: "", pictureUrl: "" };
    const data = await res.json();
    return { displayName: String(data?.displayName ?? ""), pictureUrl: String(data?.pictureUrl ?? "") };
  } catch {
    return { displayName: "", pictureUrl: "" };
  }
}

// แคชรูปโปรไฟล์+ชื่อ LINE ลงตาราง line_profiles (upsert แบบ select-then-insert/update ตามแพทเทิร์นเดิม
// ในไฟล์นี้ที่ไม่ใช้ onConflict) — เรียกจาก webhook (ข้อความเข้าใหม่) และปุ่มรีเฟรชโปรไฟล์ในหน้าแชท
export async function cacheLineProfile(orgId: string, lineUserId: string, profile: { displayName: string; pictureUrl: string }) {
  if (!profile.displayName && !profile.pictureUrl) return;
  const now = new Date().toISOString();
  // PK ของตารางนี้ยังเป็น lineUserId เดี่ยวๆ ในเฟสนี้ (composite (org_id, line_user_id) เป็นเฟสถัดไป — ดู
  // คอมเมนต์ที่ตาราง lineProfiles ใน db/schema.ts) จึงยัง lookup ด้วย lineUserId อย่างเดียว แค่ประทับ orgId ไว้ด้วย
  const [existing] = await db.select().from(lineProfiles).where(eq(lineProfiles.lineUserId, lineUserId));
  if (existing) {
    await db.update(lineProfiles)
      .set({ orgId, displayName: profile.displayName, pictureUrl: profile.pictureUrl, updatedAt: now })
      .where(eq(lineProfiles.lineUserId, lineUserId));
  } else {
    await db.insert(lineProfiles).values({ lineUserId, orgId, displayName: profile.displayName, pictureUrl: profile.pictureUrl, updatedAt: now });
  }
}

// บันทึกข้อความแจ้งเตือนอัตโนมัติ (ส่งบิล/ใบเสร็จทาง LINE) ลง chat_messages ด้วย — ให้ขึ้นในหน้าแชท LINE
// ของเว็บเราเหมือนข้อความที่พนักงานพิมพ์ตอบเอง (ไม่ใช่แค่ push ไปที่ LINE ของผู้เช่าเฉยๆ) messageType เป็น
// "bill"/"receipt" เก็บ JSON สรุปข้อมูลบิล/ใบเสร็จไว้ใน text ให้หน้าแชทเรนเดอร์เป็นการ์ดหน้าตาเหมือนที่ส่งไป
// จริงๆ (ไม่ใช่แค่ข้อความตัวหนังสือธรรมดา) มาร์คว่าอ่านแล้วทันทีเพราะเป็นข้อความขาออก แล้ว broadcast ให้
// หน้าแชทที่เปิดอยู่รีเฟรชสดๆ เหมือนตอนมีข้อความเข้าใหม่
async function logOutboundChatMessage(orgId: string, lineUserId: string, tenantId: string, messageType: string, payload: string, senderName: string) {
  if (!lineUserId || !lineUserId.startsWith("U")) return;
  const now = new Date().toISOString();
  await db.insert(chatMessages).values({
    id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    orgId,
    lineUserId,
    tenantId,
    direction: "out",
    messageType,
    text: payload,
    senderName,
    createdAt: now,
    readAt: now,
  });
  broadcastChange(orgId, "chat", "create", "มีข้อความแชทใหม่จาก LINE", senderName);
}

// ดาวน์โหลดเนื้อหาที่ผู้เช่าส่งเข้ามาทาง LINE (รูปภาพ/ไฟล์) มาเก็บไว้ใน uploads/chat/ แล้วคืน path สัมพัทธ์
// (เสิร์ฟผ่าน route /uploads/* ที่มีอยู่แล้วใน index.ts) — คืนค่าว่างถ้าดาวน์โหลดไม่สำเร็จ ไม่ทำให้ webhook
// ทั้งฉบับล้ม — ext กำหนดนามสกุลไฟล์ที่เซฟ (รูปภาพใช้ "jpg" เสมอ, ไฟล์ทั่วไปใช้นามสกุลจาก fileName ที่ LINE ส่งมา)
export async function downloadLineContent(token: string, messageId: string, ext: string): Promise<string> {
  try {
    const res = await fetch(`${LINE_CONTENT_URL}/${messageId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return "";
    const buffer = Buffer.from(await res.arrayBuffer());
    const dir = resolve(process.cwd(), "uploads", "chat");
    await mkdir(dir, { recursive: true });
    const safeExt = (ext || "bin").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
    const fileName = `${messageId}.${safeExt}`;
    await writeFile(resolve(dir, fileName), buffer);
    return `/uploads/chat/${fileName}`;
  } catch {
    return "";
  }
}

// เซฟไฟล์ที่พนักงานอัปโหลดจากหน้าแชท (base64 data URI) ลง uploads/chat/out/ — แพทเทิร์นเดียวกับ
// uploadRoomImage ใน routes/rooms.ts และ uploadPaymentSlip ใน routes/bills.ts
export async function uploadChatAttachment(filename: string, base64Data: string): Promise<string> {
  const dir = resolve(process.cwd(), "uploads", "chat", "out");
  await mkdir(dir, { recursive: true });
  const base64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(base64, "base64");
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await writeFile(resolve(dir, safeName), buffer);
  return `/uploads/chat/out/${safeName}`;
}

export interface SendLineResult {
  success: boolean;
  message: string;
  bill?: typeof bills.$inferSelect;
}

// ส่งบิลของห้องหนึ่งห้อง (ภายในบิลกลุ่ม billId) ไปยัง LINE ของผู้เช่าห้องนั้น แล้วบันทึกผลลง sendLogs
// ของห้องนั้นใน bills.data ทันที (ไม่ต้องรอผู้ใช้กด "บันทึก" อีกที)
export async function sendBillLineForRoom(orgId: string, billId: string, roomId: string, method: "manual" | "auto" = "manual", actor: string = ""): Promise<SendLineResult> {
  const [billRow] = await db.select().from(bills).where(and(eq(bills.id, billId), eq(bills.orgId, orgId)));
  if (!billRow) return { success: false, message: "ไม่พบบิล" };

  let data: any[] = [];
  try { data = billRow.data ? JSON.parse(billRow.data) : []; } catch { data = []; }
  const idx = data.findIndex((r) => String(r?.roomId) === String(roomId));
  if (idx === -1) return { success: false, message: "ไม่พบข้อมูลห้องนี้ในบิล" };
  const item = data[idx];

  const settings = await getLineSettings(orgId);
  if (!settings.enabled || !settings.token) {
    return { success: false, message: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
  }
  // บิลที่ส่งไปตอนนี้ไม่ฝังตัวเลขในตัวข้อความแล้ว (ดู buildBillFlexMessage ด้านล่าง) ต้องมีลิงก์ LIFF Payment
  // ให้กดดูรายละเอียดสดเสมอ ไม่งั้นผู้เช่าจะได้การ์ดที่กดอะไรไม่ได้เลย
  if (!settings.liffPaymentUrl) {
    return { success: false, message: "กรุณาตั้งค่า LIFF Payment URL ที่หน้า Settings ก่อน (ใช้เป็นลิงก์ดูรายละเอียดบิลที่ส่งให้ผู้เช่า)" };
  }

  let lineUserId = "";
  let coLineUserIds: string[] = [];
  if (item.tenantId) {
    const [tenant] = await db.select().from(tenants).where(and(eq(tenants.id, String(item.tenantId)), eq(tenants.orgId, orgId)));
    lineUserId = (tenant?.lineUserId ?? "").trim();
    // ผู้ร่วมพักอาศัยที่ผูก LINE User ID ไว้ (ต้องขึ้นต้นด้วย "U" เหมือนผู้ทำสัญญาหลัก) — ส่งบิลใบเดียวกัน
    // ให้ทุกคนพร้อมกัน โดยเนื้อหาบิล (ชื่อผู้เช่าบนหัวบิล) ยังคงเป็นชื่อผู้ทำสัญญาเสมอ ไม่เปลี่ยนตามผู้รับ
    // coResidents เป็นคอลัมน์ text เก็บ JSON string ดิบ (ดู schema.ts) ต้อง parse ก่อนเสมอ — เดิม (บั๊ก) เช็ค
    // Array.isArray กับ string ตรงๆ ซึ่งเป็น false เสมอ เลยไม่เคยส่งถึงผู้ร่วมพักอาศัยเลยสักครั้ง เปิด/ปิด
    // ฟีเจอร์นี้ได้ที่หน้า Settings > LINE Messaging (sendBillToCoResidents — ดู getLineSettings ด้านบน)
    if (settings.sendBillToCoResidents) {
      let coResidents: any[] = [];
      try { coResidents = tenant?.coResidents ? JSON.parse(tenant.coResidents) : []; } catch { coResidents = []; }
      coLineUserIds = coResidents
        .map((c: any) => String(c?.lineId ?? "").trim())
        .filter((id: string) => id.startsWith("U"));
    }
  }
  if (!lineUserId || !lineUserId.startsWith("U")) {
    return { success: false, message: "ผู้เช่าห้องนี้ยังไม่ได้ผูก LINE User ID (กรอกได้ที่หน้าแก้ไขผู้เช่า)" };
  }

  const message = buildBillFlexMessage(item, billRow.monthYear, settings, billId);

  const log = {
    timestamp: new Date().toISOString(),
    method,
    by: actor || (method === "auto" ? "ระบบอัตโนมัติ" : ""),
    status: "success" as "success" | "error",
    detail: "",
  };

  let mainOk = true;
  try {
    await pushLineMessage(settings.token, lineUserId, [message]);
  } catch (e: any) {
    mainOk = false;
    log.status = "error";
    log.detail = `ส่งไม่สำเร็จ: ${e?.message ?? "Unknown error"}`;
  }

  let coOk = 0;
  for (const uid of coLineUserIds) {
    try {
      await pushLineMessage(settings.token, uid, [message]);
      coOk++;
    } catch {
      // ผู้ร่วมพักส่งไม่สำเร็จเป็นเรื่องรอง ไม่ทำให้ทั้งรายการล้มเหลว แค่รายงานจำนวนที่ส่งได้จริงใน detail
    }
  }

  if (mainOk) {
    log.detail = `ส่งบิลทาง LINE สำเร็จ (${method === "auto" ? "อัตโนมัติ" : "ส่งเอง"})`
      + (coLineUserIds.length > 0 ? ` — ผู้ร่วมพักอาศัย ${coOk}/${coLineUserIds.length} คน` : "");

    const snapshot = buildChatBillSnapshot(item, billRow.monthYear, settings);
    await logOutboundChatMessage(
      orgId, lineUserId, String(item.tenantId ?? ""), "bill", JSON.stringify(snapshot),
      log.by || "พนักงาน"
    );
  }

  if (!Array.isArray(item.sendLogs)) item.sendLogs = [];
  item.sendLogs.unshift(log);
  data[idx] = item;

  await db.update(bills).set({ data: JSON.stringify(data), updatedAt: new Date().toISOString() }).where(eq(bills.id, billId));
  const [updated] = await db.select().from(bills).where(eq(bills.id, billId));

  return { success: log.status === "success", message: log.detail, bill: updated };
}

export interface PaymentReceiptInput {
  tenantId: string | null;
  roomNumber: string;
  monthYear: string;
  method: "cash" | "scan";
  amount: number; // ยอดที่รับจริงสำหรับยอดนี้ (ไม่รวมเงินทอน)
  change: number;
  note: string;
  paymentDate: string;
  billTotal: number; // ยอดรวมสุทธิของบิล (หลังปรับค่าปรับ/ส่วนลดในป็อปอัพนี้แล้ว)
  paidTotal: number; // ยอดที่จ่ายสะสมรวมทั้งหมดของบิลนี้ หลังรวมยอดที่เพิ่งบันทึก
  slipUrl?: string; // path/URL รูปสลิปการโอน — ว่าง = ไม่แสดงปุ่มดูสลิป (ดู resolveSlipUrl ด้านบน)
  actor?: string; // ชื่อพนักงานที่บันทึกการชำระเงิน — ไว้แสดงเป็นผู้ส่งในประวัติแชท LINE ของเว็บ
}

// ใบเสร็จรับเงิน (Flex Message) — ส่งให้ผู้เช่าทันทีที่กดยืนยันการชำระในป็อปอัพบันทึกการชำระเงิน
function buildPaymentReceiptFlexMessage(input: PaymentReceiptInput, settings: LineAppearanceSettings) {
  const monthLabel = monthYearLabel(input.monthYear, settings.yearFormat);
  const remaining = Math.max(0, input.billTotal - input.paidTotal);
  const fullySettled = remaining <= 0.005;
  const slipUrl = resolveSlipUrl(input.slipUrl);

  // ตราประทับจางๆ ต้องอยู่ตัวแรกสุด (position: absolute ไม่กินพื้นที่ในเลย์เอาต์ปกติ) เพื่อให้ลอยอยู่ใต้
  // แถวข้อมูลที่ตามมาซึ่งจัดเรียงแบบปกติทับด้านบน (เหมือนตรายางประทับไว้ก่อนแล้วค่อยเขียนตัวหนังสือทับ)
  const bodyContents: any[] = [];
  if (fullySettled) bodyContents.push(createPaidWatermark());

  bodyContents.push(
    createFlexRow(input.method === "scan" ? "ช่องทาง: สแกน/โอน" : "ช่องทาง: เงินสด", "", COLOR_TEXT, input.method === "scan" ? ICONS.SCAN : ICONS.CASH, false),
    createFlexRow("วันที่ชำระ", thaiDateLabel(input.paymentDate, settings.yearFormat), COLOR_TEXT, ICONS.CALENDAR, false),
    createFlexRow("สำหรับเดือน", monthLabel, COLOR_TEXT, ICONS.RECEIPT, false)
  );
  if (input.change > 0) bodyContents.push(createFlexRow("เงินทอน", fmtMoney(input.change), COLOR_TEXT, ICONS.CASH));
  if (input.note) bodyContents.push(createFlexRow("หมายเหตุ", input.note, COLOR_MUTED, ICONS.NOTE, false));

  bodyContents.push({ type: "separator", margin: "lg", color: "#E0E0E0" });
  if (fullySettled) {
    bodyContents.push({ type: "text", text: "ชำระเงินครบถ้วนแล้ว ขอบคุณค่ะ/ครับ", weight: "bold", size: "md", color: COLOR_SUCCESS, align: "center", margin: "lg" });
  } else {
    bodyContents.push(createFlexHighlightRow("คงเหลือที่ต้องชำระ", fmtMoney(remaining)));
  }

  return {
    type: "flex",
    altText: `ได้รับชำระเงินห้อง ${input.roomNumber} จำนวน ${fmtMoney(input.amount)} บาท`,
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box", layout: "vertical", backgroundColor: COLOR_PRIMARY, paddingAll: "20px",
        contents: [
          {
            type: "box", layout: "horizontal", alignItems: "center",
            contents: [
              { type: "image", url: ICONS.RECEIPT, size: ICON_SIZE_HEADER, aspectRatio: "1:1", flex: 0 },
              { type: "text", text: " ใบเสร็จรับเงิน", weight: "bold", color: "#ffffff", size: "xl", margin: "md" },
            ],
          },
          { type: "text", text: `ห้อง ${input.roomNumber}`, weight: "bold", color: "#ffffff", size: "lg", margin: "md" },
          { type: "text", text: `รับชำระ ${fmtMoney(input.amount)} ฿`, color: "#ffffffcc", size: "sm", margin: "sm" },
        ],
      },
      body: {
        type: "box", layout: "vertical", backgroundColor: BG_BODY, paddingAll: "20px",
        contents: bodyContents,
      },
      ...(slipUrl && {
        footer: {
          type: "box", layout: "vertical", paddingAll: "12px",
          contents: [
            {
              type: "button", style: "primary", height: "sm", color: COLOR_PRIMARY,
              action: { type: "uri", label: "ดูสลิปการโอน", uri: slipUrl },
            },
          ],
        },
      }),
    },
  };
}

// สรุปข้อมูลใบเสร็จเป็น JSON เก็บลงประวัติแชท (chat_messages.text ตอน messageType="receipt") ให้หน้าแชท
// ฝั่งเว็บเรนเดอร์เป็นการ์ดหน้าตาเหมือนใบเสร็จที่ส่งจริงทาง LINE (ดู buildPaymentReceiptFlexMessage ด้านบน)
// slipUrl เก็บเป็น path สัมพัทธ์เดิม (ไม่ผ่าน resolveSlipUrl) เพราะเว็บเราเปิดผ่าน /uploads พร็อกซีเองได้เลย
// ไม่ต้องพึ่ง PUBLIC_BASE_URL แบบตอนส่งลิงก์ไปให้ LINE ของผู้เช่า
function buildChatReceiptSnapshot(input: PaymentReceiptInput, settings: LineAppearanceSettings) {
  const remaining = Math.max(0, input.billTotal - input.paidTotal);
  const fullySettled = remaining <= 0.005;
  return {
    kind: "receipt",
    receiptIcon: ICONS.RECEIPT,
    methodIcon: input.method === "scan" ? ICONS.SCAN : ICONS.CASH,
    calendarIcon: ICONS.CALENDAR,
    cashIcon: ICONS.CASH,
    noteIcon: ICONS.NOTE,
    watermarkIcon: ICONS.STAMP_FAINT_RED,
    roomNumber: String(input.roomNumber ?? ""),
    monthLabel: monthYearLabel(input.monthYear, settings.yearFormat),
    method: input.method,
    amount: Number(input.amount) || 0,
    change: Number(input.change) || 0,
    note: input.note || "",
    paymentDateLabel: thaiDateLabel(input.paymentDate, settings.yearFormat),
    remaining,
    fullySettled,
    slipUrl: input.slipUrl || "",
  };
}

// ส่งใบเสร็จรับเงินทาง LINE — เรียกจาก bills.ts ทันทีหลังบันทึกรายการชำระเงินสำเร็จ (best-effort ไม่บล็อกการ
// บันทึกยอดถ้าส่งไม่สำเร็จ เช่น ผู้เช่ายังไม่ได้ผูก LINE User ID หรือปิดใช้งาน LINE Messaging ไว้) sendReceipt
// = false คือพนักงานเลือก "ไม่ส่งใบเสร็จ" ตอนบันทึกยอด (ถามทุกครั้งในป็อปอัพบันทึกการชำระเงิน แทนที่จะเป็น
// ค่าตั้งค่ากลางถาวรในหน้า Settings) ค่าเริ่มต้นเป็น true ให้เส้นทางที่ไม่ได้ถาม (ตรวจสลิปอัตโนมัติ) ยังส่งตามปกติ
export async function sendPaymentReceiptLine(orgId: string, input: PaymentReceiptInput, sendReceipt = true): Promise<SendLineResult> {
  if (!sendReceipt) {
    return { success: false, message: "พนักงานเลือกไม่ส่งใบเสร็จทาง LINE สำหรับรายการนี้" };
  }
  const settings = await getLineSettings(orgId);
  if (!settings.enabled || !settings.token) {
    return { success: false, message: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
  }
  if (!input.tenantId) {
    return { success: false, message: "ห้องนี้ไม่มีผู้เช่าผูกอยู่" };
  }

  const [tenant] = await db.select().from(tenants).where(and(eq(tenants.id, String(input.tenantId)), eq(tenants.orgId, orgId)));
  const lineUserId = (tenant?.lineUserId ?? "").trim();
  if (!lineUserId || !lineUserId.startsWith("U")) {
    return { success: false, message: "ผู้เช่าห้องนี้ยังไม่ได้ผูก LINE User ID" };
  }

  try {
    await pushLineMessage(settings.token, lineUserId, [buildPaymentReceiptFlexMessage(input, settings)]);

    const snapshot = buildChatReceiptSnapshot(input, settings);
    await logOutboundChatMessage(
      orgId, lineUserId, String(input.tenantId ?? ""), "receipt", JSON.stringify(snapshot),
      input.actor || "พนักงาน"
    );

    return { success: true, message: "ส่งใบเสร็จทาง LINE สำเร็จ" };
  } catch (e: any) {
    return { success: false, message: `ส่งใบเสร็จไม่สำเร็จ: ${e?.message ?? "Unknown error"}` };
  }
}

// วันที่ปัจจุบันตามเขตเวลาไทย รูปแบบ YYYY-MM-DD (ให้ตรงกับ scheduledDate ที่เก็บจากช่องเลือกวันที่)
function todayBangkok(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

// เดือน/ปีปัจจุบันตามเขตเวลาไทย รูปแบบ "MM/YYYY" ให้ตรงกับ bills.monthYear (ดู myScore ด้านบนของไฟล์)
function currentMonthYearBangkok(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  return `${m}/${y}`;
}

// ปุ่ม "บิลเดือนนี้" บนเมนู Member — ลิงก์ตรงไปหน้า LIFF Payment แบบเดียวกับปุ่ม "ข้อมูลผู้เช่า"/"ชำระเงิน"
// (ดู memberAreas ใน services/richMenu.ts) พร้อม query "?view=thisMonth" ให้หน้านั้นรู้ว่าต้องเปิดป็อปอัพ
// รายละเอียดบิลเดือนปัจจุบันให้ทันที ไม่ต้องรู้ billId/roomId ล่วงหน้าตอนสร้างเมนู (เมนูเป็น URL เดียวใช้ร่วมกัน
// ทุกคน ระบุ user เฉพาะเจาะจงไม่ได้) จึงต้องมาไล่หาว่า "เดือนนี้ของผู้เช่าคนนี้" คือบิลใบไหนตอนเปิดหน้าจริง
// (ดู POST /liff/bill-detail/this-month ใน routes/liff.ts ที่เรียกฟังก์ชันนี้)
export async function getThisMonthBillItemForTenant(orgId: string, tenantId: string): Promise<{ billId: string; roomId: string; item: any; monthYear: string } | null> {
  const monthYear = currentMonthYearBangkok();
  const [row] = await db.select().from(bills).where(and(eq(bills.monthYear, monthYear), eq(bills.orgId, orgId)));
  if (!row) return null;
  let data: any[] = [];
  try { data = row.data ? JSON.parse(row.data) : []; } catch { data = []; }
  const item = data.find((it: any) => String(it?.tenantId ?? "") === tenantId);
  if (!item) return null;
  return { billId: row.id, roomId: String(item.roomId ?? ""), item: stripCarriedOutstanding(item), monthYear: row.monthYear };
}

// เช็คบิลทุกใบ "ขององค์กรหนึ่ง" ที่ตั้ง "วันนัดส่ง" (scheduledDate) ตรงกับวันนี้ และยังไม่เคยส่งอัตโนมัติมาก่อน
// (lineAutoSentAt ว่าง) แล้วส่งให้ทุกห้องที่มีผู้เช่าและยังไม่จ่าย ครั้งเดียวต่อบิลต่อวัน
async function runLineAutoSendForOrg(orgId: string): Promise<void> {
  const settings = await getLineSettings(orgId);
  if (!settings.enabled || !settings.autoSendEnabled || !settings.token) return;

  const today = todayBangkok();
  const rows = await db.select().from(bills).where(eq(bills.orgId, orgId));

  for (const row of rows) {
    if (!row.scheduledDate || row.scheduledDate !== today) continue;
    if (row.lineAutoSentAt) continue;

    let data: any[] = [];
    try { data = row.data ? JSON.parse(row.data) : []; } catch { data = []; }

    for (const item of data) {
      if (!item?.tenantId || item?.status === "paid") continue;
      try {
        await sendBillLineForRoom(orgId, row.id, String(item.roomId), "auto", "ระบบอัตโนมัติ");
      } catch (e) {
        console.error(`[line-auto-send] org=${orgId} bill=${row.id} room=${item.roomId}`, e);
      }
    }

    await db.update(bills).set({ lineAutoSentAt: new Date().toISOString() }).where(eq(bills.id, row.id));
  }
}

// เรียกเป็นระยะจาก index.ts — วนทำทีละองค์กร (ไม่ใช่ทั้งระบบรวมกันแบบเดิม) เพราะแต่ละองค์กรมีการตั้งค่า LINE
// Messaging/วันนัดส่งของตัวเอง ความล้มเหลวขององค์กรหนึ่ง (เช่น token หมดอายุ) ต้องไม่กระทบองค์กรอื่น
export async function runLineAutoSend(): Promise<void> {
  const orgIds = await listAllOrgIds();
  for (const orgId of orgIds) {
    try {
      await runLineAutoSendForOrg(orgId);
    } catch (e) {
      console.error(`[line-auto-send] org=${orgId} failed`, e);
    }
  }
}
