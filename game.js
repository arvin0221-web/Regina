// ===================== FIREBASE 設定 =====================
// ⚠️ 把下面這段換成你自己的 Firebase 設定
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ===================== 遊戲狀態 =====================
let currentUser = null; // { id, name, coins, holdings, lastCheckin }

const COMPANIES = [
  { id: "naijiDian",    name: "奶機電",        price: 100, volatility: 0.001 },
  { id: "xiaopiyan",    name: "小皮炎科技公司", price: 100, volatility: 0.01 },
  { id: "kuansongpiyan",name: "寬鬆皮炎有限公司",price: 100, volatility: 0.1 },
  { id: "ciqiong",      name: "慈瓊公司",       price: 100, volatility: 1.0 },
];

const HORSE_NAMES = { red:"紅馬", yellow:"黃馬", blue:"藍馬", green:"綠馬" };
const FINISH_LINE = 15;

// ===================== 工具函式 =====================
function showToast(msg, duration = 2500) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

function formatCoins(n) {
  return Math.round(n).toLocaleString("zh-TW");
}

function getInitial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

function setAvatar(el, name) {
  el.textContent = getInitial(name);
}

// ===================== 玩家資料 =====================
async function loadOrCreatePlayer(name) {
  const safeId = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "_");
  const docRef = db.collection("players").doc(safeId);
  const snap = await docRef.get();

  if (!snap.exists) {
    const newPlayer = {
      id: safeId,
      name: name.trim(),
      coins: 5000,
      holdings: {},
      lastCheckin: null,
      createdAt: Date.now()
    };
    await docRef.set(newPlayer);
    return newPlayer;
  }
  return { id: safeId, ...snap.data() };
}

async function savePlayer() {
  if (!currentUser) return;
  await db.collection("players").doc(currentUser.id).set({
    name: currentUser.name,
    coins: currentUser.coins,
    holdings: currentUser.holdings || {},
    lastCheckin: currentUser.lastCheckin || null,
    updatedAt: Date.now()
  }, { merge: true });
}

function updateNavCoins() {
  document.getElementById("nav-coins").textContent = formatCoins(currentUser.coins);
  document.getElementById("home-coins").textContent = formatCoins(currentUser.coins);
}

// ===================== 股票系統 =====================
async function loadStockPrices() {
  const snap = await db.collection("stocks").get();
  if (snap.empty) {
    // 初始化股票
    for (const co of COMPANIES) {
      await db.collection("stocks").doc(co.id).set({
        name: co.name,
        price: co.price,
        volatility: co.volatility,
        lastUpdated: Date.now()
      });
    }
    return COMPANIES.map(c => ({ ...c }));
  }
  const result = [];
  snap.forEach(doc => {
    const data = doc.data();
    const base = COMPANIES.find(c => c.id === doc.id);
    result.push({ id: doc.id, ...base, ...data });
  });
  return result;
}

async function fluctuateStocks(stocks) {
  // 每小時波動 — 檢查是否超過1小時沒更新
  const now = Date.now();
  const batch = db.batch();
  const updated = [];

  for (const co of stocks) {
    const snap = await db.collection("stocks").doc(co.id).get();
    const data = snap.data();
    const last = data.lastUpdated || 0;
    if (now - last > 3600000) {
      const change = (Math.random() * 2 - 1) * co.volatility;
      const newPrice = Math.max(0.01, data.price * (1 + change));
      batch.update(db.collection("stocks").doc(co.id), {
        price: parseFloat(newPrice.toFixed(4)),
        lastUpdated: now
      });
      updated.push({ ...co, price: newPrice });
    } else {
      updated.push({ ...co, price: data.price });
    }
  }
  await batch.commit();
  return updated;
}

let currentStocks = [];
let selectedCompany = null;

async function renderStocks() {
  const grid = document.getElementById("stock-grid");
  grid.innerHTML = "<p style='color:var(--text2)'>載入中...</p>";
  currentStocks = await loadStockPrices();
  currentStocks = await fluctuateStocks(currentStocks);

  grid.innerHTML = "";
  for (const co of currentStocks) {
    const card = document.createElement("div");
    card.className = "stock-card";
    card.innerHTML = `
      <div class="stock-name">${co.name}</div>
      <div class="stock-price">🪙 ${co.price.toFixed(4)}</div>
      <div class="stock-vol">波動幅度：±${(co.volatility * 100).toFixed(1)}%/小時</div>
    `;
    card.onclick = () => openStockModal(co);
    grid.appendChild(card);
  }
  renderHoldings();
}

function renderHoldings() {
  const list = document.getElementById("holdings-list");
  const holdings = currentUser.holdings || {};
  const entries = Object.entries(holdings).filter(([, shares]) => shares > 0);

  if (entries.length === 0) {
    list.innerHTML = "<p style='color:var(--text2);font-size:0.9rem'>你目前沒有持股</p>";
    return;
  }
  list.innerHTML = "";
  for (const [companyId, shares] of entries) {
    const co = currentStocks.find(c => c.id === companyId);
    if (!co) continue;
    const worth = shares * co.price;
    const item = document.createElement("div");
    item.className = "holding-item";
    item.innerHTML = `
      <div>
        <div class="holding-name">${co.name}</div>
        <div class="holding-detail">${shares.toFixed(6)} 股 × 🪙 ${co.price.toFixed(4)}</div>
      </div>
      <div class="holding-value">🪙 ${formatCoins(worth)}</div>
    `;
    list.appendChild(item);
  }
}

function openStockModal(co) {
  selectedCompany = co;
  document.getElementById("modal-title").textContent = co.name;
  document.getElementById("modal-price").textContent = `目前股價：🪙 ${co.price.toFixed(4)}`;
  const owned = (currentUser.holdings || {})[co.id] || 0;
  document.getElementById("modal-owned").textContent = `我的持股：${owned.toFixed(6)} 股`;
  document.getElementById("modal-buy-amount").value = "";
  document.getElementById("modal-sell-shares").value = "";
  document.getElementById("modal-buy-hint").textContent = `你有 🪙 ${formatCoins(currentUser.coins)}`;
  document.getElementById("modal-sell-hint").textContent = `你有 ${owned.toFixed(6)} 股`;
  switchModalTab("buy");
  document.getElementById("stock-modal").style.display = "flex";
}

function switchModalTab(tab) {
  document.getElementById("modal-buy-tab").classList.toggle("active", tab === "buy");
  document.getElementById("modal-sell-tab").classList.toggle("active", tab === "sell");
  document.getElementById("modal-buy-section").style.display = tab === "buy" ? "block" : "none";
  document.getElementById("modal-sell-section").style.display = tab === "sell" ? "block" : "none";
}

document.getElementById("modal-buy-tab").onclick = () => switchModalTab("buy");
document.getElementById("modal-sell-tab").onclick = () => switchModalTab("sell");
document.getElementById("modal-close").onclick = () => {
  document.getElementById("stock-modal").style.display = "none";
};

document.getElementById("modal-buy-btn").onclick = async () => {
  const amount = parseFloat(document.getElementById("modal-buy-amount").value);
  if (!amount || amount <= 0) return showToast("❌ 請輸入有效金額");
  if (amount > currentUser.coins) return showToast("❌ 金幣不足！");

  const shares = amount / selectedCompany.price;
  currentUser.coins -= amount;
  currentUser.holdings = currentUser.holdings || {};
  currentUser.holdings[selectedCompany.id] = (currentUser.holdings[selectedCompany.id] || 0) + shares;

  await savePlayer();
  updateNavCoins();
  showToast(`✅ 買入 ${shares.toFixed(6)} 股 ${selectedCompany.name}`);
  document.getElementById("stock-modal").style.display = "none";
  renderStocks();
};

document.getElementById("modal-sell-all-btn").onclick = () => {
  const owned = (currentUser.holdings || {})[selectedCompany.id] || 0;
  document.getElementById("modal-sell-shares").value = owned.toFixed(6);
};

document.getElementById("modal-sell-btn").onclick = async () => {
  const shares = parseFloat(document.getElementById("modal-sell-shares").value);
  const owned = (currentUser.holdings || {})[selectedCompany.id] || 0;
  if (!shares || shares <= 0) return showToast("❌ 請輸入有效股數");
  if (shares > owned) return showToast("❌ 持股不足！");

  const revenue = shares * selectedCompany.price;
  currentUser.coins += revenue;
  currentUser.holdings[selectedCompany.id] = owned - shares;

  await savePlayer();
  updateNavCoins();
  showToast(`✅ 賣出 ${shares.toFixed(6)} 股，獲得 🪙 ${formatCoins(revenue)}`);
  document.getElementById("stock-modal").style.display = "none";
  renderStocks();
};

// ===================== 賭馬 =====================
let racePositions = { red: 0, yellow: 0, blue: 0, green: 0 };
let raceInterval = null;

document.getElementById("start-horse-btn").onclick = () => {
  const horse = document.querySelector('input[name="horse"]:checked')?.value;
  const amount = parseFloat(document.getElementById("horse-bet-amount").value);
  if (!horse) return showToast("❌ 請選擇一隻馬！");
  if (!amount || amount <= 0) return showToast("❌ 請輸入下注金額！");
  if (amount > currentUser.coins) return showToast("❌ 金幣不足！");

  currentUser.coins -= amount;
  updateNavCoins();
  startRace(horse, amount);
};

function startRace(bettedHorse, betAmount) {
  document.getElementById("horse-idle").style.display = "none";
  document.getElementById("horse-racing").style.display = "block";
  document.getElementById("horse-result").style.display = "none";

  // Reset positions
  racePositions = { red: 0, yellow: 0, blue: 0, green: 0 };
  for (const h of ["red","yellow","blue","green"]) {
    const runner = document.getElementById(`runner-${h}`);
    runner.style.left = "4px";
    document.getElementById(`track-${h}`).classList.remove("winner");
  }

  document.getElementById("race-status").textContent = "比賽進行中...🏃";
  const TRACK_WIDTH = document.querySelector(".track-lane").offsetWidth - 40;

  raceInterval = setInterval(() => {
    let finished = [];
    for (const h of ["red","yellow","blue","green"]) {
      if (racePositions[h] < FINISH_LINE) {
        racePositions[h] = Math.min(FINISH_LINE, racePositions[h] + Math.floor(Math.random() * 3) + 1);
      }
      const pct = racePositions[h] / FINISH_LINE;
      document.getElementById(`runner-${h}`).style.left = `${4 + pct * (TRACK_WIDTH - 8)}px`;
      if (racePositions[h] >= FINISH_LINE) finished.push(h);
    }

    if (finished.length > 0) {
      clearInterval(raceInterval);
      const winner = finished[Math.floor(Math.random() * finished.length)];
      document.getElementById(`track-${winner}`).classList.add("winner");
      document.getElementById("race-status").textContent = `🏆 ${HORSE_NAMES[winner]} 獲勝！`;
      setTimeout(() => showRaceResult(winner, bettedHorse, betAmount), 600);
    }
  }, 1000);
}

async function showRaceResult(winner, bettedHorse, betAmount) {
  document.getElementById("horse-racing").style.display = "none";
  document.getElementById("horse-result").style.display = "block";

  const titleEl = document.getElementById("result-title");
  const detailEl = document.getElementById("result-detail");

  if (winner === bettedHorse) {
    const prize = betAmount * 4;
    currentUser.coins += prize;
    titleEl.innerHTML = `🎉 你贏了！`;
    titleEl.style.color = "var(--green)";
    detailEl.textContent = `${HORSE_NAMES[winner]} 獲勝！你獲得 🪙 ${formatCoins(prize)}（下注 × 4）`;
    sendSystemMsg(`🎉 ${currentUser.name} 押 ${HORSE_NAMES[bettedHorse]} 贏得 🪙 ${formatCoins(prize)}！`);
  } else {
    titleEl.innerHTML = `💸 你輸了`;
    titleEl.style.color = "var(--red)";
    detailEl.textContent = `${HORSE_NAMES[winner]} 獲勝，你押的是 ${HORSE_NAMES[bettedHorse]}。損失 🪙 ${formatCoins(betAmount)}`;
    sendSystemMsg(`💸 ${currentUser.name} 押 ${HORSE_NAMES[bettedHorse]} 輸掉 🪙 ${formatCoins(betAmount)}。`);
  }
  await savePlayer();
  updateNavCoins();
}

document.getElementById("race-again-btn").onclick = () => {
  document.getElementById("horse-result").style.display = "none";
  document.getElementById("horse-idle").style.display = "block";
  document.querySelector('input[name="horse"]:checked') && (document.querySelector('input[name="horse"]:checked').checked = false);
  document.getElementById("horse-bet-amount").value = "";
};

// ===================== 簽到 =====================
document.getElementById("checkin-btn").onclick = async () => {
  const today = new Date().toISOString().split("T")[0];
  if (currentUser.lastCheckin === today) {
    document.getElementById("checkin-msg").textContent = "今天已經簽到過了，明天再來！";
    return;
  }
  const reward = Math.floor(Math.random() * 4000) + 1000;
  currentUser.coins += reward;
  currentUser.lastCheckin = today;
  await savePlayer();
  updateNavCoins();
  document.getElementById("checkin-msg").textContent = `✅ 簽到成功！獲得 🪙 ${formatCoins(reward)}`;
};

// ===================== 排行榜 =====================
async function loadLeaderboard() {
  const snap = await db.collection("players").orderBy("coins", "desc").limit(200).get();
  const all = [];
  snap.forEach(doc => all.push({ id: doc.id, ...doc.data() }));

  const list = document.getElementById("leaderboard-list");
  list.innerHTML = "";
  let myRank = -1;
  let myCoins = 0;

  const top100 = all.slice(0, 100);

  top100.forEach((p, i) => {
    const rank = i + 1;
    if (p.id === currentUser.id) myRank = rank;

    const item = document.createElement("div");
    item.className = "lb-item" + (p.id === currentUser.id ? " is-me" : "");
    item.draggable = true;
    item.dataset.index = i;

    let rankClass = "";
    let rankDisplay = `#${rank}`;
    if (rank === 1) { rankClass = "gold"; rankDisplay = "🥇"; }
    else if (rank === 2) { rankClass = "silver"; rankDisplay = "🥈"; }
    else if (rank === 3) { rankClass = "bronze"; rankDisplay = "🥉"; }

    item.innerHTML = `
      <div class="lb-rank ${rankClass}">${rankDisplay}</div>
      <div class="lb-avatar">${getInitial(p.name)}</div>
      <div class="lb-name">${p.name}${p.id === currentUser.id ? " <span style='color:var(--gold);font-size:0.75rem'>(你)</span>" : ""}</div>
      <div class="lb-coins">🪙 ${formatCoins(p.coins)}</div>
    `;
    list.appendChild(item);
  });

  // 若玩家不在前百
  if (myRank === -1) {
    const myIdx = all.findIndex(p => p.id === currentUser.id);
    if (myIdx !== -1) {
      myRank = myIdx + 1;
      myCoins = all[myIdx].coins;
    }
  }

  const myRow = document.getElementById("my-rank-row");
  if (myRank > 100) {
    myRow.style.display = "flex";
    myRow.innerHTML = `
      <span>你的名次：</span>
      <strong>#${myRank}</strong>
      <span style="flex:1">${currentUser.name}</span>
      <span style="color:var(--gold)">🪙 ${formatCoins(myCoins)}</span>
    `;
  } else {
    myRow.style.display = "none";
  }

  setupDragAndDrop();
}

// 拖曳功能
function setupDragAndDrop() {
  const items = document.querySelectorAll(".lb-item");
  let dragSrc = null;

  items.forEach(item => {
    item.addEventListener("dragstart", () => {
      dragSrc = item;
      setTimeout(() => item.classList.add("dragging"), 0);
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      document.querySelectorAll(".lb-item").forEach(i => i.classList.remove("drag-over"));
    });
    item.addEventListener("dragover", e => {
      e.preventDefault();
      if (item !== dragSrc) item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", e => {
      e.preventDefault();
      if (dragSrc && item !== dragSrc) {
        const list = document.getElementById("leaderboard-list");
        const srcIdx = [...list.children].indexOf(dragSrc);
        const tgtIdx = [...list.children].indexOf(item);
        if (srcIdx < tgtIdx) list.insertBefore(dragSrc, item.nextSibling);
        else list.insertBefore(dragSrc, item);
      }
      document.querySelectorAll(".lb-item").forEach(i => i.classList.remove("drag-over"));
    });
  });
}

document.getElementById("refresh-lb-btn").onclick = loadLeaderboard;

// ===================== 分頁切換 =====================
function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.toggle("active", c.id === `tab-${tabName}`));

  if (tabName === "stock") renderStocks();
  if (tabName === "leaderboard") loadLeaderboard();
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.onclick = () => switchTab(tab.dataset.tab);
});

// ===================== 密碼雜湊 =====================
async function hashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ===================== 登入 =====================
function setLoginError(msg) {
  document.getElementById("login-error").textContent = msg;
}

function enterGame(user) {
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("main-screen").classList.add("active");
  setAvatar(document.getElementById("nav-avatar"), user.name);
  setAvatar(document.getElementById("home-avatar"), user.name);
  document.getElementById("nav-name").textContent = user.name;
  document.getElementById("home-username").textContent = user.name;
  updateNavCoins();
  const today = new Date().toISOString().split("T")[0];
  const msg = document.getElementById("checkin-msg");
  msg.textContent = user.lastCheckin === today ? "今天已經簽到過了，明天再來！" : "記得每天簽到領獎勵！";
}

// 登入按鈕
document.getElementById("enter-btn").onclick = async () => {
  const name = document.getElementById("username-input").value.trim();
  const pw = document.getElementById("password-input").value;
  setLoginError("");
  if (!name) return setLoginError("請輸入玩家名稱");
  if (!pw) return setLoginError("請輸入密碼");

  const btn = document.getElementById("enter-btn");
  btn.textContent = "登入中..."; btn.disabled = true;

  try {
    const safeId = name.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "_");
    const snap = await db.collection("players").doc(safeId).get();

    if (!snap.exists) {
      setLoginError("找不到此帳號，請先註冊！");
      btn.textContent = "登入"; btn.disabled = false;
      return;
    }

    const data = snap.data();
    const hashed = await hashPassword(pw);
    if (data.passwordHash !== hashed) {
      setLoginError("密碼錯誤！");
      btn.textContent = "登入"; btn.disabled = false;
      return;
    }

    currentUser = { id: safeId, ...data };
    enterGame(currentUser);
  } catch (e) {
    setLoginError("連接失敗，請確認 Firebase 設定");
    console.error(e);
    btn.textContent = "登入"; btn.disabled = false;
  }
};

// 註冊按鈕
document.getElementById("register-btn").onclick = async () => {
  const name = document.getElementById("username-input").value.trim();
  const pw = document.getElementById("password-input").value;
  setLoginError("");
  if (!name) return setLoginError("請輸入玩家名稱");
  if (name.length < 2 || name.length > 16) return setLoginError("名稱需在 2~16 字之間");
  if (!pw || pw.length < 4) return setLoginError("密碼至少需要 4 個字元");

  const btn = document.getElementById("register-btn");
  btn.textContent = "註冊中..."; btn.disabled = true;

  try {
    const safeId = name.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "_");
    const snap = await db.collection("players").doc(safeId).get();

    if (snap.exists) {
      setLoginError("此名稱已被使用，請換一個！");
      btn.textContent = "註冊新帳號"; btn.disabled = false;
      return;
    }

    const hashed = await hashPassword(pw);
    const newPlayer = {
      id: safeId, name: name.trim(),
      coins: 5000, holdings: {},
      lastCheckin: null, passwordHash: hashed,
      createdAt: Date.now()
    };
    await db.collection("players").doc(safeId).set(newPlayer);
    currentUser = newPlayer;
    enterGame(currentUser);
  } catch (e) {
    setLoginError("連接失敗，請確認 Firebase 設定");
    console.error(e);
    btn.textContent = "註冊新帳號"; btn.disabled = false;
  }
};
 
// 顯示/隱藏密碼
document.getElementById("toggle-pw").onclick = () => {
  const input = document.getElementById("password-input");
  const btn = document.getElementById("toggle-pw");
  if (input.type === "password") { input.type = "text"; btn.textContent = "🙈"; }
  else { input.type = "password"; btn.textContent = "👁"; }
};
 
document.getElementById("password-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("enter-btn").click();
});
document.getElementById("username-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("password-input").focus();
});
// ===================== 聊天室 =====================
let chatUnsubscribe = null;
 
function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2,"0");
  const m = d.getMinutes().toString().padStart(2,"0");
  return `${h}:${m}`;
}
 
function appendChatMsg(data) {
  const box = document.getElementById("chat-messages");
  if (!box) return;
  const isSystem = data.type === "system";
  const isMe = data.uid === currentUser?.id;
 
  const div = document.createElement("div");
  div.className = "chat-msg" + (isSystem ? " is-system" : "") + (isMe ? " is-me" : "");
 
  if (isSystem) {
    div.innerHTML = `<div class="chat-bubble">${data.text}</div>`;
  } else {
    div.innerHTML = `
      <div class="chat-avatar">${getInitial(data.name)}</div>
      <div class="chat-msg-content">
        <div class="chat-name">${data.name}</div>
        <div class="chat-bubble">${escapeHtml(data.text)}</div>
        <div class="chat-time">${formatTime(data.ts)}</div>
      </div>
    `;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
 
function startChatListener() {
  if (chatUnsubscribe) return;
  chatUnsubscribe = db.collection("chat")
    .orderBy("ts", "asc")
    .limitToLast(100)
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "added") appendChatMsg(change.doc.data());
      });
    });
}
 
async function sendChatMsg(text, type = "user") {
  if (!currentUser) return;
  await db.collection("chat").add({
    uid: currentUser.id,
    name: currentUser.name,
    text,
    type,
    ts: Date.now()
  });
}
 
// 系統訊息（賭馬結果用）
async function sendSystemMsg(text) {
  await db.collection("chat").add({
    uid: "system",
    name: "系統",
    text,
    type: "system",
    ts: Date.now()
  });
}
 
document.getElementById("chat-send-btn").onclick = async () => {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await sendChatMsg(text);
};
document.getElementById("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("chat-send-btn").click();
});
 
// 把聊天室加入分頁切換
const _origSwitchTab = switchTab;
// 覆寫 switchTab 讓切到 chat 時啟動監聽
function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.toggle("active", c.id === `tab-${tabName}`));
  if (tabName === "stock") renderStocks();
  if (tabName === "leaderboard") loadLeaderboard();
  if (tabName === "chat") startChatListener();
}
