import { useEffect, useMemo, useState } from "react";
import { billsApi, repairsApi, type RepairMovement } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import CustomSelect2 from "../components/CustomSelect2";
import EmptyState from "../components/EmptyState";
import { computeBillStats } from "./BillsPage";
import { normalizeBillItem, monthYearLabel, type BillGroup } from "../utils/billCalc";
import { usePersistedPref } from "../utils/useColumnWidths";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toDisplayYear } from "../utils/yearFormat";
import { toastError } from "../utils/toast";

// ── ภาษีเงินได้บุคคลธรรมดา (ค่าเช่า = เงินได้ประเภท ม.40(5)) แบบอัตราก้าวหน้า — คำนวณอัตโนมัติจาก "ยอดรับแล้วสุทธิ" ของแต่ละเดือน ──
const BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: 150000, rate: 0 },
  { upTo: 300000, rate: 0.05 },
  { upTo: 500000, rate: 0.10 },
  { upTo: 750000, rate: 0.15 },
  { upTo: 1000000, rate: 0.20 },
  { upTo: 2000000, rate: 0.25 },
  { upTo: 5000000, rate: 0.30 },
  { upTo: Infinity, rate: 0.35 },
];

const money = (n: number) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function calcTax(net: number) {
  let prev = 0; let total = 0;
  const rows = BRACKETS.map((b) => {
    const slice = Math.max(0, Math.min(net, b.upTo) - prev);
    const tax = slice * b.rate;
    const row = { from: prev, to: b.upTo, rate: b.rate, slice, tax };
    prev = b.upTo; total += tax;
    return row;
  });
  return { rows, total };
}

const METHOD_OPTIONS = [
  { value: "ytd", label: "รายได้จริงที่รับแล้วถึงปัจจุบัน" },
  { value: "projected", label: "ประมาณการทั้งปี (เฉลี่ยเดือนที่มีบิล × 12)" },
];
const DEDUCT_OPTIONS = [
  { value: "flat30", label: "หักค่าใช้จ่ายเหมา 30%" },
  { value: "actual", label: "หักตามจริง (ค่าซ่อม + ค่าใช้จ่ายอื่น)" },
];

export default function TaxPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const [bills, setBills] = useState<BillGroup[]>([]);
  const [moves, setMoves] = useState<RepairMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number | null>(null);
  const [method, setMethod] = usePersistedPref<string>("tax-method", "ytd");
  const [deduct, setDeduct] = usePersistedPref<string>("tax-deduct", "flat30");
  const [personalAllowance, setPersonalAllowance] = usePersistedPref<string>("tax-personal", "60000");
  const [otherAllowance, setOtherAllowance] = usePersistedPref<string>("tax-other-allowance", "0");
  const [otherExpense, setOtherExpense] = usePersistedPref<string>("tax-other-expense", "0");
  const [includeRepairs, setIncludeRepairs] = usePersistedPref<boolean>("tax-include-repairs", true);

  useEffect(() => {
    setBreadcrumb([{ label: "คำนวณภาษี" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const tick = useLiveRefreshTick(["bill", "payment", "repair-movement"]);
  useEffect(() => {
    Promise.all([billsApi.getAll(), repairsApi.getMovements()])
      .then(([b, m]) => { setBills(b); setMoves(m); })
      .catch((e) => toastError(e?.response?.data?.error ?? e?.message ?? "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [tick]);

  const years = useMemo(
    () => [...new Set(bills.map((b) => parseInt(String(b.monthYear).split("/")[1], 10)).filter((y) => y > 0))].sort((a, b) => b - a),
    [bills]
  );
  const selYear = year ?? years[0] ?? new Date().getFullYear();

  // ยอดรับแล้วสุทธิของแต่ละเดือน (ตัวเลขเดียวกับการ์ด "ยอดรับแล้วสุทธิ" ในหน้าบิล)
  const monthly = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const my = `${String(i + 1).padStart(2, "0")}/${selYear}`;
      const group = bills.find((b) => b.monthYear === my);
      if (!group) return { my, hasBill: false, net: 0 };
      const items = (group.data ?? []).map(normalizeBillItem);
      return { my, hasBill: true, net: computeBillStats(items, [], my, bills).netReceived };
    });
  }, [bills, selYear]);

  const billMonths = monthly.filter((m) => m.hasBill).length;
  const ytd = monthly.reduce((s, m) => s + m.net, 0);
  const income = method === "projected" && billMonths > 0 ? (ytd / billMonths) * 12 : ytd;

  const repairCost = useMemo(
    () => moves.filter((m) => m.type === "out" && m.date.startsWith(`${selYear}-`)).reduce((s, m) => s + m.quantity * m.unitPrice, 0),
    [moves, selYear]
  );
  const expense = deduct === "flat30"
    ? income * 0.3
    : (includeRepairs ? repairCost : 0) + (Number(otherExpense) || 0);
  const allowance = (Number(personalAllowance) || 0) + (Number(otherAllowance) || 0);
  const netIncome = Math.max(0, income - expense - allowance);
  const { rows: bracketRows, total: tax } = useMemo(() => calcTax(netIncome), [netIncome]);
  const effective = income > 0 ? (tax / income) * 100 : 0;

  const yearOptions = (years.length ? years : [selYear]).map((y) => ({ value: y, label: `ปี ${toDisplayYear(y, "CE")}` }));

  const cards = [
    { icon: "fa-hand-holding-dollar text-success", label: method === "projected" ? "รายได้ (ประมาณการทั้งปี)" : "รายได้รับแล้วสุทธิ (ถึงปัจจุบัน)", val: `${money(income)} ฿` },
    { icon: "fa-receipt text-warning", label: deduct === "flat30" ? "หักค่าใช้จ่ายเหมา 30%" : "หักค่าใช้จ่ายตามจริง", val: `${money(expense)} ฿` },
    { icon: "fa-user-shield text-info", label: "หักค่าลดหย่อน", val: `${money(allowance)} ฿` },
    { icon: "fa-scale-balanced text-primary", label: "เงินได้สุทธิ", val: `${money(netIncome)} ฿` },
    { icon: "fa-landmark text-danger", label: "ภาษีที่ต้องชำระ (ประมาณ)", val: `${money(tax)} ฿` },
    { icon: "fa-piggy-bank text-success", label: "ควรกันไว้ต่อเดือน (÷12)", val: `${money(tax / 12)} ฿` },
  ];

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>คำนวณภาษี</h5>
        <div style={{ minWidth: 160 }}>
          <CustomSelect2 value={yearOptions.find((o) => o.value === selYear)} options={yearOptions}
            onChange={(o: any) => setYear(o?.value ?? null)} isSearchable={false} />
        </div>
      </div>

      {loading ? (
        <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
      ) : bills.length === 0 ? (
        <EmptyState icon="fa-landmark" text="ยังไม่มีข้อมูลบิล จึงยังคำนวณภาษีไม่ได้" />
      ) : (
        <>
          <div className="row g-3 mb-4">
            {cards.map(({ icon, label, val }) => (
              <div key={label} className="col-6 col-md-4">
                <div className="detail-item">
                  <i className={`fas ${icon}`} />
                  <div><div className="label">{label}</div><div className="value">{val}</div></div>
                </div>
              </div>
            ))}
          </div>

          <div className="row g-3 mb-4">
            <div className="col-12 col-md-6">
              <label className="form-label">วิธีคิดรายได้</label>
              <CustomSelect2 value={METHOD_OPTIONS.find((o) => o.value === method)} options={METHOD_OPTIONS}
                onChange={(o: any) => setMethod(o?.value ?? "ytd")} isSearchable={false} />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label">วิธีหักค่าใช้จ่าย</label>
              <CustomSelect2 value={DEDUCT_OPTIONS.find((o) => o.value === deduct)} options={DEDUCT_OPTIONS}
                onChange={(o: any) => setDeduct(o?.value ?? "flat30")} isSearchable={false} />
            </div>
            {deduct === "actual" && (
              <>
                <div className="col-12 col-md-6">
                  <label className="form-label">ค่าใช้จ่ายอื่นๆ ตลอดปี (บาท)</label>
                  <input type="number" min={0} className="form-control" value={otherExpense} onChange={(e) => setOtherExpense(e.target.value)} />
                </div>
                <div className="col-12 col-md-6 d-flex align-items-end">
                  <label className="d-flex align-items-center gap-2 mb-2" style={{ cursor: "pointer" }}>
                    <input type="checkbox" className="form-check-input mt-0" checked={includeRepairs} onChange={(e) => setIncludeRepairs(e.target.checked)} />
                    รวมค่าของที่เบิกใช้ซ่อมแซมปีนี้ ({money(repairCost)} ฿)
                  </label>
                </div>
              </>
            )}
            <div className="col-12 col-md-6">
              <label className="form-label">ลดหย่อนส่วนตัว (บาท)</label>
              <input type="number" min={0} className="form-control" value={personalAllowance} onChange={(e) => setPersonalAllowance(e.target.value)} />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label">ลดหย่อนอื่นๆ (ประกัน, บุตร, กองทุน ฯลฯ รวมกัน)</label>
              <input type="number" min={0} className="form-control" value={otherAllowance} onChange={(e) => setOtherAllowance(e.target.value)} />
            </div>
          </div>

          <h6 className="mb-2">ยอดรับแล้วสุทธิรายเดือน — ปี {toDisplayYear(selYear, "CE")}</h6>
          <div className="nicescrollbar mb-4" style={{ overflow: "auto" }}>
            <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 520 }}>
              <thead>
                <tr><th>เดือน</th><th className="text-end">ยอดรับแล้วสุทธิ</th><th className="text-end">สะสม</th><th className="text-end">ภาษีส่วนของเดือน (ประมาณ)</th></tr>
              </thead>
              <tbody>
                {(() => {
                  let cum = 0;
                  return monthly.map((m) => {
                    cum += m.net;
                    const share = income > 0 ? (tax * m.net) / income : 0;
                    return (
                      <tr key={m.my}>
                        <td className="fw-bold">{monthYearLabel(m.my)}{!m.hasBill && <span className="text-muted small fw-normal"> (ยังไม่มีบิล)</span>}</td>
                        <td className="text-end">{m.hasBill ? money(m.net) : "-"}</td>
                        <td className="text-end">{m.hasBill ? money(cum) : "-"}</td>
                        <td className="text-end">{m.hasBill ? money(share) : "-"}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
              <tfoot>
                <tr><td className="fw-bold">รวม</td><td className="text-end fw-bold">{money(ytd)}</td><td /><td className="text-end fw-bold">{money(income > 0 ? tax * (ytd / income) : 0)}</td></tr>
              </tfoot>
            </table>
          </div>

          <h6 className="mb-2">ขั้นภาษีก้าวหน้า</h6>
          <div className="nicescrollbar mb-3" style={{ overflow: "auto" }}>
            <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 520 }}>
              <thead>
                <tr><th>เงินได้สุทธิช่วง (บาท)</th><th className="text-center">อัตรา</th><th className="text-end">เงินได้ในช่วงนี้</th><th className="text-end">ภาษี</th></tr>
              </thead>
              <tbody>
                {bracketRows.map((r) => (
                  <tr key={r.from} style={r.slice > 0 ? undefined : { opacity: 0.45 }}>
                    <td>{r.from.toLocaleString("th-TH")} – {Number.isFinite(r.to) ? r.to.toLocaleString("th-TH") : "ขึ้นไป"}</td>
                    <td className="text-center">{Math.round(r.rate * 100)}%</td>
                    <td className="text-end">{money(r.slice)}</td>
                    <td className="text-end">{money(r.tax)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td className="fw-bold">รวมภาษี</td><td className="text-center">เฉลี่ย {effective.toFixed(2)}% ของรายได้</td><td /><td className="text-end fw-bold">{money(tax)}</td></tr>
              </tfoot>
            </table>
          </div>

          <div className="text-muted small">
            <i className="fas fa-circle-info me-1" />
            ประมาณการเบื้องต้นสำหรับภาษีเงินได้บุคคลธรรมดา (เงินได้จากการให้เช่าอสังหาริมทรัพย์ ม.40(5)) ตามอัตราก้าวหน้า ใช้ตัวเลข "ยอดรับแล้วสุทธิ" ของแต่ละเดือนเดียวกับหน้าบิล
            ไม่รวมภาษีหัก ณ ที่จ่ายที่ผู้เช่านิติบุคคลอาจหักไว้ (เครดิตภาษี) และสิทธิลดหย่อนเฉพาะราย — ควรตรวจสอบกับผู้เชี่ยวชาญด้านภาษีก่อนยื่นจริง
          </div>
        </>
      )}
    </div>
  );
}
