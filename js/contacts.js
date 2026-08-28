// ============================================================
// 客戶與廠商模組
// 一份聯絡人清單，用 roles 陣列區分身份（可以同時是客戶+廠商）：
//   roles: ['customer'] | ['supplier'] | ['customer','supplier']
// ============================================================
import { db } from "./firebase-config.js?v=20260826-29";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession, getDisplayName } from "./auth.js?v=20260826-29";
import { logActivity } from "./activity-log.js?v=20260826-29";

const contactsCol = collection(db, "contacts");

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
