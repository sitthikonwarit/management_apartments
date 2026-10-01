import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { chatMessages, lineProfiles, paymentIntents, rooms, tenants, towers, users } from "../db/schema";
import {
  getLineSettings, sendTextMessage, sendImageMessage, sendStickerMessage, sendFileLinkMessage,
  uploadChatAttachment, toPublicUrl, getLineProfile, cacheLineProfile, findTenantByLineUserId,
  getOutstandingBillsForTenant, pushLineMessage, buildBroadcastImageMessage, buildAnnouncementFlexMessage,
  getMessageQuota,
} from "../services/line";
import { recordConfirmedPayment } from "../services/payments";
import { authDerive } from "../lib/authDerive";
import { signUploadPath } from "../lib/encryption";

// ข้อความตัวอย่างแสดงในรายชื่อสนทนา — "bill"/"receipt" เก็บ JSON ดิบไว้ใน text (ดู services/line.ts:
// logOutboundChatMessage) ต้องแปลงเป็นข้อความสั้นๆ อ่านง่ายแทน ไม่งั้นโชว์ JSON ดิบๆ ในหน้ารายชื่อ
function previewText(m: { messageType: string; text: string }): string {
  if (m.messageType === "text") return m.text;
  if (m.messageType === "bill") return "📄 แจ้งบิลค่าเช่า";
  if (m.messageType === "receipt") return "🧾 ใบเสร็จรับเงิน";
  if (m.messageType === "repair") {
    try {
      const data = JSON.parse(m.text);
      return `🔧 แจ้งซ่อม: ${data?.title ?? ""}`;
    } catch {
      return "🔧 แจ้งซ่อม";
    }
  }
  if (m.messageType === "payment_confirm") {
    try {
      const data = JSON.parse(m.text);
      return `💰 แจ้งชำระเงิน ${Number(data?.amount ?? 0).toLocaleString("th-TH")} บาท`;
    } catch {
      return "💰 แจ้งชำระเงิน";
    }
  }
  if (m.messageType === "booking") {
    try {
      const data = JSON.parse(m.text);
      return `🏠 จองห้อง ${data?.roomNumber ?? ""}`;
    } catch {
      return "🏠 จองห้อง";
    }
  }
  return m.text || "[ไฟล์แนบ]";
}

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

// ข้อความ "repair"/"payment_confirm" ฝัง URL รูปภาพไว้ในตัว text (JSON string) เอง — คนละที่กับคอลัมน์
// imageUrl/fileUrl ด้านล่าง ต้องเซ็นแยกต่างหาก (ดู lib/encryption.ts) ไม่งั้นรูปในการ์ดแจ้งซ่อม/แจ้งชำระเงิน
// จะโหลดไม่ขึ้น (ตัวเก็บใน DB เป็น path ดิบไม่มีลายเซ็นเหมือนทุกที่อื่น เซ็นตอนส่งออกเท่านั้น)
function signMessageText(messageType: string, text: string): string {
  if (messageType !== "repair" && messageType !== "payment_confirm") return text;
  try {
    const snapshot = JSON.parse(text);
    if (messageType === "repair") {
      if (Array.isArray(snapshot.tenantPhotos)) snapshot.tenantPhotos = snapshot.tenantPhotos.map(signUploadPath);
      if (Array.isArray(snapshot.adminPhotos)) snapshot.adminPhotos = snapshot.adminPhotos.map(signUploadPath);
    } else if (snapshot.slipUrl) {
      snapshot.slipUrl = signUploadPath(snapshot.slipUrl);
    }
    return JSON.stringify(snapshot);
  } catch {
    return text;
  }
}

function parseMessage(r: typeof chatMessages.$inferSelect) {
  return {
    id: r.id,
    lineUserId: r.lineUserId,
    tenantId: r.tenantId || null,
    direction: r.direction as "in" | "out",
    messageType: r.messageType,
    text: signMessageText(r.messageType, r.text),
    imageUrl: r.imageUrl ? signUploadPath(r.imageUrl) : null,
    fileUrl: r.fileUrl ? signUploadPath(r.fileUrl) : null,
    fileName: r.fileName || null,
    packageId: r.packageId || null,
    stickerId: r.stickerId || null,
    senderName: r.senderName,
    createdAt: r.createdAt,
    read: !!r.readAt,
  };
}

async function resolveActorName(orgId: string, authUser: { id: string; username: string } | null): Promise<string> {
  if (!authUser?.id) return "พนักงาน";
  const [u] = await db.select().from(users).where(and(eq(users.id, authUser.id), eq(users.orgId, orgId)));
  return u?.displayName || u?.username || authUser.username || "พนักงาน";
}

// มาร์คข้อความเข้าที่ยังไม่อ่านของ conversation นี้เป็นอ่านแล้ว — เรียกทุกครั้งที่พนักงานส่งอะไรกลับไป
// (ถือว่าเปิดอ่านแล้วแน่ๆ ถ้าตอบอยู่)
async function markInboundRead(orgId: string, lineUserId: string) {
  await db.update(chatMessages).set({ readAt: new Date().toISOString() })
    .where(and(eq(chatMessages.lineUserId, lineUserId), eq(chatMessages.direction, "in"), eq(chatMessages.orgId, orgId)));
}

export const chatRoute = new Elysia({ prefix: "/chat" })
  .use(authDerive)
  // โควตาข้อความ push/broadcast คงเหลือของรอบเดือนนี้ (แพลนฟรีของ LINE OA จำกัดจำนวนข้อความ/เดือน) — ให้หน้า
  // แชทโชว์เตือนพนักงานก่อนจะส่งไม่ออกกลางคันเพราะโควตาหมด (ดู getMessageQuota ใน services/line.ts)
  .get("/quota", async ({ authUser }) => {
    const orgId = authUser!.orgId;
    const settings = await getLineSettings(orgId);
    if (!settings.enabled || !settings.token) return null;
    return await getMessageQuota(settings.token);
  })
  // รายชื่อการสนทนาทั้งหมด เรียงตามข้อความล่าสุดก่อน — group ข้อความทั้งตารางด้วย JS (ข้อมูลระดับหอพักเดียว
  // ไม่ใหญ่พอที่จะต้องทำ aggregate query เอง เหมือนที่ tenants.ts/settings.ts ก็โหลดทั้งตารางมาประมวลผลเอง)
  .get("/conversations", async ({ authUser }) => {
    const orgId = authUser!.orgId;
    const [messages, tenantRows, roomRows, profileRows, towerRows] = await Promise.all([
      db.select().from(chatMessages).where(eq(chatMessages.orgId, orgId)),
      db.select().from(tenants).where(eq(tenants.orgId, orgId)),
      db.select().from(rooms).where(eq(rooms.orgId, orgId)),
      db.select().from(lineProfiles).where(eq(lineProfiles.orgId, orgId)),
      db.select().from(towers).where(eq(towers.orgId, orgId)),
    ]);
    const tenantMap = new Map(tenantRows.map((t) => [t.id, t]));
    const roomMap = new Map(roomRows.map((r) => [r.id, r]));
    const profileMap = new Map(profileRows.map((p) => [p.lineUserId, p]));
    // ตึก/อาคารของห้อง — ใช้ให้หน้าเว็บกรองรายชื่อสนทนาตามตึกได้ตอนส่งข้อความหลายห้องพร้อมกัน (ดู POST /broadcast)
    const towerMap = new Map(towerRows.map((t) => [t.id, t]));

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
      // tenantId ที่ผูกกับข้อความ เป็นของ "ผู้ทำสัญญาหลัก" เสมอ แม้บทสนทนานี้จะเป็นของผู้ร่วมพักอาศัยคนหนึ่งก็ตาม
      // (ดู logOutboundChatMessage ใน services/line.ts — ตอนส่งบิลให้ผู้ร่วมพักอาศัย ส่ง tenantId ของผู้ทำสัญญา
      // หลักไปด้วยเสมอ เพื่อให้ยังหาห้อง/ลิงก์ไปโปรไฟล์ผู้เช่าที่ถูกต้องได้) ถ้า lineUserId ของบทสนทนานี้ไม่ตรง
      // กับ tenant.lineUserId แปลว่าเป็นผู้ร่วมพักอาศัย ต้องหาชื่อจริงจาก tenant.coResidents แทน ไม่งั้นจะโชว์
      // ชื่อผู้ทำสัญญาหลักผิดคนในรายชื่อสนทนา
      let displayName: string;
      if (!tenant) {
        displayName = [...msgs].reverse().find((m) => m.senderName)?.senderName || "ไม่ทราบชื่อ";
      } else if ((tenant.lineUserId ?? "").trim() === lineUserId) {
        displayName = `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim();
      } else {
        let coResidents: any[] = [];
        try { coResidents = tenant.coResidents ? JSON.parse(tenant.coResidents) : []; } catch {}
        const co = Array.isArray(coResidents) ? coResidents.find((c: any) => String(c?.lineId ?? "").trim() === lineUserId) : undefined;
        displayName = co?.name
          ? `คุณ ${co.name} (ผู้ร่วมพักห้อง ${room?.number ?? tenant.idRoom ?? ""})`
          : `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim();
      }
      const unreadCount = msgs.filter((m) => m.direction === "in" && !m.readAt).length;
      const tower = room?.towerId ? towerMap.get(room.towerId) : undefined;
      return {
        lineUserId,
        tenantId: tenantId || null,
        displayName,
        roomNumber: room?.number || null,
        towerId: room?.towerId || null,
        towerName: tower?.name || null,
        pictureUrl: profileMap.get(lineUserId)?.pictureUrl || null,
        lastMessage: previewText(last),
        lastMessageAt: last.createdAt,
        lastDirection: last.direction as "in" | "out",
        unreadCount,
      };
    });

    result.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    return result;
  })
  .get("/conversations/:lineUserId/messages", async ({ authUser, params }) => {
    const rows = await db.select().from(chatMessages)
      .where(and(eq(chatMessages.lineUserId, params.lineUserId), eq(chatMessages.orgId, authUser!.orgId)));
    rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return rows.map(parseMessage);
  })
  // พนักงานตอบกลับผู้เช่า — ส่งเป็น push message (ไม่ใช้ reply token เพราะพนักงานอาจตอบช้ากว่า 1 นาทีที่
  // LINE จำกัดไว้กับ reply token) แล้วมาร์คข้อความเข้าที่ยังไม่อ่านของ conversation นี้เป็นอ่านแล้วไปด้วย
  .post("/conversations/:lineUserId/reply", async ({ params, body, set, authUser }) => {
    const orgId = authUser!.orgId;
    const text = String((body as any)?.text ?? "").trim();
    if (!text) { set.status = 400; return { error: "กรุณากรอกข้อความ" }; }

    const settings = await getLineSettings(orgId);
    if (!settings.enabled || !settings.token) {
      set.status = 400;
      return { error: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
    }

    const actor = await resolveActorName(orgId, authUser);
    try {
      await sendTextMessage(settings.token, params.lineUserId, text);
    } catch (e: any) {
      set.status = 502;
      return { error: `ส่งข้อความไม่สำเร็จ: ${e?.message ?? "Unknown error"}` };
    }

    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(chatMessages).values({
      id,
      orgId,
      lineUserId: params.lineUserId,
      tenantId: "",
      direction: "out",
      messageType: "text",
      text,
      senderName: actor,
      createdAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
    });
    await markInboundRead(orgId, params.lineUserId);

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return parseMessage(row);
  })
  // พนักงานส่งข้อความเดียวกันให้หลายห้อง/หลายคนพร้อมกัน (เลือกผู้รับเองจากรายชื่อสนทนาฝั่งหน้าเว็บ) — เลือกรูปแบบ
  // ได้ 3 อย่าง (format): "text" ข้อความธรรมดา, "image" รูปภาพขนาดใหญ่ (แปะลิงก์ให้กดเปิดด้วยก็ได้ ไม่แปะก็ได้),
  // "template" การ์ดประกาศขนาดใหญ่โทนสีเดียวกับการ์ดแจ้งบิล (หัวข้อ + เนื้อหา + ปุ่มลิงก์ถ้ามี) — ยิง push
  // message ทีละคน (กันโดน LINE rate-limit ถ้ายิงพร้อมกันทีเดียวจำนวนมาก) รายที่ส่งไม่สำเร็จ (เช่น บล็อกบอทไปแล้ว)
  // ไม่ทำให้รายอื่นพังตามไปด้วย เก็บผลลัพธ์แยกรายคนคืนกลับไปให้หน้าเว็บสรุปให้พนักงานเห็นว่าใครส่งไม่ผ่านบ้าง
  .post("/broadcast", async ({ body, set, authUser }) => {
    const orgId = authUser!.orgId;
    const b = body as any;
    const format = b?.format === "image" ? "image" : b?.format === "template" ? "template" : "text";
    const text = String(b?.text ?? "").trim();
    const title = String(b?.title ?? "").trim();
    const linkUrl = String(b?.linkUrl ?? "").trim();

    if ((format === "text" || format === "template") && !text) {
      set.status = 400;
      return { error: "กรุณากรอกข้อความ" };
    }

    const requestedIds = Array.isArray(b?.lineUserIds)
      ? Array.from(new Set(b.lineUserIds.map((x: any) => String(x)).filter(Boolean)))
      : [];
    if (requestedIds.length === 0) { set.status = 400; return { error: "กรุณาเลือกผู้รับอย่างน้อย 1 คน" }; }

    const settings = await getLineSettings(orgId);
    if (!settings.enabled || !settings.token) {
      set.status = 400;
      return { error: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
    }

    // จำกัดผู้รับเฉพาะ lineUserId ที่เคยมีบทสนทนากับองค์กรนี้จริงเท่านั้น (กันส่งไปหา LINE user id ขององค์กรอื่น
    // ที่หลุดเข้ามาในคำขอ) — ดูรายชื่อจาก chatMessages ที่มีอยู่แล้ว แทนที่จะเชื่อ lineUserIds จาก client ตรงๆ
    const knownRows = await db.select({ lineUserId: chatMessages.lineUserId }).from(chatMessages).where(eq(chatMessages.orgId, orgId));
    const knownIds = new Set(knownRows.map((r) => r.lineUserId));
    const lineUserIds = requestedIds.filter((id) => knownIds.has(id));
    if (lineUserIds.length === 0) { set.status = 400; return { error: "ไม่พบผู้รับที่เลือกในองค์กรนี้" }; }

    // รูปภาพต้องอัปโหลดครั้งเดียวก่อนวนส่ง (ใช้ URL เดียวกันซ้ำกับทุกคน ไม่อัปโหลดซ้ำทุกรอบ) ต้องมี
    // PUBLIC_BASE_URL ตั้งไว้เหมือนฟีเจอร์แนบรูป/ไฟล์อื่นๆ ในหน้าแชท ไม่งั้น LINE ดึงรูปจากเซิร์ฟเวอร์เราไม่ได้
    let relativeImageUrl = "";
    let publicImageUrl = "";
    if (format === "image") {
      const base64 = String(b?.image?.base64 ?? "");
      if (!base64) { set.status = 400; return { error: "กรุณาแนบรูปภาพ" }; }
      relativeImageUrl = await uploadChatAttachment(b?.image?.name || `broadcast_${Date.now()}.jpg`, base64);
      publicImageUrl = toPublicUrl(relativeImageUrl);
      if (!publicImageUrl) { set.status = 400; return { error: "ยังไม่ได้ตั้งค่า PUBLIC_BASE_URL — LINE ต้องการ URL สาธารณะเพื่อดึงรูปไปแสดง" }; }
    }

    // ข้อความธรรมดาไม่มีฟิลด์ altText ให้กำหนดแจ้งเตือนเอง (ต่างจาก image/template ที่เป็น Flex) — ถ้าตั้งหัวข้อไว้
    // ให้ฝังเป็นบรรทัดแรกของเนื้อความแทน เพราะแจ้งเตือน LINE ของข้อความตัวอักษรจะโชว์ขึ้นต้นของเนื้อความเสมออยู่แล้ว
    const textWithTitle = title ? `${title}\n${text}` : text;

    const actor = await resolveActorName(orgId, authUser);
    const results: { lineUserId: string; ok: boolean; error?: string }[] = [];
    // ยิงทีละคนตามลำดับ (ไม่ใช้ Promise.all) — กันยิง LINE push message ถี่เกินไปพร้อมกันจำนวนมากจนโดน rate-limit
    for (const lineUserId of lineUserIds) {
      try {
        const message = format === "image"
          ? buildBroadcastImageMessage(publicImageUrl, linkUrl, title, Number(b?.image?.width) || undefined, Number(b?.image?.height) || undefined)
          : format === "template"
            ? buildAnnouncementFlexMessage(settings, title, text, linkUrl)
            : { type: "text", text: textWithTitle };
        await pushLineMessage(settings.token, lineUserId, [message]);

        const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await db.insert(chatMessages).values({
          id,
          orgId,
          lineUserId,
          tenantId: "",
          direction: "out",
          messageType: format === "image" ? "image" : "text",
          text: format === "image" ? `[รูปภาพ]${title ? ` ${title}` : ""}${linkUrl ? ` ${linkUrl}` : ""}` : format === "template" ? [title, text, linkUrl].filter(Boolean).join("\n") : textWithTitle,
          imageUrl: format === "image" ? relativeImageUrl : "",
          senderName: actor,
          createdAt: new Date().toISOString(),
          readAt: new Date().toISOString(),
        });
        await markInboundRead(orgId, lineUserId);
        results.push({ lineUserId, ok: true });
      } catch (e: any) {
        results.push({ lineUserId, ok: false, error: e?.message ?? "Unknown error" });
      }
    }

    return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  })
  // พนักงานส่งรูปภาพ/ไฟล์แนบ — รูปภาพส่งเป็น LINE image message จริง, ไฟล์อื่นๆ (LINE ไม่มี message type
  // "file" สำหรับส่งออก) ส่งเป็นข้อความลิงก์ดาวน์โหลดแทน (ดู sendFileLinkMessage ใน services/line.ts)
  .post("/conversations/:lineUserId/send-attachment", async ({ params, body, set, authUser }) => {
    const orgId = authUser!.orgId;
    const b = body as any;
    const base64: string = String(b?.base64 ?? "");
    const name: string = String(b?.name ?? "attachment");
    if (!base64) { set.status = 400; return { error: "ไม่พบไฟล์ที่แนบมา" }; }

    const settings = await getLineSettings(orgId);
    if (!settings.enabled || !settings.token) {
      set.status = 400;
      return { error: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
    }

    const mimeType = base64.match(/data:([^;]+);/)?.[1] ?? "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const actor = await resolveActorName(orgId, authUser);
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
      orgId,
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
    await markInboundRead(orgId, params.lineUserId);

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return parseMessage(row);
  })
  // พนักงานส่งสติกเกอร์ทางการของ LINE — packageId/stickerId ต้องอยู่ใน ALLOWED_STICKERS เท่านั้น
  .post("/conversations/:lineUserId/send-sticker", async ({ params, body, set, authUser }) => {
    const orgId = authUser!.orgId;
    const b = body as any;
    const packageId = String(b?.packageId ?? "");
    const stickerId = String(b?.stickerId ?? "");
    if (!ALLOWED_STICKERS.has(`${packageId}:${stickerId}`)) {
      set.status = 400;
      return { error: "สติกเกอร์นี้ไม่อยู่ในรายการที่ส่งได้" };
    }

    const settings = await getLineSettings(orgId);
    if (!settings.enabled || !settings.token) {
      set.status = 400;
      return { error: "ยังไม่ได้เปิดใช้งาน/ตั้งค่า LINE Channel Access Token ในหน้าตั้งค่าระบบ" };
    }

    const actor = await resolveActorName(orgId, authUser);
    try {
      await sendStickerMessage(settings.token, params.lineUserId, packageId, stickerId);
    } catch (e: any) {
      set.status = 502;
      return { error: `ส่งสติกเกอร์ไม่สำเร็จ: ${e?.message ?? "Unknown error"}` };
    }

    const id = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(chatMessages).values({
      id,
      orgId,
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
    await markInboundRead(orgId, params.lineUserId);

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return parseMessage(row);
  })
  .patch("/conversations/:lineUserId/read", async ({ authUser, params }) => {
    await markInboundRead(authUser!.orgId, params.lineUserId);
    return { ok: true };
  })
  // ดึงรูปโปรไฟล์/ชื่อ LINE สดๆ มาแคชใหม่ — ใช้ตอนเปิดแชทที่ยังไม่เคยแคชรูปไว้ (เช่น สนทนาเก่าก่อนมีฟีเจอร์นี้)
  .post("/conversations/:lineUserId/refresh-profile", async ({ authUser, params, set }) => {
    const orgId = authUser!.orgId;
    const settings = await getLineSettings(orgId);
    if (!settings.token) { set.status = 400; return { error: "ยังไม่ได้ตั้งค่า LINE Channel Access Token" }; }
    const profile = await getLineProfile(settings.token, params.lineUserId);
    await cacheLineProfile(orgId, params.lineUserId, profile);
    return { pictureUrl: profile.pictureUrl || null, displayName: profile.displayName || null };
  })
  // ข้อมูลผู้ติดต่อ/ห้องของ conversation นี้ — LINE UID, รูปโปรไฟล์, ชื่อ-เบอร์ผู้เช่า, ห้อง/ตึกที่พัก
  // ใช้แสดงในแท็บ "ข้อมูล" ของโมดัลรายละเอียดการสนทนา (ดู ChatDetailModal.tsx)
  .get("/conversations/:lineUserId/info", async ({ authUser, params }) => {
    const orgId = authUser!.orgId;
    const lineUserId = params.lineUserId;
    const [profileRow, tenant] = await Promise.all([
      db.select().from(lineProfiles).where(and(eq(lineProfiles.lineUserId, lineUserId), eq(lineProfiles.orgId, orgId))).then((rows) => rows[0]),
      findTenantByLineUserId(orgId, lineUserId),
    ]);

    let room: { number: string; floor: string; towerName: string; price: string; detail: string } | null = null;
    if (tenant?.idRoom) {
      const [roomRow] = await db.select().from(rooms).where(and(eq(rooms.id, tenant.idRoom), eq(rooms.orgId, orgId)));
      if (roomRow) {
        let towerName = "";
        if (roomRow.towerId) {
          const [towerRow] = await db.select().from(towers).where(and(eq(towers.id, roomRow.towerId), eq(towers.orgId, orgId)));
          towerName = towerRow?.name || "";
        }
        room = { number: roomRow.number, floor: roomRow.floor, towerName, price: roomRow.price, detail: roomRow.detail };
      }
    }

    // ผู้ทำสัญญาหลัก (tenant) อาจไม่ใช่เจ้าของ lineUserId นี้โดยตรง — อาจเป็นผู้ร่วมพักอาศัยคนหนึ่งที่แชทเข้ามา
    // (findTenantByLineUserId เช็คทั้งคู่ คืน tenant เดียวกันเสมอเพื่อให้ยังหาห้อง/บิลถูก) ต้องแยก "ชื่อเจ้าของ
    // บทสนทนานี้จริงๆ" (contactName — ใช้โชว์เป็นหัวข้อใหญ่พร้อมรูปโปรไฟล์) ออกจาก "ผู้เช่า" (tenant.fullName —
    // ยังคงเป็นผู้ทำสัญญาหลักเสมอ ไว้อ้างอิงว่าห้องนี้เช่าในนามใคร) ไม่งั้นแชทของผู้ร่วมพักอาศัยจะโชว์ชื่อผู้ทำ
    // สัญญาหลักผิดคนที่หัวข้อใหญ่
    const tenantFullName = tenant ? `${tenant.title ?? ""}${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() : "";
    let contactName = tenantFullName;
    if (tenant && (tenant.lineUserId ?? "").trim() !== lineUserId) {
      let coResidents: any[] = [];
      try { coResidents = tenant.coResidents ? JSON.parse(tenant.coResidents) : []; } catch {}
      const co = Array.isArray(coResidents) ? coResidents.find((c: any) => String(c?.lineId ?? "").trim() === lineUserId) : undefined;
      if (co?.name) contactName = `คุณ ${co.name}`;
    }

    return {
      lineUserId,
      pictureUrl: profileRow?.pictureUrl || null,
      profileDisplayName: profileRow?.displayName || null,
      contactName: contactName || null,
      tenant: tenant ? {
        id: tenant.id,
        fullName: tenantFullName,
        tel: tenant.tel,
        checkInDate: tenant.checkInDate,
        contractStartDate: tenant.contractStartDate,
        contractEndDate: tenant.contractEndDate,
      } : null,
      room,
    };
  })
  // ยอดค้างชำระทั้งหมดของผู้เช่าที่ผูกกับ conversation นี้ (ทุกบิลที่ยังไม่จ่ายครบ ไม่จำกัดแค่เดือนก่อนหน้า)
  .get("/conversations/:lineUserId/outstanding-bills", async ({ authUser, params }) => {
    const orgId = authUser!.orgId;
    const tenant = await findTenantByLineUserId(orgId, params.lineUserId);
    if (!tenant) return { tenantId: null, items: [], total: 0 };
    const { items, total } = await getOutstandingBillsForTenant(orgId, tenant.id);
    return { tenantId: tenant.id, items, total };
  })
  // พนักงานกรอกรายละเอียดการซ่อม (อุปกรณ์/ราคา/จำนวน/รูป/หมายเหตุ) แล้วกดยืนยันปิดงาน — แก้ไข JSON ของ
  // ข้อความ "repair" ที่ผู้เช่าแจ้งเข้ามาโดยตรง (ต่างจาก bill/receipt ที่เป็น snapshot ส่งครั้งเดียวจบ เพราะ
  // repair ต้องแก้ไขได้หลังสร้างแล้ว) แจ้งผู้เช่าทาง LINE ว่าซ่อมเสร็จแล้วไปด้วย (best-effort)
  .patch("/conversations/:lineUserId/messages/:id/repair", async ({ params, body, set, authUser }) => {
    const orgId = authUser!.orgId;
    const b = body as any;
    const items: { name: string; price: number; qty: number }[] = Array.isArray(b?.items)
      ? b.items.map((it: any) => ({ name: String(it?.name ?? ""), price: Number(it?.price) || 0, qty: Number(it?.qty) || 1 }))
      : [];
    const note = String(b?.note ?? "");
    const photosBase64: string[] = Array.isArray(b?.photos) ? b.photos : [];

    const [existing] = await db.select().from(chatMessages).where(and(eq(chatMessages.id, params.id), eq(chatMessages.orgId, orgId)));
    if (!existing || existing.messageType !== "repair" || existing.lineUserId !== params.lineUserId) {
      set.status = 404;
      return { error: "ไม่พบรายการแจ้งซ่อม" };
    }

    let snapshot: any = {};
    try { snapshot = existing.text ? JSON.parse(existing.text) : {}; } catch { snapshot = {}; }
    if (snapshot.status === "completed") { set.status = 400; return { error: "รายการนี้ยืนยันปิดงานไปแล้ว" }; }

    const adminPhotos: string[] = [];
    for (const [i, base64] of photosBase64.slice(0, 6).entries()) {
      const url = await uploadChatAttachment(`repair_admin_${Date.now()}_${i}.jpg`, base64);
      adminPhotos.push(url);
    }

    const actor = await resolveActorName(orgId, authUser);
    const now = new Date().toISOString();
    const total = items.reduce((sum, it) => sum + it.price * it.qty, 0);

    snapshot = { ...snapshot, status: "completed", adminItems: items, adminPhotos, adminNote: note, confirmedBy: actor, confirmedAt: now };
    await db.update(chatMessages).set({ text: JSON.stringify(snapshot) }).where(eq(chatMessages.id, params.id));

    const settings = await getLineSettings(orgId);
    if (settings.enabled && settings.token) {
      try {
        const itemLines = items.map((it) => `- ${it.name} x${it.qty} = ${(it.price * it.qty).toLocaleString("th-TH")} บาท`).join("\n");
        const summary = [
          `✅ งานซ่อม "${snapshot.title}" เสร็จเรียบร้อยแล้ว`,
          itemLines,
          total > 0 ? `รวมค่าใช้จ่าย: ${total.toLocaleString("th-TH")} บาท` : "",
          note ? `หมายเหตุ: ${note}` : "",
        ].filter(Boolean).join("\n");
        await sendTextMessage(settings.token, params.lineUserId, summary);
      } catch (e) {
        console.error("[repair-confirm][notify]", e);
      }
    }

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, params.id));
    return parseMessage(row);
  })
  // พนักงานกดยืนยัน/ปฏิเสธคำขอ "แจ้งชำระเงิน" ที่ผู้เช่าส่งเข้ามาจากป็อปอัพ "จ่ายงวดนี้" ในหน้า LIFF Payment
  // (messageType "payment_confirm") — ทางเลือกสำรองกรณีตรวจสลิปอัตโนมัติด้วย EasySlip ไม่สำเร็จ ยืนยันแล้ว
  // เรียก recordConfirmedPayment ตัวเดียวกับที่ตรวจสลิปอัตโนมัติใช้ (services/payments.ts) เพื่อบันทึกยอด/
  // อัปเดตบิล/ส่งใบเสร็จให้ครบเหมือนกันทุกประการ ไม่ต้องเขียนตรรกะซ้ำ
  .patch("/conversations/:lineUserId/messages/:id/payment-confirm", async ({ params, body, set, authUser }) => {
    const orgId = authUser!.orgId;
    const b = body as any;
    const action = b?.action === "reject" ? "reject" : b?.action === "confirm" ? "confirm" : null;
    if (!action) { set.status = 400; return { error: "ระบุการดำเนินการไม่ถูกต้อง" }; }
    const reason = String(b?.reason ?? "");

    const [existing] = await db.select().from(chatMessages).where(and(eq(chatMessages.id, params.id), eq(chatMessages.orgId, orgId)));
    if (!existing || existing.messageType !== "payment_confirm" || existing.lineUserId !== params.lineUserId) {
      set.status = 404;
      return { error: "ไม่พบคำขอแจ้งชำระเงิน" };
    }

    let snapshot: any = {};
    try { snapshot = existing.text ? JSON.parse(existing.text) : {}; } catch { snapshot = {}; }
    if (snapshot.status !== "pending") { set.status = 400; return { error: "รายการนี้ถูกดำเนินการไปแล้ว" }; }

    const actor = await resolveActorName(orgId, authUser);
    const now = new Date().toISOString();
    const settings = await getLineSettings(orgId);

    if (action === "reject") {
      snapshot = { ...snapshot, status: "rejected", rejectReason: reason, confirmedBy: actor, confirmedAt: now };
      await db.update(chatMessages).set({ text: JSON.stringify(snapshot) }).where(eq(chatMessages.id, params.id));

      if (settings.enabled && settings.token) {
        try {
          const summary = [
            "❌ ตรวจสอบสลิปที่แจ้งไม่สำเร็จ",
            reason ? `เหตุผล: ${reason}` : "",
            "กรุณาส่งรูปสลิปใหม่ หรือติดต่อผู้ดูแลหอพัก",
          ].filter(Boolean).join("\n");
          await sendTextMessage(settings.token, params.lineUserId, summary);
        } catch (e) {
          console.error("[payment-confirm][reject-notify]", e);
        }
      }

      const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, params.id));
      return parseMessage(row);
    }

    const [intent] = await db.select().from(paymentIntents).where(and(eq(paymentIntents.id, snapshot.intentId), eq(paymentIntents.orgId, orgId)));
    if (!intent || intent.status !== "pending") {
      set.status = 400;
      return { error: "ไม่พบรายการรอชำระ หรือรายการนี้ถูกยืนยันไปแล้ว" };
    }

    const result = await recordConfirmedPayment(orgId, intent, {
      slipUrl: snapshot.slipUrl || "",
      actor,
      note: "ยืนยันโดยพนักงานจากหน้าแชท",
    });
    if (!result.ok) { set.status = 400; return { error: result.message ?? "ยืนยันการชำระเงินไม่สำเร็จ" }; }

    snapshot = { ...snapshot, status: "confirmed", confirmedBy: actor, confirmedAt: now };
    await db.update(chatMessages).set({ text: JSON.stringify(snapshot) }).where(eq(chatMessages.id, params.id));

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, params.id));
    return parseMessage(row);
  });
