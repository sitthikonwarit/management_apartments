interface BookingSnapshot {
  kind: "booking";
  roomNumber: string;
  roomDetail: string;
  roomPrice: number;
  name: string;
  tel: string;
  bookedAt: string;
}

function money(n: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(n || 0);
}

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, overflow: "hidden",
  border: "1px solid #e0e0e0", width: 300, maxWidth: "100%", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

// การ์ดคำขอจองห้องในหน้าแชท — ผู้สนใจส่งเข้ามาจากหน้า LIFF Booking (ปุ่ม "ดูห้องว่าง"/"จองห้อง" บนเมนู Guest
// kind: "booking" ใน text ของ chatMessages) แสดงผลอย่างเดียว ไม่มีปุ่ม action ให้กด (ต่างจาก "repair"/
// "payment_confirm") — พนักงานโทรกลับตามเบอร์ที่ให้ไว้เอง กดปุ่มโทรออกจากตรงนี้ได้เลย
export function ChatBookingMessage({ raw }: { raw: string }) {
  let data: BookingSnapshot | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.kind === "booking") data = parsed;
  } catch {
    // ข้อมูลอ่านไม่ได้ — fallback ข้างล่าง
  }

  if (!data) {
    return (
      <div style={{ background: "var(--color-background)", borderRadius: "var(--border-radius-1)", padding: "8px 12px" }}>
        <span style={{ whiteSpace: "pre-wrap" }}>{raw}</span>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ background: "var(--color-primary)", padding: 16 }}>
        <div className="d-flex align-items-center">
          <i className="fas fa-door-open" style={{ color: "#fff", fontSize: 16 }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 15, marginLeft: 8 }}>จองห้อง</span>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <div className="fw-bold mb-1">ห้อง {data.roomNumber}</div>
        {data.roomDetail && <div className="text-muted small mb-1">{data.roomDetail}</div>}
        {data.roomPrice > 0 && <div className="small mb-2">{money(data.roomPrice)} ฿/เดือน</div>}
        <div className="border-top pt-2 mt-2 small">
          <div className="d-flex justify-content-between mb-1">
            <span className="text-muted">ผู้จอง</span>
            <span className="fw-bold">{data.name}</span>
          </div>
          <div className="d-flex justify-content-between align-items-center">
            <span className="text-muted">เบอร์โทร</span>
            <a href={`tel:${data.tel}`} className="fw-bold text-decoration-none">
              <i className="fas fa-phone-alt me-1" style={{ color: "var(--color-success)" }} />{data.tel}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
