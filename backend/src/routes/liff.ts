// ── หน้า LIFF ฝั่งผู้เช่า (Login/Payment) — สาธารณะ ไม่ต้องล็อกอินด้วย Bearer ของระบบเรา (เหมือน
// lineWebhook.ts) เพราะผู้เช่าไม่มีบัญชีพนักงาน ยืนยันตัวตนด้วย LIFF access token (ของผู้ใช้ LINE เอง)
// กับ LINE ตรงๆ แทน (ดู verifyLiffAccessToken ใน services/line.ts) เมานต์คู่กับ authPublicRoute ใน
// index.ts ก่อนการ์ด authDerive เสมอ ─────────────────────────────────────────────────────────────
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appConfig, rooms, tenants, paymentIntents } from "../db/schema";
import {
  getLineSettings, verifyLiffAccessToken, findTenantByLineUserId, findTenantsByPhone,
  getOutstandingBillsForTenant, getBillItemForTenant, buildChatBillSnapshot,
} from "../services/line";
import { linkRichMenuToUser } from "../services/richMenu";
import { generatePromptPayQr } from "../services/easyslip";
import { broadcastChange } from "../lib/wsHub";

const CONFIG_ID = "default";

async function getConfigRow() {
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
  return row;
}

function tenantDisplayName(tenant: { title: string | null; firstName: string | null; lastName: string | null }): string {
  return `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim();
}

async function tenantRoomNumber(idRoom: string | null): Promise<string> {
  if (!idRoom) return "";
  const [room] = await db.select().from(rooms).where(eq(rooms.id, idRoom));
  return room?.number ?? "";
}

// สลับจาก Rich Menu Guest เป็น Member เฉพาะ LINE User ID นี้ — ใช้ทั้งตอน login ปกติ (เจอว่าผูกไว้แล้ว)
// และตอนผูกบัญชีเองผ่านเบอร์โทร (link-phone) เพิ่งผูกสำเร็จหมาดๆ
async function linkMemberMenu(userId: string): Promise<boolean> {
  const row = await getConfigRow();
  const settings = await getLineSettings();
  if (!settings.token || !row?.richMenuMemberId) return false;
  return linkRichMenuToUser(settings.token, userId, row.richMenuMemberId);
}

export const liffRoute = new Elysia({ prefix: "/liff" })
  // ข้อมูลตั้งค่าที่จำเป็นก่อนเรียก liff.init() ฝั่ง frontend (LIFF ID ฝังอยู่ใน URL รูปแบบ
  // https://liff.line.me/{liffId}) + โลโก้/ชื่อระบบไว้ตกแต่งหน้าให้ตรงธีมเว็บหลัก — ไม่ใช่ข้อมูลลับ
  .get("/config", async () => {
    const row = await getConfigRow();
    return {
      liffLoginUrl: row?.liffLoginUrl || "",
      liffPaymentUrl: row?.liffPaymentUrl || "",
      appIdentity: {
        logoUrl: row?.logoUrl || "",
        nameText: row?.appName || "",
        logoBg: { enabled: row?.logoBgEnabled === "true", color: row?.logoBgColor || "#ffffff" },
      },
    };
  })
  // ปุ่ม "เข้าสู่ระบบ" บนเมนู Guest — ตรวจ access token กับ LINE แล้วหาว่าผูกกับผู้เช่าคนไหนไว้หรือยัง
  // ถ้าเจอ ผูก Rich Menu แบบ Member ให้อัตโนมัติ (สลับจาก Guest เป็น Member เฉพาะคนนี้)
  .post("/login", async ({ body, set }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(profile.userId);
    if (!tenant) {
      return { linked: false, lineUserId: profile.userId, displayName: profile.displayName };
    }

    const menuLinked = await linkMemberMenu(profile.userId);

    return {
      linked: true,
      tenantName: tenantDisplayName(tenant),
      roomNumber: await tenantRoomNumber(tenant.idRoom),
      menuLinked,
    };
  })
  // ผูกบัญชี LINE เข้ากับผู้เช่าเองผ่านเบอร์โทร (ทางเลือกในหน้า LIFF Login ตอนยังไม่พบว่าผูกไว้) — ยึดหลัก
  // "1 เบอร์ต่อ 1 คน": ผูกได้ครั้งแรกที่เบอร์นี้ยังไม่เคยผูก LINE ไว้เท่านั้น ถ้ามีคนผูกไปแล้ว (ไม่ว่าจะเป็น
  // LINE ID เดียวกันหรือคนละคน) จะไม่ยอมให้เบอร์นี้ผูกทับ ป้องกันคนอื่นแอบพิมพ์เบอร์คนอื่นเพื่อขโมยบัญชีไปก่อน
  .post("/link-phone", async ({ body, set }) => {
    const { accessToken, phone } = body as { accessToken?: string; phone?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!phone?.trim()) { set.status = 400; return { error: "กรุณากรอกเบอร์โทรศัพท์" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const matches = await findTenantsByPhone(phone);
    if (matches.length === 0) { set.status = 404; return { error: "ไม่พบเบอร์โทรศัพท์นี้ในระบบ กรุณาติดต่อผู้ดูแลหอพัก" }; }
    if (matches.length > 1) { set.status = 409; return { error: "พบเบอร์นี้ซ้ำกันมากกว่า 1 คนในระบบ กรุณาติดต่อผู้ดูแลหอพัก" }; }

    const tenant = matches[0];
    const existingLineUserId = (tenant.lineUserId ?? "").trim();
    if (existingLineUserId) {
      set.status = 409;
      return { error: "เบอร์นี้ผูกกับบัญชี LINE ไว้แล้ว หากไม่ใช่คุณ กรุณาติดต่อผู้ดูแลหอพัก" };
    }

    await db.update(tenants).set({ lineUserId: profile.userId }).where(eq(tenants.id, tenant.id));
    broadcastChange("tenant", "update", "ผู้เช่าผูกบัญชี LINE เอง (เบอร์โทร)", tenantDisplayName(tenant));

    const menuLinked = await linkMemberMenu(profile.userId);

    return {
      linked: true,
      tenantName: tenantDisplayName(tenant),
      roomNumber: await tenantRoomNumber(tenant.idRoom),
      menuLinked,
    };
  })
  // ปุ่ม "ชำระเงิน" บนเมนู Member — แสดงยอดค้างชำระ + ข้อมูลบัญชี/QR ที่ตั้งค่าไว้ในหน้า Settings
  .post("/payment", async ({ body, set }) => {
    const { accessToken } = body as { accessToken?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(profile.userId);
    if (!tenant) return { linked: false };

    const row = await getConfigRow();
    const outstanding = await getOutstandingBillsForTenant(tenant.id);

    return {
      linked: true,
      tenantName: tenantDisplayName(tenant),
      roomNumber: await tenantRoomNumber(tenant.idRoom),
      outstanding,
      paymentInfo: {
        bankName: row?.paymentBankName || "",
        accountName: row?.paymentAccountName || "",
        accountNumber: row?.paymentAccountNumber || "",
        qrImage: row?.paymentQrImage || "",
        // มี API key ก็เลือกจำนวนเงินเอง+ตรวจสลิปอัตโนมัติได้แล้ว (endpoint /payment/qr ด้านล่าง) — ไม่
        // จำเป็นต้องมี PromptPay ID ด้วย (บางที่ผูกบัญชีธนาคารธรรมดากับ EasySlip ไว้ ไม่มี PromptPay ID
        // ให้ใช้สร้าง QR จริง) ถ้าไม่มี PromptPay ID จะโชว์เลขบัญชีให้คัดลอกแทน QR แต่ยังตรวจสลิปอัตโนมัติได้
        // เหมือนเดิม ไม่มี API key เลยถึงจะ fallback ไปโชว์แค่ QR/เลขบัญชีคงที่แบบไม่ตรวจสลิปให้
        autoTrackingAvailable: !!row?.easySlipApiKey,
        qrGenerationAvailable: !!(row?.easySlipApiKey && row?.paymentPromptPayId),
      },
    };
  })
  // กดปุ่ม "ดูรายละเอียด" ที่บิลเดือนใดเดือนหนึ่งในหน้า LIFF Payment — คืนข้อมูลชุดเดียวกับที่การ์ดบิลใน
  // หน้าแชท (ChatBillMessage) ใช้ ให้หน้าตาตรงกันเป๊ะๆ (ดู buildChatBillSnapshot ใน services/line.ts)
  .post("/bill-detail", async ({ body, set }) => {
    const { accessToken, billId, roomId } = body as { accessToken?: string; billId?: string; roomId?: string };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!billId || !roomId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(profile.userId);
    if (!tenant) { set.status = 404; return { error: "ไม่พบข้อมูลผู้เช่า" }; }

    const found = await getBillItemForTenant(billId, roomId, tenant.id);
    if (!found) { set.status = 404; return { error: "ไม่พบข้อมูลบิล" }; }

    const settings = await getLineSettings();
    return { snapshot: buildChatBillSnapshot(found.item, found.monthYear, settings) };
  })
  // เลือกจำนวนเงินที่จะจ่ายรอบนี้ (ไม่ต้องเต็มยอดบิล จ่ายเป็นงวดได้) แล้วบันทึก "รายการรอชำระ" ไว้จับคู่กับ
  // สลิปที่จะส่งเข้าแชทภายหลัง (ดู services/payments.ts) — สร้าง QR PromptPay ระบุยอดจริงให้ด้วยถ้ามี
  // PromptPay ID ตั้งไว้ ไม่งั้นคืนแค่เลขบัญชีให้โชว์เป็นข้อความคัดลอกแทน (ตรวจสลิปอัตโนมัติได้เหมือนกันทั้ง
  // สองแบบ เพราะขึ้นกับ "รายการรอชำระ" ที่บันทึกไว้ ไม่ได้ขึ้นกับว่าสร้าง QR ได้จริงหรือเปล่า)
  .post("/payment/qr", async ({ body, set }) => {
    const { accessToken, billId, roomId, amount } = body as { accessToken?: string; billId?: string; roomId?: string; amount?: number };
    if (!accessToken) { set.status = 400; return { error: "ไม่พบ access token จาก LINE" }; }
    if (!billId || !roomId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const tenant = await findTenantByLineUserId(profile.userId);
    if (!tenant) { set.status = 404; return { error: "ไม่พบข้อมูลผู้เช่า" }; }

    const found = await getBillItemForTenant(billId, roomId, tenant.id);
    if (!found) { set.status = 404; return { error: "ไม่พบข้อมูลบิล" }; }
    const { item, monthYear } = found;

    const remainingDue = Math.max(0, Number(item.total) - (Number(item.paidAmount) || 0));
    const payAmount = Math.round((Number(amount) || 0) * 100) / 100;
    if (payAmount <= 0 || payAmount > remainingDue + 0.5) {
      set.status = 400;
      return { error: `จำนวนเงินไม่ถูกต้อง (ยอดคงเหลือ ${remainingDue.toFixed(2)} บาท)` };
    }

    const row = await getConfigRow();
    const apiKey = row?.easySlipApiKey || "";
    const promptPayId = row?.paymentPromptPayId || "";
    if (!apiKey) {
      set.status = 400;
      return { error: "ระบบยังไม่ได้ตั้งค่า EasySlip API Key กรุณาติดต่อผู้ดูแลระบบ" };
    }

    let qrImage: string | null = null;
    if (promptPayId) {
      try {
        const qr = await generatePromptPayQr(apiKey, promptPayId, payAmount);
        qrImage = `data:${qr.mime};base64,${qr.image}`;
      } catch (e: any) {
        set.status = 502;
        return { error: e?.message ?? "สร้าง QR ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
      }
    }

    const intentId = `PINT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(paymentIntents).values({
      id: intentId,
      tenantId: tenant.id,
      tenantName: tenantDisplayName(tenant),
      billId, roomId,
      roomNumber: String(item.roomNumber ?? await tenantRoomNumber(tenant.idRoom)),
      monthYear,
      amount: String(payAmount),
      status: "pending",
      lineUserId: profile.userId,
      createdAt: new Date().toISOString(),
    });

    return {
      intentId,
      qrImage,
      amount: payAmount,
      accountInfo: qrImage ? null : {
        bankName: row?.paymentBankName || "",
        accountName: row?.paymentAccountName || "",
        accountNumber: row?.paymentAccountNumber || "",
      },
    };
  })
  // หน้า LIFF โพลสถานะเป็นระยะหลังสร้าง QR — ให้รู้ทันทีที่ตรวจสลิปสำเร็จอัตโนมัติ (ดู
  // tryAutoConfirmSlipPayment ใน services/payments.ts ที่อัปเดตสถานะนี้จาก routes/lineWebhook.ts)
  .post("/payment/status", async ({ body, set }) => {
    const { accessToken, intentId } = body as { accessToken?: string; intentId?: string };
    if (!accessToken || !intentId) { set.status = 400; return { error: "ข้อมูลไม่ครบ" }; }

    const profile = await verifyLiffAccessToken(accessToken);
    if (!profile) { set.status = 401; return { error: "ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }; }

    const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId));
    if (!intent || intent.lineUserId !== profile.userId) { set.status = 404; return { error: "ไม่พบรายการ" }; }

    return { status: intent.status };
  });
