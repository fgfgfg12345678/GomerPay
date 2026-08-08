const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./gomerpay.db");


db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT,
            nickname TEXT,
            donate TEXT,
            price INTEGER,
            status TEXT
        )
    `);

});


module.exports = db;