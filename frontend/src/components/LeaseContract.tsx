import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ContractBlock } from "../utils/contractTemplate";

const SHEET_CSS = `
.lease-sheet { font-family: 'Sarabun','TH Sarabun New','Mitr',sans-serif; font-size: 14pt; line-height: 1.65; color: #000; background: #fff; text-align: justify; }
.lease-sheet .lc-title { text-align: center; font-weight: 700; font-size: 19pt; margin: 0 0 6pt; }
.lease-sheet .lc-right { text-align: right; margin: 0; }
.lease-sheet .lc-para { margin: 0; text-indent: 2.2em; }
.lease-sheet .lc-space { height: 4pt; }
.lease-sheet .lc-sign { margin: 0 0 0 48%; text-align: center; text-indent: 0; white-space: pre-wrap; }
.lease-sheet .lc-blank { display: inline-block; min-width: 5.5em; border-bottom: 1px dotted #000; height: 1em; vertical-align: baseline; }
.lease-sheet .lc-break { break-after: page; page-break-after: always; height: 0; }
`;

// แสดงสัญญาที่แปลงแล้ว (บล็อกจาก renderContract) — ใช้ทั้งในหน้าตัวอย่างบนจอและตอนพิมพ์
export function LeaseContractSheet({ blocks }: { blocks: ContractBlock[] }) {
  return (
    <div className="lease-sheet">
      <style>{SHEET_CSS}</style>
      {blocks.map((b, i) => {
        if (!("parts" in b)) return b.kind === "pagebreak" ? <div key={i} className="lc-break" /> : <div key={i} className="lc-space" />;
        const cls = b.kind === "title" ? "lc-title" : b.kind === "right" ? "lc-right" : b.kind === "sign" ? "lc-sign" : "lc-para";
        return (
          <p key={i} className={cls}>
            {b.parts.map((p, j) => (p.blank ? <span key={j} className="lc-blank">&nbsp;</span> : <span key={j}>{p.text}</span>))}
          </p>
        );
      })}
    </div>
  );
}

// พิมพ์สัญญา: เรนเดอร์ผ่าน portal ลง body (นอก #root) แล้วซ่อนแอปทั้งหมดตอนพิมพ์ — เปิดไดอะล็อกพิมพ์ของเบราว์เซอร์ทันที
// ปิดตัวเองเมื่อพิมพ์/ยกเลิกเสร็จ (afterprint)
export function LeaseContractPrint({ blocks, onDone }: { blocks: ContractBlock[]; onDone: () => void }) {
  useEffect(() => {
    let cancelled = false;
    const after = () => { if (!cancelled) onDone(); };
    window.addEventListener("afterprint", after);
    // รอฟอนต์โหลดก่อนสั่งพิมพ์ ไม่งั้นหน้าพิมพ์อาจใช้ฟอนต์สำรอง
    const ready = (document as any).fonts?.ready ?? Promise.resolve();
    Promise.resolve(ready).then(() => setTimeout(() => { if (!cancelled) window.print(); }, 150));
    return () => { cancelled = true; window.removeEventListener("afterprint", after); };
  }, []);

  return createPortal(
    <div className="lease-print-root">
      <style>{`
        .lease-print-root { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 14mm 16mm; }
          #root { display: none !important; }
          html, body { background: #fff !important; }
          .lease-print-root { display: block !important; }
        }
      `}</style>
      <LeaseContractSheet blocks={blocks} />
    </div>,
    document.body
  );
}
