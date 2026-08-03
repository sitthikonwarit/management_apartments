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
  setupStatus: () => api.get("/auth/setup-status").then((r) => r.data as { hasUsers: boolean }),
  register: (username: string, password: string, displayName?: string) =>
    api.post("/auth/register", { username, password, displayName }).then((r) => r.data),
  login: (username: string, password: string) =>
    api.post("/auth/login", { username, password }).then((r) => r.data),
  me: () => api.get("/auth/me").then((r) => r.data),
  logout: () => api.post("/auth/logout").then((r) => r.data),
  getUsers: () => api.get("/auth/users").then((r) => r.data),
  createUser: (username: string, password: string, displayName?: string) =>
    api.post("/auth/users", { username, password, displayName }).then((r) => r.data),
  updateUser: (id: string, data: { displayName?: string; password?: string }) =>
    api.put(`/auth/users/${id}`, data).then((r) => r.data),
  deleteUser: (id: string) => api.delete(`/auth/users/${id}`).then((r) => r.data),
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
  delete: (id: string) => api.delete(`/bills/${id}`).then((r) => r.data),
  createPayment: (payload: {
    billId: string; roomId: string; roomNumber: string; tenantId: string | null; tenantName: string;
    monthYear: string; method: "cash" | "scan"; amount: number; received?: number; change?: number; note?: string;
    paymentDate: string; slipImage?: { base64: string; name: string } | null; operator?: string;
    billTotal: number; paidTotal: number;
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

export interface ChatConversation {
  lineUserId: string;
  tenantId: string | null;
  displayName: string;
  roomNumber: string | null;
  pictureUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastDirection: "in" | "out";
  unreadCount: number;
}

export interface OutstandingBillItem {
  billId: string;
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
  getOutstandingBills: (lineUserId: string) =>
    api.get(`/chat/conversations/${lineUserId}/outstanding-bills`).then((r) => r.data as OutstandingBills),
};

export const settingsApi = {
  getAll: () => api.get("/settings").then((r) => r.data),
  createFormula: (data: any) => api.post("/settings", data).then((r) => r.data),
  updateFormula: (id: string, data: any) => api.put(`/settings/${id}`, data).then((r) => r.data),
  deleteFormula: (id: string) => api.delete(`/settings/${id}`).then((r) => r.data),
  getConfig: () => api.get("/settings/config").then((r) => r.data),
  updateConfig: (data: any) => api.put("/settings/config", data).then((r) => r.data),
  uploadRichMenuImage: (menu: "guest" | "member" | "admin", base64: string, name: string) =>
    api.post("/settings/richmenu/image", { menu, base64, name }).then((r) => r.data as { url: string }),
  createRichMenus: () =>
    api.post("/settings/richmenu/create").then((r) => r.data as {
      menuIds: { guest: string; member: string; admin: string };
      defaultSet: boolean;
      warning?: string;
    }),
};
