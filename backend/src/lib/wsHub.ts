// ── ศูนย์กลาง WebSocket สำหรับแจ้งเตือนเรียลไทม์ — พิมพ์เป็น any โดยตั้งใจ เพราะ generic type ของ
// Elysia WS ซับซ้อนเกินจำเป็นสำหรับแค่เก็บ connection ไว้ broadcast ข้อความสั้นๆ ─────────────────
// เก็บคู่ ws -> userId ด้วย (ไม่ใช่แค่ Set ของ ws เฉยๆ) เพื่อให้ยิงข้อความหา "เจ้าของบัญชีคนเดียวกัน"
// ได้ตรงๆ เวลาต้องบังคับออกจากระบบ (เช่น มีคน login ซ้อนจากเครื่องอื่น)
const clients = new Map<any, string>();

export function registerClient(ws: any, userId: string) {
  clients.set(ws, userId);
}

export function unregisterClient(ws: any) {
  clients.delete(ws);
}

// เรียกจาก onAfterHandle ใน index.ts ทุกครั้งที่มี request แก้ไขข้อมูลสำเร็จ — ส่งให้ client ที่ต่อ
// WebSocket อยู่ทุกคน (รวมถึงคนที่เพิ่งแก้ไขเองด้วย ไม่ได้กรองออก เพื่อความง่าย ไม่มีผลเสียอะไรนอกจาก
// refetch ข้อมูลตัวเองซ้ำเฉยๆ) ให้รู้ว่าข้อมูลประเภทไหนเปลี่ยนไป จะได้ไปโหลดใหม่ทันที
// แนบ label/actorUsername มาด้วย (ถ้ามี) เพื่อให้ frontend เอาไปแสดงเป็นการแจ้งเตือน (กระดิ่ง) ได้เลย
// โดยไม่ต้องยิง request แยกไปถาม log อีกรอบ
export function broadcastChange(entityType: string, action: string, label?: string, actorUsername?: string) {
  const payload = JSON.stringify({
    type: "change", entityType, action, label, actorUsername, timestamp: new Date().toISOString(),
  });
  for (const ws of clients.keys()) {
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}

export interface ChatMessageNotification {
  lineUserId: string;
  displayName: string;
  roomNumber: string | null;
  pictureUrl: string | null;
  preview: string;
}

// เรียกจาก lineWebhook.ts ทุกครั้งที่มีข้อความเข้าใหม่จากผู้เช่า (ไม่เรียกตอนพนักงาน/ระบบส่งออกไป กัน
// เด้งแจ้งเตือน "ข้อความใหม่" ทับข้อความที่ตัวเองเพิ่งส่งเอง) — แยกจาก broadcastChange (type "change") เพราะ
// ต้องพ่วงข้อมูลรูป/ชื่อ/ห้อง/ตัวอย่างข้อความไปด้วย ให้หน้าเว็บเด้งเป็นป็อปอัพแจ้งเตือนมุมขวาล่างได้ทันที
// โดยไม่ต้องยิง request แยกไปถามรายละเอียดอีกรอบ
export function broadcastChatMessage(notification: ChatMessageNotification) {
  const payload = JSON.stringify({ type: "chat-message", ...notification, timestamp: new Date().toISOString() });
  for (const ws of clients.keys()) {
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}

// เรียกจาก /auth/login ตอนมีคน login ด้วยบัญชีเดียวกันซ้ำ (จากเครื่อง/แท็บอื่น) — ยิงหาทุก connection ของ
// userId นี้ที่ยังต่ออยู่ (ปกติคือเครื่องเก่าที่เพิ่งถูกแทนที่) ให้ frontend บังคับออกจากระบบทันที ไม่ต้อง
// รอให้ request ถัดไปโดน 401 เฉยๆ (การ์ดฝั่ง backend ก็ปฏิเสธ sid เก่าอยู่แล้วเป็นชั้นป้องกันจริง อันนี้แค่
// ทำให้ UX ไว ไม่ต้องรอ)
export function revokeSessionsForUser(userId: string) {
  const payload = JSON.stringify({ type: "session-revoked" });
  for (const [ws, uid] of clients.entries()) {
    if (uid !== userId) continue;
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}
