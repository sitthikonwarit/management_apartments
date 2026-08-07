import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { bills, payments, users } from "../db/schema";
import { sendBillLineForRoom, sendPaymentReceiptLine } from "../services/line";
import { authDerive } from "../lib/authDerive";
import { signUploadPath } from "../lib/encryption";

function parseBill(r: typeof bills.$inferSelect) {
  let data: any = [];
  try { data = r.data ? JSON.parse(r.data) : []; } catch {}
  return {
    id: r.id,
    monthYear: r.monthYear,
    data,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    scheduledDate: r.scheduledDate,
    lineAutoSentAt: r.lineAutoSentAt,
  };
}

function parsePayment(r: typeof payments.$inferSelect) {
  let data: any = {};
  try { data = r.data ? JSON.parse(r.data) : {}; } catch {}
  // slipUrl เก็บดิบๆ ไม่มีลายเซ็นในฐานข้อมูล (ดู lib/encryption.ts) — เซ็นตอนส่งออกให้ frontend ตรงนี้เท่านั้น
  if (data?.slipUrl) data = { ...data, slipUrl: signUploadPath(data.slipUrl) };
  return {
    id: r.id,
    billId: r.billId,
    tenantId: r.tenantId,
    paymentDate: r.paymentDate,
    data,
    operator: r.operator,
    action: r.action,
  };
}

async function uploadPaymentSlip(orgId: string, filename: string, mimeType: string, base64Data: string): Promise<string> {
  const { writeFileSync, mkdirSync } = await import("fs");
  const { resolve } = await import("path");
  const uploadDir = resolve(process.cwd(), "uploads", "payments", orgId);
  mkdirSync(uploadDir, { recursive: true });
  const base64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(base64, "base64");
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  writeFileSync(resolve(uploadDir, safeName), buffer);
  // path สัมพัทธ์ล้วนๆ (ไม่ฝัง host:port) — ฝั่ง frontend พร็อกซี /uploads ไปที่ backend เอง (ดู vite.config.ts)
  // กัน URL รูปพังตอน IP เครื่องใน LAN เปลี่ยน (เช่น BASE_URL เดิมผูกกับ IP ที่ DHCP จ่ายใหม่ไปแล้ว)
  return `/uploads/payments/${orgId}/${safeName}`;
}

export const billsRoute = new Elysia({ prefix: "/bills" })
  .use(authDerive)
  .get("/", async ({ authUser }) => {
    const rows = await db.select().from(bills).where(eq(bills.orgId, authUser!.orgId));
    return rows.map(parseBill);
  })
  .get("/payments", async ({ authUser }) => {
    const rows = await db.select().from(payments).where(eq(payments.orgId, authUser!.orgId));
    return rows.map(parsePayment);
  })
  .post("/payments", async ({ body, set, authUser }) => {
    const orgId = authUser!.orgId;
    const b = body as any;
    if (!b.billId || !b.roomId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }
    // บิลที่จะบันทึกยอดต้องเป็นขององค์กรตัวเองเท่านั้น (กัน billId ขององค์กรอื่นหลุดเข้ามา)
    const [billOwned] = await db.select({ id: bills.id }).from(bills).where(and(eq(bills.id, String(b.billId)), eq(bills.orgId, orgId)));
    if (!billOwned) { set.status = 404; return { error: "ไม่พบบิล" }; }
    let slipUrl = "";
    if (b.slipImage?.base64) {
      const mimeType = String(b.slipImage.base64).match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
      const ext = mimeType.split("/")[1] || "jpg";
      slipUrl = await uploadPaymentSlip(orgId, b.slipImage.name || `slip.${ext}`, mimeType, b.slipImage.base64);
    }
    const id = `PAY-${Date.now()}`;
    const ts = new Date().toISOString();
    await db.insert(payments).values({
      id,
      orgId,
      billId: String(b.billId),
      tenantId: b.tenantId ? String(b.tenantId) : "",
      paymentDate: String(b.paymentDate || ts),
      data: JSON.stringify({
        roomId: String(b.roomId),
        roomNumber: String(b.roomNumber ?? ""),
        tenantName: String(b.tenantName ?? ""),
        monthYear: String(b.monthYear ?? ""),
        method: b.method === "scan" ? "scan" : "cash",
        amount: Number(b.amount) || 0,
        received: Number(b.received) || 0,
        change: Number(b.change) || 0,
        note: String(b.note ?? ""),
        slipUrl,
      }),
      operator: String(b.operator ?? ""),
      action: "pay",
    });
    const [row] = await db.select().from(payments).where(eq(payments.id, id));

    // ส่งใบเสร็จรับเงินทาง LINE ทันทีที่บันทึกยอดสำเร็จ (best-effort — ไม่ทำให้การบันทึกยอดล้มเหลวถ้าส่งไม่ได้
    // เช่น ผู้เช่ายังไม่ผูก LINE User ID หรือปิดใช้งาน LINE Messaging ไว้)
    try {
      let actor = "พนักงาน";
      if (authUser?.id) {
        const [u] = await db.select().from(users).where(and(eq(users.id, authUser.id), eq(users.orgId, orgId)));
        actor = u?.displayName || u?.username || authUser.username || "พนักงาน";
      }
      await sendPaymentReceiptLine(orgId, {
        tenantId: b.tenantId ? String(b.tenantId) : null,
        roomNumber: String(b.roomNumber ?? ""),
        monthYear: String(b.monthYear ?? ""),
        method: b.method === "scan" ? "scan" : "cash",
        amount: Number(b.amount) || 0,
        change: Number(b.change) || 0,
        note: String(b.note ?? ""),
        paymentDate: String(b.paymentDate || ts),
        billTotal: Number(b.billTotal) || 0,
        paidTotal: Number(b.paidTotal) || 0,
        slipUrl,
        actor,
      });
    } catch (e) {
      console.error("[send-payment-receipt]", e);
    }

    return parsePayment(row);
  })
  // ยกเลิกรายการชำระ — ไม่ลบทิ้ง (soft-cancel) เก็บไว้เป็นหลักฐานพร้อมหมายเหตุ ให้ยังเห็นในประวัติได้
  .patch("/payments/:id/cancel", async ({ authUser, params, body, set }) => {
    const [existing] = await db.select().from(payments).where(and(eq(payments.id, params.id), eq(payments.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบรายการชำระ" }; }
    let data: any = {};
    try { data = existing.data ? JSON.parse(existing.data) : {}; } catch {}
    data.cancelled = true;
    data.cancelReason = String((body as any)?.reason ?? "");
    data.cancelledAt = new Date().toISOString();
    await db.update(payments).set({ data: JSON.stringify(data) }).where(eq(payments.id, params.id));
    const [row] = await db.select().from(payments).where(eq(payments.id, params.id));
    return parsePayment(row);
  })
  .post("/", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const { monthYear, data, scheduledDate } = body as any;
    if (!monthYear) { set.status = 400; return { error: "ต้องระบุเดือน/ปี" }; }
    const [existing] = await db.select().from(bills).where(and(eq(bills.monthYear, monthYear), eq(bills.orgId, orgId)));
    if (existing) { set.status = 409; return { error: "มีบิลของเดือนนี้อยู่แล้ว" }; }
    const id = `BILL-${Date.now()}`;
    const ts = new Date().toISOString();
    await db.insert(bills).values({
      id,
      orgId,
      monthYear: String(monthYear),
      data: JSON.stringify(Array.isArray(data) ? data : []),
      createdAt: ts,
      updatedAt: ts,
      scheduledDate: String(scheduledDate ?? ""),
    });
    const [row] = await db.select().from(bills).where(eq(bills.id, id));
    return parseBill(row);
  })
  .put("/:id", async ({ authUser, params, body, set }) => {
    const { id } = params;
    const [existing] = await db.select().from(bills).where(and(eq(bills.id, id), eq(bills.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบบิล" }; }
    const { data, scheduledDate } = body as any;
    await db.update(bills).set({
      ...(data !== undefined && { data: JSON.stringify(Array.isArray(data) ? data : []) }),
      ...(scheduledDate !== undefined && { scheduledDate: String(scheduledDate ?? "") }),
      updatedAt: new Date().toISOString(),
    }).where(eq(bills.id, id));
    const [row] = await db.select().from(bills).where(eq(bills.id, id));
    return parseBill(row);
  })
  .delete("/:id", async ({ authUser, params, set }) => {
    const [existing] = await db.select().from(bills).where(and(eq(bills.id, params.id), eq(bills.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบบิล" }; }
    await db.delete(bills).where(eq(bills.id, params.id));
    return { deleted: params.id };
  })
  // ส่งบิลของห้องหนึ่งห้องในบิลกลุ่มนี้เข้า LINE ของผู้เช่า (ต้องบันทึกบิลไว้แล้วก่อน เพราะอ่านข้อมูล
  // ห้องจาก DB ตรงๆ — ฝั่งหน้าเว็บจะบันทึกให้อัตโนมัติก่อนส่งถ้ายังมีการแก้ไขที่ไม่ได้บันทึก)
  .post("/:id/send-line", async ({ params, body, set, authUser }) => {
    const orgId = authUser!.orgId;
    const { roomId } = body as any;
    if (!roomId) { set.status = 400; return { error: "ต้องระบุ roomId" }; }
    let actor = "Admin";
    if (authUser?.id) {
      const [u] = await db.select().from(users).where(and(eq(users.id, authUser.id), eq(users.orgId, orgId)));
      actor = u?.displayName || u?.username || authUser.username || "Admin";
    }
    const result = await sendBillLineForRoom(orgId, params.id, String(roomId), "manual", actor);
    if (result.message === "ไม่พบบิล" || result.message === "ไม่พบข้อมูลห้องนี้ในบิล") {
      set.status = 404;
      return { error: result.message };
    }
    return { success: result.success, message: result.message, bill: result.bill ? parseBill(result.bill) : null };
  });
