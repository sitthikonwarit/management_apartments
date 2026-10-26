import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { authApi, getAuthToken, setAuthToken, clearAuthToken } from "../api/client";

export interface AuthUser {
  id: string;
  orgId: string;
  username: string;
  displayName: string;
  mustChangePassword?: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  // true = หมดเวลาไม่ได้ใช้งาน (idle timeout) — ต้องกรอกรหัสผ่านใหม่ก่อนถึงจะกลับเข้าหน้าเดิมได้
  // ต่างจาก user === null (ออกจากระบบจริง/โทเค็นหมดอายุ) ตรงที่ "รู้" ว่าเป็นใคร (ไม่ต้องพิมพ์ชื่อผู้ใช้ใหม่)
  // และพอปลดล็อกจะกลับไป route เดิมอัตโนมัติ — แต่ตอนล็อกอยู่ โทเค็นถูกล้างจริงและ UI ทั้งหมดถูก unmount
  // ไม่ใช่แค่ซ่อน/เบลอทับไว้เฉยๆ เพราะแบบนั้นข้อมูลที่โหลดไว้แล้วยังอยู่ใน DOM เปิด DevTools ลบ overlay
  // ออกก็เห็นข้อมูลจริงได้ทันที
  locked: boolean;
  // true = บัญชีนี้เพิ่งถูก login จากเครื่อง/แท็บอื่น ระบบบังคับ 1 บัญชีใช้ได้ทีละเซสชันเท่านั้น จึงเด้ง
  // เครื่องนี้ออกอัตโนมัติ — ใช้โชว์ข้อความอธิบายที่หน้า login แทนที่จะปล่อยให้งงว่าทำไมหลุดออกมาเฉยๆ
  sessionRevoked: boolean;
  login: (username: string, password: string) => Promise<void>;
  // เข้าสู่ระบบด้วยโทเค็นที่ backend ออกให้แล้ว (มาจากขั้นตอน LINE Login redirect — ดู
  // pages/LineLoginCallbackPage.tsx) ต่างจาก login() ตรงที่ไม่มี username/password ให้ยิง /auth/login เอง
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  lock: () => void;
  unlock: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  locked: false,
  sessionRevoked: false,
  login: async () => {},
  loginWithToken: async () => {},
  logout: () => {},
  refreshUser: async () => {},
  lock: () => {},
  unlock: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [sessionRevoked, setSessionRevoked] = useState(false);

  const logout = useCallback(() => {
    // ยิง log ออกจากระบบแบบ fire-and-forget "ก่อน" เคลียร์ token (endpoint นี้ต้องมี token ที่ยังใช้ได้)
    // ไม่ await เพราะการออกจากระบบฝั่ง UI ต้องเสร็จทันทีเสมอ ไม่ต้องรอเน็ตเวิร์ก
    if (getAuthToken()) authApi.logout().catch(() => {});
    clearAuthToken();
    setUser(null);
    setLocked(false);
  }, []);

  // ล็อกหน้าจอจริงๆ: ล้างโทเค็นทิ้ง (ไม่ใช่แค่ซ่อน UI) ให้ทุก API call ที่หลุดออกมาระหว่างล็อกโดน backend
  // ปฏิเสธด้วย 401 จริง — ผสานกับการ unmount ทั้งแอปใน App.tsx (ดูคอมเมนต์ AuthenticatedShell)
  const lock = useCallback(() => {
    clearAuthToken();
    setLocked(true);
  }, []);

  // ตอนโหลดแอปครั้งแรก ถ้ามีโทเค็นเก็บไว้อยู่แล้ว ให้เช็คกับ backend ว่ายังใช้ได้จริงไหม (/auth/me)
  useEffect(() => {
    const token = getAuthToken();
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then((u) => setUser(u))
      .catch(() => clearAuthToken())
      .finally(() => setLoading(false));
  }, []);

  // axios interceptor ยิง event นี้เมื่อเจอ 401 — แต่ตอนล็อกหน้าจออยู่ เรา "ตั้งใจ" ล้างโทเค็นเองอยู่แล้ว
  // (ดู lock() ด้านบน) ทุก request ที่หลุดออกมาระหว่างนี้ย่อมโดน 401 เป็นปกติ ไม่ใช่เซสชันหมดอายุจริง จึง
  // ต้องเพิกเฉยไป (ยังคงล็อกอยู่ต่อ) — 401 จะทำให้ออกจากระบบเต็มรูปแบบก็ต่อเมื่อไม่ได้ล็อกอยู่เท่านั้น
  useEffect(() => {
    const handler = () => {
      if (locked) return;
      setUser(null);
      setLocked(false);
    };
    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, [locked]);

  // มีคน login ด้วยบัญชีเดียวกันจากเครื่อง/แท็บอื่น (WebSocket แจ้งมาแบบเรียลไทม์) — ต้องออกจากระบบเต็ม
  // รูปแบบเสมอไม่ว่าจะกำลังล็อกหน้าจออยู่หรือไม่ก็ตาม (ไม่ใช่กรณีเดียวกับล็อกหน้าจอตัวเอง ที่ยัง unlock
  // กลับมาได้ด้วยรหัสผ่านเดิม — ที่นี่ token/เซสชันเดิมถูกแทนที่แล้วจริงๆ unlock ก็จะล้มเหลวอยู่ดี)
  useEffect(() => {
    const handler = () => {
      clearAuthToken();
      setUser(null);
      setLocked(false);
      setSessionRevoked(true);
    };
    window.addEventListener("auth:session-revoked", handler);
    return () => window.removeEventListener("auth:session-revoked", handler);
  }, []);

  async function refreshUser() {
    const u = await authApi.me();
    setUser(u);
  }

  async function login(username: string, password: string) {
    const res = await authApi.login(username, password);
    setAuthToken(res.token);
    setUser(res.user);
    setSessionRevoked(false);
  }

  // โทเค็นออกมาจาก backend แล้ว (ผ่านการ redirect กลับจาก LINE Login เรียบร้อย) แค่เก็บแล้วดึงข้อมูล
  // ผู้ใช้ปัจจุบันมาเติม state — ไม่มี username/password ให้เรียก /auth/login ซ้ำ
  async function loginWithToken(token: string) {
    setAuthToken(token);
    try {
      const u = await authApi.me();
      setUser(u);
      setSessionRevoked(false);
    } catch (e) {
      clearAuthToken();
      throw e;
    }
  }

  // ปลดล็อกหน้าจอ — ใช้ชื่อผู้ใช้เดิม (ไม่ต้องพิมพ์ใหม่) ยืนยันแค่รหัสผ่านแล้วต่อเซสชันเดิมที่หน้าเดิม
  async function unlock(password: string) {
    if (!user) throw new Error("ไม่พบผู้ใช้ปัจจุบัน");
    const res = await authApi.login(user.username, password);
    setAuthToken(res.token);
    setUser(res.user);
    setLocked(false);
  }

  return (
    <AuthContext.Provider value={{ user, loading, locked, sessionRevoked, login, loginWithToken, logout, refreshUser, lock, unlock }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
