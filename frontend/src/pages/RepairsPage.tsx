import { useEffect, useMemo, useState } from "react";
import { repairsApi, roomsApi, type RepairItem, type RepairMovement } from "../api/client";
import { useBreadcrumb } from "../context/BreadcrumbContext";
import CustomSelect2 from "../components/CustomSelect2";
import ThaiDatePicker from "../components/ThaiDatePicker";
import EmptyState from "../components/EmptyState";
import DataTable, { type DataCol } from "../components/DataTable";
import { usePersistedViewMode } from "../utils/usePersistedViewMode";
import ToolbarActionsMenu from "../components/ToolbarActionsMenu";
import { useLiveRefreshTick } from "../utils/useLiveSync";
import { thaiDateOnlyString } from "../utils/yearFormat";
import { toastSuccess, toastError } from "../utils/toast";

type Tab = "stock" | "history" | "rooms";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "stock", label: "คลังของ", icon: "fa-boxes-stacked" },
  { key: "history", label: "ประวัติรับเข้า/เบิกใช้", icon: "fa-clock-rotate-left" },
  { key: "rooms", label: "สรุปค่าใช้จ่ายตามห้อง", icon: "fa-door-open" },
];

const STOCK_COLS: DataCol[] = [
  { key: "checkbox", header: "checkbox", visible: true, pinnable: true, pin: "left", thClass: "text-center checkbox-cell", tdClass: "text-center checkbox-cell" },
  { key: "name", header: "ชื่อของ", visible: true, pinnable: true, pin: false },
  { key: "stock", header: "คงเหลือ", visible: true, pinnable: true, pin: false, thClass: "text-end", tdClass: "text-end" },
  { key: "unit", header: "หน่วย", visible: false, pinnable: true, pin: false },
  { key: "price", header: "ราคาล่าสุด/หน่วย", visible: true, pinnable: true, pin: false, thClass: "text-end", tdClass: "text-end" },
  { key: "value", header: "มูลค่าคงเหลือ", visible: true, pinnable: true, pin: false, thClass: "text-end", tdClass: "text-end" },
  { key: "actions", header: "จัดการ", visible: true, pinnable: true, pin: "right", thClass: "text-center action-cell", tdClass: "text-center action-cell" },
];
const STOCK_WIDTHS = { checkbox: 40, name: 220, stock: 130, unit: 90, price: 150, value: 150, actions: 170 };
const MOVE_COLS: DataCol[] = [
  { key: "checkbox", header: "checkbox", visible: true, pinnable: true, pin: "left", thClass: "text-center checkbox-cell", tdClass: "text-center checkbox-cell" },
  { key: "date", header: "วันที่", visible: true, pinnable: true, pin: false },
  { key: "type", header: "ประเภท", visible: true, pinnable: true, pin: false },
  { key: "item", header: "ของ", visible: true, pinnable: true, pin: false },
  { key: "qty", header: "จำนวน", visible: true, pinnable: true, pin: false, thClass: "text-end", tdClass: "text-end" },
  { key: "price", header: "ราคา/หน่วย", visible: true, pinnable: true, pin: false, thClass: "text-end", tdClass: "text-end" },
  { key: "total", header: "รวม", visible: true, pinnable: true, pin: false, thClass: "text-end", tdClass: "text-end" },
  { key: "room", header: "ห้อง", visible: true, pinnable: true, pin: false, thClass: "text-center", tdClass: "text-center" },
  { key: "note", header: "หมายเหตุ", visible: true, pinnable: true, pin: false },
  { key: "by", header: "บันทึกโดย", visible: false, pinnable: true, pin: false },
  { key: "actions", header: "จัดการ", visible: true, pinnable: true, pin: "right", thClass: "text-center action-cell", tdClass: "text-center action-cell" },
];
const MOVE_WIDTHS = { checkbox: 40, date: 110, type: 100, item: 180, qty: 110, price: 110, total: 110, room: 90, note: 180, by: 110, actions: 90 };

const TAB_OPTIONS = TABS.map((t) => ({ value: t.key, label: t.label }));
const TYPE_OPTIONS = [
  { value: "all", label: "ทุกประเภท" },
  { value: "in", label: "เติมของ" },
  { value: "out", label: "เบิกใช้" },
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
  const [delItems, setDelItems] = useState<RepairItem[] | null>(null);
  const [delMoves, setDelMoves] = useState<RepairMovement[] | null>(null);
  const [view, setView] = usePersistedViewMode<"list" | "grid" | "table">("repairs", "table", ["list", "grid", "table"]);
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

  const roomSummaryFiltered = useMemo(
    () => roomSummary.filter((g) => !q || g.roomNumber.toLowerCase().includes(q) || g.lines.some((m) => (itemById.get(m.itemId)?.name ?? "").toLowerCase().includes(q) || m.note.toLowerCase().includes(q))),
    [roomSummary, q, itemById]
  );

  const dateFilters = (
    <>
      <div style={{ width: 170 }}><ThaiDatePicker value={dateFrom} onChange={setDateFrom} placeholder="ตั้งแต่วันที่" /></div>
      <div style={{ width: 170 }}><ThaiDatePicker value={dateTo} onChange={setDateTo} placeholder="ถึงวันที่" /></div>
      {(dateFrom || dateTo) && <button className="btn btn-outline-secondary" onClick={() => { setDateFrom(""); setDateTo(""); }}>ล้างวันที่</button>}
    </>
  );

  // ── ฟังก์ชันลบ (ลบทีละรายการหรือหลายรายการ) ──
  async function runDelete(kind: "item" | "move", list: { id: string }[]) {
    let ok = 0; let lastErr = "";
    for (const x of list) {
      try { kind === "item" ? await repairsApi.deleteItem(x.id) : await repairsApi.deleteMovement(x.id); ok++; }
      catch (e) { lastErr = errMsg(e); }
    }
    if (ok > 0) toastSuccess(kind === "item" ? `ลบแล้ว ${ok} รายการ` : `ยกเลิกแล้ว ${ok} รายการ`);
    if (lastErr) toastError(lastErr);
    setDelItems(null); setDelMoves(null); load();
  }

  const showViewSwitch = tab !== "rooms";
  const itemName = (id: string) => itemById.get(id)?.name ?? "(ของถูกลบ)";
  const itemUnit = (id: string) => itemById.get(id)?.unit ?? "";

  const itemActions = (i: RepairItem) => (
    <div className="btn-group" role="group">
      <button type="button" className="btn btn-sm btn-success" title="เติมของ" onClick={(e) => { e.stopPropagation(); setMoveModal({ type: "in", itemId: i.id }); }}><i className="fas fa-plus" /></button>
      <button type="button" className="btn btn-sm btn-danger" title="เบิกใช้" disabled={i.stock <= 0} onClick={(e) => { e.stopPropagation(); setMoveModal({ type: "out", itemId: i.id }); }}><i className="fas fa-arrow-right-from-bracket" /></button>
      <button type="button" className="btn btn-sm btn-warning" title="แก้ไข" onClick={(e) => { e.stopPropagation(); setItemModal({ item: i }); }}><i className="fas fa-edit" /></button>
      <button type="button" className="btn btn-sm btn-outline-danger" title="ลบ" onClick={(e) => { e.stopPropagation(); setDelItems([i]); }}><i className="fas fa-trash-alt" /></button>
    </div>
  );
  const stockBadge = (i: RepairItem) => {
    const low = i.minStock > 0 && i.stock <= i.minStock;
    return <span className={`status-badge ${i.stock <= 0 ? "status-overdue" : low ? "status-unpaid" : "status-paid"}`}>{qtyFmt(i.stock)} {i.unit}</span>;
  };
  const typeBadge = (m: RepairMovement) => (
    <span className={`status-badge ${m.type === "out" ? "status-overdue" : "status-paid"}`}>{m.type === "out" ? "เบิกใช้" : "เติมของ"}</span>
  );
  const moveDeleteBtn = (m: RepairMovement) => (
    <button type="button" className="btn btn-sm btn-danger" title="ยกเลิกรายการ" onClick={(e) => { e.stopPropagation(); setDelMoves([m]); }}>
      <i className="fas fa-trash-alt" />
    </button>
  );

  function renderStockCell(col: DataCol, i: RepairItem) {
    switch (col.key) {
      case "name": return <span className="fw-bold">{i.name}{i.note && <div className="text-muted small fw-normal">{i.note}</div>}</span>;
      case "stock": return stockBadge(i);
      case "unit": return i.unit;
      case "price": return i.lastPrice > 0 ? money(i.lastPrice) : "-";
      case "value": return i.lastPrice > 0 ? money(i.stock * i.lastPrice) : "-";
      case "actions": return itemActions(i);
      default: return "-";
    }
  }
  function renderMoveCell(col: DataCol, m: RepairMovement) {
    switch (col.key) {
      case "date": return <span style={{ whiteSpace: "nowrap" }}>{dateLabel(m.date)}</span>;
      case "type": return typeBadge(m);
      case "item": return <span className="fw-bold">{itemName(m.itemId)}</span>;
      case "qty": return `${qtyFmt(m.quantity)} ${itemUnit(m.itemId)}`;
      case "price": return money(m.unitPrice);
      case "total": return <span className="fw-bold">{money(m.quantity * m.unitPrice)}</span>;
      case "room": return m.type === "out" ? `ห้อง ${m.roomNumber}` : "-";
      case "note": return <span className="text-muted small">{m.note || "-"}</span>;
      case "by": return <span className="text-muted small">{m.createdBy || "-"}</span>;
      case "actions": return moveDeleteBtn(m);
      default: return "-";
    }
  }

  const stockEmptyText = items.length === 0 ? "ยังไม่มีของในคลัง กด \"เพิ่มของใหม่\" เพื่อเริ่มต้น" : "ไม่พบของที่ค้นหา";

  return (
    <div className="custom-card">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-3 page-list-toolbar">
        <h5 className="form-section-title mb-0" style={{ borderBottom: "none" }}>รายการซ่อมแซม</h5>
        <ToolbarActionsMenu>
          <button className="btn btn-primary d-inline-flex align-items-center" onClick={() => setItemModal({ item: null })}>
            <i className="fas fa-box me-2" /><span className="btn-text">เพิ่มของใหม่</span>
          </button>
          <button className="btn btn-success d-inline-flex align-items-center" onClick={() => setMoveModal({ type: "in" })} disabled={items.length === 0}>
            <i className="fas fa-plus me-2" /><span className="btn-text">เติมของ</span>
          </button>
          <button className="btn btn-danger d-inline-flex align-items-center" onClick={() => setMoveModal({ type: "out" })} disabled={items.length === 0}>
            <i className="fas fa-arrow-right-from-bracket me-2" /><span className="btn-text">เบิกใช้</span>
          </button>
        </ToolbarActionsMenu>
      </div>

      {!loading && (
        <div className="row g-3 mb-4">
          {[
            { icon: "fa-boxes-stacked text-primary", label: "รายการของทั้งหมด", val: `${items.length} รายการ` },
            { icon: `fa-triangle-exclamation ${lowStockCount > 0 ? "text-danger" : "text-success"}`, label: "ใกล้หมด / หมด", val: `${lowStockCount} รายการ` },
            { icon: "fa-coins text-warning", label: "มูลค่าของคงคลัง", val: `${money(stockValue)} ฿` },
          ].map(({ icon, label, val }) => (
            <div key={label} className="col-6 col-md-4">
              <div className="detail-item">
                <i className={`fas ${icon}`} />
                <div>
                  <div className="label">{label}</div>
                  <div className="value">{val}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ค้นหา → หมวด → ตัวกรอง → โหมดแสดงผล */}
      <div className="row g-2 mb-3 align-items-center">
        <div className="col-12 col-lg">
          <div className="search-container">
            <i className="fas fa-search" />
            <input className="form-control" style={{ paddingLeft: 40 }}
              placeholder={tab === "stock" ? "ค้นหาชื่อของ..." : "ค้นหาของ / ห้อง / หมายเหตุ..."}
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="col-12 col-md-auto" style={{ minWidth: 250 }}>
          <CustomSelect2 value={TAB_OPTIONS.find((o) => o.value === tab)} options={TAB_OPTIONS}
            onChange={(o: any) => setTab((o?.value ?? "stock") as Tab)} isSearchable={false} />
        </div>
        {tab === "history" && (
          <div className="col-12 col-md-auto" style={{ minWidth: 160 }}>
            <CustomSelect2 value={TYPE_OPTIONS.find((o) => o.value === typeFilter)} options={TYPE_OPTIONS}
              onChange={(o: any) => setTypeFilter(o?.value ?? "all")} isSearchable={false} />
          </div>
        )}
        {tab !== "stock" && <div className="col-12 col-md-auto d-flex gap-2 align-items-center flex-wrap">{dateFilters}</div>}
        {showViewSwitch && (
          <div className="col-12 col-md-auto">
            <div className="btn-group view-switch-group" role="group">
              <button type="button" className={`btn btn-outline-secondary${view === "list" ? " active" : ""}`} title="List View" onClick={() => setView("list")}><i className="fas fa-list" /></button>
              <button type="button" className={`btn btn-outline-secondary${view === "grid" ? " active" : ""}`} title="Grid View" onClick={() => setView("grid")}><i className="fas fa-th-large" /></button>
              <button type="button" className={`btn btn-outline-secondary${view === "table" ? " active" : ""}`} title="Table View" onClick={() => setView("table")}><i className="fas fa-table" /></button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center p-5"><div className="spinner-border" style={{ color: "var(--color-primary)" }} /></div>
      ) : tab === "stock" ? (
        view === "table" ? (
          <DataTable<RepairItem> storageKey="repair-stock" defaultCols={STOCK_COLS} defaultWidths={STOCK_WIDTHS}
            rows={filteredItems} rowKey={(i) => i.id} renderCell={renderStockCell} isFiltered={!!q}
            emptyIcon="fa-boxes-stacked" emptyText={stockEmptyText}
            onBulkDelete={(rs) => setDelItems(rs)} minWidth={720} />
        ) : filteredItems.length === 0 ? (
          <EmptyState icon="fa-boxes-stacked" text={stockEmptyText} />
        ) : view === "grid" ? (
          <div className="nicescrollbar" style={{ maxHeight: 650, overflow: "auto" }}>
            <div className="room-grid">
              {filteredItems.map((i) => (
                <div key={i.id} className="room-card">
                  <div className="room-card-header">
                    <h5 className="text-truncate mb-0" style={{ fontSize: "0.95rem" }} title={i.name}><i className="fas fa-box me-2 text-primary" />{i.name}</h5>
                    {stockBadge(i)}
                  </div>
                  <div className="room-card-body">
                    <div className="room-card-info-grid">
                      <div className="room-card-info-item"><span className="label">ราคาล่าสุด/หน่วย</span><span className="value">{i.lastPrice > 0 ? money(i.lastPrice) : "-"}</span></div>
                      <div className="room-card-info-item"><span className="label">มูลค่าคงเหลือ</span><span className="value">{i.lastPrice > 0 ? money(i.stock * i.lastPrice) : "-"}</span></div>
                    </div>
                    {i.note && <div className="text-muted small mt-2">{i.note}</div>}
                    <div className="mt-3 text-end">{itemActions(i)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="nicescrollbar" style={{ maxHeight: 650, overflow: "auto" }}>
            {filteredItems.map((i) => (
              <div key={i.id} className="d-flex align-items-center gap-3 p-3" style={{ borderBottom: "1px solid var(--color-light)" }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--color-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <i className="fas fa-box" style={{ color: "var(--color-info-dark)" }} />
                </div>
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="fw-bold">{i.name}</span>{stockBadge(i)}
                  </div>
                  <small className="text-muted">ราคาล่าสุด {i.lastPrice > 0 ? `${money(i.lastPrice)} ฿/${i.unit}` : "-"} · มูลค่า {i.lastPrice > 0 ? `${money(i.stock * i.lastPrice)} ฿` : "-"}{i.note ? ` · ${i.note}` : ""}</small>
                </div>
                {itemActions(i)}
              </div>
            ))}
          </div>
        )
      ) : tab === "history" ? (
        <>
          {view === "table" ? (
            <DataTable<RepairMovement> storageKey="repair-history" defaultCols={MOVE_COLS} defaultWidths={MOVE_WIDTHS}
              rows={filteredMoves} rowKey={(m) => m.id} renderCell={renderMoveCell} isFiltered={!!q || typeFilter !== "all" || !!dateFrom || !!dateTo}
              emptyIcon="fa-clock-rotate-left" emptyText="ไม่มีประวัติตามเงื่อนไขที่เลือก"
              onBulkDelete={(rs) => setDelMoves(rs)} bulkLabel="ยกเลิกรายการที่เลือก" minWidth={860} />
          ) : filteredMoves.length === 0 ? (
            <EmptyState icon="fa-clock-rotate-left" text="ไม่มีประวัติตามเงื่อนไขที่เลือก" />
          ) : view === "grid" ? (
            <div className="nicescrollbar" style={{ maxHeight: 650, overflow: "auto" }}>
              <div className="room-grid">
                {filteredMoves.map((m) => (
                  <div key={m.id} className="room-card">
                    <div className="room-card-header">
                      <h5 className="text-truncate mb-0" style={{ fontSize: "0.95rem" }} title={itemName(m.itemId)}>{itemName(m.itemId)}</h5>
                      {typeBadge(m)}
                    </div>
                    <div className="room-card-body">
                      <div className="room-card-info-grid">
                        <div className="room-card-info-item"><span className="label">วันที่</span><span className="value">{dateLabel(m.date)}</span></div>
                        <div className="room-card-info-item"><span className="label">จำนวน</span><span className="value">{qtyFmt(m.quantity)} {itemUnit(m.itemId)}</span></div>
                        <div className="room-card-info-item"><span className="label">ราคา/หน่วย</span><span className="value">{money(m.unitPrice)}</span></div>
                        <div className="room-card-info-item"><span className="label">รวม</span><span className="value">{money(m.quantity * m.unitPrice)}</span></div>
                      </div>
                      {(m.type === "out" || m.note) && (
                        <div className="room-card-tenant-info">
                          {m.type === "out" && <p><i className="fas fa-door-open" />ห้อง {m.roomNumber}</p>}
                          {m.note && <p><i className="fas fa-comment" />{m.note}</p>}
                        </div>
                      )}
                      <div className="mt-3 d-flex justify-content-between align-items-center">
                        <small className="text-muted">{m.createdBy || ""}</small>
                        {moveDeleteBtn(m)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="nicescrollbar" style={{ maxHeight: 650, overflow: "auto" }}>
              {filteredMoves.map((m) => (
                <div key={m.id} className="d-flex align-items-center gap-3 p-3" style={{ borderBottom: "1px solid var(--color-light)" }}>
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      {typeBadge(m)}<span className="fw-bold">{itemName(m.itemId)} × {qtyFmt(m.quantity)} {itemUnit(m.itemId)}</span>
                      {m.type === "out" && <small className="text-muted"><i className="fas fa-door-open me-1" />ห้อง {m.roomNumber}</small>}
                    </div>
                    <small className="text-muted">{dateLabel(m.date)} · {money(m.unitPrice)} ฿/หน่วย{m.note ? ` · ${m.note}` : ""}{m.createdBy ? ` · ${m.createdBy}` : ""}</small>
                  </div>
                  <strong>{money(m.quantity * m.unitPrice)} ฿</strong>
                  {moveDeleteBtn(m)}
                </div>
              ))}
            </div>
          )}
          {filteredMoves.length > 0 && (
            <div className="d-flex justify-content-end gap-4 mt-3 flex-wrap">
              <span>ซื้อเข้า (เติมของ): <strong className="text-success">{money(inTotal)} ฿</strong></span>
              <span>เบิกใช้: <strong className="text-danger">{money(outTotal)} ฿</strong></span>
            </div>
          )}
        </>
      ) : roomSummaryFiltered.length === 0 ? (
        <EmptyState icon="fa-door-open" text="ยังไม่มีการเบิกของไปใช้กับห้อง" />
      ) : (
        <>
          {roomSummaryFiltered.map((g) => (
            <div key={g.roomNumber} className="mb-3 p-3" style={{ border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)" }}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <strong><i className="fas fa-door-open me-2 text-primary" />ห้อง {g.roomNumber}</strong>
                <strong className="text-danger">{money(g.total)} ฿</strong>
              </div>
              {[...g.lines].sort((a, b) => b.date.localeCompare(a.date)).map((m) => (
                <div key={m.id} className="d-flex justify-content-between small py-1" style={{ borderTop: "1px solid var(--color-light)" }}>
                  <span>{dateLabel(m.date)} · {itemName(m.itemId)} × {qtyFmt(m.quantity)} {itemUnit(m.itemId)}{m.note ? ` — ${m.note}` : ""}</span>
                  <span>{money(m.quantity * m.unitPrice)} ฿</span>
                </div>
              ))}
            </div>
          ))}
          <div className="text-end">รวมทุกห้อง: <strong className="text-danger">{money(roomSummaryFiltered.reduce((s, g) => s + g.total, 0))} ฿</strong></div>
        </>
      )}

      {itemModal && <ItemModal item={itemModal.item} onClose={() => setItemModal(null)} onSaved={() => { setItemModal(null); load(); }} />}
      {moveModal && (
        <MovementModal type={moveModal.type} items={items} rooms={rooms} presetItemId={moveModal.itemId}
          onClose={() => setMoveModal(null)} onSaved={() => { setMoveModal(null); load(); }} />
      )}
      {delItems && (
        <ConfirmDelete text={delItems.length === 1 ? <>ลบ <strong>{delItems[0].name}</strong> ออกจากคลังใช่หรือไม่?</> : <>ลบของ <strong>{delItems.length} รายการ</strong> ที่เลือกใช่หรือไม่?</>}
          onCancel={() => setDelItems(null)} onConfirm={() => runDelete("item", delItems)} />
      )}
      {delMoves && (
        <ConfirmDelete text={delMoves.length === 1
            ? <>ยกเลิกรายการ{delMoves[0].type === "out" ? "เบิกใช้" : "เติมของ"} <strong>{itemName(delMoves[0].itemId)}</strong> × {qtyFmt(delMoves[0].quantity)} ใช่หรือไม่? ยอดคงเหลือจะถูกปรับกลับให้</> : <>ยกเลิก <strong>{delMoves.length} รายการ</strong> ที่เลือกใช่หรือไม่? ยอดคงเหลือจะถูกปรับกลับให้</>}
          onCancel={() => setDelMoves(null)} onConfirm={() => runDelete("move", delMoves)} />
      )}
    </div>
  );
}
