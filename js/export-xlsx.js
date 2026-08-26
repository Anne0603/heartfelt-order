// ============================================================
// 匯出 Excel（純前端，點擊直接下載，不需要後端伺服器）
// ============================================================
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import { SHIP_STATUS_LABELS, PAYMENT_STATUS_LABELS, getPaymentStatus, getShipStatusLabel } from "./orders.js?v=20260826-9";
import { TYPE_LABELS, ORDERABLE_TYPES, STOCK_TRACKED_TYPES, computeStock, computeAvgCost, calcItemCost, buildItemsIndex } from "./items.js?v=20260826-9";

function downloadWorkbook(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- 訂單匯出（訂單摘要 + 品項明細，兩個分頁） ----------
export function exportOrders(orders, { includeCost }) {
  const orderRows = orders.map((o) => {
    const profit = o.lineItems.reduce((s, li) => s + (li.subtotal - li.unitCost * li.qty), 0);
    const row = {
      訂單編號: o.orderNumber,
      訂購日期: o.orderDate,
      客戶: o.contactName || "",
      訂購管道: o.orderChannel || "",
      出貨狀態: getShipStatusLabel(o.shipStatus),
      收款狀態: PAYMENT_STATUS_LABELS[getPaymentStatus(o)],
      實收金額: o.amountReceived || 0,
      尚欠金額: o.totalAmount - (o.amountReceived || 0),
      商品小計: o.itemsTotal,
      運費: o.shippingFee,
      總金額: o.totalAmount,
    };
    if (includeCost) row.毛利 = Number(profit.toFixed(0));
    row.取貨方式 = o.pickupMethod || "";
    row.預計出貨日 = o.expectedDate || "";
    row.備註 = o.note || "";
    row.作廢 = o.voided ? "是" : "";
    return row;
  });

  const lineItemRows = [];
  orders.forEach((o) => {
    o.lineItems.forEach((li) => {
      const row = {
        訂單編號: o.orderNumber,
        訂購日期: o.orderDate,
        商品名稱: li.productName,
        數量: li.qty,
        單價: li.unitPrice,
        小計: li.subtotal,
      };
      if (includeCost) {
        row.單位成本 = Number(li.unitCost.toFixed(2));
        row.品項毛利 = Number((li.subtotal - li.unitCost * li.qty).toFixed(0));
      }
      lineItemRows.push(row);
    });
  });

  downloadWorkbook(
    [
      { name: "訂單", rows: orderRows },
      { name: "品項明細", rows: lineItemRows },
    ],
    `訂單匯出_${todayStr()}.xlsx`
  );
}

// ---------- 商品與庫存匯出 ----------
export function exportItems(items, { includeCost }) {
  const itemsById = buildItemsIndex(items);
  const rows = items.map((item) => {
    const calc = calcItemCost(item, itemsById);
    const row = {
      名稱: item.name,
      類型: TYPE_LABELS[item.type] || item.type,
      分類: item.category || "",
    };
    if (ORDERABLE_TYPES.includes(item.type)) row.售價 = item.price;
    if (STOCK_TRACKED_TYPES.includes(item.type)) {
      row.庫存 = computeStock(item);
      row.單位 = item.unit || "個";
      if (includeCost) row.均價 = Number(computeAvgCost(item).toFixed(2));
    }
    if (includeCost && calc) {
      row.成本 = Number(calc.cost.toFixed(2));
      row.毛利 = Number(calc.profit.toFixed(1));
    }
    row.狀態 = item.status === "archived" ? "已停用/下架" : "使用中";
    return row;
  });

  downloadWorkbook([{ name: "商品與庫存", rows }], `商品與庫存匯出_${todayStr()}.xlsx`);
}

// ---------- 客戶與廠商匯出 ----------
export function exportContacts(contacts) {
  const ROLE_LABELS = { customer: "客戶", supplier: "廠商" };
  const rows = contacts.map((c) => ({
    名稱: c.name,
    類型: (c.roles || []).map((r) => ROLE_LABELS[r]).join("、"),
    聯絡電話: c.phone || "",
    地址: c.address || "",
    訂購管道: c.orderChannel || "",
    供應類別: c.supplyCategory || "",
    備註: c.note || "",
    狀態: c.status === "archived" ? "已停用" : "使用中",
  }));
  downloadWorkbook([{ name: "客戶與廠商", rows }], `客戶與廠商匯出_${todayStr()}.xlsx`);
}
