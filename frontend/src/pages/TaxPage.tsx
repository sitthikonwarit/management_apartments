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

// ── ชุดรายได้ที่นำมาคิดภาษี: เลือกตึก/ชั้น/ห้อง + หมวดรายได้ที่รับจริง ได้หลายชุด แล้วบวกรวมกัน ──
interface IncomeSet { id: string; name: string; towerIds: string[]; floors: string[]; roomIds: string[]; comps: (keyof ReceivedByComponent)[] }
const COMP_OPTIONS: { key: keyof ReceivedByComponent; label: string }[] = [
  { key: "rent", label: "ค่าห้อง" },
  { key: "water", label: "ค่าน้ำ" },
  { key: "electric", label: "ค่าไฟ" },
  { key: "other", label: "ค่าอื่นๆ (จอดรถ/แท็ก/รายการเพิ่ม)" },
  { key: "fine", label: "ค่าปรับ" },
  { key: "old", label: "ยอดค้างเดือนเก่าที่รับในเดือนนี้" },
];
const ALL_COMPS = COMP_OPTIONS.map((c) => c.key);
const newSet = (n: number): IncomeSet => ({ id: `S${Date.now()}${n}`, name: `ชุดที่ ${n}`, towerIds: [], floors: [], roomIds: [], comps: [...ALL_COMPS] });
const multiStyles = { ...(customStyles as any), valueContainer: (b: any) => ({ ...b, padding: "0.25rem 0.5rem" }) };

export default function TaxPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const [bills, setBills] = useState<BillGroup[]>([]);
  const [moves, setMoves] = useState<RepairMovement[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [towers, setTowers] = useState<any[]>([]);
  const [sets, setSets] = usePersistedPref<IncomeSet[]>("tax-income-sets", [newSet(1)]);
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

  const roomById = useMemo(() => new Map(rooms.map((r) => [String(r.id), r])), [rooms]);

  // รายได้ที่รับจริงของแต่ละเดือน แยกตามชุดรายได้ (ผู้เช่าทดสอบไม่นับ) — ชุดละหลายหมวด/ตึก/ชั้น/ห้อง แล้วรวมทุกชุด
  const monthly = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const my = `${String(i + 1).padStart(2, "0")}/${selYear}`;
      const group = bills.find((b) => b.monthYear === my);
      if (!group) return { my, hasBill: false, net: 0, perSet: sets.map(() => 0) };
      const items = (group.data ?? []).map(normalizeBillItem).filter((it) => !isTestItem(it, tenants));
      const comps = items.map((it) => ({ it, rc: receivedByComponent(it, bills), room: roomById.get(String(it.roomId)) }));
      const perSet = sets.map((s) => comps
        .filter(({ it, room }) =>
          (s.towerIds.length === 0 || s.towerIds.includes(String(room?.towerId ?? ""))) &&
          (s.floors.length === 0 || s.floors.includes(String(room?.floor ?? ""))) &&
          (s.roomIds.length === 0 || s.roomIds.includes(String(it.roomId))))
        .reduce((sum, { rc }) => sum + s.comps.reduce((a, k) => a + (rc[k] || 0), 0), 0));
      return { my, hasBill: true, net: perSet.reduce((a, b) => a + b, 0), perSet };
    });
  }, [bills, selYear, tenants, sets, roomById]);

  const updateSet = (id: string, patch: Partial<IncomeSet>) => setSets(sets.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const setTotals = sets.map((_, i) => monthly.reduce((a, m) => a + (m.perSet[i] ?? 0), 0));

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
    { icon: "fa-hand-holding-dollar text-success", label: method === "projected" ? "รายได้ (ประมาณการทั้งปี)" : "รายได้ที่เลือก (รับจริงถึงปัจจุบัน)", val: `${money(income)} ฿` },
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

          <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
            <h6 className="mb-0">ชุดรายได้ที่นำมาคิดภาษี</h6>
            <button className="btn btn-sm btn-primary" onClick={() => setSets([...sets, newSet(sets.length + 1)])}><i className="fas fa-plus me-1" />เพิ่มชุด</button>
          </div>
          <div className="text-muted small mb-2">แต่ละชุดเลือกตึก/ชั้น/ห้อง และหมวดรายได้ที่รับจริงได้ แล้วระบบบวกทุกชุดเข้าด้วยกัน (ผู้เช่าทดสอบไม่นับ) — ระวังไม่ให้ห้อง+หมวดเดียวกันซ้ำในหลายชุด จะถูกนับซ้ำ</div>
          {sets.map((s, idx) => {
            const towerOpts = towers.map((t: any) => ({ value: String(t.id), label: t.name }));
            const inTowers = rooms.filter((r) => s.towerIds.length === 0 || s.towerIds.includes(String(r.towerId ?? "")));
            const floorOpts = [...new Set(inTowers.map((r) => String(r.floor ?? "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => ({ value: f, label: `ชั้น ${f}` }));
            const roomOpts = inTowers.filter((r) => s.floors.length === 0 || s.floors.includes(String(r.floor ?? "")))
              .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true })).map((r) => ({ value: String(r.id), label: `ห้อง ${r.number}` }));
            return (
              <div key={s.id} className="mb-3 p-3" style={{ border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)" }}>
                <div className="d-flex justify-content-between align-items-center gap-2 mb-2 flex-wrap">
                  <input className="form-control" style={{ maxWidth: 260 }} value={s.name} onChange={(e) => updateSet(s.id, { name: e.target.value })} />
                  <div className="d-flex align-items-center gap-2">
                    <strong className="text-success">{money(setTotals[idx] ?? 0)} ฿</strong>
                    {sets.length > 1 && <button className="btn btn-sm btn-outline-danger" title="ลบชุดนี้" onClick={() => setSets(sets.filter((x) => x.id !== s.id))}><i className="fas fa-trash-alt" /></button>}
                  </div>
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-12 col-md-4">
                    <Select isMulti options={towerOpts} value={towerOpts.filter((o) => s.towerIds.includes(o.value))} styles={multiStyles}
                      onChange={(sel) => updateSet(s.id, { towerIds: (sel as any[]).map((o) => o.value), floors: [], roomIds: [] })}
                      placeholder="ทุกตึก" noOptionsMessage={() => "ไม่พบข้อมูล"} closeMenuOnSelect={false} menuPortalTarget={document.body} menuPosition="fixed" />
                  </div>
                  <div className="col-12 col-md-4">
                    <Select isMulti options={floorOpts} value={floorOpts.filter((o) => s.floors.includes(o.value))} styles={multiStyles}
                      onChange={(sel) => updateSet(s.id, { floors: (sel as any[]).map((o) => o.value), roomIds: [] })}
                      placeholder="ทุกชั้น" noOptionsMessage={() => "ไม่พบข้อมูล"} closeMenuOnSelect={false} menuPortalTarget={document.body} menuPosition="fixed" />
                  </div>
                  <div className="col-12 col-md-4">
                    <Select isMulti options={roomOpts} value={roomOpts.filter((o) => s.roomIds.includes(o.value))} styles={multiStyles}
                      onChange={(sel) => updateSet(s.id, { roomIds: (sel as any[]).map((o) => o.value) })}
                      placeholder="ทุกห้อง" noOptionsMessage={() => "ไม่พบข้อมูล"} closeMenuOnSelect={false} menuPortalTarget={document.body} menuPosition="fixed" />
                  </div>
                </div>
                <div className="d-flex flex-wrap gap-3 align-items-center">
                  {COMP_OPTIONS.map((c) => (
                    <label key={c.key} className="d-flex align-items-center gap-2" style={{ cursor: "pointer" }}>
                      <input type="checkbox" className="form-check-input mt-0" checked={s.comps.includes(c.key)}
                        onChange={(e) => updateSet(s.id, { comps: e.target.checked ? [...s.comps, c.key] : s.comps.filter((k) => k !== c.key) })} />
                      {c.label}
                    </label>
                  ))}
                </div>
                <div className="d-flex gap-2 mt-2 flex-wrap">
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => updateSet(s.id, { comps: [...ALL_COMPS] })}>ทุกหมวด</button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => updateSet(s.id, { comps: ["rent"] })}>ค่าห้องอย่างเดียว</button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => updateSet(s.id, { comps: ["rent", "other", "fine", "old"] })}>ไม่รวมน้ำ-ไฟ</button>
                </div>
              </div>
            );
          })}

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
                <tr><th>เดือน</th>{sets.length > 1 && sets.map((s) => <th key={s.id} className="text-end">{s.name}</th>)}<th className="text-end">ยอดรับรวม</th><th className="text-end">สะสม</th><th className="text-end">ภาษีส่วนของเดือน (ประมาณ)</th></tr>
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
                        {sets.length > 1 && m.perSet.map((v, k) => <td key={sets[k].id} className="text-end">{m.hasBill ? money(v) : "-"}</td>)}
                        <td className="text-end">{m.hasBill ? money(m.net) : "-"}</td>
                        <td className="text-end">{m.hasBill ? money(cum) : "-"}</td>
                        <td className="text-end">{m.hasBill ? money(share) : "-"}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
              <tfoot>
                <tr><td className="fw-bold">รวม</td>{sets.length > 1 && setTotals.map((v, k) => <td key={sets[k].id} className="text-end fw-bold">{money(v)}</td>)}<td className="text-end fw-bold">{money(ytd)}</td><td /><td className="text-end fw-bold">{money(income > 0 ? tax * (ytd / income) : 0)}</td></tr>
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
