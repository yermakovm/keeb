<!-- _class: visual -->

# Протоколи: чим це говорить

<div class="stage balanced">

<figure>
<img src="assets/protocols.svg" alt="Три канали між хостом і клавіатурою: USB HID, BLE HID over GATT, KEEB TLV поверх vendor GATT; split-лінк між центральною та периферійною половинкою; внутрішні шини SPI, PWM, GPIO matrix, CDC-ACM"/>
<figcaption>той самий BLE-стек, різні GATT-сервіси; дріт лишається для налагодження</figcaption>
</figure>

<div class="sidenotes">

<div class="sidenote">
<h3>Права половинка — без дроту</h3>
<p><code>CONFIG_ZMK_USB=n</code>: вона бачить лише центральну. USB HID і консоль — на лівій.</p>
</div>

<div class="sidenote">
<h3>Не протоколи, але зайнято</h3>
<p>Матриця — GPIO scan, екран — <code>&amp;spi0</code>, RGB і п'єзо — <code>&amp;pwm1</code> / <code>&amp;pwm0</code>: 18 GPIO Pro Micro майже всі задіяні.</p>
</div>

</div>

</div>
