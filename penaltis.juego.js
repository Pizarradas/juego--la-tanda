/* ==========================================================
   POC Tanda de penaltis — motor del juego
   ----------------------------------------------------------
   Cinco preguntas con cuatro opciones. Cada opción es una
   esquina de la portería (A arriba izq., B arriba der.,
   C abajo izq., D abajo der.). Al elegir, el lanzador chuta a
   esa esquina: si la respuesta es correcta el portero se tira
   al lado contrario y es gol; si no, se tira a esa esquina y
   la para.

   El balón SIEMPRE va a la esquina elegida. Así el resultado
   depende solo de la respuesta y nunca parece un fallo de
   puntería: esa es la suposición de producto que valida el POC.

   Animación con Web Animations API sobre el SVG de la escena.
   Con prefers-reduced-motion la escena salta al estado final.
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
  var PREFIJO_CLAVE = 'penaltis:v1:';

  /* Coordenadas del SVG (viewBox 360x260). El balón sale del
     punto de penalti (180,216) hacia el centro de cada diana. */
  var DESTINO_BALON = {
    A: { x: -88, y: -150 },
    B: { x: 88, y: -150 },
    C: { x: -88, y: -92 },
    D: { x: 88, y: -92 }
  };

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
    animaciones: []
  };

  var dom = {};
  var reducirMovimiento = global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ==========================================================
     UTILIDADES
  ========================================================== */
  function $(id) { return document.getElementById(id); }

  function hoyISO() {
    var d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }

  function diaAnterior(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2] - 1);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
  }

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function fechaLarga(iso) {
    var p = String(iso).split('-');
    return Number(p[2]) + ' de ' + MESES[Number(p[1]) - 1];
  }

  function fechaCorta(iso) {
    var p = String(iso).split('-');
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
    if (foco) {
      var el = typeof foco === 'string' ? $(foco) : foco;
      if (el) { el.focus(); }
    }
  }

  function avisar(texto) {
    dom.aviso.textContent = texto || '';
    dom.aviso.hidden = !texto;
  }

  /* ==========================================================
     MARCADOR DE LA TANDA
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

  /* ==========================================================
     ESCENA
  ========================================================== */
  function animar(el, fotogramas, opciones) {
    var dur = reducirMovimiento ? 0 : opciones.duration;
    var a = el.animate(fotogramas, Object.assign({}, opciones, { duration: dur, fill: 'forwards' }));
    estado.animaciones.push(a);
    /* Red de seguridad: si el navegador no avanza la animación
       (pestaña en segundo plano, ahorro de energía), se fuerza el
       estado final para que la partida nunca se quede bloqueada. */
    var seguro = esperar(dur + 250).then(function () {
      if (a.playState !== 'finished' && a.playState !== 'idle') { a.finish(); }
    });
    return Promise.race([a.finished, seguro]);
  }

  function reiniciarEscena() {
    estado.animaciones.forEach(function (a) { a.cancel(); });
    estado.animaciones = [];
    dom.rotulo.classList.remove('is-visible');
    dom.rotulo.removeAttribute('data-poc-resultado');
    document.querySelectorAll('.poc-diana').forEach(function (d) {
      d.classList.remove('is-apuntada', 'is-correcta', 'is-fallada');
    });
  }

  function diana(esquina) {
    return document.querySelector('[data-poc-diana="' + esquina + '"]');
  }

  function apuntar(esquina, activo) {
    if (estado.respondida) { return; }
    var d = diana(esquina);
    if (d) { d.classList.toggle('is-apuntada', activo); }
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
      var vuelo;
      if (gol) {
        vuelo = animar(dom.balon, [
          { transform: 'translate(0, 0) scale(1)' },
          { transform: 'translate(' + destino.x + 'px, ' + destino.y + 'px) scale(0.62)' }
        ], { duration: 480, easing: 'cubic-bezier(.2,.7,.4,1)' }).then(function () {
          return animar(dom.red, [
            { transform: 'scale(1, 1)' },
            { transform: 'scale(1.02, 1.05)' },
            { transform: 'scale(1, 1)' }
          ], { duration: 360, easing: 'ease-out' });
        });
      } else {
        /* Llega casi a la esquina, el portero la toca y sale rechazada. */
        var rebote = { x: Math.round(destino.x * 0.35), y: Math.round(destino.y * 0.25) };
        vuelo = animar(dom.balon, [
          { transform: 'translate(0, 0) scale(1)', offset: 0 },
          { transform: 'translate(' + Math.round(destino.x * 0.9) + 'px, ' + Math.round(destino.y * 0.9) + 'px) scale(0.66)', offset: 0.55 },
          { transform: 'translate(' + rebote.x + 'px, ' + rebote.y + 'px) scale(0.9)', offset: 1 }
        ], { duration: 820, easing: 'ease-out' });
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
      var t = b.querySelector('.poc-opcion__texto');
      t.textContent = texto;
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

  function marcarOpciones(elegida, correcta) {
    var botones = dom.opciones.querySelectorAll('.poc-opcion');
    botones.forEach(function (b, i) {
      b.setAttribute('aria-disabled', 'true');
      var etiqueta = null;
      if (i === correcta) {
        b.classList.add('is-correcta');
        etiqueta = i === elegida ? 'Correcta · tu respuesta' : 'Correcta';
      } else if (i === elegida) {
        b.classList.add('is-fallada');
        etiqueta = 'Tu respuesta';
      } else {
        b.classList.add('is-apagada');
      }
      if (etiqueta) {
        var s = document.createElement('span');
        s.className = 'poc-opcion__estado';
        s.textContent = etiqueta;
        b.querySelector('.poc-opcion__texto').appendChild(s);
      }
    });
    diana(ESQUINAS[correcta]).classList.add('is-correcta');
    if (elegida !== correcta) { diana(ESQUINAS[elegida]).classList.add('is-fallada'); }
  }

  /* ==========================================================
     FLUJO DEL PENALTI
  ========================================================== */
  function prepararTiro() {
    var p = estado.tanda.preguntas[estado.indice];
    estado.respondida = false;
    reiniciarEscena();

    dom.numeroTiro.textContent = 'Penalti ' + (estado.indice + 1) + ' de ' + TIROS_POR_TANDA;
    pintarTanda(dom.tanda, estado.tiros, estado.indice);
    dom.pregunta.textContent = p.pregunta;
    pintarOpciones(p);

    dom.veredicto.hidden = true;
    dom.anuncio.textContent = '';
    dom.veredicto.removeAttribute('data-poc-resultado');
    dom.siguiente.hidden = true;
    dom.ayuda.hidden = false;
  }

  function responder(elegida, instantaneo) {
    if (estado.respondida) { return; }
    estado.respondida = true;

    var p = estado.tanda.preguntas[estado.indice];
    var gol = elegida === p.correcta;
    var esquina = ESQUINAS[elegida];

    dom.opciones.setAttribute('aria-busy', 'true');
    dom.opciones.querySelectorAll('.poc-opcion').forEach(function (b) {
      b.setAttribute('aria-disabled', 'true');
    });
    document.querySelectorAll('.poc-diana').forEach(function (d) { d.classList.remove('is-apuntada'); });
    diana(esquina).classList.add('is-apuntada');

    var antes = reducirMovimiento;
    if (instantaneo) { reducirMovimiento = true; }

    return chutar(esquina, gol).then(function () {
      reducirMovimiento = antes;
      dom.opciones.removeAttribute('aria-busy');
      diana(esquina).classList.remove('is-apuntada');
      mostrarRotulo(gol);
      marcarOpciones(elegida, p.correcta);

      estado.tiros[estado.indice] = { elegida: elegida, correcta: p.correcta, gol: gol };
      pintarTanda(dom.tanda, estado.tiros, -1);
      guardarProgreso(false);

      var correcta = ESQUINAS[p.correcta] + ', ' + p.opciones[p.correcta];
      dom.veredictoTitulo.textContent = gol
        ? '¡Gol! ' + correcta + ' es la respuesta correcta.'
        : '¡Parada! La correcta era la ' + correcta + '.';
      dom.veredictoDato.textContent = p.dato;
      dom.veredicto.setAttribute('data-poc-resultado', gol ? 'gol' : 'parada');
      dom.veredicto.hidden = false;
      dom.anuncio.textContent = dom.veredictoTitulo.textContent + ' ' + p.dato;

      var ultimo = estado.indice === TIROS_POR_TANDA - 1;
      dom.siguiente.textContent = ultimo ? 'Ver resultado' : 'Siguiente penalti';
      dom.siguiente.hidden = false;
      dom.ayuda.hidden = true;
      dom.siguiente.focus();
    });
  }

  function siguiente() {
    if (estado.indice < TIROS_POR_TANDA - 1) {
      estado.indice += 1;
      prepararTiro();
      dom.pregunta.focus();
    } else {
      guardarProgreso(true);
      pintarResultado(false);
    }
  }

  function guardarProgreso(completada) {
    escribir(estado.tanda.fecha, { tiros: estado.tiros, completada: completada });
  }

  /* ==========================================================
     RESULTADO
  ========================================================== */
  function textoCompartir() {
    var goles = estado.tiros.filter(function (t) { return t.gol; }).length;
    var linea = estado.tiros.map(function (t) { return t.gol ? '⚽' : '🧤'; }).join('');
    return 'Tanda de penaltis #' + estado.tanda.numero + ' · ' + fechaCorta(estado.tanda.fecha) + '\n' +
      linea + '  ' + goles + '/' + TIROS_POR_TANDA + '\n' +
      global.location.origin + global.location.pathname;
  }

  function pintarResultado(yaJugada) {
    var goles = estado.tiros.filter(function (t) { return t.gol; }).length;
    $('poc-resultado-previo').hidden = !yaJugada;
    $('poc-resultado-titulo').textContent = 'Has marcado ' + goles + ' de ' + TIROS_POR_TANDA;
    $('poc-resultado-frase').textContent = FRASES[goles];
    pintarTanda($('poc-resultado-tanda'), estado.tiros, -1);
    $('poc-compartir-salida').value = textoCompartir();
    $('poc-compartir-estado').textContent = '';

    var repaso = $('poc-repaso');
    repaso.innerHTML = '';
    estado.tanda.preguntas.forEach(function (p, i) {
      var t = estado.tiros[i];
      var li = document.createElement('li');
      var marca = document.createElement('span');
      marca.className = 'poc-repaso__marca';
      marca.setAttribute('data-poc-resultado', t.gol ? 'gol' : 'parada');
      marca.textContent = t.gol ? 'Gol' : 'Parada';
      li.appendChild(marca);
      li.appendChild(document.createTextNode(p.pregunta + ' '));
      var r = document.createElement('strong');
      r.textContent = ESQUINAS[p.correcta] + ', ' + p.opciones[p.correcta] + '.';
      li.appendChild(r);
      if (!t.gol) {
        li.appendChild(document.createTextNode(' Elegiste ' + ESQUINAS[t.elegida] + ', ' + p.opciones[t.elegida] + '.'));
      }
      repaso.appendChild(li);
    });

    var ayer = diaAnterior(estado.tanda.fecha);
    var hayAyer = global.pocPenaltisTandas.some(function (x) { return x.fecha === ayer; });
    var enlace = $('poc-enlace-ayer');
    enlace.hidden = !hayAyer;
    enlace.href = 'penaltis.html?fecha=' + ayer;

    mostrar('resultado', 'poc-resultado-titulo');
  }

  function copiar() {
    var salida = $('poc-compartir-salida');
    var texto = salida.value;
    var hecho = function () { $('poc-compartir-estado').textContent = 'Resultado copiado. Pégalo donde quieras.'; };
    var alternativa = function () {
      salida.focus();
      salida.select();
      $('poc-compartir-estado').textContent = 'No se pudo copiar solo: el texto está seleccionado, cópialo a mano.';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(hecho, alternativa);
    } else {
      alternativa();
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
    if (boton) { boton.focus(); }
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
    dom.pregunta.focus();
  }

  function pintarEntrada(guardado) {
    $('poc-entrada-numero').textContent = '#' + estado.tanda.numero;
    $('poc-entrada-fecha').textContent = fechaLarga(estado.tanda.fecha);
    var seguir = guardado && guardado.tiros && guardado.tiros.length && !guardado.completada;
    dom.empezar.textContent = seguir
      ? 'Seguir la tanda (penalti ' + (guardado.tiros.length + 1) + ')'
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
    dom.numeroTiro = $('poc-numero-tiro');
    dom.tanda = $('poc-tanda');
    dom.veredicto = $('poc-veredicto');
    dom.anuncio = $('poc-anuncio');
    dom.veredictoTitulo = $('poc-veredicto-titulo');
    dom.veredictoDato = $('poc-veredicto-dato');
    dom.siguiente = $('poc-siguiente');
    dom.ayuda = $('poc-ayuda-teclado');
    dom.empezar = $('poc-empezar');
    dom.rotulo = $('poc-rotulo');
    dom.portero = $('poc-portero');
    dom.balon = $('poc-balon');
    dom.lanzador = $('poc-lanzador');
    dom.red = $('poc-red');

    dom.siguiente.addEventListener('click', siguiente);
    $('poc-compartir').addEventListener('click', copiar);
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

      if (demo === 'entrada') { pintarEntrada(null); return; }
      if (demo === 'juego') { empezar(true); return; }
      if (demo === 'gol' || demo === 'parada') {
        empezar(true);
        var correcta = tanda.preguntas[0].correcta;
        responder(demo === 'gol' ? correcta : (correcta + 1) % 4, true);
        return;
      }
      if (demo === 'resultado' || demo === 'jugado') {
        estado.tiros = tanda.preguntas.map(function (p, i) {
          var gol = i !== 2;
          return { elegida: gol ? p.correcta : (p.correcta + 1) % 4, correcta: p.correcta, gol: gol };
        });
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
