import { pgTable, text, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const str = (name: string) => text(name).notNull().default("");
const json = (name: string) => text(name).notNull().default("[]");
// ── Multi-tenant scoping column ──────────────────────────────────────────────
// Push #2: backend/src/db/backfill-org.ts ได้ backfill ค่าให้ครบทุกแถวแล้ว (ยืนยัน 0 แถวเหลือ NULL) จึง
// เปลี่ยนเป็น NOT NULL ได้แล้ว — composite PK ของ liveMeterConfigs/lineProfiles ยังเป็น Push #3 แยกต่างหาก
const orgId = () => text("org_id").notNull();

// ── องค์กร/ลูกค้าแต่ละราย (แต่ละหอพัก/อพาร์ตเมนต์ที่ใช้ระบบนี้) ──────────────────
// สร้างอัตโนมัติตอน LINE Login ครั้งแรกของบัญชี LINE ที่ยังไม่เคยมี users แถวใดผูกไว้ (ดู routes/lineLogin.ts)
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: str("name"),
  // ตัวระบุสั้นๆ ไว้ใช้ใน query string ของ LIFF URL ต่อองค์กร — สุ่มตอนสร้างองค์กร (ดู routes/lineLogin.ts)
  // แนบเป็น ?org=<slug> ท้าย Endpoint URL ของ LIFF app แต่ละองค์กรใน LINE Developers Console (ดู
  // routes/liff.ts, resolveOrgIdBySlug ใน lib/orgContext.ts) unique บังคับจริงด้วย slugUnique ด้านล่าง
  slug: str("slug"),
  status: text("status").notNull().default("active"), // active | suspended
  createdAt: str("created_at"),
  updatedAt: str("updated_at"),
}, (table) => ({
  // unique เฉพาะแถวที่มี slug จริง (ไม่กระทบแถวเก่าที่ยังไม่ได้ backfill slug ที่ slug เป็น "" ได้หลายแถว)
  slugUnique: uniqueIndex("organizations_slug_unique").on(table.slug).where(sql`${table.slug} != ''`),
}));

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  code: str("code"),
  number: str("number"),
  detail: str("detail"),
  price: str("price"),
  dailyPrice: str("daily_price"),
  pictures: str("pictures"),
  status: text("status").notNull().default("ว่าง"),
  floor: str("floor"),
  towerId: str("tower_id"),
  tags: json("tags"),
  meterWaterActive: text("meter_water_active").notNull().default("true"),
  meterElectricActive: text("meter_electric_active").notNull().default("true"),
  isActive: text("is_active").notNull().default("true"),
});

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  checkInDate: str("check_in_date"),
  amount: str("amount"),
  idLicense: str("id_license"),
  title: str("title"),
  firstName: str("first_name"),
  lastName: str("last_name"),
  houseNo: str("house_no"),
  soi: str("soi"),
  road: str("road"),
  province: str("province"),
  amphoe: str("amphoe"),
  tambon: str("tambon"),
  zipcode: str("zipcode"),
  address: str("address"),
  tel: str("tel"),
  idLine: str("id_line"),
  pdfLinks: json("pdf_links"),
  driveImageUrl: str("drive_image_url"),
  idRoom: str("id_room"),
  extraRoomIds: json("extra_room_ids"), // ห้องเพิ่มเติมนอกเหนือจากห้องหลัก (idRoom) — รองรับ 1 ผู้เช่า หลายห้อง
  contractStartDate: str("contract_start_date"),
  contractEndDate: str("contract_end_date"),
  tags: json("tags"),
  lineUserId: str("line_user_id"),
  coResidents: json("co_residents"),
  // ── ค่าปรับเกินกำหนดเฉพาะบุคคล (override ค่ากลางใน app_config) ──
  // overdueOverride = "false" (ค่าเริ่มต้น) หมายถึงผู้เช่าคนนี้ยังไม่ได้ตั้งค่าเอง ใช้ค่ากลางจากหน้า Settings
  // เสมอ ถ้าเป็น "true" ฟิลด์ overdueEnabled/Day/FineType/FineAmount ด้านล่างจะถูกใช้แทนค่ากลางสำหรับคนนี้
  overdueOverride: text("overdue_override").notNull().default("false"),
  overdueEnabled: text("overdue_enabled").notNull().default("false"),
  overdueDay: str("overdue_day"),
  overdueFineType: str("overdue_fine_type"),
  overdueFineAmount: str("overdue_fine_amount"),
});

export const bookings = pgTable("bookings", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  timestamp: str("timestamp"),
  source: str("source"),
  // ห้องที่จองจริง (ผูกไว้เพื่อ auto-revert สถานะห้องตอนยกเลิกจอง) — แถวเก่าจากยุค Google Sheets ไม่มีค่านี้
  // (ว่างเปล่า) แต่ไม่กระทบเพราะ flow ใหม่ query เฉพาะ status === "active" เท่านั้น
  roomId: str("room_id"),
  roomNumber: str("room_number"),
  roomCode: str("room_code"),
  roomPrice: str("room_price"),
  roomDetail: str("room_detail"),
  firstName: str("first_name"),
  lastName: str("last_name"),
  tel: str("tel"),
  idLine: str("id_line"),
  // "active" = จองอยู่ ล็อกห้องไว้ให้แล้ว / "cancelled" = ผู้จองยกเลิกเอง (ดู POST /liff/rooms/cancel)
  status: str("status"),
  cancelledAt: str("cancelled_at"),
  customerId: str("customer_id"),
  startDate: str("start_date"),
  endDate: str("end_date"),
});

export const towers = pgTable("towers", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  prefix: str("prefix"),
  name: str("name"),
  color: str("color"),
  floorCount: str("floor_count"),
  roomsPerFloor: json("rooms_per_floor"),
  isActive: text("is_active").notNull().default("true"),
  monthlyPrice: str("monthly_price"),
  dailyPrice: str("daily_price"),
  details: str("details"),
});

export const roomTags = pgTable("room_tags", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  name: str("name"),
  icon: str("icon"),
  color: str("color"),
  price: str("price"),
});

// ── ส่วนลดพิเศษ (เฉพาะห้อง) ────────────────────────────────────────────────────
// ส่วนลดที่พนักงานกำหนดเอง ผูกกับห้องที่เลือกไว้เท่านั้น (roomIds) ถูกคิดซ้ำเข้าไปในบิลทุกเดือนให้อัตโนมัติ
// (ดู applySpecialDiscounts ใน frontend/src/utils/billCalc.ts) จนกว่าจะถึงเดือนหลัง expiryDate ถึงจะหยุดคิดให้
// เอง ไม่ต้องมาปิด/ลบเอง — type เป็น "fixed" (จำนวนเงินตรงๆ) หรือ "percent" (เปอร์เซ็นต์ของยอดก่อนหักส่วนลด)
export const specialDiscounts = pgTable("special_discounts", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  name: str("name"),
  type: str("type"), // "fixed" | "percent"
  value: str("value"), // จำนวนเงิน หรือ เปอร์เซ็นต์ แล้วแต่ type
  roomIds: json("room_ids"),
  expiryDate: str("expiry_date"), // "YYYY-MM-DD" — ว่าง = ไม่มีวันหมดอายุ
  createdAt: str("created_at"),
});

export const meterReadings = pgTable("meter_readings", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  monthYear: str("month_year"),
  data: text("data").notNull().default("{}"),
  recordDate: str("record_date"),
  createdAt: str("created_at"),
  updatedAt: str("updated_at"),
});

export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  customerId: str("customer_id"),
  licensePlate: str("license_plate"),
  vehicleTypeId: str("vehicle_type_id"),
  brand: str("brand"),
  model: str("model"),
  color: str("color"),
  parkingFee: str("parking_fee"),
  images: json("images"),
  createdAt: str("created_at"),
});

export const vehicleTypes = pgTable("vehicle_types", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  name: str("name"),
  icon: str("icon"),
  defaultFee: str("default_fee"),
  isActive: text("is_active").notNull().default("true"),
});

export const bills = pgTable("bills", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  monthYear: str("month_year"),
  data: text("data").notNull().default("{}"),
  createdAt: str("created_at"),
  updatedAt: str("updated_at"),
  scheduledDate: str("scheduled_date"),
  // เวลาที่ระบบส่งบิลอัตโนมัติทาง LINE ให้บิลใบนี้ไปแล้ว (ตาม scheduledDate) — กันส่งซ้ำหลายรอบ
  // ในวันเดียวกัน ว่างไว้ = ยังไม่เคยส่งอัตโนมัติ
  lineAutoSentAt: str("line_auto_sent_at"),
});

export const tenantTags = pgTable("tenant_tags", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  name: str("name"),
  icon: str("icon"),
  color: str("color"),
  price: str("price"),
});

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  name: str("name"),
  type: str("type"),
  formula: str("formula"),
  isDefault: text("is_default").notNull().default("false"),
  updatedAt: str("updated_at"),
});

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  billId: str("bill_id"),
  tenantId: str("tenant_id"),
  paymentDate: str("payment_date"),
  data: text("data").notNull().default("{}"),
  operator: str("operator"),
  action: str("action"),
});

// รายการ "รอชำระ" ที่เกิดตอนผู้เช่ากดสร้าง QR ในหน้า LIFF Payment (เลือกบิล/ห้อง/จำนวนเงินที่จะจ่ายรอบนี้
// เอง เพราะจ่ายเป็นงวดได้ ไม่ใช่ยอดเต็มบิลเสมอไป) ใช้จับคู่กับสลิปที่ผู้เช่าส่งเข้าแชท LINE ภายหลัง เพื่อ
// ตรวจสอบยอด+บันทึกชำระเงินอัตโนมัติผ่าน EasySlip (ดู services/payments.ts, services/easyslip.ts)
export const paymentIntents = pgTable("payment_intents", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  tenantId: str("tenant_id"),
  tenantName: str("tenant_name"),
  billId: str("bill_id"),
  roomId: str("room_id"),
  roomNumber: str("room_number"),
  monthYear: str("month_year"),
  amount: str("amount"),
  status: text("status").notNull().default("pending"), // pending | confirmed
  lineUserId: str("line_user_id"),
  createdAt: str("created_at"),
  confirmedAt: str("confirmed_at"),
  paymentId: str("payment_id"),
});

// PK ปัจจุบันคือ slaveId เดี่ยวๆ (รหัสอุปกรณ์ Modbus จริง) — เฟสถัดไปเมื่อมีมากกว่า 1 องค์กรใช้ฮาร์ดแวร์
// พร้อมกัน ต้องเปลี่ยนเป็น composite key (org_id, slave_id) เพราะรหัส slave ซ้ำกันข้ามองค์กรได้ (ดู plan
// migration Push #3) — ยังไม่มี route ไหนอ่าน/เขียนตารางนี้ในโค้ดปัจจุบัน จึงยังไม่กระทบ endpoint ใดๆ ตอนนี้
export const liveMeterConfigs = pgTable("live_meter_configs", {
  slaveId: text("slave_id").primaryKey(),
  orgId: orgId(),
  roomId: str("room_id"),
  type: str("type"),
  updatedAt: str("updated_at"),
});

export const liveMeterLogs = pgTable("live_meter_logs", {
  id: serial("id").primaryKey(),
  timestamp: str("timestamp"),
  slaveId: str("slave_id"),
  roomId: str("room_id"),
  type: str("type"),
  value: str("value"),
  voltage: str("voltage"),
  current: str("current"),
  power: str("power"),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  // "owner" = ผู้สร้างองค์กร (ล็อกอินผ่าน LINE Login) / "staff" = บัญชีลูกน้องที่ owner สร้างเพิ่มด้วย username/password
  role: text("role").notNull().default("staff"),
  // ทั้ง username และ passwordHash เป็น nullable ตอนนี้ (เดิมบังคับ notNull+unique ทั้งคู่ที่ระดับ schema) เพราะ
  // บัญชีที่สร้างจาก LINE Login ไม่มีรหัสผ่านเลยจนกว่าเจ้าของจะมาตั้งเพิ่มเองทีหลัง — username ต้อง unique
  // "ทั้งระบบ" (ไม่ใช่แค่ต่อองค์กร) แต่บังคับที่ระดับแอปเท่านั้น (เช็คก่อน insert/update ทุกจุดที่ตั้ง username —
  // ดู POST /auth/users ใน routes/auth.ts และ POST /auth/line/first-time/set-credentials ใน routes/lineLogin.ts)
  // ไม่มี unique index ระดับ DB เพราะค่าเป็น null ได้ (บัญชีที่ยังไม่เคยตั้ง username เลย) และมีข้อมูลเก่าก่อน
  // กฎ unique-ทั้งระบบนี้ที่อาจซ้ำข้ามองค์กรตกค้างอยู่ (ดู comment ที่ POST /auth/login ใน routes/auth.ts)
  username: text("username"),
  passwordHash: text("password_hash"),
  // ผูกกับบัญชี LINE ส่วนตัวของเจ้าของ (LINE Login "sub") — คนละอย่างกับ tenants.lineUserId (ผู้เช่า) และ
  // คนละอย่างกับ Messaging API ของแต่ละองค์กร (เก็บใน app_config) เป็น identity ของ "คนที่ล็อกอินเข้าระบบหลังบ้าน"
  lineUserId: text("line_user_id"),
  // เบอร์โทรที่ superadmin กรอกไว้ตอนสร้างองค์กรแทน username/password (ดู routes/superadmin.ts) — ใช้เป็น
  // "รหัสจับคู่" ครั้งเดียวตอนเจ้าของมาล็อกอินด้วย LINE ครั้งแรก (หน้า Login กรอกเบอร์นี้ก่อนกดเชื่อม LINE ดู
  // routes/lineLogin.ts) เพื่อผูก lineUserId เข้ากับบัญชีที่สร้างไว้ล่วงหน้าแทนที่จะสร้างองค์กรใหม่ซ้อน หลังผูก
  // สำเร็จแล้วค่านี้ยังเก็บไว้เฉยๆ ไม่ได้ล้าง (ใช้ lineUserId ไม่ใช่ phone เป็นตัวเช็คว่า "ผูกแล้วหรือยัง")
  phone: text("phone"),
  displayName: str("display_name"),
  createdAt: str("created_at"),
  updatedAt: str("updated_at"),
  lastLoginAt: str("last_login_at"),
  // รหัสเซสชันที่ "ใช้งานอยู่ปัจจุบัน" — สุ่มใหม่ทุกครั้งที่ login/register/unlock สำเร็จ แล้วฝังไปกับ JWT
  // (claim "sid") ด้วย ทุก request ที่ล็อกอินแล้วจะเทียบ sid ในโทเค็นกับค่านี้ในนี้เสมอ (ดู authDerive.ts)
  // ถ้าไม่ตรงกันแปลว่ามีการ login ซ้อนจากที่อื่นทีหลัง โทเค็นเก่าจะถือเป็นใช้ไม่ได้ทันที (บังคับ session เดียว)
  currentSessionId: str("current_session_id"),
}, (table) => ({
  // unique เฉพาะแถวที่มี lineUserId จริง (ไม่กระทบบัญชี username/password ที่ lineUserId เป็น null ได้หลายแถว)
  // ป้องกัน race condition ตอน LINE Login ครั้งแรกพร้อมกัน 2 request ไม่ให้สร้างองค์กรซ้ำ (ดู routes/lineLogin.ts)
  lineUserIdUnique: uniqueIndex("users_line_user_id_unique").on(table.lineUserId).where(sql`${table.lineUserId} IS NOT NULL`),
  // unique เฉพาะแถวที่มี phone จริง — กันสร้างสองบัญชี "รอผูก LINE" ด้วยเบอร์เดียวกันซ้อนกัน (จะทำให้ตอนกรอก
  // เบอร์เชื่อม LINE ไม่รู้ว่าจะผูกกับบัญชีไหน) ดู routes/superadmin.ts, routes/lineLogin.ts
  phoneUnique: uniqueIndex("users_phone_unique").on(table.phone).where(sql`${table.phone} IS NOT NULL`),
}));

// บันทึกกิจกรรม (audit log) — เก็บทุกการกระทำที่เปลี่ยนแปลงข้อมูล (POST/PUT/PATCH/DELETE) ทั้งระบบ
// เขียนโดย middleware กลางใน index.ts (ดักทุก request อัตโนมัติ) + จุดพิเศษ login/logout ใน auth.ts
export const activityLogs = pgTable("activity_logs", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  timestamp: str("timestamp"),
  userId: str("user_id"),
  username: str("username"),
  method: str("method"),
  path: str("path"),
  action: str("action"),        // create/update/delete/login/logout/cancel/sync/...
  entityType: str("entity_type"), // room/tenant/bill/meter/vehicle/user/auth/...
  description: str("description"), // ข้อความสรุปภาษาไทยไว้แสดงผลตรงๆ
  status: str("status"),        // HTTP status code
  // รายละเอียดเต็ม (เก็บเป็น JSON string) — ผ่าน sanitizeForLog() แล้วเสมอ (ปิดบังรหัสผ่าน/โทเค็น
  // และตัดข้อมูล base64 รูปภาพที่ยาวเกินไปทิ้ง) ไว้ให้กดดูตอนคลิกดูรายละเอียดที่หน้า Log
  requestBody: json("request_body"),
  responseBody: json("response_body"),
  userAgent: str("user_agent"),
  ip: str("ip"),
});

// ประวัติแชท LINE 2 ทาง — ข้อความเข้า (จาก webhook) และข้อความออก (พนักงานตอบจากหน้า Inbox)
export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  orgId: orgId(),
  lineUserId: text("line_user_id").notNull(),
  tenantId: str("tenant_id"),
  direction: text("direction").notNull(), // "in" | "out"
  messageType: str("message_type"), // "text" | "image" | "unsupported"
  text: str("text"),
  imageUrl: str("image_url"),
  fileUrl: str("file_url"),     // ไฟล์ที่ไม่ใช่รูปภาพ (ทั้งขาเข้า/ขาออก) — path สัมพัทธ์ /uploads/chat/...
  fileName: str("file_name"),   // ชื่อไฟล์เดิมไว้แสดงผล
  packageId: str("package_id"), // สติกเกอร์ (ทั้งขาเข้า/ขาออก)
  stickerId: str("sticker_id"),
  senderName: str("sender_name"),
  createdAt: str("created_at"),
  readAt: str("read_at"), // ว่าง = ยังไม่อ่าน (เฉพาะข้อความ direction=in)
});

// แคชโปรไฟล์ LINE (ชื่อ+รูปโปรไฟล์) ต่อ lineUserId — ใช้แสดงรูปโปรไฟล์ในหน้าแชท เติมข้อมูลจาก LINE Profile
// API ตอนมีข้อความเข้าใหม่ (ดู lineWebhook.ts) หรือกดรีเฟรชเองจากหน้าแชท (ดู routes/chat.ts)
// PK เดิมเป็น lineUserId เดี่ยวๆ — เฟสถัดไปจะเปลี่ยนเป็น composite (org_id, line_user_id) เพราะบัญชี LINE
// เดียวกันอาจทักแชทเข้ามาหลายองค์กรได้ (ดู plan migration Push #3) ตอนนี้ยังคง PK เดิมไว้ก่อน
export const lineProfiles = pgTable("line_profiles", {
  lineUserId: text("line_user_id").primaryKey(),
  orgId: orgId(),
  displayName: str("display_name"),
  pictureUrl: str("picture_url"),
  updatedAt: str("updated_at"),
});

// ── ค่าคอนฟิกระบบต่อองค์กร ────────────────────────────────────────────────────
// เดิมเป็น singleton แถวเดียวทั้งระบบ (id = "default" เสมอ) — ตอนนี้ id ของแถวนี้ "คือ" org_id ตรงๆ
// (แถวละ 1 องค์กร) แทนที่ sentinel "default" เดิม ดู getOrCreateConfig(orgId) ใน routes/settings.ts
export const appConfig = pgTable("app_config", {
  id: text("id").primaryKey(),
  electricRate: str("electric_rate"),
  waterRate: str("water_rate"),
  // ── ค่าบริการต่อหน่วย (ส่วนเพิ่มจากค่าน้ำ/ค่าไฟฐาน) — เปิด/ปิดได้ที่หน้า Settings เช่น ค่าไฟหน่วยละ 4 บาท
  // + ค่าบริการหน่วยละ 3 บาท เลือกได้ว่าจะรวมยอดเป็นบรรทัดเดียวกับค่าน้ำ/ค่าไฟ หรือแยกบรรทัดต่างหากในรายละเอียดบิล
  // (ดู resolveDefaultFormulas/recalcItem ใน frontend/src/utils/billCalc.ts)
  serviceFeeEnabled: text("service_fee_enabled").notNull().default("false"),
  serviceFeeWaterRate: str("service_fee_water_rate"),
  serviceFeeElectricRate: str("service_fee_electric_rate"),
  serviceFeeDisplayMode: text("service_fee_display_mode").notNull().default("combined"),
  overdueEnabled: text("overdue_enabled").notNull().default("false"),
  overdueDay: str("overdue_day"),
  overdueFineType: str("overdue_fine_type"),
  overdueFineAmount: str("overdue_fine_amount"),
  // ── ปัดเศษยอดบิลลงเป็นหลัก N บาท เฉพาะบิลที่ยังไม่เลยวันครบกำหนดชำระ (ใช้วันครบกำหนดร่วมกับ overdueDay
  // ด้านบนเสมอ ไม่ว่า overdueEnabled จะเปิดอยู่หรือไม่) — ดู applyBillRounding ใน frontend/src/utils/billCalc.ts
  roundingEnabled: text("rounding_enabled").notNull().default("false"),
  roundingUnit: str("rounding_unit"),
  logoUrl: str("logo_url"),
  logoBgEnabled: text("logo_bg_enabled").notNull().default("false"),
  logoBgColor: str("logo_bg_color"),
  appName: str("app_name"),
  appNameColors: json("app_name_colors"),
  liveMeterEnabled: text("live_meter_enabled").notNull().default("true"),
  splitRentByResidents: text("split_rent_by_residents").notNull().default("false"),
  meterDigits: str("meter_digits"),
  yearFormat: text("year_format").notNull().default("BE"),
  // นาทีที่ไม่มีการใช้งานแล้วให้เด้งออกจากระบบอัตโนมัติ — "0" = ปิดใช้งาน (ไม่ auto-logout)
  sessionTimeoutMinutes: str("session_timeout_minutes"),
  // ── ส่งบิลทาง LINE (LINE Messaging API — Push Message ไปยัง lineUserId ของผู้เช่าแต่ละคน) ──
  // token/secret ของแต่ละองค์กรเป็น Messaging API channel ของ "ตัวเอง" (คนละอย่างกับ LINE Login channel
  // ของผู้ให้บริการระบบที่ใช้ตอนเจ้าของหอพักล็อกอินเข้าหลังบ้าน — ดู routes/lineLogin.ts)
  lineMessagingEnabled: text("line_messaging_enabled").notNull().default("false"),
  lineChannelAccessToken: str("line_channel_access_token"),
  lineChannelSecret: str("line_channel_secret"),
  // LINE User ID ของบอทช่องทางนี้เอง (ดึงจาก GET /v2/bot/info ตอนบันทึก lineChannelAccessToken — ดู
  // getBotUserId ใน services/line.ts) ใช้จับคู่ payload.destination ที่ LINE Webhook ส่งมากับองค์กรเจ้าของ
  // ช่องทางจริง (ดู resolveOrgIdByDestination ใน lib/orgContext.ts, routes/lineWebhook.ts) ว่างได้ถ้ายังไม่
  // เคยบันทึก token สำเร็จ หรือดึงจาก LINE ไม่สำเร็จตอนบันทึก (best-effort ไม่บล็อกการบันทึกค่าอื่น)
  lineBotUserId: str("line_bot_user_id"),
  lineAutoSendEnabled: text("line_auto_send_enabled").notNull().default("false"),
  // ส่งบิลใบเดียวกันให้ "ผู้ร่วมพักอาศัย" ที่ผูก LINE User ID ไว้ด้วยพร้อมกับผู้ทำสัญญาหลักไหม (ดู
  // sendBillLineForRoom ใน services/line.ts) เปิดเป็นค่าเริ่มต้น ปิดได้ที่หน้า Settings ถ้าไม่ต้องการ
  lineSendBillToCoResidents: text("line_send_bill_to_co_residents").notNull().default("true"),
  // ── LINE Rich Menu (Guest/Member/Admin) — ตั้งค่า/สร้างได้จากหน้า Settings > LINE Rich Menu
  // (ดู services/richMenu.ts) รูปเก็บเป็น path สัมพัทธ์ใน uploads/richmenu/ เหมือน rooms.pictures ──
  liffLoginUrl: str("liff_login_url"),
  liffPaymentUrl: str("liff_payment_url"),
  // ปุ่ม "ข้อมูลผู้เช่า" / "แจ้งซ่อม" บนเมนู Member ต้องรู้ตัวตนผู้เช่า จึงต้องเป็นหน้า LIFF แยกเหมือน
  // login/payment ด้านบน (คนละ LIFF app กันใน LINE Developers Console) — ว่าง = ปุ่มยังเป็นข้อความส่งเข้า
  // แชทแบบเดิม (ดู services/richMenu.ts)
  liffProfileUrl: str("liff_profile_url"),
  liffRepairUrl: str("liff_repair_url"),
  // ปุ่ม "ดูห้องว่าง" / "จองห้อง" บนเมนู Guest — LIFF สาธารณะ (ไม่ต้องเป็นผู้เช่ามาก่อนก็ใช้ได้) แยกกันคนละ
  // LIFF app: liffRoomsUrl = ดูรายการห้องว่าง+รายละเอียด (LiffRoomsPage.tsx), liffBookingUrl = จัดการห้อง
  // ที่ตัวเองจอง/ยกเลิกเอง (LiffBookingPage.tsx) — ดู services/richMenu.ts
  liffRoomsUrl: str("liff_rooms_url"),
  liffBookingUrl: str("liff_booking_url"),
  // เบอร์ติดต่อที่แสดงในหน้า /contact (ปุ่ม "ติดต่อ" บนเมนู) — ไม่ต้องใช้ LIFF เพราะไม่ต้องรู้ตัวตนผู้เช่า
  contactPhone: str("contact_phone"),
  // ลิงก์ (LIFF หรือ URL ปกติ) ที่ปุ่ม "ติดต่อ" บนเมนูจะเปิดโดยตรง — ถ้าเว้นว่างไว้ ปุ่มจะพาไปหน้า /contact
  // ของระบบเอง (ต้องตั้ง PUBLIC_BASE_URL ใน .env ด้วยไม่งั้นปุ่มจะกลายเป็นข้อความส่งเข้าแชทแทน ดู
  // toPublicUrl ใน services/line.ts) ดู services/richMenu.ts และ POST /richmenu/create ด้านล่าง
  contactUrl: str("contact_url"),
  richMenuGuestImage: str("rich_menu_guest_image"),
  richMenuMemberImage: str("rich_menu_member_image"),
  richMenuAdminImage: str("rich_menu_admin_image"),
  richMenuGuestId: str("rich_menu_guest_id"),
  richMenuMemberId: str("rich_menu_member_id"),
  richMenuAdminId: str("rich_menu_admin_id"),
  // ── ข้อมูลบัญชีรับชำระเงิน — แสดงในหน้า LIFF Payment ให้ผู้เช่าโอนเงินเอง (ดู routes/liff.ts) ──
  paymentBankName: str("payment_bank_name"),
  paymentAccountName: str("payment_account_name"),
  paymentAccountNumber: str("payment_account_number"),
  paymentQrImage: str("payment_qr_image"), // base64 data URI เหมือน logoUrl (ดู comment ที่ logoUrl) — fallback ตอน EasySlip ยังไม่ได้ตั้งค่า
  paymentBankLogoImage: str("payment_bank_logo_image"), // โลโก้ธนาคาร base64 data URI เดียวกัน — โชว์คู่ชื่อธนาคารในหน้า LIFF Payment
  // ── EasySlip (https://easyslip.com) — สร้าง QR PromptPay แบบระบุยอดเอง + ตรวจสลิปที่ผู้เช่าส่งเข้าแชท
  // อัตโนมัติ (ดู services/easyslip.ts, services/payments.ts) ── สวิตช์เปิด/ปิดแยกจากการมี API Key อยู่ในช่อง
  // เพื่อให้ปิดฟีเจอร์ชั่วคราวได้โดยไม่ต้องลบ API Key ทิ้ง (เช่น โควตา EasySlip หมดชั่วคราว)
  easySlipEnabled: text("easyslip_enabled").notNull().default("false"),
  easySlipApiKey: str("easyslip_api_key"),
  paymentPromptPayId: str("payment_promptpay_id"), // เบอร์มือถือ (10 หลัก) หรือเลขบัตร ปชช. (13 หลัก) ที่ผูก PromptPay ไว้ — ฟิลด์เดี่ยวเดิม เก็บไว้เป็นค่า fallback ของ "บัญชีที่ 1" เท่านั้น ตั้งแต่รองรับหลายบัญชีแล้วให้ดูที่ paymentAccounts แทน
  // ── รองรับหลายบัญชีรับชำระเงิน (เพิ่มทีหลัง paymentBankName ฯลฯ ด้านบน) — เก็บเป็น JSON array ของ
  // { id, bankName, accountName, accountNumber, qrImage, bankLogoImage, promptPayId, assign } แต่ละบัญชี
  // เลือกได้ว่าจะโชว์ให้ห้องไหนเห็น (assign.mode: "all" | "rooms" | "tower" | "floor" | "random" | "auto")
  // ดูตรรกะเลือกบัญชีจริงที่ resolvePaymentAccountForRoom ใน routes/liff.ts — ฟิลด์ paymentBankName ฯลฯ ด้านบน
  // ยังเก็บไว้เป็นข้อมูลเก่า/migration source เท่านั้น ไม่ได้ลบทิ้ง เผื่อองค์กรเก่าที่ยังไม่เคยกดบันทึกหน้านี้ใหม่
  paymentAccounts: json("payment_accounts"),
  // ── คลังโลโก้ธนาคารจริงที่เจ้าของหอพักเคยอัปโหลดไว้ — เก็บเป็น JSON { [bankCode]: dataURI } (bankCode ตรง
  // กับ THAI_BANKS ใน frontend/src/utils/thaiBanks.ts เช่น "KBank"/"SCB") พอเลือกธนาคารจากลิสต์แล้วมีโลโก้จริง
  // อัปโหลดไว้แล้วจากบัญชีอื่น/ครั้งก่อน จะดึงมาใช้อัตโนมัติแทนตราวงกลมสีที่ระบบสร้างให้ ไม่ต้องอัปโหลดซ้ำทุกบัญชี
  // ที่ใช้ธนาคารเดียวกัน — ตั้งใจไม่ฝังไฟล์โลโก้จริงของธนาคารมาให้เอง (ปัญหาลิขสิทธิ์ ดู comment ที่
  // generateBankBadge ฝั่ง frontend) ต้องให้ผู้ใช้อัปโหลดเองอย่างน้อยครั้งแรก
  bankLogoLibrary: json("bank_logo_library"),
  // องค์กรนี้ผ่านขั้นตอนตั้งค่าเริ่มต้นแล้วหรือยัง — ค่า default "false" มีผลกับ "องค์กรใหม่" เท่านั้น (แถวนี้
  // ถูกสร้างแบบ lazy ตอนเปิดหน้า Settings ครั้งแรก ดู getOrCreateConfig ใน routes/settings.ts) องค์กรเดิมที่มี
  // อยู่ก่อนฟีเจอร์นี้ถูก backfill เป็น "true" แล้วครั้งเดียว (ดู db/backfill-setup-completed.ts) เป็น false
  // อยู่ = ฝั่ง frontend บังคับพาไปหน้า Settings ค้างไว้จนกว่าจะกดปุ่ม "เสร็จสิ้นการตั้งค่าเริ่มต้น" (ดู
  // POST /settings/config/complete-setup ด้านล่าง, AuthenticatedShell ใน frontend/src/App.tsx)
  setupCompleted: text("setup_completed").notNull().default("false"),
  // ผ่านขั้น "ค่าน้ำไฟ" ในหน้า wizard ตั้งค่าเริ่มต้นแล้วจริงหรือยัง (ดู frontend/src/pages/OnboardingWizard.tsx)
  // แยกจากการเช็ค "electricRate/waterRate > 0" เพราะ getOrCreateConfig ด้านล่างตั้งค่าเริ่มต้นให้เป็น "7"/"18"
  // (ไม่ใช่ 0) อยู่แล้วตั้งแต่สร้างองค์กรใหม่ ถ้าใช้แค่ > 0 เป็นตัวเช็คว่า "ทำขั้นนี้เสร็จหรือยัง" จะเข้าใจผิดว่า
  // เสร็จตั้งแต่ยังไม่เคยกดผ่านขั้นนี้เลย (บั๊กเดิม: wizard ข้ามขั้นค่าน้ำไฟไปเลยตั้งแต่โหลดหน้าแรก) ต้องมีค่า
  // นี้แยกต่างหากเป็นสัญญาณว่า "ผู้ใช้กดยืนยันขั้นนี้เองแล้วจริงๆ" เท่านั้น ไม่เกี่ยวกับตัวเลขค่าอัตราที่ตั้งไว้
  ratesConfirmed: text("rates_confirmed").notNull().default("false"),
  updatedAt: str("updated_at"),
});

// ── ค่าคอนฟิกของเครื่องมือ "สร้าง Rich Menu สำหรับ LINE OA อื่น" ในหน้าควบคุมแพลตฟอร์ม
// (SuperAdminRichMenuPage.tsx, routes/superadmin.ts) — singleton แถวเดียว (id = "default" เสมอ) เก็บค่าที่
// กรอกไว้ล่าสุด (LIFF Login URL/Contact URL/รูป/Guest ID ที่สร้างล่าสุด) กันต้องกรอกใหม่ทุกครั้งที่โหลดหน้า —
// แพทเทิร์นเดียวกับ appConfig ของแต่ละองค์กร แต่ไม่มี orgId เพราะเครื่องมือนี้ไม่ผูกกับองค์กรไหนในระบบเลย (ดู
// คอมเมนต์หัวไฟล์ routes/superadmin.ts) Channel Access Token ยังคงอ่านจาก SUPERADMIN_RICHMENU_LINE_TOKEN ใน
// .env เท่านั้น ไม่เก็บในตารางนี้ — และไม่อยู่ใน ORG_SCOPED_TABLES เพราะไม่ผูกกับองค์กรไหนให้ลบตามเลย
export const superadminRichMenuConfig = pgTable("superadmin_richmenu_config", {
  id: text("id").primaryKey(),
  liffLoginUrl: str("liff_login_url"),
  contactUrl: str("contact_url"),
  image: str("image"), // path สัมพัทธ์ใน uploads/richmenu/_superadmin/ เหมือน richMenuGuestImage ใน appConfig
  richMenuGuestId: str("rich_menu_guest_id"),
  updatedAt: str("updated_at"),
});
