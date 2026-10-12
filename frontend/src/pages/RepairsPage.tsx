import { useEffect, useMemo, useState } from "react";
import { repairsApi, roomsApi, type RepairItem, type RepairMovement } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import CustomSelect2 from "../components/CustomSelect2";
import ThaiDatePicker from "../components/ThaiDatePicker";
import EmptyState from "../components/EmptyState";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { thaiDateOnlyString } from "../utils/yearFormat";
import { toastSuccess, toastError } from "../utils/toast";

type Tab = "stock" | "history" | "rooms";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "stock", label: "คลังของ", icon: "fa-boxes-stacked" },
  { key: "history", label: "ประวัติรับเข้า/เบิกใช้", icon: "fa-clock-rotate-left" },
  { key: "rooms", label: "สรุปค่าใช้จ่ายตามห้อง", icon: "fa-door-open" },
];

const money = (n: number) => (Number(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => (Number(n) || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dateLabel = (iso: string) => (iso ? thaiDateOnlyString(new Date(iso)) : "-");
const errMsg = (e: any) => e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด";

// ── ป็อปอัพเพิ่ม/แก้ไขของในคลัง ──────────────────────────────────────────────
function ItemModal({ item, onClose, onSaved }: { item: RepairItem | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "ชิ้น");
  const [minStock, setMinStock] = useState(String(item?.minStock ?? 0));
  const [note, setNote] = useState(item?.note ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toastError("กรุณาระบุชื่อของ"); return; }
    setSaving(true);
    try {
      const payload = { name, unit, minStock: Number(minStock) || 0, note };
      if (item) await repairsApi.updateItem(item.id, payload); else await repairsApi.createItem(payload);
      toastSuccess(item ? "แก้ไขข้อมูลของแล้ว" : "เพิ่มของในคลังแล้ว");
      onSaved();
    } catch (e) { toastError(errMsg(e)); } finally { setSaving(false); }
  }

  return (
    <div className="confirm-overlay" onClick={() => !saving && onClose()}>
      <div className="confirm-dialog" style={{ maxWidth: 460, width: "100%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h6 className="mb-3"><i className="fas fa-box me-2 text-primary" />{item ? "แก้ไขของในคลัง" : "เพิ่มของใหม่"}</h6>
        <div className="mb-2">
          <label className="form-label">ชื่อของ / อุปกรณ์</label>
          <input className="form-control" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น หลอดไฟ LED 9W, ก๊อกน้ำ, สายฉีดชำระ" />
        </div>
        <div className="row g-2 mb-2">
          <div className="col-6">
            <label className="form-label">หน่วยนับ</label>
            <input className="form-control" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ชิ้น / อัน / เมตร" />
          </div>
          <div className="col-6">
            <label className="form-label">เตือนเมื่อเหลือไม่เกิน</label>
            <input type="number" min={0} className="form-control" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </div>
        </div>
        <div className="mb-3">
          <label className="form-label">หมายเหตุ</label>
          <input className="form-control" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="d-flex gap-2 justify-content-end">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fas fa-save me-2" />}บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ป็อปอัพเติมของ (in) / เบิกใช้ (out) ───────────────────────────────────────
function MovementModal({ type, items, rooms, presetItemId, onClose, onSaved }: {
  type: "in" | "out"; items: RepairItem[]; rooms: any[]; presetItemId?: string; onClose: () => void; onSaved: () => void;
}) {
  const [itemId, setItemId] = useState(presetItemId ?? "");
  const [qty, setQty] = useState("1");
  const item = items.find((i) => i.id === itemId);
  const [price, setPrice] = useState(() => {
    const it = items.find((i) => i.id === presetItemId);
    return it && it.lastPrice > 0 ? String(it.lastPrice) : "";
  });
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const itemOptions = items.map((i) => ({ value: i.id, label: `${i.name} (คงเหลือ ${qtyFmt(i.stock)} ${i.unit})` }));
  const roomOptions = rooms
    .slice().sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
    .map((r) => ({ value: r.id, label: `ห้อง ${r.number}` }));
  const total = (Number(qty) || 0) * (Number(price) || 0);
  const isOut = type === "out";

  function pickItem(id: string) {
    setItemId(id);
    const it = items.find((i) => i.id === id);
    if (it && it.lastPrice > 0) setPrice(String(it.lastPrice));
  }

  async function save() {
    if (!item) { toastError("กรุณาเลือกของ"); return; }
    if (!(Number(qty) > 0)) { toastError("จำนวนต้องมากกว่า 0"); return; }
    if (isOut && !roomId) { toastError("กรุณาเลือกห้องที่นำไปใช้"); return; }
    if (isOut && Number(qty) > item.stock) { toastError(`ของคงเหลือไม่พอ (เหลือ ${qtyFmt(item.stock)} ${item.unit})`); return; }
    setSaving(true);
    try {
      await repairsApi.createMovement({ itemId, type, quantity: Number(qty), unitPrice: Number(price) || 0, roomId: isOut ? roomId : "", date, note });
      toastSuccess(isOut ? "บันทึกการเบิกใช้แล้ว" : "เติมของเข้าคลังแล้ว");
      onSaved();
    } catch (e) { toastError(errMsg(e)); } finally { setSaving(false); }
  }

  return (
    <div className="confirm-overlay" onClick={() => !saving && onClose()}>
      <div className="confirm-dialog" style={{ maxWidth: 480, width: "100%", textAlign: "left" }} onClick={(e) => e.stopPropagation()}>
        <h6 className="mb-3">
          <i className={`fas ${isOut ? "fa-arrow-right-from-bracket text-danger" : "fa-plus-circle text-success"} me-2`} />
          {isOut ? "เบิกของไปใช้" : "เติมของเข้าคลัง"}
        </h6>
        <div className="mb-2">
          <label className="form-label">ของ</label>
          <CustomSelect2 value={itemOptions.find((o) => o.value === itemId) ?? null} options={itemOptions}
            onChange={(o: any) => pickItem(o?.value ?? "")} placeholder="เลือกของ..." />
        </div>
        <div className="row g-2 mb-2">
          <div className="col-6">
            <label className="form-label">จำนวน {item && <span className="text-muted fw-normal">({item.unit})</span>}</label>
            <input type="number" min={0} step="any" className="form-control" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="col-6">
            <label className="form-label">ราคาต่อหน่วย (บาท)</label>
            <input type="number" min={0} step="any" className="form-control" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </div>
        </div>
        {isOut && (
          <div className="mb-2">
            <label className="form-label">นำไปใช้กับห้อง</label>
            <CustomSelect2 value={roomOptions.find((o) => o.value === roomId) ?? null} options={roomOptions}
              onChange={(o: any) => setRoomId(o?.value ?? "")} placeholder="เลือกห้อง..." />
          </div>
        )}
        <div className="mb-2">
          <label className="form-label">{isOut ? "วันที่เบิก" : "วันที่รับเข้า"}</label>
          <ThaiDatePicker value={date} onChange={setDate} />
        </div>
        <div className="mb-2">
          <label className="form-label">หมายเหตุ</label>
          <input className="form-control" value={note} onChange={(e) => setNote(e.target.value)} placeholder={isOut ? "เช่น เปลี่ยนก๊อกน้ำห้องน้ำ" : "เช่น ซื้อจากร้าน..."} />
        </div>
        <div className="d-flex justify-content-between align-items-center p-2 mb-3" style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)" }}>
          <span className="text-muted">รวมเป็นเงิน</span>
          <strong>{money(total)} ฿</strong>
        </div>
        <div className="d-flex gap-2 justify-content-end">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button className={`btn ${isOut ? "btn-danger" : "btn-success"}`} onClick={save} disabled={saving}>
            {saving ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fas fa-check me-2" />}
            {isOut ? "ยืนยันเบิกใช้" : "ยืนยันเติมของ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDelete({ text, onCancel, onConfirm }: { text: React.ReactNode; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="confirm-overlay" onClick={() => !busy && onCancel()}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-icon confirm-icon--danger"><i className="fas fa-trash-alt" /></div>
        <h6 className="confirm-title">ยืนยันการลบ?</h6>
        <p className="confirm-message">{text}</p>
        <div className="confirm-actions">
          <button className="btn btn-outline-secondary" onClick={onCancel} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-danger" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            {busy ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="fas fa-trash-alt me-1" />}ใช่, ลบ
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RepairsPage() {
  const { setBreadcrumb } = useBreadcrumb();
  const [tab, setTab] = useState<Tab>("stock");
  const [items, setItems] = useState<RepairItem[]>([]);
  const [moves, setMoves] = useState<RepairMovement[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [itemModal, setItemModal] = useState<{ item: RepairItem | null } | null>(null);
  const [moveModal, setMoveModal] = useState<{ type: "in" | "out"; itemId?: string } | null>(null);
  const [delItem, setDelItem] = useState<RepairItem | null>(null);
  const [delMove, setDelMove] = useState<RepairMovement | null>(null);
  // ตัวกรองประวัติ
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    setBreadcrumb([{ label: "ซ่อมแซม" }]);
    return () => setBreadcrumb([]);
  }, [setBreadcrumb]);

  const tick = useLiveRefreshTick(["repair-item", "repair-movement"]);
  async function load() {
    try {
      const [it, mv, rm] = await Promise.all([repairsApi.getItems(), repairsApi.getMovements(), roomsApi.getAll()]);
      setItems(it); setMoves(mv); setRooms(rm);
    } catch (e) { toastError(errMsg(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [tick]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const q = search.trim().toLowerCase();

  const filteredItems = useMemo(
    () => items.filter((i) => !q || i.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, "th")),
    [items, q]
  );
  const lowStockCount = items.filter((i) => i.minStock > 0 && i.stock <= i.minStock).length;
  const stockValue = items.reduce((s, i) => s + i.stock * i.lastPrice, 0);

  const filteredMoves = useMemo(
    () => moves
      .filter((m) => (typeFilter === "all" || m.type === typeFilter)
        && (!dateFrom || m.date >= dateFrom) && (!dateTo || m.date <= dateTo)
        && (!q || (itemById.get(m.itemId)?.name ?? "").toLowerCase().includes(q) || m.roomNumber.toLowerCase().includes(q) || m.note.toLowerCase().includes(q)))
      .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)),
    [moves, typeFilter, dateFrom, dateTo, q, itemById]
  );
  const inTotal = filteredMoves.filter((m) => m.type === "in").reduce((s, m) => s + m.quantity * m.unitPrice, 0);
  const outTotal = filteredMoves.filter((m) => m.type === "out").reduce((s, m) => s + m.quantity * m.unitPrice, 0);

  // สรุปค่าใช้จ่ายตามห้อง (เฉพาะรายการเบิกใช้ ตามช่วงวันที่ที่เลือก)
  const roomSummary = useMemo(() => {
    const map = new Map<string, { roomNumber: string; total: number; lines: RepairMovement[] }>();
    moves.filter((m) => m.type === "out" && (!dateFrom || m.date >= dateFrom) && (!dateTo || m.date <= dateTo)).forEach((m) => {
      const key = m.roomId || m.roomNumber;
      if (!map.has(key)) map.set(key, { roomNumber: m.roomNumber, total: 0, lines: [] });
      const g = map.get(key)!;
      g.total += m.quantity * m.unitPrice;
      g.lines.push(m);
    });
    return [...map.values()].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  }, [moves, dateFrom, dateTo]);

  const dateFilters = (
    <>
      <div style={{ width: 170 }}><ThaiDatePicker value={dateFrom} onChange={setDateFrom} placeholder="ตั้งแต่วันที่" /></div>
      <div style={{ width: 170 }}><ThaiDatePicker value={dateTo} onChange={setDateTo} placeholder="ถึงวันที่" /></div>
      {(dateFrom || dateTo) && <button className="btn btn-outline-secondary" onClick={() => { setDateFrom(""); setDateTo(""); }}>ล้างวันที่</button>}
    </>
  );

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}><i className="fas fa-screwdriver-wrench me-2 text-primary" />ซ่อมแซม</h5>
        <div className="d-flex gap-2 flex-wrap">
          <button className="btn btn-outline-primary d-inline-flex align-items-center" onClick={() => setItemModal({ item: null })}>
            <i className="fas fa-box me-2" /><span className="btn-text">เพิ่มของใหม่</span>
          </button>
          <button className="btn btn-success d-inline-flex align-items-center" onClick={() => setMoveModal({ type: "in" })} disabled={items.length === 0}>
            <i className="fas fa-plus me-2" /><span className="btn-text">เติมของ</span>
          </button>
          <button className="btn btn-danger d-inline-flex align-items-center" onClick={() => setMoveModal({ type: "out" })} disabled={items.length === 0}>
            <i className="fas fa-arrow-right-from-bracket me-2" /><span className="btn-text">เบิกใช้</span>
          </button>
        </div>
      </div>

      <div className="row g-2 mb-3">
        {[
          { label: "รายการของทั้งหมด", value: String(items.length), color: "var(--color-primary)" },
          { label: "ใกล้หมด / หมด", value: String(lowStockCount), color: lowStockCount > 0 ? "var(--color-danger)" : "var(--color-success)" },
          { label: "มูลค่าของคงคลัง (ราคารับเข้าล่าสุด)", value: `${money(stockValue)} ฿`, color: "var(--color-dark)" },
        ].map((c) => (
          <div key={c.label} className="col-12 col-md-4">
            <div className="p-3" style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)", textAlign: "center" }}>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: c.color }}>{c.value}</div>
              <div className="text-muted small">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="d-flex gap-2 mb-3 flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} className={`btn ${tab === t.key ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTab(t.key)}>
            <i className={`fas ${t.icon} me-2`} />{t.label}
          </button>
        ))}
      </div>

      {tab !== "rooms" && (
        <div className="d-flex gap-2 mb-3 flex-wrap align-items-center">
          <div className="search-box flex-grow-1" style={{ minWidth: 220, position: "relative" }}>
            <i className="fas fa-search" />
            <input className="form-control" style={{ paddingLeft: 40 }} placeholder={tab === "stock" ? "ค้นหาชื่อของ..." : "ค้นหาของ / ห้อง / หมายเหตุ..."}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {tab === "history" && (
            <>
              <div className="btn-group">
                {([["all", "ทั้งหมด"], ["in", "เติมของ"], ["out", "เบิกใช้"]] as const).map(([k, l]) => (
                  <button key={k} className={`btn ${typeFilter === k ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTypeFilter(k)}>{l}</button>
                ))}
              </div>
              {dateFilters}
            </>
          )}
        </div>
      )}
      {tab === "rooms" && <div className="d-flex gap-2 mb-3 flex-wrap align-items-center">{dateFilters}</div>}

      {loading ? (
        <div className="text-center text-muted py-5"><span className="spinner-border spinner-border-sm me-2" />กำลังโหลด...</div>
      ) : tab === "stock" ? (
        filteredItems.length === 0 ? (
          <EmptyState icon="fa-boxes-stacked" text={items.length === 0 ? "ยังไม่มีของในคลัง กด \"เพิ่มของใหม่\" เพื่อเริ่มต้น" : "ไม่พบของที่ค้นหา"} />
        ) : (
          <div className="nicescrollbar" style={{ overflow: "auto" }}>
            <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 720 }}>
              <thead>
                <tr>
                  <th>ชื่อของ</th><th className="text-end">คงเหลือ</th><th>หน่วย</th>
                  <th className="text-end">ราคาล่าสุด/หน่วย</th><th className="text-end">มูลค่าคงเหลือ</th><th className="text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((i) => {
                  const low = i.minStock > 0 && i.stock <= i.minStock;
                  return (
                    <tr key={i.id}>
                      <td className="fw-bold">{i.name}{i.note && <div className="text-muted small fw-normal">{i.note}</div>}</td>
                      <td className="text-end">
                        <span className={`status-badge ${i.stock <= 0 ? "status-overdue" : low ? "status-unpaid" : "status-paid"}`}>{qtyFmt(i.stock)}</span>
                      </td>
                      <td>{i.unit}</td>
                      <td className="text-end">{i.lastPrice > 0 ? money(i.lastPrice) : "-"}</td>
                      <td className="text-end">{i.lastPrice > 0 ? money(i.stock * i.lastPrice) : "-"}</td>
                      <td className="text-center">
                        <div className="btn-group">
                          <button className="btn btn-sm btn-outline-success" title="เติมของ" onClick={() => setMoveModal({ type: "in", itemId: i.id })}><i className="fas fa-plus" /></button>
                          <button className="btn btn-sm btn-outline-danger" title="เบิกใช้" disabled={i.stock <= 0} onClick={() => setMoveModal({ type: "out", itemId: i.id })}><i className="fas fa-arrow-right-from-bracket" /></button>
                          <button className="btn btn-sm btn-outline-secondary" title="แก้ไข" onClick={() => setItemModal({ item: i })}><i className="fas fa-pen" /></button>
                          <button className="btn btn-sm btn-outline-secondary" title="ลบ" onClick={() => setDelItem(i)}><i className="fas fa-trash-alt" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : tab === "history" ? (
        filteredMoves.length === 0 ? (
          <EmptyState icon="fa-clock-rotate-left" text="ไม่มีประวัติตามเงื่อนไขที่เลือก" />
        ) : (
          <>
            <div className="nicescrollbar" style={{ overflow: "auto" }}>
              <table className="table-mainstyle table-hover" style={{ width: "100%", minWidth: 860 }}>
                <thead>
                  <tr>
                    <th>วันที่</th><th>ประเภท</th><th>ของ</th><th className="text-end">จำนวน</th>
                    <th className="text-end">ราคา/หน่วย</th><th className="text-end">รวม</th><th>ห้อง</th><th>หมายเหตุ</th><th>บันทึกโดย</th><th />
                  </tr>
                </thead>
                <tbody>
                  {filteredMoves.map((m) => {
                    const it = itemById.get(m.itemId);
                    return (
                      <tr key={m.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{dateLabel(m.date)}</td>
                        <td><span className={`status-badge ${m.type === "out" ? "status-overdue" : "status-paid"}`}>{m.type === "out" ? "เบิกใช้" : "เติมของ"}</span></td>
                        <td className="fw-bold">{it?.name ?? "(ของถูกลบ)"}</td>
                        <td className="text-end">{qtyFmt(m.quantity)} {it?.unit}</td>
                        <td className="text-end">{money(m.unitPrice)}</td>
                        <td className="text-end fw-bold">{money(m.quantity * m.unitPrice)}</td>
                        <td>{m.type === "out" ? `ห้อง ${m.roomNumber}` : "-"}</td>
                        <td className="text-muted small">{m.note || "-"}</td>
                        <td className="text-muted small">{m.createdBy || "-"}</td>
                        <td><button className="btn btn-sm btn-outline-secondary" title="ยกเลิกรายการ" onClick={() => setDelMove(m)}><i className="fas fa-trash-alt" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="d-flex justify-content-end gap-4 mt-3 flex-wrap">
              <span>ซื้อเข้า (เติมของ): <strong className="text-success">{money(inTotal)} ฿</strong></span>
              <span>เบิกใช้: <strong className="text-danger">{money(outTotal)} ฿</strong></span>
            </div>
          </>
        )
      ) : roomSummary.length === 0 ? (
        <EmptyState icon="fa-door-open" text="ยังไม่มีการเบิกของไปใช้กับห้อง" />
      ) : (
        <>
          {roomSummary.map((g) => (
            <div key={g.roomNumber} className="mb-3 p-3" style={{ border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)" }}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <strong><i className="fas fa-door-open me-2 text-primary" />ห้อง {g.roomNumber}</strong>
                <strong className="text-danger">{money(g.total)} ฿</strong>
              </div>
              {g.lines.sort((a, b) => b.date.localeCompare(a.date)).map((m) => (
                <div key={m.id} className="d-flex justify-content-between small py-1" style={{ borderTop: "1px solid var(--color-light)" }}>
                  <span>{dateLabel(m.date)} · {itemById.get(m.itemId)?.name ?? "(ของถูกลบ)"} × {qtyFmt(m.quantity)} {itemById.get(m.itemId)?.unit}{m.note ? ` — ${m.note}` : ""}</span>
                  <span>{money(m.quantity * m.unitPrice)} ฿</span>
                </div>
              ))}
            </div>
          ))}
          <div className="text-end">รวมทุกห้อง: <strong className="text-danger">{money(roomSummary.reduce((s, g) => s + g.total, 0))} ฿</strong></div>
        </>
      )}

      {itemModal && <ItemModal item={itemModal.item} onClose={() => setItemModal(null)} onSaved={() => { setItemModal(null); load(); }} />}
      {moveModal && (
        <MovementModal type={moveModal.type} items={items} rooms={rooms} presetItemId={moveModal.itemId}
          onClose={() => setMoveModal(null)} onSaved={() => { setMoveModal(null); load(); }} />
      )}
      {delItem && (
        <ConfirmDelete text={<>ลบ <strong>{delItem.name}</strong> ออกจากคลังใช่หรือไม่?</>}
          onCancel={() => setDelItem(null)}
          onConfirm={async () => {
            try { await repairsApi.deleteItem(delItem.id); toastSuccess("ลบแล้ว"); setDelItem(null); load(); }
            catch (e) { toastError(errMsg(e)); setDelItem(null); }
          }} />
      )}
      {delMove && (
        <ConfirmDelete text={<>ยกเลิกรายการ{delMove.type === "out" ? "เบิกใช้" : "เติมของ"} <strong>{itemById.get(delMove.itemId)?.name}</strong> × {qtyFmt(delMove.quantity)} ใช่หรือไม่? ยอดคงเหลือจะถูกปรับกลับให้</>}
          onCancel={() => setDelMove(null)}
          onConfirm={async () => {
            try { await repairsApi.deleteMovement(delMove.id); toastSuccess("ยกเลิกรายการแล้ว"); setDelMove(null); load(); }
            catch (e) { toastError(errMsg(e)); setDelMove(null); }
          }} />
      )}
    </div>
  );
}
