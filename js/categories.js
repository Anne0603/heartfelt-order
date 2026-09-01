// ============================================================
// 分類管理（只有超級管理員能新增/改名/刪除）
// module:
//   'items_self_made'（自製商品分類） | 'items_resale'（現貨商品分類） | 'items_packaging'（包材分類）
//   'expense_cogs'（銷貨成本類別） | 'expense_opex'（營業費用類別）
// 改名會連動更新所有正在使用這個分類的資料，不留孤兒分類。
// 刪除前會檢查有沒有東西在用，有的話擋下來、告訴你有幾筆在用。
// ============================================================
import { db } from "./firebase-config.js?v=20260830-54";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const categoriesCol = collection(db, "categories");

function targetCollectionName(module) {
  if (module.startsWith("expense_")) return "expenses";
  if (module.startsWith("items_")) return "items";
  return "items";
}

// 有些分類清單共用同一個資料表（例如商品的三種類型都存在 items
// collection 裡，支出的兩種類型都存在 expenses collection 裡），用這個
// 判別欄位去區分，比對用量/改名時要一併篩選，避免不同類型剛好取了
// 同名分類時互相誤判。
function discriminatorOf(module) {
  if (module === "expense_cogs") return { field: "costType", value: "cogs" };
  if (module === "expense_opex") return { field: "costType", value: "opex" };
  if (module === "items_self_made") return { field: "type", value: "self_made" };
  if (module === "items_resale") return { field: "type", value: "resale" };
  if (module === "items_packaging") return { field: "type", value: "packaging" };
  return null;
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

function buildUsageQuery(module, name) {
  const colName = targetCollectionName(module);
  const discriminator = discriminatorOf(module);
  const base = collection(db, colName);
  return discriminator
    ? query(base, where("category", "==", name), where(discriminator.field, "==", discriminator.value))
    : query(base, where("category", "==", name));
}

async function countUsage(module, name) {
  const snap = await getDocs(buildUsageQuery(module, name));
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
  const usersSnap = await getDocs(buildUsageQuery(module, oldName));
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
