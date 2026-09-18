import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { users, organizations } from "../db/schema";
import { signToken } from "../lib/jwt";
import { authDerive } from "../lib/authDerive";
import { recordLog } from "../lib/activityLog";
import { revokeSessionsForUser } from "../lib/wsHub";
import { getClientIp } from "../lib/requestIp";

function parseUser(r: typeof users.$inferSelect) {
  return {
    id: r.id,
    orgId: r.orgId,
    username: r.username,
    displayName: r.displayName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastLoginAt: r.lastLoginAt,
  };
}

// ตัด .toLowerCase() ออกโดยตั้งใจ — username ต้องพิมพ์ตัวพิมพ์เล็ก/ใหญ่ตรงเป๊ะทั้งตอนสมัครและตอนล็อกอิน
// ("Admin" กับ "admin" ถือเป็นคนละชื่อผู้ใช้กัน) เหลือแค่ trim ช่องว่างหัวท้ายที่พิมพ์เผลอเท่านั้น
function normalizeUsername(v: unknown): string {
  return String(v ?? "").trim();
}

// ── เส้นทางสาธารณะ (ไม่ต้องล็อกอิน): เข้าสู่ระบบด้วย username/password ──────────────
// การสมัคร/สร้างองค์กรใหม่ทำผ่าน LINE Login เท่านั้นแล้ว (ดู routes/lineLogin.ts) — endpoint นี้เหลือไว้
// สำหรับบัญชีพนักงาน (username/password) ที่เจ้าขององค์กรสร้างเพิ่มจากหน้า Settings หลังมีองค์กรแล้วเท่านั้น
// (เดิมมี /auth/setup-status + /auth/register ไว้ "สมัครบัญชีแรกของทั้งระบบ" แบบไม่ต้องล็อกอิน — เอาออกแล้ว
// เพราะแนวคิด "ยังไม่มีผู้ใช้เลยในระบบ" ใช้ไม่ได้อีกต่อไปเมื่อมีมากกว่า 1 องค์กร)
export const authPublicRoute = new Elysia({ prefix: "/auth" })
  .post("/login", async ({ body, set, headers, server, request }) => {
    const b = body as any;
    const username = normalizeUsername(b.username);
    const password = String(b.password ?? "");
    if (!username || !password) { set.status = 400; return { error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" }; }

    // username ต้อง unique ทั้งระบบตอนสร้างใหม่ (ดู POST /users ด้านล่าง + first-time/set-credentials ใน
    // lineLogin.ts) แต่บัญชีเก่าก่อนกฎนี้อาจยังมีชื่อซ้ำข้ามองค์กรตกค้างอยู่ได้ — วนเช็ครหัสผ่านทีละแถวจนกว่าจะ
    // เจอที่ตรง (แถวที่เหลือ hash ไม่ตรงจะ verify ไม่ผ่านเอง) กันเผื่อไว้ ไม่พังถ้าเจอข้อมูลเก่าที่ซ้ำกัน
    const candidates = await db.select().from(users).where(eq(users.username, username));
    let row: typeof users.$inferSelect | undefined;
    for (const c of candidates) {
      if (c.passwordHash && (await Bun.password.verify(password, c.passwordHash))) { row = c; break; }
    }
    if (!row || !row.orgId) {
      set.status = 401;
      return { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
    }
    // องค์กรถูกระงับโดยหน้าควบคุมแพลตฟอร์ม (ดู routes/superadmin.ts) — ห้ามออก token ใหม่เลย แม้ชื่อ
    // ผู้ใช้/รหัสผ่านจะถูกต้องก็ตาม (เหมือนกับที่ authDerive.ts เช็คซ้ำทุก request สำหรับ token ที่ออกไปแล้ว)
    const [org] = await db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, row.orgId));
    if (org?.status === "suspended") {
      set.status = 403;
      return { error: "องค์กรนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" };
    }
    const ts = new Date().toISOString();
    // สุ่มรหัสเซสชันใหม่ทุกครั้งที่ login สำเร็จ — ทับของเดิม ทำให้โทเค็นเก่าที่เครื่องอื่นถืออยู่ใช้ไม่ได้
    // ทันที (authDerive จะเทียบ sid แล้วปฏิเสธ) + ดันแจ้งเตือนเครื่องเก่าที่ยังต่อ WebSocket อยู่ให้ออกทันที
    const sessionId = crypto.randomUUID();
    await db.update(users).set({ lastLoginAt: ts, currentSessionId: sessionId }).where(eq(users.id, row.id));
    const token = signToken({ sub: row.id, username: row.username, org: row.orgId, sid: sessionId });
    await recordLog({
      orgId: row.orgId, userId: row.id, username: row.username, method: "POST", path: "/auth/login",
      action: "login", entityType: "auth", description: "เข้าสู่ระบบ", status: 200,
      requestBody: body, userAgent: headers["user-agent"] ?? "", ip: getClientIp(headers, server, request),
    });
    revokeSessionsForUser(row.id);
    return { token, user: parseUser({ ...row, lastLoginAt: ts }) };
  });

// ── เส้นทางที่ต้องล็อกอินก่อน: ข้อมูลตัวเอง + จัดการบัญชีผู้ใช้ (เมานต์หลังการ์ด auth ใน index.ts) ──
export const authProtectedRoute = new Elysia({ prefix: "/auth" })
  .use(authDerive)
  // เรียกจาก frontend "ก่อน" ล้างโทเค็นตอนกดออกจากระบบ — แค่บันทึก log เท่านั้น ไม่มีสถานะเซสชันฝั่ง
  // server ให้ล้าง (ใช้ JWT stateless) จึงไม่ต้อง invalidate อะไรเพิ่มเติมนอกจากนี้
  .post("/logout", async ({ authUser, set, headers, server, request }) => {
    if (!authUser) { set.status = 401; return { error: "กรุณาเข้าสู่ระบบ" }; }
    await recordLog({
      orgId: authUser.orgId, userId: authUser.id, username: authUser.username, method: "POST", path: "/auth/logout",
      action: "logout", entityType: "auth", description: "ออกจากระบบ", status: 200,
      userAgent: headers["user-agent"] ?? "", ip: getClientIp(headers, server, request),
    });
    return { ok: true };
  })
  .get("/me", async ({ authUser, set }) => {
    if (!authUser) { set.status = 401; return { error: "กรุณาเข้าสู่ระบบ" }; }
    const [row] = await db.select().from(users).where(eq(users.id, authUser.id));
    if (!row) { set.status = 404; return { error: "ไม่พบผู้ใช้" }; }
    return parseUser(row);
  })
  // ── จัดการบัญชีพนักงาน (username/password) ภายในองค์กรตัวเองเท่านั้น ──────────────
  // แก้บั๊กความปลอดภัยเดิม: ก่อนหน้านี้ทั้ง 4 endpoint นี้ไม่กรององค์กรเลย (list/create/edit/delete ข้ามองค์กร
  // ได้หมดถ้ารู้/เดา user id) ตอนนี้ทุกจุดต้องกรอง org_id ให้ตรงกับ authUser.orgId เสมอ
  .get("/users", async ({ authUser }) => {
    const rows = await db.select().from(users).where(eq(users.orgId, authUser!.orgId));
    return rows.map(parseUser);
  })
  .post("/users", async ({ authUser, body, set }) => {
    const orgId = authUser!.orgId;
    const b = body as any;
    const username = normalizeUsername(b.username);
    const password = String(b.password ?? "");
    const displayName = String(b.displayName ?? "").trim();
    if (!username || !password) { set.status = 400; return { error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" }; }
    if (password.length < 6) { set.status = 400; return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" }; }
    // username ห้ามซ้ำ "ทั้งระบบ" ไม่ใช่แค่ในองค์กรตัวเอง (เช็คทุกองค์กร ไม่กรอง org_id) — กันสับสนเวลา
    // ซุปเปอร์แอดมิน/ผู้ใช้คนเดียวกันดูแลหลายองค์กรพร้อมกัน แล้วเจอชื่อผู้ใช้ซ้ำข้ามองค์กร
    const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (dup) { set.status = 409; return { error: "มีชื่อผู้ใช้นี้แล้ว กรุณาเลือกชื่ออื่น" }; }

    const id = `USR-${Date.now()}`;
    const ts = new Date().toISOString();
    const passwordHash = await Bun.password.hash(password);
    await db.insert(users).values({ id, orgId, role: "staff", username, passwordHash, displayName, createdAt: ts, updatedAt: ts });
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return parseUser(row);
  })
  // เปลี่ยนรหัสผ่าน และ/หรือชื่อที่แสดง — ส่ง password มาก็ต่อเมื่อจะเปลี่ยนรหัสผ่านเท่านั้น
  .put("/users/:id", async ({ authUser, params, body, set }) => {
    const [existing] = await db.select().from(users).where(and(eq(users.id, params.id), eq(users.orgId, authUser!.orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบผู้ใช้" }; }
    const b = body as any;
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (b.displayName !== undefined) patch.displayName = String(b.displayName).trim();
    if (b.password) {
      const password = String(b.password);
      if (password.length < 6) { set.status = 400; return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" }; }
      patch.passwordHash = await Bun.password.hash(password);
    }
    await db.update(users).set(patch).where(eq(users.id, params.id));
    const [row] = await db.select().from(users).where(eq(users.id, params.id));
    return parseUser(row);
  })
  .delete("/users/:id", async ({ params, authUser, set }) => {
    const orgId = authUser!.orgId;
    if (authUser?.id === params.id) { set.status = 400; return { error: "ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้" }; }
    const [existing] = await db.select().from(users).where(and(eq(users.id, params.id), eq(users.orgId, orgId)));
    if (!existing) { set.status = 404; return { error: "ไม่พบผู้ใช้" }; }
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId));
    if (rows.length <= 1) { set.status = 400; return { error: "ต้องมีผู้ใช้เหลืออย่างน้อย 1 บัญชี" }; }
    await db.delete(users).where(eq(users.id, params.id));
    return { deleted: params.id };
  });
