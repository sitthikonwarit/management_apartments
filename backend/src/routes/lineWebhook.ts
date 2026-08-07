// ── LINE Messaging API Webhook — รับข้อความเข้าจากผู้เช่า (สาธารณะ ไม่ต้องล็อกอิน เพราะ LINE
// เป็นคนยิงมาเอง ไม่ได้แนบ Authorization: Bearer ของระบบเรา) เมานต์คู่กับ authPublicRoute ใน index.ts
// ก่อนการ์ด authDerive เสมอ ──────────────────────────────────────────────────────────────────────
// Multi-tenant: webhook path เดียวใช้ร่วมกันทุกองค์กร (แต่ละองค์กรตั้งค่า URL นี้เหมือนกันในหน้า LINE Console
// ของ Messaging API channel ตัวเอง) แยกว่าข้อความนี้เป็นขององค์กรไหนจาก payload.destination (LINE User ID
// ของบอทที่ยิงมา) เทียบกับ appConfig.lineBotUserId ที่แคชไว้ตอนบันทึกการตั้งค่า LINE Messaging (ดู
// getBotUserId ใน services/line.ts, resolveOrgIdByDestination ใน lib/orgContext.ts) ต้อง parse body อ่าน
// destination "ก่อน" ตรวจลายเซ็น HMAC เพราะ secret ที่ใช้ตรวจก็ต่างกันไปตามองค์กรที่ resolve ได้ — ปลอดภัย
// เพราะต่อให้ปลอม destination ก็แค่ทำให้เลือก secret ผิดองค์กรมาตรวจ ลายเซ็นก็จะไม่ผ่านอยู่ดี ไม่มีทางปลอม
// ลายเซ็นให้ผ่านได้โดยไม่รู้ secret จริงขององค์กรนั้น
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { chatMessages, lineProfiles, rooms } from "../db/schema";
import {
  getLineSettings, verifyLineSignature, getLineProfile, downloadLineContent,
  findTenantByLineUserId, cacheLineProfile,
} from "../services/line";
import { tryAutoConfirmSlipPayment } from "../services/payments";
import { broadcastChange, broadcastChatMessage } from "../lib/wsHub";
import { resolveOrgIdByDestination, resolveOrgIdWithFallback } from "../lib/orgContext";

const PROFILE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 วัน — ไม่ต้องยิง LINE API ทุกข้อความที่เข้ามา

// แคชรูปโปรไฟล์ LINE ของผู้ส่ง ถ้ายังไม่เคยแคชไว้หรือแคชเก่าเกิน 7 วันแล้ว (best-effort ไม่ throw กัน webhook ล้ม)
async function refreshProfileCacheIfStale(orgId: string, token: string, lineUserId: string, alreadyFetched: { displayName: string; pictureUrl: string } | null) {
  try {
    const [existing] = await db.select().from(lineProfiles).where(eq(lineProfiles.lineUserId, lineUserId));
    const isStale = !existing || (Date.now() - new Date(existing.updatedAt || 0).getTime() > PROFILE_CACHE_MAX_AGE_MS);
    if (!isStale) return;
    const profile = alreadyFetched ?? await getLineProfile(token, lineUserId);
    await cacheLineProfile(orgId, lineUserId, profile);
  } catch {
    // แคชรูปโปรไฟล์ไม่สำเร็จ ไม่ใช่เรื่องคอขาดบาดตาย ปล่อยผ่านไป
  }
}

export const lineWebhookRoute = new Elysia({ prefix: "/line" })
  // parse: "none" — ปิด body parser อัตโนมัติของ Elysia เพื่ออ่าน raw body เองก่อน (ต้องใช้ raw bytes
  // เดิมเป๊ะๆ ในการคำนวณ HMAC ตรวจ x-line-signature ถ้าปล่อยให้ Elysia parse เป็น JSON ก่อนแล้วค่อย
  // stringify กลับ ลายเซ็นจะไม่ตรงเพราะ key order/format อาจไม่เหมือน raw body ที่ LINE ส่งมาเป๊ะๆ)
  .post(
    "/webhook",
    async ({ request, set }) => {
      const rawBody = await request.text();

      // parse ก่อนตรวจลายเซ็น แค่เพื่ออ่าน destination มา resolve องค์กร (ยังไม่เชื่อเนื้อหาอื่นในนี้จนกว่า
      // จะตรวจลายเซ็นผ่านด้านล่าง — ดูคอมเมนต์หัวไฟล์ว่าทำไม ordering นี้ปลอดภัย)
      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        set.status = 400;
        return { error: "invalid body" };
      }

      const destination = String(payload?.destination ?? "");
      const orgId = await resolveOrgIdWithFallback(await resolveOrgIdByDestination(destination));
      if (!orgId) return { ok: true }; // ไม่รู้จักช่องทางนี้เลย (2+ องค์กรในระบบแล้วแต่ยังไม่มีใครตรงกัน) — ตอบ 200 เฉยๆ ทิ้งไป กัน LINE retry รัว

      const settings = await getLineSettings(orgId);
      if (!settings.enabled || !settings.token || !settings.channelSecret) {
        // ยังไม่ได้ตั้งค่าให้ครบ — ตอบ 200 เฉยๆ กัน LINE เข้าใจว่า endpoint ล่มแล้ว retry รัวๆ
        return { ok: true };
      }

      const signature = request.headers.get("x-line-signature") ?? undefined;
      if (!verifyLineSignature(settings.channelSecret, rawBody, signature)) {
        set.status = 401;
        return { error: "invalid signature" };
      }

      const events: any[] = Array.isArray(payload?.events) ? payload.events : [];
      let received = false;

      for (const event of events) {
        if (event?.type !== "message" || !event?.message) continue;
        const lineUserId = String(event?.source?.userId ?? "").trim();
        if (!lineUserId) continue;

        const tenant = await findTenantByLineUserId(orgId, lineUserId);
        const lineProfile = tenant ? null : await getLineProfile(settings.token, lineUserId);
        const senderName = tenant
          ? `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim()
          : lineProfile?.displayName ?? "";
        await refreshProfileCacheIfStale(orgId, settings.token, lineUserId, lineProfile);

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
          orgId,
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

        // ป็อปอัพแจ้งเตือนมุมขวาล่างในหน้าเว็บ — พ่วงรูปโปรไฟล์ (แคชล่าสุด หลัง refreshProfileCacheIfStale
        // ด้านบนแล้ว) + เลขห้อง (ถ้าผูกผู้เช่าไว้) + ตัวอย่างข้อความไปด้วย ไม่ต้องให้ frontend ยิงถามซ้ำ
        const [room] = tenant?.idRoom ? await db.select().from(rooms).where(eq(rooms.id, tenant.idRoom)) : [];
        const [profileRow] = await db.select().from(lineProfiles).where(eq(lineProfiles.lineUserId, lineUserId));
        broadcastChatMessage(orgId, {
          lineUserId,
          displayName: senderName || "ไม่ทราบชื่อ",
          roomNumber: room?.number || null,
          pictureUrl: profileRow?.pictureUrl || null,
          preview: text,
        });

        // ผู้เช่าอาจส่งรูปสลิปเข้ามาหลังกดสร้าง QR ในหน้า LIFF Payment — ลองตรวจ+บันทึกยอดชำระอัตโนมัติด้วย
        // EasySlip (ไม่มีผลอะไรถ้าไม่มี "รายการรอชำระ" ค้างอยู่ หรือยังไม่ได้ตั้งค่า EasySlip ไว้) ต้องทำ "หลัง"
        // บันทึกข้อความรูปสลิปข้างบนเสร็จแล้วเท่านั้น ไม่งั้นใบเสร็จที่ tryAutoConfirmSlipPayment ส่งเข้าแชท
        // จะได้ createdAt เร็วกว่ารูปสลิปเอง ทำให้เรียงลำดับผิด (ใบเสร็จโผล่ขึ้นก่อนสลิปที่มันอ้างอิงถึง)
        if (msg.type === "image" && imageUrl) {
          await tryAutoConfirmSlipPayment(orgId, lineUserId, imageUrl);
        }
      }

      if (received) broadcastChange(orgId, "chat", "create", "มีข้อความแชทใหม่จาก LINE", "LINE");

      return { ok: true };
    },
    { parse: "none" }
  );
