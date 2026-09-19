import { usePrivacyMode } from "../context/PrivacyModeContext";

// ปิดบังข้อความอ่อนไหว (เลขบัตร ปชช./เบอร์โทร/ที่อยู่/LINE ID ฯลฯ) ตอนเปิดโหมดความเป็นส่วนตัวอยู่ — แทนที่ด้วย
// เครื่องหมาย ● ล้วนๆ (ไม่ใช่แค่เบลอด้วย CSS) เพราะการเบลอยังพอเดา/ซูมอ่านได้จากภาพที่แคปไว้หลายเฟรม ส่วนการ
// แทนที่ตัวอักษรจริงไปเลยไม่มีทางอ่านค่าเดิมได้จากภาพที่แคปมาไม่ว่ากรณีใด
export default function PrivacyMask({ value, className = "", inline = true }: {
  value: string | number | null | undefined;
  className?: string;
  inline?: boolean;
}) {
  const { enabled } = usePrivacyMode();
  const text = value === null || value === undefined || value === "" ? "-" : String(value);
  if (!enabled || text === "-") {
    const Tag = inline ? "span" : "div";
    return <Tag className={className}>{text}</Tag>;
  }
  const maskLen = Math.min(14, Math.max(6, text.length));
  const Tag = inline ? "span" : "div";
  return (
    <Tag className={className} title="ซ่อนอยู่ในโหมดความเป็นส่วนตัว" style={{ letterSpacing: 2, userSelect: "none" }}>
      {"●".repeat(maskLen)}
    </Tag>
  );
}
