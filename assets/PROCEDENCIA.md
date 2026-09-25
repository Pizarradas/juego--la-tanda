# Procedencia y licencias · assets de la V3

| Archivo | Qué es | Origen | Licencia | Notas |
| --- | --- | --- | --- | --- |
| `3d/jugador.glb` | Personaje humanoide low-poly, 31 huesos, 11 clips (Idle, Run, Jump, Clapping, Death…) y materiales separados (Shirt, Shirt2, Pants, Socks, Shoes, Skin, Hair) | Quaternius, obtenido del repositorio [kendrekaran/striker-3d](https://github.com/kendrekaran/striker-3d) (`assets/player.glb`), que incluye `assets/LICENSE-quaternius.txt` | CC0 1.0 (Quaternius) | Sin cambios. Del repo solo se usa este asset: el código de striker-3d no declara licencia y no se ha reutilizado. No trae patada ni estirada; esos clips se generan en `penaltis-V3.escena.js` sobre el mismo esqueleto. |
| `vendor/three-penaltis.min.js` | three.js r186 con GLTFLoader y SkeletonUtils.clone, solo las clases que usa la escena | Paquete npm `three@0.186.1`, empaquetado con esbuild desde `vendor/three-penaltis.entrada.js` | MIT (© three.js authors) | La cabecera de licencia va al final del archivo. |
| GSAP | — | — | — | No se usa: la jugada es una función del tiempo y la coordina la propia escena (así la repetición no necesita grabar nada). |

Portería, red, balón, césped, gradas, público, vallas y focos son geometría y texturas generadas en código (`penaltis-V3.escena.js`); no hay más archivos.

Candidatos del brief que no se pudieron descargar desde el entorno de trabajo (red bloqueada): Quaternius Ultimate Modular Men, portería y pack de estadio de 3dassets.dev y balón de dLeom (itch.io). Si se incorporan más adelante, añadir aquí su fila.
