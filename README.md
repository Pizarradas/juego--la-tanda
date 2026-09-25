# Tanda de penaltis — POC

Trivial de fútbol con forma de tanda de penaltis: cinco preguntas, cuatro
respuestas, y cada respuesta es una esquina de la portería. Al elegir, el
jugador chuta a esa esquina. Si la respuesta es correcta, el portero se tira al
otro lado y es gol; si no, se tira a esa esquina y la para.

## Cómo abrirlo

Las páginas necesitan servidor desde la raíz del repositorio, porque
`ux-index.css` importa rutas absolutas. Desde `42DS/`:

```bash
python3 -m http.server 8099
```

- Juego: <http://localhost:8099/fourty/pocs/tanda-de-penaltis/penaltis.html>
- V2 (mejoras UX/UI, en revisión): <http://localhost:8099/fourty/pocs/tanda-de-penaltis/penaltis-V2.html>
- V3 (escena 3D, en revisión): <http://localhost:8099/fourty/pocs/tanda-de-penaltis/penaltis-V3.html>

No funciona con `file://`.

## Mecánica

| Opción | Esquina |
| --- | --- |
| A | arriba a la izquierda |
| B | arriba a la derecha |
| C | abajo a la izquierda |
| D | abajo a la derecha |

- El balón **siempre** va a la esquina elegida. Gol o parada dependen solo de
  la respuesta, nunca de la puntería: así no parece que se falla por mala suerte.
- Con respuesta correcta, el portero se tira a otra esquina o se queda en el
  centro (al azar). Con respuesta incorrecta, se tira a la esquina elegida.
- Tras cada tiro se marcan la correcta y la elegida, y aparece un dato breve.
- La tanda se guarda en `localStorage` tiro a tiro: se puede cerrar y seguir
  por donde se dejó. Terminada, al volver se ve el resultado.

## Pantallas y estados

`penaltis.html` acepta `?estado=` para revisar cada estado sin jugar:

| Parámetro | Qué muestra |
| --- | --- |
| *(ninguno)* | Flujo real: carga, entrada, cinco penaltis y resultado |
| `?estado=cargando` | Esqueleto de carga |
| `?estado=error` | La tanda no pasa el validador (tanda rota a propósito) |
| `?estado=vacio` | Todavía no hay tanda publicada |
| `?estado=entrada` | Pantalla de inicio con el esquema de esquinas |
| `?estado=juego` | Primer penalti, sin responder |
| `?estado=gol` | Primer penalti respondido bien |
| `?estado=parada` | Primer penalti respondido mal |
| `?estado=resultado` | Cierre con 4 de 5 |
| `?estado=jugado` | Vuelta el mismo día con la tanda ya tirada |

Además: `?fecha=2026-09-24` carga otra tanda y `?reiniciar=1` borra la partida
guardada. Los estados de demostración no escriben en `localStorage`.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `penaltis.html` | Pantalla del juego, escena SVG inline y CSS local `.poc-*` |
| `penaltis.data.js` | Dos tandas de demostración y el contrato de datos |
| `penaltis.juego.js` | Motor: validador, animación del tiro, teclado, guardado y resultado |

## Accesibilidad

- Las opciones son `<button>` con nombre completo («Opción C, abajo a la
  izquierda: España»). Se eligen con clic, con las teclas `A`–`D` o `1`–`4`, y
  las flechas se mueven en rejilla 2×2 como en la portería.
- Durante el tiro las opciones quedan `aria-disabled` (no `disabled`) para que
  el foco no se pierda. Al terminar, el foco pasa a «Siguiente penalti».
- El resultado de cada tiro se anuncia en una región `role="status"` que existe
  siempre. La escena es decorativa (`aria-hidden`): todo lo que cuenta está en
  texto.
- El marcador de la tanda no depende del color: lleva ✓/✕ y texto oculto por
  tiro.
- `prefers-reduced-motion` salta la animación y muestra el estado final.
- Si el navegador no hace avanzar la animación (pestaña en segundo plano),
  un temporizador de seguridad la termina para que la partida no se bloquee.

## Qué valida este POC

- Que la asociación respuesta → esquina se entiende sin tutorial largo: basta
  el esquema de la entrada y el orden A-B / C-D de los botones.
- Que la animación (~1 s) añade emoción sin ralentizar: cinco preguntas se
  juegan en menos de dos minutos.

## Qué no cubre

Ranking, cuentas, tandas contra otro jugador, cronómetro, herramienta de
redacción para escribir las preguntas y publicación real. En producción la
tanda llegaría como `data/<fecha>.json` con el contrato de `penaltis.data.js`.

## V2

`penaltis-V2.html` + `penaltis-V2.juego.js` (mismos datos). Misma mecánica;
cambia la experiencia:

- El foco tras el tiro no mueve la página y «Siguiente penalti» va pegado
  abajo: el gol o la parada se ven enteros en móvil y portátil.
- Durante la tanda la entradilla desaparece; si las opciones no caben, el
  bloque de juego sube al empezar cada penalti.
- Marcador «Tú N – N Portero» con los cinco tiros, y «Penalti N de 5» como
  antetítulo de la pregunta.
- Tras el tiro: insignia ✓/✕ en la letra y solo el dato debajo (en la
  parada, además, cuál era la correcta). El rótulo va en el césped.
- Escena: trayectoria prevista al apuntar, estela, red que se hunde en el
  punto de impacto, onda, destello y grada que salta en el gol.
- Resultado: tarjeta con el marcador, compartir nativo en móvil y copiar en
  escritorio, repaso plegable y cuenta atrás a la próxima tanda.
- Al volver a una tanda a medias se ve cómo ibas. `?estado=seguir` lo enseña.
- Ayuda de teclado oculta en pantallas táctiles.

## V3 · escena 3D

`penaltis-V3.html` + `penaltis-V3.juego.js` + `penaltis-V3.escena.js`, con
`assets/vendor/three-penaltis.min.js` (three r186, MIT) y
`assets/3d/jugador.glb` (Quaternius, CC0). Misma lógica y controles que V2.

- Estadio nocturno low-poly: gradas con público, vallas LED, focos con halo,
  césped con franjas y líneas reales, portería con red que se deforma.
- Jugada completa: carrera, armado, golpeo sincronizado con la salida del
  balón, estirada del portero hacia la esquina que decide la lógica, gol o
  parada con rechace, celebración o lamento del lanzador.
- Cámara de retransmisión detrás del lanzador que se acerca antes del
  golpeo; después, repetición lateral a cámara lenta (~3 s) con franjas de
  cine. «Siguiente penalti» la corta.
- Sonido sintetizado (silbato, golpeo, red, público), apagado por defecto;
  botón en la esquina de la escena.
- Equipaciones desde datos (`equipaciones` en `penaltis.data.js`). El
  lanzador viste de azulgrana (rayas verticales, pantalón azul marino, dorsal
  amarillo, sin escudo); el portero cambia según la tanda (`?fecha=2026-09-24`).
  `patron: 'rayas'` pinta rayas verticales aunque el modelo no tenga UV.
- El 3D se carga al ir a empezar. Mientras tanto, sin WebGL o con
  `?escena=2d`, se juega con la ilustración de V2.
- Con movimiento reducido, el 3D enseña directamente el desenlace.

### Interfaz de la V3

Todo el juego va en un bloque «estadio de noche» (tema oscuro del DS con
`data-theme="dark"`), a juego con la escena 3D. En escritorio el penalti ocupa dos
columnas y cabe en una pantalla de portátil; en móvil el bloque ocupa todo el ancho.
La portada explica con una portería cómo cada respuesta es una esquina, y el
resultado se presenta como el grafismo de un final de partido (Tú 4 – 1 Portero).
