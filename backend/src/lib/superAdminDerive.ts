// ── Auth guard สำหรับหน้าควบคุมแพลตฟอร์ม (routes/superadmin.ts) — คนละชั้นกับ authDerive.ts โดยสิ้นเชิง
// ไม่มีแถวในตาราง users ใดๆ ผูกกับสิทธิ์นี้เลย ตัวตน "superadmin" ยืนยันได้ 2 ทาง (LINE Login เทียบกับ
// SUPERADMIN_LINE_USER_ID หรือรหัสผ่านเทียบกับ SUPERADMIN_PASSWORD — เช็คตอน login ที่ routes/superadmin.ts
// เท่านั้น โทเค็นที่ออกมาแล้วหน้าตาเหมือนกันทั้งสองทาง แยกไม่ออกว่ามาจากทางไหน) เช็คซ้ำอีกทีทุก request ที่นี่
// ว่า "ยังมีอย่างน้อยหนึ่งช่องทางเปิดอยู่" หรือเปล่า (ไม่ใช่เช็คช่องทางใดช่องทางหนึ่งเจาะจง เพราะจะปิดสิทธิ์คนที่
// ล็อกอินผ่านอีกช่องทางหนึ่งไปโดยไม่ตั้งใจ) — ปิดสิทธิ์นี้ทั้งหมดได้ทันทีแค่ลบ/เคลียร์ env var ทั้งสองตัวใน
// .env แล้วรีสตาร์ท โดยไม่ต้องมีรายการ revoke แยกในฐานข้อมูล (โทเค็นเก่าที่ออกไปแล้วจะใช้ไม่ได้ทันทีแม้ยังไม่
// หมดอายุ)
import { Elysia } from "elysia";
import { verifyToken } from "./jwt";

export const superAdminDerive = new Elysia({ name: "super-admin-derive" })
  .derive({ as: "global" }, ({ headers }): { superAdmin: boolean } => {
    const auth = headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    const anyChannelEnabled = !!process.env.SUPERADMIN_LINE_USER_ID || !!process.env.SUPERADMIN_PASSWORD;
    const ok = !!payload && payload.superadmin === true && payload.sub === "superadmin" && anyChannelEnabled;
    return { superAdmin: ok };
  });
