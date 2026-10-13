import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from "chart.js";
import { repairsApi, type RepairMovement } from "../api/client";
import CustomSelect2 from "./CustomSelect2";
import { monthYearLabel } from "../utils/billCalc";
import { usePersistedPref } from "../utils/useColumnWidths";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { toDisplayYear } from "../utils/yearFormat";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);
ChartJS.defaults.font.family = "'Mitr', 'Poppins', sans-serif";

export interface MonthlyBillSummary {
  monthYear: string; // "MM/YYYY"
  water: number; electric: number; waterUnits: number; electricUnits: number;
  billed: number;   // ยอดเรียกเก็บของเดือนนั้นเอง (ไม่รวมยอดค้างยกมา)
  received: number; // ยอดรับแล้วสุทธิ
}

const money = (n: number) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => (Number(n) || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const MONTH_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// ผลประกอบการรายปี: ค่าน้ำ/ค่าไฟ + หน่วยที่ใช้ + ยอดเรียกเก็บ + รายได้ที่รับแล้วสุทธิ + รายจ่าย (ซื้อของซ่อมแซมเข้าคลัง) + กำไรสุทธิ พร้อมกราฟ
export default function BillYearlyReport({ monthly }: { monthly: MonthlyBillSummary[] }) {
  const [open, setOpen] = usePersistedPref<boolean>("bills-yearly-open", false);
  const [year, setYear] = useState<number | null>(null);
  const [moves, setMoves] = useState<RepairMovement[]>([]);
  const tick = useLiveRefreshTick(["repair-movement"]);
  useEffect(() => { repairsApi.getMovements().then(setMoves).catch(() => {}); }, [tick]);

  const years = useMemo(
    () => [...new Set(monthly.map((m) => parseInt(m.monthYear.split("/")[1], 10)).filter((y) => y > 0))].sort((a, b) => b - a),
    [monthly]
  );
  const selYear = year ?? years[0] ?? new Date().getFullYear();

  const rows = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const my = `${String(i + 1).padStart(2, "0")}/${selYear}`;
    const m = monthly.find((x) => x.monthYear === my);
    const expense = moves
      .filter((v) => v.type === "in" && v.date.startsWith(`${selYear}-${String(i + 1).padStart(2, "0")}`))
      .reduce((s, v) => s + v.quantity * v.unitPrice, 0);
    return {
      my, hasBill: !!m, label: MONTH_SHORT[i],
      water: m?.water ?? 0, electric: m?.electric ?? 0, waterUnits: m?.waterUnits ?? 0, electricUnits: m?.electricUnits ?? 0,
      billed: m?.billed ?? 0, income: m?.received ?? 0, expense, profit: (m?.received ?? 0) - expense,
    };
  }), [monthly, moves, selYear]);

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const tot = {
    water: sum((r) => r.water), electric: sum((r) => r.electric), waterUnits: sum((r) => r.waterUnits), electricUnits: sum((r) => r.electricUnits),
    billed: sum((r) => r.billed), income: sum((r) => r.income), expense: sum((r) => r.expense), profit: sum((r) => r.profit),
  };

  const yearOptions = (years.length ? years : [selYear]).map((y) => ({ value: y, label: `ปี ${toDisplayYear(y, "CE")}` }));

  const txt = typeof document !== "undefined" ? getComputedStyle(document.body).getPropertyValue("--color-dark").trim() || "#666" : "#666";
  const grid = "rgba(128,128,128,0.2)";
  const baseOptions = (unit: string) => ({
    responsive: true,
    maintainAspectRatio: false,
    color: txt,
    plugins: {
      legend: { position: "top" as const, align: "end" as const, labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 }, color: txt } },
      tooltip: { callbacks: { label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("th-TH", { maximumFractionDigits: 2 })} ${unit}` } },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: grid }, ticks: { font: { size: 11 }, color: txt } },
      x: { grid: { display: false }, ticks: { font: { size: 11 }, color: txt } },
    },
    interaction: { mode: "index" as const, intersect: false },
  });
  const ds = (label: string, data: number[], color: string) => ({
    label, data, backgroundColor: color, borderRadius: 4, barPercentage: 0.7, categoryPercentage: 0.8,
  });
  const labels = rows.map((r) => r.label);

  const cards = [
    { icon: "fa-droplet text-info", label: "ค่าน้ำรวม", val: `${money(tot.water)} ฿`, sub: `${int(tot.waterUnits)} หน่วย` },
    { icon: "fa-bolt text-warning", label: "ค่าไฟรวม", val: `${money(tot.electric)} ฿`, sub: `${int(tot.electricUnits)} หน่วย` },
    { icon: "fa-file-invoice-dollar text-primary", label: "ยอดเรียกเก็บรวม", val: `${money(tot.billed)} ฿`, sub: "ไม่รวมยอดค้างยกมา" },
    { icon: "fa-hand-holding-dollar text-success", label: "รายได้ (รับแล้วสุทธิ)", val: `${money(tot.income)} ฿`, sub: "" },
    { icon: "fa-cart-shopping text-danger", label: "รายจ่าย (ซื้อของซ่อมแซม)", val: `${money(tot.expense)} ฿`, sub: "" },
    { icon: "fa-sack-dollar " + (tot.profit >= 0 ? "text-success" : "text-danger"), label: "กำไรสุทธิ", val: `${money(tot.profit)} ฿`, sub: "รายได้ − รายจ่าย" },
  ];

  return (
    <div className="mb-4" style={{ border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)" }}>
      <div className="d-flex justify-content-between align-items-center p-3 flex-wrap gap-2" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <strong><i className="fas fa-chart-column me-2 text-primary" />ผลประกอบการรายปี</strong>
        <div className="d-flex align-items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {open && <div style={{ minWidth: 150 }}>
            <CustomSelect2 value={yearOptions.find((o) => o.value === selYear)} options={yearOptions}
              onChange={(o: any) => setYear(o?.value ?? null)} isSearchable={false} />
          </div>}
          <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(!open)} title={open ? "ซ่อน" : "แสดง"}>
            <i className={`fas fa-chevron-${open ? "up" : "down"}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="p-3 pt-0">
          <div className="row g-3 mb-3">
            {cards.map(({ icon, label, val, sub }) => (
              <div key={label} className="col-6 col-lg-4">
                <div className="detail-item">
                  <i className={`fas ${icon}`} />
                  <div>
                    <div className="label">{label}</div>
                    <div className="value">{val}</div>
                    {sub && <div className="text-muted" style={{ fontSize: "0.72rem" }}>{sub}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-xl-6">
              <div className="small fw-bold mb-1">รายได้ / รายจ่าย รายเดือน (฿)</div>
              <div style={{ position: "relative", height: 260 }}>
                <Bar data={{ labels, datasets: [ds("รายได้", rows.map((r) => r.income), "rgba(40,167,120,0.75)"), ds("รายจ่าย", rows.map((r) => r.expense), "rgba(220,53,69,0.75)")] }} options={baseOptions("฿")} />
              </div>
            </div>
            <div className="col-12 col-xl-6">
              <div className="small fw-bold mb-1">ค่าน้ำ / ค่าไฟ รายเดือน (฿)</div>
              <div style={{ position: "relative", height: 260 }}>
                <Bar data={{ labels, datasets: [ds("ค่าน้ำ", rows.map((r) => r.water), "rgba(54,162,235,0.75)"), ds("ค่าไฟ", rows.map((r) => r.electric), "rgba(255,193,7,0.8)")] }} options={baseOptions("฿")} />
              </div>
            </div>
            <div className="col-12 col-xl-6">
              <div className="small fw-bold mb-1">หน่วยน้ำ / หน่วยไฟ ที่ใช้ รายเดือน</div>
              <div style={{ position: "relative", height: 260 }}>
                <Bar data={{ labels, datasets: [ds("น้ำ (หน่วย)", rows.map((r) => r.waterUnits), "rgba(54,162,235,0.75)"), ds("ไฟ (หน่วย)", rows.map((r) => r.electricUnits), "rgba(255,193,7,0.8)")] }} options={baseOptions("หน่วย")} />
              </div>
            </div>
            <div className="col-12 col-xl-6">
              <div className="small fw-bold mb-1">ยอดเรียกเก็บ vs รายได้ที่รับแล้ว (฿)</div>
              <div style={{ position: "relative", height: 260 }}>
                <Bar data={{ labels, datasets: [ds("เรียกเก็บ", rows.map((r) => r.billed), "rgba(108,155,207,0.8)"), ds("รับแล้วสุทธิ", rows.map((r) => r.income), "rgba(40,167,120,0.75)")] }} options={baseOptions("฿")} />
              </div>
            </div>
          </div>

          <div className="nicescrollbar" style={{ overflow: "auto" }}>
            <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 900 }}>
              <thead>
                <tr>
                  <th>เดือน</th><th className="text-end">ค่าน้ำ</th><th className="text-end">หน่วยน้ำ</th>
                  <th className="text-end">ค่าไฟ</th><th className="text-end">หน่วยไฟ</th><th className="text-end">เรียกเก็บ</th>
                  <th className="text-end">รายได้</th><th className="text-end">รายจ่าย</th><th className="text-end">กำไรสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.my} style={r.hasBill || r.expense > 0 ? undefined : { opacity: 0.45 }}>
                    <td className="fw-bold">{monthYearLabel(r.my)}</td>
                    <td className="text-end">{r.hasBill ? money(r.water) : "-"}</td>
                    <td className="text-end">{r.hasBill ? int(r.waterUnits) : "-"}</td>
                    <td className="text-end">{r.hasBill ? money(r.electric) : "-"}</td>
                    <td className="text-end">{r.hasBill ? int(r.electricUnits) : "-"}</td>
                    <td className="text-end">{r.hasBill ? money(r.billed) : "-"}</td>
                    <td className="text-end">{r.hasBill ? money(r.income) : "-"}</td>
                    <td className="text-end">{r.expense > 0 ? money(r.expense) : "-"}</td>
                    <td className={`text-end fw-bold ${r.profit < 0 ? "text-danger" : ""}`}>{r.hasBill || r.expense > 0 ? money(r.profit) : "-"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="fw-bold">รวมทั้งปี</td>
                  <td className="text-end fw-bold">{money(tot.water)}</td><td className="text-end fw-bold">{int(tot.waterUnits)}</td>
                  <td className="text-end fw-bold">{money(tot.electric)}</td><td className="text-end fw-bold">{int(tot.electricUnits)}</td>
                  <td className="text-end fw-bold">{money(tot.billed)}</td><td className="text-end fw-bold">{money(tot.income)}</td>
                  <td className="text-end fw-bold">{money(tot.expense)}</td>
                  <td className={`text-end fw-bold ${tot.profit < 0 ? "text-danger" : ""}`}>{money(tot.profit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="text-muted small mt-2">
            รายได้ = ยอดรับแล้วสุทธิของแต่ละเดือน · รายจ่าย = ค่าของที่ซื้อเข้าคลังในเมนูซ่อมแซม ตามเดือนที่ซื้อ (ยังไม่รวมค่าน้ำ/ค่าไฟที่จ่ายให้การประปา/การไฟฟ้า และค่าใช้จ่ายอื่นที่ไม่ได้บันทึกในระบบ)
          </div>
        </div>
      )}
    </div>
  );
}
