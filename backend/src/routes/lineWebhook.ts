// ── LINE Messaging API Webhook — รับข้อความเข้าจากผู้เช่า (สาธารณะ ไม่ต้องล็อกอิน เพราะ LINE
// เป็นคนยิงมาเอง ไม่ได้แนบ Authorization: Bearer ของระบบเรา) เมานต์คู่กับ authPublicRoute ใน index.ts
// ก่อนการ์ด authDerive เสมอ ──────────────────────────────────────────────────────────────────────
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { chatMessages, tenants } from "../db/schema";
import { getLineSettings, verifyLineSignature, getLineProfile, downloadLineContent } from "../services/line";
import { broadcastChange } from "../lib/wsHub";

// หาผู้เช่าที่ผูก lineUserId นี้ไว้ (ผู้ทำสัญญาหลักหรือผู้ร่วมพักอาศัยก็ได้) — ไม่เจอคืน null เฉยๆ
async function findTenantByLineUserId(lineUserId: string) {
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

export const lineWebhookRoute = new Elysia({ prefix: "/line" })
  // parse: "none" — ปิด body parser อัตโนมัติของ Elysia เพื่ออ่าน raw body เองก่อน (ต้องใช้ raw bytes
  // เดิมเป๊ะๆ ในการคำนวณ HMAC ตรวจ x-line-signature ถ้าปล่อยให้ Elysia parse เป็น JSON ก่อนแล้วค่อย
  // stringify กลับ ลายเซ็นจะไม่ตรงเพราะ key order/format อาจไม่เหมือน raw body ที่ LINE ส่งมาเป๊ะๆ)
  .post(
    "/webhook",
    async ({ request, set }) => {
      const settings = await getLineSettings();
      if (!settings.enabled || !settings.token || !settings.channelSecret) {
        // ยังไม่ได้ตั้งค่าให้ครบ — ตอบ 200 เฉยๆ กัน LINE เข้าใจว่า endpoint ล่มแล้ว retry รัวๆ
        return { ok: true };
      }

      const rawBody = await request.text();
      const signature = request.headers.get("x-line-signature") ?? undefined;
      if (!verifyLineSignature(settings.channelSecret, rawBody, signature)) {
        set.status = 401;
        return { error: "invalid signature" };
      }

      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        set.status = 400;
        return { error: "invalid body" };
      }

      const events: any[] = Array.isArray(payload?.events) ? payload.events : [];
      let received = false;

      for (const event of events) {
        if (event?.type !== "message" || !event?.message) continue;
        const lineUserId = String(event?.source?.userId ?? "").trim();
        if (!lineUserId) continue;

        const tenant = await findTenantByLineUserId(lineUserId);
        const senderName = tenant
          ? `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim()
          : await getLineProfile(settings.token, lineUserId);

        let messageType = "unsupported";
        let text = "";
        let imageUrl = "";
        let fileUrl = "";
        let fileName = "";
        let packageId = "";
        let stickerId = "";
        const msg = event.message;
        if (msg.type === "text") {
          messageType = "text";
          text = String(msg.text ?? "");
        } else if (msg.type === "image") {
          messageType = "image";
          imageUrl = await downloadLineContent(settings.token, String(msg.id ?? ""), "jpg");
          text = "[รูปภาพ]";
        } else if (msg.type === "sticker") {
          messageType = "sticker";
          packageId = String(msg.packageId ?? "");
          stickerId = String(msg.stickerId ?? "");
          text = "[สติกเกอร์]";
        } else if (msg.type === "file") {
          messageType = "file";
          fileName = String(msg.fileName ?? "ไฟล์แนบ");
          const ext = fileName.includes(".") ? fileName.split(".").pop() ?? "bin" : "bin";
          fileUrl = await downloadLineContent(settings.token, String(msg.id ?? ""), ext);
          text = `[ไฟล์] ${fileName}`;
        } else if (msg.type === "video") {
          text = "[วิดีโอ]";
        } else if (msg.type === "location") {
          text = "[ตำแหน่งที่ตั้ง]";
        } else {
          text = "[ข้อความที่ไม่รองรับ]";
        }

        await db.insert(chatMessages).values({
          id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          lineUserId,
          tenantId: tenant?.id ?? "",
          direction: "in",
          messageType,
          text,
          imageUrl,
          fileUrl,
          fileName,
          packageId,
          stickerId,
          senderName,
          createdAt: new Date().toISOString(),
        });
        received = true;
      }

      if (received) broadcastChange("chat", "create", "มีข้อความแชทใหม่จาก LINE", "LINE");

      return { ok: true };
    },
    { parse: "none" }
  );
