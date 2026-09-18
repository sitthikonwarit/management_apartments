// ── ศูนย์กลาง WebSocket สำหรับแจ้งเตือนเรียลไทม์ — พิมพ์เป็น any โดยตั้งใจ เพราะ generic type ของ
// Elysia WS ซับซ้อนเกินจำเป็นสำหรับแค่เก็บ connection ไว้ broadcast ข้อความสั้นๆ ─────────────────
// เก็บคู่ ws -> {userId, orgId} (ไม่ใช่แค่ Set ของ ws เฉยๆ) เพื่อให้ยิงข้อความหา "เจ้าของบัญชีคนเดียวกัน"
// ได้ตรงๆ เวลาต้องบังคับออกจากระบบ (เช่น มีคน login ซ้อนจากเครื่องอื่น) และเพื่อกรอง broadcast ให้อยู่แค่
// ภายในองค์กรเดียวกัน — คนละองค์กรต้องไม่เห็นการแจ้งเตือน/แชทของกันและกัน
interface ClientInfo { userId: string; orgId: string }
const clients = new Map<any, ClientInfo>();

export function registerClient(ws: any, userId: string, orgId: string) {
  clients.set(ws, { userId, orgId });
}

export function unregisterClient(ws: any) {
  clients.delete(ws);
}

// รายชื่อ orgId ที่มี client ต่อ WebSocket ค้างอยู่ตอนนี้อย่างน้อย 1 การเชื่อมต่อ — ใช้บอก "สถานะการใช้งานเว็บสด"
// ในหน้าควบคุมแพลตฟอร์ม (ดู GET /superadmin/organizations) ว่าองค์กรนี้มีพนักงาน/เจ้าของเปิดหน้าเว็บอยู่จริง
// ตอนนี้หรือไม่ (ไม่ใช่แค่ "เคยล็อกอินล่าสุดเมื่อไหร่" ซึ่งเป็นข้อมูลเก่า) — in-memory ล้วนๆ ไม่แตะ DB
export function getOnlineOrgIds(): Set<string> {
  return new Set(Array.from(clients.values(), (c) => c.orgId));
}

// เรียกจาก onAfterHandle ใน index.ts ทุกครั้งที่มี request แก้ไขข้อมูลสำเร็จ — ส่งให้ client ที่ต่อ
// WebSocket อยู่ทุกคน "ในองค์กรเดียวกับ orgId ที่ระบุ" เท่านั้น (รวมถึงคนที่เพิ่งแก้ไขเองด้วย ไม่ได้กรองออก
// เพื่อความง่าย ไม่มีผลเสียอะไรนอกจาก refetch ข้อมูลตัวเองซ้ำเฉยๆ) ให้รู้ว่าข้อมูลประเภทไหนเปลี่ยนไป จะได้ไปโหลดใหม่ทันที
// แนบ label/actorUsername มาด้วย (ถ้ามี) เพื่อให้ frontend เอาไปแสดงเป็นการแจ้งเตือน (กระดิ่ง) ได้เลย
// โดยไม่ต้องยิง request แยกไปถามล็อกอีกรอบ
export function broadcastChange(orgId: string, entityType: string, action: string, label?: string, actorUsername?: string) {
  const payload = JSON.stringify({
    type: "change", entityType, action, label, actorUsername, timestamp: new Date().toISOString(),
  });
  for (const [ws, info] of clients.entries()) {
    if (info.orgId !== orgId) continue;
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
// โดยไม่ต้องยิง request แยกไปถามรายละเอียดอีกรอบ — จำกัดเฉพาะองค์กรเจ้าของแชทเท่านั้นเหมือน broadcastChange
export function broadcastChatMessage(orgId: string, notification: ChatMessageNotification) {
  const payload = JSON.stringify({ type: "chat-message", ...notification, timestamp: new Date().toISOString() });
  for (const [ws, info] of clients.entries()) {
    if (info.orgId !== orgId) continue;
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}

export interface WebPresenceNotification {
  lineUserId: string;
  displayName: string;
  roomNumber: string | null;
  pictureUrl: string | null;
  pageLabel: string;
}

// เรียกจาก POST /liff/presence (routes/liff.ts) ทุกครั้งที่ผู้เช่า/ผู้มาเยือนเปิดหน้า LIFF หน้าใดหน้าหนึ่งผ่าน
// ปุ่ม Rich Menu (type: uri) — ปุ่มพวกนี้แค่เปิดเบราว์เซอร์เฉยๆ ไม่มีข้อความส่งเข้า webhook แบบปุ่ม type:
// message ตามปกติ เลยไม่มีอะไรขึ้นในหน้าแชทของเว็บให้พนักงานรู้ว่ากำลังใช้งานอยู่ ต่างจาก broadcastChatMessage
// ตรงที่เป็นแค่การแจ้งเตือนชั่วคราว "กำลังใช้งาน" เฉยๆ ไม่บันทึกลง chatMessages/DB เลย (ไม่ใช่ข้อความจริง)
export function broadcastWebPresence(orgId: string, notification: WebPresenceNotification) {
  const payload = JSON.stringify({ type: "web-presence", ...notification, timestamp: new Date().toISOString() });
  for (const [ws, info] of clients.entries()) {
    if (info.orgId !== orgId) continue;
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
  for (const [ws, info] of clients.entries()) {
    if (info.userId !== userId) continue;
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}

// เรียกจาก routes/superadmin.ts ตอนระงับ/ลบองค์กร — บังคับออกจากระบบ "ทุกคน" ขององค์กรนั้นทันที (ต่างจาก
// revokeSessionsForUser ที่เจาะจงคนเดียว) ใช้ข้อความ "session-revoked" แบบเดียวกัน (frontend มี handler
// อยู่แล้วใน AuthContext.tsx ไม่ต้องแก้อะไรฝั่ง frontend เพิ่ม) แถมปิด connection ทิ้งเลยด้วย กันแท็บที่เปิด
// ค้างไว้ยังใช้งานต่อได้จาก connection เดิม (ชั้นป้องกันจริงคือ authDerive.ts/WS handshake ที่เช็ค
// organizations.status ทุก request/reconnect อยู่แล้ว อันนี้แค่ทำให้ UX เด้งออกทันทีไม่ต้องรอ request ถัดไป)
export function revokeSessionsForOrg(orgId: string) {
  const payload = JSON.stringify({ type: "session-revoked" });
  for (const [ws, info] of clients.entries()) {
    if (info.orgId !== orgId) continue;
    try {
      ws.send(payload);
    } catch {
      // เพิกเฉย — ปิด connection ด้านล่างอยู่ดี
    }
    try {
      ws.close();
    } catch {
      // เพิกเฉย
    }
    clients.delete(ws);
  }
}
