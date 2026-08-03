import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { chatMessages, rooms, tenants, users } from "../db/schema";
import { getLineSettings, sendTextMessage } from "../services/line";

function parseMessage(r: typeof chatMessages.$inferSelect) {
  return {
    id: r.id,
    lineUserId: r.lineUserId,
    tenantId: r.tenantId || null,
    direction: r.direction as "in" | "out",
    messageType: r.messageType,
    text: r.text,
    imageUrl: r.imageUrl || null,
    senderName: r.senderName,
    createdAt: r.createdAt,
    read: !!r.readAt,
  };
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

    let actor = "พนักงาน";
    if (authUser?.id) {
      const [u] = await db.select().from(users).where(eq(users.id, authUser.id));
      actor = u?.displayName || u?.username || authUser.username || "พนักงาน";
    }

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
    await db.update(chatMessages).set({ readAt: new Date().toISOString() })
      .where(and(eq(chatMessages.lineUserId, params.lineUserId), eq(chatMessages.direction, "in")));

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
    return parseMessage(row);
  })
  .patch("/conversations/:lineUserId/read", async ({ params }) => {
    await db.update(chatMessages).set({ readAt: new Date().toISOString() })
      .where(and(eq(chatMessages.lineUserId, params.lineUserId), eq(chatMessages.direction, "in")));
    return { ok: true };
  });
