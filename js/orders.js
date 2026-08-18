// ============================================================
// 訂單管理模組
//
// 訂單編號格式：YYYYMMDD + 當天流水號3碼，例如 20260818001
// （用 counters/{YYYYMMDD} 文件的 next 欄位，交易遞增，每天重新從 1 算起）
//
// 出貨狀態：pending（待處理）→ preparing（備貨中）→ shipped（已出貨）→ done（已完成）
// 收款狀態：unpaid（未收款）→ deposit（已收訂金）→ paid（已付清）
// voided：作廢（任何出貨狀態都能作廢；如果已經出貨過，作廢時會自動把
//         當初出貨扣掉的庫存還原 —— 逐筆作廢當初出貨自動產生的
//         inventoryUsages 記錄，沿用 inventory.js 現成的邏輯）
//
// 成本鎖定：訂單成立那一刻，把每個品項當下的商品成本「拍照」存進
// lineItems[].unitCost，之後商品成本再怎麼調整，都不會動到這張訂單
// 已經算好的毛利。
// ============================================================
import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  serverTimestamp, runTransaction, query, orderBy as fbOrderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { currentSession } from "./auth.js";
import { consumeItem, listUsagesByOrder, voidRecord } from "./inventory.js";
import { calcProductCost } from "./products.js";

const ordersCol = collection(db, "orders");

export const SHIP_STATUS_LABELS = { pending: "待處理", preparing: "備貨中", shipped: "已出貨", done: "已完成" };
export const PAYMENT_STATUS_LABELS = { unpaid: "未收款", deposit: "已收訂金", paid: "已付清" };

function whoAmI() {
  return {
    email: currentSession.user?.email || null,
    name: currentSession.user?.displayName || currentSession.user?.email || "未知",
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

function buildLineItems(rawLineItems, productsById, itemsById) {
  return rawLineItems.map((li) => {
    const product = productsById.get(li.productId);
    const calc = product ? calcProductCost(product, itemsById) : { cost: 0 };
    return {
      productId: li.productId,
      productName: li.productName,
      productType: product?.productType || "self_made",
      qty: Number(li.qty),
      unitPrice: Number(li.unitPrice),
      subtotal: Number(li.qty) * Number(li.unitPrice),
      unitCost: calc.cost, // 鎖住當下的成本，之後商品成本調整不影響這張訂單
    };
  });
}

// ---------- 查詢 ----------
export async function listOrders() {
  const q = query(ordersCol, fbOrderBy("orderDate", "desc"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

export async function getOrder(orderId) {
  const snap = await getDoc(doc(db, "orders", orderId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------- 新增訂單 ----------
export async function createOrder(data, productsById, itemsById) {
  const who = whoAmI();
  const orderNumber = await generateOrderNumber(data.orderDate);
  const lineItems = buildLineItems(data.lineItems, productsById, itemsById);
  const itemsTotal = lineItems.reduce((s, li) => s + li.subtotal, 0);
  const totalAmount = itemsTotal + (Number(data.shippingFee) || 0);

  const docRef = await addDoc(ordersCol, {
    orderNumber,
    orderDate: data.orderDate || new Date().toISOString().slice(0, 10),
    orderChannel: data.orderChannel || "",
    contactId: data.contactId || null,
    contactName: data.contactName || "",
    lineItems,
    itemsTotal,
    shippingFee: Number(data.shippingFee) || 0,
    totalAmount,
    pickupMethod: data.pickupMethod || "",
    expectedDate: data.expectedDate || "",
    shipStatus: "pending",
    paymentStatus: "unpaid",
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
  return docRef.id;
}

// ---------- 編輯訂單（只有還沒出貨能改品項；出貨後只能改備註/收款狀態） ----------
export async function updateOrderBeforeShip(orderId, data, productsById, itemsById) {
  const lineItems = buildLineItems(data.lineItems, productsById, itemsById);
  const itemsTotal = lineItems.reduce((s, li) => s + li.subtotal, 0);
  const totalAmount = itemsTotal + (Number(data.shippingFee) || 0);

  await updateDoc(doc(db, "orders", orderId), {
    orderDate: data.orderDate,
    orderChannel: data.orderChannel || "",
    contactId: data.contactId || null,
    contactName: data.contactName || "",
    lineItems,
    itemsTotal,
    shippingFee: Number(data.shippingFee) || 0,
    totalAmount,
    pickupMethod: data.pickupMethod || "",
    expectedDate: data.expectedDate || "",
    note: data.note || "",
    updatedAt: serverTimestamp(),
  });
}

export async function updateOrderNote(orderId, note) {
  await updateDoc(doc(db, "orders", orderId), { note, updatedAt: serverTimestamp() });
}

export async function updatePaymentStatus(orderId, paymentStatus) {
  await updateDoc(doc(db, "orders", orderId), { paymentStatus, updatedAt: serverTimestamp() });
}

export async function markPreparing(orderId) {
  await updateDoc(doc(db, "orders", orderId), { shipStatus: "preparing", updatedAt: serverTimestamp() });
}

export async function markDone(orderId) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("找不到訂單");
  if (order.shipStatus !== "shipped") throw new Error("要先出貨才能標記完成");
  await updateDoc(doc(db, "orders", orderId), { shipStatus: "done", updatedAt: serverTimestamp() });
}

/**
 * 標記已出貨：自動依每個品項連結的庫存項目扣庫存，並記錄「誰、何時」。
 * productsById: Map(productId -> product)，需含 mainItemId/mainItemQty 或 linkedInventoryItemId
 */
export async function markShipped(orderId, productsById) {
  const who = whoAmI();
  const order = await getOrder(orderId);
  if (!order) throw new Error("找不到訂單");
  if (order.voided) throw new Error("這張訂單已作廢");
  if (["shipped", "done"].includes(order.shipStatus)) throw new Error("這張訂單已經出貨過了");

  for (const li of order.lineItems) {
    const product = productsById.get(li.productId);
    if (!product) continue;
    if (product.productType === "self_made" && product.mainItemId) {
      await consumeItem({
        itemId: product.mainItemId,
        qty: (product.mainItemQty || 1) * li.qty,
        note: `訂單 ${order.orderNumber} 出貨自動扣`,
        source: "order",
        orderId,
      });
    } else if (product.productType === "resale" && product.linkedInventoryItemId) {
      await consumeItem({
        itemId: product.linkedInventoryItemId,
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
}

// ---------- 作廢（任何狀態都可以；已出貨的話自動還原庫存） ----------
export async function voidOrder(orderId) {
  const who = whoAmI();
  const order = await getOrder(orderId);
  if (!order) throw new Error("找不到訂單");
  if (order.voided) throw new Error("已經是作廢狀態");

  if (["shipped", "done"].includes(order.shipStatus)) {
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
}
