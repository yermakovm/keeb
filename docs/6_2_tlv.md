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
