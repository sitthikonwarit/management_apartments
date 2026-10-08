import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAppConfig, resolveNameCharColor } from "../../context/AppConfigContext";
import { guardNavigation } from "../../utils/unsavedGuard";
import { chatApi } from "../../api/client";
import { useLiveRefreshTick } from "../../utils/useLiveSync";
import { useHiddenMenus } from "../../utils/useHiddenMenus";

const CLOSE_ANIM_MS = 400;

export const navItems = [
  { to: "/tenants", icon: "person_outline", label: "ผู้เช่า" },
  { to: "/rooms", icon: "meeting_room", label: "ห้องพัก" },
  { to: "/meters", icon: "speed", label: "จดมิเตอร์" },
  { to: "/bills", icon: "receipt", label: "บิล/แจ้งหนี้" },
  { to: "/vehicles", icon: "directions_car", label: "ยานพาหนะ" },
  { to: "/chat", icon: "chat", label: "แชท LINE" },
  { to: "/settings", icon: "settings", label: "Settings" },
  { to: "/logs", icon: "history", label: "Log กิจกรรม" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

type Phase = "closed" | "open" | "closing";

export default function Sidebar({ open, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const { config } = useAppConfig();
  const { logoUrl, logoBg, nameText, nameColors } = config.appIdentity;
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const prevOpenRef = useRef(open);
  const [chatUnread, setChatUnread] = useState(0);
  const [hiddenMenus] = useHiddenMenus();

  // นับข้อความแชท LINE ที่ยังไม่อ่านรวมทุกการสนทนา ไว้ขึ้นแบดจ์ที่เมนู "แชท LINE" — โหลดครั้งแรกตอน mount
  // แล้วรีเฟรชทุกครั้งที่มีข้อความเข้าใหม่/มีการมาร์คอ่านจากที่อื่น (ผ่าน WebSocket "chat" broadcast เดียวกับ
  // ที่หน้าแชทใช้ ดู utils/useLiveSync.ts)
  const chatLiveTick = useLiveRefreshTick(["chat"]);
  useEffect(() => {
    chatApi.getConversations()
      .then((rows) => setChatUnread(rows.reduce((sum, c) => sum + c.unreadCount, 0)))
      .catch(() => {});
  }, [chatLiveTick]);

  // อัปเดต phase ระหว่าง render (ไม่ใช่ใน useEffect) เพื่อกัน frame ที่ className ว่างเปล่า
  // ซึ่งจะทำให้ CSS default (display:none) ทำงานก่อนแล้วค่อยเด้งกลับมาเล่นแอนิเมชันปิด (บัคกระพริบ)
  if (open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    setPhase(open ? "open" : "closing");
  }

  useEffect(() => {
    if (phase !== "closing") return;
    const timer = setTimeout(() => setPhase("closed"), CLOSE_ANIM_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const closing = phase === "closing";

  return (
    <>
      <aside className={phase === "open" ? "mobile-open" : closing ? "mobile-closing" : ""}>
        <div className="toggle">
          <div className="logo">
            <img
              src={logoUrl}
              alt="Logo"
              style={{
                width: "2rem", height: "2rem", objectFit: "contain",
                backgroundColor: logoBg.enabled ? logoBg.color : "transparent",
                borderRadius: logoBg.enabled ? 6 : 0,
              }}
            />
            <h2>
              {[...nameText].map((char, i) => (
                <span key={i} style={{ color: resolveNameCharColor(nameColors[i]) }}>{char}</span>
              ))}
            </h2>
          </div>
          <div className="close" id="close-btn" onClick={onClose}>
            <span className="material-icons-sharp">close</span>
          </div>
        </div>

        <div className="sidebar">
          {navItems.filter((item) => item.to === "/settings" || !hiddenMenus.includes(item.to)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => isActive ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                const go = () => { onClose(); navigate(item.to); };
                if (guardNavigation(go)) go();
              }}
            >
              <span className="sidebar-icon-wrap">
                <span className="material-icons-sharp">{item.icon}</span>
                {item.to === "/chat" && chatUnread > 0 && (
                  <span className="sidebar-badge">{chatUnread > 99 ? "99+" : chatUnread}</span>
                )}
              </span>
              <h3>{item.label}</h3>
            </NavLink>
          ))}
        </div>
      </aside>
      {/* พื้นหลังทึบตอนเปิดเมนูบนมือถือ — แตะเพื่อปิดเมนู (คงอยู่ระหว่าง closing เพื่อเล่น fadeOut พร้อมเมนู) */}
      {phase !== "closed" && (
        <div className={`mobile-menu-backdrop${closing ? " closing" : ""}`} onClick={onClose} />
      )}
    </>
  );
}
