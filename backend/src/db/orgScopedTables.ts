// ── รายชื่อตารางทั้งหมดที่มีคอลัมน์ org_id — ใช้ร่วมกันทั้ง backfill-org.ts (ตอน migrate ข้อมูลเดิม)
// และ routes/superadmin.ts (ตอนลบองค์กรแบบ cascade delete) กันสองที่นี้ไม่ตรงกันถ้ามีตารางใหม่เพิ่มมาทีหลัง
// แล้วแก้ที่เดียวไม่ครบ ต้องตรงกับทุกตารางที่มี orgId ใน db/schema.ts เสมอ
import {
  rooms, tenants, bookings, towers, roomTags, meterReadings, vehicles, vehicleTypes,
  bills, tenantTags, appSettings, payments, paymentIntents, users, activityLogs, chatMessages,
  liveMeterConfigs, lineProfiles,
} from "./schema";

export const ORG_SCOPED_TABLES: { name: string; table: any }[] = [
  { name: "rooms", table: rooms },
  { name: "tenants", table: tenants },
  { name: "bookings", table: bookings },
  { name: "towers", table: towers },
  { name: "roomTags", table: roomTags },
  { name: "meterReadings", table: meterReadings },
  { name: "vehicles", table: vehicles },
  { name: "vehicleTypes", table: vehicleTypes },
  { name: "bills", table: bills },
  { name: "tenantTags", table: tenantTags },
  { name: "appSettings", table: appSettings },
  { name: "payments", table: payments },
  { name: "paymentIntents", table: paymentIntents },
  { name: "users", table: users },
  { name: "activityLogs", table: activityLogs },
  { name: "chatMessages", table: chatMessages },
  { name: "liveMeterConfigs", table: liveMeterConfigs },
  { name: "lineProfiles", table: lineProfiles },
];
