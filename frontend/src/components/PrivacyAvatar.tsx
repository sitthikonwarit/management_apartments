import { usePrivacyMode } from "../context/PrivacyModeContext";

// รูปโปรไฟล์ผู้เช่าก็เป็นข้อมูลส่วนบุคคลเหมือนกัน — ตอนเปิดโหมดความเป็นส่วนตัว สลับไปโชว์ไอคอนคนกลางๆ
// แทนรูปจริงเสมอ (ไม่ใช่แค่เบลอรูปเดิมด้วย CSS ซึ่งยังพอเห็นเค้าโครงหน้า/สีผิวจากภาพที่แคปไว้ได้)
export default function PrivacyAvatar({ src, alt, className, style, onClick, onError, referrerPolicy }: {
  src: string; alt: string; className?: string; style?: React.CSSProperties;
  onClick?: () => void; onError?: React.ReactEventHandler<HTMLImageElement>;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
}) {
  const { enabled } = usePrivacyMode();
  if (enabled) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--color-light)", color: "var(--color-dark-variant)",
        }}
        title="ซ่อนรูปอยู่ในโหมดความเป็นส่วนตัว"
      >
        <i className="fas fa-user" />
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} style={style} onClick={onClick} onError={onError} referrerPolicy={referrerPolicy} />;
}
