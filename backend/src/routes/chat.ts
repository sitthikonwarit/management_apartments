import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { chatMessages, rooms, tenants, users } from "../db/schema";
import {
  getLineSettings, sendTextMessage, sendImageMessage, sendStickerMessage, sendFileLinkMessage,
  uploadChatAttachment, toPublicUrl,
} from "../services/line";

// สติกเกอร์ที่พนักงานเลือกส่งได้ — ต้องเป็นคู่ packageId/stickerId ที่ LINE เผยแพร่ทางการให้ส่งผ่าน
// Messaging API เท่านั้น (ไม่ใช่สติกเกอร์ที่ผู้เช่าซื้อเอง อ้างอิงจาก
// https://developers.line.biz/en/docs/messaging-api/sticker-list/) รายการนี้ต้องตรงกับ
// frontend/src/utils/lineStickers.ts เสมอ — validate ที่นี่กัน request ยิง id มั่วๆ ตรงเข้ามาที่ API
const ALLOWED_STICKERS = new Set([
  "446:1988", "446:1989", "446:1990", "446:1991", "446:1992",
  "6325:10979904", "6325:10979905", "6325:10979906", "6325:10979907", "6325:10979908",
  "6359:11069848", "6359:11069849", "6359:11069850", "6359:11069851", "6359:11069852",
  "11537:52002734", "11537:52002735", "11537:52002736", "11537:52002737", "11537:52002738",
]);

function parseMessage(r: typeof chatMessages.$inferSelect) {
  return {
    id: r.id,
    lineUserId: r.lineUserId,
    tenantId: r.tenantId || null,
    direction: r.direction as "in" | "out",
    messageType: r.messageType,
    text: r.text,
    imageUrl: r.imageUrl || null,
    fileUrl: r.fileUrl || null,
    fileName: r.fileName || null,
    packageId: r.packageId || null,
    stickerId: r.stickerId || null,
    senderName: r.senderName,
    createdAt: r.createdAt,
    read: !!r.readAt,
  };
}

async function resolveActorName(authUser: { id: string; username: string } | null): Promise<string> {
  if (!authUser?.id) return "พนักงาน";
  const [u] = await db.select().from(users).where(eq(users.id, authUser.id));
  return u?.displayName || u?.username || authUser.username || "พนักงาน";
}

// มาร์คข้อความเข้าที่ยังไม่อ่านของ conversation นี้เป็นอ่านแล้ว — เรียกทุกครั้งที่พนักงานส่งอะไรกลับไป
// (ถือว่าเปิดอ่านแล้วแน่ๆ ถ้าตอบอยู่)
async function markInboundRead(lineUserId: string) {
  await db.update(chatMessages).set({ readAt: new Date().toISOString() })
    .where(and(eq(chatMessages.lineUserId, lineUserId), eq(chatMessages.direction, "in")));
}

export const chatRoute = new Elysia({ prefix: "/chat" })
  // รายชื่อการสนทนาทั้งหมด เรียงตามข้อความล่าสุดก่อน — group ข้อความทั้งตารางด้วย JS (ข้อมูลระดับหอพักเดียว
  // ไม่ใหญ่พอที่จะต้องทำ aggregate query เอง เหมือนที่ tenants.ts/settings.ts ก็โหลดทั้งตารางมาประมวลผลเอง)
  .get("/conversations", async () => {
    const [messages, tenantRows, roomRows] = await Promise.all([
      db.select().from(chatMessages),
      db.select().from(tenants),
      db.select().from(rooms),
    ]);
    const tenantMap = new Map(tenantRows.map((t) => [t.id, t]));
    const roomMap = new Map(roomRows.map((r) => [r.id, r]));

    const groups = new Map<string, Array<typeof chatMessages.$inferSelect>>();
    for (const m of messages) {
      const arr = groups.get(m.lineUserId) ?? [];
      arr.push(m);
      groups.set(m.lineUserId, arr);
    }

    const result = Array.from(groups.entries()).map(([lineUserId, msgs]) => {
      msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const last = msgs[msgs.length - 1];
      const tenantId = [...msgs].reverse().find((m) => m.tenantId)?.tenantId || "";
      const tenant = tenantId ? tenantMap.get(tenantId) : undefined;
      const room = tenant?.idRoom ? roomMap.get(tenant.idRoom) : undefined;
      const displayName = tenant
        ? `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim()
        : [...msgs].reverse().find((m) => m.senderName)?.senderName || "ไม่ทราบชื่อ";
      const unreadCount = msgs.filter((m) => m.direction === "in" && !m.readAt).length;
      return {
        lineUserId,
        tenantId: tenantId || null,
        displayName,
        roomNumber: room?.number || null,
        lastMessage: last.messageType === "text" ? last.text : last.text || "[ไฟล์แนบ]",
        lastMessageAt: last.createdAt,
        lastDirection: last.direction as "in" | "out",
        unreadCount,
      };
    });

    result.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    return result;
  })
  .get("/conversations/:lineUserId/messages", async ({ params }) => {
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.lineUserId, params.lineUserId));
    rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return rows.map(parseMessage);
  })
  // พนักงานตอบกลับผู้เช่า — ส่งเป็น push message (ไม่ใช้ reply token เพราะพนักงานอาจตอบช้ากว่า 1 นาทีที่
  // LINE จำกัดไว้กับ reply token) แล้วมาร์คข้อความเข้าที่ยังไม่อ่านของ conversation นี้เป็นอ่านแล้วไปด้วย
  .post("/conversations/:lineUserId/reply", async ({ params, body, set, authUser }) => {
    const text = String((body as any)?.text ?? "").trim();
    if (!text) { set.status = 400; return { error: "กรุณากรอกข้อความ" }; }

    const settings = await getLineSettings();
    if (!settings.enabled || !settings.token) {
      set.status = 400;
      return { error: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
    }

    const actor = await resolveActorName(authUser);
    try {
      await sendTextMessage(settings.token, params.lineUserId, text);
    } catch (e: any) {
      set.status = 502;
      return { error: `ส่งข้อความไม่สำเร็จ: ${e?.message ?? "Unknown error"}` };
    }

    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(chatMessages).values({
      id,
      lineUserId: params.lineUserId,
      tenantId: "",
      direction: "out",
      messageType: "text",
      text,
      senderName: actor,
      createdAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
    });
    await markInboundRead(params.lineUserId);

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return parseMessage(row);
  })
  // พนักงานส่งรูปภาพ/ไฟล์แนบ — รูปภาพส่งเป็น LINE image message จริง, ไฟล์อื่นๆ (LINE ไม่มี message type
  // "file" สำหรับส่งออก) ส่งเป็นข้อความลิงก์ดาวน์โหลดแทน (ดู sendFileLinkMessage ใน services/line.ts)
  .post("/conversations/:lineUserId/send-attachment", async ({ params, body, set, authUser }) => {
    const b = body as any;
    const base64: string = String(b?.base64 ?? "");
    const name: string = String(b?.name ?? "attachment");
    if (!base64) { set.status = 400; return { error: "ไม่พบไฟล์ที่แนบมา" }; }

    const settings = await getLineSettings();
    if (!settings.enabled || !settings.token) {
      set.status = 400;
      return { error: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
    }

    const mimeType = base64.match(/data:([^;]+);/)?.[1] ?? "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const actor = await resolveActorName(authUser);
    const relativeUrl = await uploadChatAttachment(name, base64);
    const publicUrl = toPublicUrl(relativeUrl);

    if (!publicUrl) {
      set.status = 400;
      return { error: "ยังไม่ได้ตั้งค่า PUBLIC_BASE_URL — LINE ต้องการ URL สาธารณะเพื่อดึงไฟล์ไปแสดง" };
    }

    try {
      if (isImage) await sendImageMessage(settings.token, params.lineUserId, publicUrl);
      else await sendFileLinkMessage(settings.token, params.lineUserId, publicUrl, name);
    } catch (e: any) {
      set.status = 502;
      return { error: `ส่งไฟล์ไม่สำเร็จ: ${e?.message ?? "Unknown error"}` };
    }

    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(chatMessages).values({
      id,
      lineUserId: params.lineUserId,
      tenantId: "",
      direction: "out",
      messageType: isImage ? "image" : "file",
      text: isImage ? "[รูปภาพ]" : `[ไฟล์] ${name}`,
      imageUrl: isImage ? relativeUrl : "",
      fileUrl: isImage ? "" : relativeUrl,
      fileName: isImage ? "" : name,
      senderName: actor,
      createdAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
    });
    await markInboundRead(params.lineUserId);

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return parseMessage(row);
  })
  // พนักงานส่งสติกเกอร์ทางการของ LINE — packageId/stickerId ต้องอยู่ใน ALLOWED_STICKERS เท่านั้น
  .post("/conversations/:lineUserId/send-sticker", async ({ params, body, set, authUser }) => {
    const b = body as any;
    const packageId = String(b?.packageId ?? "");
    const stickerId = String(b?.stickerId ?? "");
    if (!ALLOWED_STICKERS.has(`${packageId}:${stickerId}`)) {
      set.status = 400;
      return { error: "สติกเกอร์นี้ไม่อยู่ในรายการที่ส่งได้" };
    }

    const settings = await getLineSettings();
    if (!settings.enabled || !settings.token) {
      set.status = 400;
      return { error: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
    }

    const actor = await resolveActorName(authUser);
    try {
      await sendStickerMessage(settings.token, params.lineUserId, packageId, stickerId);
    } catch (e: any) {
      set.status = 502;
      return { error: `ส่งสติกเกอร์ไม่สำเร็จ: ${e?.message ?? "Unknown error"}` };
    }

    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(chatMessages).values({
      id,
      lineUserId: params.lineUserId,
      tenantId: "",
      direction: "out",
      messageType: "sticker",
      text: "[สติกเกอร์]",
      packageId,
      stickerId,
      senderName: actor,
      createdAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
    });
    await markInboundRead(params.lineUserId);

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return parseMessage(row);
  })
  .patch("/conversations/:lineUserId/read", async ({ params }) => {
    await markInboundRead(params.lineUserId);
    return { ok: true };
  });
