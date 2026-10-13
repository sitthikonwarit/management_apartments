import axios from "axios";

const api = axios.create({ baseURL: "/api" });

// ── โทเค็นเข้าสู่ระบบ — เก็บใน localStorage เดียวที่นี่ ให้ AuthContext เรียกใช้ร่วมกัน ────────
const TOKEN_STORAGE_KEY = "lineweb_auth_token";
export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}
export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}
export function clearAuthToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// โทเค็นหมดอายุ/ไม่ถูกต้อง (401) — เคลียร์โทเค็นแล้วยิง event ให้ AuthContext จัดการเด้งไปหน้า login
// (แยกจาก AuthContext เพราะไฟล์นี้เป็น plain module เรียก useNavigate ตรงๆ ไม่ได้)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && !err?.config?.url?.includes("/auth/login")) {
      clearAuthToken();
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post("/auth/login", { username, password }).then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
  logout: () => api.post("/auth/logout").then((r) => r.data),
  getUsers: () => api.get("/auth/users").then((r) => r.data),
  createUser: (username: string, password: string, displayName?: string, phone?: string) =>
    api.post("/auth/users", { username, password, displayName, phone }).then((r) => r.data),
  updateUser: (id: string, data: { displayName?: string; password?: string; phone?: string }) =>
    api.put(`/auth/users/${id}`, data).then((r) => r.data),
  deleteUser: (id: string) => api.delete(`/auth/users/${id}`).then((r) => r.data),
  // ── ขั้นตอน "ล็อกอินครั้งแรก" ของเจ้าของที่ superadmin สร้างองค์กรไว้ล่วงหน้าด้วยเบอร์โทร (ดู
  // routes/lineLogin.ts) — ยืนยันเบอร์ก่อน แล้วตั้ง username/password ของตัวเอง ก่อนจะกดเชื่อม LINE ต่อ
  checkFirstTimePhone: (phone: string) =>
    api.post("/auth/line/first-time/check-phone", { phone }).then((r) => r.data as { ok: true }),
  setFirstTimeCredentials: (phone: string, username: string, password: string, confirmPassword: string) =>
    api.post("/auth/line/first-time/set-credentials", { phone, username, password, confirmPassword }).then((r) => r.data as { ok: true }),
};

export const logsApi = {
  getAll: () => api.get("/logs").then((r) => r.data),
};

export const roomsApi = {
  getAll: () => api.get("/rooms").then((r) => r.data),
  create: (data: any) => api.post("/rooms", data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/rooms/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/rooms/${id}`).then((r) => r.data),
  bulkDelete: (ids: string[]) => api.post("/rooms/bulk-delete", { ids }).then((r) => r.data),
  generate: (towerId: string, roomsToCreate: any[]) =>
    api.post("/rooms/generate", { towerId, roomsToCreate }).then((r) => r.data),
  toggleActive: (id: string, isActive: boolean) =>
    api.patch(`/rooms/${id}/active`, { isActive }).then((r) => r.data),
  // ห้องที่มีคนจองเองผ่าน LIFF อยู่ (ยังไม่ได้ผูกเป็นผู้เช่าจริง) — ใช้แสดง "ผู้จอง" ในหน้าจัดการห้องพัก
  activeBookings: () => api.get("/rooms/bookings/active").then((r) => r.data as
    { id: string; roomId: string; roomNumber: string; name: string; tel: string; idLine: string; bookedAt: string }[]
  ),
  updatePictures: (id: string, keepUrls: string[], newImages: { base64: string; name: string }[]) =>
    api.patch(`/rooms/${id}/pictures`, { keepUrls, newImages }).then((r) => r.data),
  getTowers: () => api.get("/rooms/towers").then((r) => r.data),
  createTower: (data: any) => api.post("/rooms/towers", data).then((r) => r.data),
  updateTower: (id: string, data: any) => api.put(`/rooms/towers/${id}`, data).then((r) => r.data),
  deleteTower: (id: string) => api.delete(`/rooms/towers/${id}`).then((r) => r.data),
  toggleTowerActive: (id: string, isActive: boolean) =>
    api.patch(`/rooms/towers/${id}/active`, { isActive }).then((r) => r.data),
  getTags: () => api.get("/rooms/tags").then((r) => r.data),
  createTag: (data: any) => api.post("/rooms/tags", data).then((r) => r.data),
  updateTag: (id: string, data: any) => api.put(`/rooms/tags/${id}`, data).then((r) => r.data),
  deleteTag: (id: string) => api.delete(`/rooms/tags/${id}`).then((r) => r.data),
};

export const tenantsApi = {
  getAll: () => api.get("/tenants").then((r) => r.data),
  getTags: () => api.get("/tenants/tags").then((r) => r.data),
  createTag: (data: any) => api.post("/tenants/tags", data).then((r) => r.data),
  updateTag: (id: string, data: any) => api.put(`/tenants/tags/${id}`, data).then((r) => r.data),
  deleteTag: (id: string) => api.delete(`/tenants/tags/${id}`).then((r) => r.data),
  create: (body: any) => api.post("/tenants", body).then((r) => r.data),
  update: (id: string, body: any) => api.put(`/tenants/${id}`, body).then((r) => r.data),
  updateTags: (id: string, tags: string[]) =>
    api.patch(`/tenants/${id}/tags`, { tags }).then((r) => r.data),
  updateCoResidents: (id: string, coResidents: any[]) =>
    api.patch(`/tenants/${id}/co-residents`, { coResidents }).then((r) => r.data),
  updateRoom: (id: string, newRoomId: string) =>
    api.patch(`/tenants/${id}/room`, { newRoomId }).then((r) => r.data),
  updateExtraRooms: (id: string, extraRoomIds: string[]) =>
    api.patch(`/tenants/${id}/extra-rooms`, { extraRoomIds }).then((r) => r.data),
  delete: (id: string) => api.delete(`/tenants/${id}`).then((r) => r.data),
};

export const addressApi = {
  getProvinces: () => api.get("/address/provinces").then((r) => r.data),
  getAmphoes: (province: string) => api.get("/address/amphoes", { params: { province } }).then((r) => r.data),
  getTambons: (province: string, amphoe: string) => api.get("/address/tambons", { params: { province, amphoe } }).then((r) => r.data),
};

export const metersApi = {
  getAll:      () => api.get("/meters").then((r) => r.data),
  create:      (monthYear: string) => api.post("/meters", { monthYear }).then((r) => r.data),
  update:      (id: string, data: any) => api.put(`/meters/${id}`, { data }).then((r) => r.data),
  delete:      (id: string) => api.delete(`/meters/${id}`).then((r) => r.data),
  syncSheets:  () => api.post("/meters/sync-sheets").then((r) => r.data),
};

export const billsApi = {
  getAll: () => api.get("/bills").then((r) => r.data),
  getPayments: () => api.get("/bills/payments").then((r) => r.data),
  create: (monthYear: string, data: any[], scheduledDate?: string) =>
    api.post("/bills", { monthYear, data, scheduledDate }).then((r) => r.data),
  update: (id: string, data: any[], scheduledDate?: string) =>
    api.put(`/bills/${id}`, { data, scheduledDate }).then((r) => r.data),
  delete: (id: string, deletePayments?: boolean) =>
    api.delete(`/bills/${id}`, { params: deletePayments ? { deletePayments: "true" } : undefined }).then((r) => r.data),
  createPayment: (payload: {
    billId: string; roomId: string; roomNumber: string; tenantId: string | null; tenantName: string;
    monthYear: string; method: "cash" | "scan"; amount: number; received?: number; change?: number; note?: string;
    paymentDate: string; slipImage?: { base64: string; name: string } | null; operator?: string;
    billTotal: number; paidTotal: number; sendReceipt?: boolean;
    linkedOldMonthPayments?: { id: string; monthYear: string; amount: number }[];
    linkedOldMonthsCreditedAmount?: number;
    settledViaMonthYear?: string;
  }) => api.post("/bills/payments", payload).then((r) => r.data),
  cancelPayment: (id: string, reason: string) =>
    api.patch(`/bills/payments/${id}/cancel`, { reason }).then((r) => r.data),
  sendLine: (billId: string, roomId: string) =>
    api.post(`/bills/${billId}/send-line`, { roomId }).then((r) => r.data as { success: boolean; message: string; bill: any }),
};

export const vehiclesApi = {
  getAll:     () => api.get("/vehicles").then((r) => r.data),
  create:     (data: any) => api.post("/vehicles", data).then((r) => r.data),
  update:     (id: string, data: any) => api.put(`/vehicles/${id}`, data).then((r) => r.data),
  delete:     (id: string) => api.delete(`/vehicles/${id}`).then((r) => r.data),
  updateImages: (id: string, keepUrls: string[], newImages: { base64: string; name: string }[]) =>
    api.patch(`/vehicles/${id}/images`, { keepUrls, newImages }).then((r) => r.data),
  getTypes:   () => api.get("/vehicles/types").then((r) => r.data),
  createType: (data: any) => api.post("/vehicles/types", data).then((r) => r.data),
  updateType: (id: string, data: any) => api.put(`/vehicles/types/${id}`, data).then((r) => r.data),
  deleteType: (id: string) => api.delete(`/vehicles/types/${id}`).then((r) => r.data),
};

export const specialDiscountsApi = {
  getAll: () => api.get("/special-discounts").then((r) => r.data),
  create: (data: any) => api.post("/special-discounts", data).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/special-discounts/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/special-discounts/${id}`).then((r) => r.data),
};

export interface ChatConversation {
  lineUserId: string;
  tenantId: string | null;
  displayName: string;
  roomNumber: string | null;
  towerId: string | null;
  towerName: string | null;
  pictureUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastDirection: "in" | "out";
  unreadCount: number;
}

export interface ChatConversationInfo {
  lineUserId: string;
  pictureUrl: string | null;
  profileDisplayName: string | null;
  contactName: string | null;
  tenant: {
    id: string;
    fullName: string;
    tel: string;
    checkInDate: string;
    contractStartDate: string;
    contractEndDate: string;
  } | null;
  room: {
    number: string;
    floor: string;
    towerName: string;
    price: string;
    detail: string;
  } | null;
}

export interface OutstandingBillItem {
  billId: string;
  roomId?: string;
  monthYear: string;
  roomNumber: string;
  total: number;
  paidAmount: number;
  amount: number;
}

export interface OutstandingBills {
  tenantId: string | null;
  items: OutstandingBillItem[];
  total: number;
}

export interface ChatMessage {
  id: string;
  lineUserId: string;
  tenantId: string | null;
  direction: "in" | "out";
  messageType: string;
  text: string;
  imageUrl: string | null;
  fileUrl: string | null;
  fileName: string | null;
  packageId: string | null;
  stickerId: string | null;
  senderName: string;
  createdAt: string;
  read: boolean;
}

export const chatApi = {
  // โควตาข้อความ push/broadcast คงเหลือของรอบเดือนนี้ (แพลนฟรีของ LINE OA จำกัดจำนวนข้อความ/เดือน) — null
  // ถ้ายังไม่ได้ตั้งค่า LINE Messaging หรือเรียก LINE API ไม่สำเร็จ (ดู GET /chat/quota ฝั่ง backend)
  getQuota: () => api.get("/chat/quota").then((r) => r.data as {
    type: "limited" | "none"; limit: number; used: number; remaining: number | null;
  } | null),
  getConversations: () => api.get("/chat/conversations").then((r) => r.data as ChatConversation[]),
  getMessages: (lineUserId: string) =>
    api.get(`/chat/conversations/${lineUserId}/messages`).then((r) => r.data as ChatMessage[]),
  sendReply: (lineUserId: string, text: string) =>
    api.post(`/chat/conversations/${lineUserId}/reply`, { text }).then((r) => r.data as ChatMessage),
  sendAttachment: (lineUserId: string, base64: string, name: string) =>
    api.post(`/chat/conversations/${lineUserId}/send-attachment`, { base64, name }).then((r) => r.data as ChatMessage),
  sendSticker: (lineUserId: string, packageId: string, stickerId: string) =>
    api.post(`/chat/conversations/${lineUserId}/send-sticker`, { packageId, stickerId }).then((r) => r.data as ChatMessage),
  markRead: (lineUserId: string) =>
    api.patch(`/chat/conversations/${lineUserId}/read`).then((r) => r.data),
  refreshProfile: (lineUserId: string) =>
    api.post(`/chat/conversations/${lineUserId}/refresh-profile`).then((r) => r.data as { pictureUrl: string | null; displayName: string | null }),
  getConversationInfo: (lineUserId: string) =>
    api.get(`/chat/conversations/${lineUserId}/info`).then((r) => r.data as ChatConversationInfo),
  getOutstandingBills: (lineUserId: string) =>
    api.get(`/chat/conversations/${lineUserId}/outstanding-bills`).then((r) => r.data as OutstandingBills),
  confirmRepair: (lineUserId: string, messageId: string, data: {
    items: { name: string; price: number; qty: number }[]; note: string; photos: string[];
  }) => api.patch(`/chat/conversations/${lineUserId}/messages/${messageId}/repair`, data).then((r) => r.data as ChatMessage),
  confirmPayment: (lineUserId: string, messageId: string, action: "confirm" | "reject", reason?: string) =>
    api.patch(`/chat/conversations/${lineUserId}/messages/${messageId}/payment-confirm`, { action, reason }).then((r) => r.data as ChatMessage),
  // ส่งข้อความเดียวกันให้หลายห้อง/หลายคนพร้อมกัน (เลือกผู้รับเองจากรายชื่อสนทนา) — เลือกรูปแบบได้ 3 อย่าง:
  // "text" ข้อความธรรมดา, "image" รูปภาพขนาดใหญ่ (แปะลิงก์ให้กดเปิดด้วยก็ได้), "template" การ์ดประกาศขนาดใหญ่
  // โทนเดียวกับการ์ดแจ้งบิล (หัวข้อ+เนื้อหา+ปุ่มลิงก์ถ้ามี) — ยิงทีละคนฝั่ง backend แล้วสรุปผลกลับมาว่าสำเร็จ/
  // ล้มเหลวกี่ราย (ดู BroadcastModal ใน ChatPage.tsx)
  broadcast: (payload: {
    lineUserIds: string[]; format: "text" | "image" | "template";
    text?: string; title?: string; linkUrl?: string;
    image?: { base64: string; name: string; width?: number; height?: number };
  }) =>
    api.post("/chat/broadcast", payload).then((r) => r.data as {
      sent: number; failed: number;
      results: { lineUserId: string; ok: boolean; error?: string }[];
    }),
};

export const settingsApi = {
  getAll: () => api.get("/settings").then((r) => r.data),
  createFormula: (data: any) => api.post("/settings", data).then((r) => r.data),
  updateFormula: (id: string, data: any) => api.put(`/settings/${id}`, data).then((r) => r.data),
  deleteFormula: (id: string) => api.delete(`/settings/${id}`).then((r) => r.data),
  getConfig: () => api.get("/settings/config").then((r) => r.data),
  updateConfig: (data: any) => api.put("/settings/config", data).then((r) => r.data),
  // กดยืนยัน "เสร็จสิ้นการตั้งค่าเริ่มต้น" — ปลดล็อกให้เข้าหน้าอื่นในระบบได้ (ดู AuthenticatedShell ใน App.tsx)
  completeSetup: () => api.post("/settings/config/complete-setup").then((r) => r.data as { setupCompleted: boolean }),
  uploadRichMenuImage: (menu: "guest" | "member" | "admin", base64: string, name: string) =>
    api.post("/settings/richmenu/image", { menu, base64, name }).then((r) => r.data as { url: string }),
  createRichMenus: () =>
    api.post("/settings/richmenu/create").then((r) => r.data as {
      menuIds: { guest: string; member: string; admin: string };
      defaultSet: boolean;
      warning?: string;
      relinked: { success: number; failed: number };
    }),
};

// ── หน้า LIFF ฝั่งผู้เช่า (Login/Payment) — public endpoints ไม่ต้องแนบ token พนักงาน (ไม่ผ่าน
// interceptor ข้างบนก็ได้เพราะไม่มี token ให้แนบอยู่แล้วในเบราว์เซอร์ผู้เช่า แต่ใช้ instance `api` เดิม
// ร่วมกันเพื่อ baseURL "/api" เดียวกัน) ยืนยันตัวตนด้วย LIFF access token ของ LINE เอง ไม่ใช่ JWT ของเรา
// `org` = slug ขององค์กร (?org=<slug> ที่อ่านจาก URL ของหน้า LIFF เอง — ดู Liff*Page.tsx) แนบเป็น query
// param ในทุกคำขอ (ทั้ง GET/POST) ให้ backend รู้ว่า request นี้เป็นขององค์กรไหน (ดู resolveOrgId ใน
// backend/src/routes/liff.ts) — undefined ได้ (axios ตัดพารามิเตอร์ที่เป็น undefined ทิ้งเองอัตโนมัติ) ตอนที่
// ระบบยังมีองค์กรเดียว (ยังไม่ได้ตั้ง ?org= ใน LIFF Endpoint URL ของ LINE Developers Console)
export const liffApi = {
  getConfig: (org?: string) => api.get("/liff/config", { params: { org } }).then((r) => r.data as {
    liffLoginUrl: string;
    liffPaymentUrl: string;
    liffProfileUrl: string;
    liffRepairUrl: string;
    liffRoomsUrl: string;
    liffBookingUrl: string;
    contactPhone: string;
    appIdentity: { logoUrl: string; nameText: string; logoBg: { enabled: boolean; color: string } };
    features: { splitRentByResidents: boolean };
    overdue: { enabled: boolean; day: number; type: "fixed" | "daily"; amount: number };
  }),
  login: (accessToken: string, org?: string) => api.post("/liff/login", { accessToken }, { params: { org } }).then((r) => r.data as
    | { linked: false; lineUserId: string; displayName: string }
    | { linked: true; tenantName: string; roomNumber: string; menuLinked: boolean }
  ),
  linkPhone: (accessToken: string, phone: string, org?: string) => api.post("/liff/link-phone", { accessToken, phone }, { params: { org } }).then((r) => r.data as
    { linked: true; tenantName: string; roomNumber: string; menuLinked: boolean }
  ),
  payment: (accessToken: string, org?: string) => api.post("/liff/payment", { accessToken }, { params: { org } }).then((r) => r.data as
    | { linked: false }
    | {
        linked: true; tenantName: string; roomNumber: string;
        outstanding: { items: { billId: string; roomId: string; monthYear: string; roomNumber: string; total: number; paidAmount: number; amount: number }[]; total: number };
        paymentInfo: {
          bankName: string; accountName: string; accountNumber: string; qrImage: string; bankLogoUrl: string;
          autoTrackingAvailable: boolean; qrGenerationAvailable: boolean;
        };
      }
  ),
  billDetail: (accessToken: string, billId: string, roomId: string, org?: string) =>
    api.post("/liff/bill-detail", { accessToken, billId, roomId }, { params: { org } }).then((r) => r.data as { item: any; monthYear: string }),
  billDetailThisMonth: (accessToken: string, org?: string) =>
    api.post("/liff/bill-detail/this-month", { accessToken }, { params: { org } }).then((r) => r.data as { billId: string; roomId: string; item: any; monthYear: string }),
  generateQr: (accessToken: string, billId: string, roomId: string, amount: number, org?: string) =>
    api.post("/liff/payment/qr", { accessToken, billId, roomId, amount }, { params: { org } }).then((r) => r.data as {
      intentId: string;
      qrImage: string | null;
      amount: number;
      accountInfo: { bankName: string; accountName: string; accountNumber: string } | null;
    }),
  paymentStatus: (accessToken: string, intentId: string, org?: string) =>
    api.post("/liff/payment/status", { accessToken, intentId }, { params: { org } }).then((r) => r.data as { status: "pending" | "confirmed" }),
  confirmPayment: (accessToken: string, intentId: string, slipBase64: string, org?: string) =>
    api.post("/liff/payment/confirm", { accessToken, intentId, slipImage: { base64: slipBase64 } }, { params: { org } }).then((r) => r.data as { ok: boolean; messageId: string }),
  profile: (accessToken: string, org?: string) => api.post("/liff/profile", { accessToken }, { params: { org } }).then((r) => r.data as
    | { linked: false }
    | {
        linked: true;
        tenant: { tenantName: string; roomNumber: string; tel: string; contractStartDate: string; contractEndDate: string };
        bills: { billId: string; roomId: string; monthYear: string; roomNumber: string; total: number; paidAmount: number; status: string }[];
        paymentHistory: {
          id: string; paymentDate: string; monthYear: string; roomNumber: string;
          method: string; amount: number; note: string; slipUrl: string; cancelled: boolean;
        }[];
      }
  ),
  submitRepair: (accessToken: string, title: string, details: string, photos: string[], org?: string) =>
    api.post("/liff/repair", { accessToken, title, details, photos }, { params: { org } }).then((r) => r.data as { ok: boolean; messageId: string }),
  profileFull: (accessToken: string, idLicenseLast4: string, org?: string) =>
    api.post("/liff/profile/full", { accessToken, idLicenseLast4 }, { params: { org } }).then((r) => r.data as {
      personal: {
        idLicense: string; title: string; firstName: string; lastName: string; tel: string; idLine: string;
        houseNo: string; soi: string; road: string; tambon: string; amphoe: string; province: string;
        zipcode: string; address: string; driveImageUrl: string;
      };
      roomNumbers: string[];
      coResidents: { name: string; phone: string; lineId: string; image: string }[];
      vehicles: { id: string; licensePlate: string; brand: string; color: string; typeName: string; typeIcon: string; images: string[] }[];
      files: { name: string; url: string }[];
    }),
  availableRooms: (org?: string) => api.get("/liff/rooms", { params: { org } }).then((r) => r.data as {
    id: string; number: string; floor: string; towerName: string; towerColor: string;
    price: number; dailyPrice: number; detail: string; pictures: { url: string; name?: string }[];
  }[]),
  bookRoom: (accessToken: string, roomId: string, name: string, tel: string, org?: string) =>
    api.post("/liff/rooms/book", { accessToken, roomId, name, tel }, { params: { org } }).then((r) => r.data as { ok: boolean; messageId: string; bookingId: string }),
  myBookings: (accessToken: string, org?: string) => api.post("/liff/rooms/mine", { accessToken }, { params: { org } }).then((r) => r.data as {
    bookings: {
      bookingId: string; roomId: string; roomNumber: string; towerName: string; towerColor: string;
      floor: string; price: number; detail: string; pictures: { url: string; name?: string }[]; bookedAt: string;
    }[];
  }),
  cancelBooking: (accessToken: string, bookingId: string, org?: string) =>
    api.post("/liff/rooms/cancel", { accessToken, bookingId }, { params: { org } }).then((r) => r.data as { ok: boolean }),
  // แจ้งเตือนชั่วคราว (ไม่บันทึก DB) ว่ากำลังเปิดหน้า LIFF หน้านี้อยู่ — ให้พนักงานเห็นวงกลมสีเขียวขึ้นที่รูป
  // โปรไฟล์ในหน้าแชทของเว็บ (ดู startLiffPresenceHeartbeat ด้านล่าง ที่เรียกฟังก์ชันนี้ซ้ำเป็นระยะ) ยิงแบบ
  // fire-and-forget เสมอ ไม่ throw ไม่บล็อกการโหลดหน้า LIFF ด้วยเหตุผลรอง
  notifyPresence: (accessToken: string, page: LiffPresencePage, org?: string) =>
    api.post("/liff/presence", { accessToken, page }, { params: { org } }).then((r) => r.data as { ok: boolean }).catch(() => ({ ok: false })),
};

export type LiffPresencePage = "login" | "rooms" | "booking" | "payment" | "profile" | "repair";

// ทุก 20 วิ — ต้องสั้นกว่า PRESENCE_EXPIRE_MS ฝั่ง ChatPage.tsx (40 วิ) พอสมควร กันจังหวะเน็ตช้า/ping ตกไป
// รอบเดียวแล้ววงกลมสีเขียวหายวับไปทั้งที่ยังเปิดหน้าอยู่จริง
const PRESENCE_HEARTBEAT_MS = 20000;

// เรียกจากทุกหน้า LIFF (Liff*Page.tsx) ตอนได้ access token มาแล้ว — ยิง notifyPresence ทันทีนัดหนึ่ง แล้วส่งซ้ำ
// เป็นระยะทุก 20 วิไปเรื่อยๆ ตราบใดที่หน้ายังเปิด/mount อยู่ (เพราะปุ่ม Rich Menu แบบ uri แค่เปิดเบราว์เซอร์
// เฉยๆ ไม่มีสัญญาณอะไรบอกได้เลยว่าผู้เช่า "เลิกใช้" หน้านี้แล้วเมื่อไหร่ — ใช้ heartbeat + timeout ฝั่งแสดงผล
// แทนสัญญาณ "ออกจากหน้า" ตรงๆ ซึ่งเชื่อถือได้น้อยกว่าบนมือถือ) คืนฟังก์ชันไว้ให้เรียกตอน unmount เพื่อหยุด interval
export function startLiffPresenceHeartbeat(accessToken: string, page: LiffPresencePage, org?: string): () => void {
  liffApi.notifyPresence(accessToken, page, org);
  const intervalId = setInterval(() => liffApi.notifyPresence(accessToken, page, org), PRESENCE_HEARTBEAT_MS);
  return () => clearInterval(intervalId);
}

// ── หน้าควบคุมแพลตฟอร์ม (ดูรายชื่อองค์กรลูกค้าทั้งหมด/ระงับ/ลบองค์กร) — คนเดียว (คุณ) เท่านั้น ─────
// เก็บโทเค็นแยก localStorage key จากบัญชีพนักงาน (TOKEN_STORAGE_KEY ด้านบน) เพราะเป็นคนละระบบสิทธิ์กัน
// โดยสิ้นเชิง (ดู backend/src/lib/superAdminDerive.ts) — เบราว์เซอร์เดียวกันจะได้ล็อกอินทั้งสองแบบพร้อมกัน
// ได้โดยไม่ทับกัน (เช่น เปิดแท็บนึงดูหน้าควบคุม อีกแท็บล็อกอินเป็นพนักงานองค์กรตัวเองตามปกติ)
const SUPERADMIN_TOKEN_STORAGE_KEY = "lineweb_superadmin_token";
export function getSuperAdminToken(): string | null {
  return localStorage.getItem(SUPERADMIN_TOKEN_STORAGE_KEY);
}
export function setSuperAdminToken(token: string) {
  localStorage.setItem(SUPERADMIN_TOKEN_STORAGE_KEY, token);
}
export function clearSuperAdminToken() {
  localStorage.removeItem(SUPERADMIN_TOKEN_STORAGE_KEY);
}

const superAdminHttp = axios.create({ baseURL: "/api" });
superAdminHttp.interceptors.request.use((config) => {
  const token = getSuperAdminToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface SuperAdminRequestRate { last1m: number; last5m: number }

export interface SuperAdminApiHealthWindow { count: number; errorCount: number; errorRate: number; avgResponseMs: number }

export interface SuperAdminSystemHealth {
  server: {
    uptimeSec: number;
    cpuPercent: number;
    memory: { rssBytes: number; systemTotalBytes: number; systemUsedBytes: number; systemUsedPercent: number };
  };
  api: { last1m: SuperAdminApiHealthWindow; last5m: SuperAdminApiHealthWindow };
  database: { connected: boolean; latencyMs: number };
}

export interface SuperAdminOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  counts: { rooms: number; tenants: number; users: number };
  storage: { dbBytes: number; uploadBytes: number; totalBytes: number };
  apiUsage: SuperAdminRequestRate;
  // มี client ต่อ WebSocket ขององค์กรนี้ค้างอยู่ตอนนี้อย่างน้อย 1 การเชื่อมต่อไหม (ดู getOnlineOrgIds ใน
  // backend/src/lib/wsHub.ts) — ใช้โชว์ "สถานะการใช้งานเว็บสด" แยกจาก createdAt/สมัครเมื่อ ที่เป็นข้อมูลเก่า
  online: boolean;
  owner: { username: string | null; phone: string | null; displayName: string | null; lineLinked: boolean };
}

export const superAdminApi = {
  // ล็อกอินด้วยรหัสผ่านเดียว (SUPERADMIN_PASSWORD ใน .env) — ทางเลือกที่เร็วกว่า LINE Login (ดู
  // SuperAdminLoginPage.tsx) คืน token ตรงๆ ให้หน้าเว็บเก็บเองผ่าน setSuperAdminToken ไม่ต้อง redirect
  // ผ่าน backend เหมือนขั้นตอน LINE Login
  login: (password: string) => superAdminHttp.post("/auth/superadmin/login", { password }).then((r) => r.data as { token: string }),
  getOrganizations: () => superAdminHttp.get("/superadmin/organizations").then((r) => r.data as SuperAdminOrg[]),
  // อัตราเรียก API สดๆ (ไม่แตะ DB ฝั่ง backend เลย — ดู lib/apiUsageTracker.ts) หน้าเว็บ poll endpoint นี้
  // ทุกๆ ~5 วินาทีแทนการโหลด getOrganizations() ทั้งก้อนซ้ำๆ (หนักกว่ามากเพราะต้องคำนวณพื้นที่ใช้งานด้วย)
  getApiUsage: () => superAdminHttp.get("/superadmin/api-usage").then((r) => r.data as {
    global: SuperAdminRequestRate; perOrg: Record<string, SuperAdminRequestRate>; onlineOrgIds: string[];
  }),
  // พื้นที่ไฟล์แนบแชทที่ยังแยกตามองค์กรไม่ได้ (ดูคอมเมนต์ที่ lib/storageUsage.ts ฝั่ง backend)
  getStorageSummary: () => superAdminHttp.get("/superadmin/storage-summary").then((r) => r.data as { unattributedBytes: number }),
  // ความเสถียรของระบบ (เครื่องเซิร์ฟ + API + ฐานข้อมูล) — poll เบาๆ ทุก ~5 วิ เหมือน getApiUsage
  getSystemHealth: () => superAdminHttp.get("/superadmin/system-health").then((r) => r.data as SuperAdminSystemHealth),
  createOrganization: (data: { name: string; phone: string; displayName?: string }) =>
    superAdminHttp.post("/superadmin/organizations", data).then((r) => r.data as { id: string; name: string; slug: string; status: string; ownerPhone: string }),
  updateOrgStatus: (id: string, status: "active" | "suspended") =>
    superAdminHttp.patch(`/superadmin/organizations/${id}/status`, { status }).then((r) => r.data as { id: string; status: string }),
  // แก้ "รหัส (slug)" และ/หรือ "เบอร์โทรเจ้าของ"/"ชื่อเจ้าของ" — ส่งมาเฉพาะฟิลด์ที่จะแก้ (ดู
  // PATCH /superadmin/organizations/:id ฝั่ง backend) ใช้กับการแก้ไขแบบ inline ในตารางรายชื่อองค์กร
  updateOrgDetails: (id: string, data: { slug?: string; phone?: string; displayName?: string }) =>
    superAdminHttp.patch(`/superadmin/organizations/${id}`, data).then((r) => r.data as { id: string; slug?: string; phone?: string; displayName?: string }),
  deleteOrg: (id: string, confirmName: string) =>
    superAdminHttp.delete(`/superadmin/organizations/${id}`, { data: { confirmName } }).then((r) => r.data as { deleted: string }),
  // รีเซ็ตรหัสผ่านบัญชีเจ้าของ — คืนรหัสผ่านใหม่แบบ plaintext ครั้งเดียว (backend ไม่เก็บไว้ดูย้อนหลังได้อีก)
  resetOwnerPassword: (id: string) =>
    superAdminHttp.post(`/superadmin/organizations/${id}/reset-password`).then((r) => r.data as { username: string; password: string }),
  // ค่าที่บันทึกไว้ล่าสุดของเครื่องมือสร้าง Rich Menu ให้ LINE OA อื่น (LIFF Login URL/Contact URL/รูป/
  // Guest ID ล่าสุด) — บันทึกไว้ใน superadmin_richmenu_config ฝั่ง backend เหมือนหน้า Settings ปกติของ
  // องค์กร (ดู routes/superadmin.ts) โหลดตอนเปิดหน้าเพื่อเติมค่าฟอร์มให้อัตโนมัติ
  getRichMenuConfig: () =>
    superAdminHttp.get("/superadmin/richmenu/config").then((r) => r.data as {
      liffLoginUrl: string;
      contactUrl: string;
      image: string;
      richMenuGuestId: string;
    }),
  // อัปโหลดรูปเมนู Guest — บันทึกไฟล์ลงดิสก์ฝั่ง backend ทันที (แพทเทิร์นเดียวกับ uploadRoomImage/รูปเมนูของ
  // องค์กร) คืน URL ที่เซ็นลายเซ็นแล้วไว้แสดง preview
  uploadRichMenuImage: (base64: string) =>
    superAdminHttp.post("/superadmin/richmenu/image", { base64 }).then((r) => r.data as { url: string }),
  // สร้างเมนู Guest เดี่ยว (1 ปุ่มใหญ่บน + 3 ปุ่มล่าง) ให้ LINE OA อิสระใดๆ ไม่ผูกกับองค์กรในระบบ — อ่านรูปที่
  // อัปโหลดไว้แล้ว (uploadRichMenuImage ด้านบน) จากดิสก์ฝั่ง backend เอง ไม่ต้องส่งรูปมาซ้ำในคำขอนี้ ส่วน
  // Channel Access Token อ่านจาก SUPERADMIN_RICHMENU_LINE_TOKEN ใน .env ฝั่ง backend เอง ไม่รับจาก client
  createRichMenuSet: (data: {
    liffLoginUrl: string;
    contactUrl?: string;
    previousGuestId?: string;
  }) =>
    superAdminHttp.post("/superadmin/richmenu/create", data).then((r) => r.data as {
      menuId: string;
      defaultSet: boolean;
      warning?: string;
    }),
};

export interface RepairItem { id: string; name: string; unit: string; minStock: number; note: string; createdAt: string; stock: number; lastPrice: number }
export interface RepairMovement {
  id: string; itemId: string; type: "in" | "out"; quantity: number; unitPrice: number;
  roomId: string; roomNumber: string; date: string; note: string; createdBy: string; createdAt: string;
}
export interface RepairRequest {
  id: string; lineUserId: string; tenantName: string; roomNumber: string; title: string; details: string;
  tenantPhotos: string[]; status: "pending" | "completed"; adminNote: string; confirmedBy: string; confirmedAt: string; createdAt: string;
}
export const repairsApi = {
  getRequests: (): Promise<RepairRequest[]> => api.get("/repairs/requests").then((r) => r.data),
  getPendingCount: (): Promise<{ count: number }> => api.get("/repairs/requests/pending-count").then((r) => r.data),
  getItems: (): Promise<RepairItem[]> => api.get("/repairs/items").then((r) => r.data),
  createItem: (data: any): Promise<RepairItem> => api.post("/repairs/items", data).then((r) => r.data),
  updateItem: (id: string, data: any): Promise<RepairItem> => api.put(`/repairs/items/${id}`, data).then((r) => r.data),
  deleteItem: (id: string) => api.delete(`/repairs/items/${id}`).then((r) => r.data),
  getMovements: (): Promise<RepairMovement[]> => api.get("/repairs/movements").then((r) => r.data),
  createMovement: (data: any): Promise<RepairMovement> => api.post("/repairs/movements", data).then((r) => r.data),
  deleteMovement: (id: string) => api.delete(`/repairs/movements/${id}`).then((r) => r.data),
};
