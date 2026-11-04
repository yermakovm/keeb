<!-- _class: visual -->

# Відео: як це працює

<!--
  Окремий слайд під відео, а не четверта плитка в 8_1_demo.md:
  `.photo`-рамка у mosaic-3 — 16:10 і `cover`, тому вбудований плеєр був би
  ~370px шириною (занадто мало для 60-секундного демо).

  Рамка `.video.hero` у theme/keeb.css має фіксовану висоту 500px і
  `aspect-ratio: 16 / 9` → 889×500: це максимум, що залишається після
  заголовка на слайді 1280×720 (без підпису можна додати ще ~40px).

  `<iframe>` — робочий плеєр у deck.html. У deck.pdf він не програється:
  постер `assets/demo-video-poster.jpg` (1280×720, знятий з YouTube) лишається
  під iframe як фон, тож у PDF видно кадр і посилання.
  Відео на YouTube — unlisted, 60 с, `playableInEmbed: true`; для показу
  потрібен інтернет.
-->

<div class="stage full">

<figure class="shot">
<div class="video hero" style="background-image: url(assets/demo-video-poster.jpg)">
<iframe src="https://www.youtube.com/embed/Vu30jgNvCN0?rel=0" title="Відеодемонстрація клавіатури, 60 с" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>
<figcaption>60 с · <a href="https://youtu.be/Vu30jgNvCN0">youtu.be/Vu30jgNvCN0</a></figcaption>
</figure>

</div>
