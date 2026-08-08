const { giveDonate } = require("./rcon");

const express = require("express");
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");
const dotenv = require("dotenv");

dotenv.config();

const db = require("./database");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;


const MERCHANT_ID = process.env.FK_MERCHANT_ID;
const SECRET1 = process.env.FK_SECRET1;
const SECRET2 = process.env.FK_SECRET2;



const DONATES = {

    VIP: {
        group: "vip",
        price: 99
    },

    PREMIUM: {
        group: "premium",
        price: 199
    },

    DELUXE: {
        group: "deluxe",
        price: 399
    },

    GOD: {
        group: "god",
        price: 999
    }

};



app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});




// создание платежа

app.post("/create-order", (req, res) => {


    const { nickname, rank } = req.body;



    if (!nickname || !rank) {

        return res.json({
            success:false,
            message:"Заполните все поля"
        });

    }



    if (!DONATES[rank]) {

        return res.json({
            success:false,
            message:"Неизвестный донат"
        });

    }



    const donate = DONATES[rank];

    const orderId = Date.now().toString();



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


        err => {


            if(err){

                console.log(err);

                return res.json({
                    success:false,
                    message:"Ошибка базы"
                });

            }




            const sign = crypto
                .createHash("md5")
                .update(
                    `${MERCHANT_ID}:${donate.price}:${SECRET1}:${orderId}`
                )
                .digest("hex");




            const paymentUrl =
                "https://pay.freekassa.ru/?" +
                `m=${MERCHANT_ID}` +
                `&oa=${donate.price}` +
                `&o=${orderId}` +
                `&s=${sign}` +
                `&us_nickname=${encodeURIComponent(nickname)}` +
                `&us_group=${donate.group}`;



            res.json({

                success:true,
                paymentUrl

            });



        }

    );

});







// webhook FreeKassa

app.post("/webhook", async (req,res)=>{


    try {


        console.log("FREEKASSA:",req.body);



        const {

            MERCHANT_ORDER_ID,
            AMOUNT,
            SIGN,
            us_nickname,
            us_group

        } = req.body;



        if(
            !MERCHANT_ORDER_ID ||
            !SIGN
        ){

            return res.status(400).send("BAD");

        }




        const mySign = crypto
            .createHash("md5")
            .update(
                `${MERCHANT_ID}:${AMOUNT}:${SECRET2}:${MERCHANT_ORDER_ID}`
            )
            .digest("hex");




        if(
            SIGN !== mySign
        ){

            console.log("Неверная подпись");

            return res.status(403).send("SIGN ERROR");

        }




        const player = us_nickname;
        const group = us_group;



        if(
            !player ||
            !group
        ){

            return res.status(400).send("DATA ERROR");

        }





        await giveDonate(

            player,

            group.toUpperCase()

        );




        db.run(

            `
            UPDATE orders
            SET status=?
            WHERE order_id=?
            `,

            [
                "paid",
                MERCHANT_ORDER_ID
            ]

        );




        console.log(
            `[DONATE] ${player} получил ${group}`
        );



        res.send("YES");



    }
    catch(err){


        console.log(
            "Webhook error:",
            err
        );


        res.status(500).send("ERROR");


    }


});








app.get("/orders",(req,res)=>{


    db.all(

        "SELECT * FROM orders ORDER BY id DESC",

        [],

        (err,rows)=>{


            if(err){

                return res.json([]);

            }


            res.json(rows);


        }

    );


});







app.listen(PORT,()=>{


    console.log("");
    console.log("==========================");
    console.log(" GomerPay запущен");
    console.log(" http://localhost:"+PORT);
    console.log("==========================");
    console.log("");


});
