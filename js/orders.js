// ============================================================
// 訂單管理模組
//
// 訂單編號格式：YYYYMMDD + 當天流水號3碼，例如 20260818001
//
// 出貨狀態：pending（待處理）→ shipped（已出貨，視為終點狀態）
// 收款狀態：unpaid（未收款）→ deposit（已收訂金）→ paid（已付清），跟出貨狀態分開獨立追蹤
// voided：作廢（任何出貨狀態都能作廢；如果已經出貨過，作廢時會自動把
//         當初出貨扣掉的庫存還原）
//
// 成本鎖定：訂單成立那一刻，把每個品項當下的商品成本「拍照」存進
// lineItems[].unitCost，之後商品成本再怎麼調整，都不會動到這張訂單
// 已經算好的毛利。
// ============================================================
import { db } from "./firebase-config.js?v=20260830-58";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  serverTimestamp, runTransaction, query, where, orderBy as fbOrderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession, getDisplayName } from "./auth.js?v=20260830-58";
import { addUsage, listUsagesByOrder, voidRecord, calcItemCost, permanentlyDelete, restockFromReturn } from "./items.js?v=20260830-58";
import { logActivity } from "./activity-log.js?v=20260830-58";

const ordersCol = collection(db, "orders");

// ---------- 短期記憶體快取 ----------
// 同一份訂單清單常常在很短時間內被多個地方各自問一次（例如進首頁時
// 「統計卡片」跟「通知鈴鐺」各自呼叫一次 listOrders），與其每次都重新
// 打一次 Firestore，不如把結果先記住一小段時間直接重複使用。
// 只要有任何寫入操作（新增/修改/刪除/出貨/作廢），快取會立刻失效，
// 保證使用者永遠看到最新資料，不會有「改了但畫面沒更新」的問題。
//
// 快取依查詢範圍（startDate）分開存放：抓「全部」跟抓「近3個月」
// 是兩份不同的快取資料，避免互相蓋掉造成資料範圍搞混。
const ORDERS_CACHE_TTL_MS = 30_000;
const ordersCacheByRange = new Map(); // key: startDate || '__all__' -> { data, expiresAt }

function invalidateOrdersCache() {
  ordersCacheByRange.clear();
}

export const SHIP_STATUS_LABELS = { pending: "待處理", shipped: "已出貨" };
export const PAYMENT_STATUS_LABELS = { unpaid: "未收款", deposit: "已收訂金", paid: "已付清" };

/**
 * 把出貨狀態正規化成兩段裡的其中一種。任何不是「已出貨」的值
 * （包含舊資料可能停留的「備貨中」「已完成」），都當作「待處理」/
 * 「已出貨」處理——不只是顯示文字，連可以按哪些操作按鈕的判斷也要用
 * 這個，兩邊才會一致。
 */
export function normalizeShipStatus(status) {
  return status === "shipped" || status === "done" ? "shipped" : "pending";
}

export function getShipStatusLabel(status) {
  return SHIP_STATUS_LABELS[normalizeShipStatus(status)];
}

/**
 * 收款狀態直接從「實收金額」算，但要先扣掉退貨金額——退貨後應收的
 * 金額變少了，不能再用原本的訂單總額去判斷有沒有付清。
 */
export function getPaymentStatus(order) {
  const received = order.amountReceived || 0;
  const effectiveTotal = (order.totalAmount || 0) - (order.returnedAmount || 0);
  if (received <= 0) return "unpaid";
  if (received >= effectiveTotal) return "paid";
  return "deposit";
}

/**
 * 算出「還要跟客戶收多少 / 該退多少給客戶」。
 * 正數：還要跟客戶收這麼多；負數：多收了，該退還客戶這麼多
 * （通常發生在客戶已經付清、後來又退貨的情況）；0：剛好結清。
 */
export function getOutstandingBalance(order) {
  const received = order.amountReceived || 0;
  const effectiveTotal = (order.totalAmount || 0) - (order.returnedAmount || 0);
  return effectiveTotal - received;
}

function whoAmI() {
  return {
    email: currentSession.user?.email || null,
    name: getDisplayName(),
  };
}

async function generateOrderNumber(orderDate) {
  const dateKey = (orderDate || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  const counterRef = doc(db, "counters", `orders_${dateKey}`);
  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = snap.exists() ? (snap.data().next || 1) : 1;
    tx.set(counterRef, { next: next + 1 }, { merge: true });
    return next;
  });
  return `${dateKey}${String(seq).padStart(3, "0")}`;
}

function buildLineItems(rawLineItems, itemsById) {
  return rawLineItems.map((li) => {
    const item = itemsById.get(li.productId);
    const calc = item ? calcItemCost(item, itemsById) : { cost: 0, breakdown: [] };
    return {
      productId: li.productId,
      productName: li.productName,
      productType: item?.type || "self_made",
      qty: Number(li.qty),
      unitPrice: Number(li.unitPrice),
      subtotal: Number(li.qty) * Number(li.unitPrice),
      unitCost: calc?.cost || 0, // 鎖住當下的成本，之後商品成本調整不影響這張訂單
      // 鎖住當下的成本「明細」（哪個包材花多少錢），跟 unitCost 同一個時間點算出來的，
      // 供利潤總覽拆解用，保證「依商品」跟「依包材項目」加總起來永遠對得起來。
      // 只有自製商品才有意義（現貨商品的成本就是它自己的進貨均價，沒有材料明細）。
      costBreakdown: item?.type === "self_made" ? (calc?.breakdown || []) : [],
    };
  });
}

// ---------- 查詢 ----------
/**
 * 查詢訂單清單。
 * @param {Object} [options]
 * @param {string} [options.startDate] - 選填，格式 YYYY-MM-DD。有帶的話，
 *   會直接在 Firestore 查詢端限縮範圍（where orderDate >= startDate），
 *   只下載這個日期之後的訂單，不是「抓全部再篩掉」——訂單量大的時候
 *   能大幅減少下載的資料量跟等待時間。不帶就維持原本「抓全部」的行為
 *   （首頁統計/通知鈴鐺需要看到所有歷史訂單，繼續用這個預設值）。
 *
 *   技術備註：這裡只用單一欄位（orderDate）同時做範圍篩選跟排序，
 *   Firestore 對這種「同一欄位」的組合會自動建好索引，不需要额外
 *   手動去 Firebase 後台建立複合索引，可以安全部署。
 */
export async function listOrders({ startDate } = {}) {
  const cacheKey = startDate || "__all__";
  const cached = ordersCacheByRange.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const q = startDate
    ? query(ordersCol, where("orderDate", ">=", startDate), fbOrderBy("orderDate", "desc"))
    : query(ordersCol, fbOrderBy("orderDate", "desc"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  ordersCacheByRange.set(cacheKey, { data: list, expiresAt: Date.now() + ORDERS_CACHE_TTL_MS });
  return list;
}

export async function getOrder(orderId) {
  const snap = await getDoc(doc(db, "orders", orderId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------- 新增訂單 ----------
export async function createOrder(data, itemsById) {
  const who = whoAmI();
  const orderNumber = await generateOrderNumber(data.orderDate);
  const lineItems = buildLineItems(data.lineItems, itemsById);
  const itemsTotal = lineItems.reduce((s, li) => s + li.subtotal, 0);
  const totalAmount = itemsTotal + (Number(data.shippingFee) || 0);

  const docRef = await addDoc(ordersCol, {
    orderNumber,
    orderDate: data.orderDate || new Date().toISOString().slice(0, 10),
    orderChannel: data.orderChannel || "",
    contactId: data.contactId || null,
    contactName: data.contactName || "",
    contactPhone: data.contactPhone || "",
    contactAddress: data.contactAddress || "",
    lineItems,
    itemsTotal,
    shippingFee: Number(data.shippingFee) || 0,
    totalAmount,
    pickupMethod: data.pickupMethod || "",
    expectedDate: data.expectedDate || "",
    shipStatus: "pending",
    amountReceived: 0,
    voided: false,
    note: data.note || "",
    shippedBy: null,
    shippedByName: null,
    shippedAt: null,
    createdBy: who.email,
    createdByName: who.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logActivity({ module: "orders", action: "create", summary: `新增訂單 ${orderNumber}` });
  invalidateOrdersCache();
  return docRef.id;
}

// ---------- 編輯訂單（只有還沒出貨能改品項；出貨後只能改備註/收款狀態） ----------
export async function updateOrderBeforeShip(orderId, data, itemsById) {
  const lineItems = buildLineItems(data.lineItems, itemsById);
  const itemsTotal = lineItems.reduce((s, li) => s + li.subtotal, 0);
  const totalAmount = itemsTotal + (Number(data.shippingFee) || 0);

  await updateDoc(doc(db, "orders", orderId), {
    orderDate: data.orderDate,
    orderChannel: data.orderChannel || "",
    contactId: data.contactId || null,
    contactName: data.contactName || "",
    contactPhone: data.contactPhone || "",
    contactAddress: data.contactAddress || "",
    lineItems,
    itemsTotal,
    shippingFee: Number(data.shippingFee) || 0,
    totalAmount,
    pickupMethod: data.pickupMethod || "",
    expectedDate: data.expectedDate || "",
    note: data.note || "",
    updatedAt: serverTimestamp(),
  });
  const order = await getOrder(orderId);
  logActivity({ module: "orders", action: "update", summary: `編輯訂單 ${order?.orderNumber || orderId}` });
  invalidateOrdersCache();
}

export async function updateOrderNote(orderId, note) {
  await updateDoc(doc(db, "orders", orderId), { note, updatedAt: serverTimestamp() });
  invalidateOrdersCache();
}

/**
 * 只改備註跟收件地址，不管出貨前出貨後都能用——這兩個欄位不影響
 * 庫存/金額，不需要跟著整張訂單一起鎖住。真的要動到商品/金額，
 * 還是要走「作廢重開」。
 */
export async function updateOrderNoteAndAddress(orderId, { note, contactAddress }) {
  await updateDoc(doc(db, "orders", orderId), {
    note: note || "",
    contactAddress: contactAddress || "",
    updatedAt: serverTimestamp(),
  });
  const order = await getOrder(orderId);
  logActivity({ module: "orders", action: "update", summary: `訂單 ${order?.orderNumber || orderId} 更新備註/收件地址` });
  invalidateOrdersCache();
}

export async function updateAmountReceived(orderId, amount) {
  const who = whoAmI();
  await updateDoc(doc(db, "orders", orderId), {
    amountReceived: Number(amount) || 0,
    receivedBy: who.email,
    receivedByName: who.name,
    updatedAt: serverTimestamp(),
  });
  const order = await getOrder(orderId);
  logActivity({ module: "orders", action: "status", summary: `訂單 ${order?.orderNumber || orderId} 更新收款為 $${amount}` });
  invalidateOrdersCache();
}

/**
 * 標記已出貨：自動依每個品項連結的庫存項目扣庫存，並記錄「誰、何時」。
 * itemsById：Map(itemId -> item)，需含 recipe（自製商品的包材配方）
 */
export async function markShipped(orderId, itemsById) {
  const who = whoAmI();
  const order = await getOrder(orderId);
  if (!order) throw new Error("找不到訂單");
  if (order.voided) throw new Error("這張訂單已作廢");
  if (normalizeShipStatus(order.shipStatus) === "shipped") throw new Error("這張訂單已經出貨過了");

  for (const li of order.lineItems) {
    const item = itemsById.get(li.productId);
    if (!item) continue;
    if (item.type === "self_made") {
      for (const r of item.recipe || []) {
        await addUsage({
          itemId: r.itemId,
          qty: (r.qty || 1) * li.qty,
          note: `訂單 ${order.orderNumber} 出貨自動扣`,
          source: "order",
          orderId,
        });
      }
    } else if (item.type === "resale") {
      await addUsage({
        itemId: item.id,
        qty: li.qty,
        note: `訂單 ${order.orderNumber} 出貨自動扣`,
        source: "order",
        orderId,
      });
    }
  }

  await updateDoc(doc(db, "orders", orderId), {
    shipStatus: "shipped",
    shippedBy: who.email,
    shippedByName: who.name,
    shippedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logActivity({ module: "orders", action: "status", summary: `訂單 ${order.orderNumber} 標記已出貨` });
  invalidateOrdersCache();
}

// ---------- 作廢（任何狀態都可以；已出貨的話自動還原庫存） ----------
export async function voidOrder(orderId) {
  const who = whoAmI();
  const order = await getOrder(orderId);
  if (!order) throw new Error("找不到訂單");
  if (order.voided) throw new Error("已經是作廢狀態");

  if (normalizeShipStatus(order.shipStatus) === "shipped") {
    const usages = await listUsagesByOrder(orderId);
    for (const u of usages) {
      await voidRecord("usage", u.id); // 逐筆作廢，會自動把庫存還原
    }
  }

  await updateDoc(doc(db, "orders", orderId), {
    voided: true,
    voidedBy: who.email,
    voidedByName: who.name,
    voidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logActivity({ module: "orders", action: "void", summary: `訂單 ${order.orderNumber} 已作廢` });
  invalidateOrdersCache();
}

// ---------- 永久刪除（限超級管理員；只能刪已經作廢的訂單，避免誤刪還在使用中的資料） ----------
export async function deleteOrderPermanently(orderId) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("找不到訂單");
  if (!order.voided) throw new Error("只能刪除已作廢的訂單");

  // 訂單出貨時會在商品那邊留一筆「出貨自動扣」的領用記錄；作廢時只會標記成
  // 已作廢（保留紀錄可查），但永久刪除訂單的話，這些記錄也要一併真的刪掉，
  // 不然會變成引用一個已經不存在的訂單編號的孤兒紀錄，商品頁面還是看得到。
  const usages = await listUsagesByOrder(orderId);
  for (const u of usages) {
    await permanentlyDelete("usage", u.id);
  }

  await deleteDoc(doc(db, "orders", orderId));
  logActivity({ module: "orders", action: "delete", summary: `訂單 ${order.orderNumber} 已永久刪除` });
  invalidateOrdersCache();
}

// ---------- 退貨 ----------
// 設計精神比照作廢訂單：不直接改動原本的訂單內容，而是「新增一筆退貨
// 記錄」，保留完整歷史軌跡（原本賣了什麼、後來退了什麼都查得到）。
//
// items 參數格式：[{ productId, productName, qty, unitPrice, restock }]
//   restock: true 表示這批退回來的商品狀況良好、要加回庫存；
//            false 表示已經不能再賣（壞了/用過了），不加回庫存，
//            單純只是退款、不影響庫存
export async function registerReturn(orderId, { items, note }, itemsById) {
  const who = whoAmI();
  const order = await getOrder(orderId);
  if (!order) throw new Error("找不到訂單");
  if (order.voided) throw new Error("這張訂單已作廢，無法登記退貨");
  if (normalizeShipStatus(order.shipStatus) !== "shipped") throw new Error("只有已出貨的訂單能登記退貨");
  if (!items || items.length === 0) throw new Error("請至少選擇一項退貨商品");

  // 檢查每一項退貨數量，不能超過「當初賣出的數量」扣掉「之前已經退過
  // 的數量」——避免同一張訂單同一項商品，退貨退到比賣出去的還多。
  const pastReturns = await listReturnsByOrder(orderId);
  const alreadyReturnedByProduct = new Map();
  for (const r of pastReturns) {
    for (const ri of r.items || []) {
      alreadyReturnedByProduct.set(ri.productId, (alreadyReturnedByProduct.get(ri.productId) || 0) + ri.qty);
    }
  }
  for (const ri of items) {
    const lineItem = order.lineItems.find((li) => li.productId === ri.productId);
    if (!lineItem) throw new Error(`這張訂單裡沒有「${ri.productName}」這項商品`);
    const alreadyReturned = alreadyReturnedByProduct.get(ri.productId) || 0;
    const maxReturnable = lineItem.qty - alreadyReturned;
    if (ri.qty > maxReturnable) {
      throw new Error(`「${ri.productName}」最多只能再退 ${maxReturnable} 個（原賣出 ${lineItem.qty} 個，已退 ${alreadyReturned} 個）`);
    }
  }

  let refundAmount = 0;
  for (const ri of items) {
    refundAmount += ri.qty * ri.unitPrice;
    if (!ri.restock) continue;
    const item = itemsById.get(ri.productId);
    if (!item) continue;
    // 跟出貨扣庫存（markShipped）用同一套「自製商品扣配方包材／現貨商品
    // 扣自己」的邏輯，只是方向相反：退貨時把當初扣掉的加回去。
    if (item.type === "self_made") {
      for (const r of item.recipe || []) {
        await restockFromReturn({
          itemId: r.itemId,
          qty: (r.qty || 1) * ri.qty,
          note: `訂單 ${order.orderNumber} 退貨回補`,
          orderId,
        });
      }
    } else if (item.type === "resale") {
      await restockFromReturn({
        itemId: item.id,
        qty: ri.qty,
        note: `訂單 ${order.orderNumber} 退貨回補`,
        orderId,
      });
    }
  }

  await addDoc(collection(db, "orderReturns"), {
    orderId,
    orderNumber: order.orderNumber,
    items: items.map((ri) => ({
      productId: ri.productId,
      productName: ri.productName,
      qty: ri.qty,
      unitPrice: ri.unitPrice,
      restocked: !!ri.restock,
    })),
    refundAmount,
    note: note || "",
    performedBy: who.email,
    performedByName: who.name,
    createdAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "orders", orderId), {
    returnedAmount: (order.returnedAmount || 0) + refundAmount,
    updatedAt: serverTimestamp(),
  });

  logActivity({ module: "orders", action: "return", summary: `訂單 ${order.orderNumber} 登記退貨，退款 $${refundAmount}` });
  invalidateOrdersCache();
  return refundAmount;
}

export async function listReturnsByOrder(orderId) {
  const q = query(collection(db, "orderReturns"), where("orderId", "==", orderId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return list;
}

/**
 * 抓「全部」退貨記錄（不限特定訂單），給報表/利潤總覽這種需要跨訂單
 * 統計的地方用。退貨記錄的量通常遠少於訂單本身，直接整份抓不會有效能問題。
 */
export async function listAllReturns() {
  const snap = await getDocs(collection(db, "orderReturns"));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}
