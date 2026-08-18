// ============================================================
// 採購與庫存模組
// 項目分兩種類型：
//   packaging（包材）— 幕後消耗品，靠配方被扣，不直接賣
//   resale（現貨商品）— 直接進貨轉賣，出貨直接扣庫存
//
// 資料模型（用「累積總量」而不是直接存庫存/均價，這樣作廢/刪除
// 才能正確回推正確的庫存與加權平均單價，不會兜不起來）：
//   inventoryItems/{id}:
//     name, type, category, lowStockThreshold, status,
//     totalPurchasedQty, totalPurchasedCost,   // 加權平均單價 = cost/qty
//     totalUsedQty,                            // 消耗掉的量
//     stocktakeAdjustment                      // 盤點校正的正負值
//   stock = totalPurchasedQty - totalUsedQty + stocktakeAdjustment
//   avgCost = totalPurchasedQty > 0 ? totalPurchasedCost / totalPurchasedQty : 0
//
//   inventoryPurchases/{id}  進貨記錄
//   inventoryUsages/{id}     領用/消耗記錄（含出貨自動扣、手動例外）
//   inventoryStocktakes/{id} 盤點記錄
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, runTransaction,
  serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession } from "./auth.js";

const itemsCol = collection(db, "inventoryItems");
const purchasesCol = collection(db, "inventoryPurchases");
const usagesCol = collection(db, "inventoryUsages");
const stocktakesCol = collection(db, "inventoryStocktakes");

function whoAmI() {
  return {
    email: currentSession.user?.email || null,
    name: currentSession.user?.displayName || currentSession.user?.email || "未知",
  };
}

export function computeStock(item) {
  return (item.totalPurchasedQty || 0) - (item.totalUsedQty || 0) + (item.stocktakeAdjustment || 0);
}
export function computeAvgCost(item) {
  return item.totalPurchasedQty > 0 ? item.totalPurchasedCost / item.totalPurchasedQty : 0;
}

// ---------- 項目主檔 ----------
export async function listItems({ includeArchived = false } = {}) {
  const snap = await getDocs(itemsCol);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  const filtered = includeArchived ? list : list.filter((i) => i.status !== "archived");
  filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return filtered;
}

export async function createItem({ name, type, category, lowStockThreshold }) {
  const who = whoAmI();
  await addDoc(itemsCol, {
    name: name.trim(),
    type, // 'packaging' | 'resale'
    category: category?.trim() || "",
    lowStockThreshold: Number(lowStockThreshold) || 0,
    status: "active",
    totalPurchasedQty: 0,
    totalPurchasedCost: 0,
    totalUsedQty: 0,
    stocktakeAdjustment: 0,
    createdBy: who.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateItem(itemId, { name, category, lowStockThreshold }) {
  await updateDoc(doc(db, "inventoryItems", itemId), {
    name: name.trim(),
    category: category?.trim() || "",
    lowStockThreshold: Number(lowStockThreshold) || 0,
    updatedAt: serverTimestamp(),
  });
}

export async function setItemArchived(itemId, archived) {
  await updateDoc(doc(db, "inventoryItems", itemId), {
    status: archived ? "archived" : "active",
    updatedAt: serverTimestamp(),
  });
}

// ---------- 進貨（可批次） ----------
// rows: [{ itemId, qty, amount, note }]
export async function addPurchaseBatch(rows, { date, freightTotal = 0 } = {}) {
  const who = whoAmI();
  const totalQtyAcrossRows = rows.reduce((s, r) => s + Number(r.qty || 0), 0);

  for (const row of rows) {
    const qty = Number(row.qty);
    if (!qty || qty <= 0) continue;
    const freightShare = totalQtyAcrossRows > 0 ? (freightTotal * qty) / totalQtyAcrossRows : 0;
    const amount = Number(row.amount || 0) + freightShare;
    const itemRef = doc(db, "inventoryItems", row.itemId);

    await runTransaction(db, async (tx) => {
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists()) throw new Error("找不到項目");
      const item = itemSnap.data();
      tx.update(itemRef, {
        totalPurchasedQty: (item.totalPurchasedQty || 0) + qty,
        totalPurchasedCost: (item.totalPurchasedCost || 0) + amount,
        updatedAt: serverTimestamp(),
      });
      const purchaseRef = doc(purchasesCol);
      tx.set(purchaseRef, {
        itemId: row.itemId,
        itemName: item.name,
        date: date || new Date().toISOString().slice(0, 10),
        qty,
        amount,
        note: row.note || "",
        status: "active",
        createdBy: who.email,
        createdByName: who.name,
        createdAt: serverTimestamp(),
      });
    });
  }
}

// ---------- 領用/消耗 ----------
export async function addUsage({ itemId, qty, note, source = "manual", orderId = null }) {
  const who = whoAmI();
  const itemRef = doc(db, "inventoryItems", itemId);
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("找不到項目");
    const item = itemSnap.data();
    const stock = computeStock(item);
    if (qty > stock) {
      throw new Error(`庫存不足：${item.name} 只剩 ${stock}，不能領用 ${qty}`);
    }
    tx.update(itemRef, {
      totalUsedQty: (item.totalUsedQty || 0) + qty,
      updatedAt: serverTimestamp(),
    });
    const usageRef = doc(usagesCol);
    tx.set(usageRef, {
      itemId,
      itemName: item.name,
      date: new Date().toISOString().slice(0, 10),
      qty,
      note: note || "",
      source,
      orderId,
      status: "active",
      createdBy: who.email,
      createdByName: who.name,
      createdAt: serverTimestamp(),
    });
  });
}

// ---------- 盤點 ----------
export async function stocktakeAdjust({ itemId, countedQty, note }) {
  const who = whoAmI();
  const itemRef = doc(db, "inventoryItems", itemId);
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("找不到項目");
    const item = itemSnap.data();
    const systemQtyBefore = computeStock(item);
    const diff = Number(countedQty) - systemQtyBefore;
    tx.update(itemRef, {
      stocktakeAdjustment: (item.stocktakeAdjustment || 0) + diff,
      updatedAt: serverTimestamp(),
    });
    const stRef = doc(stocktakesCol);
    tx.set(stRef, {
      itemId,
      itemName: item.name,
      date: new Date().toISOString().slice(0, 10),
      countedQty: Number(countedQty),
      systemQtyBefore,
      diff,
      note: note || "",
      createdBy: who.email,
      createdByName: who.name,
      createdAt: serverTimestamp(),
    });
  });
}

// ---------- 作廢 / 刪除 ----------
export async function voidRecord(kind, recordId) {
  const colName = kind === "purchase" ? "inventoryPurchases" : "inventoryUsages";
  const recRef = doc(db, colName, recordId);
  const who = whoAmI();
  await runTransaction(db, async (tx) => {
    const recSnap = await tx.get(recRef);
    if (!recSnap.exists()) throw new Error("找不到記錄");
    const rec = recSnap.data();
    if (rec.status === "void") throw new Error("已經是作廢狀態");
    const itemRef = doc(db, "inventoryItems", rec.itemId);
    const itemSnap = await tx.get(itemRef);
    if (itemSnap.exists()) {
      const item = itemSnap.data();
      if (kind === "purchase") {
        tx.update(itemRef, {
          totalPurchasedQty: (item.totalPurchasedQty || 0) - rec.qty,
          totalPurchasedCost: (item.totalPurchasedCost || 0) - rec.amount,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(itemRef, {
          totalUsedQty: (item.totalUsedQty || 0) - rec.qty,
          updatedAt: serverTimestamp(),
        });
      }
    }
    tx.update(recRef, {
      status: "void",
      voidedBy: who.email,
      voidedByName: who.name,
      voidedAt: serverTimestamp(),
    });
  });
}

export async function permanentlyDelete(kind, recordId) {
  const colName = kind === "purchase" ? "inventoryPurchases" : "inventoryUsages";
  const recRef = doc(db, colName, recordId);
  const recSnap = await getDoc(recRef);
  if (recSnap.exists() && recSnap.data().status !== "void") {
    // 如果還沒作廢，先把庫存影響還原，再刪除
    await voidRecord(kind, recordId);
  }
  await deleteDoc(recRef);
}

// ---------- 查詢記錄 ----------
export async function listPurchases(itemId) {
  const q = query(purchasesCol, where("itemId", "==", itemId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return list;
}
export async function listUsages(itemId) {
  const q = query(usagesCol, where("itemId", "==", itemId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return list;
}
export async function listStocktakes(itemId) {
  const q = query(stocktakesCol, where("itemId", "==", itemId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return list;
}

export async function lowStockItems() {
  const items = await listItems();
  return items.filter((i) => i.lowStockThreshold > 0 && computeStock(i) <= i.lowStockThreshold);
}
