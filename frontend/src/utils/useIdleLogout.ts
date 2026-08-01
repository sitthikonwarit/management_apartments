import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

// เด้ง onIdle() เมื่อไม่มีการกระทำใดๆ (ขยับเมาส์/คลิก/พิมพ์/สกอลล์/แตะจอ) เกิน timeoutMinutes นาที
// timeoutMinutes <= 0 = ปิดใช้งาน ไม่จับเวลาเลย
export function useIdleLogout(timeoutMinutes: number, onIdle: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // เก็บ callback ล่าสุดไว้ใน ref แทนการใส่ใน dependency array — กัน effect รีเซ็ต listener/timer
  // ทุกครั้งที่ onIdle เปลี่ยน identity (เช่น ผู้เรียกส่ง inline arrow function มาแบบไม่ได้ memo)
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!timeoutMinutes || timeoutMinutes <= 0) return;

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onIdleRef.current(), timeoutMinutes * 60 * 1000);
    }

    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeoutMinutes]);
}
