// ============================================================
// 商品與庫存（合併版）
//
// 一份清單，用「類型」決定要不要追蹤庫存、要不要填售價：
//   self_made（自製商品）— 客戶可訂購，不追蹤庫存量（做多少算多少），
//                          成本 = 配方裡每一項包材的成本加總（可以列多筆包材）
//   resale（現貨商品）    — 客戶可訂購，追蹤庫存/加權平均成本
//   packaging（包材）     — 客戶不可訂購，追蹤庫存/加權平均成本，
//                          幕後被自製商品的配方消耗
//
// 資料模型（用「累積總量」而不是直接存庫存/均價，這樣作廢/刪除
// 才能正確回推正確的庫存與加權平均單價）：
//   items/{id}:
//     name, type, category, photoUrl, status, unit,
//     price,                                   // self_made / resale 才有
//     recipe: [{itemId, name, qty}],            // 只有 self_made 用：配方，
//                                                // 可以列好幾種包材各自的用量
//     lowStockThreshold,                        // resale / packaging 才有
//     totalPurchasedQty, totalPurchasedCost,     // resale / packaging 用（加權平均單價 = cost/qty）
//     totalUsedQty, stocktakeAdjustment          // resale / packaging 用
//
//   itemPurchases/{id}  進貨記錄（只會是 resale / packaging）
//   itemUsages/{id}      領用/消耗記錄（含出貨自動扣、手動例外）
//   itemStocktakes/{id}  盤點記錄
// ============================================================
import { db } from "./firebase-config.js?v=20260829-42";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, runTransaction,
  serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession, getDisplayName } from "./auth.js?v=20260829-42";
import { logActivity } from "./activity-log.js?v=20260829-42";
import { addExpense } from "./expenses.js?v=20260829-42";

const itemsCol = collection(db, "items");
const purchasesCol = collection(db, "itemPurchases");
const usagesCol = collection(db, "itemUsages");
const stocktakesCol = collection(db, "itemStocktakes");

export const TYPE_LABELS = { self_made: "自製商品", resale: "現貨商品", packaging: "包材" };
export const ORDERABLE_TYPES = ["self_made", "resale"];
export const STOCK_TRACKED_TYPES = ["resale", "packaging"];

function whoAmI() {
  return {
    email: currentSession.user?.email || null,
    name: getDisplayName(),
  };
}

export function buildItemsIndex(items) {
  const map = new Map();
  items.forEach((i) => map.set(i.id, i));
  return map;
}

/** 庫存：self_made 沒有庫存概念（回傳 null）；其餘用累積總量算 */
export function computeStock(item) {
  if (item.type === "self_made") return null;
  return (item.totalPurchasedQty || 0) - (item.totalUsedQty || 0) + (item.stocktakeAdjustment || 0);
}

/** 均價：resale/packaging 用累積總量算；self_made 沒有均價概念 */
export function computeAvgCost(item) {
  if (item.type === "self_made") return 0;
  return item.totalPurchasedQty > 0 ? item.totalPurchasedCost / item.totalPurchasedQty : 0;
}

/**
 * 算出商品的成本/毛利（只有 self_made / resale 有意義）。
 * self_made：成本 = 配方裡每一項包材成本加總（不含原料/人工，那些每月算在利潤總覽）
 * resale：成本 = 自己的加權平均進貨成本
 */
export function calcItemCost(item, itemsById) {
  if (item.type === "resale") {
    const cost = computeAvgCost(item);
    const profit = item.price - cost;
    return {
      cost, profit,
      margin: item.price > 0 ? profit / item.price : 0,
      isFullCost: true,
      breakdown: [{ label: "現貨進貨均價", amount: cost }],
    };
  }
  if (item.type === "self_made") {
    const recipe = item.recipe || [];
    const breakdown = recipe.map((r) => {
      const comp = itemsById?.get(r.itemId);
      const amount = comp ? computeAvgCost(comp) * r.qty : 0;
      return {
        label: comp ? `${comp.name} x${r.qty}` : "（找不到項目）",
        amount,
        itemId: r.itemId,
        itemName: comp?.name || "（找不到項目）",
        qty: r.qty,
      };
    });
    const cost = breakdown.reduce((s, b) => s + b.amount, 0);
    const profit = item.price - cost;
    return {
      cost, profit,
      margin: item.price > 0 ? profit / item.price : 0,
      isFullCost: false,
      breakdown: breakdown.length ? breakdown : [{ label: "包材成本（尚未設定配方）", amount: 0 }],
    };
  }
  return null; // packaging 不是賣的東西，沒有成本/毛利概念
}

// ---------- 項目主檔 ----------
export async function listItems({ includeArchived = false, type = null } = {}) {
  const snap = await getDocs(itemsCol);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  let filtered = includeArchived ? list : list.filter((i) => i.status !== "archived");
  if (type) filtered = filtered.filter((i) => i.type === type);
  filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return filtered;
}

export async function createItem(data) {
  const who = whoAmI();
  const payload = {
    name: data.name.trim(),
    type: data.type,
    category: data.category || "",
    photoUrl: data.photoUrl || "",
    status: "active",
    createdBy: who.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (ORDERABLE_TYPES.includes(data.type)) payload.price = Number(data.price) || 0;
  if (data.type === "self_made") {
    payload.recipe = data.recipe || [];
  }
  if (STOCK_TRACKED_TYPES.includes(data.type)) {
    payload.unit = data.unit?.trim() || "個";
    payload.lowStockThreshold = Number(data.lowStockThreshold) || 0;
    payload.totalPurchasedQty = 0;
    payload.totalPurchasedCost = 0;
    payload.totalUsedQty = 0;
    payload.stocktakeAdjustment = 0;
  }
  await addDoc(itemsCol, payload);
  logActivity({ module: "items", action: "create", summary: `新增${TYPE_LABELS[data.type]}「${payload.name}」` });
}

export async function updateItem(itemId, data, type) {
  const payload = {
    name: data.name.trim(),
    category: data.category || "",
    photoUrl: data.photoUrl || "",
    updatedAt: serverTimestamp(),
  };
  if (ORDERABLE_TYPES.includes(type)) payload.price = Number(data.price) || 0;
  if (type === "self_made") {
    payload.recipe = data.recipe || [];
  }
  if (STOCK_TRACKED_TYPES.includes(type)) {
    payload.unit = data.unit?.trim() || "個";
    payload.lowStockThreshold = Number(data.lowStockThreshold) || 0;
  }
  await updateDoc(doc(db, "items", itemId), payload);
  logActivity({ module: "items", action: "update", summary: `編輯${TYPE_LABELS[type]}「${payload.name}」` });
}

export async function setItemArchived(itemId, archived, itemName = "") {
  await updateDoc(doc(db, "items", itemId), {
    status: archived ? "archived" : "active",
    updatedAt: serverTimestamp(),
  });
  logActivity({ module: "items", action: archived ? "archive" : "restore", summary: `${archived ? "停用" : "恢復使用"}「${itemName}」` });
}

/**
 * 永久刪除商品：只能刪已停用的商品，避免誤刪還在使用中的資料。
 * 刪除前會檢查有沒有其他「使用中」的自製商品配方還在引用這個項目
 * （通常是包材），有的話會擋下來、列出是哪些商品，請先處理配方再刪。
 * 確定可以刪的話，連同這個商品的進貨/領用/盤點記錄一起真的刪掉，
 * 不留下引用不存在商品的孤兒紀錄。
 */
export async function deleteItemPermanently(itemId) {
  const itemRef = doc(db, "items", itemId);
  const itemSnap = await getDoc(itemRef);
  if (!itemSnap.exists()) throw new Error("找不到項目");
  const item = itemSnap.data();
  if (item.status !== "archived") throw new Error("只能刪除已停用的項目");

  const allItems = await listItems({ includeArchived: true });
  const referencing = allItems.filter((i) =>
    i.id !== itemId && i.status !== "archived" && (i.recipe || []).some((r) => r.itemId === itemId)
  );
  if (referencing.length > 0) {
    throw new Error(`還有使用中的商品配方引用這個項目（${referencing.map((i) => i.name).join("、")}），請先移除配方裡的這個項目再刪除`);
  }

  const [purchases, usages, stocktakes] = await Promise.all([
    listPurchases(itemId),
    listUsages(itemId),
    listStocktakes(itemId),
  ]);
  for (const p of purchases) await deleteDoc(doc(db, "itemPurchases", p.id));
  for (const u of usages) await deleteDoc(doc(db, "itemUsages", u.id));
  for (const s of stocktakes) await deleteDoc(doc(db, "itemStocktakes", s.id));

  await deleteDoc(itemRef);
  logActivity({ module: "items", action: "delete", summary: `「${item.name}」已永久刪除` });
}

// ---------- 進貨（可批次，只能是 resale / packaging） ----------
export async function addPurchaseBatch(rows, { date, freightTotal = 0 } = {}) {
  const who = whoAmI();
  const totalQtyAcrossRows = rows.reduce((s, r) => s + Number(r.qty || 0), 0);

  for (const row of rows) {
    const qty = Number(row.qty);
    if (!qty || qty <= 0) continue;
    const freightShare = totalQtyAcrossRows > 0 ? (freightTotal * qty) / totalQtyAcrossRows : 0;
    const amount = Number(row.amount || 0) + freightShare;
    const itemRef = doc(db, "items", row.itemId);

    await runTransaction(db, async (tx) => {
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists()) throw new Error("找不到項目");
      const item = itemSnap.data();
      if (!STOCK_TRACKED_TYPES.includes(item.type)) throw new Error(`${TYPE_LABELS[item.type]}不能直接採購`);
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

// ---------- 領用/消耗（resale 或 packaging） ----------
export async function addUsage({ itemId, qty, note, source = "manual", orderId = null }) {
  const who = whoAmI();
  const itemRef = doc(db, "items", itemId);
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

/**
 * 報廢/損耗登記：東西真的壞了、丟了、不是賣掉的。
 * 只要填數量，系統自動用「均價」算出損失金額，同時：
 *   1. 扣庫存（跟領用一樣的機制）
 *   2. 自動記一筆「銷貨成本／存貨報廢」支出，損益表會正確反映這筆損失
 * 不用自己打金額，避免算錯、也確保金額跟系統的均價邏輯一致。
 */
export async function disposeStock({ itemId, qty, note }) {
  const who = whoAmI();
  const itemRef = doc(db, "items", itemId);
  let itemName = "";
  let lossAmount = 0;
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("找不到項目");
    const item = itemSnap.data();
    itemName = item.name;
    const stock = computeStock(item);
    if (qty > stock) {
      throw new Error(`庫存不足：${item.name} 只剩 ${stock}，不能報廢 ${qty}`);
    }
    lossAmount = computeAvgCost(item) * qty;
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
      source: "disposal",
      orderId: null,
      status: "active",
      createdBy: who.email,
      createdByName: who.name,
      createdAt: serverTimestamp(),
    });
  });

  await addExpense({
    costType: "cogs",
    category: "存貨報廢",
    amount: lossAmount,
    date: new Date().toISOString().slice(0, 10),
    note: `「${itemName}」報廢/損耗 ${qty} 個${note ? "：" + note : ""}`,
  });
  logActivity({ module: "items", action: "dispose", summary: `「${itemName}」報廢/損耗 ${qty} 個，損失 $${lossAmount.toFixed(0)}` });
  return lossAmount;
}


export async function stocktakeAdjust({ itemId, countedQty, note, recordLoss = true }) {
  const who = whoAmI();
  const itemRef = doc(db, "items", itemId);
  let itemName = "";
  let diff = 0;
  let avgCost = 0;
  await runTransaction(db, async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists()) throw new Error("找不到項目");
    const item = itemSnap.data();
    itemName = item.name;
    if (!STOCK_TRACKED_TYPES.includes(item.type)) throw new Error(`${TYPE_LABELS[item.type]}不能盤點`);
    const systemQtyBefore = computeStock(item);
    diff = Number(countedQty) - systemQtyBefore;
    avgCost = computeAvgCost(item);
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

  // 盤點發現「比系統少」，代表東西真的對不起來，預設自動記一筆報廢/損耗損失
  let lossAmount = 0;
  if (diff < 0 && recordLoss) {
    lossAmount = Math.abs(diff) * avgCost;
    await addExpense({
      costType: "cogs",
      category: "存貨報廢",
      amount: lossAmount,
      date: new Date().toISOString().slice(0, 10),
      note: `「${itemName}」盤點短少 ${Math.abs(diff)} 個${note ? "：" + note : ""}`,
    });
  }
  return { diff, lossAmount };
}

// ---------- 作廢 / 刪除 ----------
export async function voidRecord(kind, recordId) {
  const colName = kind === "purchase" ? "itemPurchases" : "itemUsages";
  const recRef = doc(db, colName, recordId);
  const who = whoAmI();
  await runTransaction(db, async (tx) => {
    const recSnap = await tx.get(recRef);
    if (!recSnap.exists()) throw new Error("找不到記錄");
    const rec = recSnap.data();
    if (rec.status === "void") throw new Error("已經是作廢狀態");
    const itemRef = doc(db, "items", rec.itemId);
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
  const colName = kind === "purchase" ? "itemPurchases" : "itemUsages";
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
  return items.filter((i) => STOCK_TRACKED_TYPES.includes(i.type) && i.lowStockThreshold > 0 && computeStock(i) <= i.lowStockThreshold);
}
