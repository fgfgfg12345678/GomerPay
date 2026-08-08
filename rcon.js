const { Rcon } = require("rcon-client");

require("dotenv").config();

let rcon;


async function connectRcon() {

    if (rcon) {
        return rcon;
    }

    rcon = await Rcon.connect({
        host: process.env.RCON_HOST || "127.0.0.1",
        port: Number(process.env.RCON_PORT) || 25575,
        password: process.env.RCON_PASSWORD || "password"
    });

    console.log("[RCON] Подключено");

    rcon.on("end", () => {
        console.log("[RCON] Отключено");
        rcon = null;
    });

    return rcon;
}


async function sendCommand(command) {

    const client = await connectRcon();

    const response = await client.send(command);

    console.log("[RCON CMD]", command);

    return response;
}


async function giveDonate(player, group) {

    let command;

    switch(group.toUpperCase()) {

        case "VIP":
            command = `lp user ${player} parent set vip`;
            break;

        case "PREMIUM":
            command = `lp user ${player} parent set premium`;
            break;

        case "DELUXE":
            command = `lp user ${player} parent set deluxe`;
            break;

        case "GOD":
            command = `lp user ${player} parent set god`;
            break;

        default:
            throw new Error("Неизвестный донат: " + group);
    }


    return await sendCommand(command);
}


module.exports = {
    sendCommand,
    giveDonate
};