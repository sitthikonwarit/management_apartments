import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ContractBlock } from "../utils/contractTemplate";

// ขนาด/ระยะทั้งหมดอ้างอิงจากสัญญาตัวอย่าง (THSarabunPSK 16pt บน A4: ขอบซ้าย-ขวา 90pt, บรรทัดละ 18.1pt, ย่อหน้าเยื้อง 70pt,
// บล็อกลายเซ็นเริ่มที่ 196pt จากขอบซ้าย) — ใช้ฟอนต์ TH Sarabun (ไฟล์อยู่ใน public/fonts) 16pt เหมือนต้นฉบับ
// สีตัวอักษรบังคับดำสนิทเสมอ (กันธีมมืด/สีของแอปไหลเข้ามา) และเส้นประใต้ค่าที่เติมใช้ text-decoration จริง ตรงกับตัวอักษรเสมอ
export const SHEET_CSS = `
@font-face { font-family: 'THSarabunPSK'; src: url('/fonts/THSarabun.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: block; }
@font-face { font-family: 'THSarabunPSK'; src: url('/fonts/THSarabun-Bold.ttf') format('truetype'); font-weight: 700; font-style: normal; font-display: block; }
.lease-pages { background: transparent; }
.lease-page { position: relative; box-sizing: border-box; width: 595.3pt; min-height: 841.9pt; padding: 72pt 48pt; margin: 0 auto 14pt; background: #fff;
  box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); }
.lease-sheet, .lease-sheet * { color: #000 !important; -webkit-text-fill-color: #000 !important; }
.lease-sheet { font-family: 'THSarabunPSK','TH Sarabun New','TH SarabunPSK','Sarabun',sans-serif; font-size: 16pt; line-height: 18.1pt; font-weight: 400; background: transparent;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; text-rendering: geometricPrecision; }
.lease-sheet p { margin: 0; white-space: break-spaces; }
.lease-sheet .lc-title { text-align: center; font-weight: 700; }
.lease-sheet .lc-right { text-align: right; }
.lease-sheet .lc-para { text-align: justify; text-justify: inter-character; text-indent: 57pt; }
.lease-sheet .lc-item { text-indent: 88pt; }
.lease-sheet .lc-space { height: 18.1pt; }
.lease-sheet .lc-sign { margin-left: 156pt; margin-top: 12pt; text-align: left; white-space: pre; }
.lease-sheet .lc-signName { margin-left: 177pt; text-align: left; white-space: pre; }
.lease-sheet .lc-fill { text-decoration-line: underline; text-decoration-style: dotted; text-decoration-color: #000; text-decoration-thickness: 0.8pt;
  text-underline-offset: 1.6pt; text-decoration-skip-ink: none; }
.lease-sheet .lc-logo { position: absolute; top: 28pt; left: 486pt; width: 62pt; height: 62pt; object-fit: contain; }
@media print {
  /* ขอบกระดาษ 0 แล้วให้แต่ละหน้า (.lease-page) เป็น A4 เต็มแผ่นที่มี padding เอง — โลโก้วางตำแหน่งสัมบูรณ์ในแผ่นได้โดยไม่ล้นขอบ
     (เนื้อหาล้นขอบ/ค่าติดลบทำให้ Chrome ย่อทั้งเอกสารหรือตัดโลโก้ตอนพิมพ์) */
  .lease-page { width: 595.3pt; height: 841pt; min-height: 0; padding-bottom: 36pt; overflow: hidden; margin: 0; box-shadow: none; background: #fff; break-after: page; page-break-after: always; }
  .lease-page:last-of-type { break-after: auto; page-break-after: auto; }
}
`;

const NB = " "; // ช่องว่างธรรมดา (white-space: pre-wrap เก็บไว้) — ใช้ nbsp ไม่ได้ เพราะทำให้บรรทัดตัดไม่ได้จนค่าที่เติมล้นขอบขวา
const NBSP = " ";
const SPACE_PT = 3.6; // ความกว้างช่องว่างไม่ตัดบรรทัดโดยประมาณที่ 16pt (TH Sarabun)

// แบ่งสัญญาเป็นหน้าตามบรรทัด "---"
function splitPages(blocks: ContractBlock[]): ContractBlock[][] {
  const pages: ContractBlock[][] = [[]];
  for (const b of blocks) {
    if (b.kind === "pagebreak") pages.push([]);
    else pages[pages.length - 1].push(b);
  }
  return pages;
}

function Block({ b }: { b: ContractBlock }) {
  if (!("parts" in b)) return <div className="lc-space" />;
  const cls = b.kind === "title" ? "lc-title" : b.kind === "right" ? "lc-right" : b.kind === "sign" ? "lc-sign" : b.kind === "signName" ? "lc-signName" : b.parts[0]?.text.startsWith("ข้อ") ? "lc-para lc-item" : "lc-para";
  return (
    <p className={cls}>
      {b.parts.map((p, j) => {
        // ช่องว่างท้ายค่าที่เติมเป็น nbsp เพื่อให้ติดกับตัวอักษรถัดไป (เช่น ")") ไม่ถูกตัดตกบรรทัดใหม่ — ส่วนหน้าค่าเป็นช่องว่างธรรมดาตัดบรรทัดได้
        if (p.blankWidth) return <span key={j} className="lc-fill">{NB.repeat(Math.max(0, Math.round(p.blankWidth / SPACE_PT) - 2)) + NBSP.repeat(2)}</span>;
        if (p.fill) return <span key={j} className="lc-fill">{NB.repeat(3) + p.text + NBSP.repeat(3)}</span>;
        return <span key={j}>{p.text}</span>;
      })}
    </p>
  );
}

// สัญญาทั้งฉบับเป็นหน้า A4 (บนจอเป็นแผ่นขาวมีเงาแบบ Google Docs / ตอนพิมพ์ใช้ขอบจาก @page)
export function LeaseContractSheet({ blocks, logoUrl }: { blocks: ContractBlock[]; logoUrl?: string }) {
  const pages = splitPages(blocks);
  return (
    <div className="lease-pages lease-sheet">
      <style>{SHEET_CSS}</style>
      {pages.map((page, i) => (
        <div key={i} className="lease-page">
          {i === 0 && logoUrl && <img src={logoUrl} alt="" className="lc-logo" />}
          {page.map((b, k) => <Block key={k} b={b} />)}
        </div>
      ))}
    </div>
  );
}

// ตัวอย่างก่อนพิมพ์ (พื้นหลังเทา แผ่นขาวมีเงา) + ปุ่มพิมพ์/ปิด
export function LeaseContractPreview({ blocks, logoUrl, onPrint, onClose }: { blocks: ContractBlock[]; logoUrl?: string; onPrint: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1600, background: "var(--color-background)", display: "flex", flexDirection: "column" }} className="no-print">
      <div style={{ background: "var(--color-white)", borderBottom: "1px solid var(--color-light)", padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <i className="fas fa-file-contract" style={{ color: "#1a73e8" }} />
        <strong style={{ color: "var(--color-dark)" }}>สัญญาเช่า — ตัวอย่างก่อนพิมพ์</strong>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={onPrint}><i className="fas fa-print me-2" />พิมพ์ / บันทึกเป็น PDF</button>
          <button className="btn btn-outline-secondary" onClick={onClose}><i className="fas fa-times" /></button>
        </div>
      </div>
      <div style={{ overflow: "auto", flex: 1, padding: "20px 12px" }}>
        <div style={{ width: "max-content", margin: "0 auto" }}>
          <LeaseContractSheet blocks={blocks} logoUrl={logoUrl} />
        </div>
      </div>
    </div>
  );
}

// พิมพ์สัญญา: เรนเดอร์ผ่าน portal ลง body (นอก #root) แล้วซ่อนแอปทั้งหมดตอนพิมพ์ — เปิดไดอะล็อกพิมพ์ของเบราว์เซอร์ทันที
// ปิดตัวเองเมื่อพิมพ์/ยกเลิกเสร็จ (afterprint)
export function LeaseContractPrint({ blocks, logoUrl, onDone }: { blocks: ContractBlock[]; logoUrl?: string; onDone: () => void }) {
  useEffect(() => {
    let cancelled = false;
    const after = () => { if (!cancelled) onDone(); };
    window.addEventListener("afterprint", after);
    // รอฟอนต์/โลโก้โหลดก่อนสั่งพิมพ์ ไม่งั้นหน้าพิมพ์อาจใช้ฟอนต์สำรองหรือไม่มีโลโก้
    const fonts = (document as any).fonts;
    const ready = fonts?.load
      ? Promise.all([fonts.load("16pt THSarabunPSK"), fonts.load("bold 16pt THSarabunPSK")]).then(() => fonts.ready).catch(() => undefined)
      : Promise.resolve();
    const imgReady = logoUrl
      ? new Promise<void>((res) => { const im = new Image(); im.onload = () => res(); im.onerror = () => res(); im.src = logoUrl; })
      : Promise.resolve();
    Promise.all([Promise.resolve(ready), imgReady]).then(() => setTimeout(() => { if (!cancelled) window.print(); }, 150));
    return () => { cancelled = true; window.removeEventListener("afterprint", after); };
  }, []);

  return createPortal(
    <div className="lease-print-root">
      <style>{`
        .lease-print-root { display: none; }
        @media print {
          @page { size: 595.3pt 841.9pt; margin: 0; }
          #root { display: none !important; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; width: auto !important; }
          .lease-print-root { display: block !important; }
        }
      `}</style>
      <LeaseContractSheet blocks={blocks} logoUrl={logoUrl} />
    </div>,
    document.body
  );
}
