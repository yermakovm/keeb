<!-- _class: visual -->

# Плати матриці

<div class="stage">

<figure class="shot">
<div class="photo contain"><img src="assets/pcb-3d.png" alt="3D-рендер плати матриці"/></div>
<figcaption>3D-рендер плати матриці — те, куди треба рухатись після прототипу</figcaption>
</figure>

<div class="sidenotes">

<div class="sidenote">
<h3>GPIO-бюджет</h3>
<p>12 пінів матриці + 3 екран + 3 RGB: майже всі 18 GPIO Pro Micro вже зайняті.</p>
</div>

<div class="sidenote">
<h3>KiCAD</h3>
<p>Проєкт має три частини, які з'єднуються <strong>FPC-коннекторами</strong>.</p>
</div>

<div class="sidenote warn">
<h3>Геометрія</h3>
<p>Задум — гнучкі чи криволінейні плати під keywell-ергономіку; остаточні форма й кріплення ще не обрані.</p>
</div>

<div class="sidenote">
<h3>Наразі</h3>
<p>Hand-wired збірка: це прототип, а не повторювана конструкція.</p>
</div>

</div>

</div>

---

<!-- _class: visual -->

# Плати: розведення частин

<div class="stage">

<div class="mosaic">

<figure class="shot">
<div class="photo contain"><img src="assets/pcb-view-a.png" alt="Варіант розведення плати матриці — вид A"/></div>
<figcaption>Schematic</figcaption>
</figure>

<figure class="shot">
<div class="photo contain"><img src="assets/pcb-view-b.png" alt="Варіант розведення плати матриці — вид B"/></div>
<figcaption>PCB</figcaption>
</figure>

</div>

<div class="sidenotes">

<div class="sidenote">
<h3>Чому три частини</h3>
<p>Одна плата на половинку + окремий борд під екран і контролер: FPC дає кривизну там, де жорсткий FR-4 її не дає.</p>
</div>

<div class="sidenote warn">
<h3>Ще не рішення</h3>
<p>Це робочі варіанти розведення, не фінальна ревізія</p>
</div>

</div>

</div>
