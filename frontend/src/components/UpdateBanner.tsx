// แบนเนอร์แจ้ง "มีอัปเดตใหม่" ลอยอยู่บนสุดของทุกหน้า (เมาท์ที่ระดับ shell ใน App.tsx เหมือน
// ChatToastHost.tsx) โผล่มาเมื่อ useVersionCheck.ts ตรวจพบว่า index.html บนเซิร์ฟเวอร์เปลี่ยนไปจาก
// __APP_BUILD__ ที่หน้านี้โหลดมาตอนแรก — ไม่บังคับ reload อัตโนมัติ เพราะอาจมีฟอร์มที่กำลังกรอกอยู่ค้าง
// ให้ผู้ใช้กดรีเฟรชเองตอนสะดวก
export default function UpdateBanner({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 2000,
        background: "var(--color-primary)", color: "#fff",
        padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center",
        gap: 12, flexWrap: "wrap", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        animation: "slideUp 0.3s ease",
      }}
    >
      <span style={{ fontSize: 14 }}>
        <i className="fas fa-arrows-rotate me-2" />มีอัปเดตใหม่ของเว็บไซต์ กรุณารีเฟรชเพื่อใช้งานเวอร์ชันล่าสุด
      </span>
      <button
        type="button"
        className="btn btn-sm btn-light"
        onClick={() => window.location.reload()}
        style={{ fontWeight: 600 }}
      >
        <i className="fas fa-rotate-right me-1" />รีเฟรชตอนนี้
      </button>
    </div>
  );
}
