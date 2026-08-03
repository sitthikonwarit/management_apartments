import { createContext, useContext, useEffect, useState } from "react";
import { settingsApi } from "../api/client";
import { setGlobalYearFormat, type YearFormat } from "../utils/yearFormat";
import { useAuth } from "./AuthContext";
import { useLiveRefreshTick } from "../utils/useLiveSync";

export interface AppIdentity {
  logoUrl: string;
  logoBg: { enabled: boolean; color: string };
  nameText: string;
  nameColors: string[];
}

export interface AppConfig {
  electricRate: number;
  waterRate: number;
  overdue: { enabled: boolean; day: number; type: "fixed" | "daily"; amount: number };
  appIdentity: AppIdentity;
  features: { liveMeterEnabled: boolean; splitRentByResidents: boolean };
  meterDigits: number; // จำนวนหลักสูงสุดที่กรอกเลขมิเตอร์ได้ (ค่าเริ่มต้น 5 หลัก = 0-99999)
  yearFormat: YearFormat;
  // นาทีที่ไม่มีการใช้งานแล้วให้เด้งออกจากระบบ (auto-logout) อัตโนมัติ — 0 = ปิดใช้งาน
  sessionTimeoutMinutes: number;
  // ส่งบิลแจ้งเตือนทาง LINE (LINE Messaging API) — ต้องกรอก Channel Access Token ของ LINE OA ก่อน
  lineMessaging: { enabled: boolean; channelAccessToken: string; channelSecret: string; autoSendEnabled: boolean };
  // LINE Rich Menu (Guest/Member/Admin) — ตั้งค่า/สร้างได้จากหน้า Settings > LINE Rich Menu
  richMenu: {
    liffLoginUrl: string;
    liffPaymentUrl: string;
    images: { guest: string; member: string; admin: string };
    menuIds: { guest: string; member: string; admin: string };
  };
  // ข้อมูลบัญชีรับชำระเงิน — แสดงในหน้า LIFF Payment ให้ผู้เช่าโอนเงินเอง
  payment: { bankName: string; accountName: string; accountNumber: string; qrImage: string };
  updatedAt?: string;
}

// สีตัวอักษรเริ่มต้น (ยังไม่ถูกกำหนดเอง) — ใช้เป็น sentinel เพื่อปล่อยให้ CSS
// ของแต่ละธีมกำหนดสีเอง (var(--color-dark)) แทนที่จะ fix เป็นสีเข้มตายตัว
// ซึ่งจะมองไม่เห็นเมื่อสลับเป็น Dark Mode
export const NAME_CHAR_DEFAULT = "#363949";

export function resolveNameCharColor(color: string | undefined): string | undefined {
  if (!color || color.toLowerCase() === NAME_CHAR_DEFAULT.toLowerCase()) return undefined;
  return color;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  electricRate: 0,
  waterRate: 0,
  overdue: { enabled: false, day: 5, type: "fixed", amount: 0 },
  appIdentity: {
    logoUrl: "https://placehold.co/40x40/6C9BCF/FFFFFF?text=L",
    logoBg: { enabled: false, color: "#ffffff" },
    nameText: "บ้านบุญอัมพร",
    nameColors: [],
  },
  features: { liveMeterEnabled: true, splitRentByResidents: false },
  meterDigits: 5,
  yearFormat: "BE",
  sessionTimeoutMinutes: 30,
  lineMessaging: { enabled: false, channelAccessToken: "", channelSecret: "", autoSendEnabled: false },
  richMenu: {
    liffLoginUrl: "", liffPaymentUrl: "",
    images: { guest: "", member: "", admin: "" },
    menuIds: { guest: "", member: "", admin: "" },
  },
  payment: { bankName: "", accountName: "", accountNumber: "", qrImage: "" },
};

const AppConfigContext = createContext<{
  config: AppConfig;
  loading: boolean;
  setConfig: (c: AppConfig) => void;
  refresh: () => Promise<void>;
}>({
  config: DEFAULT_APP_CONFIG,
  loading: true,
  setConfig: () => {},
  refresh: async () => {},
});

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [loading, setLoading] = useState(true);

  // ซิงก์ค่ากลาง (global) แบบ synchronous ระหว่าง render (ไม่ใช่ใน useEffect) เพื่อให้ลูกๆ
  // ที่ render ต่อจากนี้ในรอบเดียวกันอ่านค่าล่าสุดได้ทันที ไม่มีเฟรมที่ค่าค้าง (stale)
  setGlobalYearFormat(config.yearFormat);

  async function refresh() {
    // /settings/config ต้องล็อกอินก่อนถึงจะเรียกได้ (backend ป้องกันไว้) — ยังไม่ล็อกอิน (เช่น อยู่หน้า
    // login) ก็ปล่อยให้ใช้ค่าเริ่มต้นไปก่อน ไม่ต้องยิง request ที่รู้อยู่แล้วว่าจะโดน 401
    if (!user) { setConfig(DEFAULT_APP_CONFIG); setLoading(false); return; }
    try {
      const data = await settingsApi.getConfig();
      setConfig({
        ...DEFAULT_APP_CONFIG,
        ...data,
        appIdentity: { ...DEFAULT_APP_CONFIG.appIdentity, ...data.appIdentity },
        overdue: { ...DEFAULT_APP_CONFIG.overdue, ...data.overdue },
        features: { ...DEFAULT_APP_CONFIG.features, ...data.features },
        lineMessaging: { ...DEFAULT_APP_CONFIG.lineMessaging, ...data.lineMessaging },
        richMenu: {
          ...DEFAULT_APP_CONFIG.richMenu, ...data.richMenu,
          images: { ...DEFAULT_APP_CONFIG.richMenu.images, ...data.richMenu?.images },
          menuIds: { ...DEFAULT_APP_CONFIG.richMenu.menuIds, ...data.richMenu?.menuIds },
        },
        payment: { ...DEFAULT_APP_CONFIG.payment, ...data.payment },
      });
    } finally {
      setLoading(false);
    }
  }

  // โหลด/โหลดใหม่ทุกครั้งที่สถานะล็อกอินเปลี่ยน (ล็อกอินสำเร็จ → ดึงค่าจริง, ออกจากระบบ → กลับเป็นค่าเริ่มต้น)
  useEffect(() => { refresh(); }, [user]);

  // มีคนแก้ไขการตั้งค่าระบบที่เครื่องอื่น — ดึงค่าใหม่ทันที เพราะ context นี้ใช้ร่วมกันทุกหน้า
  // การเปลี่ยนแปลงจะกระจายไปทุกที่ที่เรียก useAppConfig() โดยอัตโนมัติ ไม่ต้องแก้ทีละหน้า
  const configLiveTick = useLiveRefreshTick(["settings"]);
  useEffect(() => {
    if (configLiveTick === 0) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLiveTick]);

  return (
    <AppConfigContext.Provider value={{ config, loading, setConfig, refresh }}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  return useContext(AppConfigContext);
}
