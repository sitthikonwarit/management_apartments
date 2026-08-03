// ── ส่งบิลแจ้งเตือนทาง LINE (LINE Messaging API — Push Message) ──────────────────
// ตั้งค่า Channel Access Token + เปิด/ปิดใช้งานได้จากหน้า Settings (ตาราง app_config)
// ใช้ทั้งตอนกดส่งเอง (bills.ts: POST /bills/:id/send-line) และตอนส่งอัตโนมัติตามวันนัด (runLineAutoSend)
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import { db } from "../db";
import { appConfig, bills, chatMessages, lineProfiles, tenants } from "../db/schema";
import { broadcastChange } from "../lib/wsHub";

// หาผู้เช่าที่ผูก lineUserId นี้ไว้ (ผู้ทำสัญญาหลักหรือผู้ร่วมพักอาศัยก็ได้) — ไม่เจอคืน null เฉยๆ
// ใช้ทั้งใน webhook (หาชื่อผู้ส่ง) และหน้าแชท (หาบิลค้างชำระของ tenant ที่ผูกกับ conversation นี้)
export async function findTenantByLineUserId(lineUserId: string) {
  const rows = await db.select().from(tenants);
  for (const t of rows) {
    if ((t.lineUserId ?? "").trim() === lineUserId) return t;
    try {
      const coResidents = t.coResidents ? JSON.parse(t.coResidents) : [];
      if (Array.isArray(coResidents) && coResidents.some((c: any) => String(c?.lineId ?? "").trim() === lineUserId)) {
        return t;
      }
    } catch {
      // co-residents parse ไม่ได้ ข้ามไปเช็คคนถัดไป
    }
  }
  return null;
}

const CONFIG_ID = "default";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_PROFILE_URL = "https://api.line.me/v2/bot/profile";
const LINE_CONTENT_URL = "https://api-data.line.me/v2/bot/message";

export async function getLineSettings() {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
  return {
    enabled: row?.lineMessagingEnabled === "true",
    autoSendEnabled: row?.lineAutoSendEnabled === "true",
    token: row?.lineChannelAccessToken ?? "",
    channelSecret: row?.lineChannelSecret ?? "",
    appName: row?.appName ?? "",
    logoUrl: row?.logoUrl ?? "",
    yearFormat: (row?.yearFormat === "CE" ? "CE" : "BE") as "BE" | "CE",
    splitRentByResidents: row?.splitRentByResidents === "true",
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
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!isUsableImageUrl(`${base}/`)) return "";
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface LineAppearanceSettings {
  appName: string;
  logoUrl: string;
  yearFormat: "BE" | "CE";
  splitRentByResidents: boolean;
}

// สร้าง Flex Message ใบแจ้งค่าเช่า จากข้อมูลห้องหนึ่งห้อง (BillItem ฝั่ง frontend/billCalc.ts) — ให้หน้าตา
// ตรงกับ BillLinePreview ในหน้าเว็บ (บิลอิเล็กทรอนิกส์ LINE) มากที่สุดเท่าที่ Flex Message spec ทำได้
function buildBillFlexMessage(item: any, monthYear: string, settings: LineAppearanceSettings) {
  const monthLabel = monthYearLabel(monthYear, settings.yearFormat);
  const showSplit = settings.splitRentByResidents && Number(item.residentCount) > 1;

  const bodyContents: any[] = [];

  bodyContents.push(createFlexRow("ค่าห้อง/ค่าเช่า", fmtMoney(item.priceRoom), COLOR_TEXT, ICONS.BED));

  if (item.electricActive) {
    bodyContents.push(createFlexMeterRow(
      "ค่าไฟ", `(${item.meterElectric?.unit ?? 0} หน่วย)`,
      `เดือนก่อน ${item.meterElectric?.prev ?? 0} → เดือนนี้ ${item.meterElectric?.curr ?? 0} · หน่วยละ ${fmtMoney(item.electricRate)} บาท`,
      fmtMoney(item.priceElectric), ICONS.ELEC
    ));
  }
  if (item.waterActive) {
    bodyContents.push(createFlexMeterRow(
      "ค่าน้ำ", `(${item.meterWater?.unit ?? 0} หน่วย)`,
      `เดือนก่อน ${item.meterWater?.prev ?? 0} → เดือนนี้ ${item.meterWater?.curr ?? 0} · หน่วยละ ${fmtMoney(item.waterRate)} บาท`,
      fmtMoney(item.priceWater), ICONS.WATER
    ));
  }

  (item.billTagItems ?? []).forEach((t: any) => {
    if (Number(t.price) > 0) bodyContents.push(createFlexRow(t.name, fmtMoney(t.price), COLOR_MUTED, ICONS.TAG));
  });
  (item.billTenantTagItems ?? []).forEach((t: any) => {
    if (Number(t.price) > 0) bodyContents.push(createFlexRow(t.name, fmtMoney(t.price), COLOR_MUTED, ICONS.USER));
  });
  (item.customItems ?? []).forEach((c: any) => {
    if (Number(c.price) > 0) bodyContents.push(createFlexRow(c.name, fmtMoney(c.price), COLOR_MUTED, ICONS.PLUS));
  });
  (item.billVehicleItems ?? []).forEach((v: any) => {
    if (Number(v.price) > 0) bodyContents.push(createFlexRow(v.plate || v.name, fmtMoney(v.price), COLOR_MUTED, ICONS.CAR));
  });

  if (item.fineAmount > 0) {
    bodyContents.push(createFlexHighlightRow(`ค่าปรับล่าช้า (${item.overdueDays ?? 0} วัน)`, fmtMoney(item.fineAmount)));
  }

  if (Array.isArray(item.outstandingItems) && item.outstandingItems.length > 0) {
    item.outstandingItems.forEach((o: any) => {
      bodyContents.push(createFlexHighlightRow(`ค้างชำระ ${monthYearLabel(o.monthYear, settings.yearFormat)}`, fmtMoney(o.amount)));
    });
  } else if (item.outstandingAmount > 0) {
    bodyContents.push(createFlexHighlightRow("ยอดค้างชำระยกมา", fmtMoney(item.outstandingAmount)));
  }

  (item.discountItems ?? []).forEach((d: any) => {
    if (Number(d.price) > 0) bodyContents.push(createFlexRow(`ส่วนลด: ${d.name}`, `-${fmtMoney(d.price)}`, COLOR_RED, ICONS.DISCOUNT));
  });

  bodyContents.push({ type: "separator", margin: "lg", color: "#E0E0E0" });
  bodyContents.push({
    type: "box", layout: "horizontal", margin: "lg",
    contents: [
      { type: "text", text: "ยอดชำระสุทธิ", weight: "bold", size: "md", color: COLOR_TEXT },
      { type: "text", text: `${fmtMoney(item.total)} ฿`, weight: "bold", size: "xl", align: "end", color: COLOR_PRIMARY },
    ],
  });
  if (showSplit) {
    bodyContents.push({
      type: "text", size: "md", weight: "bold", color: COLOR_PRIMARY, align: "end", margin: "sm",
      text: `หาร ${item.residentCount} คน · คนละ ${fmtMoney(item.total / item.residentCount)} บาท`,
    });
  }
  bodyContents.push({ type: "text", text: dueDateLabel(item.overdueConfig), size: "xs", color: COLOR_MUTED, align: "center", margin: "lg" });

  const logoUrl = isUsableImageUrl(settings.logoUrl) ? settings.logoUrl : ICONS.HOME;

  return {
    type: "flex",
    altText: `แจ้งค่าเช่าห้อง ${item.roomNumber} เดือน ${monthLabel} ยอด ${fmtMoney(item.total)} บาท`,
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
        type: "box", layout: "vertical", backgroundColor: BG_BODY, paddingAll: "20px",
        contents: bodyContents,
      },
    },
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
export async function cacheLineProfile(lineUserId: string, profile: { displayName: string; pictureUrl: string }) {
  if (!profile.displayName && !profile.pictureUrl) return;
  const now = new Date().toISOString();
  const [existing] = await db.select().from(lineProfiles).where(eq(lineProfiles.lineUserId, lineUserId));
  if (existing) {
    await db.update(lineProfiles)
      .set({ displayName: profile.displayName, pictureUrl: profile.pictureUrl, updatedAt: now })
      .where(eq(lineProfiles.lineUserId, lineUserId));
  } else {
    await db.insert(lineProfiles).values({ lineUserId, displayName: profile.displayName, pictureUrl: profile.pictureUrl, updatedAt: now });
  }
}

// บันทึกข้อความแจ้งเตือนอัตโนมัติ (ส่งบิล/ใบเสร็จทาง LINE) ลง chat_messages ด้วย — ให้ขึ้นในหน้าแชท LINE
// ของเว็บเราเหมือนข้อความที่พนักงานพิมพ์ตอบเอง (ไม่ใช่แค่ push ไปที่ LINE ของผู้เช่าเฉยๆ) มาร์คว่าอ่านแล้ว
// ทันทีเพราะเป็นข้อความขาออก แล้ว broadcast ให้หน้าแชทที่เปิดอยู่รีเฟรชสดๆ เหมือนตอนมีข้อความเข้าใหม่
async function logOutboundChatMessage(lineUserId: string, tenantId: string, text: string, senderName: string) {
  if (!lineUserId || !lineUserId.startsWith("U")) return;
  const now = new Date().toISOString();
  await db.insert(chatMessages).values({
    id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lineUserId,
    tenantId,
    direction: "out",
    messageType: "text",
    text,
    senderName,
    createdAt: now,
    readAt: now,
  });
  broadcastChange("chat", "create", "มีข้อความแชทใหม่จาก LINE", senderName);
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
export async function sendBillLineForRoom(billId: string, roomId: string, method: "manual" | "auto" = "manual", actor: string = ""): Promise<SendLineResult> {
  const [billRow] = await db.select().from(bills).where(eq(bills.id, billId));
  if (!billRow) return { success: false, message: "ไม่พบบิล" };

  let data: any[] = [];
  try { data = billRow.data ? JSON.parse(billRow.data) : []; } catch { data = []; }
  const idx = data.findIndex((r) => String(r?.roomId) === String(roomId));
  if (idx === -1) return { success: false, message: "ไม่พบข้อมูลห้องนี้ในบิล" };
  const item = data[idx];

  const settings = await getLineSettings();
  if (!settings.enabled || !settings.token) {
    return { success: false, message: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
  }

  let lineUserId = "";
  let coLineUserIds: string[] = [];
  if (item.tenantId) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, String(item.tenantId)));
    lineUserId = (tenant?.lineUserId ?? "").trim();
    // ผู้ร่วมพักอาศัยที่ผูก LINE User ID ไว้ (ต้องขึ้นต้นด้วย "U" เหมือนผู้ทำสัญญาหลัก) — ส่งบิลใบเดียวกัน
    // ให้ทุกคนพร้อมกัน โดยเนื้อหาบิล (ชื่อผู้เช่าบนหัวบิล) ยังคงเป็นชื่อผู้ทำสัญญาเสมอ ไม่เปลี่ยนตามผู้รับ
    const coResidents: any[] = Array.isArray(tenant?.coResidents) ? tenant.coResidents : [];
    coLineUserIds = coResidents
      .map((c: any) => String(c?.lineId ?? "").trim())
      .filter((id: string) => id.startsWith("U"));
  }
  if (!lineUserId || !lineUserId.startsWith("U")) {
    return { success: false, message: "ผู้เช่าห้องนี้ยังไม่ได้ผูก LINE User ID (กรอกได้ที่หน้าแก้ไขผู้เช่า)" };
  }

  const message = buildBillFlexMessage(item, billRow.monthYear, settings);

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

    const monthLabel = monthYearLabel(billRow.monthYear, settings.yearFormat);
    await logOutboundChatMessage(
      lineUserId, String(item.tenantId ?? ""),
      `📄 แจ้งบิลค่าเช่าห้อง ${item.roomNumber} เดือน ${monthLabel}\nยอด ${fmtMoney(item.total)} ฿`,
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

// ส่งใบเสร็จรับเงินทาง LINE — เรียกจาก bills.ts ทันทีหลังบันทึกรายการชำระเงินสำเร็จ (best-effort ไม่บล็อกการ
// บันทึกยอดถ้าส่งไม่สำเร็จ เช่น ผู้เช่ายังไม่ได้ผูก LINE User ID หรือปิดใช้งาน LINE Messaging ไว้)
export async function sendPaymentReceiptLine(input: PaymentReceiptInput): Promise<SendLineResult> {
  const settings = await getLineSettings();
  if (!settings.enabled || !settings.token) {
    return { success: false, message: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
  }
  if (!input.tenantId) {
    return { success: false, message: "ห้องนี้ไม่มีผู้เช่าผูกอยู่" };
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, String(input.tenantId)));
  const lineUserId = (tenant?.lineUserId ?? "").trim();
  if (!lineUserId || !lineUserId.startsWith("U")) {
    return { success: false, message: "ผู้เช่าห้องนี้ยังไม่ได้ผูก LINE User ID" };
  }

  try {
    await pushLineMessage(settings.token, lineUserId, [buildPaymentReceiptFlexMessage(input, settings)]);

    const remaining = Math.max(0, input.billTotal - input.paidTotal);
    const fullySettled = remaining <= 0.005;
    await logOutboundChatMessage(
      lineUserId, String(input.tenantId ?? ""),
      `🧾 ใบเสร็จรับเงิน ห้อง ${input.roomNumber} (เดือน ${monthYearLabel(input.monthYear, settings.yearFormat)})\n`
      + `รับชำระ ${fmtMoney(input.amount)} ฿ — ${fullySettled ? "ชำระครบถ้วนแล้ว" : `คงเหลือ ${fmtMoney(remaining)} ฿`}`,
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

// เรียกเป็นระยะจาก index.ts — เช็คบิลทุกใบที่ตั้ง "วันนัดส่ง" (scheduledDate) ตรงกับวันนี้ และยังไม่เคย
// ส่งอัตโนมัติมาก่อน (lineAutoSentAt ว่าง) แล้วส่งให้ทุกห้องที่มีผู้เช่าและยังไม่จ่าย ครั้งเดียวต่อบิลต่อวัน
export async function runLineAutoSend(): Promise<void> {
  const settings = await getLineSettings();
  if (!settings.enabled || !settings.autoSendEnabled || !settings.token) return;

  const today = todayBangkok();
  const rows = await db.select().from(bills);

  for (const row of rows) {
    if (!row.scheduledDate || row.scheduledDate !== today) continue;
    if (row.lineAutoSentAt) continue;

    let data: any[] = [];
    try { data = row.data ? JSON.parse(row.data) : []; } catch { data = []; }

    for (const item of data) {
      if (!item?.tenantId || item?.status === "paid") continue;
      try {
        await sendBillLineForRoom(row.id, String(item.roomId), "auto", "ระบบอัตโนมัติ");
      } catch (e) {
        console.error(`[line-auto-send] bill=${row.id} room=${item.roomId}`, e);
      }
    }

    await db.update(bills).set({ lineAutoSentAt: new Date().toISOString() }).where(eq(bills.id, row.id));
  }
}
