import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appSettings, appConfig } from "../db/schema";

const CONFIG_ID = "default";

function j<T>(val: string, def: T): T {
  try { return val ? JSON.parse(val) : def; } catch { return def; }
}

function parseFormula(r: typeof appSettings.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    formula: r.formula,
    isDefault: r.isDefault === "true",
    updatedAt: r.updatedAt,
  };
}

function parseConfig(r: typeof appConfig.$inferSelect) {
  return {
    electricRate: Number(r.electricRate) || 0,
    waterRate: Number(r.waterRate) || 0,
    overdue: {
      enabled: r.overdueEnabled === "true",
      day: Number(r.overdueDay) || 0,
      type: r.overdueFineType || "fixed",
      amount: Number(r.overdueFineAmount) || 0,
    },
    appIdentity: {
      logoUrl: r.logoUrl,
      logoBg: { enabled: r.logoBgEnabled === "true", color: r.logoBgColor || "#ffffff" },
      nameText: r.appName,
      nameColors: j(r.appNameColors, [] as string[]),
    },
    features: {
      liveMeterEnabled: r.liveMeterEnabled !== "false",
      splitRentByResidents: r.splitRentByResidents === "true",
    },
    meterDigits: Math.max(3, Math.min(9, Number(r.meterDigits) || 5)),
    yearFormat: r.yearFormat === "CE" ? "CE" : "BE",
    // นาทีไม่มีการใช้งานแล้วเด้งออกจากระบบอัตโนมัติ — 0 = ปิดใช้งาน
    sessionTimeoutMinutes: Math.max(0, Number(r.sessionTimeoutMinutes) || 0),
    lineMessaging: {
      enabled: r.lineMessagingEnabled === "true",
      channelAccessToken: r.lineChannelAccessToken || "",
      channelSecret: r.lineChannelSecret || "",
      autoSendEnabled: r.lineAutoSendEnabled === "true",
    },
    updatedAt: r.updatedAt,
  };
}

async function getOrCreateConfig() {
  const [existing] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
  if (existing) return existing;
  await db.insert(appConfig).values({
    id: CONFIG_ID,
    electricRate: "7",
    waterRate: "18",
    logoUrl: "",
    appName: "",
    appNameColors: "[]",
    updatedAt: new Date().toISOString(),
  });
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
  return row;
}

export const settingsRoute = new Elysia({ prefix: "/settings" })
  // ── สูตรคำนวณค่าน้ำ/ค่าไฟ ──────────────────────────────────────────────────
  .get("/", async () => {
    const rows = await db.select().from(appSettings);
    return rows.map(parseFormula);
  })
  .post("/", async ({ body, set }) => {
    const { name, type, formula, isDefault } = body as any;
    if (!name?.trim() || !formula?.trim()) { set.status = 400; return { error: "กรุณากรอกชื่อสูตรและโค้ดคำนวณ" }; }
    const id = `FML-${Date.now()}`;
    const ts = new Date().toISOString();
    if (isDefault) {
      await db.update(appSettings).set({ isDefault: "false" }).where(eq(appSettings.type, String(type)));
    }
    await db.insert(appSettings).values({
      id, name: name.trim(), type: String(type ?? "electric"),
      formula: formula.trim(), isDefault: isDefault ? "true" : "false", updatedAt: ts,
    });
    const [row] = await db.select().from(appSettings).where(eq(appSettings.id, id));
    return parseFormula(row);
  })
  .put("/:id", async ({ params, body, set }) => {
    const { id } = params;
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.id, id));
    if (!existing) { set.status = 404; return { error: "ไม่พบสูตร" }; }
    const { name, type, formula, isDefault } = body as any;
    const finalType = String(type ?? existing.type);
    if (isDefault) {
      await db.update(appSettings).set({ isDefault: "false" }).where(eq(appSettings.type, finalType));
    }
    await db.update(appSettings).set({
      name: name !== undefined ? String(name).trim() : existing.name,
      type: finalType,
      formula: formula !== undefined ? String(formula).trim() : existing.formula,
      isDefault: isDefault ? "true" : "false",
      updatedAt: new Date().toISOString(),
    }).where(eq(appSettings.id, id));
    const [row] = await db.select().from(appSettings).where(eq(appSettings.id, id));
    return parseFormula(row);
  })
  .delete("/:id", async ({ params }) => {
    await db.delete(appSettings).where(eq(appSettings.id, params.id));
    return { deleted: params.id };
  })
  // ── ค่าคอนฟิกระบบ (อัตราค่าบริการ, ค่าปรับ, รูปลักษณ์, ฟีเจอร์) ──────────────
  .get("/config", async () => {
    const row = await getOrCreateConfig();
    return parseConfig(row);
  })
  .put("/config", async ({ body }) => {
    const b = body as any;
    await getOrCreateConfig();
    await db.update(appConfig).set({
      electricRate: String(Number(b.electricRate) || 0),
      waterRate: String(Number(b.waterRate) || 0),
      overdueEnabled: b.overdue?.enabled ? "true" : "false",
      overdueDay: String(Number(b.overdue?.day) || 0),
      overdueFineType: String(b.overdue?.type ?? "fixed"),
      overdueFineAmount: String(Number(b.overdue?.amount) || 0),
      logoUrl: String(b.appIdentity?.logoUrl ?? ""),
      logoBgEnabled: b.appIdentity?.logoBg?.enabled ? "true" : "false",
      logoBgColor: String(b.appIdentity?.logoBg?.color ?? "#ffffff"),
      appName: String(b.appIdentity?.nameText ?? ""),
      appNameColors: JSON.stringify(Array.isArray(b.appIdentity?.nameColors) ? b.appIdentity.nameColors : []),
      liveMeterEnabled: b.features?.liveMeterEnabled === false ? "false" : "true",
      splitRentByResidents: b.features?.splitRentByResidents ? "true" : "false",
      meterDigits: String(Math.max(3, Math.min(9, Number(b.meterDigits) || 5))),
      yearFormat: b.yearFormat === "CE" ? "CE" : "BE",
      sessionTimeoutMinutes: String(Math.max(0, Number(b.sessionTimeoutMinutes) || 0)),
      lineMessagingEnabled: b.lineMessaging?.enabled ? "true" : "false",
      lineChannelAccessToken: String(b.lineMessaging?.channelAccessToken ?? ""),
      lineChannelSecret: String(b.lineMessaging?.channelSecret ?? ""),
      lineAutoSendEnabled: b.lineMessaging?.autoSendEnabled ? "true" : "false",
      updatedAt: new Date().toISOString(),
    }).where(eq(appConfig.id, CONFIG_ID));
    const [row] = await db.select().from(appConfig).where(eq(appConfig.id, CONFIG_ID));
    return parseConfig(row);
  });
