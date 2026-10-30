import type { BillItem } from "../utils/billCalc";
import { monthYearLabel, buildWaterElectricRows, waterElectricRowName, waterElectricRowSub } from "../utils/billCalc";

// รับแค่ส่วนของ AppConfig ที่ใช้จริง (ไม่ใช่ทั้งก้อน) เพื่อให้เรียกใช้จากหน้าที่ไม่มี useAppConfig() ได้ด้วย
// (เช่นหน้า LIFF ฝั่งผู้เช่า ที่ดึงค่าจาก endpoint สาธารณะ /liff/config แทน ไม่ใช่ context ของพนักงาน)
export interface BillLinePreviewConfig {
  appIdentity: { logoUrl: string; logoBg: { enabled: boolean; color: string }; nameText: string };
  features: { splitRentByResidents: boolean };
  overdue: { enabled: boolean; day: number; type: "fixed" | "daily"; amount: number };
}

function money(n: number) {
  return (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dueDateLabel(overdue: BillLinePreviewConfig["overdue"] | undefined) {
  const day = overdue?.day ?? 5;
  return day === 0 ? "กำหนดชำระภายในสิ้นเดือน" : `กำหนดชำระภายในวันที่ ${day} ของเดือน`;
}

// ── ตัวอย่างบิลอิเล็กทรอนิกส์ (LINE) — ใช้ทั้งในหน้า Bills (พนักงานดูตัวอย่างก่อนส่ง/ในหน้ารายละเอียดบิล)
// และหน้า LIFF Payment/Profile (ผู้เช่ากด "ดูรายละเอียด") ต้องหน้าตาตรงกันเป๊ะทั้งสองที่ จึงแยกมาไว้ที่เดียว
export function BillLinePreview({ item, monthYear, config }: { item: BillItem; monthYear: string; config: BillLinePreviewConfig }) {
  const { logoUrl, logoBg, nameText } = config.appIdentity;
  const showSplit = !!config.features.splitRentByResidents && item.residentCount > 1;
  const rows: { icon: string; iconBg: string; name: string; sub?: string; price: number }[] = [];
  rows.push({ icon: "fa-door-open", iconBg: "var(--color-primary)", name: "ค่าห้อง/ค่าเช่า", price: item.priceRoom });
  // โชว์บรรทัดค่าไฟ/น้ำเมื่อห้องเปิดใช้มิเตอร์นั้นอยู่เสมอ แม้ยังไม่ได้จดมิเตอร์เดือนนี้หรือหน่วยเท่าเดิม (0 บาท)
  // ค่าบริการต่อหน่วย (ถ้าเปิดใช้งาน) จะรวมเป็นบรรทัดเดียวกันหรือแยกบรรทัดต่างหาก ตามที่ตั้งค่าไว้ในหน้า Settings
  // (ดู buildWaterElectricRows ใน utils/billCalc.ts)
  buildWaterElectricRows(item).forEach((r) => {
    const isFee = r.kind === "electricFee" || r.kind === "waterFee";
    const isElectric = r.kind === "electric" || r.kind === "electricFee";
    rows.push({
      icon: isFee ? "fa-file-invoice-dollar" : isElectric ? "fa-bolt" : "fa-tint",
      iconBg: isFee ? "#6c757d" : isElectric ? "#fd7e14" : "#0dcaf0",
      name: waterElectricRowName(r),
      sub: waterElectricRowSub(r, isElectric ? item.meterElectric.prev : item.meterWater.prev, isElectric ? item.meterElectric.curr : item.meterWater.curr, " → "),
      price: r.price,
    });
  });
  item.billTagItems.forEach((t) => t.price > 0 && rows.push({ icon: "fa-tag", iconBg: t.color || "#6c757d", name: t.name, price: t.price }));
  item.billTenantTagItems.forEach((t) => t.price > 0 && rows.push({ icon: "fa-tag", iconBg: t.color || "var(--color-primary)", name: t.name, price: t.price }));
  item.customItems.forEach((c) => c.price > 0 && rows.push({ icon: "fa-plus", iconBg: "var(--color-success)", name: c.name, price: c.price }));
  item.billVehicleItems.forEach((v) => v.price > 0 && rows.push({ icon: "fa-car", iconBg: "#6610f2", name: v.plate || v.name, price: v.price }));

  return (
    <div style={{ fontFamily: "'Sarabun', sans-serif", background: "#fff", borderRadius: "var(--border-radius-2)", overflow: "hidden", border: "1px solid #e0e0e0", maxWidth: 380, width: "100%", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ background: "var(--color-primary)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div style={{
            flex: "0 0 auto", marginRight: 15, width: 45, height: 45, borderRadius: 10, overflow: "hidden",
            background: logoBg.enabled ? logoBg.color : "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {logoUrl ? (
              <img src={logoUrl} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <i className="fas fa-home" style={{ color: "var(--color-primary)", fontSize: 22 }} />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 2, textTransform: "uppercase" }}>{nameText}</div>
            <h2 style={{ color: "#fff", margin: "0 0 5px 0", fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>แจ้งค่าเช่า</h2>
            <div style={{ color: "#fff", fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{item.tenantTitle} {item.tenantName}</div>
            <div style={{ color: "#fff", fontSize: 13, opacity: 0.95, fontWeight: 500 }}>ห้อง {item.roomNumber} (ประจำเดือน {monthYearLabel(monthYear)})</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "20px 20px 10px 20px", background: "#FAFAFA" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: r.iconBg, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12, flexShrink: 0, marginTop: 1 }}>
                <i className={`fas ${r.icon}`} style={{ color: "#fff", fontSize: 11 }} />
              </div>
              <div>
                <div style={{ color: "#333", fontSize: 15 }}>{r.name}</div>
                {r.sub && <div style={{ color: "#AAAAAA", fontSize: 12, marginTop: 2 }}>{r.sub}</div>}
              </div>
            </div>
            <span style={{ color: "#333", fontSize: 15 }}>{money(r.price)}</span>
          </div>
        ))}

        {item.fineAmount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, background: "rgba(255,0,96,0.08)", padding: 10, borderRadius: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-danger)" }}><i className="fas fa-exclamation-triangle me-2" />ค่าปรับล่าช้า{item.overdueDays > 0 ? ` (${item.overdueDays} วัน)` : ""}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-danger)" }}>{money(item.fineAmount)}</span>
          </div>
        )}

        {item.outstandingItems.length > 0 ? item.outstandingItems.map((o, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, background: "rgba(255,0,96,0.08)", padding: 10, borderRadius: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-danger)" }}>ค้างชำระ {monthYearLabel(o.monthYear)}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-danger)" }}>{money(o.amount)}</span>
          </div>
        )) : item.outstandingAmount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, background: "rgba(255,0,96,0.08)", padding: 10, borderRadius: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-danger)" }}>ยอดค้างชำระยกมา</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-danger)" }}>{money(item.outstandingAmount)}</span>
          </div>
        )}

        {item.discountItems.filter((d) => d.price > 0).map((d, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: "var(--color-danger)", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12, flexShrink: 0, marginTop: 1 }}>
                <i className="fas fa-tag" style={{ color: "#fff", fontSize: 11 }} />
              </div>
              <div style={{ color: "var(--color-danger)", fontSize: 15 }}>ส่วนลด: {d.name}</div>
            </div>
            <span style={{ color: "var(--color-danger)", fontSize: 15 }}>-{money(d.price)}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: "15px 20px", background: "#fff", borderTop: "1px solid #EEEEEE" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 5 }}>
          <span style={{ color: "#333", fontSize: 16, fontWeight: 700 }}>ยอดชำระสุทธิ</span>
          <span style={{ color: "var(--color-primary)", fontSize: 24, fontWeight: 700 }}>{money(item.total)} ฿</span>
        </div>
        {item.paidAmount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <span style={{ color: "var(--color-success)", fontSize: 14 }}><i className="fas fa-check-circle me-1" />ชำระไปแล้ว</span>
            <span style={{ color: "var(--color-success)", fontSize: 14, fontWeight: 700 }}>{money(item.paidAmount)} ฿</span>
          </div>
        )}
        {showSplit && (
          <div style={{ textAlign: "right", color: "var(--color-primary)", fontSize: 16, fontWeight: 700, marginTop: 4 }}>
            หาร {item.residentCount} คน · คนละ {money(item.total / item.residentCount)} บาท
          </div>
        )}
        <div style={{ textAlign: "center", color: "#888", fontSize: 12, marginTop: 15 }}>{dueDateLabel(item.overdueConfig ?? config.overdue)}</div>
      </div>
    </div>
  );
}
