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

// วิธีเลือกว่าบัญชีนี้จะโชว์ให้ห้องไหนเห็นในหน้า LIFF Payment — "all" (ค่าเริ่มต้น) โชว์ให้ทุกห้อง, "rooms"/
// "tower"/"floor" เจาะจงเอง, "random"/"auto" ไม่เจาะจง แต่แบ่งกันเองในกลุ่มบัญชีที่ตั้งโหมดเดียวกันไว้ (สุ่ม/
// หมุนแบบคงที่ต่อห้อง ดู resolvePaymentAccountForRoom ฝั่ง backend routes/liff.ts — รายละเอียดตรรกะจริงอยู่ที่นั่น)
export type PaymentAccountAssignMode = "all" | "rooms" | "tower" | "floor" | "random" | "auto";
export interface PaymentAccountAssign {
  mode: PaymentAccountAssignMode;
  roomIds?: string[];
  towerIds?: string[];
  floors?: string[];
}
export interface PaymentAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImage: string;
  bankLogoImage: string;
  promptPayId: string;
  assign: PaymentAccountAssign;
}

export interface AppConfig {
  // รหัสองค์กร (?org=<slug>) ไว้ต่อท้าย Endpoint URL ของ LIFF app แต่ละองค์กรใน LINE Developers Console
  // (ดู resolveOrgId ใน backend/src/routes/liff.ts) — แสดงในหน้า Settings > LINE Messaging ให้ก็อปไปใช้
  orgSlug: string;
  electricRate: number;
  waterRate: number;
  // ค่าบริการต่อหน่วย (ส่วนเพิ่มจากค่าน้ำ/ค่าไฟฐาน) — เช่น ค่าไฟหน่วยละ 4 บาท + ค่าบริการหน่วยละ 3 บาท
  // displayMode เลือกได้ว่าจะรวมยอดค่าบริการเข้าบรรทัดค่าน้ำ/ค่าไฟเดียวกัน หรือแยกเป็นบรรทัดต่างหากในรายละเอียดบิล
  serviceFee: { enabled: boolean; waterRate: number; electricRate: number; displayMode: "combined" | "separate" };
  overdue: { enabled: boolean; day: number; type: "fixed" | "daily"; amount: number };
  // ปัดเศษยอดบิลลงเป็นหลัก unit บาท (เช่น unit=5: 4127 -> 4125) เฉพาะบิลที่ยังไม่เลยวันครบกำหนดชำระ
  // (ใช้วันครบกำหนดเดียวกับ overdue.day ด้านบน) — เปิด/ปิดได้ที่นี่ ไม่กระทบบิลเดือนเก่าที่ล็อกค่าไว้แล้ว
  rounding: { enabled: boolean; unit: number };
  appIdentity: AppIdentity;
  features: { liveMeterEnabled: boolean; splitRentByResidents: boolean };
  meterDigits: number; // จำนวนหลักสูงสุดที่กรอกเลขมิเตอร์ได้ (ค่าเริ่มต้น 5 หลัก = 0-99999)
  yearFormat: YearFormat;
  // นาทีที่ไม่มีการใช้งานแล้วให้เด้งออกจากระบบ (auto-logout) อัตโนมัติ — 0 = ปิดใช้งาน
  sessionTimeoutMinutes: number;
  // ส่งบิลแจ้งเตือนทาง LINE (LINE Messaging API) — ต้องกรอก Channel Access Token ของ LINE OA ก่อน
  lineMessaging: {
    enabled: boolean; channelAccessToken: string; channelSecret: string; autoSendEnabled: boolean;
    // ส่งบิลใบเดียวกันให้ "ผู้ร่วมพักอาศัย" ที่ผูก LINE User ID ไว้ด้วยพร้อมกับผู้ทำสัญญาหลัก
    sendBillToCoResidents: boolean;
  };
  // LINE Rich Menu (Guest/Member/Admin) — ตั้งค่า/สร้างได้จากหน้า Settings > LINE Rich Menu
  richMenu: {
    liffLoginUrl: string;
    liffPaymentUrl: string;
    // ปุ่ม "ข้อมูลผู้เช่า" / "แจ้งซ่อม" บนเมนู Member — ต้องเป็นหน้า LIFF แยก (คนละ LIFF app) เพราะต้องรู้
    // ตัวตนผู้เช่าเหมือน login/payment — ว่าง = ปุ่มยังเป็นข้อความส่งเข้าแชทแบบเดิม
    liffProfileUrl: string;
    liffRepairUrl: string;
    // ปุ่ม "ดูห้องว่าง"/"จองห้อง" บนเมนู Guest — คนละ LIFF app กัน (คนละหน้า) ไม่ต้องเป็นผู้เช่ามาก่อนก็เข้าได้
    // liffRoomsUrl = ดูรายการห้องว่าง+รายละเอียด, liffBookingUrl = จัดการห้องที่ตัวเองจอง/ยกเลิกเอง
    liffRoomsUrl: string;
    liffBookingUrl: string;
    // เบอร์ติดต่อที่แสดงในหน้า /contact (ปุ่ม "ติดต่อ" บนเมนู)
    contactPhone: string;
    // ลิงก์ที่ปุ่ม "ติดต่อ" เปิดโดยตรง — ว่าง = ใช้หน้า /contact ของระบบเองแทน
    contactUrl: string;
    images: { guest: string; member: string; admin: string };
    menuIds: { guest: string; member: string; admin: string };
  };
  // ข้อมูลบัญชีรับชำระเงิน — แสดงในหน้า LIFF Payment ให้ผู้เช่าโอนเงินเอง
  payment: {
    // ฟิลด์เดี่ยวเก่า — คงไว้เพื่อ backward-compat เท่านั้น หน้า Settings/LIFF ใช้ payment.accounts ด้านล่าง
    bankName: string; accountName: string; accountNumber: string; qrImage: string; bankLogoImage: string;
    // EasySlip — สร้าง QR PromptPay ระบุยอดเอง + ตรวจสลิปอัตโนมัติ (ต้องเปิด easySlipEnabled ด้วย ไม่ใช่แค่มี
    // API Key ถึงจะใช้งานจริง — ปิดสวิตช์ = ใช้ QR/เลขบัญชีคงที่แทนเสมอ) — ตั้งค่าเดียวทั้งองค์กร ไม่แยกต่อบัญชี
    // (API key เดียวกันใช้สร้าง QR ได้ทุกบัญชี แค่ PromptPay ID ต่างกันไปตามที่ตั้งไว้ในแต่ละบัญชี)
    easySlipEnabled: boolean; easySlipApiKey: string; promptPayId: string;
    // รองรับหลายบัญชีรับชำระเงิน — เลือกได้ว่าแต่ละบัญชีจะโชว์ให้ห้องไหนเห็น (ดู resolvePaymentAccountForRoom
    // ฝั่ง backend routes/liff.ts ที่ตัดสินใจจริงตอนผู้เช่าเปิดหน้า LIFF Payment)
    accounts: PaymentAccount[];
  };
  // องค์กรนี้ผ่านขั้นตอนตั้งค่าเริ่มต้นแล้วหรือยัง — false = AuthenticatedShell (App.tsx) บังคับพาไปหน้า
  // wizard ตั้งค่าเริ่มต้นค้างไว้ทุก route จนกว่าจะกดปุ่ม "เริ่มใช้งานระบบ" ในขั้นสุดท้าย (ดู
  // backend routes/settings.ts, frontend/src/pages/OnboardingWizard.tsx)
  setupCompleted: boolean;
  // ผ่านขั้น "ค่าน้ำไฟ" ใน wizard ตั้งค่าเริ่มต้นแล้วจริงหรือยัง — แยกจาก electricRate/waterRate > 0 เพราะ
  // องค์กรใหม่ถูกตั้งค่าเริ่มต้นให้ไม่เป็น 0 อยู่แล้ว (7/18 — ดู getOrCreateConfig ฝั่ง backend) เช็คแค่ > 0
  // จะเข้าใจผิดว่าผ่านขั้นนี้ไปแล้วทั้งที่ยังไม่เคยกดยืนยันเองเลย
  ratesConfirmed: boolean;
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
  orgSlug: "",
  electricRate: 0,
  waterRate: 0,
  serviceFee: { enabled: false, waterRate: 0, electricRate: 0, displayMode: "combined" },
  overdue: { enabled: false, day: 5, type: "fixed", amount: 0 },
  rounding: { enabled: false, unit: 5 },
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
  lineMessaging: { enabled: false, channelAccessToken: "", channelSecret: "", autoSendEnabled: false, sendBillToCoResidents: true },
  richMenu: {
    liffLoginUrl: "", liffPaymentUrl: "", liffProfileUrl: "", liffRepairUrl: "", liffRoomsUrl: "", liffBookingUrl: "", contactPhone: "", contactUrl: "",
    images: { guest: "", member: "", admin: "" },
    menuIds: { guest: "", member: "", admin: "" },
  },
  payment: { bankName: "", accountName: "", accountNumber: "", qrImage: "", bankLogoImage: "", easySlipEnabled: false, easySlipApiKey: "", promptPayId: "", accounts: [] },
  // ค่าเริ่มต้น "true" ตั้งใจ (fail open) — กันไม่ให้แอปแวบล็อกทุกคนไปหน้า Settings ระหว่างที่ยังโหลดค่าจริง
  // จาก backend ไม่เสร็จ (AuthenticatedShell เช็ค loading ของ context นี้ประกอบด้วยอยู่แล้ว แต่กันไว้อีกชั้น)
  setupCompleted: true,
  ratesConfirmed: false,
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
        serviceFee: { ...DEFAULT_APP_CONFIG.serviceFee, ...data.serviceFee },
        overdue: { ...DEFAULT_APP_CONFIG.overdue, ...data.overdue },
        rounding: { ...DEFAULT_APP_CONFIG.rounding, ...data.rounding },
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
