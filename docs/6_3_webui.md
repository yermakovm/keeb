<!-- _class: dense -->

<!--
  Скріншот замість заглушки: покласти docs/assets/webui.png і замінити src нижче.
  Заглушка — assets/webui-screenshot-placeholder.svg (640×400, 16:10).
-->

# Веб-конфігуратор

<div class="cols">

<div class="col">

<div class="media"><img src="assets/webui-screenshot-placeholder.svg" alt="Місце для скріншота веб-конфігуратора: плата, шари, екрани, палітра клавіш"/></div>

</div>

<div class="col">

<div class="cards">

<div class="card">
<h3>Редактор розкладки/шарів</h3>
<p>Mouse-friendly UI: елементи можна налаштувати по кліку</p>
<p class="why">Apply = один <code>CELLS_SET</code></p>
</div>

<div class="card">
<h3>Редактор екранів</h3>
<p>Таблиця віджетів і їх налаштування: текст/розмір/розташування.</p>
<p class="why">Межі набору віджетів диктує firmware</p>
</div>

<div class="card">
<h3>Тестер клавіш</h3>
<p>Індикація активних свічів і keycode: <code>TEST_SET</code>, <code>EV_KEY</code> із позицією.</p>
</div>

</div>

</div>

</div>

<p class="note"><strong>Стек:</strong> Vue 3 + Vite + Pinia + TypeScript. Хеш токенів звіряється перед записом.</p>
