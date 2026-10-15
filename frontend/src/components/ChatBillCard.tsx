import { useState } from "react";
import ImageLightbox from "./ImageLightbox";

interface BillRow { icon: string; name: string; sub?: string; price: number }
interface OutstandingRow { label: string; amount: number }
interface DiscountRow { name: string; price: number }

interface BillSnapshot {
  kind: "bill";
  logoUrl: string; fineIcon: string; discountIcon: string;
  roomNumber: string; tenantTitle: string; tenantName: string; monthLabel: string;
  rows: BillRow[]; fineAmount: number; overdueDays: number;
  outstandingItems: OutstandingRow[]; outstandingAmount: number;
  discountItems: DiscountRow[]; total: number; residentCount: number; showSplit: boolean;
  dueDateLabel: string;
}

interface ReceiptSnapshot {
  kind: "receipt";
  receiptIcon: string; methodIcon: string; calendarIcon: string; cashIcon: string; noteIcon: string; watermarkIcon: string;
  roomNumber: string; monthLabel: string; method: "cash" | "scan";
  amount: number; change: number; note: string; paymentDateLabel: string;
  remaining: number; fullySettled: boolean; slipUrl: string;
  detail?: {
    monthTotal: number; carriedTotal: number; fullTotal: number; receivedCurrent: number; receivedTotal: number;
    oldClosed: { label: string; amount: number }[];
  } | null;
}

function money(n: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n || 0);
}

// สีตรงกับที่ backend/src/services/line.ts ใช้ตอนสร้าง Flex Message จริง (COLOR_TEXT/COLOR_MUTED/COLOR_RED/
// BG_BODY/BG_FINE) เพื่อให้การ์ดในหน้าแชทหน้าตาตรงกับที่ผู้เช่าเห็นจริงบน LINE เป๊ะๆ
const COLOR_TEXT = "#333333";
const COLOR_MUTED = "#888888";
const COLOR_RED = "#FF0060";
const BG_BODY = "#FAFAFA";
const BG_FINE = "#FFE1EC";

const cardStyle: React.CSSProperties = {
  fontFamily: "'Sarabun', sans-serif", background: "#fff", borderRadius: 14, overflow: "hidden",
  border: "1px solid #e0e0e0", width: 300, maxWidth: "100%", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

// การ์ดแจ้งบิลค่าเช่า/ใบเสร็จรับเงินในหน้าแชท — ใช้ตอน messageType เป็น "bill"/"receipt" (ข้อความอัตโนมัติ
// ตอนกดส่งบิล/บันทึกชำระเงินทาง LINE) ต้องหน้าตาตรงกับ Flex Message ที่ผู้เช่าได้รับจริงบน LINE ให้มากที่สุด
// จึงใช้ไอคอน/ลำดับ/สีเดียวกับที่ buildBillFlexMessage/buildPaymentReceiptFlexMessage ใน
// backend/src/services/line.ts ส่งจริง (ไอคอน icons8 ตัวเดียวกัน ไม่ใช่ FontAwesome ที่หน้าตาต่างออกไป)
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

function Row({ icon, name, sub, price, highlight }: { icon: string; name: string; sub?: string; price: string; highlight?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10,
      ...(highlight ? { background: BG_FINE, borderRadius: 8, padding: "8px 10px" } : {}),
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", minWidth: 0 }}>
        <img src={icon} alt="" style={{ width: highlight ? 15 : 13, height: highlight ? 15 : 13, objectFit: "contain", marginRight: 8, marginTop: 2, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ color: highlight ? COLOR_RED : COLOR_TEXT, fontSize: 13, fontWeight: highlight ? 700 : 400 }}>{name}</div>
          {sub && <div style={{ color: COLOR_MUTED, fontSize: 11, marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
      <span style={{ color: highlight ? COLOR_RED : COLOR_TEXT, fontSize: 13, fontWeight: highlight ? 700 : 400, flexShrink: 0, marginLeft: 6 }}>{price}</span>
    </div>
  );
}

function ChatBillCard({ data }: { data: BillSnapshot }) {
  return (
    <div className="chat-line-card" style={cardStyle}>
      <div style={{ background: "var(--color-primary)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={data.logoUrl} alt="" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 16, marginLeft: 8 }}>แจ้งค่าเช่าห้อง</span>
        </div>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, marginTop: 8 }}>{data.tenantTitle} {data.tenantName}</div>
        <div style={{ color: "#ffffffcc", fontSize: 12, marginTop: 5 }}>ห้อง {data.roomNumber} (ประจำเดือน {data.monthLabel})</div>
      </div>
      <div style={{ padding: 16, background: BG_BODY }}>
        {data.rows.map((r, i) => (
          <Row key={i} icon={r.icon} name={r.name} sub={r.sub} price={`${money(r.price)} ฿`} />
        ))}

        {data.fineAmount > 0 && (
          <Row icon={data.fineIcon} name={data.overdueDays > 0 ? `ค่าปรับล่าช้า (${data.overdueDays} วัน)` : "ค่าปรับล่าช้า"} price={`${money(data.fineAmount)} ฿`} highlight />
        )}
        {data.outstandingItems.length > 0
          ? data.outstandingItems.map((o, i) => (
              <Row key={i} icon={data.fineIcon} name={`ค้างชำระ ${o.label}`} price={`${money(o.amount)} ฿`} highlight />
            ))
          : data.outstandingAmount > 0 && (
              <Row icon={data.fineIcon} name="ยอดค้างชำระยกมา" price={`${money(data.outstandingAmount)} ฿`} highlight />
            )}
        {data.discountItems.map((d, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
              <img src={data.discountIcon} alt="" style={{ width: 13, height: 13, objectFit: "contain", marginRight: 8, marginTop: 2 }} />
              <span style={{ color: COLOR_RED, fontSize: 13 }}>ส่วนลด: {d.name}</span>
            </div>
            <span style={{ color: COLOR_RED, fontSize: 13 }}>-{money(d.price)} ฿</span>
          </div>
        ))}

        <div style={{ borderTop: "1px solid #E0E0E0", margin: "12px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <span style={{ color: COLOR_TEXT, fontSize: 14, fontWeight: 700 }}>ยอดชำระสุทธิ</span>
          <span style={{ color: "var(--color-primary)", fontSize: 20, fontWeight: 700 }}>{money(data.total)} ฿</span>
        </div>
        {data.showSplit && (
          <div style={{ textAlign: "right", color: "var(--color-primary)", fontSize: 13, fontWeight: 700, marginTop: 4 }}>
            หาร {data.residentCount} คน · คนละ {money(data.total / data.residentCount)} บาท
          </div>
        )}
        <div style={{ textAlign: "center", color: COLOR_MUTED, fontSize: 11, marginTop: 12 }}>{data.dueDateLabel}</div>
      </div>
    </div>
  );
}

function ChatReceiptCard({ data }: { data: ReceiptSnapshot }) {
  const [showSlip, setShowSlip] = useState(false);

  return (
    <div className="chat-line-card" style={cardStyle}>
      <div style={{ background: "var(--color-primary)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={data.receiptIcon} alt="" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 16, marginLeft: 8 }}>ใบเสร็จรับเงิน</span>
        </div>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, marginTop: 8 }}>ห้อง {data.roomNumber}</div>
        <div style={{ color: "#ffffffcc", fontSize: 12, marginTop: 5 }}>รับชำระ {money(data.amount)} ฿</div>
      </div>
      <div style={{ padding: 16, background: BG_BODY, position: "relative", overflow: "hidden" }}>
        {data.fullySettled && (
          <div style={{
            position: "absolute", top: "10%", left: "25%", width: "50%", textAlign: "center",
            opacity: 0.7, pointerEvents: "none",
          }}>
            <img src={data.watermarkIcon} alt="" style={{ width: "100%", height: "auto" }} />
            <div style={{ marginTop: -20, color: "#FF8FAB", fontWeight: 700, fontSize: 11 }}>ชำระเรียบร้อย</div>
          </div>
        )}
        <div style={{ position: "relative" }}>
          <Row icon={data.methodIcon} name={data.method === "scan" ? "ช่องทาง: สแกน/โอน" : "ช่องทาง: เงินสด"} price="" />
          <Row icon={data.calendarIcon} name="วันที่ชำระ" price={data.paymentDateLabel} />
          <Row icon={data.receiptIcon} name="สำหรับเดือน" price={data.monthLabel} />
          {data.detail && (
            <>
              <div style={{ borderTop: "1px solid #E0E0E0", margin: "12px 0" }} />
              <Row icon={data.receiptIcon} name={`ยอดของเดือน ${data.monthLabel}`} price={`${money(data.detail.monthTotal)} ฿`} />
              {data.detail.carriedTotal > 0.005 && <Row icon={data.receiptIcon} name="ยอดค้างยกมา" price={`${money(data.detail.carriedTotal)} ฿`} highlight />}
              <Row icon={data.receiptIcon} name="ยอดเต็มทั้งหมด" price={`${money(data.detail.fullTotal)} ฿`} />
              <div style={{ borderTop: "1px solid #E0E0E0", margin: "12px 0" }} />
              {data.detail.receivedCurrent > 0.005 && <Row icon={data.cashIcon} name={`รับชำระเดือน ${data.monthLabel}`} price={`${money(data.detail.receivedCurrent)} ฿`} />}
              {data.detail.oldClosed.map((o, i) => <Row key={i} icon={data.cashIcon} name={`รับชำระเดือน ${o.label}`} price={`${money(o.amount)} ฿`} />)}
              <Row icon={data.cashIcon} name="รวมรับครั้งนี้" price={`${money(data.detail.receivedTotal)} ฿`} />
            </>
          )}
          {data.change > 0 && <Row icon={data.cashIcon} name="เงินทอน" price={`${money(data.change)} ฿`} />}
          {data.note && <Row icon={data.noteIcon} name="หมายเหตุ" price={data.note} />}

          <div style={{ borderTop: "1px solid #E0E0E0", margin: "12px 0" }} />
          {data.fullySettled ? (
            <div style={{ textAlign: "center", color: "var(--color-success)", fontWeight: 700, fontSize: 14 }}>
              ชำระเงินครบถ้วนแล้ว ขอบคุณค่ะ/ครับ
            </div>
          ) : (
            <Row icon={data.receiptIcon} name="คงเหลือที่ต้องชำระ" price={`${money(data.remaining)} ฿`} highlight />
          )}
          {data.slipUrl && (
            <button type="button" className="btn btn-sm btn-outline-secondary mt-2" onClick={() => setShowSlip(true)}>
              <i className="fas fa-image me-1" />ดูสลิปการโอน
            </button>
          )}
        </div>
      </div>
      {showSlip && (
        <ImageLightbox images={[data.slipUrl]} index={0} onClose={() => setShowSlip(false)} onIndexChange={() => {}} />
      )}
    </div>
  );
}
