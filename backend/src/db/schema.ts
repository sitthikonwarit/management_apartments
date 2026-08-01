import { pgTable, text, serial } from "drizzle-orm/pg-core";

const str = (name: string) => text(name).notNull().default("");
const json = (name: string) => text(name).notNull().default("[]");

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
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
});

export const bookings = pgTable("bookings", {
  id: text("id").primaryKey(),
  timestamp: str("timestamp"),
  source: str("source"),
  roomNumber: str("room_number"),
  roomCode: str("room_code"),
  roomPrice: str("room_price"),
  roomDetail: str("room_detail"),
  firstName: str("first_name"),
  lastName: str("last_name"),
  tel: str("tel"),
  idLine: str("id_line"),
  status: str("status"),
  customerId: str("customer_id"),
  startDate: str("start_date"),
  endDate: str("end_date"),
});

export const towers = pgTable("towers", {
  id: text("id").primaryKey(),
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
  name: str("name"),
  icon: str("icon"),
  color: str("color"),
  price: str("price"),
});

export const meterReadings = pgTable("meter_readings", {
  id: text("id").primaryKey(),
  monthYear: str("month_year"),
  data: text("data").notNull().default("{}"),
  recordDate: str("record_date"),
  createdAt: str("created_at"),
  updatedAt: str("updated_at"),
});

export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey(),
  customerId: str("customer_id"),
  licensePlate: str("license_plate"),
  vehicleTypeId: str("vehicle_type_id"),
  brand: str("brand"),
  color: str("color"),
  parkingFee: str("parking_fee"),
  images: json("images"),
  createdAt: str("created_at"),
});

export const vehicleTypes = pgTable("vehicle_types", {
  id: text("id").primaryKey(),
  name: str("name"),
  icon: str("icon"),
  defaultFee: str("default_fee"),
  isActive: text("is_active").notNull().default("true"),
});

export const bills = pgTable("bills", {
  id: text("id").primaryKey(),
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
  name: str("name"),
  icon: str("icon"),
  color: str("color"),
  price: str("price"),
});

export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  name: str("name"),
  type: str("type"),
  formula: str("formula"),
  isDefault: text("is_default").notNull().default("false"),
  updatedAt: str("updated_at"),
});

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  billId: str("bill_id"),
  tenantId: str("tenant_id"),
  paymentDate: str("payment_date"),
  data: text("data").notNull().default("{}"),
  operator: str("operator"),
  action: str("action"),
});

export const liveMeterConfigs = pgTable("live_meter_configs", {
  slaveId: text("slave_id").primaryKey(),
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
  username: text("username").notNull().unique(),
  passwordHash: str("password_hash"),
  displayName: str("display_name"),
  createdAt: str("created_at"),
  updatedAt: str("updated_at"),
  lastLoginAt: str("last_login_at"),
  // รหัสเซสชันที่ "ใช้งานอยู่ปัจจุบัน" — สุ่มใหม่ทุกครั้งที่ login/register/unlock สำเร็จ แล้วฝังไปกับ JWT
  // (claim "sid") ด้วย ทุก request ที่ล็อกอินแล้วจะเทียบ sid ในโทเค็นกับค่านี้ในนี้เสมอ (ดู authDerive.ts)
  // ถ้าไม่ตรงกันแปลว่ามีการ login ซ้อนจากที่อื่นทีหลัง โทเค็นเก่าจะถือเป็นใช้ไม่ได้ทันที (บังคับ session เดียว)
  currentSessionId: str("current_session_id"),
});

// บันทึกกิจกรรม (audit log) — เก็บทุกการกระทำที่เปลี่ยนแปลงข้อมูล (POST/PUT/PATCH/DELETE) ทั้งระบบ
// เขียนโดย middleware กลางใน index.ts (ดักทุก request อัตโนมัติ) + จุดพิเศษ login/logout ใน auth.ts
export const activityLogs = pgTable("activity_logs", {
  id: text("id").primaryKey(),
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

export const appConfig = pgTable("app_config", {
  id: text("id").primaryKey(),
  electricRate: str("electric_rate"),
  waterRate: str("water_rate"),
  overdueEnabled: text("overdue_enabled").notNull().default("false"),
  overdueDay: str("overdue_day"),
  overdueFineType: str("overdue_fine_type"),
  overdueFineAmount: str("overdue_fine_amount"),
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
  lineMessagingEnabled: text("line_messaging_enabled").notNull().default("false"),
  lineChannelAccessToken: str("line_channel_access_token"),
  lineAutoSendEnabled: text("line_auto_send_enabled").notNull().default("false"),
  updatedAt: str("updated_at"),
});
