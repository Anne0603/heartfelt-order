// ============================================================
// Firebase 初始化
// 這裡的值是「公開設定值」，本來就設計成給前端瀏覽器讀取，不是密鑰。
// 真正需要保密的東西（API Secret 之類）完全不會出現在這個檔案。
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAQF4J3WMLZjE4dHAif7WH6vU3hu9XKm6s",
  authDomain: "heartfelt-order.firebaseapp.com",
  projectId: "heartfelt-order",
  storageBucket: "heartfelt-order.firebasestorage.app",
  messagingSenderId: "497539783911",
  appId: "1:497539783911:web:be4349eae143828cec9642"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// 明確指定「登入狀態要怎麼記住」，不要讓 Firebase 自動猜測要用哪種方式。
// 之前遇到「加到手機主畫面」的獨立模式下，登入完之後系統認不出登入
// 結果的問題，比對另一個專案實際驗證有效的做法後，改用
// browserLocalPersistence（不是 indexedDBLocalPersistence，那個版本
// 試過沒有解決問題）。
//
// 這裡把設定完成的 Promise 匯出，登入流程（auth.js 的 loginWithGoogle）
// 會明確等它完成才真的進行登入，確保「設定生效」跟「按下登入」這兩件事
// 的先後順序一定正確，不留下任何時間競速的可能。
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => {});
