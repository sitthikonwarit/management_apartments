// ── คำนวณพื้นที่ที่แต่ละองค์กรใช้ไป — ไว้โชว์ในหน้าควบคุมแพลตฟอร์ม (routes/superadmin.ts) ─────────────
// แบ่งเป็น 2 ส่วน: (1) ข้อมูลในฐานข้อมูล วัดด้วย pg_column_size รวมทุกแถวของทุกตารางที่มี org_id (ดู
// db/orgScopedTables.ts) (2) ไฟล์อัปโหลด วัดจากขนาดไฟล์จริงในโฟลเดอร์ uploads/{ประเภท}/{orgId}/ ที่แยกตาม
// องค์กรแล้ว (ดู routes/rooms.ts, vehicles.ts, bills.ts, settings.ts)
//
// ขอบเขตที่รู้อยู่แล้ว (เหมือนที่บันทึกไว้ตอนทำ cascade delete): ไฟล์แนบในแชท (uploads/chat/) ยังไม่แยกตาม
// orgId บนดิสก์ จึงนับรวมเข้าพื้นที่ต่อองค์กรไม่ได้แม่นยำ — getUnattributedStorageBytes() ด้านล่างคำนวณ
// ขนาดกองนี้แยกไว้ต่างหาก ให้หน้าควบคุมแสดงเป็น "พื้นที่ที่ยังไม่แยกองค์กร" อย่างโปร่งใส แทนที่จะละเลยไปเฉยๆ
import { eq, sql } from "drizzle-orm";
import { readdir, stat } from "fs/promises";
import { resolve, join } from "path";
import { db } from "../db";
import { ORG_SCOPED_TABLES } from "../db/orgScopedTables";

export const UPLOAD_SUBDIRS = ["rooms", "vehicles", "richmenu", "bills"];

async function dirSizeBytes(dirPath: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0; // โฟลเดอร์ยังไม่เคยถูกสร้าง (องค์กรยังไม่เคยอัปโหลดไฟล์ประเภทนี้เลย) ไม่ใช่ error
  }
  for (const entry of entries) {
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else {
      try {
        const s = await stat(full);
        total += s.size;
      } catch {
        // ไฟล์อาจถูกลบไปพอดีระหว่างที่กำลังนับ — ข้ามไปเฉยๆ ไม่ทำให้ทั้งหมดพัง
      }
    }
  }
  return total;
}

async function orgUploadBytes(orgId: string): Promise<number> {
  let total = 0;
  for (const sub of UPLOAD_SUBDIRS) {
    total += await dirSizeBytes(resolve(process.cwd(), "uploads", sub, orgId));
  }
  return total;
}

async function orgDbBytes(orgId: string): Promise<number> {
  let total = 0;
  for (const { table } of ORG_SCOPED_TABLES) {
    const [row] = await db.select({ bytes: sql<string>`coalesce(sum(pg_column_size(${table})), 0)` })
      .from(table).where(eq(table.orgId, orgId));
    total += Number(row?.bytes ?? 0);
  }
  return total;
}

export interface OrgStorage { dbBytes: number; uploadBytes: number; totalBytes: number }

export async function getOrgStorageBytes(orgId: string): Promise<OrgStorage> {
  const [dbBytes, uploadBytes] = await Promise.all([orgDbBytes(orgId), orgUploadBytes(orgId)]);
  return { dbBytes, uploadBytes, totalBytes: dbBytes + uploadBytes };
}

// ไฟล์แนบแชททั้งหมด (ยังไม่แยกตามองค์กร — ดูคอมเมนต์หัวไฟล์) ทั้งขาเข้า (uploads/chat/) และขาออกที่พนักงาน
// ส่งเอง (uploads/chat/out/) รวมเป็นก้อนเดียว "พื้นที่ที่ยังไม่แยกองค์กร"
export async function getUnattributedStorageBytes(): Promise<number> {
  return dirSizeBytes(resolve(process.cwd(), "uploads", "chat"));
}
