<!-- _class: visual -->

# Жива розкладка: пакет KEEB TLV

<div class="stage">

<figure>
<img src="assets/tlv-packet.svg" alt="Структура пакета KEEB TLV: ATT PDU 65 B, 16-байтовий заголовок, flags, фрагментація повідомлення на 11 фрагментів"/>
<figcaption>зліва — скільки байтів залишається після ATT; нижче — як 488-байтове повідомлення стає 11 пакетами</figcaption>
</figure>

<div class="sidenotes">

<div class="sidenote">
<h3>Арифметика MTU</h3>
<p>MTU 65 − 3 (ATT) − 16 (заголовок) = <strong>46 B payload</strong>. Тому присутня фрагментація.</p>
</div>

<div class="sidenote">
<h3>Запас у рушії</h3>
<p>128B < Фрагмент < 20B.</p>
</div>

<div class="sidenote">
<h3>Навіщо прапорець FIRST</h3>
<p>Канал пише <em>без відповіді</em>, тож фрагмент справді може загубитись: FIRST скидає збірку й виправляє прогалину.</p>
</div>

<div class="sidenote warn">
<h3>CRC — наприкінці</h3>
<p>crc32 рахується по всіх 488B і перевіряється на завершенні: збитий фрагмент видно не в пакеті, а в кінці збірки.</p>
</div>

</div>

</div>

---

<!-- _class: visual -->

# Повідомлення й словник операцій

<div class="stage">

<figure>
<img src="assets/tlv-message.svg" alt="TLV-запис type/len/value, 16-бітове поле type з namespace та op, і словник операцій SYS / KEYMAP / DISPLAY"/>
<figcaption>той самий канал читає і розкладку, і панелі екрана — відрізняється лише namespace</figcaption>
</figure>

<div class="sidenotes">

<div class="sidenote">
<h3>Канал власний</h3>
<p>Без залежності від ZMK Studio: використовуємо тільки ядро динамічної розкладки ZMK, а протокол — свій.</p>
</div>

<div class="sidenote">
<h3>Невідомий type</h3>
<p>Канал не вгадує операцію: <code>KEEB_ERR_UNKNOWN_TYPE</code> у ACK. Імена зарезервовані (SETTINGS, IMAGE, APPLY_COMMIT/CANCEL), щоб host не вигадав конфлікт.</p>
</div>

<div class="sidenote">
<h3>Токени замість назв</h3>
<p>Host не називає behavior — він посилається на index із devicetree. <code>token_hash</code> каже, чи таблиця конфігуратора ще збігається з прошивкою.</p>
</div>

</div>

</div>

---

<!-- _class: visual -->

# Обмін: запит → фрагменти → ACK

<div class="stage balanced">

<figure>
<img src="assets/tlv-sequence.svg" alt="Послідовність обміну: підписка на notify, handshake INFO/TOKENS, читання розкладки, запис CELLS_SET з all-or-nothing, ACK і події, SAVE/DISCARD"/>
<figcaption>одна й та сама рамка в обидва боки: write без відповіді вгору, notify вниз, ACK окремо</figcaption>
</figure>

<div class="sidenotes">

<div class="sidenote">
<h3>Central — єдині ворота</h3>
<p>Рушій live-змів збирається лише на central: ZMK розв'язує binding там і надсилає готову половинку периферійній.</p>
</div>

<div class="sidenote">
<h3>Одне повідомлення в полі</h3>
<p>Другий запит під час першого отримує <code>KEEB_ERR_BUSY</code> у ACK, а не «перемалювання» на півслові.</p>
</div>

<div class="sidenote">
<h3>Все або нічого</h3>
<p><code>CELLS_SET</code>: спершу валідація кожної комірки, потім запис. <code>err_code</code> 0…16 каже, чому не зайшло.</p>
</div>

<div class="sidenote warn">
<h3>Шифрування не наша робота</h3>
<p>Pairing стартує, коли конфігуратор підписується на notify; write без bond Zephyr відбиває як Insufficient Authentication.</p>
</div>

</div>

</div>

---

<!-- _class: visual -->

# Контракти: чому дві сторони не роз'їжджаються

<div class="stage">

<figure>
<img src="assets/contract-loop.svg" alt="Контракт: C-заголовки джерело істини, генератор gen-contract.mjs, згенерований protocol.gen.ts у застосунку, host-тест make tlv-test з того самого коду"/>
<figcaption>контракт — не домовленість між двома розробниками, а згенерований файл</figcaption>
</figure>

<div class="sidenotes">

<div class="sidenote">
<h3>Той самий код</h3>
<p><code>keeb_tlv.c</code> компілюється без Zephyr: <code>make tlv-test</code> гоняє framing, CRC, фрагменти й ACK на хості.</p>
</div>

<div class="sidenote">
<h3>Розміри — assert</h3>
<p>Кожен запис має <code>_Static_assert</code> на розмір; генератор перевиводить його зі списку полів і мовчить не може.</p>
</div>

<div class="sidenote warn">
<h3>Куди дивитись при зміні</h3>
<p>Змінив структуру — стоять обидва білды. Це дешевше, ніж «мови не збігаються, на клавіатурі щось зламалось».</p>
</div>

</div>

</div>
