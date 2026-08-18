// ============================================================
// 採購與庫存模組
// 項目分三種類型：
//   packaging（包材）— 單一幕後消耗品，靠配方被扣，不直接賣
//   bundle（組合包）— 由好幾種包材組成的一組（例如禮盒＝盒子+緞帶+提袋），
//                      本身不用「採購」，庫存/成本都是即時從組成的包材算出來
//   resale（現貨商品）— 直接進貨轉賣，出貨直接扣庫存
//
// 資料模型（用「累積總量」而不是直接存庫存/均價，這樣作廢/刪除
// 才能正確回推正確的庫存與加權平均單價，不會兜不起來）：
//   inventoryItems/{id}:
//     name, type, category, lowStockThreshold, status,
//     totalPurchasedQty, totalPurchasedCost,   // 加權平均單價 = cost/qty（packaging/resale 用）
//     totalUsedQty,                            // 消耗掉的量（packaging/resale 用）
//     stocktakeAdjustment                      // 盤點校正的正負值（packaging/resale 用）
//     components: [{ itemId, name, qty }]      // 只有 bundle 用：這組裡面包含哪些包材、各自幾個
//   stock(packaging/resale) = totalPurchasedQty - totalUsedQty + stocktakeAdjustment
//   avgCost(packaging/resale) = totalPurchasedQty > 0 ? totalPurchasedCost / totalPurchasedQty : 0
//   stock(bundle) = 組成包材裡，「最少能組成幾組」（取每個組件 floor(庫存/用量) 的最小值）
//   avgCost(bundle) = Σ(組件均價 × 用量)
//
//   inventoryPurchases/{id}  進貨記錄（只會是 packaging/resale）
//   inventoryUsages/{id}     領用/消耗記錄（含出貨自動扣、手動例外；bundle 會展開成多筆組件記錄）
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

export function buildItemsIndex(items) {
  const map = new Map();
  items.forEach((i) => map.set(i.id, i));
  return map;
}

function leafStock(item) {
  return (item.totalPurchasedQty || 0) - (item.totalUsedQty || 0) + (item.stocktakeAdjustment || 0);
}
function leafAvgCost(item) {
  return item.totalPurchasedQty > 0 ? item.totalPurchasedCost / item.totalPurchasedQty : 0;
}

// itemsById 只有算 bundle 的時候才需要（要去查組件）
export function computeStock(item, itemsById) {
  if (item.type !== "bundle") return leafStock(item);
  if (!itemsById || !item.components?.length) return 0;
  let min = Infinity;
  for (const c of item.components) {
    const comp = itemsById.get(c.itemId);
    if (!comp || !c.qty) return 0;
    const possible = Math.floor(computeStock(comp, itemsById) / c.qty);
    min = Math.min(min, possible);
  }
  return min === Infinity ? 0 : min;
}
export function computeAvgCost(item, itemsById) {
  if (item.type !== "bundle") return leafAvgCost(item);
  if (!itemsById || !item.components?.length) return 0;
  return item.components.reduce((sum, c) => {
    const comp = itemsById.get(c.itemId);
    if (!comp) return sum;
    return sum + computeAvgCost(comp, itemsById) * c.qty;
  }, 0);
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

// components 只有 type === 'bundle' 時需要： [{ itemId, name, qty }]
export async function createItem({ name, type, category, lowStockThreshold, components }) {
  const who = whoAmI();
  await addDoc(itemsCol, {
    name: name.trim(),
    type, // 'packaging' | 'bundle' | 'resale'
    category: category?.trim() || "",
    lowStockThreshold: Number(lowStockThreshold) || 0,
    status: "active",
    totalPurchasedQty: 0,
    totalPurchasedCost: 0,
    totalUsedQty: 0,
    stocktakeAdjustment: 0,
    components: type === "bundle" ? (components || []) : null,
    createdBy: who.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateItem(itemId, { name, category, lowStockThreshold, components, type }) {
  const payload = {
    name: name.trim(),
    category: category?.trim() || "",
    lowStockThreshold: Number(lowStockThreshold) || 0,
    updatedAt: serverTimestamp(),
  };
  if (type === "bundle") payload.components = components || [];
  await updateDoc(doc(db, "inventoryItems", itemId), payload);
}

export async function setItemArchived(itemId, archived) {
  await updateDoc(doc(db, "inventoryItems", itemId), {
    status: archived ? "archived" : "active",
    updatedAt: serverTimestamp(),
  });
}

// ---------- 進貨（可批次，只能是 packaging / resale） ----------
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
      if (item.type === "bundle") throw new Error("組合包不能直接採購，請採購裡面的包材");
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

// ---------- 領用/消耗（單一葉節點項目：packaging 或 resale） ----------
export async function addUsage({ itemId, qty, note, source = "manual", orderId = null }) {
  const who = whoAmI();
  const itemRef = doc(db, "inventoryItems", itemId);
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("找不到項目");
    const item = itemSnap.data();
    const stock = leafStock(item);
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

// ---------- 領用/消耗（任何項目：packaging / resale 直接扣；bundle 會展開扣所有組件） ----------
export async function consumeItem({ itemId, qty, note, source = "manual", orderId = null }) {
  const itemSnap = await getDoc(doc(db, "inventoryItems", itemId));
  if (!itemSnap.exists()) throw new Error("找不到項目");
  const item = itemSnap.data();
  if (item.type === "bundle") {
    for (const c of item.components || []) {
      await addUsage({
        itemId: c.itemId,
        qty: qty * c.qty,
        note: `${note || ""}（來自組合包：${item.name}）`.trim(),
        source,
        orderId,
      });
    }
  } else {
    await addUsage({ itemId, qty, note, source, orderId });
  }
}

// ---------- 盤點（只能對 packaging / resale 做，bundle 是算出來的不能盤點） ----------
export async function stocktakeAdjust({ itemId, countedQty, note }) {
  const who = whoAmI();
  const itemRef = doc(db, "inventoryItems", itemId);
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("找不到項目");
    const item = itemSnap.data();
    if (item.type === "bundle") throw new Error("組合包的庫存是自動算出來的，請盤點裡面的包材");
    const systemQtyBefore = leafStock(item);
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

export async function listUsagesByOrder(orderId) {
  const q = query(usagesCol, where("orderId", "==", orderId), where("status", "==", "active"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

export async function lowStockItems() {
  const items = await listItems();
  const itemsById = buildItemsIndex(items);
  return items.filter((i) => i.lowStockThreshold > 0 && computeStock(i, itemsById) <= i.lowStockThreshold);
}
