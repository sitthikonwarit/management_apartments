import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CONTRACT_VARIABLES, type ContractCustomVar } from "../utils/contractTemplate";
import { SHEET_CSS } from "./LeaseContract";

// ตัวแก้ไขสัญญาแบบ Google Docs: แก้ข้อความบนหน้า A4 ได้โดยตรง (ฟอนต์/ระยะ/เยื้องเหมือนตอนพิมพ์จริง) ตัวแปรเป็นชิปสีฟ้า
// (ไม่ต้องพิมพ์ {{...}}) ภายในยังเก็บเป็นข้อความแม่แบบเดิม (# หัวเรื่อง, > ชิดขวา, ~ ลายเซ็น, --- ขึ้นหน้าใหม่)

type Kind = "para" | "title" | "right" | "sign" | "signName" | "pagebreak";
interface Line { id: number; kind: Kind; text: string }

let uid = 1;
const nextId = () => uid++;

function parse(template: string): Line[] {
  return template.replace(/\r/g, "").split("\n").map((raw): Line => {
    const l = raw.trimEnd();
    if (l.trim() === "---") return { id: nextId(), kind: "pagebreak", text: "" };
    if (l.startsWith("~~ ")) return { id: nextId(), kind: "signName", text: l.slice(3) };
    if (l.startsWith("~ ")) return { id: nextId(), kind: "sign", text: l.slice(2) };
    if (l.startsWith("# ")) return { id: nextId(), kind: "title", text: l.slice(2) };
    if (l.startsWith("> ")) return { id: nextId(), kind: "right", text: l.slice(2) };
    return { id: nextId(), kind: "para", text: l };
  });
}
function serialize(lines: Line[]): string {
  return lines.map((l) => {
    if (l.kind === "pagebreak") return "---";
    if (!l.text.trim()) return "";
    const prefix = l.kind === "title" ? "# " : l.kind === "right" ? "> " : l.kind === "sign" ? "~ " : l.kind === "signName" ? "~~ " : "";
    return prefix + l.text;
  }).join("\n");
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ข้อความแม่แบบ → HTML ของย่อหน้า (ตัวแปรเป็นชิปที่แก้ข้อความข้างในไม่ได้)
function toHtml(text: string, labelOf: (k: string) => string): string {
  const re = /\{\{\s*([A-Za-z0-9_]+)(?:\s*\|\s*(\d+(?:\.\d+)?))?\s*\}\}/g;
  let out = ""; let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    out += `<span class="lc-chip" contenteditable="false" data-var="${m[1]}"${m[2] ? ` data-w="${m[2]}"` : ""}>${esc(labelOf(m[1]))}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
function readText(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += (n.textContent ?? "").replace(/ /g, " ");
    else if (n.nodeName === "BR") out += "";
    else if ((n as HTMLElement).dataset?.var) { const d = (n as HTMLElement).dataset; out += `{{${d.var}${d.w ? "|" + d.w : ""}}}`; }
    else out += readText(n as HTMLElement);
  });
  return out.replace(/\n/g, " ");
}

const EDITOR_CSS = `
.lc-editor .lc-edit { outline: none; min-height: 18.1pt; border-radius: 2px; cursor: text; }
.lc-editor .lc-edit:hover { background: rgba(26,115,232,.04); }
.lc-editor .lc-edit:focus { background: rgba(26,115,232,.07); }
.lc-editor .lease-sheet .lc-chip { background: #e8f0fe; border: 1px solid #c6dafc; border-radius: 6px; padding: 0 5px; margin: 0 1px; font-size: 13pt; line-height: 15pt;
  color: #1967d2 !important; -webkit-text-fill-color: #1967d2 !important; text-indent: 0; user-select: all; white-space: nowrap; }
.lc-editor .lc-pb { text-align: center; color: var(--color-dark-variant); font-family: sans-serif; font-size: 11px; margin: 6px 0; border-top: 1px dashed var(--color-dark-variant); padding-top: 2px; }
.lc-editor .lc-toolbar { position: sticky; top: 0; z-index: 5; background: var(--color-white); border: 1px solid var(--color-light); border-radius: 8px; padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
.lc-editor .lc-toolbar .btn { padding: 2px 9px; font-size: 0.82rem; }
`;

function EditablePara({ line, labelOf, onText, onKey, onFocus, onPaste }: {
  line: Line; labelOf: (k: string) => string; onText: (id: number, text: string) => void; onKey: (e: React.KeyboardEvent<HTMLElement>, id: number) => void;
  onFocus: (id: number) => void; onPaste: (e: React.ClipboardEvent<HTMLElement>) => void;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  // ตั้งเนื้อหาครั้งเดียวตอนสร้าง — หลังจากนั้นเบราว์เซอร์จัดการการพิมพ์เอง (ไม่เรนเดอร์ทับ ไม่กระโดดเคอร์เซอร์)
  useEffect(() => { if (ref.current) ref.current.innerHTML = toHtml(line.text, labelOf); }, []);
  const cls = line.kind === "title" ? "lc-title" : line.kind === "right" ? "lc-right" : line.kind === "sign" ? "lc-sign" : line.kind === "signName" ? "lc-signName" : "lc-para";
  return (
    <p ref={ref} className={`${cls} lc-edit`} contentEditable suppressContentEditableWarning spellCheck={false}
      data-line={line.id}
      onInput={(e) => onText(line.id, readText(e.currentTarget))}
      onKeyDown={(e) => onKey(e, line.id)} onFocus={() => onFocus(line.id)} onPaste={onPaste} />
  );
}

export interface ContractEditorHandle { insertVar: (key: string) => void }

const ContractEditor = forwardRef<ContractEditorHandle, { value: string; onChange: (v: string) => void; logoUrl?: string; fullPage?: boolean; customVars?: ContractCustomVar[] }>(
function ContractEditor({ value, onChange, logoUrl, fullPage, customVars = [] }, handleRef) {
  const allVars = useMemo(() => [...CONTRACT_VARIABLES, ...customVars.map((c) => ({ key: c.key, label: c.label }))], [customVars]);
  const labelOf = (key: string) => allVars.find((v) => v.key === key)?.label ?? key;
  const [lines, setLines] = useState<Line[]>(() => parse(value));
  const [resetKey, setResetKey] = useState(0);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [varMenu, setVarMenu] = useState(false);
  const [varQuery, setVarQuery] = useState("");
  const lastOut = useRef(value);
  const savedRange = useRef<Range | null>(null);
  const focusAfter = useRef<{ id: number; end?: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // เปลี่ยนจากภายนอก (คืนค่าเริ่มต้น/แก้จากโหมดโค้ด) → อ่านใหม่
  useEffect(() => {
    if (value !== lastOut.current) { lastOut.current = value; setLines(parse(value)); setResetKey((k) => k + 1); }
  }, [value]);
  const emit = (next: Line[]) => { const s = serialize(next); lastOut.current = s; onChange(s); };
  const update = (fn: (l: Line[]) => Line[], remount = false) => {
    setLines((prev) => { const next = fn(prev); emit(next); return next; });
    if (remount) setResetKey((k) => k + 1);
  };

  // หลังแก้โครงสร้าง (เพิ่ม/ลบย่อหน้า) → โฟกัสย่อหน้าที่ต้องการ
  useEffect(() => {
    const f = focusAfter.current; if (!f) return;
    focusAfter.current = null;
    const el = root.current?.querySelector<HTMLElement>(`[data-line="${f.id}"]`);
    if (!el) return;
    el.focus();
    const sel = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(el); r.collapse(!f.end); sel?.removeAllRanges(); sel?.addRange(r);
  });

  const onText = (id: number, text: string) => setLines((prev) => { const next = prev.map((l) => (l.id === id ? { ...l, text } : l)); emit(next); return next; });
  const rememberRange = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && root.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange();
  };

  function onKey(e: React.KeyboardEvent<HTMLElement>, id: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      const idx = lines.findIndex((l) => l.id === id); const cur = lines[idx];
      const kind: Kind = cur.kind === "title" ? "para" : cur.kind === "sign" ? "signName" : cur.kind === "signName" ? "sign" : cur.kind;
      const nl: Line = { id: nextId(), kind, text: "" };
      focusAfter.current = { id: nl.id };
      update((p) => { const a = [...p]; a.splice(idx + 1, 0, nl); return a; });
    } else if (e.key === "Backspace" && !readText(e.currentTarget).trim() && lines.length > 1) {
      e.preventDefault();
      const idx = lines.findIndex((l) => l.id === id);
      const prevLine = lines[idx - 1] ?? lines[idx + 1];
      if (prevLine) focusAfter.current = { id: prevLine.id, end: idx > 0 };
      update((p) => p.filter((l) => l.id !== id), true);
    }
    setTimeout(rememberRange, 0);
  }
  const onPaste = (e: React.ClipboardEvent<HTMLElement>) => {
    e.preventDefault();
    const t = e.clipboardData.getData("text/plain").replace(/\r?\n/g, " ");
    document.execCommand("insertText", false, t);
  };

  const active = lines.find((l) => l.id === activeId) ?? null;
  const setKind = (kind: Kind) => {
    if (!active) return;
    update((p) => p.map((l) => (l.id === active.id ? { ...l, kind } : l)), true);
    focusAfter.current = { id: active.id, end: true };
  };
  const insertVar = (key: string) => {
    if (!active) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-line="${active.id}"]`); if (!el) return;
    const chip = document.createElement("span");
    chip.className = "lc-chip"; chip.contentEditable = "false"; chip.dataset.var = key; chip.textContent = labelOf(key);
    const r = savedRange.current && el.contains(savedRange.current.startContainer) ? savedRange.current : null;
    if (r) { r.deleteContents(); r.insertNode(chip); r.setStartAfter(chip); r.collapse(true); } else el.appendChild(chip);
    onText(active.id, readText(el));
    setVarMenu(false); setVarQuery("");
    el.focus();
    const sel = window.getSelection(); const nr = document.createRange(); nr.setStartAfter(chip); nr.collapse(true); sel?.removeAllRanges(); sel?.addRange(nr);
  };
  const addLine = (kind: Kind) => {
    const idx = active ? lines.findIndex((l) => l.id === active.id) : lines.length - 1;
    const nl: Line = { id: nextId(), kind, text: "" };
    if (kind !== "pagebreak") focusAfter.current = { id: nl.id };
    update((p) => { const a = [...p]; a.splice(idx + 1, 0, nl); return a; });
  };
  const removeLine = (id: number) => update((p) => (p.length > 1 ? p.filter((l) => l.id !== id) : p), true);

  useImperativeHandle(handleRef, () => ({ insertVar }));

  const vars = useMemo(() => allVars.filter((v) => !varQuery || v.label.includes(varQuery) || v.key.toLowerCase().includes(varQuery.toLowerCase())), [varQuery, allVars]);

  // แบ่งหน้าตามบรรทัดขึ้นหน้าใหม่
  const pages: Line[][] = [[]];
  lines.forEach((l) => { if (l.kind === "pagebreak") pages.push([]); else pages[pages.length - 1].push(l); });
  const pbIds = lines.filter((l) => l.kind === "pagebreak").map((l) => l.id);

  const kinds: [Kind, string][] = [["para", "ย่อหน้า"], ["title", "หัวเรื่อง (กลาง ตัวหนา)"], ["right", "ชิดขวา"], ["sign", "ลายเซ็น"], ["signName", "ชื่อใต้ลายเซ็น"]];

  return (
    <div className="lc-editor" ref={root} style={fullPage ? { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } : undefined}>
      <style>{SHEET_CSS}{EDITOR_CSS}</style>
      <div className="lc-toolbar">
        <select className="form-select form-select-sm" style={{ width: 190 }} value={active && active.kind !== "pagebreak" ? active.kind : ""} disabled={!active}
          onChange={(e) => setKind(e.target.value as Kind)}>
          {!active && <option value="">เลือกย่อหน้าที่ต้องการ</option>}
          {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div style={{ position: "relative" }}>
          <button type="button" className="btn btn-outline-primary" disabled={!active} onMouseDown={(e) => { e.preventDefault(); rememberRange(); setVarMenu((v) => !v); }}>
            <i className="fas fa-plus me-1" />แทรกข้อมูลอัตโนมัติ
          </button>
          {varMenu && (
            <div style={{ position: "absolute", top: "110%", left: 0, zIndex: 20, width: 260, maxHeight: 300, overflow: "auto", background: "var(--color-white)", border: "1px solid var(--color-light)", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,.3)", padding: 6 }}>
              <input className="form-control form-control-sm mb-1" placeholder="ค้นหา..." autoFocus value={varQuery} onChange={(e) => setVarQuery(e.target.value)} />
              {vars.map((v) => (
                <div key={v.key} style={{ padding: "4px 8px", cursor: "pointer", fontSize: 13, color: "var(--color-dark)", borderRadius: 4 }}
                  onMouseDown={(e) => { e.preventDefault(); insertVar(v.key); }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--color-light)")} onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}>
                  {v.label} <span style={{ color: "var(--color-dark-variant)", fontSize: 11 }}>{`{{${v.key}}}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn btn-outline-secondary" onClick={() => addLine("para")}>+ ย่อหน้า</button>
        <button type="button" className="btn btn-outline-secondary" onClick={() => addLine("pagebreak")}>ขึ้นหน้าใหม่</button>
        <button type="button" className="btn btn-outline-danger" disabled={!active} onClick={() => active && removeLine(active.id)}>ลบย่อหน้า</button>
        <span className="text-muted small ms-auto">คลิกที่ข้อความเพื่อแก้ไข · Enter = ย่อหน้าใหม่ · ชิปสีฟ้า = ข้อมูลที่ระบบเติมให้</span>
      </div>

      <div style={fullPage ? { background: "var(--color-background)", padding: "20px 12px", borderRadius: 8, overflow: "auto", flex: 1, minHeight: 0 } : { background: "var(--color-background)", padding: "16px 8px", borderRadius: 8, overflow: "auto", maxHeight: "78vh" }}>
        <div style={{ width: "max-content", margin: "0 auto" }}>
          <div className="lease-pages lease-sheet">
            {pages.map((page, pi) => (
              <div key={`${resetKey}-${pi}`}>
                <div className="lease-page">
                  {pi === 0 && logoUrl && <img src={logoUrl} alt="" className="lc-logo" />}
                  {page.map((l) => <EditablePara key={`${resetKey}-${l.id}`} line={l} labelOf={labelOf} onText={onText} onKey={onKey} onFocus={setActiveId} onPaste={onPaste} />)}
                </div>
                {pi < pbIds.length && (
                  <div className="lc-pb">
                    ขึ้นหน้าใหม่ <button type="button" className="btn btn-link btn-sm p-0 text-danger" style={{ fontSize: 11 }} onClick={() => removeLine(pbIds[pi])}>ลบ</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ContractEditor;
