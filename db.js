const Database = require("better-sqlite3");
const db = new Database("reservations.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS menus (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    description TEXT,
    image TEXT,
    max INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    address TEXT NOT NULL,
    menu_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    date TEXT NOT NULL,
    pickup_time TEXT NOT NULL,
    FOREIGN KEY (menu_id) REFERENCES menus(id)
  );
`);

const count = db.prepare("SELECT COUNT(*) as c FROM menus").get();
if (count.c === 0) {
  db.prepare("INSERT INTO menus (id, name, price, description, image, max) VALUES (?, ?, ?, ?, ?, ?)")
    .run(1, "唐揚げ弁当", 850, "ジューシーな唐揚げをたっぷり詰め込んだ人気No.1弁当", "images/karaage.jpg", 50);
  db.prepare("INSERT INTO menus (id, name, price, description, image, max) VALUES (?, ?, ?, ?, ?, ?)")
    .run(2, "いろどり弁当", 850, "旬の野菜と彩り豊かなおかずが揃ったヘルシー弁当", "images/irodori.jpg", 30);
}

module.exports = db;
