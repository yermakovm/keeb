<!-- _class: visual -->

# Веб-конфігуратор: розкладка і шари

<div class="stage">

<figure class="shot">
<div class="photo"><img src="assets/webui-keymap.png" alt="Скріншот веб-конфігуратора: фізична розкладка двох половинок, вкладки шарів, палітра дій"/></div>
<figcaption>реальний застосунок: Vue 3 + Vite + Pinia + TypeScript, 60 позицій, 6×12 матриця</figcaption>
</figure>

<div class="sidenotes">

<div class="sidenote">
<h3>Apply = один запис</h3>
<p>Усі правки живуть у браузері; на клавіатуру летить <strong>один <code>CELLS_SET</code></strong> на шар — а не 60 запитів.</p>
</div>

<div class="sidenote">
<h3>Хеш токенів</h3>
<p>Звіряється перед записом: behavior, якого немає в image, неможливо призначити.</p>
</div>

<div class="sidenote">
<h3>Не потребує бекенду</h3>
<p>Комунікація відбувається між браузером юзера і його ж девайсом - достатньо простого веб-серверу для роздачі статичних файлів</p>
</div>

</div>

</div>

---

<!-- _class: visual -->

# Веб-конфігуратор: панелі екрана й тестер

<div class="stage">

<div class="mosaic">

<figure class="shot">
<div class="photo"><img src="assets/webui-panel.png" alt="Скріншот редактора панелі: таблиця віджетів і їх налаштування"/></div>
<figcaption>редактор панелі: таблиця віджетів, текст, розмір, розташування</figcaption>
</figure>

<figure class="shot">
<div class="photo"><img src="assets/webui-tester.png" alt="Скріншот тестера клавіш: індикація активних свічів"/></div>
<figcaption>тестер: який свіч натиснуто і на якому шарі</figcaption>
</figure>

</div>

<div class="sidenotes">

<div class="sidenote">
<h3>Межі диктує firmware</h3>
<p>Набір віджетів і їх геометрію обмежує прошивка: конфігуратор не може намалювати те, що двигун не підтримує.</p>
</div>

<div class="sidenote warn">
<h3>Показники ZMK не підробити</h3>
<p>Шар, батарея, лінк, зарядка, під'єднаний пристрій — власність прошивки. Віджет обирає лише <strong>який</strong> з'явиться і <strong>де</strong>.</p>
</div>

</div>

</div>
