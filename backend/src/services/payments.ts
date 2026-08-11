// ── ตรวจสลิปที่ผู้เช่าส่งเข้าแชท LINE อัตโนมัติด้วย EasySlip แล้วบันทึกยอดชำระ+ส่งใบเสร็จให้ทันทีถ้าตรง
// กับ "รายการรอชำระ" (payment intent) ที่สร้างไว้ตอนกดสร้าง QR ในหน้า LIFF Payment (ดู routes/liff.ts)
// เรียกจาก routes/lineWebhook.ts ทุกครั้งที่มีรูปภาพเข้ามาใหม่ — best-effort ทั้งหมด ไม่ throw ออกไปกัน
// webhook ทั้งเส้นล้มถ้า EasySlip ล่ม/คีย์ผิด/ตรวจไม่ผ่าน (ปล่อยให้พนักงานเห็นรูปในแชทแล้วบันทึกเองตามปกติ)
import { and, eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { db } from "../db";
import { appConfig, bills, payments, paymentIntents } from "../db/schema";
import { verifySlipImage } from "./easyslip";
import { sendPaymentReceiptLine } from "./line";
import { broadcastChange } from "../lib/wsHub";
import { decryptField } from "../lib/encryption";

const INTENT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // รายการรอชำระที่สร้างไว้เกิน 2 ชม. ไม่เอามาจับคู่ กันจับคู่ผิดกับ QR เก่าที่ค้างไว้นาน
const AMOUNT_MATCH_TOLERANCE = 0.5; // บาท — เผื่อการปัดเศษสตางค์ของแต่ละธนาคาร

export async function tryAutoConfirmSlipPayment(orgId: string, lineUserId: string, imageRelPath: string): Promise<void> {
  try {
    if (!imageRelPath) return;
    const [config] = await db.select().from(appConfig).where(eq(appConfig.id, orgId));
    if (config?.easySlipEnabled !== "true") return;
    const apiKey = decryptField(config?.easySlipApiKey || "");
    if (!apiKey) return;

    const pending = await db.select().from(paymentIntents)
      .where(and(eq(paymentIntents.orgId, orgId), eq(paymentIntents.lineUserId, lineUserId), eq(paymentIntents.status, "pending")));
    const recent = pending.filter((it) => Date.now() - new Date(it.createdAt || 0).getTime() < INTENT_MAX_AGE_MS);
    if (recent.length === 0) return;

    const filePath = resolve(process.cwd(), imageRelPath.replace(/^\//, ""));
    const buffer = await readFile(filePath);
    const result = await verifySlipImage(apiKey, buffer.toString("base64"));
    if (!result.success || result.isDuplicate || result.amount <= 0) return;

    const matched = recent
      .filter((it) => Math.abs((Number(it.amount) || 0) - result.amount) < AMOUNT_MATCH_TOLERANCE)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
    if (!matched) return;

    await recordConfirmedPayment(orgId, matched, {
      slipUrl: imageRelPath,
      actor: "ระบบอัตโนมัติ (EasySlip)",
      note: `ชำระผ่าน LIFF — ตรวจสลิปอัตโนมัติด้วย EasySlip (อ้างอิง ${result.transRef})`,
    });
  } catch (e) {
    console.error("[easyslip-auto-verify]", e);
  }
}

export interface ConfirmedPaymentResult {
  ok: boolean;
  message?: string;
}

// พอร์ตมาจาก handleConfirmPayment ใน frontend/src/pages/BillsPage.tsx (เฉพาะส่วนคำนวณ/บันทึกยอด — ไม่รวม
// ส่วนปรับค่าปรับ/ส่วนลด/ปิดยอดค้างเดือนก่อนหน้า ซึ่งเป็นการตัดสินใจของพนักงานเท่านั้น ไม่ทำอัตโนมัติ) ใช้ร่วมกัน
// ทั้งเส้นทางตรวจสลิปอัตโนมัติด้วย EasySlip (ด้านบน) และเส้นทางพนักงานกดยืนยันเองจากการ์ดในหน้าแชท (ดู
// PATCH /chat/conversations/:lineUserId/messages/:id/payment-confirm ใน routes/chat.ts)
export async function recordConfirmedPayment(
  orgId: string,
  intent: typeof paymentIntents.$inferSelect,
  opts: { slipUrl: string; actor: string; note: string; sendReceipt?: boolean }
): Promise<ConfirmedPaymentResult> {
  const [billRow] = await db.select().from(bills).where(and(eq(bills.id, intent.billId), eq(bills.orgId, orgId)));
  if (!billRow) return { ok: false, message: "ไม่พบบิลของรายการรอชำระนี้" };
  let data: any[] = [];
  try { data = billRow.data ? JSON.parse(billRow.data) : []; } catch { data = []; }
  const idx = data.findIndex((it: any) => String(it?.roomId) === intent.roomId);
  if (idx === -1) return { ok: false, message: "ไม่พบข้อมูลห้องนี้ในบิล" };
  const item = data[idx];

  const remainingDue = Math.max(0, Number(item.total) - (Number(item.paidAmount) || 0));
  const amountApplied = Math.min(Number(intent.amount) || 0, remainingDue);
  if (amountApplied <= 0) return { ok: false, message: "บิลนี้จ่ายครบไปแล้วก่อนหน้า" };
  const newPaidAmount = (Number(item.paidAmount) || 0) + amountApplied;
  const fullySettled = newPaidAmount >= Number(item.total) - 0.005;

  item.paidAmount = newPaidAmount;
  item.status = fullySettled ? "paid" : "unpaid";
  data[idx] = item;

  await db.update(bills).set({ data: JSON.stringify(data), updatedAt: new Date().toISOString() }).where(eq(bills.id, intent.billId));

  const paymentId = `PAY-${Date.now()}`;
  const ts = new Date().toISOString();
  await db.insert(payments).values({
    id: paymentId,
    orgId,
    billId: intent.billId,
    tenantId: intent.tenantId || "",
    paymentDate: ts,
    data: JSON.stringify({
      roomId: intent.roomId, roomNumber: intent.roomNumber, tenantName: intent.tenantName,
      monthYear: intent.monthYear, method: "scan", amount: amountApplied, received: amountApplied, change: 0,
      note: opts.note,
      slipUrl: opts.slipUrl,
    }),
    operator: opts.actor,
    action: "pay",
  });

  await db.update(paymentIntents).set({ status: "confirmed", confirmedAt: ts, paymentId }).where(eq(paymentIntents.id, intent.id));

  try {
    await sendPaymentReceiptLine(orgId, {
      tenantId: intent.tenantId, roomNumber: intent.roomNumber || "", monthYear: intent.monthYear || "",
      method: "scan", amount: amountApplied, change: 0, note: "", paymentDate: ts,
      billTotal: Number(item.total) || 0, paidTotal: newPaidAmount, slipUrl: opts.slipUrl, actor: opts.actor,
    }, opts.sendReceipt !== false);
  } catch (e) {
    console.error("[record-confirmed-payment][receipt]", e);
  }

  broadcastChange(orgId, "bill", "update", `ชำระเงินผ่าน LIFF (${opts.actor})`, opts.actor);
  broadcastChange(orgId, "payment", "create", "ชำระเงินผ่าน LIFF", opts.actor);

  return { ok: true };
}
