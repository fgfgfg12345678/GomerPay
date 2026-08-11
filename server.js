const { giveDonate } = require("./rcon");

const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");

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

const QIWI_PAYFORM_URL =
    "https://qpay-payform-test.qiwi.kz/api/create";

// ===============================
// DONATES
// ===============================

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


// ===============================
// MAIN PAGE
// ===============================

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

        (err) => {

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


            const amount =
                donate.price.toFixed(2);

            const currency =
                "KZT";


            // Строка для подписи:
            // amount|currency|siteId

            const signString =
                `${amount}|${currency}|${QIWI_SITE_ID}`;


            const sign =
                crypto
                    .createHmac(
                        "sha256",
                        QIWI_API_KEY
                    )
                    .update(signString)
                    .digest("hex");


            const params =
                new URLSearchParams({

                    siteId:
                        QIWI_SITE_ID,

                    amount:
                        amount,

                    currency:
                        currency,

                    account:
                        orderId,

                    comment:
                        `GomerPay ${rank} ${nickname}`,

                    successUrl:
                        "https://gomerpay.store/?payment=success",

                    failedUrl:
                        "https://gomerpay.store/?payment=failed",

                    sign:
                        sign

                });


            const paymentUrl =
                `${QIWI_PAYFORM_URL}?${params.toString()}`;


            console.log(
                "[QIWI] Payment URL:",
                paymentUrl
            );


            return res.json({

                success: true,

                paymentUrl:
                    paymentUrl,

                orderId:
                    orderId

            });

        }

    );

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

        const paymentId = payment.paymentId;
        const billId = payment.billId;
        const status = payment.status?.value;
        const amount = payment.amount?.value;
        const currency = payment.amount?.currency;


        // Проверяем данные webhook

        if (!paymentId || !billId) {

            console.log(
                "[QIWI] Некорректный webhook"
            );

            return res
                .status(400)
                .send("BAD");

        }


        // Ищем заказ

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

                    return res
                        .status(500)
                        .send("ERROR");

                }


                // Заказ не найден

                if (!order) {

                    console.log(
                        "[QIWI] Заказ не найден:",
                        billId
                    );

                    return res
                        .status(404)
                        .send("ORDER NOT FOUND");

                }


                // Уже оплачен

                if (order.status === "paid") {

                    console.log(
                        "[QIWI] Заказ уже обработан:",
                        billId
                    );

                    return res.send("OK");

                }


                // Проверяем статус оплаты

                if (status !== "COMPLETED") {

                    console.log(
                        "[QIWI] Статус:",
                        status
                    );

                    return res.send("OK");

                }


                // Проверяем валюту

                if (currency !== "KZT") {

                    console.log(
                        "[QIWI] Неверная валюта:",
                        currency
                    );

                    return res
                        .status(400)
                        .send("BAD CURRENCY");

                }


                // Проверяем сумму

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


                // ===============================
                // ВЫДАЧА ДОНАТА
                // ===============================

                try {

                    await giveDonate(

                        order.nickname,

                        order.donate.toUpperCase()

                    );


                    // Меняем статус заказа

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

});
// ===============================
// CHECK QIWI PAYMENT
// ===============================

app.get("/qiwi-payment/:orderId", async (req, res) => {

    try {

        const orderId = req.params.orderId;

        const payment = await qiwiRequest(
            `/sites/${encodeURIComponent(QIWI_SITE_ID)}/bills/${encodeURIComponent(orderId)}/details`,
            {
                method: "GET"
            }
        );

        res.json({
            success: true,
            payment: payment
        });

    } catch (error) {

        console.log(
            "[QIWI STATUS ERROR]",
            error
        );

        res.status(500).json({
            success: false,
            message: "Не удалось получить статус платежа"
        });

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
// QIWI TEST
// ===============================

app.get("/qiwi-test", async (req, res) => {

    try {

        const billId =
            "TEST-" +
            Date.now();


        const result =
            await qiwiRequest(

                `/sites/${encodeURIComponent(QIWI_SITE_ID)}/bills/${encodeURIComponent(billId)}`,

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
                            "GomerPay TEST",

                        flags: [
                            "SALE"
                        ]

                    })

                }

            );


        res.json({

            success: true,

            billId: billId,

            result: result

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

});


// ===============================
// START SERVER
// ===============================

app.listen(

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
            (QIWI_SITE_ID || "NOT SET")
        );
        console.log(
            " QIWI режим: TEST"
        );
        console.log("==========================");
        console.log("");

    }

);
