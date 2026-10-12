import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Select from "react-select";
import ColResizeHandle from "./ColResizeHandle";
import PinMenuPopup, { type PinMenuState, type PinDir } from "./PinMenuPopup";
import EmptyState from "./EmptyState";
import { useColumnWidths, useColumnVisibility, useRowOrder } from "../utils/useColumnWidths";

// ตารางมาตรฐานของเว็บ (แบบเดียวกับตารางหน้ายานพาหนะ): เลือกคอลัมน์ที่แสดง, ลากสลับคอลัมน์/แถว, ปรับความกว้าง,
// ปักหมุดซ้าย/ขวา, ติ๊กเลือกหลายแถว — จำค่าไว้ต่อผู้ใช้ตาม storageKey ใช้ซ้ำได้ทุกหน้า
export interface DataCol {
  key: string; header: string; visible: boolean;
  pinnable: boolean; pin: PinDir; thClass?: string; tdClass?: string;
}

export default function DataTable<T>({
  storageKey, defaultCols, defaultWidths, rows, rowKey, renderCell, isFiltered = false, sortKey,
  emptyIcon, emptyText, onBulkDelete, bulkLabel = "ลบรายการที่เลือก", minWidth = 600,
}: {
  storageKey: string; defaultCols: DataCol[]; defaultWidths: Record<string, number>;
  rows: T[]; rowKey: (r: T) => string; renderCell: (col: DataCol, row: T) => ReactNode;
  isFiltered?: boolean; sortKey?: string; emptyIcon: string; emptyText: string;
  onBulkDelete?: (rows: T[]) => void; bulkLabel?: string; minWidth?: number;
}) {
  const [cols, setCols, moveColumn] = useColumnVisibility(storageKey, defaultCols);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [pinMenu, setPinMenu] = useState<PinMenuState | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const { widths, startResize } = useColumnWidths(storageKey, defaultWidths);
  const { ordered: rowOrdered, moveRow, resetRowOrder } = useRowOrder(storageKey, rows, rowKey, isFiltered);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [draggingColKey, setDraggingColKey] = useState<string | null>(null);
  const [dropTargetColKey, setDropTargetColKey] = useState<string | null>(null);
  const prevSortKeyRef = useRef(sortKey);
  useEffect(() => {
    if (prevSortKeyRef.current !== sortKey) { resetRowOrder(); prevSortKeyRef.current = sortKey; }
  }, [sortKey]);

  // ล้างแถวที่ถูกเลือกไว้แต่ไม่อยู่ในข้อมูลแล้ว (เช่นถูกลบ/กรองออก)
  useEffect(() => {
    setSelectedRows((prev) => {
      const keys = new Set(rows.map(rowKey));
      const next = new Set([...prev].filter((k) => keys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const allSelected = rows.length > 0 && selectedRows.size === rows.length;
  const someSelected = selectedRows.size > 0 && !allSelected;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected; }, [someSelected]);

  const visible = cols.filter((c) => c.visible);
  const ordered = [
    ...visible.filter((c) => c.pin === "left"),
    ...visible.filter((c) => !c.pin),
    ...visible.filter((c) => c.pin === "right"),
  ];

  useLayoutEffect(() => {
    const tbl = tableRef.current; if (!tbl) return;
    const ths = Array.from(tbl.querySelectorAll<HTMLElement>("thead tr th"));
    const trs = Array.from(tbl.querySelectorAll<HTMLTableRowElement>("tbody tr"))
      .map((tr) => Array.from(tr.querySelectorAll<HTMLElement>("td")));
    let lo = 0;
    ordered.forEach((col, i) => {
      if (col.pin !== "left") return;
      const th = ths[i]; if (!th) return;
      th.style.left = `${lo}px`;
      trs.forEach((r) => { if (r[i]) r[i].style.left = `${lo}px`; });
      lo += th.offsetWidth;
    });
    let ro = 0;
    [...ordered].reverse().forEach((col, ri) => {
      if (col.pin !== "right") return;
      const i = ordered.length - 1 - ri;
      const th = ths[i]; if (!th) return;
      th.style.right = `${ro}px`;
      trs.forEach((r) => { if (r[i]) r[i].style.right = `${ro}px`; });
      ro += th.offsetWidth;
    });
  });

  function openPinMenu(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPinMenu({ colKey: key, x: Math.max(0, r.right - 160), y: r.bottom + 4 });
  }

  const toggleable = cols.filter((c) => c.key !== "actions" && c.key !== "checkbox");
  const colOptions = toggleable.map((c) => ({ value: c.key, label: c.header }));
  const colValue = toggleable.filter((c) => c.visible).map((c) => ({ value: c.key, label: c.header }));

  return (
    <div>
      <div className="mb-2">
        <Select isMulti options={colOptions} value={colValue}
          onChange={(sel) => {
            const keys = new Set((sel as any[]).map((s) => s.value));
            setCols((prev) => prev.map((c) => c.key === "actions" || c.key === "checkbox" ? c : { ...c, visible: keys.has(c.key) }));
          }}
          styles={{
            control: (b, s) => ({ ...b, backgroundColor: s.menuIsOpen || s.isFocused ? "var(--color-white)" : "var(--color-background)", border: `1px solid ${s.menuIsOpen || s.isFocused ? "var(--color-primary)" : "var(--color-light)"}`, borderRadius: "var(--border-radius-1)", boxShadow: s.menuIsOpen || s.isFocused ? "0 0 0 3px rgba(108,155,207,0.25)" : "none", minHeight: "38px", fontSize: "0.9rem", cursor: "pointer", "&:hover": { borderColor: "var(--color-primary)" } }),
            valueContainer: (b) => ({ ...b, padding: "0 0.75rem", flexWrap: "nowrap", overflow: "hidden" }),
            indicatorSeparator: () => ({ display: "none" }),
            dropdownIndicator: (b, s) => ({ ...b, color: s.isFocused ? "var(--color-primary)" : "var(--color-dark-variant)", padding: "0 8px" }),
            menu: (b) => ({ ...b, backgroundColor: "var(--color-white)", border: "1px solid var(--color-light)", borderRadius: "var(--border-radius-1)", boxShadow: "var(--box-shadow)", zIndex: 9999 }),
            menuList: (b) => ({ ...b, padding: "4px", maxHeight: "260px" }),
            option: (b, s) => ({ ...b, backgroundColor: s.isFocused ? "var(--color-light)" : "transparent", color: "var(--color-dark)", fontSize: "0.88rem", borderRadius: "var(--border-radius-1)", padding: "0.45rem 0.75rem", cursor: "pointer" }),
          }}
          components={{
            Option: ({ innerProps, isSelected, isFocused, label }: any) => (
              <div {...innerProps} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.45rem 0.75rem", cursor: "pointer", background: isFocused ? "var(--color-light)" : "transparent", borderRadius: "var(--border-radius-1)", fontSize: "0.88rem" }}>
                <input type="checkbox" className="form-check-input" checked={isSelected} readOnly style={{ flexShrink: 0 }} />
                <span className={isSelected ? "fw-bold" : ""}>{label}</span>
              </div>
            ),
            ValueContainer: ({ children, getValue, selectProps }: any) => {
              const count = getValue().length; const total = (selectProps.options as any[]).length;
              const input = Array.isArray(children) ? children[children.length - 1] : children;
              return (
                <div style={{ padding: "0 0.75rem", display: "flex", alignItems: "center" }}>
                  <span style={{ color: "var(--color-dark)", fontWeight: 500, fontSize: "0.9rem", whiteSpace: "nowrap" }}>
                    {count > 0 ? `แสดง ${count} / ${total} คอลัมน์` : "เลือกคอลัมน์ที่แสดง..."}
                  </span>
                  {input}
                </div>
              );
            },
            MultiValue: () => null,
          }}
          closeMenuOnSelect={false} hideSelectedOptions={false} isSearchable={false}
          noOptionsMessage={() => "ไม่พบข้อมูล"} placeholder="เลือกคอลัมน์ที่แสดง..."
        />
      </div>

      {onBulkDelete && selectedRows.size > 0 && (
        <div className="bulk-actions-bar mb-2" style={{ justifyContent: "space-between" }}>
          <span>เลือก <strong>{selectedRows.size}</strong> รายการ</span>
          <div className="d-flex gap-2">
            <button className="btn btn-danger btn-sm" onClick={() => onBulkDelete(rows.filter((r) => selectedRows.has(rowKey(r))))}>
              <i className="fas fa-trash-alt me-1" />{bulkLabel}
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedRows(new Set())}>
              <i className="fas fa-times me-1" />ยกเลิก
            </button>
          </div>
        </div>
      )}

      <div className="nicescrollbar" style={{ maxHeight: 560, overflow: "auto" }}>
        <table ref={tableRef} className="table-mainstyle table-hover table-resizable" style={{ minWidth }}>
          <thead>
            <tr>
              {ordered.map((col) => {
                const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                const canDragCol = col.key !== "checkbox";
                return (
                  <th key={col.key} className={`${col.thClass ?? ""} ${pc} ${draggingColKey === col.key ? "col-dragging" : ""} ${dropTargetColKey === col.key ? "col-drop-target" : ""}`}
                    style={{ width: widths[col.key] }}
                    draggable={canDragCol}
                    onDragStart={canDragCol ? (e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", col.key); setDraggingColKey(col.key); } : undefined}
                    onDragEnd={() => { setDraggingColKey(null); setDropTargetColKey(null); }}
                    onDragOver={canDragCol ? (e) => { e.preventDefault(); if (draggingColKey && draggingColKey !== col.key) setDropTargetColKey(col.key); } : undefined}
                    onDragLeave={() => setDropTargetColKey((k) => (k === col.key ? null : k))}
                    onDrop={canDragCol ? (e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveColumn(dragged, col.key); setDraggingColKey(null); setDropTargetColKey(null); } : undefined}>
                    {col.key === "checkbox"
                      ? <input ref={selectAllRef} type="checkbox" className="form-check-input" checked={allSelected}
                          onChange={(e) => setSelectedRows(e.target.checked ? new Set(rows.map(rowKey)) : new Set())} />
                      : col.header}
                    {col.pinnable && col.key !== "checkbox" && (
                      <i className={`fas fa-thumbtack pin-icon${col.pin === "left" ? " active-left" : col.pin === "right" ? " active-right" : ""}`}
                        title="ตัวเลือกการปักหมุด" onClick={(e) => openPinMenu(e, col.key)} />
                    )}
                    <ColResizeHandle onMouseDown={(e) => startResize(col.key, e)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowOrdered.map((row) => {
              const k = rowKey(row);
              return (
                <tr key={k}
                  className={`${draggingRowKey === k ? "row-dragging" : ""} ${dropTargetKey === k ? "row-drop-target" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); if (draggingRowKey && draggingRowKey !== k) setDropTargetKey(k); }}
                  onDragLeave={() => setDropTargetKey((x) => (x === k ? null : x))}
                  onDrop={(e) => { e.preventDefault(); const dragged = e.dataTransfer.getData("text/plain"); if (dragged) moveRow(dragged, k); setDraggingRowKey(null); setDropTargetKey(null); }}>
                  {ordered.map((col) => {
                    const pc = col.pin === "left" ? "pinned pinned-left" : col.pin === "right" ? "pinned pinned-right" : "";
                    return (
                      <td key={col.key} className={`${col.tdClass ?? ""} ${pc}`}>
                        {col.key === "checkbox" ? (
                          <>
                            <span className="row-drag-handle" draggable
                              onClick={(e) => e.stopPropagation()}
                              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", k); setDraggingRowKey(k); }}
                              onDragEnd={() => { setDraggingRowKey(null); setDropTargetKey(null); }}
                              title="ลากเพื่อสลับลำดับแถว">
                              <i className="fas fa-grip-vertical" />
                            </span>
                            <input type="checkbox" className="form-check-input row-checkbox" checked={selectedRows.has(k)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => setSelectedRows((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
                          </>
                        ) : renderCell(col, row)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={ordered.length}><EmptyState icon={emptyIcon} text={emptyText} compact /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pinMenu && <PinMenuPopup menu={pinMenu} cols={cols} onPin={(key, dir) => setCols((prev) => prev.map((c) => c.key === key ? { ...c, pin: dir } : c))} onClose={() => setPinMenu(null)} />}
    </div>
  );
}
