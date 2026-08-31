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
  event.respondWith(fetch(event.request));
});
