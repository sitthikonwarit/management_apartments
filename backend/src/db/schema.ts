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

// รายการ "รอชำระ" ที่เกิดตอนผู้เช่ากดสร้าง QR ในหน้า LIFF Payment (เลือกบิล/ห้อง/จำนวนเงินที่จะจ่ายรอบนี้
// เอง เพราะจ่ายเป็นงวดได้ ไม่ใช่ยอดเต็มบิลเสมอไป) ใช้จับคู่กับสลิปที่ผู้เช่าส่งเข้าแชท LINE ภายหลัง เพื่อ
// ตรวจสอบยอด+บันทึกชำระเงินอัตโนมัติผ่าน EasySlip (ดู services/payments.ts, services/easyslip.ts)
export const paymentIntents = pgTable("payment_intents", {
  id: text("id").primaryKey(),
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

// ประวัติแชท LINE 2 ทาง — ข้อความเข้า (จาก webhook) และข้อความออก (พนักงานตอบจากหน้า Inbox)
export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
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
export const lineProfiles = pgTable("line_profiles", {
  lineUserId: text("line_user_id").primaryKey(),
  displayName: str("display_name"),
  pictureUrl: str("picture_url"),
  updatedAt: str("updated_at"),
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
  lineChannelSecret: str("line_channel_secret"),
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
  // ── EasySlip (https://easyslip.com) — สร้าง QR PromptPay แบบระบุยอดเอง + ตรวจสลิปที่ผู้เช่าส่งเข้าแชท
  // อัตโนมัติ (ดู services/easyslip.ts, services/payments.ts) ──
  easySlipApiKey: str("easyslip_api_key"),
  paymentPromptPayId: str("payment_promptpay_id"), // เบอร์มือถือ (10 หลัก) หรือเลขบัตร ปชช. (13 หลัก) ที่ผูก PromptPay ไว้
  updatedAt: str("updated_at"),
});
