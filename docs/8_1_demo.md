<!-- _class: visual -->

# Апаратна демонстрація

<!--
  Відео замість мозаїки фото (раніше — окремий слайд 8_2): 60 с показують і
  RGB, і екрани, і обидві половинки, тобто те, для чого було три плитки.

  Рамка `.video.hero` (theme/keeb.css) — фіксовані 500px висоти й 16/9:
  максимум, що лишається після заголовка й ряду chips на слайді 1280×720.
  Постер `assets/demo-video-poster.jpg` лишається фоном під iframe: у deck.pdf
  embed не грає, і видно кадр із посиланням.
-->

<div class="stage full">

<figure class="shot">
<div class="video hero" style="background-image: url(assets/demo-video-poster.jpg); height: 400px">
<iframe src="https://www.youtube.com/embed/Vu30jgNvCN0?rel=0" title="Відеодемонстрація клавіатури, 60 с" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>
<figcaption>60 с · <a href="https://youtu.be/Vu30jgNvCN0">youtu.be/Vu30jgNvCN0</a></figcaption>
</figure>

<div class="chips">

<span class="chip"><b>Bluetooth</b> профілі, з'єднання половинок</span> <span class="chip"><b>Шари</b> home, nav, func, mouse, game</span> <span class="chip"><b>Екрани</b> заряд, профіль, лінк</span> <span class="chip"><b>RGB / buzzer</b> статус BLE, reset / bootloader</span>

</div>

</div>
