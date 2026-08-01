import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { signToken } from "../lib/jwt";
import { authDerive } from "../lib/authDerive";
import { recordLog } from "../lib/activityLog";
import { revokeSessionsForUser } from "../lib/wsHub";

function parseUser(r: typeof users.$inferSelect) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.displayName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastLoginAt: r.lastLoginAt,
  };
}

function normalizeUsername(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

// ── เส้นทางสาธารณะ (ไม่ต้องล็อกอิน): เช็คว่ามีผู้ใช้ในระบบหรือยัง, ตั้งค่าบัญชีแรก, เข้าสู่ระบบ ──
export const authPublicRoute = new Elysia({ prefix: "/auth" })
  .get("/setup-status", async () => {
    const rows = await db.select({ id: users.id }).from(users).limit(1);
    return { hasUsers: rows.length > 0 };
  })
  // สมัครบัญชีแรกได้แบบไม่ต้องล็อกอิน "เฉพาะตอนที่ยังไม่มีผู้ใช้เลยในระบบ" (ตั้งค่าครั้งแรกใช้งาน) —
  // หลังจากนั้นต้องเข้าสู่ระบบก่อนแล้วไปเพิ่มผู้ใช้ที่ /auth/users แทน กันคนแปลกหน้ามาสมัครเองทีหลัง
  .post("/register", async ({ body, set, headers, server, request }) => {
    const b = body as any;
    const username = normalizeUsername(b.username);
    const password = String(b.password ?? "");
    const displayName = String(b.displayName ?? "").trim();
    if (!username || !password) { set.status = 400; return { error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" }; }
    if (password.length < 6) { set.status = 400; return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" }; }

    const existingAny = await db.select({ id: users.id }).from(users).limit(1);
    if (existingAny.length > 0) {
      set.status = 403;
      return { error: "ระบบมีผู้ใช้อยู่แล้ว กรุณาเข้าสู่ระบบแล้วเพิ่มผู้ใช้จากหน้าตั้งค่า" };
    }

    const id = `USR-${Date.now()}`;
    const ts = new Date().toISOString();
    const passwordHash = await Bun.password.hash(password);
    const sessionId = crypto.randomUUID();
    await db.insert(users).values({ id, username, passwordHash, displayName, createdAt: ts, updatedAt: ts, currentSessionId: sessionId });
    const [row] = await db.select().from(users).where(eq(users.id, id));
    const token = signToken({ sub: row.id, username: row.username, sid: sessionId });
    await recordLog({
      userId: row.id, username: row.username, method: "POST", path: "/auth/register",
      action: "login", entityType: "auth", description: "สมัครบัญชีแรกและเข้าสู่ระบบ", status: 200,
      requestBody: body, userAgent: headers["user-agent"] ?? "", ip: server?.requestIP(request)?.address ?? "",
    });
    return { token, user: parseUser(row) };
  })
  .post("/login", async ({ body, set, headers, server, request }) => {
    const b = body as any;
    const username = normalizeUsername(b.username);
    const password = String(b.password ?? "");
    if (!username || !password) { set.status = 400; return { error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" }; }

    const [row] = await db.select().from(users).where(eq(users.username, username));
    if (!row || !(await Bun.password.verify(password, row.passwordHash))) {
      set.status = 401;
      return { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
    }
    const ts = new Date().toISOString();
    // สุ่มรหัสเซสชันใหม่ทุกครั้งที่ login สำเร็จ — ทับของเดิม ทำให้โทเค็นเก่าที่เครื่องอื่นถืออยู่ใช้ไม่ได้
    // ทันที (authDerive จะเทียบ sid แล้วปฏิเสธ) + ดันแจ้งเตือนเครื่องเก่าที่ยังต่อ WebSocket อยู่ให้ออกทันที
    const sessionId = crypto.randomUUID();
    await db.update(users).set({ lastLoginAt: ts, currentSessionId: sessionId }).where(eq(users.id, row.id));
    const token = signToken({ sub: row.id, username: row.username, sid: sessionId });
    await recordLog({
      userId: row.id, username: row.username, method: "POST", path: "/auth/login",
      action: "login", entityType: "auth", description: "เข้าสู่ระบบ", status: 200,
      requestBody: body, userAgent: headers["user-agent"] ?? "", ip: server?.requestIP(request)?.address ?? "",
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
      userId: authUser.id, username: authUser.username, method: "POST", path: "/auth/logout",
      action: "logout", entityType: "auth", description: "ออกจากระบบ", status: 200,
      userAgent: headers["user-agent"] ?? "", ip: server?.requestIP(request)?.address ?? "",
    });
    return { ok: true };
  })
  .get("/me", async ({ authUser, set }) => {
    if (!authUser) { set.status = 401; return { error: "กรุณาเข้าสู่ระบบ" }; }
    const [row] = await db.select().from(users).where(eq(users.id, authUser.id));
    if (!row) { set.status = 404; return { error: "ไม่พบผู้ใช้" }; }
    return parseUser(row);
  })
  .get("/users", async () => {
    const rows = await db.select().from(users);
    return rows.map(parseUser);
  })
  .post("/users", async ({ body, set }) => {
    const b = body as any;
    const username = normalizeUsername(b.username);
    const password = String(b.password ?? "");
    const displayName = String(b.displayName ?? "").trim();
    if (!username || !password) { set.status = 400; return { error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" }; }
    if (password.length < 6) { set.status = 400; return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" }; }
    const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (dup) { set.status = 409; return { error: "มีชื่อผู้ใช้นี้แล้ว" }; }

    const id = `USR-${Date.now()}`;
    const ts = new Date().toISOString();
    const passwordHash = await Bun.password.hash(password);
    await db.insert(users).values({ id, username, passwordHash, displayName, createdAt: ts, updatedAt: ts });
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return parseUser(row);
  })
  // เปลี่ยนรหัสผ่าน และ/หรือชื่อที่แสดง — ส่ง password มาก็ต่อเมื่อจะเปลี่ยนรหัสผ่านเท่านั้น
  .put("/users/:id", async ({ params, body, set }) => {
    const [existing] = await db.select().from(users).where(eq(users.id, params.id));
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
    if (authUser?.id === params.id) { set.status = 400; return { error: "ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้" }; }
    const rows = await db.select({ id: users.id }).from(users);
    if (rows.length <= 1) { set.status = 400; return { error: "ต้องมีผู้ใช้เหลืออย่างน้อย 1 บัญชี" }; }
    await db.delete(users).where(eq(users.id, params.id));
    return { deleted: params.id };
  });
