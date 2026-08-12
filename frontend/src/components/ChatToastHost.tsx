import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { chatApi } from "../api/client";
import { AVATAR_URL } from "./TenantTableView";

interface ChatToast {
  id: string;
  kind: "message" | "presence";
  lineUserId: string;
  displayName: string;
  roomNumber: string | null;
  pictureUrl: string | null;
  preview: string;
  read: boolean;
  dismissing: boolean;
}

const AUTO_DISMISS_MS = 6000;
const PRESENCE_DISMISS_MS = 5000; // ป้าย "กำลังใช้งาน..." หายเร็วกว่าข้อความจริง แค่บอกสถานะชั่วคราวเฉยๆ
const FADE_MS = 300;

// ป็อปอัพแจ้งเตือนข้อความแชท LINE ใหม่ มุมขวาล่างของจอ — เมาท์ครั้งเดียวที่ระดับ shell (App.tsx) ให้เด้ง
// ได้ทุกหน้า ไม่ใช่แค่ตอนเปิดหน้าแชทอยู่ ฟังอีเวนต์ "chat:new-message" (ยิงเฉพาะข้อความเข้าจากผู้เช่าจริงๆ
// ดู backend/src/routes/lineWebhook.ts — ไม่เด้งซ้ำตอนพนักงาน/ระบบส่งออกไปเอง) หายไปเองหลัง 6 วิ และถ้า
// ระหว่างที่ยังค้างอยู่ conversation นั้นถูกมาร์คอ่านแล้ว (เช่น พนักงานเปิดหน้าแชทดูอยู่พอดี) จะขึ้น "อ่านแล้ว"
// แทนที่จะปล่อยให้ดูเหมือนยังไม่มีใครสนใจ
export default function ChatToastHost() {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<ChatToast[]>([]);
  const toastsRef = useRef<ChatToast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => { toastsRef.current = toasts; }, [toasts]);

  function removeToast(id: string) {
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), FADE_MS);
  }

  // กดที่ตัวป็อปอัพ (ยกเว้นปุ่ม ×) ให้นำทางไปหน้าแชทและเปิดสนทนานั้นตรงๆ ทันที ผ่าน location.state
  // แบบเดียวกับ deep-link ของหน้าอื่นๆ (ดู BillsPage openBillId) — ChatPage จะอ่านค่านี้แล้วเลือกให้เอง
  function handleToastClick(t: ChatToast) {
    removeToast(t.id);
    navigate("/chat", { state: { openLineUserId: t.lineUserId } });
  }

  useEffect(() => {
    function handleNewMessage(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.lineUserId) return;
      const id = `${detail.lineUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const toast: ChatToast = {
        id, kind: "message", lineUserId: detail.lineUserId, displayName: detail.displayName || "ไม่ทราบชื่อ",
        roomNumber: detail.roomNumber || null, pictureUrl: detail.pictureUrl || null,
        preview: detail.preview || "", read: false, dismissing: false,
      };
      setToasts((prev) => [...prev, toast]);
      timersRef.current.set(id, setTimeout(() => removeToast(id), AUTO_DISMISS_MS));
    }

    // ผู้เช่า/ผู้มาเยือนเปิดหน้า LIFF หน้าใดหน้าหนึ่งอยู่ (ไม่ใช่ข้อความจริง ไม่บันทึกลง DB — ดู
    // backend/src/lib/wsHub.ts broadcastWebPresence) เด้งเป็นป็อปอัพแบบเดียวกันแต่หน้าตาต่างกันเล็กน้อยและ
    // หายเร็วกว่า (PRESENCE_DISMISS_MS) เพราะเป็นแค่สถานะชั่วคราว ไม่ใช่เรื่องที่ต้องรอให้พนักงานอ่าน
    function handleWebPresence(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.lineUserId) return;
      const id = `${detail.lineUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const toast: ChatToast = {
        id, kind: "presence", lineUserId: detail.lineUserId, displayName: detail.displayName || "ไม่ทราบชื่อ",
        roomNumber: detail.roomNumber || null, pictureUrl: detail.pictureUrl || null,
        preview: `กำลังใช้งานหน้า ${detail.pageLabel || ""} ผ่าน web`, read: false, dismissing: false,
      };
      setToasts((prev) => [...prev, toast]);
      timersRef.current.set(id, setTimeout(() => removeToast(id), PRESENCE_DISMISS_MS));
    }

    function handleChatChange(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.entityType !== "chat") return;
      if (toastsRef.current.length === 0 || toastsRef.current.every((t) => t.read)) return;
      chatApi.getConversations()
        .then((rows) => {
          const unreadMap = new Map(rows.map((r) => [r.lineUserId, r.unreadCount]));
          setToasts((cur) => cur.map((t) => (!t.read && unreadMap.get(t.lineUserId) === 0 ? { ...t, read: true } : t)));
        })
        .catch(() => {});
    }

    window.addEventListener("chat:new-message", handleNewMessage);
    window.addEventListener("chat:web-presence", handleWebPresence);
    window.addEventListener("live:change", handleChatChange);
    return () => {
      window.removeEventListener("chat:new-message", handleNewMessage);
      window.removeEventListener("chat:web-presence", handleWebPresence);
      window.removeEventListener("live:change", handleChatChange);
      timersRef.current.forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="chat-toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="button"
          onClick={() => handleToastClick(t)}
          style={{
            background: "var(--color-white)", borderRadius: "var(--border-radius-1)", boxShadow: "var(--box-shadow)",
            border: "1px solid var(--color-light)",
            borderLeft: t.kind === "presence" ? "3px solid var(--color-info, #3b82f6)" : "1px solid var(--color-light)",
            padding: 12,
            display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
            animation: "slideUp 0.3s ease", opacity: t.dismissing ? 0 : 1, transition: "opacity 0.3s ease",
          }}
        >
          <img
            src={t.pictureUrl || AVATAR_URL} alt="" referrerPolicy="no-referrer"
            style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).src = AVATAR_URL; }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="d-flex justify-content-between align-items-start">
              <strong className="small text-truncate" style={{ maxWidth: 190 }}>
                {t.displayName}{t.roomNumber ? ` · ห้อง ${t.roomNumber}` : ""}
              </strong>
              <button
                type="button" onClick={(e) => { e.stopPropagation(); removeToast(t.id); }}
                style={{ background: "none", border: "none", color: "var(--color-dark-variant)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 6, flexShrink: 0 }}
              >
                ×
              </button>
            </div>
            <div className="text-muted small text-truncate">
              {t.kind === "presence" && <i className="fas fa-desktop me-1" />}
              {t.preview}
            </div>
            {t.read && (
              <div style={{ color: "var(--color-success)", fontSize: 11, marginTop: 3 }}>
                <i className="fas fa-check-double me-1" />อ่านแล้ว
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
