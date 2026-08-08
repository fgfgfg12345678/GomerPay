const cards = document.querySelectorAll(".card");
const rankInput = document.getElementById("rank");
const priceInput = document.getElementById("price");
const nicknameInput = document.getElementById("nickname");
const buyButton = document.getElementById("buy");

let selectedDonate = null;

cards.forEach(card => {

    card.addEventListener("click", () => {

        cards.forEach(c => c.classList.remove("active"));

        card.classList.add("active");

        selectedDonate = {
            rank: card.dataset.rank,
            price: card.dataset.price
        };

        rankInput.value = selectedDonate.rank;
        priceInput.value = selectedDonate.price + " ₽";

    });

});

buyButton.addEventListener("click", async () => {

    const nickname = nicknameInput.value.trim();

    if (!selectedDonate) {
        alert("Выберите привилегию.");
        return;
    }

    if (nickname.length < 3 || nickname.length > 16) {
        alert("Введите корректный ник Minecraft.");
        return;
    }

    buyButton.disabled = true;
    buyButton.textContent = "Создание заказа...";

    try {

        const response = await fetch("/create-order", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                nickname,
                rank: selectedDonate.rank
            })
        });

        const text = await response.text();

console.log("STATUS:", response.status);
console.log("RESPONSE:", text);

let data;

try {
    data = JSON.parse(text);
} catch (e) {
    alert("Сервер вернул не JSON:\n" + text);
    buyButton.disabled = false;
    buyButton.textContent = "Оплатить";
    return;
}

if (data.success) {
    window.location.href = data.paymentUrl;
} else {
    alert(data.message || "Ошибка создания заказа.");
}

    } catch (e) {

        alert("Не удалось подключиться к серверу.");

        buyButton.disabled = false;
        buyButton.textContent = "Оплатить";

    }

});
