const { giveDonate } = require("./rcon");

const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const db = require("./database");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// ===============================
// QIWI QPAY
// ===============================

const QIWI_SITE_ID = process.env.QIWI_SITE_ID;
const QIWI_API_KEY = process.env.QIWI_API_KEY;

const QIWI_API_URL = "https://qpay-api.qiwi.kz";

// ===============================
// DONATES
// ===============================

// ВАЖНО:
// Сейчас цены временно в KZT для тестового QIWI.
// После успешного теста вернём RUB -> KZT.

const DONATES = {
VIP: {
group: "vip",
price: 100
},

```
PREMIUM: {
    group: "premium",
    price: 200
},

DELUXE: {
    group: "deluxe",
    price: 400
},

GOD: {
    group: "god",
    price: 1000
}
```

};

// ===============================
// QIWI REQUEST
// ===============================

async function qiwiRequest(url, options = {}) {

```
const response = await fetch(QIWI_API_URL + url, {

    ...options,

    headers: {
        "Authorization": `Bearer ${QIWI_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(options.headers || {})
    }

});

const text = await response.text();

let data;

try {
    data = JSON.parse(text);
} catch {
    data = text;
}

if (!response.ok) {

    console.log("QIWI ERROR:", response.status, data);

    throw new Error(
        `QIWI API error ${response.status}`
    );

}

return data;
```

}

// ===============================
// MAIN PAGE
// ===============================

app.get("/", (req, res) => {

```
res.sendFile(
    path.join(__dirname, "index.html")
);
```

});

// ===============================
// CREATE ORDER
// ===============================

app.post("/create-order", async (req, res) => {

```
try {

    const { nickname, rank } = req.body;

    // -------------------------------
    // Проверка данных
    // -------------------------------

    if (!nickname || !rank) {

        return res.json({

            success: false,

            message: "Заполните все поля"

        });

    }

    // -------------------------------
    // Проверка доната
    // -------------------------------

    if (!DONATES[rank]) {

        return res.json({

            success: false,

            message: "Неизвестный донат"

        });

    }

    const donate = DONATES[rank];

    // -------------------------------
    // Генерируем ID заказа
    // -------------------------------

    const orderId =
        "GOMER-" +
        Date.now() +
        "-" +
        Math.floor(Math.random() * 10000);

    // -------------------------------
    // Сохраняем заказ
    // -------------------------------

    db.run(

        `
        INSERT INTO orders
        (
            order_id,
            nickname,
            donate,
            price,
            status
        )
        VALUES (?,?,?,?,?)
        `,

        [
            orderId,
            nickname,
            rank,
            donate.price,
            "pending"
        ],

        async err => {

            if (err) {

                console.log(
                    "DATABASE ERROR:",
                    err
                );

                return res.json({

                    success: false,

                    message: "Ошибка базы данных"

                });

            }

            try {

                // -------------------------------
                // Создаём QIWI счёт
                // -------------------------------

                const expiration =
                    new Date(
                        Date.now() + 30 * 60 * 1000
                    ).toISOString();

                const qiwiInvoice =
                    await qiwiRequest(

                        `/sites/${encodeURIComponent(QIWI_SITE_ID)}/bills/${encodeURIComponent(orderId)}`,

                        {

                            method: "PUT",

                            body: JSON.stringify({

                                amount: {

                                    currency: "KZT",

                                    value:
                                        donate.price.toFixed(2)

                                },

                                expirationDateTime:
                                    expiration,

                                comment:
                                    `GomerPay | ${rank} | ${nickname}`,

                                flags: [
                                    "SALE"
                                ],

                                successUrl:
                                    process.env.SUCCESS_URL ||
                                    "https://gomerpay.store/?payment=success",

                                failedUrl:
                                    process.env.FAILED_URL ||
                                    "https://gomerpay.store/?payment=failed",

                                customer: {

                                    account:
                                        orderId,

                                    name:
                                        nickname

                                }

                            })

                        }

                    );

                console.log(
                    "[QIWI] Счёт создан:",
                    qiwiInvoice
                );

                // -------------------------------
                // Возвращаем ссылку
                // -------------------------------

                return res.json({

                    success: true,

                    paymentUrl:
                        qiwiInvoice.payUrl,

                    orderId:
                        orderId

                });

            } catch (qiwiError) {

                console.log(
                    "QIWI CREATE ERROR:",
                    qiwiError
                );

                // Если QIWI не создал счёт,
                // удаляем pending-заказ

                db.run(

                    `
                    UPDATE orders
                    SET status=?
                    WHERE order_id=?
                    `,

                    [
                        "error",
                        orderId
                    ]

                );

                return res.json({

                    success: false,

                    message:
                        "Не удалось создать платёж"

                });

            }

        }

    );

} catch (error) {

    console.log(
        "CREATE ORDER ERROR:",
        error
    );

    res.status(500).json({

        success: false,

        message: "Ошибка сервера"

    });

}
```

});

// ===============================
// QIWI WEBHOOK
// ===============================

app.post("/qiwi-webhook", async (req, res) => {

```
try {

    console.log(
        "=============================="
    );

    console.log(
        "[QIWI WEBHOOK]"
    );

    console.log(
        JSON.stringify(
            req.body,
            null,
            2
        )
    );

    // -------------------------------
    // Получаем данные QIWI
    // -------------------------------

    const payment = req.body;

    const paymentId =
        payment.paymentId;

    const billId =
        payment.billId;

    const status =
        payment.status &&
        payment.status.value;

    const amount =
        payment.amount &&
        payment.amount.value;

    const currency =
        payment.amount &&
        payment.amount.currency;

    // -------------------------------
    // Проверяем обязательные данные
    // -------------------------------

    if (!paymentId || !billId) {

        console.log(
            "[QIWI] Некорректный webhook"
        );

        return res.status(400).send("BAD");

    }

    // -------------------------------
    // Получаем заказ
    // -------------------------------

    db.get(

        `
        SELECT *
        FROM orders
        WHERE order_id=?
        `,

        [
            billId
        ],

        async (err, order) => {

            if (err) {

                console.log(
                    "DATABASE ERROR:",
                    err
                );

                return res
                    .status(500)
                    .send("ERROR");

            }

            if (!order) {

                console.log(
                    "[QIWI] Заказ не найден:",
                    billId
                );

                return res
                    .status(404)
                    .send("ORDER NOT FOUND");

            }

            // -------------------------------
            // Заказ уже обработан
            // -------------------------------

            if (order.status === "paid") {

                console.log(
                    "[QIWI] Заказ уже выдан:",
                    billId
                );

                return res.send("OK");

            }

            // -------------------------------
            // Проверяем статус
            // -------------------------------

            if (status !== "COMPLETED") {

                console.log(
                    "[QIWI] Статус:",
                    status
                );

                return res.send("OK");

            }

            // -------------------------------
            // Проверяем валюту
            // -------------------------------

            if (currency !== "KZT") {

                console.log(
                    "[QIWI] Неверная валюта:",
                    currency
                );

                return res
                    .status(400)
                    .send("BAD CURRENCY");

            }

            // -------------------------------
            // Проверяем сумму
            // -------------------------------

            const paidAmount =
                Number(amount);

            const orderAmount =
                Number(order.price);

            if (
                !Number.isFinite(paidAmount) ||
                paidAmount !== orderAmount
            ) {

                console.log(
                    "[QIWI] Неверная сумма:",
                    paidAmount,
                    "ожидалось:",
                    orderAmount
                );

                return res
                    .status(400)
                    .send("BAD AMOUNT");

            }

            // -------------------------------
            // Выдаём донат
            // -------------------------------

            try {

                await giveDonate(

                    order.nickname,

                    order.donate.toUpperCase()

                );

                // -------------------------------
                // Обновляем заказ
                // -------------------------------

                db.run(

                    `
                    UPDATE orders
                    SET status=?
                    WHERE order_id=?
                    `,

                    [
                        "paid",
                        billId
                    ],

                    updateError => {

                        if (updateError) {

                            console.log(
                                "DATABASE UPDATE ERROR:",
                                updateError
                            );

                        }

                    }

                );

                console.log(
                    `[DONATE] ${order.nickname} получил ${order.donate}`
                );

                console.log(
                    "=============================="
                );

                return res.send("OK");

            } catch (donateError) {

                console.log(
                    "[DONATE ERROR]",
                    donateError
                );

                return res
                    .status(500)
                    .send("DONATE ERROR");

            }

        }

    );

} catch (error) {

    console.log(
        "[QIWI WEBHOOK ERROR]",
        error
    );

    return res
        .status(500)
        .send("ERROR");

}
```

});

// ===============================
// CHECK QIWI PAYMENT
// ===============================

app.get("/qiwi-payment/:orderId", async (req, res) => {

```
try {

    const orderId =
        req.params.orderId;

    const payment =
        await qiwiRequest(

            `/sites/${encodeURIComponent(QIWI_SITE_ID)}/bills/${encodeURIComponent(orderId)}/details`,

            {
                method: "GET"
            }

        );

    res.json({

        success: true,

        payment

    });

} catch (error) {

    console.log(
        "[QIWI STATUS ERROR]",
        error
    );

    res.status(500).json({

        success: false,

        message:
            "Не удалось получить статус платежа"

    });

}
```

});

// ===============================
// ORDERS
// ===============================

app.get("/orders", (req, res) => {

```
db.all(

    `
    SELECT *
    FROM orders
    ORDER BY id DESC
    `,

    [],

    (err, rows) => {

        if (err) {

            console.log(
                "ORDERS ERROR:",
                err
            );

            return res.json([]);

        }

        res.json(rows);

    }

);
```

});

// ===============================
// TEST
// ===============================

app.get("/qiwi-test", async (req, res) => {

```
try {

    const result =
        await qiwiRequest(

            `/sites/${encodeURIComponent(QIWI_SITE_ID)}/bills/test-${Date.now()}`,

            {
                method: "PUT",

                body: JSON.stringify({

                    amount: {

                        currency: "KZT",

                        value: "100.00"

                    },

                    expirationDateTime:
                        new Date(
                            Date.now() +
                            30 * 60 * 1000
                        ).toISOString(),

                    comment:
                        "GomerPay test",

                    flags: [
                        "SALE"
                    ]

                })

            }

        );

    res.json({

        success: true,

        result

    });

} catch (error) {

    console.log(
        "[QIWI TEST ERROR]",
        error
    );

    res.status(500).json({

        success: false,

        message:
            error.message

    });

}
```

});

// ===============================
// START
// ===============================

app.listen(

```
PORT,

() => {

    console.log("");
    console.log("==========================");
    console.log(" GomerPay запущен");
    console.log(
        " Порт: " + PORT
    );
    console.log(
        " QIWI Site ID: " +
        QIWI_SITE_ID
    );
    console.log(
        " QIWI режим: TEST"
    );
    console.log("==========================");
    console.log("");

}
```

);
