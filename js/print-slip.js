// ============================================================
// 出貨單列印
// 開一個新視窗，排版乾淨的出貨單，不含成本/毛利，叫出瀏覽器列印功能。
// ============================================================
import { alertDialog } from "./modal-ui.js?v=20260826-21";
import { SHIP_STATUS_LABELS, PAYMENT_STATUS_LABELS, getPaymentStatus } from "./orders.js?v=20260826-21";

export function printOrderSlip(order) {
  const win = window.open("", "_blank", "width=480,height=700");
  if (!win) {
    alertDialog("瀏覽器擋住了列印視窗，請允許彈出視窗後再試一次。");
    return;
  }

  const lineRows = order.lineItems.map((li) => `
    <tr>
      <td>${li.productName}</td>
      <td style="text-align:center;">${li.qty}</td>
      <td style="text-align:right;">$${li.unitPrice}</td>
      <td style="text-align:right;">$${li.subtotal}</td>
    </tr>
  `).join("");

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<title>出貨單 ${order.orderNumber}</title>
<style>
  body { font-family: -apple-system, "Noto Sans TC", sans-serif; padding: 24px; color: #23262E; max-width: 420px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #746F62; font-size: 13px; margin-bottom: 16px; }
  .section { margin-bottom: 16px; }
  .section .label { font-size: 12px; color: #746F62; margin-bottom: 2px; }
  .section .value { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { padding: 6px 4px; border-bottom: 1px solid #E3DDCC; font-size: 13px; text-align: left; }
  .totals { text-align: right; font-size: 14px; margin-top: 8px; }
  .totals .grand { font-size: 18px; font-weight: 700; margin-top: 4px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; background: #F4F1E9; font-size: 12px; margin-right: 6px; }
  .footer { margin-top: 24px; font-size: 11px; color: #9AA0B4; text-align: center; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>心意 · 出貨單</h1>
  <div class="sub">訂單編號：${order.orderNumber}　訂購日期：${order.orderDate}</div>

  <div class="section">
    <div class="label">客戶</div>
    <div class="value">${order.contactName || "（未指定）"}</div>
  </div>
  ${order.contactPhone ? `<div class="section"><div class="label">聯絡電話</div><div class="value">${order.contactPhone}</div></div>` : ""}
  ${order.contactAddress ? `<div class="section"><div class="label">收件地址</div><div class="value">${order.contactAddress}</div></div>` : ""}

  <div class="section">
    <span class="badge">${order.pickupMethod || "未指定取貨方式"}</span>
    ${order.expectedDate ? `<span class="badge">預計 ${order.expectedDate}</span>` : ""}
  </div>

  <table>
    <thead><tr><th>品項</th><th style="text-align:center;">數量</th><th style="text-align:right;">單價</th><th style="text-align:right;">小計</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals">
    <div>商品小計：$${order.itemsTotal}</div>
    <div>運費：$${order.shippingFee}</div>
    <div class="grand">總金額：$${order.totalAmount}</div>
  </div>

  <div class="section" style="margin-top:16px;">
    <span class="badge">收款狀態：${PAYMENT_STATUS_LABELS[getPaymentStatus(order)]}${order.amountReceived ? `（已收 $${order.amountReceived}${order.totalAmount - order.amountReceived > 0 ? `，尚欠 $${order.totalAmount - order.amountReceived}` : ""}）` : ""}</span>
  </div>

  ${order.note ? `<div class="section"><div class="label">備註</div><div class="value">${order.note}</div></div>` : ""}

  <div class="footer">列印時間：${new Date().toLocaleString("zh-TW")}</div>

  <script>
    window.onload = function() { setTimeout(function(){ window.print(); }, 200); };
  </script>
</body>
</html>
  `;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ============================================================
// 批次出貨清單：把好幾張訂單合併成一張清單列印，一列一張訂單，
// 商品明細每一項獨立一行（不逗號擠在一起），左邊留空格方便打勾核對。
// ============================================================
export function printShippingList(ordersList) {
  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) {
    alertDialog("瀏覽器擋住了列印視窗，請允許彈出視窗後再試一次。");
    return;
  }

  const rows = ordersList.map((order, idx) => {
    const itemsHtml = order.lineItems.map((li) => `<div class="item-line">${li.productName} <b>x${li.qty}</b></div>`).join("");
    const outstanding = order.totalAmount - (order.amountReceived || 0);
    const amountHtml = outstanding > 0
      ? `<div class="amount-due">應收 $${outstanding}</div>`
      : `<div class="amount-paid">已收款</div>`;
    // 自取不需要地址，宅配/郵寄/超商取貨這種才需要現場知道要送去哪
    const needsAddress = order.pickupMethod && order.pickupMethod !== "自取";
    return `
      <tr>
        <td class="check-col"><span class="checkbox"></span></td>
        <td>${idx + 1}</td>
        <td>
          <div class="order-no">${order.orderNumber}</div>
          <div class="sub2">${order.contactName || "（未指定）"}${order.contactPhone ? " · " + order.contactPhone : ""}</div>
          ${needsAddress && order.contactAddress ? `<div class="sub2">${order.contactAddress}</div>` : ""}
        </td>
        <td>${itemsHtml}</td>
        <td>${order.pickupMethod || ""}</td>
        <td>${amountHtml}</td>
      </tr>
    `;
  }).join("");

  const html = `
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<title>今日出貨清單</title>
<style>
  body { font-family: -apple-system, "Noto Sans TC", sans-serif; padding: 24px; color: #23262E; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #746F62; font-size: 13px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 8px; border-bottom: 1px solid #E3DDCC; font-size: 14px; text-align: left; vertical-align: top; }
  th { font-size: 12px; color: #746F62; font-weight: 600; border-bottom: 2px solid #23262E; }
  .check-col { width: 30px; }
  .checkbox { display: inline-block; width: 16px; height: 16px; border: 1.5px solid #23262E; }
  .order-no { font-family: "SFMono-Regular", monospace; font-weight: 700; }
  .sub2 { font-size: 12.5px; color: #746F62; margin-top: 2px; }
  .item-line { margin-bottom: 2px; }
  .amount-due { font-weight: 700; color: #A8433A; white-space: nowrap; }
  .amount-paid { color: #4A7A5E; white-space: nowrap; }
  .footer { margin-top: 20px; font-size: 11px; color: #9AA0B4; text-align: right; }
  @media print { body { padding: 0; } tr { page-break-inside: avoid; } }
</style>
</head>
<body>
  <h1>心意 · 今日出貨清單</h1>
  <div class="sub">共 ${ordersList.length} 張訂單　列印時間：${new Date().toLocaleString("zh-TW")}</div>
  <div class="sub" style="font-weight:700;color:#A8433A;">這趟總共應收 $${ordersList.reduce((s, o) => s + Math.max(0, o.totalAmount - (o.amountReceived || 0)), 0)}</div>
  <table>
    <thead><tr><th></th><th>#</th><th>訂單 / 客戶</th><th>商品明細</th><th>取貨方式</th><th>應收</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    window.onload = function() { setTimeout(function(){ window.print(); }, 200); };
  </script>
</body>
</html>
  `;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
