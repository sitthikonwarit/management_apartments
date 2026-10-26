import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { db } from "../db";
import { users, organizations } from "../db/schema";

export interface AuthUser { id: string; username: string; orgId: string; mustChangePassword: boolean }

// อ่าน+ตรวจ Bearer token จาก header แล้วแปะผลเป็น authUser (หรือ null ถ้าไม่มี/ไม่ถูกต้อง/ถูกแทนที่แล้ว)
// ไว้ใน context — เป็น plugin ชื่อ "auth-derive" — .use() ซ้ำได้จากหลายที่โดยไม่ derive ซ้ำ (Elysia dedupe
// ตามชื่อ plugin) นอกจากเช็คลายเซ็น/วันหมดอายุแล้ว ยังเทียบ claim "sid" กับ currentSessionId ที่เก็บไว้ใน
// DB ด้วย — ถ้าไม่ตรงกัน แปลว่ามีการ login ซ้อนจากเครื่องอื่นทีหลัง (ดู auth.ts) ต้องถือว่าโทเค็นนี้ใช้ไม่ได้
// แล้วทันที แม้ลายเซ็น/วันหมดอายุจะยังถูกต้องอยู่ก็ตาม (บังคับ 1 บัญชี ใช้ได้ทีละเครื่องเท่านั้น)
// orgId อ่านจาก DB เสมอ ไม่เชื่อ claim "org" ในโทเค็นตรงๆ (เหมือนที่ไม่เชื่อ username/sid เปล่าๆ) เผื่อกรณี
// ย้ายผู้ใช้ข้ามองค์กรในอนาคต โทเค็นเก่าจะได้ไม่ถืออิงค่าเก่าค้างจนกว่าจะ login ใหม่
export const authDerive = new Elysia({ name: "auth-derive" })
  .derive({ as: "global" }, async ({ headers }): Promise<{ authUser: AuthUser | null }> => {
    const auth = headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (!payload || typeof payload.sub !== "string") return { authUser: null };

    const [row] = await db.select({ currentSessionId: users.currentSessionId, orgId: users.orgId, mustChangePassword: users.mustChangePassword })
      .from(users).where(eq(users.id, payload.sub));
    if (!row || !row.orgId) return { authUser: null };
    // ผู้ใช้เก่าที่ backfill ก่อนมีฟีเจอร์นี้จะมี currentSessionId ว่างเปล่า — ยอมให้ผ่านได้ (เทียบเฉพาะตอน
    // มีค่าตั้งไว้จริงๆ) เพื่อไม่ให้ token เดิมที่ออกไปก่อนหน้านี้ใช้ไม่ได้ทันทีหลัง deploy ฟีเจอร์นี้
    if (row.currentSessionId && payload.sid !== row.currentSessionId) return { authUser: null };

    // องค์กรถูกระงับโดยหน้าควบคุมแพลตฟอร์ม (ดู routes/superadmin.ts) — ปฏิเสธทุก request ทันที แม้ token
    // จะยังไม่หมดอายุ/ลายเซ็นถูกต้องก็ตาม เช็คทุกครั้งไม่ cache เพราะต้องมีผลทันทีตอนถูกระงับ
    const [org] = await db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, row.orgId));
    if (org?.status === "suspended") return { authUser: null };

    return { authUser: { id: payload.sub, username: String(payload.username ?? ""), orgId: row.orgId, mustChangePassword: row.mustChangePassword === "true" } };
  });
