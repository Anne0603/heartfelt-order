// ============================================================
// Firebase 初始化
// 這裡的值是「公開設定值」，本來就設計成給前端瀏覽器讀取，不是密鑰。
// 真正需要保密的東西（API Secret 之類）完全不會出現在這個檔案。
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, setPersistence, indexedDBLocalPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
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
// 之前遇到「加到手機主畫面」的獨立模式下，轉跳去 Google 登入完、跳回來
// 之後系統完全遺失登入結果的問題，懷疑就是跟這個沒有明確指定、Firebase
// 自動判斷的時機剛好卡在轉跳的當下有關。改成優先用 indexedDBLocalPersistence
// （比較穩定持久），如果瀏覽器不支援就退回 browserLocalPersistence。
//
// 這裡把設定完成的 Promise 匯出，登入流程（auth.js 的 loginWithGoogle）
// 會明確等它完成才真的轉跳出去，確保「設定生效」跟「按下登入」這兩件事
// 的先後順序一定正確，不留下任何時間競速的可能。
export const authPersistenceReady = setPersistence(auth, indexedDBLocalPersistence).catch(() =>
  setPersistence(auth, browserLocalPersistence).catch(() => {})
);
