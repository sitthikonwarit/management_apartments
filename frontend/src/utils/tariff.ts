// อัตราค่าน้ำ/ค่าไฟแบบ "ตามจริง" — อัตราก้าวหน้าเป็นขั้น + ค่าบริการคงที่ + ค่า Ft ต่อหน่วย + VAT
// mode "rate" = ใช้อัตราเดียว (หน่วย × อัตรา หรือสูตรกำหนดเอง) เหมือนเดิม, "tiered" = คิดตามขั้นด้านล่าง
// upTo = หน่วยสะสมสูงสุดของขั้นนั้น (null = ขั้นสุดท้าย "เกินจากนั้น")
export interface TariffTier { upTo: number | null; rate: number }
export interface Tariff { mode: "rate" | "tiered"; tiers: TariffTier[]; fixedFee: number; ftRate: number; vatPercent: number }

export const DEFAULT_TARIFF: Tariff = { mode: "rate", tiers: [{ upTo: 30, rate: 0 }, { upTo: null, rate: 0 }], fixedFee: 0, ftRate: 0, vatPercent: 7 };

export function normalizeTariff(raw: any): Tariff {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TARIFF, tiers: DEFAULT_TARIFF.tiers.map((t) => ({ ...t })) };
  const tiers: TariffTier[] = Array.isArray(raw.tiers) && raw.tiers.length >= 1
    ? raw.tiers.map((t: any, i: number, a: any[]) => ({ upTo: i === a.length - 1 ? null : Number(t?.upTo) || 0, rate: Number(t?.rate) || 0 }))
    : DEFAULT_TARIFF.tiers.map((t) => ({ ...t }));
  if (tiers.length === 1) tiers.unshift({ upTo: 0, rate: 0 });
  return {
    mode: raw.mode === "tiered" ? "tiered" : "rate",
    tiers,
    fixedFee: Number(raw.fixedFee) || 0,
    ftRate: Number(raw.ftRate) || 0,
    vatPercent: raw.vatPercent === undefined ? 7 : Number(raw.vatPercent) || 0,
  };
}

export function calcTariff(units: number, t: Tariff): number {
  const u = Math.max(0, Number(units) || 0);
  let base = 0;
  let prev = 0;
  for (const tier of t.tiers) {
    const cap = tier.upTo == null ? Infinity : tier.upTo;
    if (cap <= prev) continue;
    if (u > prev) base += (Math.min(u, cap) - prev) * tier.rate;
    prev = cap;
  }
  const total = (base + t.fixedFee + u * t.ftRate) * (1 + t.vatPercent / 100);
  return Math.round(total * 100) / 100;
}
