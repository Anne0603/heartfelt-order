// ============================================================
// 數量單位管理（只有超級管理員能新增/改名/刪除）
// 改名會連動更新所有正在用這個單位的項目；刪除前檢查有沒有東西在用。
// ============================================================
import { db } from "./firebase-config.js?v=20260830-73";
import {
  collection, doc, getDoc, getDocs, addDoc, deleteDoc,
  query, where, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const unitsCol = collection(db, "units");

export async function listUnits() {
  const snap = await getDocs(unitsCol);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return list;
}

export async function createUnit(name) {
  await addDoc(unitsCol, { name: name.trim(), createdAt: serverTimestamp() });
}

async function countUsage(name) {
  const q = query(collection(db, "items"), where("unit", "==", name));
  const snap = await getDocs(q);
  return snap.size;
}

export async function renameUnit(unitId, newName) {
  const ref = doc(db, "units", unitId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("找不到單位");
  const oldName = snap.data().name;
  const trimmed = newName.trim();
  if (trimmed === oldName) return;

  const q = query(collection(db, "items"), where("unit", "==", oldName));
  const usersSnap = await getDocs(q);
  const batch = writeBatch(db);
  usersSnap.forEach((d) => batch.update(d.ref, { unit: trimmed }));
  batch.update(ref, { name: trimmed });
  await batch.commit();
}

export async function deleteUnit(unitId) {
  const ref = doc(db, "units", unitId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("找不到單位");
  const name = snap.data().name;
  const usage = await countUsage(name);
  if (usage > 0) throw new Error(`還有 ${usage} 個項目在用「${name}」這個單位，沒辦法刪除`);
  await deleteDoc(ref);
}
