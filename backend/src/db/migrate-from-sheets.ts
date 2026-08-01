import { getRows } from "../services/sheets";
import { db } from "./index";
import {
  rooms, tenants, bookings, towers, roomTags,
  meterReadings, vehicles, vehicleTypes, bills,
  tenantTags, appSettings, payments, liveMeterConfigs,
} from "./schema";
import { COL } from "../config";

function s(val: any): string {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) return val.toISOString();
  return String(val).trim();
}

async function migrateTable<T extends Record<string, any>>(
  name: string,
  table: any,
  sheetName: string,
  mapper: (row: any[]) => T | null
) {
  console.log(`\nMigrating ${name}...`);
  const rows = await getRows(sheetName);
  const valid = rows.map(mapper).filter(Boolean) as T[];
  if (valid.length === 0) { console.log(`  ⚠️  No data found`); return; }
  const batchSize = 100;
  for (let i = 0; i < valid.length; i += batchSize) {
    await db.insert(table).values(valid.slice(i, i + batchSize)).onConflictDoNothing();
  }
  console.log(`  ✅ ${valid.length} rows inserted`);
}

async function main() {
  console.log("=== Migrating Google Sheets → PostgreSQL ===");

  await migrateTable("Rooms", rooms, "ห้องเช่า", (r) => {
    if (!s(r[COL.ROOMS.ID])) return null;
    return {
      id: s(r[COL.ROOMS.ID]),
      code: s(r[COL.ROOMS.CODE]),
      number: s(r[COL.ROOMS.NUMBER]),
      detail: s(r[COL.ROOMS.DETAIL]),
      price: s(r[COL.ROOMS.PRICE]),
      dailyPrice: s(r[COL.ROOMS.DAILY_PRICE]),
      pictures: s(r[COL.ROOMS.PICTURES]),
      status: s(r[COL.ROOMS.STATUS]) || "ว่าง",
      floor: s(r[COL.ROOMS.FLOOR]),
      towerId: s(r[COL.ROOMS.TOWER_ID]),
      tags: s(r[COL.ROOMS.TAGS]) || "[]",
      meterWaterActive: s(r[COL.ROOMS.METER_WATER_ACTIVE]) || "true",
      meterElectricActive: s(r[COL.ROOMS.METER_ELECTRIC_ACTIVE]) || "true",
      isActive: s(r[COL.ROOMS.IS_ACTIVE]) || "true",
    };
  });

  await migrateTable("Tenants", tenants, "ข้อมูลลูกค้า", (r) => {
    if (!s(r[COL.CUSTOMERS.ID])) return null;
    return {
      id: s(r[COL.CUSTOMERS.ID]),
      checkInDate: s(r[COL.CUSTOMERS.CHECK_IN_DATE]),
      amount: s(r[COL.CUSTOMERS.AMOUNT]),
      idLicense: s(r[COL.CUSTOMERS.ID_LICENSE]),
      firstName: s(r[COL.CUSTOMERS.FIRST_NAME]),
      lastName: s(r[COL.CUSTOMERS.LAST_NAME]),
      houseNo: s(r[COL.CUSTOMERS.HOUSE_NO]),
      soi: s(r[COL.CUSTOMERS.SOI]),
      road: s(r[COL.CUSTOMERS.ROAD]),
      province: s(r[COL.CUSTOMERS.PROVINCE]),
      amphoe: s(r[COL.CUSTOMERS.AMPHOE]),
      tambon: s(r[COL.CUSTOMERS.TAMBON]),
      zipcode: s(r[COL.CUSTOMERS.ZIPCODE]),
      address: s(r[COL.CUSTOMERS.ADDRESS]),
      tel: s(r[COL.CUSTOMERS.TEL]),
      idLine: s(r[COL.CUSTOMERS.ID_LINE]),
      pdfLinks: s(r[COL.CUSTOMERS.PDF_LINKS]) || "[]",
      driveImageUrl: s(r[COL.CUSTOMERS.DRIVE_IMAGE_URL]),
      idRoom: s(r[COL.CUSTOMERS.ID_ROOM]),
      contractStartDate: s(r[COL.CUSTOMERS.CONTRACT_START_DATE]),
      contractEndDate: s(r[COL.CUSTOMERS.CONTRACT_END_DATE]),
      tags: s(r[COL.CUSTOMERS.TAGS]) || "[]",
      lineUserId: s(r[COL.CUSTOMERS.LINE_USER_ID]),
      coResidents: s(r[COL.CUSTOMERS.CO_RESIDENTS]) || "[]",
    };
  });

  await migrateTable("Bookings", bookings, "จองห้อง", (r) => {
    if (!s(r[COL.BOOKINGS.ID])) return null;
    return {
      id: s(r[COL.BOOKINGS.ID]),
      timestamp: s(r[COL.BOOKINGS.TIMESTAMP]),
      source: s(r[COL.BOOKINGS.SOURCE]),
      roomNumber: s(r[COL.BOOKINGS.ROOM_NUMBER]),
      roomCode: s(r[COL.BOOKINGS.ROOM_CODE]),
      roomPrice: s(r[COL.BOOKINGS.ROOM_PRICE]),
      roomDetail: s(r[COL.BOOKINGS.ROOM_DETAIL]),
      firstName: s(r[COL.BOOKINGS.FIRST_NAME]),
      lastName: s(r[COL.BOOKINGS.LAST_NAME]),
      tel: s(r[COL.BOOKINGS.TEL]),
      idLine: s(r[COL.BOOKINGS.ID_LINE]),
      status: s(r[COL.BOOKINGS.STATUS]),
      customerId: s(r[COL.BOOKINGS.CUSTOMER_ID]),
      startDate: s(r[COL.BOOKINGS.START_DATE]),
      endDate: s(r[COL.BOOKINGS.END_DATE]),
    };
  });

  await migrateTable("Towers", towers, "ตึก", (r) => {
    if (!s(r[COL.TOWERS.ID])) return null;
    return {
      id: s(r[COL.TOWERS.ID]),
      prefix: s(r[COL.TOWERS.PREFIX]),
      name: s(r[COL.TOWERS.NAME]),
      color: s(r[COL.TOWERS.COLOR]),
      floorCount: s(r[COL.TOWERS.FLOOR_COUNT]),
      roomsPerFloor: s(r[COL.TOWERS.ROOMS_PER_FLOOR]) || "[]",
      isActive: s(r[COL.TOWERS.IS_ACTIVE]) || "true",
      monthlyPrice: s(r[COL.TOWERS.MONTHLY_PRICE]),
      dailyPrice: s(r[COL.TOWERS.DAILY_PRICE]),
      details: s(r[COL.TOWERS.DETAILS]),
    };
  });

  await migrateTable("Room Tags", roomTags, "RoomTags", (r) => {
    if (!s(r[0])) return null;
    return { id: s(r[0]), name: s(r[1]), icon: s(r[2]), color: s(r[3]), price: s(r[4]) };
  });

  await migrateTable("Meter Readings", meterReadings, "MeterReadings", (r) => {
    if (!s(r[COL.METER_READINGS.ID])) return null;
    return {
      id: s(r[COL.METER_READINGS.ID]),
      monthYear: s(r[COL.METER_READINGS.MONTH_YEAR]),
      data: s(r[COL.METER_READINGS.DATA]) || "{}",
      recordDate: s(r[COL.METER_READINGS.RECORD_DATE]),
      createdAt: s(r[COL.METER_READINGS.CREATED_AT]),
      updatedAt: s(r[COL.METER_READINGS.UPDATED_AT]),
    };
  });

  await migrateTable("Vehicles", vehicles, "ยานพาหนะ", (r) => {
    if (!s(r[COL.VEHICLES.ID])) return null;
    return {
      id: s(r[COL.VEHICLES.ID]),
      customerId: s(r[COL.VEHICLES.CUSTOMER_ID]),
      licensePlate: s(r[COL.VEHICLES.LICENSE_PLATE]),
      vehicleTypeId: s(r[COL.VEHICLES.VEHICLE_TYPE_ID]),
      brand: s(r[COL.VEHICLES.BRAND]),
      color: s(r[COL.VEHICLES.COLOR]),
      parkingFee: s(r[COL.VEHICLES.PARKING_FEE]),
      images: s(r[COL.VEHICLES.IMAGES]) || "[]",
      createdAt: s(r[COL.VEHICLES.CREATED_AT]),
    };
  });

  await migrateTable("Vehicle Types", vehicleTypes, "ประเภทยานพาหนะ", (r) => {
    if (!s(r[COL.VEHICLE_TYPES.ID])) return null;
    return {
      id: s(r[COL.VEHICLE_TYPES.ID]),
      name: s(r[COL.VEHICLE_TYPES.NAME]),
      icon: s(r[COL.VEHICLE_TYPES.ICON]),
      defaultFee: s(r[COL.VEHICLE_TYPES.DEFAULT_FEE]),
      isActive: s(r[COL.VEHICLE_TYPES.IS_ACTIVE]) || "true",
    };
  });

  await migrateTable("Bills", bills, "บิล", (r) => {
    if (!s(r[COL.BILLS.ID])) return null;
    return {
      id: s(r[COL.BILLS.ID]),
      monthYear: s(r[COL.BILLS.MONTH_YEAR]),
      data: s(r[COL.BILLS.DATA]) || "{}",
      createdAt: s(r[COL.BILLS.CREATED_AT]),
      updatedAt: s(r[COL.BILLS.UPDATED_AT]),
      scheduledDate: s(r[COL.BILLS.SCHEDULED_DATE]),
    };
  });

  await migrateTable("Tenant Tags", tenantTags, "TenantTags", (r) => {
    if (!s(r[0])) return null;
    return { id: s(r[0]), name: s(r[1]), icon: s(r[2]), color: s(r[3]), price: s(r[4]) };
  });

  await migrateTable("Settings", appSettings, "AllSetting", (r) => {
    if (!s(r[COL.ALL_SETTINGS.ID])) return null;
    return {
      id: s(r[COL.ALL_SETTINGS.ID]),
      name: s(r[COL.ALL_SETTINGS.NAME]),
      type: s(r[COL.ALL_SETTINGS.TYPE]),
      formula: s(r[COL.ALL_SETTINGS.FORMULA]),
      isDefault: s(r[COL.ALL_SETTINGS.IS_DEFAULT]).toLowerCase() === "true" ? "true" : "false",
      updatedAt: s(r[COL.ALL_SETTINGS.UPDATED_AT]),
    };
  });

  await migrateTable("Payments", payments, "PAYMENTS", (r) => {
    if (!s(r[COL.PAYMENTS.ID])) return null;
    return {
      id: s(r[COL.PAYMENTS.ID]),
      billId: s(r[COL.PAYMENTS.BILL_ID]),
      tenantId: s(r[COL.PAYMENTS.TENANT_ID]),
      paymentDate: s(r[COL.PAYMENTS.PAYMENT_DATE]),
      data: s(r[COL.PAYMENTS.DATA]) || "{}",
      operator: s(r[COL.PAYMENTS.OPERATOR]),
      action: s(r[COL.PAYMENTS.ACTION]),
    };
  });

  console.log("\n=== Migration Complete! ===");
  process.exit(0);
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
