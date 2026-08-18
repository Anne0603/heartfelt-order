// ============================================================
// 商品定價模組
//
// 商品類型：
//   self_made（自製）— 成本 = 包材成本（自動抓「採購與庫存」均價 x 用量）
//                        原料/人工不算在這裡：原料每月一筆總帳、人工算進
//                        「利潤總覽」的營業費用，這裡只算真正能精準追蹤
//                        的包材成本。畫面上會標註這是「未扣原料/人工」的
//                        毛利，避免被誤會成最終淨利。
//   resale（現貨）    — 成本 = 綁定的「採購與庫存」現貨商品項目的即時均價，
//                        這種商品成本本身就是完整的，不用額外標註。
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession } from "./auth.js";
import { computeStock, computeAvgCost } from "./inventory.js";

const productsCol = collection(db, "products");

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
    category: data.category || "",
    photoUrl: data.photoUrl || "",
    productType: data.productType, // 'self_made' | 'resale'
    price: Number(data.price) || 0,
  };
  if (data.productType === "resale") {
    return { ...base, linkedInventoryItemId: data.linkedInventoryItemId || null };
  }
  return {
    ...base,
    mainItemId: data.mainItemId || null,
    mainItemQty: data.mainItemId ? (Number(data.mainItemQty) || 1) : null,
  };
}

/**
 * 算出商品目前的成本/毛利（僅供管理員以上、唯讀主管使用；
 * 訂單進出貨人員的畫面不會呼叫這個或不會顯示結果）。
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
      isFullCost: true,
      breakdown: [{ label: "現貨進貨均價", amount: cost }],
    };
  }

  const mainItem = product.mainItemId ? itemsById.get(product.mainItemId) : null;
  const cost = mainItem ? computeAvgCost(mainItem, itemsById) * (product.mainItemQty || 1) : 0;
  const profit = product.price - cost;
  return {
    cost, profit,
    margin: product.price > 0 ? profit / product.price : 0,
    isFullCost: false, // 提醒 UI：這不是完整成本，還沒扣原料/人工
    breakdown: [
      { label: mainItem ? `包材成本（${mainItem.name} x${product.mainItemQty || 1}）` : "包材成本（未設定）", amount: cost },
    ],
  };
}
