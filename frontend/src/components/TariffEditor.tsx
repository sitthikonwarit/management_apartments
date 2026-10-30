import { calcTariff, type Tariff } from "../utils/tariff";

// ตัวแก้ไขอัตราค่าน้ำ/ค่าไฟแบบ "ตามจริง": อัตราก้าวหน้าเป็นขั้น + ค่าบริการคงที่ + ค่า Ft ต่อหน่วย + VAT
// ใช้ทั้งในหน้า Settings (ค่าเริ่มต้นของบิลใหม่) และหน้าแก้ไขบิล (เฉพาะบิลนั้น)
export default function TariffEditor({ tariff, onChange, kind, compact }: {
  tariff: Tariff; onChange: (t: Tariff) => void; kind: "water" | "electric"; compact?: boolean;
}) {
  const tiers = tariff.tiers;
  const set = (patch: Partial<Tariff>) => onChange({ ...tariff, ...patch });
  const setTier = (i: number, patch: Partial<Tariff["tiers"][number]>) => set({ tiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const addTier = () => {
    // แทรกขั้นใหม่ก่อนขั้นสุดท้าย (ขั้นสุดท้ายคือ "เกินจากนั้น")
    const last = tiers[tiers.length - 1];
    const prevCap = tiers.length >= 2 ? Number(tiers[tiers.length - 2].upTo) || 0 : 0;
    const next = [...tiers.slice(0, -1), { upTo: prevCap + 10, rate: last?.rate ?? 0 }, last ?? { upTo: null, rate: 0 }];
    set({ tiers: next });
  };
  const tiered = tariff.mode === "tiered";
  const cls = compact ? "form-control form-control-sm text-end" : "form-control text-end";
  const lbl: React.CSSProperties = { fontSize: compact ? "0.72rem" : "0.8rem", color: "var(--color-dark-variant)" };
  const sample = [kind === "water" ? 20 : 100, kind === "water" ? 45 : 300];

  return (
    <div>
      <div className="btn-group btn-group-sm w-100 mb-2" role="group">
        <button type="button" className={`btn btn-outline-secondary${tiered ? "" : " active"}`} onClick={() => set({ mode: "rate" })}>อัตราเดียว (ตามช่องด้านบน)</button>
        <button type="button" className={`btn btn-outline-secondary${tiered ? " active" : ""}`} onClick={() => set({ mode: "tiered" })}>อัตราก้าวหน้า (ตามจริง)</button>
      </div>
      {tiered && (
        <div className="p-2 rounded" style={{ border: "1px dashed var(--color-light)" }}>
          <div style={lbl} className="mb-1">ขั้นราคา — คิดเฉพาะหน่วยที่อยู่ในขั้นนั้น (หน่วยสะสมถึง ... / บาทต่อหน่วย)</div>
          {tiers.map((t, i) => {
            const isLast = i === tiers.length - 1;
            return (
              <div key={i} className="row g-2 align-items-center mb-1">
                <div className="col-5">
                  {isLast ? (
                    <input className={cls} disabled value="เกินจากนั้น" style={{ textAlign: "center" }} />
                  ) : (
                    <input type="number" min={0} className={cls} value={t.upTo ?? ""} placeholder="ถึงหน่วยที่"
                      onChange={(e) => setTier(i, { upTo: Number(e.target.value) || 0 })} />
                  )}
                </div>
                <div className="col-5">
                  <input type="number" step="any" min={0} className={cls} value={t.rate} onChange={(e) => setTier(i, { rate: Number(e.target.value) || 0 })} />
                </div>
                <div className="col-2 text-end">
                  {!isLast && tiers.length > 2 && (
                    <button type="button" className="btn btn-sm btn-outline-danger" style={{ padding: "0 8px" }} onClick={() => set({ tiers: tiers.filter((_, j) => j !== i) })}>×</button>
                  )}
                </div>
              </div>
            );
          })}
          <button type="button" className="btn btn-sm btn-outline-primary mt-1" onClick={addTier}><i className="fas fa-plus me-1" />เพิ่มขั้น</button>
          <div className="row g-2 mt-2">
            <div className="col-4">
              <div style={lbl}>ค่าบริการคงที่ (บาท)</div>
              <input type="number" step="any" min={0} className={cls} value={tariff.fixedFee} onChange={(e) => set({ fixedFee: Number(e.target.value) || 0 })} />
            </div>
            <div className="col-4">
              <div style={lbl}>{kind === "electric" ? "ค่า Ft (บาท/หน่วย)" : "ค่าเพิ่ม (บาท/หน่วย)"}</div>
              <input type="number" step="any" min={0} className={cls} value={tariff.ftRate} onChange={(e) => set({ ftRate: Number(e.target.value) || 0 })} />
            </div>
            <div className="col-4">
              <div style={lbl}>VAT (%)</div>
              <input type="number" step="any" min={0} className={cls} value={tariff.vatPercent} onChange={(e) => set({ vatPercent: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div style={lbl} className="mt-2">
            สูตร: (ค่าตามขั้น + ค่าบริการคงที่ + หน่วย × ค่าเพิ่ม) × (1 + VAT) — ตัวอย่าง {sample.map((u) => `${u} หน่วย = ${calcTariff(u, tariff).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`).join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}
