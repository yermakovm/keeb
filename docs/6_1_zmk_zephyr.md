<!-- _class: visual -->

# Залежність: ZMK / Zephyr RTOS

<div class="stage">

<figure>
<img src="assets/stack.svg" alt="Шари системи: конфігуратор, TLV-канал поверх BLE GATT, KEEB module, форк ZMK, Zephyr RTOS, nRF52840"/>
<figcaption>у репозиторії тільки наш код — модулі, конфіг і застосунок</figcaption>
</figure>

<div class="sidenotes">

<div class="sidenote">
<h3>Out-of-the-box</h3>
<p>BLE-спліт central/peripheral, keymap / layers / hold-tap, матриця з matrix-transform, драйвер nice!view, глибокий сон.</p>
</div>

<div class="sidenote warn">
<h3>Ціна</h3>
<p>Зміни upstream потенційно потрапляють у нашу збірку; готовий код коштує флешу й RAM на nRF52840; наші модулі чутливі до внутрішнього API ZMK.</p>
</div>

</div>

</div>

---

<!-- _class: visual -->

# Ліцензування: що можна й що треба зберегти

<div class="chips">

<span class="chip"><b>ZMK</b> — MIT</span>
<span class="chip"><b>Zephyr</b> — Apache-2.0</span>
<span class="chip"><b>Радіо</b> — відкритий BLE-стек Zephyr, не пропрієтарний стек Nordic</span>
<span class="chip warn"><b>Наша ліцензія</b> залежить від бізнес-рішень</span>

</div>


<div class="stage balanced">

<div class="sidenotes">

<div class="sidenote">
<h3>MIT (ZMK)</h3>
<p>Використовувати, змінювати і продавати, зокрема із закритим власним кодом. Умова — текст ліцензії та копірайт у поширюваних копіях.</p>
</div>

<div class="sidenote">
<h3>Apache-2.0 (Zephyr)</h3>
<p>Закритий похідний продукт дозволений, плюс явна патентна ліцензія. Умова — копія ліцензії, NOTICE і позначка внесених змін.</p>
</div>

<p class="lead">Обидві ліцензії пермісивні: юридично чистий як і відкритий, так і закритий похідний продукт.</p>
</div>

</div>

