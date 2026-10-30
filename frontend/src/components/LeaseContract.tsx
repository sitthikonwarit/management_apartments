import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ContractBlock } from "../utils/contractTemplate";

// ขนาด/ระยะทั้งหมดอ้างอิงจากสัญญาตัวอย่าง (THSarabunPSK 16pt บน A4: ขอบซ้าย-ขวา 90pt, บรรทัดละ 18.1pt, ย่อหน้าเยื้อง 70pt,
// บล็อกลายเซ็นเริ่มที่ 196pt จากขอบซ้าย) — Sarabun (ฟอนต์เว็บ) กว้างกว่า PSK จึงใช้ 10.5pt ให้ความกว้างบรรทัดเท่าตัวอย่าง
const SHEET_CSS = `
.lease-sheet { font-family: 'Sarabun','TH Sarabun New','TH SarabunPSK',sans-serif; font-size: 10.5pt; line-height: 18.1pt; color: #000; background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.lease-sheet p { margin: 0; white-space: pre-wrap; }
.lease-sheet .lc-title { text-align: center; font-weight: 700; }
.lease-sheet .lc-right { text-align: right; }
.lease-sheet .lc-para { text-align: justify; text-justify: inter-character; text-indent: 70pt; }
.lease-sheet .lc-space { height: 18.1pt; }
.lease-sheet .lc-sign { margin-left: 196pt; text-align: left; white-space: pre; }
.lease-sheet .lc-signName { margin-left: 217pt; text-align: left; white-space: pre; }
.lease-sheet .lc-fill { padding: 0 14pt; background-image: repeating-linear-gradient(90deg, #000 0, #000 1.4pt, transparent 1.4pt, transparent 2.8pt);
  background-size: 100% 0.5pt; background-repeat: no-repeat; background-position: 0 calc(100% - 3.1pt); }
.lease-sheet .lc-break { break-after: page; page-break-after: always; height: 0; }
`;

// แสดงสัญญาที่แปลงแล้ว (บล็อกจาก renderContract) — ใช้ทั้งในหน้าตัวอย่างบนจอและตอนพิมพ์
export function LeaseContractSheet({ blocks }: { blocks: ContractBlock[] }) {
  return (
    <div className="lease-sheet">
      <style>{SHEET_CSS}</style>
      {blocks.map((b, i) => {
        if (!("parts" in b)) return b.kind === "pagebreak" ? <div key={i} className="lc-break" /> : <div key={i} className="lc-space" />;
        const cls = b.kind === "title" ? "lc-title" : b.kind === "right" ? "lc-right" : b.kind === "sign" ? "lc-sign" : b.kind === "signName" ? "lc-signName" : "lc-para";
        return (
          <p key={i} className={cls}>
            {b.parts.map((p, j) => <span key={j} className={p.fill ? "lc-fill" : undefined}>{p.text}</span>)}
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
          @page { size: A4 portrait; margin: 72pt 90pt; }
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
