import { useEffect, useRef, useState } from "react";
import { getAuthToken } from "../api/client";

const RECONNECT_DELAY_MS = 3000;

// เชื่อมต่อ WebSocket ไปหลังบ้านครั้งเดียว (mount ที่ AuthenticatedShell) — ทุกข้อความที่ได้รับจะยิงต่อเป็น
// window CustomEvent "live:change" ให้หน้าไหนก็ได้ที่สนใจ entityType นั้นๆ ใช้ useLiveRefreshTick() รับต่อ
// enabled=false (ยังไม่ล็อกอิน/ล็อกหน้าจออยู่) จะตัดการเชื่อมต่อทันที
export function useLiveSyncConnection(enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = !enabled;
    if (!enabled) {
      wsRef.current?.close();
      return;
    }

    function connect() {
      if (stoppedRef.current) return;
      const token = getAuthToken();
      if (!token) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data?.type === "change" && data.entityType) {
            window.dispatchEvent(new CustomEvent("live:change", { detail: data }));
          } else if (data?.type === "chat-message") {
            // ข้อความแชทใหม่จากผู้เช่า (ไม่ใช่ที่เราส่งเอง) — พ่วงรูป/ชื่อ/ห้อง/ตัวอย่างข้อความมาด้วย
            // ให้ ChatToastHost เด้งเป็นป็อปอัพแจ้งเตือนมุมขวาล่างได้เลยโดยไม่ต้องยิง request ถามซ้ำ
            window.dispatchEvent(new CustomEvent("chat:new-message", { detail: data }));
          } else if (data?.type === "session-revoked") {
            // มีคน login ด้วยบัญชีเดียวกันจากเครื่อง/แท็บอื่น — เครื่องนี้ถูกแทนที่แล้ว บังคับออกจากระบบทันที
            window.dispatchEvent(new Event("auth:session-revoked"));
          }
        } catch {
          // ข้อความที่ parse ไม่ได้ ไม่ใช่เรื่องคอขาดบาดตาย ข้ามไปเฉยๆ
        }
      };
      // หลุดการเชื่อมต่อไม่ว่าเหตุผลอะไร (server รีสตาร์ท/เน็ตหลุด) ให้ลองต่อใหม่อัตโนมัติ
      ws.onclose = () => {
        if (stoppedRef.current) return;
        timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [enabled]);
}

// ใช้ในแต่ละหน้า: คืนค่าตัวนับที่จะเพิ่มขึ้นทุกครั้งที่มีการแจ้งเตือนว่า entityType ที่ระบุเปลี่ยนแปลง
// (จากอีกเครื่อง/อีกแท็บ) — เอาไปใส่ dependency array ของ useEffect ที่โหลดข้อมูลใหม่แบบเงียบๆ ได้เลย
// เริ่มที่ 0 เสมอ (ยังไม่มีการแจ้งเตือนมาถึง) ไม่ต้องกังวลเรื่อง refetch ซ้ำตอน mount ครั้งแรก
export function useLiveRefreshTick(entityTypes: string[]): number {
  const [tick, setTick] = useState(0);
  const typesRef = useRef(entityTypes);
  typesRef.current = entityTypes;

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.entityType) return;
      if (typesRef.current.includes(detail.entityType)) setTick((t) => t + 1);
    }
    window.addEventListener("live:change", handler);
    return () => window.removeEventListener("live:change", handler);
  }, []);

  return tick;
}
