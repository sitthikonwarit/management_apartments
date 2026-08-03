// หน้า LIFF Profile — ปลายทางของปุ่ม "ข้อมูลผู้เช่า" บนเมนู Member แสดงข้อมูลส่วนตัว + บิลทุกใบ (ทั้งจ่ายแล้ว
// และค้างอยู่) + ประวัติการชำระเงินทั้งหมดของผู้เช่าคนนั้น กดดูรายละเอียดแต่ละบิลได้ (หน้าตาแบบ "บิลอิเล็กทรอนิกส์
// (LINE)" เดียวกับที่พนักงานเห็นในหน้า Bills — ดู BillLinePreviewCard.tsx) และดูสลิปการโอนแต่ละรายการในประวัติ
// การชำระเงินได้
import { useEffect, useState } from "react";
import liff from "@line/liff";
import { liffApi } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";
import { monthYearLabel } from "../utils/billCalc";
import { thaiDateOnlyString } from "../utils/yearFormat";
import { BillLinePreview, type BillLinePreviewConfig } from "../components/BillLinePreviewCard";
import ImageLightbox from "../components/ImageLightbox";

type Status = "loading" | "linked" | "unlinked" | "error";

interface BillRow {
  billId: string; roomId: string; monthYear: string; roomNumber: string;
  total: number; paidAmount: number; status: string;
}

interface PaymentRow {
  id: string; paymentDate: string; monthYear: string; roomNumber: string;
  method: string; amount: number; note: string; slipUrl: string; cancelled: boolean;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
}

function BillStatusBadge({ bill }: { bill: BillRow }) {
  if (bill.status === "paid") return <span className="status-badge status-paid">จ่ายแล้ว</span>;
  if (bill.paidAmount > 0) return <span className="status-badge status-partial">ค้าง {fmtMoney(bill.total - bill.paidAmount)} ฿</span>;
  return <span className="status-badge status-unpaid">รอชำระ</span>;
}

export default function LiffProfilePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [previewConfig, setPreviewConfig] = useState<BillLinePreviewConfig>({
    appIdentity: { logoUrl: "", logoBg: { enabled: false, color: "#ffffff" }, nameText: "" },
    features: { splitRentByResidents: false },
    overdue: { enabled: false, day: 5, type: "fixed", amount: 0 },
  });
  const [accessToken, setAccessToken] = useState("");

  const [tenant, setTenant] = useState({ tenantName: "", roomNumber: "", tel: "", contractStartDate: "", contractEndDate: "" });
  const [bills, setBills] = useState<BillRow[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRow[]>([]);
  const [tab, setTab] = useState<"bills" | "payments">("bills");

  const [selectedBill, setSelectedBill] = useState<BillRow | null>(null);
  const [detailData, setDetailData] = useState<{ item: any; monthYear: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [slipToView, setSlipToView] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await liffApi.getConfig();
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });
        setPreviewConfig({ appIdentity: cfg.appIdentity, features: cfg.features, overdue: cfg.overdue });

        const liffId = extractLiffId(cfg.liffProfileUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Profile URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const token = liff.getAccessToken();
        if (!token) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }
        setAccessToken(token);

        const result = await liffApi.profile(token);
        if (cancelled) return;
        if (result.linked) {
          setTenant(result.tenant);
          setBills(result.bills);
          setPaymentHistory(result.paymentHistory);
          setStatus("linked");
        } else {
          setStatus("unlinked");
        }
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.response?.data?.error ?? e?.message ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function openDetail(bill: BillRow) {
    setSelectedBill(bill);
    setDetailData(null);
    setLoadingDetail(true);
    try {
      const result = await liffApi.billDetail(accessToken, bill.billId, bill.roomId);
      setDetailData(result);
    } catch {
      setDetailData(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  if (status === "loading" || status === "error" || status === "unlinked") {
    return (
      <div className="login-page-wrap">
        <div className="login-card custom-card text-center">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-user" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "ข้อมูลผู้เช่า"}</h5>
          {status === "loading" && (
            <div className="py-4">
              <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              <p className="text-muted small mt-3 mb-0">กำลังโหลดข้อมูล...</p>
            </div>
          )}
          {status === "error" && (
            <div className="room-modal-error mt-3"><i className="fas fa-exclamation-circle me-2" />{errorMsg}</div>
          )}
          {status === "unlinked" && (
            <div className="room-modal-error mt-3 text-start">
              <i className="fas fa-exclamation-circle me-2" />ยังไม่พบข้อมูลผู้เช่าที่ผูกกับบัญชี LINE นี้ กรุณาติดต่อผู้ดูแลหอพักเพื่อผูกบัญชีก่อน
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card" style={{ maxWidth: 440 }}>
        <div className="text-center mb-3">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-user" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{tenant.tenantName}</h5>
        </div>

        <div className="p-3 rounded mb-3 small" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
          <div className="d-flex justify-content-between mb-1"><span className="text-muted">ห้อง</span><span className="fw-bold">{tenant.roomNumber || "-"}</span></div>
          <div className="d-flex justify-content-between mb-1"><span className="text-muted">เบอร์โทร</span><span>{tenant.tel || "-"}</span></div>
          <div className="d-flex justify-content-between mb-1"><span className="text-muted">เริ่มสัญญา</span><span>{tenant.contractStartDate ? thaiDateOnlyString(new Date(tenant.contractStartDate)) : "-"}</span></div>
          <div className="d-flex justify-content-between"><span className="text-muted">สิ้นสุดสัญญา</span><span>{tenant.contractEndDate ? thaiDateOnlyString(new Date(tenant.contractEndDate)) : "-"}</span></div>
        </div>

        <div className="d-flex gap-2 mb-3">
          <button className={`btn btn-sm flex-grow-1 ${tab === "bills" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTab("bills")}>
            <i className="fas fa-file-invoice me-1" />บิลทั้งหมด
          </button>
          <button className={`btn btn-sm flex-grow-1 ${tab === "payments" ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => setTab("payments")}>
            <i className="fas fa-receipt me-1" />ประวัติการชำระ
          </button>
        </div>

        <div className="d-flex flex-column gap-2" style={{ maxHeight: 360, overflowY: "auto" }}>
          {tab === "bills" ? (
            bills.length === 0 ? (
              <div className="text-muted small text-center py-3">ยังไม่มีข้อมูลบิล</div>
            ) : bills.map((b) => (
              <div key={`${b.billId}-${b.roomId}`} className="p-2 rounded d-flex justify-content-between align-items-center" style={{ border: "1px solid var(--color-light)" }}>
                <div>
                  <div className="small fw-bold">{monthYearLabel(b.monthYear)}</div>
                  <BillStatusBadge bill={b} />
                </div>
                <div className="text-end">
                  <div className="small text-muted">{fmtMoney(b.total)} ฿</div>
                  <button className="btn btn-sm btn-outline-secondary mt-1" onClick={() => openDetail(b)}>ดูรายละเอียด</button>
                </div>
              </div>
            ))
          ) : (
            paymentHistory.length === 0 ? (
              <div className="text-muted small text-center py-3">ยังไม่มีประวัติการชำระ</div>
            ) : paymentHistory.map((p) => (
              <div key={p.id} className="p-2 rounded" style={{ border: "1px solid var(--color-light)", opacity: p.cancelled ? 0.5 : 1 }}>
                <div className="d-flex justify-content-between align-items-center">
                  <span className="small">{p.paymentDate ? thaiDateOnlyString(new Date(p.paymentDate)) : "-"} — {monthYearLabel(p.monthYear)}</span>
                  <span className="fw-bold">{fmtMoney(p.amount)} ฿</span>
                </div>
                <div className="d-flex justify-content-between align-items-center">
                  <div className="small text-muted">
                    {p.method === "scan" ? "สแกน/โอน" : "เงินสด"}{p.cancelled ? " · ยกเลิกแล้ว" : ""}{p.note ? ` · ${p.note}` : ""}
                  </div>
                  {p.slipUrl && (
                    <button className="btn btn-sm btn-outline-secondary py-0 px-2" onClick={() => setSlipToView(p.slipUrl)}>
                      <i className="fas fa-image me-1" />ดูสลิป
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedBill && (
        <div className="confirm-overlay" onClick={() => setSelectedBill(null)}>
          <div className="confirm-dialog" style={{ maxWidth: 400, width: "92%", textAlign: "left", padding: 0, background: "transparent", boxShadow: "none" }} onClick={(e) => e.stopPropagation()}>
            {loadingDetail ? (
              <div className="text-center p-5" style={{ background: "#fff", borderRadius: 14 }}>
                <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              </div>
            ) : detailData ? (
              <BillLinePreview item={detailData.item} monthYear={detailData.monthYear} config={previewConfig} />
            ) : (
              <div className="room-modal-error p-3" style={{ background: "#fff", borderRadius: 14 }}>โหลดรายละเอียดบิลไม่สำเร็จ</div>
            )}
            <button className="btn btn-outline-secondary w-100 mt-2" onClick={() => setSelectedBill(null)}>ปิด</button>
          </div>
        </div>
      )}

      {slipToView && (
        <ImageLightbox images={[slipToView]} index={0} onClose={() => setSlipToView(null)} onIndexChange={() => {}} />
      )}
    </div>
  );
}
