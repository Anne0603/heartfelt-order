// ============================================================
// 客戶與廠商模組
// 一份聯絡人清單，用 roles 陣列區分身份（可以同時是客戶+廠商）：
//   roles: ['customer'] | ['supplier'] | ['customer','supplier']
// ============================================================
import { db } from "./firebase-config.js?v=20260830-95";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession, getDisplayName } from "./auth.js?v=20260830-95";
import { logActivity } from "./activity-log.js?v=20260830-95";

const contactsCol = collection(db, "contacts");

// 訂購管道選項，訂單頁面跟客戶資料頁面共用同一份清單，避免同一個管道
// 兩邊寫法不一致（例如一邊打「LINE」一邊打「line」），之後才能正確統計。
export const ORDER_CHANNELS = ["LINE", "IG", "FB", "現場", "其他"];

function whoAmI() {
  return {
    email: currentSession.user?.email || null,
    name: getDisplayName(),
  };
}

export async function listContacts({ includeArchived = false } = {}) {
  const snap = await getDocs(contactsCol);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  const filtered = includeArchived ? list : list.filter((c) => c.status !== "archived");
  filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return filtered;
}

export async function getContact(id) {
  const snap = await getDoc(doc(db, "contacts", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createContact(data) {
  const who = whoAmI();
  const normalized = normalize(data);
  await addDoc(contactsCol, {
    ...normalized,
    status: "active",
    createdBy: who.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logActivity({ module: "contacts", action: "create", summary: `新增聯絡人「${normalized.name}」` });
}

export async function updateContact(id, data) {
  const normalized = normalize(data);
  await updateDoc(doc(db, "contacts", id), {
    ...normalized,
    updatedAt: serverTimestamp(),
  });
  logActivity({ module: "contacts", action: "update", summary: `編輯聯絡人「${normalized.name}」` });
}

export async function setContactArchived(id, archived, contactName = "") {
  await updateDoc(doc(db, "contacts", id), {
    status: archived ? "archived" : "active",
    updatedAt: serverTimestamp(),
  });
  logActivity({ module: "contacts", action: archived ? "archive" : "restore", summary: `${archived ? "停用" : "恢復使用"}聯絡人「${contactName}」` });
}

function normalize(data) {
  return {
    name: data.name.trim(),
    roles: data.roles || [],
    phone: data.phone?.trim() || "",
    address: data.address?.trim() || "",
    note: data.note?.trim() || "",
    orderChannel: data.roles?.includes("customer") ? (data.orderChannel?.trim() || "") : "",
    supplyCategory: data.roles?.includes("supplier") ? (data.supplyCategory || "") : "",
  };
}
