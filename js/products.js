// ============================================================
// 商品定價模組
//
// 商品類型：
//   self_made（自製）— 成本 = 原料成本(試算) + 主料成本(自動抓庫存均價) +
//                        人工成本(比例法) + 損耗成本(比例法)
//   resale（現貨）    — 成本 = 綁定的「採購與庫存」現貨商品項目的即時均價，
//                        庫存也直接顯示那個項目的庫存
//
// 系統裡任何地方看到的成本/毛利，永遠只有這一套「試算」數字，不會有
// 「真正成本」跟它並存去影響訂單/報表 —— 那個只在「實際成本記錄」裡
// 給你自己比對校準用，不會反過來動這裡的數字。
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession } from "./auth.js";
import { computeStock, computeAvgCost } from "./inventory.js";

const productsCol = collection(db, "products");
const actualCostLogsCol = collection(db, "actualCostLogs");

function whoAmI() {
  return {
    email: currentSession.user?.email || null,
    name: currentSession.user?.displayName || currentSession.user?.email || "未知",
  };
}

export async function listProducts({ includeArchived = false } = {}) {
  const snap = await getDocs(productsCol);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  const filtered = includeArchived ? list : list.filter((p) => p.status !== "archived");
  filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return filtered;
}

export async function getProduct(productId) {
  const snap = await getDoc(doc(db, "products", productId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createProduct(data) {
  const who = whoAmI();
  await addDoc(productsCol, {
    ...normalizeProductInput(data),
    status: "active",
    createdBy: who.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateProduct(productId, data) {
  await updateDoc(doc(db, "products", productId), {
    ...normalizeProductInput(data),
    updatedAt: serverTimestamp(),
  });
}

export async function setProductArchived(productId, archived) {
  await updateDoc(doc(db, "products", productId), {
    status: archived ? "archived" : "active",
    updatedAt: serverTimestamp(),
  });
}

function normalizeProductInput(data) {
  const base = {
    name: data.name.trim(),
    category: data.category?.trim() || "",
    photoUrl: data.photoUrl || "",
    productType: data.productType, // 'self_made' | 'resale'
    price: Number(data.price) || 0,
  };
  if (data.productType === "resale") {
    return { ...base, linkedInventoryItemId: data.linkedInventoryItemId || null };
  }
  return {
    ...base,
    rawMaterialCost: Number(data.rawMaterialCost) || 0,
    mainItemId: data.mainItemId || null,
    mainItemQty: Number(data.mainItemQty) || 1,
    laborPercent: Number(data.laborPercent) || 0,
    wastePercent: Number(data.wastePercent) || 0,
  };
}

/**
 * 算出商品目前的試算成本/毛利。
 * itemsById：inventory.js 的 buildItemsIndex(items) 結果，用來查主料/現貨庫存。
 * 回傳 null 代表這個角色不該看到成本（呼叫端會依角色決定要不要顯示，這裡永遠算給你，
 * UI 層自己決定要不要顯示 — 純前端無法在資料庫層級隱藏欄位，這點先前已跟你說明過）。
 */
export function calcProductCost(product, itemsById) {
  if (product.productType === "resale") {
    const linked = product.linkedInventoryItemId ? itemsById.get(product.linkedInventoryItemId) : null;
    const cost = linked ? computeAvgCost(linked, itemsById) : 0;
    const stock = linked ? computeStock(linked, itemsById) : 0;
    const profit = product.price - cost;
    return {
      cost, profit,
      margin: product.price > 0 ? profit / product.price : 0,
      stock,
      breakdown: [{ label: "現貨進貨均價", amount: cost }],
    };
  }

  const mainItem = product.mainItemId ? itemsById.get(product.mainItemId) : null;
  const mainCost = mainItem ? computeAvgCost(mainItem, itemsById) * (product.mainItemQty || 1) : 0;
  const rawCost = product.rawMaterialCost || 0;
  const subtotal = rawCost + mainCost;
  const laborCost = subtotal * ((product.laborPercent || 0) / 100);
  const wasteCost = subtotal * ((product.wastePercent || 0) / 100);
  const cost = subtotal + laborCost + wasteCost;
  const profit = product.price - cost;
  return {
    cost, profit,
    margin: product.price > 0 ? profit / product.price : 0,
    breakdown: [
      { label: "原料成本(試算)", amount: rawCost },
      { label: `主料成本${mainItem ? "（" + mainItem.name + " x" + (product.mainItemQty||1) + "）" : ""}`, amount: mainCost },
      { label: `人工成本（${product.laborPercent || 0}%）`, amount: laborCost },
      { label: `損耗成本（${product.wastePercent || 0}%）`, amount: wasteCost },
    ],
  };
}

// ---------- 實際成本記錄（獨立校準用筆記本，不影響訂單/報表） ----------
export async function addActualCostLog({ productId, date, actualAmount, batchQty, note }) {
  const who = whoAmI();
  await addDoc(actualCostLogsCol, {
    productId,
    date: date || new Date().toISOString().slice(0, 10),
    actualAmount: Number(actualAmount),
    batchQty: Number(batchQty),
    unitCost: Number(batchQty) > 0 ? Number(actualAmount) / Number(batchQty) : 0,
    note: note || "",
    createdBy: who.email,
    createdByName: who.name,
    createdAt: serverTimestamp(),
  });
}

export async function listActualCostLogs(productId) {
  const q = query(actualCostLogsCol, where("productId", "==", productId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return list;
}

export async function deleteActualCostLog(logId) {
  await deleteDoc(doc(db, "actualCostLogs", logId));
}
