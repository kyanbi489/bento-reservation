const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function getReserved(menu_id, date) {
  const row = db.prepare(
    "SELECT COALESCE(SUM(quantity), 0) as total FROM reservations WHERE menu_id = ? AND date = ?"
  ).get(menu_id, date);
  return row.total;
}

function toHalfWidth(str) {
  return str.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
            .replace(/　/g, ' ')
            .replace(/＠/g, '@');
}

function validateReservation({ name, phone, email, address, menu_id, quantity, date, pickup_time }) {
  if (!name || typeof name !== "string") return "名前が無効です";
  if (!phone) return "電話番号が必要です";
  if (!email) return "メールアドレスが必要です";
  const halfEmail = toHalfWidth(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(halfEmail)) return "メールアドレスが無効です";
  if (!address || typeof address !== "string") return "住所が無効です";
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "日付の形式が無効です (YYYY-MM-DD)";
  if (!pickup_time) return "受取時間が必要です";
  // 受取時間は9:00〜14:00
  const [h, m] = pickup_time.split(":").map(Number);
  const minutes = h * 60 + m;
  if (minutes < 9 * 60 || minutes > 14 * 60) return "受取時間は9:00〜14:00の間で指定してください";
  if (!Number.isInteger(quantity) || quantity < 1) return "数量は1以上の整数で指定してください";
  if (!db.prepare("SELECT id FROM menus WHERE id = ?").get(menu_id)) return "メニューが存在しません";
  // 受付時間は9:00〜14:00（日本時間）
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;
  const jstMinute = now.getUTCMinutes();
  const nowMinutes = jstHour * 60 + jstMinute;
  if (nowMinutes < 9 * 60 || nowMinutes > 14 * 60) return "予約受付時間は9:00〜14:00です";
  return null;
}

// メニュー一覧（写真・値段・説明つき）
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
  const { name, phone, email, address, menu_id, quantity, date, pickup_time } = req.body;
  const error = validateReservation({ name, phone, email, address, menu_id, quantity, date, pickup_time });
  if (error) return res.status(400).json({ error });

  const menu = db.prepare("SELECT * FROM menus WHERE id = ?").get(menu_id);
  if (getReserved(menu_id, date) + quantity > menu.max) {
    return res.status(409).json({ error: "売り切れ" });
  }

  const result = db.prepare(
    "INSERT INTO reservations (name, phone, email, address, menu_id, quantity, date, pickup_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(name, phone, email, address, menu_id, quantity, date, pickup_time);

  res.status(201).json({ id: result.lastInsertRowid, name, phone, email, address, menu_id, quantity, date, pickup_time });
});

// 予約一覧（管理用）
app.get("/reservations", (req, res) => {
  const { date } = req.query;
  let rows;
  if (date) {
    rows = db.prepare(`
      SELECT r.*, m.name as menu_name FROM reservations r
      JOIN menus m ON r.menu_id = m.id
      WHERE r.date = ? ORDER BY r.pickup_time
    `).all(date);
  } else {
    rows = db.prepare(`
      SELECT r.*, m.name as menu_name FROM reservations r
      JOIN menus m ON r.menu_id = m.id
      ORDER BY r.date, r.pickup_time
    `).all();
  }
  res.json(rows);
});

// 予約キャンセル
app.delete("/reservations/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id FROM reservations WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "予約が見つかりません" });
  db.prepare("DELETE FROM reservations WHERE id = ?").run(id);
  res.json({ message: "削除OK" });
});

app.listen(3000, () => console.log("起動中 http://localhost:3000"));
