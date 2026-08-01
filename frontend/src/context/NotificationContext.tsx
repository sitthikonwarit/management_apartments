import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";

export interface AppNotification {
  id: string;
  entityType: string;
  action: string;
  label: string;
  username: string;
  timestamp: string;
  read: boolean;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
});

const MAX_NOTIFICATIONS = 30;

// ฟัง event "live:change" ที่ useLiveSyncConnection ยิงออกมาทุกครั้งที่ WebSocket ได้รับแจ้งว่ามีการ
// เปลี่ยนแปลงข้อมูล (จาก backend, ดู wsHub.broadcastChange) แล้วเก็บเป็นรายการแจ้งเตือนไว้ในความจำ
// (ไม่ persist ข้ามการโหลดหน้าใหม่ — เป็น real-time only ตามที่มีอยู่แล้วในระบบ)
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.type !== "change" || !detail.label) return;
      // ข้ามการกระทำของตัวเอง — มี Toast แจ้งอยู่แล้วตอนกดบันทึก/ลบเอง ไม่ต้องซ้ำที่กระดิ่งอีก
      if (detail.actorUsername && detail.actorUsername === userRef.current?.username) return;
      setNotifications((prev) => [
        {
          id: `${detail.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          entityType: detail.entityType,
          action: detail.action,
          label: detail.label,
          username: detail.actorUsername ?? "",
          timestamp: detail.timestamp,
          read: false,
        },
        ...prev,
      ].slice(0, MAX_NOTIFICATIONS));
    }
    window.addEventListener("live:change", handler);
    return () => window.removeEventListener("live:change", handler);
  }, []);

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
