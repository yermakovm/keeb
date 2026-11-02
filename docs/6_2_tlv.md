<!-- _class: dense -->

# Жива розкладка: рушій KEEB TLV

<div class="cards grid-2">

<div class="card">
<h3>Власний канал</h3>
<p>Клавіатура приймає <strong>бінарний конфіг-канал по BLE GATT</strong> і робить remap клавіші та шару із збереженням.</p>
<p class="why">Без залежності на ZMK Studio, використовуємо тільки ядро динамічної розкладки ZMK.</p>
</div>

<div class="card">
<h3>Канал</h3>
<p>Власний GATT-сервіс: <code>cmd</code> — write without response, <code>evt</code> — notify.</p>
<p class="why">Запис лише шифрований: pairing стартує, коли конфігуратор підписується на notify.</p>
</div>

<div class="card">
<h3>Central half — єдиний entry point</h3>
<p>Двигун live змін збирається лише на central: ZMK розв'язує binding там і надсилає готову половинку.</p>
</div>

</div>

---

<!-- _class: dense -->

# TLV: структура й контракти

<div class="cards grid-2">

<div class="card">
<h3>Заголовок пакета — 16 байтів</h3>
<p><code>magic | version | flags | msg_id | frag_off | frag_len | msg_len | crc32</code></p>
<p class="why">Повідомлення до 1024 B, повне з CRC-32/IEEE.</p>
</div>

<div class="card">
<h3>Запис і фрагментація</h3>
<p>Запис = <code>type(u16) | len(u16) | value</code>; <code>type</code> = простір імен і операція.</p>
<p class="why">Фрагмент = MTU 65 − 3 − 16 = 46 B: дамп у 700 B летить 16 notify.</p>
</div>

<div class="card">
<h3>Контракти</h3>
<p>Розмір кожного запису — <code>assert</code> у C-заголовках; той самий <code>keeb_tlv.c</code> компілюється на хості: <code>make tlv-test</code>.</p>
<p class="why">Контракт інтерфейсу <strong>генерується з source прошивки</strong> — розбіжність одразу помітно</p>
</div>

<div class="card bad">
<h3>Запобіжники</h3>
<ul>
<li>токени: id із devicetree плюс CRC-32, host повторює хеш перед записом;</li>
<li><code>CELLS_SET</code> — все або нічого: спершу перевірка комірок;</li>
</ul>
</div>

</div>
