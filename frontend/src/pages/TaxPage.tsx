import { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { billsApi, repairsApi, tenantsApi, roomsApi, type RepairMovement } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import CustomSelect2, { customStyles } from "../components/CustomSelect2";
import EmptyState from "../components/EmptyState";
import { receivedByComponent, type ReceivedByComponent } from "./BillsPage";
import { normalizeBillItem, monthYearLabel, isTestItem, type BillGroup } from "../utils/billCalc";
import { usePersistedPref } from "../utils/useColumnWidths";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toDisplayYear } from "../utils/yearFormat";
import { toastError } from "../utils/toast";

// ── ภาษีเงินได้บุคคลธรรมดา (ค่าเช่า = เงินได้ประเภท ม.40(5)) แบบอัตราก้าวหน้า — คำนวณอัตโนมัติจากเงินที่รับจริงของแต่ละเดือน ──
// "ชุดคำนวณ" 1 ชุด = การคำนวณภาษีครบทั้งชุด (เลือกตึก/ชั้น/ห้อง + หมวดรายได้ + วิธีคิดรายได้ + ค่าใช้จ่าย + ลดหย่อน → ภาษีของชุดนั้น)
// เพิ่มได้หลายชุด (เช่น คนละคน/คนละตึก) แล้วสรุปภาษีรวมทุกชุดให้
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
const COMP_OPTIONS: { key: keyof ReceivedByComponent; label: string }[] = [
  { key: "rent", label: "ค่าห้อง" },
  { key: "water", label: "ค่าน้ำ" },
  { key: "electric", label: "ค่าไฟ" },
  { key: "other", label: "ค่าอื่นๆ (จอดรถ/แท็ก/รายการเพิ่ม)" },
  { key: "fine", label: "ค่าปรับ" },
  { key: "old", label: "ยอดค้างเดือนเก่าที่รับในเดือนนี้" },
];
const ALL_COMPS = COMP_OPTIONS.map((c) => c.key);

interface TaxSet {
  id: string; name: string;
  towerIds: string[]; floors: string[]; roomIds: string[]; comps: (keyof ReceivedByComponent)[];
  method: string; deduct: string; personal: string; otherAllowance: string; otherExpense: string; includeRepairs: boolean;
}
const newSet = (n: number): TaxSet => ({
  id: `T${Date.now()}${n}`, name: `ชุดคำนวณที่ ${n}`, towerIds: [], floors: [], roomIds: [], comps: [...ALL_COMPS],
  method: "ytd", deduct: "flat30", personal: "60000", otherAllowance: "0", otherExpense: "0", includeRepairs: true,
});
const multiStyles = { ...(customStyles as any), valueContainer: (b: any) => ({ ...b, padding: "0.25rem 0.5rem" }) };

interface Ctx { bills: BillGroup[]; tenants: any[]; rooms: any[]; moves: RepairMovement[]; year: number }

// คำนวณภาษีของ 1 ชุด (ฟังก์ชันล้วน — ใช้ทั้งตอนแสดงผลชุดนั้นและตอนรวมยอดทุกชุด)
function computeSet(s: TaxSet, ctx: Ctx) {
  const roomById = new Map(ctx.rooms.map((r) => [String(r.id), r]));
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const my = `${String(i + 1).padStart(2, "0")}/${ctx.year}`;
    const group = ctx.bills.find((b) => b.monthYear === my);
    if (!group) return { my, hasBill: false, net: 0 };
    const items = (group.data ?? []).map(normalizeBillItem).filter((it) => !isTestItem(it, ctx.tenants));
    const net = items
      .filter((it) => {
        const room = roomById.get(String(it.roomId));
        return (s.towerIds.length === 0 || s.towerIds.includes(String(room?.towerId ?? "")))
          && (s.floors.length === 0 || s.floors.includes(String(room?.floor ?? "")))
          && (s.roomIds.length === 0 || s.roomIds.includes(String(it.roomId)));
      })
      .reduce((sum, it) => { const rc = receivedByComponent(it, ctx.bills); return sum + s.comps.reduce((a, k) => a + (rc[k] || 0), 0); }, 0);
    return { my, hasBill: true, net };
  });
  const billMonths = monthly.filter((m) => m.hasBill).length;
  const ytd = monthly.reduce((a, m) => a + m.net, 0);
  const income = s.method === "projected" && billMonths > 0 ? (ytd / billMonths) * 12 : ytd;
  const repairCost = ctx.moves.filter((m) => m.type === "out" && m.date.startsWith(`${ctx.year}-`)).reduce((a, m) => a + m.quantity * m.unitPrice, 0);
  const expense = s.deduct === "flat30" ? income * 0.3 : (s.includeRepairs ? repairCost : 0) + (Number(s.otherExpense) || 0);
  const allowance = (Number(s.personal) || 0) + (Number(s.otherAllowance) || 0);
  const netIncome = Math.max(0, income - expense - allowance);
  const { rows: bracketRows, total: tax } = calcTax(netIncome);
  return { monthly, ytd, income, repairCost, expense, allowance, netIncome, bracketRows, tax, effective: income > 0 ? (tax / income) * 100 : 0 };
}
type SetResult = ReturnType<typeof computeSet>;

function TaxSetBlock({ s, result, ctx, towers, canDelete, onChange, onDelete }: {
  s: TaxSet; result: SetResult; ctx: Ctx; towers: any[]; canDelete: boolean;
  onChange: (patch: Partial<TaxSet>) => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(true);
  const { rooms } = ctx;
  const towerOpts = towers.map((t: any) => ({ value: String(t.id), label: t.name }));
  const inTowers = rooms.filter((r) => s.towerIds.length === 0 || s.towerIds.includes(String(r.towerId ?? "")));
  const floorOpts = [...new Set(inTowers.map((r) => String(r.floor ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => ({ value: f, label: `ชั้น ${f}` }));
  const roomOpts = inTowers.filter((r) => s.floors.length === 0 || s.floors.includes(String(r.floor ?? "")))
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true })).map((r) => ({ value: String(r.id), label: `ห้อง ${r.number}` }));
  const r = result;

  const cards = [
    { icon: "fa-hand-holding-dollar text-success", label: s.method === "projected" ? "รายได้ (ประมาณการทั้งปี)" : "รายได้ที่เลือก (รับจริงถึงปัจจุบัน)", val: `${money(r.income)} ฿` },
    { icon: "fa-receipt text-warning", label: s.deduct === "flat30" ? "หักค่าใช้จ่ายเหมา 30%" : "หักค่าใช้จ่ายตามจริง", val: `${money(r.expense)} ฿` },
    { icon: "fa-user-shield text-info", label: "หักค่าลดหย่อน", val: `${money(r.allowance)} ฿` },
    { icon: "fa-scale-balanced text-primary", label: "เงินได้สุทธิ", val: `${money(r.netIncome)} ฿` },
    { icon: "fa-landmark text-danger", label: "ภาษีที่ต้องชำระ (ประมาณ)", val: `${money(r.tax)} ฿` },
    { icon: "fa-piggy-bank text-success", label: "ควรกันไว้ต่อเดือน (÷12)", val: `${money(r.tax / 12)} ฿` },
  ];

  return (
    <div className="mb-4" style={{ border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)" }}>
      <div className="d-flex justify-content-between align-items-center gap-2 p-3 flex-wrap">
        <input className="form-control" style={{ maxWidth: 280, fontWeight: 600 }} value={s.name} onChange={(e) => onChange({ name: e.target.value })} />
        <div className="d-flex align-items-center gap-3">
          <span className="text-muted small">ภาษี</span><strong className="text-danger">{money(r.tax)} ฿</strong>
          <button className="btn btn-outline-secondary" onClick={() => setOpen(!open)} title={open ? "พับ" : "กาง"}><i className={`fas fa-chevron-${open ? "up" : "down"}`} /></button>
          {canDelete && <button className="btn btn-outline-danger" title="ลบชุดนี้" onClick={onDelete}><i className="fas fa-trash-alt" /></button>}
        </div>
      </div>

      {open && (
        <div className="p-3 pt-0">
          <h6 className="mb-2">รายได้ที่นำมาคิด</h6>
          <div className="row g-2 mb-2">
            <div className="col-12 col-md-4">
              <Select isMulti options={towerOpts} value={towerOpts.filter((o) => s.towerIds.includes(o.value))} styles={multiStyles}
                onChange={(sel) => onChange({ towerIds: (sel as any[]).map((o) => o.value), floors: [], roomIds: [] })}
                placeholder="ทุกตึก" noOptionsMessage={() => "ไม่พบข้อมูล"} closeMenuOnSelect={false} menuPortalTarget={document.body} menuPosition="fixed" />
            </div>
            <div className="col-12 col-md-4">
              <Select isMulti options={floorOpts} value={floorOpts.filter((o) => s.floors.includes(o.value))} styles={multiStyles}
                onChange={(sel) => onChange({ floors: (sel as any[]).map((o) => o.value), roomIds: [] })}
                placeholder="ทุกชั้น" noOptionsMessage={() => "ไม่พบข้อมูล"} closeMenuOnSelect={false} menuPortalTarget={document.body} menuPosition="fixed" />
            </div>
            <div className="col-12 col-md-4">
              <Select isMulti options={roomOpts} value={roomOpts.filter((o) => s.roomIds.includes(o.value))} styles={multiStyles}
                onChange={(sel) => onChange({ roomIds: (sel as any[]).map((o) => o.value) })}
                placeholder="ทุกห้อง" noOptionsMessage={() => "ไม่พบข้อมูล"} closeMenuOnSelect={false} menuPortalTarget={document.body} menuPosition="fixed" />
            </div>
          </div>
          <div className="d-flex flex-wrap gap-3 align-items-center">
            {COMP_OPTIONS.map((c) => (
              <label key={c.key} className="d-flex align-items-center gap-2" style={{ cursor: "pointer" }}>
                <input type="checkbox" className="form-check-input mt-0" checked={s.comps.includes(c.key)}
                  onChange={(e) => onChange({ comps: e.target.checked ? [...s.comps, c.key] : s.comps.filter((k) => k !== c.key) })} />
                {c.label}
              </label>
            ))}
          </div>
          <div className="d-flex gap-2 mt-2 mb-4 flex-wrap">
            <button className="btn btn-sm btn-outline-secondary" onClick={() => onChange({ comps: [...ALL_COMPS] })}>ทุกหมวด</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => onChange({ comps: ["rent"] })}>ค่าห้องอย่างเดียว</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => onChange({ comps: ["rent", "other", "fine", "old"] })}>ไม่รวมน้ำ-ไฟ</button>
          </div>

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
              <CustomSelect2 value={METHOD_OPTIONS.find((o) => o.value === s.method)} options={METHOD_OPTIONS}
                onChange={(o: any) => onChange({ method: o?.value ?? "ytd" })} isSearchable={false} />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label">วิธีหักค่าใช้จ่าย</label>
              <CustomSelect2 value={DEDUCT_OPTIONS.find((o) => o.value === s.deduct)} options={DEDUCT_OPTIONS}
                onChange={(o: any) => onChange({ deduct: o?.value ?? "flat30" })} isSearchable={false} />
            </div>
            {s.deduct === "actual" && (
              <>
                <div className="col-12 col-md-6">
                  <label className="form-label">ค่าใช้จ่ายอื่นๆ ตลอดปี (บาท)</label>
                  <input type="number" min={0} className="form-control" value={s.otherExpense} onChange={(e) => onChange({ otherExpense: e.target.value })} />
                </div>
                <div className="col-12 col-md-6 d-flex align-items-end">
                  <label className="d-flex align-items-center gap-2 mb-2" style={{ cursor: "pointer" }}>
                    <input type="checkbox" className="form-check-input mt-0" checked={s.includeRepairs} onChange={(e) => onChange({ includeRepairs: e.target.checked })} />
                    รวมค่าของที่เบิกใช้ซ่อมแซมปีนี้ ({money(r.repairCost)} ฿)
                  </label>
                </div>
              </>
            )}
            <div className="col-12 col-md-6">
              <label className="form-label">ลดหย่อนส่วนตัว (บาท)</label>
              <input type="number" min={0} className="form-control" value={s.personal} onChange={(e) => onChange({ personal: e.target.value })} />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label">ลดหย่อนอื่นๆ (ประกัน, บุตร, กองทุน ฯลฯ รวมกัน)</label>
              <input type="number" min={0} className="form-control" value={s.otherAllowance} onChange={(e) => onChange({ otherAllowance: e.target.value })} />
            </div>
          </div>

          <h6 className="mb-2">รายได้ที่รับจริงรายเดือน — ปี {toDisplayYear(ctx.year, "CE")}</h6>
          <div className="nicescrollbar mb-4" style={{ overflow: "auto" }}>
            <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 520 }}>
              <thead>
                <tr><th>เดือน</th><th className="text-end">ยอดรับ</th><th className="text-end">สะสม</th><th className="text-end">ภาษีส่วนของเดือน (ประมาณ)</th></tr>
              </thead>
              <tbody>
                {(() => {
                  let cum = 0;
                  return r.monthly.map((m) => {
                    cum += m.net;
                    const share = r.income > 0 ? (r.tax * m.net) / r.income : 0;
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
                <tr><td className="fw-bold">รวม</td><td className="text-end fw-bold">{money(r.ytd)}</td><td /><td className="text-end fw-bold">{money(r.income > 0 ? r.tax * (r.ytd / r.income) : 0)}</td></tr>
              </tfoot>
            </table>
          </div>

          <h6 className="mb-2">ขั้นภาษีก้าวหน้า</h6>
          <div className="nicescrollbar" style={{ overflow: "auto" }}>
            <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 520 }}>
              <thead>
                <tr><th>เงินได้สุทธิช่วง (บาท)</th><th className="text-center">อัตรา</th><th className="text-end">เงินได้ในช่วงนี้</th><th className="text-end">ภาษี</th></tr>
              </thead>
              <tbody>
                {r.bracketRows.map((b) => (
                  <tr key={b.from} style={b.slice > 0 ? undefined : { opacity: 0.45 }}>
                    <td>{b.from.toLocaleString("th-TH")} – {Number.isFinite(b.to) ? b.to.toLocaleString("th-TH") : "ขึ้นไป"}</td>
                    <td className="text-center">{Math.round(b.rate * 100)}%</td>
                    <td className="text-end">{money(b.slice)}</td>
                    <td className="text-end">{money(b.tax)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td className="fw-bold">รวมภาษี</td><td className="text-center">เฉลี่ย {r.effective.toFixed(2)}% ของรายได้</td><td /><td className="text-end fw-bold">{money(r.tax)}</td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TaxPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const [bills, setBills] = useState<BillGroup[]>([]);
  const [moves, setMoves] = useState<RepairMovement[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [towers, setTowers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number | null>(null);
  const [sets, setSets] = usePersistedPref<TaxSet[]>("tax-sets-v2", [newSet(1)]);

  useEffect(() => {
    setBreadcrumb([{ label: "คำนวณภาษี" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const tick = useLiveRefreshTick(["bill", "payment", "repair-movement"]);
  useEffect(() => {
    Promise.all([billsApi.getAll(), repairsApi.getMovements(), tenantsApi.getAll(), roomsApi.getAll(), roomsApi.getTowers()])
      .then(([b, m, t, r, tw]) => { setBills(b); setMoves(m); setTenants(t); setRooms(r); setTowers(tw); })
      .catch((e) => toastError(e?.response?.data?.error ?? e?.message ?? "โหลดข้อมูลไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [tick]);

  const years = useMemo(
    () => [...new Set(bills.map((b) => parseInt(String(b.monthYear).split("/")[1], 10)).filter((y) => y > 0))].sort((a, b) => b - a),
    [bills]
  );
  const selYear = year ?? years[0] ?? new Date().getFullYear();
  const ctx: Ctx = { bills, tenants, rooms, moves, year: selYear };
  const results = useMemo(() => sets.map((s) => computeSet(s, { bills, tenants, rooms, moves, year: selYear })), [sets, bills, tenants, rooms, moves, selYear]);
  const totalTax = results.reduce((a, r) => a + r.tax, 0);
  const totalIncome = results.reduce((a, r) => a + r.income, 0);

  const updateSet = (id: string, patch: Partial<TaxSet>) => setSets(sets.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const yearOptions = (years.length ? years : [selYear]).map((y) => ({ value: y, label: `ปี ${toDisplayYear(y, "CE")}` }));

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>คำนวณภาษี</h5>
        <div className="d-flex align-items-center gap-2">
          <div style={{ minWidth: 160 }}>
            <CustomSelect2 value={yearOptions.find((o) => o.value === selYear)} options={yearOptions}
              onChange={(o: any) => setYear(o?.value ?? null)} isSearchable={false} />
          </div>
          <button className="btn btn-primary d-inline-flex align-items-center" onClick={() => setSets([...sets, newSet(sets.length + 1)])}>
            <i className="fas fa-plus me-2" /><span className="btn-text">เพิ่มชุดคำนวณ</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
      ) : bills.length === 0 ? (
        <EmptyState icon="fa-landmark" text="ยังไม่มีข้อมูลบิล จึงยังคำนวณภาษีไม่ได้" />
      ) : (
        <>
          {sets.length > 1 && (
            <div className="mb-4 p-3" style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)" }}>
              <div className="fw-bold mb-2"><i className="fas fa-layer-group me-2 text-primary" />สรุปภาษีรวมทุกชุดคำนวณ — ปี {toDisplayYear(selYear, "CE")}</div>
              {sets.map((s, i) => (
                <div key={s.id} className="d-flex justify-content-between py-1" style={{ borderBottom: "1px solid var(--color-light)" }}>
                  <span>{s.name} <span className="text-muted small">(รายได้ {money(results[i].income)} ฿)</span></span>
                  <span className="fw-bold">{money(results[i].tax)} ฿</span>
                </div>
              ))}
              <div className="d-flex justify-content-between pt-2">
                <span className="fw-bold">รวมรายได้ {money(totalIncome)} ฿ · ภาษีรวมทุกชุด</span>
                <span className="fw-bold text-danger" style={{ fontSize: "1.1rem" }}>{money(totalTax)} ฿</span>
              </div>
            </div>
          )}

          {sets.map((s, i) => (
            <TaxSetBlock key={s.id} s={s} result={results[i]} ctx={ctx} towers={towers} canDelete={sets.length > 1}
              onChange={(patch) => updateSet(s.id, patch)} onDelete={() => setSets(sets.filter((x) => x.id !== s.id))} />
          ))}

          <div className="text-muted small">
            <i className="fas fa-circle-info me-1" />
            ประมาณการเบื้องต้นสำหรับภาษีเงินได้บุคคลธรรมดา (เงินได้จากการให้เช่าอสังหาริมทรัพย์ ม.40(5)) ตามอัตราก้าวหน้า ใช้เงินที่รับจริงรายเดือนเดียวกับหน้าบิล (ผู้เช่าทดสอบไม่นับ)
            ไม่รวมภาษีหัก ณ ที่จ่ายที่ผู้เช่านิติบุคคลอาจหักไว้ (เครดิตภาษี) และสิทธิลดหย่อนเฉพาะราย — ควรตรวจสอบกับผู้เชี่ยวชาญด้านภาษีก่อนยื่นจริง
            · ถ้าแบ่งหลายชุด ระวังไม่ให้ห้องและหมวดเดียวกันซ้ำกันในหลายชุด จะถูกนับซ้ำ
          </div>
        </>
      )}
    </div>
  );
}
