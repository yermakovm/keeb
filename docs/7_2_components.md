<!-- _class: visual -->

# Компоненти

<div class="stage">

<div class="mosaic mosaic-3">

<figure class="shot">
<div class="photo contain"><img src="assets/mcu-photo.jpg" alt="Контролер nRF52840 на платі форм-фактора Pro Micro"/></div>
<figcaption>nRF52840 · Pro Micro форм-фактор</figcaption>
</figure>

<figure class="shot">
<div class="photo contain"><img src="assets/niceview.jpg" alt="Екран nice!view 160×68"/></div>
<figcaption>nice!view · 160×68</figcaption>
</figure>

<figure class="shot">
<div class="photo"><img src="assets/amoeba-pcb.jpg" alt="Плата Amoeba: сокети для MX-світчів і діоди матриці"/></div>
<figcaption>Amoeba — сокети MX і діоди матриці (без RGB для економії заряду)</figcaption>
</figure>

<figure class="shot">
<div class="photo contain"><img src="assets/KY-016_RGB_LED.jpg" alt="Модуль KY-016 RGB LED"/></div>
<figcaption>KY-016 RGB</figcaption>
</figure>

<figure class="shot">
<div class="photo contain"><img src="assets/KY-006.jpg" alt="Пасивний п'єзо-бузер KY-006, він же HW-508"/></div>
<figcaption>KY-006 · пасивний п'єзо (HW-508)</figcaption>
</figure>

<div class="sidenote tile">
<h3>Матриця</h3>
<p>60 позицій: MX-світчі в hot-swap сокетах, <strong>діоди col→row вже на Amoeba-платі</strong>.</p>
</div>

</div>

<div class="sidenotes">

<div class="sidenote">
<h3>Контролер і живлення</h3>
<p>Клон nice!nano на nRF52840; <strong>LiPo 1000 mAh</strong> на половинку.</p>
</div>

<div class="sidenote">
<h3>Екрани</h3>
<p>LS011B7DH03 на <code>&amp;spi0</code> — по одному на половинку.</p>
</div>

<div class="sidenote">
<h3>Світло й звук</h3>
<p>KY-016 RGB на P0.02 / P0.29 / P0.31 (<code>&amp;pwm1</code>); звук — <strong>KY-006</strong> на P1.01 лівої половинки (<code>&amp;pwm0</code>): тон задає частота PWM, без транзистора.</p>
</div>

</div>

</div>
