# Registro · tanda-de-penaltis

- **Ticket:** sin ticket
- **Estado:** vivo
- **Pantalla vigente:** penaltis.html
- **Promoción:** ninguna

| Fecha | Tipo | Mode | Alcance | Qué cambió | Por qué | Vigencia |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-25 | UPDATE | `42DS+HF+CSS` | `penaltis-V3.html`, `penaltis-V3.juego.js` | UI «estadio de noche»: bloque de juego oscuro con `data-theme="dark"` del DS, portada con explicación visual, CTA amarillo, respuestas y veredicto en tarjetas oscuras, grafismo de final de partido, escritorio en dos columnas y móvil a sangre | La interfaz blanca no casaba con la escena 3D nocturna y en portátil el penalti no cabía en una pantalla | vigente |
| 2026-09-25 | FIX | `42DS+HF+CSS` | `penaltis-V3.escena.js`, `penaltis.data.js` | Pies atados a la tibia en las poses propias, ángulos de rodilla más contenidos, pierna superior del portero sin levantar, guantes pintados en las manos y equipación del lanzador inspirada en el Barça (rayas azulgrana, pantalón azul marino, dorsal amarillo) | Las piernas se estiraban porque en el rig los pies son objetivos de IK colgados de la raíz; petición de equipación azulgrana | vigente |
| 2026-09-25 | UPDATE | `42DS+HF+CSS` | `penaltis-V3.html`, `penaltis-V3.juego.js`, `penaltis-V3.escena.js`, `penaltis.data.js`, `assets/` | V3 en revisión: escena 3D nocturna (Three.js) sobre la lógica de V2, con carrera, golpeo, estirada, red deformable, público, repetición lateral, sonido opcional y dos equipaciones desde datos; el SVG de V2 queda como portada y reserva | Aplicar el brief de Three.js: más espectáculo sin tocar reglas, controles ni carga inicial | vigente |
| 2026-09-25 | UPDATE | `42DS+HF+CSS` | `penaltis-V2.html`, `penaltis-V2.juego.js` | V2 en revisión: foco sin scroll y «Siguiente» pegado, cabecera compacta, marcador Tú–Portero, feedback sin duplicar, escena con trayectoria y celebración, resultado en tarjeta con compartir nativo, progreso al reanudar | En móvil y portátil el gol quedaba fuera de pantalla al enfocar «Siguiente» y el resultado se repetía tres veces | vigente |
| 2026-09-25 | NEW | `42DS+HF+CSS` | `penaltis.html`, `penaltis.data.js`, `penaltis.juego.js` | Trivial de fútbol en tanda de cinco penaltis con cuatro opciones mapeadas a las esquinas de la portería y escena SVG animada | Validar que el gesto «respuesta = esquina» se entiende sin tutorial y que la animación añade emoción sin ralentizar el juego | vigente |

## Notas

- Hypothesis Lean UX: un lector aficionado al fútbol, en un hueco de dos o tres
  minutos en el móvil, quiere un pasatiempo rápido con algo de emoción. Un
  trivial en el que cada respuesta es una esquina y el resultado se ve como gol
  o parada debería completarse y compartirse más que un quiz en lista. Lo más
  arriesgado: que el mapeo respuesta → esquina se entienda sin explicación y
  que la parada no se lea como fallo de puntería.
- Por esa segunda razón el balón siempre va a la esquina elegida: solo cambia
  hacia dónde se tira el portero.
- Clases DS usadas: `ft-layout-grid-flex*`, `ft-org-game` (contenedor del
  bloque de juego), `ft-title`, `ft-text`, `ft-btn --primary --md`,
  `ft-tag --sm`, `ft-link`, `ft-list`, `ft-mol-advice`, `ft-skiplink` y helpers
  `ft-helper-fontSize-*` y `ft-helper-spacer-*`.
- Excepciones a Lite, por los estados que exige HF: `ft-mol-advice` (error y
  vacío), `ft-text`, `ft-list` y `ft-skiplink`.
- CSS custom `.poc-*`: escena SVG, opciones-esquina (`.poc-opcion`), marcador
  de tanda (`.poc-tanda`), rótulo de gol o parada, veredicto, esquema de
  entrada, esqueleto de carga y `.poc-sr`, porque el DS no tiene clase de texto
  solo para lector de pantalla.
- Un solo override `.ft-*`: `.poc-juego.ft-org-game` estira a sus hijos y
  quita el margen superior, comentado junto a la regla.
- Contraste: `--color-functional-success` (#00bd3e) sobre blanco da ~2,4:1, así
  que en el marcador, las insignias, el rótulo y el repaso el texto es negro
  sobre el color (8,7:1 en verde, 6,1:1 en rojo), no blanco.
- Los helpers `ft-helper-spacer-*` son `padding-bottom`: las reglas locales no
  usan el atajo `padding` en elementos que llevan helper.
- Candidatos al DS si el juego sigue adelante: opción de respuesta tipo
  tarjeta (`.poc-opcion`) y marcador de progreso por intentos (`.poc-tanda`).
  Ninguno existe hoy en `scss/fourties/`.
- Verificado en Chrome headless:
  - partida completa automatizada: cinco tiros, tres con ratón y dos con
    teclado, un fallo;
  - los clics durante la animación se ignoran y el foco pasa a «Siguiente» y
    después al título del resultado;
  - la región viva anuncia cada tiro y el progreso queda guardado a media
    tanda;
  - al recargar aparece «ya jugado» y el texto para compartir es correcto;
  - sin desbordamiento horizontal a 360 px en entrada, gol, parada y
    resultado, y revisión visual a 360 px y 1280 px.
- Pendiente de comprobación manual: dispositivo real, recorrido con lector de
  pantalla y prueba con usuarios de la suposición del mapeo.
- V2 (2026-09-25) convive con V1 para comparar; no sustituye todavía a
  `penaltis.html`. Si se aprueba, la fila NEW pasa a `sustituido` y la
  cabecera a `Pantalla vigente: penaltis-V2.html`.
- V2 reutiliza `penaltis.data.js` y guarda en `localStorage` con prefijo
  `penaltis:v2:`, aparte de V1. Estado nuevo de revisión: `?estado=seguir`.
- V2 no añade clases DS nuevas. CSS custom nuevo: `.poc-cabecera`,
  `.poc-marcador*`, `.poc-antetitulo`, `.poc-trayectoria`, `.poc-impacto`,
  `.poc-destello`, `.poc-balon--estela`, `.poc-opcion__icono`,
  `.poc-acciones--pegajosa`, `.poc-esquema__*` (SVG), `.poc-progreso`,
  `.poc-tarjeta*`, `.poc-repaso-plegable`, `.poc-proxima`.
- V2 anula el margen de `.ft-text` dentro de `.poc-bloque` (`p.ft-text`): el
  ritmo lo marcan tokens `--poc-penaltis-hueco*`. No es un override de clase
  DS fuera del POC.
- Verificado en Chromium headless (V2): partida completa en móvil 390 px
  táctil y escritorio 1280×800, teclado (flechas, A-D, Intro), movimiento
  reducido, reanudar a medias, error, vacío, carga y resultado; sin scroll
  horizontal a 360 px y sin errores JS. El foco tras el tiro no desplaza la
  página (scrollY 0 en móvil).
- Pendiente en V2: `navigator.share` y vibración solo se pueden comprobar en
  dispositivo real; lector de pantalla manual.
- V3 (2026-09-25) convive con V1 y V2; tampoco sustituye todavía a `penaltis.html`.
  Guarda en `localStorage` con prefijo `penaltis:v3:` (partida y preferencia de sonido).
- V3: la lógica decide esquina, gol y estirada; la vista solo representa. Contrato
  común a la vista SVG y a la 3D: `preparar`, `apuntar`, `tirar`, `resultado`,
  `cancelarRepeticion`, `sonido`. El cambio SVG→3D solo ocurre entre tiros.
- V3: el 3D se descarga al acercarse o pulsar «Empezar la tanda» (import dinámico);
  la carga inicial de la página no cambia. Peso del 3D, comprimido con gzip: three
  (bundle mínimo) ~162 KB, `jugador.glb` ~166 KB, escena ~16 KB.
- V3: sin WebGL o con `?escena=2d` se juega con la ilustración de V2. Con
  `prefers-reduced-motion` el 3D muestra directamente el desenlace, sin carrera,
  repetición ni celebración animada.
- V3: `penaltis.data.js` añade el campo opcional `equipaciones` (lanzador y portero);
  V1 y V2 lo ignoran. Procedencia y licencias de los assets en `assets/PROCEDENCIA.md`.
- V3: los clips de patada, estirada, portero preparado, celebración y lamento son
  propios, generados en código sobre el esqueleto del GLB (que solo trae Idle, Run…).
- V3 no añade clases DS. CSS custom nuevo: `.poc-escena3d`, `.poc-chip*`, `.poc-sonido*`.
- Verificado en Chromium headless con WebGL por software: partida completa en
  escritorio 1280×800 y móvil 390 px, teclado, gol y parada, repetición y su
  cancelación con «Siguiente», movimiento reducido, `?escena=2d`, sin WebGL
  (se sigue jugando), segunda equipación (`?fecha=2026-09-24`) y demos `?estado=`.
  Sin errores JS.
- Pendiente en V3: fluidez, memoria y temperatura en móvil real; sonido en
  dispositivo; lector de pantalla manual.
- V3 (FIX): en `jugador.glb` los huesos FootL/FootR cuelgan de la raíz (eran objetivos
  de IK). Los clips del GLB los traen horneados; en las poses propias la escena los
  recoloca al final de la tibia en cada fotograma. Sin eso, la pierna se estira.
- V3 (FIX): el GLB no tiene UV. Las rayas de la camiseta y los guantes del portero se
  pintan en el shader a partir de la posición de reposo del vértice (`patron: 'rayas'`
  en `equipaciones`). Equipación azulgrana solo por colores y forma: sin escudo ni marcas.
- V3 · UI (2026-09-25): el juego vive en `.poc-estadio` con `data-theme="dark"` (tema
  oscuro del propio DS) y una paleta de noche `--poc-noche*`, `--poc-acento` (amarillo
  de foco) y `--poc-tinta`. La ilustración SVG de reserva recupera sus tokens de día.
- V3 · UI: rejilla `colMd-10 colMdOffset-1` (ancho). A partir de 1024 px el penalti va en
  dos columnas (escena | pregunta, respuestas, veredicto y «Siguiente»); la entrada, en
  dos columnas (portería explicativa | texto y CTA). En móvil el bloque va a sangre.
- V3 · UI: un override comentado de `.ft-btn--primary` dentro del estadio (CTA amarillo).
  CSS nuevo: `.poc-estadio`, `.poc-eyebrow`, `.poc-reglas`, `.poc-entrada__*`,
  `.poc-esquema__arcos|dianas`, `.poc-tarjeta__final|resultado|equipo|goles|guion`, `.poc-pie__etiqueta`.
- Verificado a 1280×800 (todo el penalti visible sin scroll), 820 px y 390 px táctil;
  foco visible con teclado; sin scroll horizontal; flujo completo, movimiento reducido,
  sin WebGL y `?escena=2d` sin errores. Las capturas `fullPage` de Playwright desactivan
  la emulación táctil: revisar la ayuda de teclado en móvil con capturas de viewport.
- V4 · UX/UI (2026-09-25): `penaltis-V4.html` + `penaltis-V4.juego.js`. Reutiliza
  `penaltis-V3.escena.js` y `penaltis.data.js`. Guarda aparte (`penaltis:v4:`).
- V4 (FIX): el bloque `prefers-reduced-motion` de V3 llevaba un `@media (max-width: 420px)`
  metido en la lista de selectores y el navegador descartaba la regla: el esqueleto y el
  latido del tiro actual seguían animándose con movimiento reducido.
- V4 · entorno: en el servidor local `ux-index.css` importa `/cds-statics/…` con ruta
  absoluta y las 147 hojas dan 404 (se ve sin DS). V4 lo detecta, las recarga desde la
  carpeta real y lo avisa en el pie. Arreglo de fondo: servir desde la raíz del DS o
  imports relativos.
- V4 · esquina ↔ respuesta: dianas 3D con disco oscuro y aro amarillo, más grandes y
  opacas; al apuntar, la elegida crece y las demás se apagan. Se aplica retocando el
  texto del módulo V3 antes de importarlo (7 sustituciones, cada una independiente;
  si falla, carga la escena V3 tal cual). Para producción: pasar esos valores a la escena.
- V4 · respuestas: rejilla de alto igual, texto centrado y sin guiones (`hyphens: manual`);
  insignia ✓/✕ en la esquina del botón que corresponde a la de la portería; el hover
  solo apunta tras mover el ratón (sin trayectorias fantasma jugando con teclado).
- V4 · ritmo: estado «Chutas a la C, abajo a la izquierda…» durante el tiro; la opción
  elegida queda encendida; veredicto y «Siguiente» entran con un fundido corto.
- V4 · enganche: racha, mejor racha, media, mejor tanda y tandas jugadas desde el
  historial guardado. Entrada: cifras en lugar de reglas si ya has jugado y aviso de
  racha en riesgo. Resultado: cifras bajo la tarjeta, aviso de récord igualado y racha
  en el texto compartido; «✓ Copiado» en el botón.
- V4 · CSS nuevo: `.poc-estado-tiro`, `.poc-racha-nota`, `.poc-reglas--resultado`,
  `.poc-resultado-nota`, `.poc-aviso-ds`, `.poc-opcion.is-elegida`.
- Verificado en Chromium headless (1440 y 390 px) con datos de prueba: flujo completo,
  cifras y racha, insignias, estado del tiro, texto compartido, reparación del DS,
  import retocado de la escena y reserva sin escena. Pendiente: revisión visual con el
  DS y la escena 3D reales en el navegador.
- V4.1 · Barça, reloj y ranking (2026-09-25):
  - Temática FC Barcelona. Preguntas, tiempos, puntos y divisiones en
    `penaltis-barca.json` (8 tandas, del 24-09 al 01-10, correctas repartidas A–D).
    V4 ya no usa `penaltis.data.js` (lo siguen usando V1–V3). La equipación por defecto
    va en el JSON y cada tanda puede sobrescribirla. Sin tanda para el día: juega la
    más reciente anterior y lo avisa.
  - Reloj por penalti: `config.segundosPorPenalti` = 15, 13, 11, 9, 7. Barra amarilla
    que se vacía, roja en los 3 últimos segundos. Al agotarse, «Se acabó el tiempo»: chuta
    a una esquina que no es la buena y el portero la para (cuenta como parada). Se
    pausa con la pestaña oculta. Lector: «Tienes N segundos» y aviso a los 5 s.
    Demo: `?estado=tiempo`.
  - Puntos: 100 por gol + 10 por segundo sobrante + 200 por pleno. El veredicto enseña
    el desglose y el acumulado; la tarjeta final, el total; el texto compartido, también.
  - Ranking personal (sin servidor): puntos acumulados, división (Cantera → Juvenil A →
    Barça Atlètic → Primer equipo → Leyenda culé), barra hacia la siguiente, puesto de la
    tanda entre las tuyas y barras de puntos de las últimas 12 tandas (hoy en amarillo,
    media discontinua, valor al pasar por encima, tabla para lector). En la entrada, los
    veteranos ven racha, puntos con división y récord.
  - CSS nuevo: `.poc-reloj*`, `.poc-veredicto__puntos|llevas`, `.poc-tarjeta__puntos`,
    `.poc-ranking*`, `.poc-evolucion*`.
  - Verificado en Chromium headless (1440 y 390 px): flujo completo con un penalti
    agotado, puntos por tiro y total, guardado, ranking y gráfico con historial
    sembrado, texto compartido, `?estado=tiempo`. Sin errores JS.
  - Pendiente: ranking global contra otros jugadores (necesita backend) y revisar las
    preguntas con la redacción.
- V4.2 · Acabado premium (2026-09-25): capa CSS al final del `<style>`, sin cambiar la
  estructura. Página entera en noche (`--poc-fondo`) con dos focos, azul y grana; panel
  del estadio de «vidrio» con luz cenital y franja blaugrana arriba; antetítulo de marca
  (`.poc-kicker`, franja de colores, sin escudo); marcador de retransmisión con «TÚ» en
  degradado blaugrana; respuestas con relieve y elevación al pasar; letra con volumen;
  reloj y barra de división con brillo dorado; veredicto como tarjeta con filo de color;
  CTA dorado con volumen y foco fino; tarjeta final con reflejo; ranking con franja.
  Gráfico de evolución dibujado al ancho real (texto 11 px en cualquier pantalla,
  se redibuja al cambiar de ancho).
- Verificado con el CSS real del 42DS y la escena 3D (Chromium headless con WebGL por
  software) a 1440 px y 390 px: entrada, penalti, tiro agotado y resultado. Sin errores JS.
- V4.3 · Animaciones (2026-09-25): nueva `penaltis-V4.escena.js` (V3 conserva la suya;
  V4 ya no retoca la de V3 al vuelo). Diagnóstico medido fotograma a fotograma: el
  portero quedaba hasta 25 cm dentro del césped tras la estirada y se hundía 8 cm en
  la espera (el saltito previo se aplicaba sin tiro); el lanzador golpeaba flotando 5 cm
  y patinaba en la carrera; las poses iban en tramos lineales o congeladas.
  - Clips propios con Catmull-Rom horneado a 30 fps (`clipSuave`), pies planos
    (`planos`), altura resuelta contra el césped (`apoyar`: suelas o cuerpo, y nunca
    por debajo), carrera sincronizada con la distancia y pisada del pie izquierdo al
    empezar la patada.
  - Coreografías: patada (armado, contacto, continuación, saltito, recuperación);
    portero en espera con cambio de peso, paso previo, estirada en cuatro fases
    (impulso, vuelo, caída, suelo) con final distinto si para o encaja; portero en el
    centro que bloquea y se gira; celebración (saltos, puño, «avión») y lamento
    (manos a la cabeza, cabeza gacha).
  - API solo de pruebas: `inspeccion(t, plan)` y `laboratorio({...})`.
  - Verificado: altura mínima de la malla ≥ 0 en todos los fotogramas de cuatro
    jugadas; el pie de golpeo llega al balón en el contacto. Comparativa en vídeo.
- V4.4 · Límites y móvil (2026-09-25): hasta `config.limites.tandasSeguidas` (5) tandas
  seguidas, espera de `esperaMinutos` (60) y `maximoDiario` (15). Las tandas se juegan en
  orden de número y se guardan como `tanda:<n>`; «Jugar otra tanda» en el resultado;
  panel de descanso / máximo diario / sin tandas con cuenta atrás. Móvil: marcador que
  cabía mal a 320 px, clic fantasma al cambiar de pregunta (450 ms de guarda), horizontal
  en dos columnas, zonas seguras, sin zoom por doble toque ni menú al mantener, botones
  ≥ 44–48 px, `theme-color`. Verificado en emulación de iPhone SE/14 Pro Max, Pixel 7,
  Galaxy S9+, iPhone y Pixel en horizontal e iPad Mini (Chromium; falta Safari real).
- V4.5 · Bloque perfecto: +`config.puntos.bloquePerfecto` (1000) al cerrar un bloque de 5
  tandas con todas las preguntas acertadas. Progreso de plenos en entrada y resultado,
  insignia en la tarjeta y en el texto compartido; el bonus se guarda con la tanda.
- V4.6 · Portero tras la estirada (2026-09-25): ya no se queda tumbado ni flota. Causa
  del «flotando»: en el suelo, el brazo de abajo apuntaba al césped y hacía de puntal
  (cadera a 0,5–0,7 m). Ahora los brazos van al frente, paralelos al suelo (cadera
  ≈ 0,3 m, el torso toca el césped). Secuencias completas: parada → se incorpora de
  rodillas, se levanta y celebra (puños, saltos, brazos en V); gol → se queda un
  momento, se sienta con las manos en la cabeza, se levanta y mira a la red con las
  manos en la cintura. `TL.fin` pasa de 2,6 a 4,9 s (la repetición empieza después).

## V4.7 · Rótulo de retransmisión (¡Gol! / ¡Parada!)

- La pastilla verde/roja se sustituye por un grafismo de tele en dos tiempos:
  - **Golpe (~1,8 s):** destello, viñeta, rayos giratorios y una banda que barre la escena. En el gol la banda es blaugrana con filo oro; en la parada es roja con franjas.
  - **Letras:** caen una a una en el gol (dorado metálico). En la parada llegan de golpe y el bloque tiembla, como un balón contra un muro.
  - **Subtítulo:** «+N puntos», «El portero la adivina» o «Se acabó el tiempo».
  - **Confeti:** 44 piezas blaugrana/oro en el gol.
- **Firma:** después todo se recoge en una placa pequeña abajo a la derecha, para no tapar la repetición.
- Tamaños en unidades de contenedor (`cqi`), así escala igual en móvil y escritorio. En los estados de demo aparece directamente como firma. Con reduced-motion no hay animaciones.
- Código: capa CSS «V4.7» en `penaltis-V4.html`; `mostrarRotulo(gol, {puntos, agotado, instantaneo})` en `penaltis-V4.juego.js`.

## V4.8 · Marca SPORT y pie de revisión oculto

- **Pie de revisión:** los enlaces de estados y el aviso de entorno ya no se ven. Aparecen con `?revision=1`, y todos los enlaces del pie conservan ese parámetro.
- **Marca SPORT desde el 42DS:**
  - Las hojas son ahora `brands/sport/setting.css` y `sport-index.css`, y el body lleva la clase `ft-brand-sport`.
  - El favicon es la «S» de SPORT en rojo.
- **Cabecera de sección:** barra negra con el logo de SPORT en rojo #ec0918, la sección «Juegos» (con el icono `icon-juegos-stroke` del DS) y un filete rojo inferior.
- **Tipografía:** los titulares, el marcador y el rótulo usan la condensada de la marca (`--font-secondary`, MediaSans Semi Condensed).
- **CTA:** el botón principal pasa a rojo SPORT. El oro queda para puntos y foco.
- **Rótulo:** en el golpe aparece la mosca SPORT sobre «¡Gol!» / «¡Parada!». En la firma se queda como pestaña roja pegada a la placa.
- **Estadio 3D:** las vallas LED muestran «SPORT» (bloque rojo), «Tanda de penaltis» y «Juegos».

## V4.9 · Rótulo legible

- Las letras del rótulo salían cortadas: `background-clip: text` solo pinta dentro de la caja de cada letra, y la cursiva y los signos ¡! la desbordaban.
- Cada letra lleva ahora un margen interior, compensado con un margen negativo. El interlineado pasa a 1.
- La placa pequeña tiene más aire, medido en `cqi`, y la pestaña SPORT va alineada con ella.
- En la placa pequeña se quitan la sombra de relieve y el contorno, para que se lea limpio.

## V4.10 · Rótulo sin letras cortadas (Chrome Windows)

- **Causa:** la cursiva sintética de MediaSans inclina la parte alta de cada letra hacia la derecha, fuera de su caja. Con `background-clip: text` esa parte no se pinta. En Chrome de Linux no se notaba; en Windows sí.
- **Arreglo:** el hueco interior de cada letra pasa a 0.34em por la derecha, compensado con margen negativo, y el interlineado se compensa en `.poc-rotulo__palabra`.
- **Placa:** la pestaña SPORT de la placa aparece cuando la placa ya ha llegado a la esquina, para que no dé un salto a mitad de la transición.
- Verificado en el Chrome del equipo (Windows) y en Playwright.

## V4.11 · Nombre: «La tanda»

- **Nombre del juego:** pasa a ser «La tanda» en el título de la pestaña, la cabecera SPORT, el H1, las vallas LED del estadio, el texto para compartir («La tanda · SPORT #n») y la nota del JSON.
- **Sin cambios:**
  - «Tanda #n» y «Tanda culé · 1 de 5 seguidas» siguen igual, porque nombran cada ronda y no el juego.
  - Los nombres de archivo y la carpeta tampoco cambian, para no romper enlaces ni rutas.

## V4.12 · Título «La tanda» espectacular

- **Grafismo de portada deportiva:**
  - «LA» va en un taco rojo SPORT inclinado.
  - «TANDA» es enorme, en la condensada de SPORT en cursiva, con relleno metálico (blanco, plata y oro abajo) y un brillo que cruza una vez al cargar.
  - Detrás lleva un eco en contorno rojo.
- **Tiros de la tanda:** debajo, sobre la franja blaugrana, aparecen en cadena los cinco tiros; el último es dorado.
- **Accesibilidad:** el H1 conserva el texto «La tanda» por `aria-label`. Con reduced-motion no hay animaciones.
- **En juego:** en escritorio el título se reduce; en móvil ya se ocultaba.
- **Cursiva sin cortes:** el título tiene el mismo hueco para la cursiva que el rótulo, así que no se corta en Chrome de Windows. Verificado en el navegador del equipo.

## V4.13 · Título más elegante

- **Sin eco:** se quita el eco en contorno rojo.
- **Relleno:** el metal pasa a ser más sereno, de blanco a champán (#c9ad6a abajo), con sombras suaves y un brillo más tenue.
- **«LA»:** queda como un sello rojo recto y fino, no rotado.
- **Tiros:** son cinco aros finos sobre una línea champán que se desvanece a la derecha; el último va relleno.

## V4.14 · Rendimiento y juego en móvil

- **Reloj justo:** un bloqueo del navegador no descuenta más de 250 ms por tic.
- **3D:** los shaders se compilan con `compileAsync` antes del primer dibujo.
- **Calidad adaptativa:** si la mediana de fotogramas en la jugada supera 25 ms, pasa a resolución 1x y después quita las sombras. Se recuerda en `penaltis:v4:nivel3d`.
- **Menos trabajo por fotograma:** `ResizeObserver` en lugar de medir la escena en cada fotograma, y se libera el contexto WebGL de prueba.
- **Táctil:** sin `backdrop-filter` sobre el lienzo, sin desenfoque en la entrada de letras y 24 piezas de confeti en lugar de 44.
- **Móvil tras el tiro:** se ocultan las opciones apagadas y el reloj, y la página se desplaza para que el veredicto quede entero encima del botón fijo.
- **Hook de pruebas:** `pocPenaltis.escena3D.rendimiento()`.
- **Mediciones:**
  - El DS carga 1,2 MB de CSS en 143 hojas y el juego usa unos 28 KB.
  - El juego pesa unos 78 KB con gzip; el 3D, otros 320 KB con gzip, cargados bajo demanda.

## V4.15 · Publicable fuera del DS (GitHub Pages)

- **`assets/ds/ds-la-tanda.css`:** subconjunto del DS de SPORT (46 KB, 9 KB con gzip) generado con PurgeCSS a partir de `setting.css` y `sport-index.css`. Incluye la fuente MediaSans en `assets/ds/fonts`.
- **Carga:** `penaltis-V4.html` solo lo usa si los enlaces al DS dan error (`onerror`), así que dentro del repo del DS todo sigue igual.
- **Verificación:** se ve idéntico píxel a píxel en entrada, gol, resultado, descanso, perfecto y jugado.
- **`index.html`:** redirige a `penaltis-V4.html` conservando los parámetros de la URL.

## V4.16 · Móvil en vertical: todo de un vistazo (2026-09-28)

Feedback de usuarios: en algunos móviles había que desplazarse para llegar a las respuestas y al botón de empezar, con el reloj ya corriendo.

- **Diagnóstico (antes):** «Empezar la tanda» quedaba a unos 1.070 px en todos los móviles probados, fuera de la primera pantalla. En móviles bajos con las barras del navegador (360×560, 375×553), la segunda fila de respuestas (C y D) quedaba cortada. Tras el tiro, la escena salía por arriba.
- **Encaje de la escena (`encajar()` en `penaltis-V4.juego.js`):** en móvil en vertical, la escena es la pieza elástica. Toma el alto que queda en la zona visible (`visualViewport`, sin las barras del navegador), entre 150 px y su alto natural 360:260. Así marcador, pregunta, escena, reloj y las cuatro respuestas caben juntos. Se recalcula cuando la barra del navegador aparece o desaparece y al girar.
- **Tras el tiro:** si no cabe todo, el bloque se ancla abajo (escena, veredicto y «Siguiente penalti»). La pregunta, ya contestada, sale por arriba, y la escena puede bajar a 120 px.
- **Sticky:** «Empezar la tanda» queda pegado abajo en la entrada. Durante el penalti, las respuestas quedan pegadas abajo como red de seguridad si aun así no caben (pantallas muy bajas o texto grande).
- **Pantallas bajas (≤ 600 px de alto):** se oculta a la vista «Penalti N de 5», que ya cuenta el marcador (sigue para el lector de pantalla), y se reduce el margen superior del estadio.
- **Guía de la primera vez:** en el primer penalti, hasta el primer tiro, un rótulo sobre la escena dice «Toca una respuesta: chutas a esa esquina». No ocupa sitio en el layout. Se recuerda en `penaltis:v4:guia-vista`.
- **Sin cambios:** escritorio (≥ 768 px), móvil en horizontal (ya tenía su layout de dos columnas), reglas, reloj y controles.
- **Verificación (Chromium, móvil táctil emulado, peor caso con la fuente de reserva):**

| Pantalla | «Empezar» visible | Escena en el penalti | Respuestas visibles | Veredicto y «Siguiente» visibles |
| --- | --- | --- | --- | --- |
| 320×480 | — | 150 px | Sí (pegadas) | — |
| 360×560 | Sí | 213 px | Sí | Sí |
| 375×553 (SE, Safari) | Sí | 202 px | Sí | Sí |
| 390×664 (13, Safari) | Sí | 259 px | Sí | Sí |
| 360×740 | Sí | 237 px | Sí | Sí |
| 430×740 (Pro Max, Safari) | Sí | 287 px | Sí | Sí |
| 412×780 | Sí | 274 px | Sí | Sí |

  Se jugó una tanda completa en 375×553 con los cinco penaltis bien encajados. También se comprobó al cambiar el alto a mitad de penalti (la escena crece de 174 a 248 px), con movimiento reducido y con los estados `gol`, `parada` y `tiempo`. No hay scroll horizontal ni errores de consola.
- **Pendiente:** probar en un iPhone y un Android reales. Safari cambia el alto visible al desplazar, y la emulación no lo reproduce del todo.

## V4.17 · Sonido en 3D y 2D, sin coste en la jugada (2026-09-28)

- **Motor común (`penaltis-V4.sonido.js`, nuevo):** el sonido deja de vivir dentro de la escena 3D. La escena y la ilustración 2D disparan los mismos sonidos, así que sin WebGL, con `?escena=2d` o mientras carga el estadio también suena. `crearSonido()` sigue en `penaltis-V4.escena.js` como reserva por si la escena se usa sin el archivo nuevo.
- **Sonidos, todos sintetizados (0 KB de audio):**
  - Jugada: silbato, golpeo, red o parada, y grito de la grada en dos capas.
  - Interfaz: toque al elegir respuesta y tic en 3, 2 y 1 del reloj.
  - Cierre: pitido final (dos cortos y uno largo) y una sintonía según el marcador (pleno, a favor o en contra), más un acorde si hay bonus de bloque perfecto.
  - Ambiente de grada en bucle, solo durante el juego.
- **Apagado por defecto.** El botón de altavoz ya no depende del 3D: está visible siempre que el navegador tenga Web Audio. La preferencia se guarda en `penaltis:v4:sonido` y se aplica al tocar «Empezar», porque el navegador exige un gesto.
- **Aviso para descubrirlo:** en el primer gol con el sonido apagado aparece «Actívalo para oír el estadio» junto al altavoz, con un aro amarillo. Dura 5 s y sale una sola vez (`penaltis:v4:aviso-sonido`).
- **Batería:** el audio se suspende con la pestaña oculta, al salir de la página y a los 6 s de acabar la tanda (tras la sintonía). Se reanuda al volver al juego.
- **iPhone:** sesión de audio `ambient`. Respeta el interruptor de silencio y no corta la música o el pódcast que suene de fondo. *Sustituido en V4.18 por `playback`.*
- **Muestras grabadas (hueco preparado):** `MUESTRAS` en `penaltis-V4.sonido.js` admite URL para `golpeo`, `red`, `parada`, `grito_gol`, `grito_parada`, `ambiente`, `final_bien`, `final_mal` y `perfecto`. Se descargan solo al activar el sonido y sustituyen al sintetizado. Si fallan o no han llegado, suena el sintetizado. Formato recomendado: .m4a o .mp3 mono de 32–64 kbps, menos de 60 KB por clip.
- **Rendimiento medido (Chromium headless, sin GPU):**
  - Cada sonido cuesta entre 0,04 y 0,15 ms en el hilo principal; la sintonía final, unos 1 ms. El audio se procesa en el hilo de audio del navegador.
  - En una tanda completa no hay ninguna tarea larga atribuible al sonido: 3D con y sin sonido dan la misma distribución, y en 2D sin sonido no hay ninguna.
  - Coste único: 45–70 ms al activar el sonido la primera vez, casi todo del propio `AudioContext` del navegador. Ocurre en el toque del altavoz o de «Empezar», no durante la jugada.
  - Los 2 s de ruido de la grada se generan en 8 trozos en tiempo libre, así que no bloquean ese toque.
- **Pendiente:** escucharlo en un iPhone y un Android reales (volúmenes y mezcla con el interruptor de silencio). Headless no reproduce audio, solo lo programa.

## V4.18 · Sonido: «no se oye nada» (2026-09-28)

Informe: al probar la V4.17 no se oía nada. En Chromium el motor sí genera señal: medido con un analizador en la salida, pico de 0,9 en el gol. Se corrigen las causas probables en el dispositivo:

- **iPhone con el interruptor de silencio puesto:** con la sesión `ambient` de V4.17, Web Audio queda mudo. Pasa a `playback`, porque el sonido solo se enciende si el jugador lo pide. Contrapartida: pausa la música o el pódcast de fondo, como un vídeo.
- **Silencio tras activar:** hasta el primer tiro no sonaba nada, y la grada (ruido con paso bajo a 700 Hz) casi no la reproducen los altavoces del móvil. Ahora hay un «ding-dong» de confirmación al activar, y la grada suma una banda media a 1,1 kHz. Pico de la grada sola: de ~0 a 0,15–0,38.
- **La grada tardaba en arrancar con el 3D:** el ruido se generaba con `requestIdleCallback` y, con el 3D animando, apenas había tiempo libre. Ahora se genera en trozos con `setTimeout` (1–3 ms cada uno) y la grada suena al momento.
- **Desbloqueo en Safari:** en el mismo toque se reproduce un búfer vacío. Además, se reanuda también el estado `interrupted` de iOS (llamada, otra app, pantalla bloqueada), no solo `suspended`.
- **Saturación:** se añade un limitador (`DynamicsCompressor`) a la salida, porque grito, red y grada juntos llegaban a 0,98.
- **Pendiente:** confirmarlo en un iPhone y un Android reales.

## V4.19 · Sonido activado y a la vista (2026-09-28)

Informe: en el portátil no se oía nada. El motor sí suena (medido en escritorio y en móvil); el problema era que el sonido no se encontraba.

- **Activado por defecto.** Solo lo apaga un «0» guardado en `penaltis:v4:sonido`. Suena desde el toque en «Empezar la tanda», que es el gesto que exige el navegador.
- **Interruptor en la entrada**, bajo «Empezar la tanda»: «Sonido activado / desactivado», sincronizado con el altavoz de la escena. En móvil va dentro del bloque pegado abajo.
- **Altavoz visible:** en escritorio era un círculo oscuro sobre la grada oscura. Ahora lleva borde claro y se pone amarillo cuando está activo.
- **Caché:** los `<script>` y el `import()` de la escena llevan `?v=4.19` (constante `VERSION` en `penaltis-V4.juego.js`), para que el navegador no mezcle archivos nuevos con viejos. Hay que subir la versión en cada entrega.
- **Guía de la primera vez:** en escritorio dice «Elige una respuesta (o pulsa A, B, C o D)». En táctil sigue diciendo «Toca una respuesta».
- **Verificación:** escritorio 1440×800 con sonido (pico 0,88), escritorio con el sonido quitado en la entrada (no se crea contexto de audio) y móvil 390×664 (pico 0,87). Sin errores.
- **Nota de entrega:** la V4.18 (`penaltis-V4.sonido.js`) no llegó a escribirse en la carpeta del equipo en la primera entrega. Se entrega ahora junto con la V4.19.

## V4.20 · Sonido híbrido: grabaciones con licencia abierta + síntesis (2026-09-28)

- **Qué es grabado y qué sintetizado:**
  - Grabados: golpeo, silbato (también el pitido final, recortado en 2 cortos y 1 largo), parada, grito de gol, «uyyy» de la parada, aplauso del final y grada en bucle.
  - Sintetizados: red, toque, tic, confirmación y sintonía, que suenan bien así y pesan 0 KB.
  - Si falta una grabación, no carga o aún no ha llegado, suena la versión sintetizada. El juego nunca se queda mudo; se ha probado quitando `efectos.json`.
- **Dos archivos en `assets/audio/`**, que se descargan solo cuando el sonido está activado:
  - `efectos.mp3`, un sprite de efectos cortos con su mapa en `efectos.json`.
  - `grada.mp3`, un bucle sin salto: final fundido con el principio y reproducido con `loopStart`/`loopEnd`.
  - Formato: mono, 44,1 kHz, MP3 a 48 kbps. Peso estimado en el peor caso: unos 80 KB de efectos y 85 KB de grada.
- **`tools/audio.py`** (python3 + numpy + ffmpeg):
  - `analizar` muestra los arranques y el perfil de volumen de una grabación, para elegir el corte.
  - `construir` genera los archivos a partir de `assets/audio/fuentes.json`: recorte, fundidos, normalización y sprite.
  - `tools/audio-previa.html` sirve para escuchar cada efecto y el empalme de la grada.
- **Grabaciones originales** en `assets/audio/_fuentes/`. No se publican (`.gitignore` de la carpeta).
- **Procedencia y licencias:** en `assets/PROCEDENCIA.md`. Quistard (Freesound) es CC BY 3.0: exige crédito visible, que se añadirá en el juego cuando se incorpore.
- **Estado:** motor, herramientas y manifiesto listos. Faltan las grabaciones: la red del entorno de trabajo no llega a BigSoundBank, Freesound ni Kenney, así que hay que descargarlas a mano. Mientras tanto suena todo sintetizado, igual que en V4.19.
- **Caché:** `?v=4.20` en los scripts. Las grabaciones llevan su propia versión (`VERSION_AUDIO` en `penaltis-V4.sonido.js`), que hay que subir al regenerar.

## V4.21 · Grabaciones incorporadas y enlace verificado (2026-09-28)

- **Descargadas con el navegador de la app** (con permiso) y copiadas a `assets/audio/_fuentes/`:
  - `1044.wav`, `1017.wav` y `0021.wav` de BigSoundBank.
  - El pack de Kenney.
  - `quistard-237678.mp3`: la vista previa HQ de Freesound, a 128 kbps, que no pide sesión y tiene la misma licencia. Es de sobra para la salida a 48 kbps.
- **Cortes elegidos** con `tools/audio.py analizar`:
  - Golpeo: 2.º golpe.
  - Silbato: 1.er pitido.
  - Parada: `impactPunch_heavy_000` de Kenney.
  - Grito de gol: la explosión a los 3,8 s de la grabación de Quistard.
  - «Uyyy»: la subida y caída de los 37,3 s.
  - Grada: el tramo estable de 20,5 s a 30,5 s, en bucle de 10 s.
  - Aplauso: 4,5 s desde el arranque.
- **Salida:** `efectos.mp3` (85 KB) + `efectos.json`, y `grada.mp3` (61 KB).
- **Volumen de la grada grabada:** 0,5, frente a 0,3 de la sintetizada. Con gol sube ×1,6 y con parada ×1,15, relativo al nivel de cada una.
- **Créditos visibles** bajo el juego: «Sonido de estadio: Quistard (Freesound), CC BY 3.0. Efectos: BigSoundBank y Kenney (CC0)». Obligatorio por la licencia CC BY.
- **Auditoría del enlace:** se interceptan todas las reproducciones durante una tanda completa (gol, parada, gol, gol, tiempo agotado; 3 de 5), en 2D y en 3D.
  - Se cargan los 6 efectos y la grada.
  - Gol: silbato, golpeo, red (sintetizada) y grito de gol.
  - Parada y tiempo agotado: silbato, golpeo, parada y «uyyy».
  - Final: tres pitidos grabados y aplauso.
  - Grada: arranca la sintetizada y se sustituye por la grabada en bucle (0,2–10,2 s) en cuanto llega.
  - No hay errores de audio; los únicos 404 son del DS, que no está en la copia de pruebas.
- **Caché:** `?v=4.21`.
