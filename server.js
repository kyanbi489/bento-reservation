const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function getReserved(menu_id, date) {
  const row = db.prepare(
    "SELECT COALESCE(SUM(ri.quantity), 0) as total FROM reservation_items ri JOIN reservations r ON ri.reservation_id = r.id WHERE ri.menu_id = ? AND r.date = ?"
  ).get(menu_id, date);
  return row.total;
}

function toHalfWidth(str) {
  return str.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
            .replace(/　/g, ' ')
            .replace(/＠/g, '@');
}

// メニュー一覧
app.get("/menus", (req, res) => {
  res.json(db.prepare("SELECT * FROM menus").all());
});

// 空き状況
app.get("/availability", (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "日付の形式が無効です (YYYY-MM-DD)" });
  }
  const menus = db.prepare("SELECT * FROM menus").all();
  const result = menus.map(menu => ({
    ...menu,
    remaining: menu.max - getReserved(menu.id, date)
  }));
  res.json(result);
});

// 予約作成
app.post("/reservations", (req, res) => {
  const { name, phone, email, address, date, pickup_time, items } = req.body;

  if (!name) return res.status(400).json({ error: "名前が必要です" });
  if (!phone) return res.status(400).json({ error: "電話番号が必要です" });
  if (!email) return res.status(400).json({ error: "メールアドレスが必要です" });
  const halfEmail = toHalfWidth(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(halfEmail)) return res.status(400).json({ error: "メールアドレスが無効です" });
  if (!address) return res.status(400).json({ error: "住所が必要です" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "日付の形式が無効です" });
  if (!pickup_time) return res.status(400).json({ error: "受取時間が必要です" });
  const [h, m] = pickup_time.split(":").map(Number);
  if (h * 60 + m < 9 * 60 || h * 60 + m > 14 * 60) return res.status(400).json({ error: "受取時間は9:00〜14:00の間で指定してください" });
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "メニューを選択してください" });

  // 受付時間チェック（日本時間）
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;
  const jstMinute = now.getUTCMinutes();
  if (jstHour * 60 + jstMinute < 9 * 60 || jstHour * 60 + jstMinute > 14 * 60) {
    return res.status(400).json({ error: "予約受付時間は9:00〜14:00です" });
  }

  // 在庫チェック
  for (const item of items) {
    const menu = db.prepare("SELECT * FROM menus WHERE id = ?").get(item.menu_id);
    if (!menu) return res.status(400).json({ error: "メニューが存在しません" });
    if (!Number.isInteger(item.quantity) || item.quantity < 1) return res.status(400).json({ error: "数量は1以上の整数で指定してください" });
    if (getReserved(item.menu_id, date) + item.quantity > menu.max) {
      return res.status(409).json({ error: `${menu.name}が売り切れです` });
    }
  }

  const result = db.prepare(
    "INSERT INTO reservations (name, phone, email, address, date, pickup_time) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(name, phone, halfEmail, address, date, pickup_time);

  const reservationId = result.lastInsertRowid;
  for (const item of items) {
    db.prepare("INSERT INTO reservation_items (reservation_id, menu_id, quantity) VALUES (?, ?, ?)")
      .run(reservationId, item.menu_id, item.quantity);
  }

  res.status(201).json({ id: reservationId });
});

// 予約一覧（管理用）
app.get("/reservations", (req, res) => {
  const { date } = req.query;
  let rows;
  if (date) {
    rows = db.prepare("SELECT * FROM reservations WHERE date = ? ORDER BY pickup_time").all(date);
  } else {
    rows = db.prepare("SELECT * FROM reservations ORDER BY date, pickup_time").all();
  }
  const result = rows.map(r => {
    const items = db.prepare(`
      SELECT ri.quantity, m.name as menu_name, m.price FROM reservation_items ri
      JOIN menus m ON ri.menu_id = m.id WHERE ri.reservation_id = ?
    `).all(r.id);
    return { ...r, items };
  });
  res.json(result);
});

// メニュー更新
app.put("/menus/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, price, description, max } = req.body;
  if (!name || !price || !max) return res.status(400).json({ error: "必須項目が不足しています" });
  const row = db.prepare("SELECT id FROM menus WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "メニューが見つかりません" });
  db.prepare("UPDATE menus SET name = ?, price = ?, description = ?, max = ? WHERE id = ?")
    .run(name, Number(price), description || "", Number(max), id);
  res.json({ message: "更新OK" });
});

// メニュー追加
app.post("/menus", (req, res) => {
  const { name, price, description, max } = req.body;
  if (!name || !price || !max) return res.status(400).json({ error: "必須項目が不足しています" });
  const result = db.prepare("INSERT INTO menus (name, price, description, image, max) VALUES (?, ?, ?, ?, ?)")
    .run(name, Number(price), description || "", "", Number(max));
  res.status(201).json({ id: result.lastInsertRowid });
});

// メニュー削除
app.delete("/menus/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM menus WHERE id = ?").run(id);
  res.json({ message: "削除OK" });
});
app.delete("/reservations/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id FROM reservations WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "予約が見つかりません" });
  db.prepare("DELETE FROM reservation_items WHERE reservation_id = ?").run(id);
  db.prepare("DELETE FROM reservations WHERE id = ?").run(id);
  res.json({ message: "削除OK" });
});

// 完了フラグ切り替え
app.patch("/reservations/:id/complete", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id, completed FROM reservations WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "予約が見つかりません" });
  const newStatus = row.completed ? 0 : 1;
  db.prepare("UPDATE reservations SET completed = ? WHERE id = ?").run(newStatus, id);
  res.json({ completed: newStatus });
});

app.listen(3000, () => console.log("起動中 http://localhost:3000"));
