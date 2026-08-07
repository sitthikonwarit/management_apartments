// ── Org resolution สำหรับ endpoint สาธารณะที่ไม่มี authUser (LIFF/LINE webhook/cron) ─────────────
// จุดเหล่านี้ไม่มี JWT ของพนักงานให้อ่าน authUser.orgId ตรงๆ ได้ ต้องหาว่า request นี้เป็นขององค์กรไหนเอง:
// - LIFF (routes/liff.ts): อ่าน ?org=<slug> จาก query string ที่แนบท้าย Endpoint URL ของ LIFF app แต่ละ
//   องค์กรใน LINE Developers Console (ดู resolveOrgIdBySlug, organizations.slug ใน db/schema.ts)
// - LINE webhook (routes/lineWebhook.ts): จับคู่ payload.destination (LINE User ID ของบอทที่ยิงมา) กับ
//   appConfig.lineBotUserId ที่แคชไว้ตอนบันทึกการตั้งค่า LINE Messaging (ดู resolveOrgIdByDestination)
// - cron (runLineAutoSend ใน services/line.ts): วนทุกองค์กรตรงๆ ด้วย listAllOrgIds() ไม่ต้อง resolve
//
// ทั้ง LIFF และ webhook ตกไปใช้ resolveOrgIdWithFallback() เป็นชั้นสุดท้ายเสมอ — คืนองค์กรเดียวที่มีอยู่ใน
// ระบบ "ก็ต่อเมื่อระบบมีองค์กรเดียวจริงๆ" เท่านั้น (ทำให้ลูกค้ารายเดิมที่ยังไม่ได้ตั้ง ?org=/lineBotUserId ใช้งาน
// ได้เหมือนเดิมทุกประการโดยไม่ต้องทำอะไรเพิ่ม) ถ้ามีตั้งแต่ 2 องค์กรขึ้นไปแล้วและ resolve ไม่ได้ ต้องคืน null
// เด็ดขาด ห้าม fallback ไปองค์กรแรกสุด เพราะจะเป็นช่องให้ข้อมูลรั่วข้ามองค์กรได้ (ดู comment ที่เรียกใช้ทั้งสองไฟล์)
//
// ห้ามใช้ฟังก์ชันในไฟล์นี้ในจุดที่มี authUser อยู่แล้ว (route ที่ผ่านการ์ดล็อกอิน) ให้ใช้ authUser.orgId ตรงๆ เสมอ
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { organizations, appConfig } from "../db/schema";

let cachedDefaultOrgId: string | null = null;

// องค์กร "แรกสุด" ที่สร้างในระบบ — ใช้เป็น fallback สุดท้ายเท่านั้น (ดู resolveOrgIdWithFallback ด้านล่าง)
// ไม่ใช้ตรงๆ ในจุดที่มีทางรู้องค์กรจริงจาก request ได้แล้ว (LIFF ?org=, webhook destination)
export async function getDefaultOrgId(): Promise<string | null> {
  if (cachedDefaultOrgId) return cachedDefaultOrgId;
  const [row] = await db.select({ id: organizations.id }).from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
  cachedDefaultOrgId = row?.id ?? null;
  return cachedDefaultOrgId;
}

export async function listAllOrgIds(): Promise<string[]> {
  const rows = await db.select({ id: organizations.id }).from(organizations);
  return rows.map((r) => r.id);
}

// หา orgId จาก slug ที่แนบมาใน ?org= ของ LIFF request — ไม่เจอ/slug ว่างคืน null เฉยๆ (ให้ผู้เรียกตัดสินใจ
// fallback เอง ผ่าน resolveOrgIdWithFallback)
export async function resolveOrgIdBySlug(slug: string | undefined | null): Promise<string | null> {
  if (!slug) return null;
  const [row] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
  return row?.id ?? null;
}

// หา orgId จาก payload.destination ของ LINE webhook (LINE User ID ของบอทที่ยิงมา) เทียบกับ
// appConfig.lineBotUserId ที่แคชไว้ต่อองค์กร (ดู getBotUserId ใน services/line.ts) — appConfig.id คือ orgId
// ตรงๆ อยู่แล้ว (ดูคอมเมนต์ที่ตาราง appConfig ใน db/schema.ts)
export async function resolveOrgIdByDestination(destination: string | undefined | null): Promise<string | null> {
  if (!destination) return null;
  const [row] = await db.select({ id: appConfig.id }).from(appConfig).where(eq(appConfig.lineBotUserId, destination));
  return row?.id ?? null;
}

// ชั้น fallback สุดท้ายร่วมของทั้ง LIFF และ webhook — ดูคอมเมนต์หัวไฟล์เรื่องกฎ "ห้าม fail open ถ้ามีมากกว่า
// 1 องค์กร" ตรงนี้ที่เดียว ไม่ต้องเขียนซ้ำที่ผู้เรียกแต่ละจุด
export async function resolveOrgIdWithFallback(candidate: string | null): Promise<string | null> {
  if (candidate) return candidate;
  const allOrgIds = await listAllOrgIds();
  return allOrgIds.length === 1 ? allOrgIds[0] : null;
}

// สุ่ม slug สั้นๆ (base36, ตัวเลข+ตัวอักษรพิมพ์เล็ก) ไว้ใช้เป็น ?org= ในหน้า LIFF — สั้นพอให้ก็อปวาง URL ได้
// สะดวก ยาวพอให้เดามั่วๆ ไม่เจอง่ายๆ (36^10 ความเป็นไปได้) — export ไว้ให้ routes/lineLogin.ts ใช้ตอนสร้าง
// องค์กรใหม่ด้วย (สร้าง slug ให้ตั้งแต่แรกในทรานแซกชันเดียวกับตอนสร้างแถว organizations)
export function generateSlug(): string {
  return Math.random().toString(36).slice(2, 12);
}

// สร้าง slug ให้องค์กรที่ยังไม่มี (แถวเก่าก่อนฟีเจอร์นี้ หรือ backfill ไม่ครบ) — เรียกจาก GET /settings/config
// เพื่อ lazy-backfill ให้ทุกองค์กรมี slug แสดงในหน้า Settings ได้จริงเสมอ ใช้ตัวเดียวกับตอนสร้างองค์กรใหม่ใน
// routes/lineLogin.ts กันชนกัน (unique index organizations_slug_unique ใน db/schema.ts) ด้วยการ retry
export async function ensureOrgSlug(orgId: string): Promise<string> {
  const [existing] = await db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
  if (existing?.slug) return existing.slug;

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug();
    try {
      await db.update(organizations).set({ slug }).where(eq(organizations.id, orgId));
      return slug;
    } catch (e: any) {
      if (e?.code !== "23505") throw e; // ชนกับ slug ที่มีอยู่แล้ว (unique) — สุ่มใหม่อีกรอบ
    }
  }
  throw new Error("สร้าง slug องค์กรไม่สำเร็จหลังลองหลายครั้ง");
}
