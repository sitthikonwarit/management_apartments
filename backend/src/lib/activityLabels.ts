// ── ตารางแปล method+path (ของ backend ตรงๆ ไม่มี /api prefix) เป็นคำอธิบายภาษาไทยสำหรับหน้า Log ──
// ลำดับมีผล: กฎที่เจาะจงกว่าต้องมาก่อนกฎทั่วไปที่กว้างกว่า (เช่น /settings/config ต้องมาก่อน /settings/:id)
interface LogRule { method: string; pattern: RegExp; entityType: string; action: string; label: string }

const RULES: LogRule[] = [
  // rooms
  { method: "POST", pattern: /^\/rooms\/bulk-delete$/, entityType: "room", action: "delete", label: "ลบห้องพักหลายรายการ" },
  { method: "POST", pattern: /^\/rooms\/generate$/, entityType: "room", action: "create", label: "สร้างห้องพักอัตโนมัติ" },
  { method: "POST", pattern: /^\/rooms$/, entityType: "room", action: "create", label: "เพิ่มห้องพัก" },
  { method: "PATCH", pattern: /^\/rooms\/[^/]+\/pictures$/, entityType: "room", action: "update", label: "แก้ไขรูปภาพห้องพัก" },
  { method: "PATCH", pattern: /^\/rooms\/[^/]+\/active$/, entityType: "room", action: "update", label: "เปิด/ปิดใช้งานห้องพัก" },
  { method: "PUT", pattern: /^\/rooms\/[^/]+$/, entityType: "room", action: "update", label: "แก้ไขห้องพัก" },
  { method: "DELETE", pattern: /^\/rooms\/[^/]+$/, entityType: "room", action: "delete", label: "ลบห้องพัก" },
  { method: "PATCH", pattern: /^\/rooms\/towers\/[^/]+\/active$/, entityType: "tower", action: "update", label: "เปิด/ปิดใช้งานตึก" },
  { method: "POST", pattern: /^\/rooms\/towers$/, entityType: "tower", action: "create", label: "เพิ่มตึก" },
  { method: "PUT", pattern: /^\/rooms\/towers\/[^/]+$/, entityType: "tower", action: "update", label: "แก้ไขตึก" },
  { method: "DELETE", pattern: /^\/rooms\/towers\/[^/]+$/, entityType: "tower", action: "delete", label: "ลบตึก" },
  { method: "POST", pattern: /^\/rooms\/tags$/, entityType: "room-tag", action: "create", label: "เพิ่มแท็กห้อง" },
  { method: "PUT", pattern: /^\/rooms\/tags\/[^/]+$/, entityType: "room-tag", action: "update", label: "แก้ไขแท็กห้อง" },
  { method: "DELETE", pattern: /^\/rooms\/tags\/[^/]+$/, entityType: "room-tag", action: "delete", label: "ลบแท็กห้อง" },

  // tenants
  { method: "POST", pattern: /^\/tenants\/tags$/, entityType: "tenant-tag", action: "create", label: "เพิ่มแท็กผู้เช่า" },
  { method: "PUT", pattern: /^\/tenants\/tags\/[^/]+$/, entityType: "tenant-tag", action: "update", label: "แก้ไขแท็กผู้เช่า" },
  { method: "DELETE", pattern: /^\/tenants\/tags\/[^/]+$/, entityType: "tenant-tag", action: "delete", label: "ลบแท็กผู้เช่า" },
  { method: "POST", pattern: /^\/tenants$/, entityType: "tenant", action: "create", label: "เพิ่มผู้เช่า" },
  { method: "PATCH", pattern: /^\/tenants\/[^/]+\/tags$/, entityType: "tenant", action: "update", label: "แก้ไขแท็กของผู้เช่า" },
  { method: "PATCH", pattern: /^\/tenants\/[^/]+\/co-residents$/, entityType: "tenant", action: "update", label: "แก้ไขผู้ร่วมพักอาศัย" },
  { method: "PATCH", pattern: /^\/tenants\/[^/]+\/room$/, entityType: "tenant", action: "update", label: "ย้าย/กำหนดห้องผู้เช่า" },
  { method: "PATCH", pattern: /^\/tenants\/[^/]+\/extra-rooms$/, entityType: "tenant", action: "update", label: "แก้ไขห้องเพิ่มเติมของผู้เช่า" },
  { method: "PUT", pattern: /^\/tenants\/[^/]+$/, entityType: "tenant", action: "update", label: "แก้ไขผู้เช่า" },
  { method: "DELETE", pattern: /^\/tenants\/[^/]+$/, entityType: "tenant", action: "delete", label: "ลบผู้เช่า" },

  // meters
  { method: "POST", pattern: /^\/meters\/sync-sheets$/, entityType: "meter", action: "sync", label: "ซิงก์ข้อมูลมิเตอร์จาก Sheets" },
  { method: "POST", pattern: /^\/meters$/, entityType: "meter", action: "create", label: "บันทึกการจดมิเตอร์" },
  { method: "PUT", pattern: /^\/meters\/[^/]+$/, entityType: "meter", action: "update", label: "แก้ไขการจดมิเตอร์" },
  { method: "DELETE", pattern: /^\/meters\/[^/]+$/, entityType: "meter", action: "delete", label: "ลบข้อมูลมิเตอร์" },

  // bills
  { method: "PATCH", pattern: /^\/bills\/payments\/[^/]+\/cancel$/, entityType: "payment", action: "cancel", label: "ยกเลิกรายการชำระเงิน" },
  { method: "POST", pattern: /^\/bills\/payments$/, entityType: "payment", action: "create", label: "บันทึกการชำระเงิน" },
  { method: "POST", pattern: /^\/bills\/[^/]+\/send-line$/, entityType: "bill", action: "send-line", label: "ส่งบิลทาง LINE" },
  { method: "POST", pattern: /^\/bills$/, entityType: "bill", action: "create", label: "สร้างบิล" },
  { method: "PUT", pattern: /^\/bills\/[^/]+$/, entityType: "bill", action: "update", label: "แก้ไขบิล" },
  { method: "DELETE", pattern: /^\/bills\/[^/]+$/, entityType: "bill", action: "delete", label: "ลบบิล" },

  // vehicles
  { method: "POST", pattern: /^\/vehicles\/types$/, entityType: "vehicle-type", action: "create", label: "เพิ่มประเภทยานพาหนะ" },
  { method: "PUT", pattern: /^\/vehicles\/types\/[^/]+$/, entityType: "vehicle-type", action: "update", label: "แก้ไขประเภทยานพาหนะ" },
  { method: "DELETE", pattern: /^\/vehicles\/types\/[^/]+$/, entityType: "vehicle-type", action: "delete", label: "ลบประเภทยานพาหนะ" },
  { method: "PATCH", pattern: /^\/vehicles\/[^/]+\/images$/, entityType: "vehicle", action: "update", label: "แก้ไขรูปภาพยานพาหนะ" },
  { method: "POST", pattern: /^\/vehicles$/, entityType: "vehicle", action: "create", label: "เพิ่มยานพาหนะ" },
  { method: "PUT", pattern: /^\/vehicles\/[^/]+$/, entityType: "vehicle", action: "update", label: "แก้ไขยานพาหนะ" },
  { method: "DELETE", pattern: /^\/vehicles\/[^/]+$/, entityType: "vehicle", action: "delete", label: "ลบยานพาหนะ" },

  // settings
  { method: "PUT", pattern: /^\/settings\/config$/, entityType: "settings", action: "update", label: "แก้ไขการตั้งค่าระบบ" },
  { method: "POST", pattern: /^\/settings$/, entityType: "formula", action: "create", label: "เพิ่มสูตรคำนวณ" },
  { method: "PUT", pattern: /^\/settings\/[^/]+$/, entityType: "formula", action: "update", label: "แก้ไขสูตรคำนวณ" },
  { method: "DELETE", pattern: /^\/settings\/[^/]+$/, entityType: "formula", action: "delete", label: "ลบสูตรคำนวณ" },

  // chat (แชท LINE) — เฉพาะการตอบกลับ, ข้อความเข้าจาก webhook ไม่ผ่านตารางนี้ (ไม่มี authUser ตอนนั้น)
  { method: "POST", pattern: /^\/chat\/conversations\/[^/]+\/reply$/, entityType: "chat", action: "create", label: "ส่งข้อความแชทตอบผู้เช่า" },
  { method: "POST", pattern: /^\/chat\/conversations\/[^/]+\/send-attachment$/, entityType: "chat", action: "create", label: "ส่งไฟล์แนบทางแชท" },
  { method: "POST", pattern: /^\/chat\/conversations\/[^/]+\/send-sticker$/, entityType: "chat", action: "create", label: "ส่งสติกเกอร์ทางแชท" },
  { method: "PATCH", pattern: /^\/chat\/conversations\/[^/]+\/read$/, entityType: "chat", action: "read", label: "อ่านข้อความแชท" },

  // auth — เฉพาะจัดการบัญชี (login/register/logout log แยกต่างหากในจุดที่เกิดเหตุการณ์จริง)
  { method: "POST", pattern: /^\/auth\/users$/, entityType: "user", action: "create", label: "เพิ่มผู้ใช้งาน" },
  { method: "PUT", pattern: /^\/auth\/users\/[^/]+$/, entityType: "user", action: "update", label: "แก้ไขผู้ใช้งาน" },
  { method: "DELETE", pattern: /^\/auth\/users\/[^/]+$/, entityType: "user", action: "delete", label: "ลบผู้ใช้งาน" },
];

export function matchActivityLabel(method: string, path: string): { entityType: string; action: string; label: string } | null {
  for (const rule of RULES) {
    if (rule.method === method && rule.pattern.test(path)) return rule;
  }
  return null;
}
