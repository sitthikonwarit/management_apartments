// หน้า LIFF Payment — ปลายทางของปุ่มชำระเงินบนเมนู Member (LIFF Payment URL ที่ตั้งค่าไว้ในหน้า Settings >
// LINE Rich Menu) แสดงยอดค้างชำระของผู้เช่าคนนั้น + ข้อมูลบัญชี/QR รับเงิน (ตั้งค่าไว้ในหน้า Settings >
// ระบบบิล > ข้อมูลบัญชีรับชำระเงิน) ไม่มีการอัปโหลดสลิปในหน้านี้ — ผู้เช่าส่งสลิปกลับเข้าแชท LINE ตามปกติ
// พนักงานเป็นคนบันทึกยอด/ยืนยันการชำระในหน้าเว็บเหมือนเดิม
import { useEffect, useState } from "react";
import liff from "@line/liff";
import { liffApi } from "../api/client";
import { extractLiffId } from "../utils/liffHelpers";
import { monthYearLabel } from "../utils/billCalc";

type Status = "loading" | "linked" | "unlinked" | "error";

function fmtMoney(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
}

export default function LiffPaymentPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [items, setItems] = useState<{ billId: string; monthYear: string; roomNumber: string; amount: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [paymentInfo, setPaymentInfo] = useState({ bankName: "", accountName: "", accountNumber: "", qrImage: "" });
  const [branding, setBranding] = useState({ logoUrl: "", nameText: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await liffApi.getConfig();
        if (cancelled) return;
        setBranding({ logoUrl: cfg.appIdentity.logoUrl, nameText: cfg.appIdentity.nameText });

        const liffId = extractLiffId(cfg.liffPaymentUrl);
        if (!liffId) { setErrorMsg("ระบบยังไม่ได้ตั้งค่า LIFF Payment URL กรุณาติดต่อผู้ดูแลระบบ"); setStatus("error"); return; }

        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }

        const accessToken = liff.getAccessToken();
        if (!accessToken) { setErrorMsg("ไม่พบ Access Token จาก LINE กรุณาลองใหม่อีกครั้ง"); setStatus("error"); return; }

        const result = await liffApi.payment(accessToken);
        if (cancelled) return;
        if (result.linked) {
          setTenantName(result.tenantName);
          setRoomNumber(result.roomNumber);
          setItems(result.outstanding.items);
          setTotal(result.outstanding.total);
          setPaymentInfo(result.paymentInfo);
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

  function copyAccountNumber() {
    navigator.clipboard.writeText(paymentInfo.accountNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (status === "loading" || status === "error") {
    return (
      <div className="login-page-wrap">
        <div className="login-card custom-card text-center">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-wallet" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "ชำระเงิน"}</h5>
          {status === "loading" ? (
            <div className="py-4">
              <div className="spinner-border" style={{ color: "var(--color-primary)" }} />
              <p className="text-muted small mt-3 mb-0">กำลังโหลดข้อมูล...</p>
            </div>
          ) : (
            <div className="room-modal-error mt-3"><i className="fas fa-exclamation-circle me-2" />{errorMsg}</div>
          )}
        </div>
      </div>
    );
  }

  if (status === "unlinked") {
    return (
      <div className="login-page-wrap">
        <div className="login-card custom-card text-center">
          <div className="login-icon"><i className="fas fa-wallet" /></div>
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{branding.nameText || "ชำระเงิน"}</h5>
          <div className="room-modal-error mt-3 text-start">
            <i className="fas fa-exclamation-circle me-2" />ยังไม่พบข้อมูลผู้เช่าที่ผูกกับบัญชี LINE นี้ กรุณาติดต่อผู้ดูแลหอพักเพื่อผูกบัญชีก่อน
          </div>
        </div>
      </div>
    );
  }

  const fullySettled = total <= 0.005;

  return (
    <div className="login-page-wrap">
      <div className="login-card custom-card" style={{ maxWidth: 420 }}>
        <div className="text-center mb-3">
          {branding.logoUrl
            ? <img src={branding.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: "50%", margin: "0 auto", display: "block" }} />
            : <div className="login-icon"><i className="fas fa-wallet" /></div>}
          <h5 className="mt-3 mb-1" style={{ fontWeight: 700 }}>{tenantName}{roomNumber && ` · ห้อง ${roomNumber}`}</h5>
        </div>

        {fullySettled ? (
          <div className="alert alert-success text-center py-3 mb-3">
            <i className="fas fa-check-circle me-2" />ไม่มียอดค้างชำระในขณะนี้
          </div>
        ) : (
          <>
            <div className="p-3 rounded mb-3" style={{ background: "var(--color-background)", border: "1px solid var(--color-light)" }}>
              {items.map((it) => (
                <div key={it.billId} className="d-flex justify-content-between small mb-1">
                  <span className="text-muted">{monthYearLabel(it.monthYear)}</span>
                  <span>{fmtMoney(it.amount)} ฿</span>
                </div>
              ))}
              <hr className="my-2" />
              <div className="d-flex justify-content-between align-items-center">
                <span className="fw-bold">ยอดค้างชำระรวม</span>
                <span className="fw-bold fs-4" style={{ color: "var(--color-primary)" }}>{fmtMoney(total)} ฿</span>
              </div>
            </div>

            {(paymentInfo.qrImage || paymentInfo.accountNumber) ? (
              <div className="text-center">
                {paymentInfo.qrImage && (
                  <img src={paymentInfo.qrImage} alt="QR รับเงิน" style={{ width: "100%", maxWidth: 260, borderRadius: 8, border: "1px solid var(--color-light)" }} />
                )}
                {paymentInfo.accountNumber && (
                  <div className="mt-3 text-start small">
                    {paymentInfo.bankName && <div className="text-muted">ธนาคาร: {paymentInfo.bankName}</div>}
                    {paymentInfo.accountName && <div className="text-muted">ชื่อบัญชี: {paymentInfo.accountName}</div>}
                    <div className="input-group mt-1">
                      <input type="text" className="form-control font-monospace" readOnly value={paymentInfo.accountNumber} />
                      <button className="btn btn-outline-secondary" type="button" onClick={copyAccountNumber} title="คัดลอกเลขบัญชี">
                        <i className={`fas ${copied ? "fa-check" : "fa-copy"}`} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="alert alert-light border small mt-3 mb-0">
                  โอนเงินแล้วส่งรูปสลิปกลับมาที่แชทนี้ได้เลย พนักงานจะตรวจสอบและอัปเดตยอดให้
                </div>
              </div>
            ) : (
              <div className="alert alert-light border small mb-0">ยังไม่ได้ตั้งค่าข้อมูลบัญชีรับชำระเงิน กรุณาติดต่อผู้ดูแลหอพัก</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
