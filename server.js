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

const QIWI_SITE_ID = process.env.QIWI_SITE_ID;
const QIWI_API_KEY = process.env.QIWI_API_KEY;

const QIWI_API_URL =
    "https://qpay-api-test.qiwi.kz";

const DONATES = {
    VIP: {
        group: "vip",
        price: 100
    },

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
};

async function qiwiRequest(url, options = {}) {

    const response = await fetch(
        QIWI_API_URL + url,
        {
            ...options,

            headers: {
                "Authorization":
                    `Bearer ${QIWI_API_KEY}`,

                "Accept":
                    "application/json",

                "Content-Type":
                    "application/json",

                ...(options.headers || {})
            }
        }
    );

    const text =
        await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    if (!response.ok) {

        console.log(
            "[QIWI ERROR]",
            response.status,
            data
        );

        throw new Error(
            `QIWI API error ${response.status}`
        );
    }

    return data;
}

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );

});
// ===============================
// CREATE ORDER
// ===============================

app.post("/create-order", (req, res) => {

    const { nickname, rank } = req.body;

    if (!nickname || !rank) {

        return res.json({
            success: false,
            message: "Заполните все поля"
        });

    }

    if (!DONATES[rank]) {

        return res.json({
            success: false,
            message: "Неизвестный донат"
        });

    }

    const donate = DONATES[rank];

    const orderId =
        "GOMER-" +
        Date.now() +
        "-" +
        Math.floor(Math.random() * 10000);


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
        async (err) => {

            if (err) {

                console.log(
                    "[DATABASE ERROR]",
                    err
                );

                return res.json({
                    success: false,
                    message: "Ошибка базы данных"
                });

            }

            try {

                const expiration =
                    new Date(
                        Date.now() +
                        30 * 60 * 1000
                    ).toISOString();


                const invoice =
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

                                successUrl:
                                    "https://gomerpay.store/?payment=success",

                                customer: {
                                account: orderId,
                                name: nickname,
                                ip:
                                      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
                                      req.socket.remoteAddress
                                }

                            })
                        }
                    );


                console.log(
                    "[QIWI] Invoice:",
                    invoice
                );


                const paymentUrl =
                    invoice.payUrl ||
                    invoice.payUrlShort ||
                    invoice.url;


                if (!paymentUrl) {

                    console.log(
                        "[QIWI] Не найден payUrl:",
                        invoice
                    );

                    return res.json({
                        success: false,
                        message:
                            "QIWI не вернул ссылку на оплату"
                    });

                }


                return res.json({

                    success: true,

                    paymentUrl: paymentUrl,
                    orderId:
                        orderId

                });


            } catch (error) {

                console.log(
                    "[QIWI CREATE ERROR]",
                    error
                );


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

});
// ===============================
// QIWI WEBHOOK
// ===============================

app.post("/qiwi-webhook", async (req, res) => {

    try {

        console.log(
            "[QIWI WEBHOOK]",
            JSON.stringify(req.body, null, 2)
        );

        const payment = req.body;

        const billId =
            payment.billId ||
            payment.account ||
            payment.bill?.billId;

        const status =
            payment.status?.value ||
            payment.status;

        const amount =
            payment.amount?.value ||
            payment.bill?.amount?.value;

        const currency =
            payment.amount?.currency ||
            payment.bill?.amount?.currency;

        if (!billId) {
            console.log("[QIWI] billId отсутствует");
            return res.status(400).send("BAD");
        }

        db.get(
            `
            SELECT *
            FROM orders
            WHERE order_id=?
            `,
            [billId],
            async (err, order) => {

                if (err) {

                    console.log(
                        "[DATABASE ERROR]",
                        err
                    );

                    return res.status(500).send("ERROR");
                }

                if (!order) {

                    console.log(
                        "[QIWI] Заказ не найден:",
                        billId
                    );

                    return res.status(404)
                        .send("ORDER NOT FOUND");
                }

                if (order.status === "paid") {
                    return res.send("OK");
                }

                if (
                    status !== "COMPLETED" &&
                    status !== "PAID"
                ) {

                    console.log(
                        "[QIWI] Статус:",
                        status
                    );

                    return res.send("OK");
                }

                if (currency !== "KZT") {

                    console.log(
                        "[QIWI] Неверная валюта:",
                        currency
                    );

                    return res.status(400)
                        .send("BAD CURRENCY");
                }

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

                    return res.status(400)
                        .send("BAD AMOUNT");
                }

                try {

                    await giveDonate(
                        order.nickname,
                        order.donate.toUpperCase()
                    );

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
                        (updateError) => {

                            if (updateError) {

                                console.log(
                                    "[DATABASE UPDATE ERROR]",
                                    updateError
                                );

                            }

                        }
                    );

                    console.log(
                        `[DONATE] ${order.nickname} получил ${order.donate}`
                    );

                    return res.send("OK");

                } catch (donateError) {

                    console.log(
                        "[DONATE ERROR]",
                        donateError
                    );

                    return res.status(500)
                        .send("DONATE ERROR");
                }
            }
        );

    } catch (error) {

        console.log(
            "[QIWI WEBHOOK ERROR]",
            error
        );

        return res.status(500).send("ERROR");
    }
});
// ===============================
// ORDERS
// ===============================

app.get("/orders", (req, res) => {

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
                    "[ORDERS ERROR]",
                    err
                );

                return res.json([]);
            }

            res.json(rows);
        }
    );

});


// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {

    console.log("");
    console.log("==========================");
    console.log(" GomerPay запущен");
    console.log(" Порт: " + PORT);
    console.log(
        " QIWI Site ID: " +
        (QIWI_SITE_ID || "NOT SET")
    );
    console.log(" QIWI режим: TEST");
    console.log("==========================");
    console.log("");

});
