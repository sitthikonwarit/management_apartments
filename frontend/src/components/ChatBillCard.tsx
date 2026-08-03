import { useState } from "react";
import ImageLightbox from "./ImageLightbox";

interface BillRow { icon: string; iconBg: string; name: string; sub?: string; price: number }
interface OutstandingRow { label: string; amount: number }
interface DiscountRow { name: string; price: number }

interface BillSnapshot {
  kind: "bill";
  roomNumber: string; tenantTitle: string; tenantName: string; monthLabel: string;
  rows: BillRow[]; fineAmount: number; overdueDays: number;
  outstandingItems: OutstandingRow[]; outstandingAmount: number;
  discountItems: DiscountRow[]; total: number; residentCount: number; showSplit: boolean;
  dueDateLabel: string;
}

interface ReceiptSnapshot {
  kind: "receipt";
  roomNumber: string; monthLabel: string; method: "cash" | "scan";
  amount: number; change: number; note: string; paymentDateLabel: string;
  remaining: number; fullySettled: boolean; slipUrl: string;
}

function money(n: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n || 0);
}

const cardStyle: React.CSSProperties = {
  fontFamily: "'Sarabun', sans-serif", background: "#fff", borderRadius: 14, overflow: "hidden",
  border: "1px solid #e0e0e0", width: 280, maxWidth: "100%", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

// การ์ดแจ้งบิลค่าเช่า/ใบเสร็จรับเงินในหน้าแชท — ใช้ตอน messageType เป็น "bill"/"receipt" (ข้อความ
// อัตโนมัติตอนกดส่งบิล/บันทึกชำระเงินทาง LINE) หน้าตาพอร์ตมาจาก BillLinePreview ในหน้าบิล/แจ้งหนี้ ให้
// เหมือนกับใบที่ผู้เช่าได้รับจริงทาง LINE มากที่สุด (ดู backend/src/services/line.ts: buildChatBillSnapshot/
// buildChatReceiptSnapshot ที่สร้าง JSON นี้ตอนส่งสำเร็จ)
export function ChatBillMessage({ messageType, raw }: { messageType: string; raw: string }) {
  try {
    const data = JSON.parse(raw);
    if (messageType === "bill" && data?.kind === "bill") return <ChatBillCard data={data} />;
    if (messageType === "receipt" && data?.kind === "receipt") return <ChatReceiptCard data={data} />;
  } catch {
    // ข้อมูลอ่านไม่ได้ (เช่นข้อมูลเก่าก่อนมีฟีเจอร์นี้) — fallback เป็นข้อความธรรมดา
  }
  return (
    <div style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)", padding: "8px 12px" }}>
      <span style={{ whiteSpace: "pre-wrap" }}>{raw}</span>
    </div>
  );
}

function ChatBillCard({ data }: { data: BillSnapshot }) {
  return (
    <div style={cardStyle}>
      <div style={{ background: "var(--color-primary)", padding: 14 }}>
        <div style={{ color: "#fff", fontSize: 12, opacity: 0.9, fontWeight: 600 }}>
          <i className="fas fa-file-invoice me-1" />แจ้งค่าเช่า
        </div>
        <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginTop: 2 }}>{data.tenantTitle} {data.tenantName}</div>
        <div style={{ color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 2 }}>ห้อง {data.roomNumber} (ประจำเดือน {data.monthLabel})</div>
      </div>
      <div style={{ padding: "12px 14px", background: "#FAFAFA" }}>
        {data.rows.map((r, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-start", minWidth: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: 5, background: r.iconBg, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 8, flexShrink: 0, marginTop: 1 }}>
                <i className={`fas ${r.icon}`} style={{ color: "#fff", fontSize: 9 }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#333", fontSize: 12.5 }}>{r.name}</div>
                {r.sub && <div style={{ color: "#AAAAAA", fontSize: 10.5, marginTop: 1 }}>{r.sub}</div>}
              </div>
            </div>
            <span style={{ color: "#333", fontSize: 12.5, flexShrink: 0, marginLeft: 6 }}>{money(r.price)}</span>
          </div>
        ))}

        {data.fineAmount > 0 && <HighlightRow label={`ค่าปรับล่าช้า (${data.overdueDays} วัน)`} amount={data.fineAmount} />}
        {data.outstandingItems.length > 0
          ? data.outstandingItems.map((o, i) => <HighlightRow key={i} label={`ค้างชำระ ${o.label}`} amount={o.amount} />)
          : data.outstandingAmount > 0 && <HighlightRow label="ยอดค้างชำระยกมา" amount={data.outstandingAmount} />}
        {data.discountItems.map((d, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--color-danger)", fontSize: 12.5 }}>ส่วนลด: {d.name}</span>
            <span style={{ color: "var(--color-danger)", fontSize: 12.5 }}>-{money(d.price)}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: "10px 14px", background: "#fff", borderTop: "1px solid #EEEEEE" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <span style={{ color: "#333", fontSize: 13, fontWeight: 700 }}>ยอดชำระสุทธิ</span>
          <span style={{ color: "var(--color-primary)", fontSize: 18, fontWeight: 700 }}>{money(data.total)} ฿</span>
        </div>
        {data.showSplit && (
          <div style={{ textAlign: "right", color: "var(--color-primary)", fontSize: 12, fontWeight: 700, marginTop: 4 }}>
            หาร {data.residentCount} คน · คนละ {money(data.total / data.residentCount)} บาท
          </div>
        )}
        <div style={{ textAlign: "center", color: "#888", fontSize: 10.5, marginTop: 8 }}>{data.dueDateLabel}</div>
      </div>
    </div>
  );
}

function HighlightRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, background: "rgba(255,0,96,0.08)", padding: "6px 8px", borderRadius: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-danger)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-danger)" }}>{money(amount)}</span>
    </div>
  );
}

function ChatReceiptCard({ data }: { data: ReceiptSnapshot }) {
  const [showSlip, setShowSlip] = useState(false);

  return (
    <div style={cardStyle}>
      <div style={{ background: "var(--color-primary)", padding: 14 }}>
        <div style={{ color: "#fff", fontSize: 12, opacity: 0.9, fontWeight: 600 }}>
          <i className="fas fa-receipt me-1" />ใบเสร็จรับเงิน
        </div>
        <div style={{ color: "#fff", fontSize: 15, fontWeight: 700, marginTop: 2 }}>ห้อง {data.roomNumber}</div>
        <div style={{ color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 2 }}>รับชำระ {money(data.amount)} ฿</div>
      </div>
      <div style={{ padding: "12px 14px", background: "#FAFAFA" }}>
        <InfoRow icon="fa-calendar" label="วันที่ชำระ" value={data.paymentDateLabel} />
        <InfoRow icon="fa-receipt" label="สำหรับเดือน" value={data.monthLabel} />
        <InfoRow icon={data.method === "scan" ? "fa-qrcode" : "fa-money-bill"} label="ช่องทาง" value={data.method === "scan" ? "สแกน/โอน" : "เงินสด"} />
        {data.change > 0 && <InfoRow icon="fa-coins" label="เงินทอน" value={`${money(data.change)} ฿`} />}
        {data.note && <InfoRow icon="fa-note-sticky" label="หมายเหตุ" value={data.note} />}
        {data.slipUrl && (
          <button type="button" className="btn btn-sm btn-outline-secondary mt-1" onClick={() => setShowSlip(true)}>
            <i className="fas fa-image me-1" />ดูสลิปการโอน
          </button>
        )}
      </div>
      <div style={{ padding: "10px 14px", background: "#fff", borderTop: "1px solid #EEEEEE", textAlign: "center" }}>
        {data.fullySettled ? (
          <span style={{ color: "var(--color-success)", fontWeight: 700, fontSize: 13 }}>ชำระเงินครบถ้วนแล้ว</span>
        ) : (
          <span style={{ color: "var(--color-danger)", fontWeight: 700, fontSize: 13 }}>คงเหลือที่ต้องชำระ {money(data.remaining)} ฿</span>
        )}
      </div>
      {showSlip && (
        <ImageLightbox images={[data.slipUrl]} index={0} onClose={() => setShowSlip(false)} onIndexChange={() => {}} />
      )}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
      <span style={{ color: "#888", fontSize: 12, flexShrink: 0 }}><i className={`fas ${icon} me-1`} />{label}</span>
      <span style={{ color: "#333", fontSize: 12, fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}
