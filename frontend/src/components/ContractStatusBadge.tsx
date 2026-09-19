import { getContractStatus } from "../utils/tenantContract";

// ป้ายเตือน "ใกล้หมดสัญญา"/"หมดสัญญาแล้ว" ของผู้เช่าคนหนึ่ง — ไม่แสดงอะไรเลยถ้ายังไม่ถึงเกณฑ์เตือน
// (ดู CONTRACT_WARNING_DAYS ใน utils/tenantContract.ts) ใช้ร่วมกันทั้งมุมมองลิสต์/กริด/ตารางของหน้าผู้เช่า
export default function ContractStatusBadge({ contractEndDate, className = "" }: {
  contractEndDate?: string | null;
  className?: string;
}) {
  const status = getContractStatus(contractEndDate);
  if (!status) return null;
  const expired = status.kind === "expired";
  return (
    <span
      className={`badge ${expired ? "bg-danger" : "bg-warning text-dark"} ${className}`}
      style={{ fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}
    >
      <i className={`fas ${expired ? "fa-circle-exclamation" : "fa-clock"} me-1`} />
      {expired ? `หมดสัญญาแล้ว ${Math.abs(status.days)} วัน` : `ใกล้หมดสัญญา ${status.days} วัน`}
    </span>
  );
}
