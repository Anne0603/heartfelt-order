// ============================================================
// 極簡 Service Worker
//
// 這個檔案的唯一目的，是讓瀏覽器判定這個網站「可以被加到手機主畫面、
// 像一個 App 一樣獨立開啟」。刻意不做任何積極的快取行為——因為這個
// 專案本來就有一套「每次部署都要手動遞增版本號」的機制，避免使用者
// 看到舊版本；如果 Service Worker 又自己快取一份頁面/程式碼，兩套
// 機制會互相打架，反而更容易讓使用者卡在舊版本看不到最新功能。
//
// 所以這裡每個請求都直接放行給瀏覽器正常處理（網路優先），不攔截、
// 不快取、不做離線頁面。之後如果真的想做「離線也能開啟基本畫面」，
// 再回來擴充這個檔案即可。
// ============================================================
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // 只有「本站同源的 GET 請求」才由 Service Worker 接手（接手後也只是
  // 原封不動轉發，不做任何快取，見上方說明）。
  //
  // 其他情況完全不攔截，讓瀏覽器用原生方式直接處理——這是刻意的：
  // 上傳照片這種「帶檔案的 POST 請求」，或是打到 Cloudinary、Firebase
  // 這種不同網域的 API 呼叫，iOS Safari 在 Service Worker 轉發這類
  // 請求時，已知會有內容遺失的相容性問題（曾經造成手機上傳照片時，
  // 表單裡的 upload_preset 欄位莫名消失，送到 Cloudinary 變成空值，
  // 跳出「Upload preset must be specified」的錯誤，即使設定資料本身
  // 完全正確）。乾脆完全不去碰這類請求，讓瀏覽器原生處理最安全。
  const isSameOriginGet = event.request.method === "GET" && new URL(event.request.url).origin === self.location.origin;
  if (!isSameOriginGet) return; // 不呼叫 respondWith，等同沒有 Service Worker 介入這個請求

  event.respondWith(fetch(event.request));
});
