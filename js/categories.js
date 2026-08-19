// ============================================================
// 分類管理（只有超級管理員能新增/改名/刪除）
// module: 'products' | 'inventory'
// 改名會連動更新所有正在使用這個分類的資料，不留孤兒分類。
// 刪除前會檢查有沒有東西在用，有的話擋下來、告訴你有幾筆在用。
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const categoriesCol = collection(db, "categories");

function targetCollectionName(module) {
  return "items";
}

export async function listCategories(module) {
  const q = query(categoriesCol, where("module", "==", module));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return list;
}

export async function createCategory(module, name) {
  await addDoc(categoriesCol, {
    module,
    name: name.trim(),
    createdAt: serverTimestamp(),
  });
}

async function countUsage(module, name) {
  const q = query(collection(db, targetCollectionName(module)), where("category", "==", name));
  const snap = await getDocs(q);
  return snap.size;
}

export async function renameCategory(categoryId, newName) {
  const ref = doc(db, "categories", categoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("找不到分類");
  const { module, name: oldName } = snap.data();
  const trimmed = newName.trim();
  if (trimmed === oldName) return;

  // 找出所有用舊名字的資料，一起改成新名字
  const q = query(collection(db, targetCollectionName(module)), where("category", "==", oldName));
  const usersSnap = await getDocs(q);
  const batch = writeBatch(db);
  usersSnap.forEach((d) => batch.update(d.ref, { category: trimmed }));
  batch.update(ref, { name: trimmed });
  await batch.commit();
}

export async function deleteCategory(categoryId) {
  const ref = doc(db, "categories", categoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("找不到分類");
  const { module, name } = snap.data();
  const usage = await countUsage(module, name);
  if (usage > 0) {
    throw new Error(`還有 ${usage} 筆資料在用「${name}」這個分類，沒辦法刪除`);
  }
  await deleteDoc(ref);
}
