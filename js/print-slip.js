// ============================================================
// 出貨單列印
// 開一個新視窗，排版乾淨的出貨單，不含成本/毛利，叫出瀏覽器列印功能。
// ============================================================
import { alertDialog } from "./modal-ui.js";
import { SHIP_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "./orders.js";

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
    <span class="badge">收款狀態：${PAYMENT_STATUS_LABELS[order.paymentStatus]}</span>
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
