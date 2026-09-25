/* ==========================================================
   POC Tanda de penaltis V2 — motor del juego
   ----------------------------------------------------------
   Misma mecánica que V1 (respuesta = esquina; el balón SIEMPRE
   va a la esquina elegida y solo cambia hacia dónde se tira el
   portero). Cambios V2, todos de UX/UI:

   - El foco nunca desplaza la página (preventScroll): el gol y
     la parada se ven enteros. «Siguiente» va pegado abajo.
   - Al empezar cada penalti, si las opciones no caben en
     pantalla, se sube el bloque de juego.
   - Marcador «Tú N – N Portero» además de los cinco tiros.
   - Tras el tiro: icono ✓/✕ en las opciones y solo el dato
     debajo (el «¡Gol!» ya lo cuenta la escena).
   - Escena: trayectoria prevista al apuntar, estela del balón,
     red que se hunde en el punto de impacto, onda, destello y
     grada que salta en el gol. Vibración corta en móvil.
   - Resultado: tarjeta, compartir nativo en móvil (copia en
     escritorio), repaso plegable y cuenta atrás a la próxima.
   - Al volver a una tanda a medias se enseña el progreso.

   Con prefers-reduced-motion la escena salta al estado final y
   no hay destello, estela, onda ni vibración.
========================================================== */
(function (global) {
  'use strict';

  var ESQUINAS = ['A', 'B', 'C', 'D'];
  var NOMBRE_ESQUINA = {
    A: 'arriba a la izquierda',
    B: 'arriba a la derecha',
    C: 'abajo a la izquierda',
    D: 'abajo a la derecha'
  };
  var TIROS_POR_TANDA = 5;
  /* V2 guarda aparte para poder comparar con V1 en el mismo navegador. */
  var PREFIJO_CLAVE = 'penaltis:v2:';
  var PANTALLA = 'penaltis-V2.html';

  /* Coordenadas del SVG (viewBox 360x260). El balón sale del
     punto de penalti (180,216) hacia el centro de cada diana. */
  var ORIGEN = { x: 180, y: 216 };
  var DIANA = {
    A: { x: 92, y: 66 },
    B: { x: 268, y: 66 },
    C: { x: 92, y: 124 },
    D: { x: 268, y: 124 }
  };
  var DESTINO_BALON = {};
  ESQUINAS.forEach(function (e) {
    DESTINO_BALON[e] = { x: DIANA[e].x - ORIGEN.x, y: DIANA[e].y - ORIGEN.y };
  });

  /* Estiradas del portero, con el origen en sus pies. */
  var ESTIRADA = {
    A: 'translate(-40px, -30px) rotate(-55deg)',
    B: 'translate(40px, -30px) rotate(55deg)',
    C: 'translate(-38px, -4px) rotate(-80deg)',
    D: 'translate(38px, -4px) rotate(80deg)',
    centro: 'translate(0px, -10px)'
  };

  var FRASES = [
    'El portero te ha leído todas. Mañana, revancha.',
    'Hoy mandaba el portero.',
    'El portero ha tenido un buen día.',
    'Tanda ganada, pero con sufrimiento.',
    'Casi perfecto: solo se te escapó uno.',
    'Pleno. Hoy no te para nadie.'
  ];

  var estado = {
    tanda: null,
    indice: 0,
    tiros: [],            /* { elegida, correcta, gol } */
    respondida: false,
    guardar: true,        /* los estados de demostración no tocan el almacenamiento */
    animaciones: [],
    cuenta: null
  };

  var dom = {};
  var reducirMovimiento = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var tactil = global.matchMedia &&
    global.matchMedia('(hover: none) and (pointer: coarse)').matches;

  /* ==========================================================
     UTILIDADES
  ========================================================== */
  function $(id) { return document.getElementById(id); }

  function iso(d) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }

  function hoyISO() { return iso(new Date()); }

  function diaAnterior(fecha) {
    var p = fecha.split('-').map(Number);
    return iso(new Date(p[0], p[1] - 1, p[2] - 1));
  }

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function fechaLarga(f) {
    var p = String(f).split('-');
    return Number(p[2]) + ' de ' + MESES[Number(p[1]) - 1];
  }

  function fechaCorta(f) {
    var p = String(f).split('-');
    return Number(p[2]) + ' ' + MESES[Number(p[1]) - 1].slice(0, 3);
  }

  function leer(clave) {
    try {
      var bruto = global.localStorage.getItem(PREFIJO_CLAVE + clave);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) { return null; }
  }

  function escribir(clave, valor) {
    if (!estado.guardar) { return; }
    try { global.localStorage.setItem(PREFIJO_CLAVE + clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento */ }
  }

  function borrarTodo() {
    try {
      Object.keys(global.localStorage)
        .filter(function (k) { return k.indexOf(PREFIJO_CLAVE) === 0; })
        .forEach(function (k) { global.localStorage.removeItem(k); });
    } catch (e) { /* sin almacenamiento */ }
  }

  function esperar(ms) {
    return new Promise(function (resolver) { setTimeout(resolver, ms); });
  }

  function contar(tiros) {
    var goles = tiros.filter(function (t) { return t && t.gol; }).length;
    var tirados = tiros.filter(Boolean).length;
    return { goles: goles, paradas: tirados - goles, tirados: tirados };
  }

  /* V2: enfocar sin mover la página. */
  function enfocar(el) {
    if (!el) { return; }
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }

  function vibrar(patron) {
    if (reducirMovimiento || !navigator.vibrate) { return; }
    try { navigator.vibrate(patron); } catch (e) { /* sin vibración */ }
  }

  /* ==========================================================
     VALIDADOR DE LA TANDA
  ========================================================== */
  function validar(tanda) {
    var errores = [];
    if (!tanda || !Array.isArray(tanda.preguntas)) {
      return ['La tanda no tiene lista de preguntas.'];
    }
    if (tanda.preguntas.length !== TIROS_POR_TANDA) {
      errores.push('Tiene ' + tanda.preguntas.length + ' preguntas y deben ser ' + TIROS_POR_TANDA + '.');
    }
    tanda.preguntas.forEach(function (p, i) {
      var n = 'Pregunta ' + (i + 1) + ': ';
      if (!p.pregunta || !String(p.pregunta).trim()) { errores.push(n + 'falta el enunciado.'); }
      if (!Array.isArray(p.opciones) || p.opciones.length !== 4) {
        errores.push(n + 'necesita exactamente cuatro opciones, una por esquina.');
      } else {
        var vistas = {};
        p.opciones.forEach(function (o, j) {
          var clave = String(o || '').trim().toLowerCase();
          if (!clave) { errores.push(n + 'la opción ' + ESQUINAS[j] + ' está vacía.'); }
          if (vistas[clave]) { errores.push(n + 'la opción ' + ESQUINAS[j] + ' está repetida.'); }
          vistas[clave] = true;
        });
      }
      if (!Number.isInteger(p.correcta) || p.correcta < 0 || p.correcta > 3) {
        errores.push(n + 'la respuesta correcta tiene que ser A, B, C o D.');
      }
      if (!p.dato || !String(p.dato).trim()) { errores.push(n + 'falta el dato que se muestra tras el tiro.'); }
    });
    return errores;
  }

  /* ==========================================================
     VISTAS
  ========================================================== */
  var VISTAS = ['cargando', 'error', 'vacio', 'entrada', 'juego', 'resultado'];

  function mostrar(vista, foco) {
    VISTAS.forEach(function (v) { $('poc-vista-' + v).hidden = v !== vista; });
    document.body.setAttribute('data-poc-vista', vista);
    if (vista !== 'juego') { dom.accionesJuego.hidden = true; }
    if (foco) {
      var el = typeof foco === 'string' ? $(foco) : foco;
      enfocar(el);
    }
  }

  function avisar(texto) {
    dom.aviso.textContent = texto || '';
    dom.aviso.hidden = !texto;
  }

  /* ==========================================================
     MARCADOR
  ========================================================== */
  function pintarTanda(lista, tiros, actual) {
    lista.innerHTML = '';
    for (var i = 0; i < TIROS_POR_TANDA; i++) {
      var tiro = tiros[i];
      var li = document.createElement('li');
      li.className = 'poc-tanda__tiro';
      var texto;
      if (tiro) {
        li.setAttribute('data-poc-tiro', tiro.gol ? 'gol' : 'parada');
        li.innerHTML = '<span aria-hidden="true">' + (tiro.gol ? '✓' : '✕') + '</span>';
        texto = 'Penalti ' + (i + 1) + ': ' + (tiro.gol ? 'gol' : 'parada');
      } else if (i === actual) {
        li.setAttribute('data-poc-tiro', 'actual');
        texto = 'Penalti ' + (i + 1) + ': en juego';
      } else {
        li.setAttribute('data-poc-tiro', 'pendiente');
        texto = 'Penalti ' + (i + 1) + ': pendiente';
      }
      var sr = document.createElement('span');
      sr.className = 'poc-sr';
      sr.textContent = texto;
      li.appendChild(sr);
      lista.appendChild(li);
    }
  }

  function pintarMarcador(animarCambio) {
    var c = contar(estado.tiros);
    [[dom.goles, c.goles], [dom.paradas, c.paradas]].forEach(function (par) {
      var el = par[0];
      var nuevo = String(par[1]);
      if (el.textContent !== nuevo) {
        el.textContent = nuevo;
        if (animarCambio && !reducirMovimiento) {
          el.classList.remove('is-sube');
          void el.offsetWidth;
          el.classList.add('is-sube');
        }
      }
    });
  }

  /* ==========================================================
     ESCENA
  ========================================================== */
  function animar(el, fotogramas, opciones) {
    var dur = reducirMovimiento ? 0 : opciones.duration;
    var a = el.animate(fotogramas, Object.assign({ fill: 'forwards' }, opciones, { duration: dur }));
    estado.animaciones.push(a);
    /* Red de seguridad: si el navegador no avanza la animación
       (pestaña en segundo plano, ahorro de energía), se fuerza el
       estado final para que la partida nunca se quede bloqueada. */
    var seguro = esperar(dur + (opciones.delay || 0) + 250).then(function () {
      if (a.playState !== 'finished' && a.playState !== 'idle') { a.finish(); }
    });
    return Promise.race([a.finished, seguro]).catch(function () { /* cancelada */ });
  }

  function reiniciarEscena() {
    estado.animaciones.forEach(function (a) { a.cancel(); });
    estado.animaciones = [];
    dom.rotulo.classList.remove('is-visible');
    dom.rotulo.removeAttribute('data-poc-resultado');
    dom.trayectoria.classList.remove('is-visible');
    document.querySelectorAll('.poc-diana').forEach(function (d) {
      d.classList.remove('is-apuntada', 'is-correcta', 'is-fallada');
    });
  }

  function diana(esquina) {
    return document.querySelector('[data-poc-diana="' + esquina + '"]');
  }

  /* V2: la trayectoria es una curva suave del punto de penalti a la diana. */
  function curva(esquina) {
    var d = DIANA[esquina];
    var cx = (ORIGEN.x + d.x) / 2;
    var cy = Math.min(ORIGEN.y, d.y) - 10;
    return 'M' + ORIGEN.x + ' ' + (ORIGEN.y - 8) + ' Q' + cx + ' ' + cy + ' ' + d.x + ' ' + d.y;
  }

  function apuntar(esquina, activo) {
    if (estado.respondida) { return; }
    var d = diana(esquina);
    if (d) { d.classList.toggle('is-apuntada', activo); }
    if (activo) {
      dom.trayectoria.setAttribute('d', curva(esquina));
      dom.trayectoria.classList.add('is-visible');
    } else {
      dom.trayectoria.classList.remove('is-visible');
    }
  }

  function celebrar(esquina) {
    if (reducirMovimiento) { return Promise.resolve(); }
    var d = DIANA[esquina];
    /* Onda en el punto de impacto */
    dom.impacto.setAttribute('cx', d.x);
    dom.impacto.setAttribute('cy', d.y);
    var onda = animar(dom.impacto, [
      { transform: 'scale(0.6)', opacity: 0.9 },
      { transform: 'scale(2.2)', opacity: 0 }
    ], { duration: 520, easing: 'ease-out' });
    /* Destello centrado en la esquina */
    dom.destello.style.setProperty('--poc-destello-x', (d.x / 360 * 100) + '%');
    dom.destello.style.setProperty('--poc-destello-y', (d.y / 260 * 100) + '%');
    animar(dom.destello, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }],
      { duration: 600, easing: 'ease-out' });
    /* La grada salta dos veces */
    animar(dom.grada, [
      { transform: 'translateY(0)' },
      { transform: 'translateY(-5px)', offset: 0.25 },
      { transform: 'translateY(0)', offset: 0.5 },
      { transform: 'translateY(-4px)', offset: 0.75 },
      { transform: 'translateY(0)' }
    ], { duration: 700, easing: 'ease-in-out' });
    return onda;
  }

  /* Devuelve una promesa que se resuelve al terminar el tiro. */
  function chutar(esquina, gol) {
    var destino = DESTINO_BALON[esquina];
    var estirada;
    if (gol) {
      /* El portero adivina mal: se tira a otra esquina o se queda en el centro. */
      var otras = ESQUINAS.filter(function (e) { return e !== esquina; }).concat('centro');
      estirada = otras[Math.floor(Math.random() * otras.length)];
    } else {
      estirada = esquina;
    }

    var carrera = animar(dom.lanzador, [
      { transform: 'translate(0, 0)' },
      { transform: 'translate(16px, -12px)' },
      { transform: 'translate(22px, -18px) rotate(6deg)' }
    ], { duration: 320, easing: 'ease-in' });

    return carrera.then(function () {
      var fotogramas;
      var opciones;
      if (gol) {
        fotogramas = [
          { transform: 'translate(0, 0) scale(1)' },
          { transform: 'translate(' + destino.x + 'px, ' + destino.y + 'px) scale(0.62)' }
        ];
        opciones = { duration: 480, easing: 'cubic-bezier(.2,.7,.4,1)' };
      } else {
        /* Llega casi a la esquina, el portero la toca y sale rechazada. */
        var rebote = { x: Math.round(destino.x * 0.35), y: Math.round(destino.y * 0.25) };
        fotogramas = [
          { transform: 'translate(0, 0) scale(1)', offset: 0 },
          { transform: 'translate(' + Math.round(destino.x * 0.9) + 'px, ' + Math.round(destino.y * 0.9) + 'px) scale(0.66)', offset: 0.55 },
          { transform: 'translate(' + rebote.x + 'px, ' + rebote.y + 'px) scale(0.9)', offset: 1 }
        ];
        opciones = { duration: 820, easing: 'ease-out' };
      }

      var vuelo = animar(dom.balon, fotogramas, opciones);

      /* V2: estela — dos copias que siguen al balón con retraso y se apagan */
      if (!reducirMovimiento) {
        dom.estelas.forEach(function (el, i) {
          var retraso = (i + 1) * 45;
          animar(el, fotogramas, Object.assign({}, opciones, { delay: retraso, fill: 'none' }));
          animar(el, [{ opacity: 0.4 - i * 0.15 }, { opacity: 0 }],
            { duration: opciones.duration * 0.7, delay: retraso, easing: 'ease-in', fill: 'none' });
        });
      }

      if (gol) {
        vuelo = vuelo.then(function () {
          var d = DIANA[esquina];
          dom.red.style.transformOrigin = d.x + 'px ' + d.y + 'px';
          /* La celebración sigue sola: no retrasa el veredicto. */
          celebrar(esquina);
          return animar(dom.red, [
            { transform: 'scale(1, 1)' },
            { transform: 'scale(1.03, 1.06)' },
            { transform: 'scale(1, 1)' }
          ], { duration: 360, easing: 'ease-out' });
        });
      }

      var tirada = esperar(reducirMovimiento ? 0 : 80).then(function () {
        return animar(dom.portero, [
          { transform: 'translate(0, 0) rotate(0deg)' },
          { transform: ESTIRADA[estirada] }
        ], { duration: 420, easing: 'cubic-bezier(.3,.8,.4,1)' });
      });
      return Promise.all([vuelo, tirada]);
    });
  }

  function mostrarRotulo(gol) {
    dom.rotulo.textContent = gol ? '¡Gol!' : '¡Parada!';
    dom.rotulo.setAttribute('data-poc-resultado', gol ? 'gol' : 'parada');
    dom.rotulo.classList.add('is-visible');
  }

  /* ==========================================================
     OPCIONES
  ========================================================== */
  function pintarOpciones(pregunta) {
    dom.opciones.innerHTML = '';
    pregunta.opciones.forEach(function (texto, i) {
      var esquina = ESQUINAS[i];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'poc-opcion';
      b.setAttribute('data-poc-esquina', esquina);
      b.innerHTML =
        '<span class="poc-opcion__letra" aria-hidden="true">' + esquina + '</span>' +
        '<span class="poc-opcion__texto"></span>';
      b.querySelector('.poc-opcion__texto').textContent = texto;
      var sr = document.createElement('span');
      sr.className = 'poc-sr';
      sr.textContent = 'Opción ' + esquina + ', ' + NOMBRE_ESQUINA[esquina] + ': ';
      b.insertBefore(sr, b.firstChild);

      b.addEventListener('click', function () { responder(i); });
      b.addEventListener('mouseenter', function () { apuntar(esquina, true); });
      b.addEventListener('mouseleave', function () { apuntar(esquina, false); });
      b.addEventListener('focus', function () { apuntar(esquina, true); });
      b.addEventListener('blur', function () { apuntar(esquina, false); });
      b.addEventListener('keydown', moverFoco);
      dom.opciones.appendChild(b);
    });
  }

  /* Flechas en rejilla 2x2: izquierda/derecha cambian de columna,
     arriba/abajo cambian de fila, igual que en la portería. */
  function moverFoco(e) {
    var botones = Array.prototype.slice.call(dom.opciones.querySelectorAll('.poc-opcion'));
    var i = botones.indexOf(e.currentTarget);
    var destino = null;
    if (e.key === 'ArrowRight' && i % 2 === 0) { destino = i + 1; }
    if (e.key === 'ArrowLeft' && i % 2 === 1) { destino = i - 1; }
    if (e.key === 'ArrowDown' && i < 2) { destino = i + 2; }
    if (e.key === 'ArrowUp' && i >= 2) { destino = i - 2; }
    if (destino !== null) {
      e.preventDefault();
      botones[destino].focus();
    }
  }

  /* V2: insignia ✓/✕ sobre la letra + texto solo para lector. */
  function marcarOpciones(elegida, correcta) {
    var botones = dom.opciones.querySelectorAll('.poc-opcion');
    botones.forEach(function (b, i) {
      b.setAttribute('aria-disabled', 'true');
      var icono = null;
      var etiqueta = null;
      if (i === correcta) {
        b.classList.add('is-correcta');
        icono = '✓';
        etiqueta = i === elegida ? ' (correcta, tu respuesta)' : ' (correcta)';
      } else if (i === elegida) {
        b.classList.add('is-fallada');
        icono = '✕';
        etiqueta = ' (tu respuesta, incorrecta)';
      } else {
        b.classList.add('is-apagada');
      }
      if (icono) {
        var s = document.createElement('span');
        s.className = 'poc-opcion__icono';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = icono;
        b.querySelector('.poc-opcion__letra').appendChild(s);
        var sr = document.createElement('span');
        sr.className = 'poc-sr';
        sr.textContent = etiqueta;
        b.appendChild(sr);
      }
    });
    diana(ESQUINAS[correcta]).classList.add('is-correcta');
    if (elegida !== correcta) { diana(ESQUINAS[elegida]).classList.add('is-fallada'); }
  }

  /* ==========================================================
     FLUJO DEL PENALTI
  ========================================================== */

  /* V2: si las opciones no caben en pantalla, sube el bloque de juego
     para que marcador, pregunta, escena y respuestas se vean juntos. */
  function encuadrar() {
    var vista = $('poc-vista-juego');
    var abajo = dom.opciones.getBoundingClientRect().bottom;
    var arriba = vista.getBoundingClientRect().top;
    if (abajo > global.innerHeight || arriba < 0) {
      var y = global.scrollY + arriba - 12;
      global.scrollTo({ top: Math.max(0, y), behavior: reducirMovimiento ? 'auto' : 'smooth' });
    }
  }

  function prepararTiro() {
    var p = estado.tanda.preguntas[estado.indice];
    estado.respondida = false;
    reiniciarEscena();

    dom.numeroTiro.textContent = 'Penalti ' + (estado.indice + 1) + ' de ' + TIROS_POR_TANDA;
    pintarTanda(dom.tanda, estado.tiros, estado.indice);
    pintarMarcador(false);
    dom.preguntaTexto.textContent = p.pregunta;
    pintarOpciones(p);

    dom.veredicto.hidden = true;
    dom.anuncio.textContent = '';
    dom.veredicto.removeAttribute('data-poc-resultado');
    dom.accionesJuego.hidden = true;
    dom.ayuda.hidden = false;
  }

  function responder(elegida, instantaneo) {
    if (estado.respondida) { return; }
    estado.respondida = true;

    var p = estado.tanda.preguntas[estado.indice];
    var gol = elegida === p.correcta;
    var esquina = ESQUINAS[elegida];

    dom.opciones.setAttribute('aria-busy', 'true');
    dom.opciones.querySelectorAll('.poc-opcion').forEach(function (b, i) {
      b.setAttribute('aria-disabled', 'true');
      if (i !== elegida) { b.classList.add('is-apagada'); }
    });
    document.querySelectorAll('.poc-diana').forEach(function (d) { d.classList.remove('is-apuntada'); });
    diana(esquina).classList.add('is-apuntada');
    dom.trayectoria.classList.remove('is-visible');
    dom.ayuda.hidden = true;

    var antes = reducirMovimiento;
    if (instantaneo) { reducirMovimiento = true; }

    return chutar(esquina, gol).then(function () {
      reducirMovimiento = antes;
      dom.opciones.removeAttribute('aria-busy');
      diana(esquina).classList.remove('is-apuntada');
      dom.opciones.querySelectorAll('.poc-opcion').forEach(function (b) { b.classList.remove('is-apagada'); });
      mostrarRotulo(gol);
      marcarOpciones(elegida, p.correcta);
      if (!instantaneo) { vibrar(gol ? [25, 40, 25] : 60); }

      estado.tiros[estado.indice] = { elegida: elegida, correcta: p.correcta, gol: gol };
      pintarTanda(dom.tanda, estado.tiros, -1);
      pintarMarcador(!instantaneo);
      guardarProgreso(false);

      var correcta = ESQUINAS[p.correcta] + ', ' + p.opciones[p.correcta];
      /* V2: el titular del veredicto solo existe en la parada (dice cuál era);
         en el gol la escena y el ✓ ya lo cuentan. */
      dom.veredictoTitulo.textContent = gol ? '' : 'La correcta era la ' + correcta + '.';
      dom.veredictoTitulo.hidden = gol;
      dom.veredictoDato.textContent = p.dato;
      dom.veredicto.setAttribute('data-poc-resultado', gol ? 'gol' : 'parada');
      dom.veredicto.hidden = false;
      dom.anuncio.textContent = (gol
        ? '¡Gol! ' + correcta + ' es la respuesta correcta.'
        : '¡Parada! La correcta era la ' + correcta + '.') + ' ' + p.dato;

      var ultimo = estado.indice === TIROS_POR_TANDA - 1;
      dom.siguiente.textContent = ultimo ? 'Ver resultado' : 'Siguiente penalti';
      dom.accionesJuego.hidden = false;
      enfocar(dom.siguiente);
    });
  }

  function siguiente() {
    if (estado.indice < TIROS_POR_TANDA - 1) {
      estado.indice += 1;
      prepararTiro();
      enfocar(dom.pregunta);
      encuadrar();
    } else {
      guardarProgreso(true);
      pintarResultado(false);
      global.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  function guardarProgreso(completada) {
    escribir(estado.tanda.fecha, { tiros: estado.tiros, completada: completada });
  }

  /* ==========================================================
     RESULTADO
  ========================================================== */
  function urlCompartir() {
    return global.location.origin + global.location.pathname;
  }

  function textoCompartir() {
    var c = contar(estado.tiros);
    var linea = estado.tiros.map(function (t) { return t.gol ? '⚽' : '🧤'; }).join('');
    return 'Tanda de penaltis #' + estado.tanda.numero + ' · ' + fechaCorta(estado.tanda.fecha) + '\n' +
      linea + '  ' + c.goles + '/' + TIROS_POR_TANDA + '\n' + urlCompartir();
  }

  function textoCuenta() {
    var ahora = new Date();
    var manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
    var min = Math.max(1, Math.ceil((manana - ahora) / 60000));
    var h = Math.floor(min / 60);
    var m = min % 60;
    return 'Nueva tanda en ' + (h ? h + ' h ' : '') + m + ' min.';
  }

  function pintarResultado(yaJugada) {
    var c = contar(estado.tiros);
    $('poc-resultado-previo').hidden = !yaJugada;
    $('poc-tarjeta-antetitulo').textContent = 'Tanda #' + estado.tanda.numero + ' · ' + fechaLarga(estado.tanda.fecha);
    var titulo = $('poc-resultado-titulo');
    titulo.innerHTML = '';
    titulo.appendChild(document.createTextNode(String(c.goles)));
    var de = document.createElement('small');
    de.textContent = ' / ' + TIROS_POR_TANDA;
    titulo.appendChild(de);
    titulo.setAttribute('aria-label', 'Has marcado ' + c.goles + ' de ' + TIROS_POR_TANDA);
    $('poc-resultado-frase').textContent = FRASES[c.goles];
    pintarTanda($('poc-resultado-tanda'), estado.tiros, -1);
    $('poc-compartir-salida').value = textoCompartir();
    $('poc-compartir-manual').hidden = true;
    $('poc-compartir-estado').textContent = '';
    $('poc-compartir').textContent = tactil && navigator.share ? 'Compartir resultado' : 'Copiar resultado';

    var repaso = $('poc-repaso');
    repaso.innerHTML = '';
    estado.tanda.preguntas.forEach(function (p, i) {
      var t = estado.tiros[i];
      var li = document.createElement('li');
      var marca = document.createElement('span');
      marca.className = 'poc-repaso__marca';
      marca.setAttribute('data-poc-resultado', t.gol ? 'gol' : 'parada');
      marca.innerHTML = '<span aria-hidden="true">' + (t.gol ? '✓' : '✕') + '</span>';
      var srm = document.createElement('span');
      srm.className = 'poc-sr';
      srm.textContent = t.gol ? 'Gol. ' : 'Parada. ';
      marca.appendChild(srm);
      li.appendChild(marca);
      var q = document.createElement('span');
      q.textContent = p.pregunta;
      li.appendChild(q);
      var r = document.createElement('span');
      r.className = 'poc-repaso__respuesta';
      var fuerte = document.createElement('strong');
      fuerte.textContent = ESQUINAS[p.correcta] + ', ' + p.opciones[p.correcta] + '.';
      r.appendChild(fuerte);
      if (!t.gol) {
        r.appendChild(document.createTextNode(' Elegiste ' + ESQUINAS[t.elegida] + ', ' + p.opciones[t.elegida] + '.'));
      }
      li.appendChild(r);
      repaso.appendChild(li);
    });
    $('poc-repaso-resumen').textContent = c.goles + ' goles, ' + c.paradas + (c.paradas === 1 ? ' parada' : ' paradas');

    var ayer = diaAnterior(estado.tanda.fecha);
    var hayAyer = global.pocPenaltisTandas.some(function (x) { return x.fecha === ayer; });
    var enlace = $('poc-enlace-ayer');
    enlace.hidden = !hayAyer;
    enlace.href = PANTALLA + '?fecha=' + ayer;

    /* Cuenta atrás por minutos: sin región viva, para no anunciar cada cambio. */
    var cuenta = $('poc-cuenta');
    cuenta.textContent = textoCuenta();
    if (estado.cuenta) { clearInterval(estado.cuenta); }
    estado.cuenta = setInterval(function () { cuenta.textContent = textoCuenta(); }, 30000);

    mostrar('resultado', 'poc-resultado-titulo');
  }

  function copiaManual(mensaje) {
    var salida = $('poc-compartir-salida');
    $('poc-compartir-manual').hidden = false;
    salida.focus();
    salida.select();
    $('poc-compartir-estado').textContent = mensaje;
  }

  function compartir() {
    var texto = textoCompartir();
    var estadoEl = $('poc-compartir-estado');
    var copiar = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(function () {
          estadoEl.textContent = 'Resultado copiado. Pégalo donde quieras.';
        }, function () {
          copiaManual('No se pudo copiar solo: el texto está seleccionado, cópialo a mano.');
        });
      } else {
        copiaManual('No se pudo copiar solo: el texto está seleccionado, cópialo a mano.');
      }
    };
    /* En móvil, la hoja de compartir del sistema; en escritorio, copiar. */
    if (tactil && navigator.share) {
      navigator.share({ text: texto }).then(function () {
        estadoEl.textContent = 'Resultado compartido.';
      }, function (e) {
        if (e && e.name === 'AbortError') { return; }
        copiar();
      });
    } else {
      copiar();
    }
  }

  /* ==========================================================
     TECLADO GLOBAL: A-D y 1-4 chutan
  ========================================================== */
  function teclaGlobal(e) {
    if ($('poc-vista-juego').hidden || estado.respondida) { return; }
    if (e.ctrlKey || e.metaKey || e.altKey) { return; }
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') { return; }
    var mapa = { a: 0, b: 1, c: 2, d: 3, '1': 0, '2': 1, '3': 2, '4': 3 };
    var i = mapa[String(e.key).toLowerCase()];
    if (i === undefined) { return; }
    e.preventDefault();
    var boton = dom.opciones.querySelectorAll('.poc-opcion')[i];
    if (boton) { enfocar(boton); }
    responder(i);
  }

  /* ==========================================================
     ARRANQUE
  ========================================================== */
  function cargarTanda(fecha) {
    /* En producción: fetch('data/' + fecha + '.json'). Aquí simula la red. */
    return esperar(700).then(function () {
      var tandas = global.pocPenaltisTandas || [];
      if (!tandas.length) { return { tanda: null }; }
      var exacta = tandas.filter(function (t) { return t.fecha === fecha; })[0];
      if (exacta) { return { tanda: exacta }; }
      return { tanda: tandas[0], demo: true };
    });
  }

  function empezar(desdeCero) {
    if (desdeCero) {
      estado.indice = 0;
      estado.tiros = [];
    }
    mostrar('juego');
    prepararTiro();
    enfocar(dom.pregunta);
    encuadrar();
  }

  /* V2: al volver a una tanda a medias se enseña cómo ibas. */
  function pintarEntrada(guardado) {
    $('poc-entrada-numero').textContent = '#' + estado.tanda.numero;
    $('poc-entrada-fecha').textContent = fechaLarga(estado.tanda.fecha);
    var seguir = guardado && guardado.tiros && guardado.tiros.length && !guardado.completada;
    var progreso = $('poc-progreso');
    progreso.hidden = !seguir;
    if (seguir) {
      var c = contar(guardado.tiros);
      var quedan = TIROS_POR_TANDA - c.tirados;
      pintarTanda($('poc-progreso-tanda'), guardado.tiros, c.tirados);
      $('poc-progreso-texto').textContent = 'Vas ' + c.goles + ' – ' + c.paradas + ' contra el portero. ' +
        (quedan === 1 ? 'Te queda un penalti.' : 'Te quedan ' + quedan + ' penaltis.');
    }
    dom.empezar.textContent = seguir
      ? 'Seguir con el penalti ' + (guardado.tiros.length + 1)
      : 'Empezar la tanda';
    dom.empezar.onclick = function () {
      if (seguir) {
        estado.tiros = guardado.tiros.slice();
        estado.indice = guardado.tiros.length;
        empezar(false);
      } else {
        empezar(true);
      }
    };
    mostrar('entrada');
  }

  function arrancar() {
    dom.aviso = $('poc-aviso');
    dom.opciones = $('poc-opciones');
    dom.pregunta = $('poc-pregunta');
    dom.preguntaTexto = $('poc-pregunta-texto');
    dom.numeroTiro = $('poc-numero-tiro');
    dom.tanda = $('poc-tanda');
    dom.goles = $('poc-goles');
    dom.paradas = $('poc-paradas');
    dom.veredicto = $('poc-veredicto');
    dom.anuncio = $('poc-anuncio');
    dom.veredictoTitulo = $('poc-veredicto-titulo');
    dom.veredictoDato = $('poc-veredicto-dato');
    dom.siguiente = $('poc-siguiente');
    dom.accionesJuego = $('poc-acciones-juego');
    dom.ayuda = $('poc-ayuda-teclado');
    dom.empezar = $('poc-empezar');
    dom.rotulo = $('poc-rotulo');
    dom.portero = $('poc-portero');
    dom.balon = $('poc-balon');
    dom.estelas = Array.prototype.slice.call(document.querySelectorAll('.poc-balon--estela'));
    dom.lanzador = $('poc-lanzador');
    dom.red = $('poc-red');
    dom.grada = $('poc-grada-puntos');
    dom.trayectoria = $('poc-trayectoria');
    dom.impacto = $('poc-impacto');
    dom.destello = $('poc-destello');

    dom.siguiente.addEventListener('click', siguiente);
    $('poc-compartir').addEventListener('click', compartir);
    document.addEventListener('keydown', teclaGlobal);

    var params = new URLSearchParams(global.location.search);
    var demo = params.get('estado');
    var fecha = params.get('fecha') || hoyISO();
    if (params.get('reiniciar')) { borrarTodo(); }
    estado.guardar = !demo;

    if (demo === 'cargando') { return; }
    if (demo === 'vacio') { mostrar('vacio', $('poc-vista-vacio').querySelector('h2')); return; }

    cargarTanda(fecha).then(function (r) {
      if (!r.tanda) { mostrar('vacio', $('poc-vista-vacio').querySelector('h2')); return; }

      var tanda = r.tanda;
      if (demo === 'error') {
        /* Tanda rota a propósito para enseñar el validador. */
        tanda = JSON.parse(JSON.stringify(r.tanda));
        tanda.preguntas.pop();
        tanda.preguntas[1].opciones.pop();
        tanda.preguntas[2].correcta = 5;
      }

      var errores = validar(tanda);
      if (errores.length) {
        var ul = $('poc-error-detalle');
        ul.innerHTML = '';
        errores.forEach(function (t) {
          var li = document.createElement('li');
          li.textContent = t;
          ul.appendChild(li);
        });
        mostrar('error', $('poc-vista-error').querySelector('h2'));
        return;
      }

      estado.tanda = tanda;
      if (r.demo) {
        avisar('No hay tanda para el ' + fechaLarga(fecha) + '. Juegas la de demostración del ' + fechaLarga(tanda.fecha) + '.');
      }

      var demoTiros = function (n) {
        return tanda.preguntas.slice(0, n).map(function (p, i) {
          var gol = i !== 2;
          return { elegida: gol ? p.correcta : (p.correcta + 1) % 4, correcta: p.correcta, gol: gol };
        });
      };

      if (demo === 'entrada') { pintarEntrada(null); return; }
      if (demo === 'seguir') { pintarEntrada({ tiros: demoTiros(3), completada: false }); return; }
      if (demo === 'juego') { empezar(true); return; }
      if (demo === 'gol' || demo === 'parada') {
        empezar(true);
        var correcta = tanda.preguntas[0].correcta;
        responder(demo === 'gol' ? correcta : (correcta + 1) % 4, true);
        return;
      }
      if (demo === 'resultado' || demo === 'jugado') {
        estado.tiros = demoTiros(TIROS_POR_TANDA);
        pintarResultado(demo === 'jugado');
        return;
      }

      var guardado = leer(tanda.fecha);
      if (guardado && guardado.completada && guardado.tiros.length === TIROS_POR_TANDA) {
        estado.tiros = guardado.tiros;
        pintarResultado(true);
        return;
      }
      pintarEntrada(guardado);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }

  /* Expuesto solo para pruebas automatizadas del POC. */
  global.pocPenaltis = { validar: validar, estado: estado };
}(window));
