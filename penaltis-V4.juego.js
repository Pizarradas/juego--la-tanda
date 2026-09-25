/* ==========================================================
   POC La tanda (V4) — motor del juego
   ----------------------------------------------------------
   V4 = V3 + mejoras de UX/UI (cambios anotados con «V4»):
   - Esquina ↔ respuesta más clara: dianas 3D con más contraste
     (en penaltis-V4.escena.js),
     insignia ✓/✕ en la esquina del botón que corresponde a la de
     la portería y apuntado solo cuando el ratón se mueve de verdad.
   - Ritmo: estado «Chutas a la C…» mientras corre el tiro.
   - Enganche diario: racha, mejor racha, media y récord en la
     entrada y en el resultado; la racha viaja en el texto compartido.
   - V4.3 · Animaciones nuevas en penaltis-V4.escena.js.
   - V4.4 · Límites: hasta 5 tandas seguidas, descanso de 60 min y máximo
     diario (config.limites). Las tandas ya no van por fecha: se juegan
     en orden de número y se guardan por número. Ajustes táctiles.
   - V4.1 · Temática FC Barcelona: preguntas, tiempos, puntos y
     divisiones en penaltis-barca.json (sustituye a penaltis.data.js).
   - V4.1 · Reloj: cada penalti tiene menos segundos (15, 13, 11, 9, 7
     por defecto). Si se agota, chuta sin mirar y el portero la para.
   - V4.1 · Puntos y ranking personal: 100 por gol + 10 por segundo
     sobrante + 200 por pleno; total acumulado, división, puesto de la
     tanda entre las tuyas y gráfico de evolución.
   - Entorno: si el servidor local no resuelve las rutas
     /cds-statics/ de ux-index.css, el POC las recarga y lo avisa en
     el pie (solo afecta a la revisión, nunca a producción).

   Vistas con el mismo contrato:
   - vistaSVG: la ilustración de V2. Es la portada ligera, la
     reserva sin WebGL y la que juega mientras carga el 3D.
   - vista 3D: penaltis-V3.escena.js (import dinámico).
   Contrato: preparar() · apuntar(esquina|null) ·
   tirar({ esquina, gol, estirada, instantaneo }) -> Promise ·
   resultado({ correcta, elegida }) · cancelarRepeticion() ·
   sonido(activo)

   El cambio SVG -> 3D solo ocurre entre tiros, nunca a mitad.
   ?escena=2d fuerza la reserva. Con prefers-reduced-motion el 3D
   muestra directamente el desenlace, sin carrera ni repetición.
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
  /* Cada versión guarda aparte para poder compararlas en el mismo navegador. */
  var PREFIJO_CLAVE = 'penaltis:v4:';
  var PANTALLA = 'penaltis-V4.html';
  /* V4.3: escena propia de V4 (animaciones nuevas). V3 sigue con la suya. */
  var ESCENA = 'penaltis-V4.escena.js';
  /* V4.1: preguntas, tiempos y puntos en un JSON editable por la redacción. */
  var DATOS = 'penaltis-barca.json';
  /* Valores por defecto si el JSON no trae «config» (o la trae incompleta). */
  var CONFIG = {
    segundosPorPenalti: [15, 13, 11, 9, 7],
    puntos: { gol: 100, porSegundoSobrante: 10, pleno: 200, bloquePerfecto: 1000 },
    divisiones: [{ nombre: 'Cantera', desde: 0 }],
    /* V4.4: límites de juego (config.limites en el JSON) */
    limites: { tandasSeguidas: 5, esperaMinutos: 60, maximoDiario: 15 }
  };
  /* V4.4: estados de demostración de los límites (?estado=descanso|limite|agotadas) */
  var LIMITE_DEMO = null;

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
    'El portero te ha leído todas. A por la revancha.',
    'Hoy mandaba el portero.',
    'El portero ha tenido un buen día.',
    'Tanda ganada, pero con sufrimiento.',
    'Casi perfecto: solo se te escapó uno.',
    'Pleno. Hoy no te para nadie.'
  ];

  var estado = {
    tanda: null,
    indice: 0,
    tiros: [], /* { elegida, correcta, gol } */
    respondida: false,
    guardar: true, /* los estados de demostración no tocan el almacenamiento */
    animaciones: [],
    cuenta: null,
    ratonReal: false, /* V4: el apuntado por hover solo tras mover el ratón */
    reloj: null /* V4.1: { total, restante, ultimo, id, avisado } en ms */
  };

  var dom = {};
  /* V4.8: el pie de revisión solo aparece con ?revision=1 */
  if (new URLSearchParams(global.location.search).has('revision')) {
    document.documentElement.setAttribute('data-poc-revision', '');
  }

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

  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  /* ==========================================================
     V4 · HISTORIAL: racha y números del jugador
     Se calcula a partir de las tandas completadas guardadas.
     «extra» permite contar la tanda en pantalla aunque no se
     guarde (estados de demostración).
     ========================================================== */
  /* V4.1 · PUNTOS: gol = base + bonus por segundo sobrante; pleno suma extra.
     Las tandas guardadas antes de V4.1 (sin puntos por tiro) cuentan solo la base. */
  function puntosTiro(gol, segundos) {
    return gol ? CONFIG.puntos.gol + CONFIG.puntos.porSegundoSobrante * Math.max(0, segundos || 0) : 0;
  }

  function puntosTanda(tiros) {
    var suma = tiros.reduce(function (s, t) {
      if (!t) { return s; }
      return s + (typeof t.puntos === 'number' ? t.puntos : (t.gol ? CONFIG.puntos.gol : 0));
    }, 0);
    return suma + (contar(tiros).goles === TIROS_POR_TANDA ? CONFIG.puntos.pleno : 0);
  }

  function divisionDe(total) {
    var lista = CONFIG.divisiones;
    var i = 0;
    while (i + 1 < lista.length && total >= lista[i + 1].desde) { i++; }
    return { actual: lista[i], siguiente: lista[i + 1] || null };
  }

  function numero(n) { return Math.round(n).toLocaleString('es-ES'); }

  /* V4.4: cada tanda se guarda por su número ('tanda:12'): { tiros,
     completada, puntos, inicio, fin (ms), dia (AAAA-MM-DD en que se terminó) }.
     Ya no hay una tanda por día: se juegan seguidas, con límites. */
  function claveTanda(numero) { return 'tanda:' + numero; }

  function historial() {
    var lista = [];
    var pre = PREFIJO_CLAVE + 'tanda:';
    try {
      Object.keys(global.localStorage).forEach(function (k) {
        if (k.indexOf(pre) !== 0) { return; }
        var v = JSON.parse(global.localStorage.getItem(k));
        if (v && v.completada && Array.isArray(v.tiros) && v.tiros.length === TIROS_POR_TANDA) {
          var fin = v.fin || 0;
          lista.push({
            numero: Number(k.slice(pre.length)),
            fin: fin,
            dia: v.dia || iso(new Date(fin)),
            goles: contar(v.tiros).goles,
            puntos: typeof v.puntos === 'number' ? v.puntos : puntosTanda(v.tiros)
          });
        }
      });
    } catch (e) { /* sin almacenamiento */ }
    return lista.sort(function (a, b) { return a.fin - b.fin; });
  }

  /* actual: la partida en pantalla (se cuenta aunque no se guarde, en demos) */
  function estadisticas(actual) {
    var lista = historial();
    if (actual && !lista.some(function (x) { return x.numero === actual.numero; })) {
      lista.push(actual);
      lista.sort(function (a, b) { return a.fin - b.fin; });
    }
    var dias = {};
    lista.forEach(function (x) { dias[x.dia] = true; });
    var hoy = hoyISO();
    var hoyJugada = !!dias[hoy];

    /* Racha: días seguidos con al menos una tanda, hasta hoy o hasta ayer
       (si hoy aún no has jugado, todavía se puede mantener). */
    var racha = 0;
    var cursor = hoyJugada ? hoy : diaAnterior(hoy);
    while (dias[cursor]) { racha++; cursor = diaAnterior(cursor); }

    var mejor = 0;
    var seguidas = 0;
    var previa = null;
    Object.keys(dias).sort().forEach(function (f) {
      seguidas = previa && diaAnterior(f) === previa ? seguidas + 1 : 1;
      mejor = Math.max(mejor, seguidas);
      previa = f;
    });

    var goles = 0, record = 0, puntos = 0, recordPuntos = 0;
    lista.forEach(function (x) {
      goles += x.goles;
      record = Math.max(record, x.goles);
      puntos += x.puntos;
      recordPuntos = Math.max(recordPuntos, x.puntos);
    });

    /* Puesto de la partida en pantalla entre todas las tuyas (1 = la mejor) */
    var puesto = null;
    if (actual) {
      puesto = 1 + lista.filter(function (x) { return x.puntos > actual.puntos; }).length;
    }

    return {
      jugadas: lista.length,
      racha: racha,
      mejor: mejor,
      record: record,
      recordPuntos: recordPuntos,
      media: lista.length ? goles / lista.length : 0,
      puntos: puntos,
      puesto: puesto,
      serie: lista.map(function (x) { return { numero: x.numero, dia: x.dia, puntos: x.puntos, goles: x.goles }; }),
      hoyJugada: hoyJugada
    };
  }

  /* ==========================================================
     V4.4 · LÍMITES: como máximo N tandas seguidas; después, una
     espera (en minutos) antes de la siguiente; y un máximo al día.
     Todo se calcula con las horas a las que terminaste cada tanda.
     Si paras por tu cuenta tanto como la espera, el bloque se reinicia.
     ========================================================== */
  function limites(ahora) {
    if (LIMITE_DEMO) { return LIMITE_DEMO(); }
    ahora = ahora || Date.now();
    var L = CONFIG.limites;
    var espera = L.esperaMinutos * 60000;
    var fines = historial().map(function (x) { return x.fin; }).filter(Boolean);
    var rb = recorrerBloques(historial(), ahora);
    var bloque = rb.abierto.length;
    var hasta = rb.hasta;
    var hoy = iso(new Date(ahora));
    var jugadasHoy = fines.filter(function (ts) { return iso(new Date(ts)) === hoy; }).length;
    var r = {
      jugadasHoy: jugadasHoy,
      quedanHoy: Math.max(0, L.maximoDiario - jugadasHoy),
      enBloque: bloque,
      quedanBloque: L.tandasSeguidas - bloque,
      motivo: null,
      hasta: 0
    };
    if (r.quedanHoy <= 0) {
      var d = new Date(ahora);
      r.motivo = 'diario';
      r.hasta = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    } else if (hasta > ahora) {
      r.motivo = 'descanso';
      r.hasta = hasta;
      r.quedanBloque = 0;
    }
    r.quedanBloque = Math.min(r.quedanBloque, r.quedanHoy);
    return r;
  }

  /* V4.4 · Bloques: agrupa las partidas terminadas en bloques de N seguidas.
     Un bloque se cierra al llegar a N (y empieza la espera) o si paras tanto
     como la espera. Devuelve el bloque abierto (partidas del bloque en curso),
     los bloques cerrados completos y hasta cuándo dura la espera. */
  function recorrerBloques(lista, ahora) {
    var L = CONFIG.limites;
    var espera = L.esperaMinutos * 60000;
    var abierto = [];
    var completos = [];
    var hasta = 0;
    var previo = null;
    lista.filter(function (x) { return x.fin; }).forEach(function (x) {
      if (hasta && x.fin >= hasta) { hasta = 0; abierto = []; }
      if (previo !== null && x.fin - previo >= espera) { abierto = []; }
      abierto.push(x);
      if (abierto.length >= L.tandasSeguidas) {
        hasta = x.fin + espera;
        completos.push(abierto);
        abierto = [];
      }
      previo = x.fin;
    });
    if (!hasta && previo !== null && (ahora || Date.now()) - previo >= espera) { abierto = []; }
    return { abierto: abierto, completos: completos, hasta: hasta };
  }

  /* V4.5 · Bloque perfecto: si aciertas las cinco preguntas de todas las
     tandas de un bloque (5 plenos seguidos), bonus extra. Aquí se cuenta
     cómo va el bloque en curso para enseñarlo y para dar el bonus. */
  function estadoPlenos(ahora) {
    var rb = recorrerBloques(historial(), ahora);
    var plenosAbierto = rb.abierto.filter(function (x) { return x.goles === TIROS_POR_TANDA; }).length;
    return {
      jugadas: rb.abierto.length,
      plenos: plenosAbierto,
      vivo: plenosAbierto === rb.abierto.length, /* todavía se puede conseguir */
      faltan: CONFIG.limites.tandasSeguidas - rb.abierto.length
    };
  }

  function formatoEspera(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    var dd = function (n) { return String(n).padStart(2, '0'); };
    return (h ? h + ':' + dd(m) : m) + ':' + dd(ss);
  }

  /* Tandas del JSON por número; la siguiente es la que quedó a medias o la
     primera que no has terminado. */
  function tandasOrdenadas() {
    return (global.pocPenaltisTandas || []).slice().sort(function (a, b) { return a.numero - b.numero; });
  }

  function siguienteTanda() {
    if (estado.sinMas) { return null; }
    var ts = tandasOrdenadas();
    var guardada = function (t) { return leer(claveTanda(t.numero)); };
    var aMedias = ts.filter(function (t) {
      var g = guardada(t);
      return g && g.tiros && g.tiros.length && !g.completada;
    })[0];
    if (aMedias) { return aMedias; }
    return ts.filter(function (t) { var g = guardada(t); return !(g && g.completada); })[0] || null;
  }

  function formatoMedia(n) {
    return n.toFixed(1).replace('.', ',');
  }

  /* Pinta una fila de cifras en una lista .poc-reglas */
  function pintarCifras(lista, cifras) {
    lista.innerHTML = '';
    cifras.forEach(function (c) {
      var li = document.createElement('li');
      var fuerte = document.createElement('strong');
      fuerte.textContent = c[0];
      li.appendChild(fuerte);
      li.appendChild(document.createTextNode(' ' + c[1]));
      if (c[2]) { li.setAttribute('data-poc-destacado', 'true'); }
      lista.appendChild(li);
    });
  }

  /* ==========================================================
     V4 · ENTORNO: el DS con rutas absolutas en local
     ux-index.css importa sus hojas como /cds-statics/…; si el
     servidor de desarrollo está montado más arriba, todas dan
     404 y el POC se ve sin DS. Aquí se detecta y se recargan
     desde la carpeta real. Solo afecta a la revisión.
     ========================================================== */
  function repararDS() {
    var hoja = $('brandStyles');
    var aviso = $('poc-aviso-ds');
    if (!hoja || !hoja.sheet) { return; }
    var reglas;
    try { reglas = hoja.sheet.cssRules; } catch (e) { return; }
    var imports = Array.prototype.filter.call(reglas, function (r) { return r.type === 3; });
    var rotos = imports.filter(function (r) {
      try { return !r.styleSheet || r.styleSheet.cssRules.length === 0; } catch (e) { return true; }
    });
    if (!imports.length || rotos.length < imports.length / 2) { return; }

    var corte = hoja.href.indexOf('/cds-statics/');
    if (corte < 0) { return; }
    var prefijo = hoja.href.slice(0, corte);
    var previo = hoja;
    rotos.forEach(function (r) {
      if (!r.href || r.href.charAt(0) !== '/') { return; }
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = prefijo + r.href;
      l.setAttribute('data-poc-reparado', '');
      previo.after(l);
      previo = l;
    });
    if (aviso) {
      aviso.textContent = 'Entorno: el servidor local no resolvía las rutas /cds-statics/ de ' + hoja.href.split('/').pop() + ' (' +
        rotos.length + ' hojas en 404). El POC las ha recargado desde ' + prefijo.replace(global.location.origin, '') +
        '/cds-statics/. Arréglalo sirviendo desde la raíz del DS o con imports relativos.';
      aviso.hidden = false;
    }
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
    if (vista !== 'juego') { dom.accionesJuego.hidden = true; pararReloj(); }
    if (vista === 'juego' && estado.cuenta) { clearInterval(estado.cuenta); estado.cuenta = null; }
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
        texto = 'Penalti ' + (i + 1) + ': ' + (tiro.gol ? 'gol' : (tiro.agotado ? 'parada, se acabó el tiempo' : 'parada'));
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
    clearTimeout(estado.rotuloFirma);
    dom.rotulo.classList.remove('is-visible', 'is-golpe', 'is-firma');
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
    vista.apuntar(activo ? esquina : null, esquina);
  }

  function apuntarSVG(esquina, activo) {
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
  function chutar(esquina, gol, estirada) {
    var destino = DESTINO_BALON[esquina];

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

  /* ==========================================================
     VISTAS DE LA JUGADA (V3)
     ========================================================== */

  /* La lógica decide hacia dónde se tira el portero: con gol, a otra
     esquina o se queda en el centro; con parada, a la esquina elegida. */
  function elegirEstirada(esquina, gol) {
    if (!gol) { return esquina; }
    var otras = ESQUINAS.filter(function (e) { return e !== esquina; }).concat('centro');
    return otras[Math.floor(Math.random() * otras.length)];
  }

  var vistaSVG = {
    nombre: 'svg',
    preparar: function () { reiniciarEscena(); },
    apuntar: function (esquina, ultima) {
      if (esquina) { apuntarSVG(esquina, true); } else if (ultima) { apuntarSVG(ultima, false); }
    },
    tirar: function (p) {
      var antes = reducirMovimiento;
      if (p.instantaneo) { reducirMovimiento = true; }
      return chutar(p.esquina, p.gol, p.estirada).then(function () { reducirMovimiento = antes; });
    },
    resultado: function (r) {
      diana(r.correcta).classList.add('is-correcta');
      if (r.elegida !== r.correcta) { diana(r.elegida).classList.add('is-fallada'); }
    },
    cancelarRepeticion: function () {},
    sonido: function () {}
  };

  var vista = vistaSVG;
  var escena3D = { api: null, promesa: null, pendiente: false };

  function soporta3D() {
    if (new URLSearchParams(global.location.search).get('escena') === '2d') { return false; }
    try {
      var c = document.createElement('canvas');
      var gl = global.WebGL2RenderingContext && c.getContext('webgl2');
      /* V4.14: se libera el contexto de prueba (los móviles admiten pocos) */
      var ext = gl && gl.getExtension('WEBGL_lose_context');
      if (ext) { ext.loseContext(); }
      return !!gl;
    } catch (e) { return false; }
  }

  function crearVista3D(api) {
    return {
      nombre: '3d',
      preparar: function () { api.preparar({ equipaciones: estado.tanda && estado.tanda.equipaciones }); },
      apuntar: function (esquina) { api.apuntar(esquina); },
      tirar: function (p) { return api.tirar(p); },
      resultado: function (r) { api.resultado(r); },
      cancelarRepeticion: function () { api.cancelarRepeticion(); },
      sonido: function (activo) { api.sonido(activo); }
    };
  }

  /* V4.3: la escena tiene su propio archivo (penaltis-V4.escena.js) con
     las animaciones nuevas y las dianas ya retocadas: se importa tal cual. */
  function importarEscena() {
    return import('./' + ESCENA);
  }

  /* Descarga Three.js y el estadio solo cuando hace falta: al acercarse
     a «Empezar» o al empezar. Mientras, se juega con la vista SVG. */
  function cargar3D() {
    if (escena3D.promesa) { return escena3D.promesa; }
    if (!soporta3D()) {
      escena3D.promesa = Promise.resolve(null);
      return escena3D.promesa;
    }
    dom.escena.classList.add('is-cargando3d');
    escena3D.promesa = importarEscena().then(function (m) {
      return m.crearEscena(dom.escena3d, {
        reducido: reducirMovimiento,
        alRepetir: function (activa) { dom.escena.classList.toggle('is-repeticion', activa); }
      });
    }).then(function (api) {
      escena3D.api = api;
      global.pocPenaltis && (global.pocPenaltis.escena3D = api); /* solo pruebas */
      dom.escena.classList.remove('is-cargando3d');
      activar3D();
      return api;
    }).catch(function (e) {
      /* Sin 3D se sigue jugando con la ilustración: nada se bloquea. */
      if (global.console) { global.console.warn('[penaltis] Escena 3D no disponible:', e); }
      dom.escena.classList.remove('is-cargando3d');
      return null;
    });
    return escena3D.promesa;
  }

  /* Solo entre tiros: si hay un tiro en marcha, espera al siguiente. */
  function activar3D() {
    if (!escena3D.api || vista.nombre === '3d') { return; }
    if (estado.respondida) { escena3D.pendiente = true; return; }
    vista = crearVista3D(escena3D.api);
    escena3D.pendiente = false;
    dom.escena.classList.add('is-3d');
    dom.sonidoBoton.hidden = false;
    if (preferenciaSonido()) { vista.sonido(true); }
    if (estado.tanda) { vista.preparar(); }
  }

  function preferenciaSonido() {
    try { return global.localStorage.getItem(PREFIJO_CLAVE + 'sonido') === '1'; } catch (e) { return false; }
  }

  function alternarSonido() {
    var activo = dom.sonidoBoton.getAttribute('aria-pressed') !== 'true';
    dom.sonidoBoton.setAttribute('aria-pressed', String(activo));
    try { global.localStorage.setItem(PREFIJO_CLAVE + 'sonido', activo ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    vista.sonido(activo);
  }

  /* V4.7: rótulo de retransmisión en dos tiempos (golpe → firma).
     El CSS hace el espectáculo; aquí solo se monta el texto letra a
     letra, el confeti y el paso a la placa pequeña. */
  var COLORES_CONFETI = ['#004d98', '#a50044', '#edbb00', '#ffffff', '#edbb00'];

  function montarConfeti(caja) {
    var html = '';
    /* V4.14: menos piezas en táctil (móviles) */
    var piezas = global.matchMedia && global.matchMedia('(pointer: coarse)').matches ? 24 : 44;
    for (var i = 0; i < piezas; i++) {
      var ang = Math.random() * Math.PI * 2;
      var dist = 18 + Math.random() * 34;
      var x = Math.cos(ang) * dist;
      var y = Math.sin(ang) * dist * 0.6 - 10;
      html += '<i style="--x:' + x.toFixed(1) + 'cqi;--y:' + y.toFixed(1) + 'cqi;' +
        '--r:' + Math.round(360 + Math.random() * 720) * (Math.random() < 0.5 ? -1 : 1) + 'deg;' +
        '--d:' + (Math.random() * 0.18).toFixed(2) + 's;' +
        '--w:' + (5 + Math.random() * 5).toFixed(0) + 'px;--h:' + (9 + Math.random() * 8).toFixed(0) + 'px;' +
        '--c:' + COLORES_CONFETI[i % COLORES_CONFETI.length] + '"></i>';
    }
    caja.innerHTML = html;
  }

  function mostrarRotulo(gol, detalle) {
    detalle = detalle || {};
    var r = dom.rotulo;
    var palabra = gol ? '¡Gol!' : '¡Parada!';
    clearTimeout(estado.rotuloFirma);
    r.classList.remove('is-golpe', 'is-firma', 'is-visible');
    r.setAttribute('data-poc-resultado', gol ? 'gol' : 'parada');

    r.querySelector('.poc-rotulo__palabra').innerHTML = palabra.split('').map(function (c, i) {
      return '<span class="poc-rotulo__letra" style="--i:' + i + '">' + c + '</span>';
    }).join('');
    r.querySelector('.poc-rotulo__sub').textContent = gol
      ? (detalle.puntos ? '+' + detalle.puntos + ' puntos' : '')
      : (detalle.agotado ? 'Se acabó el tiempo' : 'El portero la adivina');
    var confeti = r.querySelector('.poc-rotulo__confeti');
    if (gol && !detalle.instantaneo && !reducirMovimiento) { montarConfeti(confeti); } else { confeti.innerHTML = ''; }

    if (detalle.instantaneo) {
      r.classList.add('is-visible', 'is-firma');
      return;
    }
    void r.offsetWidth; /* reinicia las animaciones CSS */
    r.classList.add('is-visible', 'is-golpe');
    estado.rotuloFirma = setTimeout(function () {
      r.classList.remove('is-golpe');
      r.classList.add('is-firma');
    }, reducirMovimiento ? 900 : 1850);
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

      /* V4.4 · táctil: se ignoran los toques que llegan en los primeros
         milisegundos tras cambiar de pregunta. En móvil, el toque en «Empezar»
         o «Siguiente» puede acabar como «clic fantasma» sobre la respuesta
         que aparece debajo del dedo y chutar sin querer. */
      b.addEventListener('click', function () {
        if (performance.now() < estado.listoDesde) { return; }
        responder(i);
      });
      /* V4: el hover solo apunta si el ratón se ha movido desde que
         salió la pregunta; así un cursor quieto no deja una
         trayectoria «fantasma» cuando se juega con teclado. */
      b.addEventListener('mouseenter', function () { if (estado.ratonReal) { apuntar(esquina, true); } });
      b.addEventListener('mouseleave', function () { apuntar(esquina, false); });
      b.addEventListener('focus', function () { apuntar(esquina, true); });
      /* V4.4 · táctil: al apoyar el dedo se ve la trayectoria antes de soltar */
      b.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { apuntar(esquina, true); } });
      b.addEventListener('pointercancel', function () { apuntar(esquina, false); });
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

  /* V4: la insignia ✓/✕ va en la esquina del botón que corresponde a
     la esquina de la portería (A arriba-izquierda … D abajo-derecha),
     no encima de la letra. + texto solo para lector. */
  function marcarOpciones(elegida, correcta, esquinaTiro) {
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
        b.appendChild(s);
        var sr = document.createElement('span');
        sr.className = 'poc-sr';
        sr.textContent = etiqueta;
        b.appendChild(sr);
      }
    });
    vista.resultado({ correcta: ESQUINAS[correcta], elegida: esquinaTiro });
  }

  /* ==========================================================
     V4.1 · RELOJ: cada penalti tiene menos tiempo que el anterior
     (config.segundosPorPenalti). Si llega a cero, el jugador chuta
     sin mirar y el portero la para: cuenta como fallo.
     Se pausa con la pestaña oculta para no castigar un cambio de app.
     ========================================================== */
  function segundosPara(indice) {
    var s = CONFIG.segundosPorPenalti;
    return s[Math.min(indice, s.length - 1)];
  }

  function iniciarReloj() {
    pararReloj();
    var total = segundosPara(estado.indice) * 1000;
    estado.reloj = { total: total, restante: total, ultimo: performance.now(), id: null, avisado: false };
    dom.reloj.removeAttribute('data-poc-estado');
    dom.relojSr.textContent = 'Tienes ' + segundosPara(estado.indice) + ' segundos.';
    pintarReloj();
    estado.reloj.id = setInterval(tickReloj, 100);
  }

  function tickReloj() {
    var r = estado.reloj;
    if (!r || !r.id) { return; }
    var ahora = performance.now();
    /* V4.14: reloj justo. Un bloqueo del navegador (p. ej. al preparar el
       3D en un móvil modesto) no descuenta más de 250 ms por tic. */
    if (!document.hidden) { r.restante -= Math.min(ahora - r.ultimo, 250); }
    r.ultimo = ahora;
    if (!r.avisado && r.restante <= 5000 && r.total > 5000) {
      r.avisado = true;
      dom.anuncio.textContent = 'Quedan 5 segundos.';
    }
    if (r.restante <= 0) {
      r.restante = 0;
      pintarReloj();
      pararReloj();
      if (!estado.respondida) { responder(-1); }
      return;
    }
    pintarReloj();
  }

  function pararReloj(estadoFinal) {
    if (estado.reloj && estado.reloj.id) {
      clearInterval(estado.reloj.id);
      estado.reloj.id = null;
    }
    if (estadoFinal) { dom.reloj.setAttribute('data-poc-estado', estadoFinal); }
  }

  function segundosRestantes() {
    return estado.reloj ? Math.max(0, Math.ceil(estado.reloj.restante / 1000)) : 0;
  }

  function pintarReloj() {
    var r = estado.reloj;
    var seg = Math.max(0, Math.ceil(r.restante / 1000));
    dom.relojNum.textContent = seg;
    dom.relojBarra.style.transform = 'scaleX(' + Math.max(0, r.restante / r.total).toFixed(3) + ')';
    dom.reloj.setAttribute('data-poc-urgente', seg <= 3 ? 'true' : 'false');
  }

  /* ==========================================================
     FLUJO DEL PENALTI
     ========================================================== */

  /* V2: si las opciones no caben en pantalla, sube el bloque de juego
     para que marcador, pregunta, escena y respuestas se vean juntos. */
  function encuadrar() {
    var vistaJuego = $('poc-vista-juego');
    var abajo = dom.opciones.getBoundingClientRect().bottom;
    var arriba = vistaJuego.getBoundingClientRect().top;
    if (abajo > global.innerHeight || arriba < 0) {
      var y = global.scrollY + arriba - 12;
      global.scrollTo({ top: Math.max(0, y), behavior: reducirMovimiento ? 'auto' : 'smooth' });
    }
  }

  function prepararTiro() {
    var p = estado.tanda.preguntas[estado.indice];
    estado.respondida = false;
    estado.ratonReal = false;
    estado.listoDesde = performance.now() + 450;
    reiniciarEscena();
    if (escena3D.pendiente) { activar3D(); }
    if (vista.nombre === '3d') { vista.preparar(); }

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
    dom.estadoTiro.hidden = true;
    document.body.removeAttribute('data-poc-tiro');
    iniciarReloj();
  }

  /* elegida = -1 cuando se agota el tiempo: el jugador chuta sin mirar
     a una esquina que no es la buena y el portero la para. */
  function responder(elegida, instantaneo) {
    if (estado.respondida) { return; }
    estado.respondida = true;

    var p = estado.tanda.preguntas[estado.indice];
    var agotado = elegida < 0;
    var segundos = agotado ? 0 : segundosRestantes();
    pararReloj(agotado ? 'agotado' : 'parado');
    var gol = !agotado && elegida === p.correcta;
    var esquina;
    if (agotado) {
      var otras = ESQUINAS.filter(function (e, i) { return i !== p.correcta; });
      esquina = otras[Math.floor(Math.random() * otras.length)];
    } else {
      esquina = ESQUINAS[elegida];
    }
    var puntos = puntosTiro(gol, segundos);

    dom.opciones.setAttribute('aria-busy', 'true');
    dom.opciones.querySelectorAll('.poc-opcion').forEach(function (b, i) {
      b.setAttribute('aria-disabled', 'true');
      if (i === elegida) { b.classList.add('is-elegida'); } else { b.classList.add('is-apagada'); }
    });
    document.querySelectorAll('.poc-diana').forEach(function (d) { d.classList.remove('is-apuntada'); });
    diana(esquina).classList.add('is-apuntada');
    dom.trayectoria.classList.remove('is-visible');
    dom.ayuda.hidden = true;

    /* V4: mientras corre la jugada, el panel dice qué está pasando. */
    if (!instantaneo) {
      dom.estadoTiro.textContent = agotado
        ? '¡Se acabó el tiempo! Chutas sin mirar…'
        : 'Chutas a la ' + esquina + ', ' + NOMBRE_ESQUINA[esquina] + '…';
      dom.estadoTiro.hidden = false;
    }
    document.body.setAttribute('data-poc-tiro', 'en-juego');

    var plan = { esquina: esquina, gol: gol, estirada: elegirEstirada(esquina, gol), instantaneo: !!instantaneo };

    return vista.tirar(plan).then(function () {
      dom.opciones.removeAttribute('aria-busy');
      dom.estadoTiro.hidden = true;
      document.body.setAttribute('data-poc-tiro', 'resuelto');
      diana(esquina).classList.remove('is-apuntada');
      dom.opciones.querySelectorAll('.poc-opcion').forEach(function (b) { b.classList.remove('is-apagada', 'is-elegida'); });
      mostrarRotulo(gol, { puntos: puntos, agotado: agotado, instantaneo: !!instantaneo });
      marcarOpciones(elegida, p.correcta, esquina);
      if (!instantaneo) { vibrar(gol ? [25, 40, 25] : 60); }

      estado.tiros[estado.indice] = {
        elegida: agotado ? null : elegida,
        correcta: p.correcta,
        gol: gol,
        agotado: agotado,
        segundos: segundos,
        puntos: puntos
      };
      pintarTanda(dom.tanda, estado.tiros, -1);
      pintarMarcador(!instantaneo);
      guardarProgreso(false);

      var correcta = ESQUINAS[p.correcta] + ', ' + p.opciones[p.correcta];
      /* V2: el titular del veredicto solo existe en la parada (dice cuál era);
         en el gol la escena y el ✓ ya lo cuentan. */
      var titulo = agotado
        ? 'Se acabó el tiempo. La correcta era la ' + correcta + '.'
        : 'La correcta era la ' + correcta + '.';
      dom.veredictoTitulo.textContent = gol ? '' : titulo;
      dom.veredictoTitulo.hidden = gol;
      dom.veredictoDato.textContent = p.dato;
      /* V4.1: puntos del tiro y acumulado de la tanda */
      var llevas = puntosTanda(estado.tiros.slice(0, estado.indice + 1));
      dom.veredictoPuntos.textContent = gol
        ? '+' + numero(puntos) + ' pts · ' + CONFIG.puntos.gol + ' del gol + ' +
          numero(puntos - CONFIG.puntos.gol) + ' por ' + plural(segundos, 'segundo', 'segundos') + ' de sobra'
        : '0 pts';
      dom.veredictoLlevas.textContent = 'Llevas ' + numero(llevas) + ' pts';
      dom.veredicto.setAttribute('data-poc-resultado', gol ? 'gol' : 'parada');
      dom.veredicto.hidden = false;
      dom.anuncio.textContent = (gol
        ? '¡Gol! ' + correcta + ' es la respuesta correcta. ' + numero(puntos) + ' puntos.'
        : (agotado ? '¡Parada! Se acabó el tiempo. ' : '¡Parada! ') + 'La correcta era la ' + correcta + '.') + ' ' + p.dato;

      var ultimo = estado.indice === TIROS_POR_TANDA - 1;
      dom.siguiente.textContent = ultimo ? 'Ver resultado' : 'Siguiente penalti';
      dom.accionesJuego.hidden = false;
      enfocar(dom.siguiente);
      verVeredicto();
    });
  }

  /* V4.14 · móvil: tras el tiro, el veredicto (la correcta y el dato)
     tiene que verse sin buscarlo. Las opciones que no cuentan se
     recogen por CSS y aquí se desplaza lo justo para que el veredicto
     quede encima del botón fijo «Siguiente penalti». */
  function verVeredicto() {
    if (global.innerWidth >= 768) { return; }
    global.requestAnimationFrame(function () {
      var fijo = dom.accionesJuego.getBoundingClientRect();
      var limite = (fijo.height ? fijo.top : global.innerHeight) - 12;
      var falta = dom.veredicto.getBoundingClientRect().bottom - limite;
      if (falta > 0) {
        global.scrollBy({ top: falta, behavior: reducirMovimiento ? 'auto' : 'smooth' });
      }
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
    var clave = claveTanda(estado.tanda.numero);
    var previo = leer(clave) || {};
    var dato = { tiros: estado.tiros, completada: completada, inicio: previo.inicio || Date.now() };
    if (completada) {
      dato.puntos = puntosTanda(estado.tiros);
      dato.fin = Date.now();
      dato.dia = hoyISO();
      /* V4.5: ¿esta tanda cierra un bloque perfecto? */
      var antes = estadoPlenos(dato.fin - 1);
      var pleno = contar(estado.tiros).goles === TIROS_POR_TANDA;
      if (pleno && antes.vivo && antes.jugadas === CONFIG.limites.tandasSeguidas - 1) {
        dato.bonusBloque = CONFIG.puntos.bloquePerfecto;
        dato.puntos += dato.bonusBloque;
      }
    }
    escribir(clave, dato);
  }

  /* ==========================================================
     RESULTADO
     ========================================================== */
  function urlCompartir() {
    return global.location.origin + global.location.pathname;
  }

  function textoCompartir(st) {
    var c = contar(estado.tiros);
    var linea = estado.tiros.map(function (t) { return t.gol ? '⚽' : '🧤'; }).join('');
    /* V4: la racha viaja en el texto compartido */
    var racha = st && st.racha >= 2 ? '🔥 ' + st.racha + ' días seguidos\n' : '';
    if (estado.ultimoBonus) { racha = '🏆 Bloque perfecto (+' + numero(estado.ultimoBonus) + ')\n' + racha; }
    /* V4.1: y los puntos de la tanda */
    return 'La tanda · SPORT #' + estado.tanda.numero + '\n' +
      linea + ' ' + c.goles + '/' + TIROS_POR_TANDA + ' · ' + numero(puntosTanda(estado.tiros) + (estado.ultimoBonus || 0)) + ' pts\n' +
      racha + urlCompartir();
  }

  /* ==========================================================
     V4.1 · RANKING: puntos acumulados, división y evolución.
     Es un ranking personal: sin servidor, compites contra ti.
     ========================================================== */
  function ordinal(n) { return n + '.ª'; }

  function pintarRanking(st, puntosHoy) {
    var div = divisionDe(st.puntos);
    $('poc-division').textContent = div.actual.nombre;
    $('poc-puntos-total').textContent = numero(st.puntos);
    $('poc-puntos-hoy').textContent = '+' + numero(puntosHoy) + ' esta tanda';

    var barra = $('poc-division-barra');
    var siguiente = $('poc-division-siguiente');
    if (div.siguiente) {
      var tramo = div.siguiente.desde - div.actual.desde;
      var hecho = st.puntos - div.actual.desde;
      barra.style.transform = 'scaleX(' + Math.min(1, hecho / tramo).toFixed(3) + ')';
      siguiente.textContent = 'Te faltan ' + numero(div.siguiente.desde - st.puntos) + ' pts para ' + div.siguiente.nombre + '.';
    } else {
      barra.style.transform = 'scaleX(1)';
      siguiente.textContent = 'Estás en la división más alta.';
    }

    var puesto = $('poc-ranking-puesto');
    if (st.jugadas <= 1) {
      puesto.textContent = 'Tu primera tanda: a partir de aquí empieza tu evolución.';
    } else if (st.puesto === 1) {
      puesto.textContent = 'Tu mejor tanda de ' + st.jugadas + '.';
    } else {
      puesto.textContent = 'Tu ' + ordinal(st.puesto) + ' mejor tanda de ' + st.jugadas + '.';
    }

    var serie = st.serie.slice(-12);
    var caja = $('poc-evolucion');
    pintarEvolucion(caja, serie, estado.tanda.numero);
    /* Se redibuja si cambia el ancho (giro del móvil, ventana) */
    if (global.ResizeObserver && !caja.__observado) {
      caja.__observado = true;
      var ultimoAncho = caja.clientWidth;
      new ResizeObserver(function () {
        if (Math.abs(caja.clientWidth - ultimoAncho) < 8 || !estado.ultimaSerie) { return; }
        ultimoAncho = caja.clientWidth;
        pintarEvolucion(caja, estado.ultimaSerie, estado.tanda.numero);
      }).observe(caja);
    }
    estado.ultimaSerie = serie;
  }

  /* Barras de puntos por tanda (últimas 12). Una serie: sin leyenda.
     La de hoy en amarillo y con su valor; el resto, al pasar por encima.
     Línea discontinua = tu media. Tabla accesible aparte. */
  function pintarEvolucion(caja, serie, actual) {
    var NS = 'http://www.w3.org/2000/svg';
    /* V4.2: el SVG se dibuja al ancho real de su caja (escala 1:1), así el
       texto del eje mide lo mismo en móvil y en escritorio. */
    var ancho = Math.max(260, Math.round(caja.clientWidth || 320));
    var alto = 170;
    var m = { arriba: 22, abajo: 22, lados: 6 };
    var max = Math.max.apply(null, serie.map(function (d) { return d.puntos; }).concat([CONFIG.puntos.gol]));
    var media = serie.reduce(function (s, d) { return s + d.puntos; }, 0) / (serie.length || 1);
    var hueco = (ancho - m.lados * 2) / Math.max(serie.length, 7);
    var barraAncho = Math.min(24, hueco - 6);
    var alturaUtil = alto - m.arriba - m.abajo;
    var y = function (v) { return m.arriba + alturaUtil - (v / max) * alturaUtil; };

    caja.innerHTML = '';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + ancho + ' ' + alto);
    svg.setAttribute('class', 'poc-evolucion__svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Puntos por tanda en tus últimas ' + serie.length + ' tandas. Media: ' + numero(media) + ' puntos.');

    var base = document.createElementNS(NS, 'line');
    base.setAttribute('x1', m.lados); base.setAttribute('x2', ancho - m.lados);
    base.setAttribute('y1', y(0)); base.setAttribute('y2', y(0));
    base.setAttribute('class', 'poc-evolucion__base');
    svg.appendChild(base);

    serie.forEach(function (d, i) {
      var x = m.lados + hueco * i + (hueco - barraAncho) / 2;
      var esHoy = d.numero === actual;
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'poc-evolucion__col' + (esHoy ? ' is-hoy' : ''));
      var alt = Math.max(2, y(0) - y(d.puntos));
      var r = Math.min(4, barraAncho / 2, alt);
      /* barra con esquinas redondeadas solo arriba, apoyada en la base */
      var p = document.createElementNS(NS, 'path');
      var top = y(0) - alt;
      p.setAttribute('d', 'M' + x + ' ' + y(0) + 'V' + (top + r) + 'Q' + x + ' ' + top + ' ' + (x + r) + ' ' + top +
        'H' + (x + barraAncho - r) + 'Q' + (x + barraAncho) + ' ' + top + ' ' + (x + barraAncho) + ' ' + (top + r) +
        'V' + y(0) + 'Z');
      p.setAttribute('class', 'poc-evolucion__barra');
      g.appendChild(p);
      /* zona de hover más grande que la barra */
      var hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', m.lados + hueco * i); hit.setAttribute('y', m.arriba - 16);
      hit.setAttribute('width', hueco); hit.setAttribute('height', alto - m.arriba + 16);
      hit.setAttribute('class', 'poc-evolucion__hit');
      var t = document.createElementNS(NS, 'title');
      t.textContent = 'Tanda #' + d.numero + ' (' + fechaLarga(d.dia) + '): ' + numero(d.puntos) + ' pts, ' + plural(d.goles, 'gol', 'goles');
      hit.appendChild(t);
      g.appendChild(hit);
      var valor = document.createElementNS(NS, 'text');
      valor.setAttribute('x', x + barraAncho / 2); valor.setAttribute('y', top - 6);
      valor.setAttribute('class', 'poc-evolucion__valor');
      valor.textContent = numero(d.puntos);
      g.appendChild(valor);
      var dia = document.createElementNS(NS, 'text');
      dia.setAttribute('x', x + barraAncho / 2); dia.setAttribute('y', alto - 6);
      dia.setAttribute('class', 'poc-evolucion__dia');
      dia.textContent = '#' + d.numero;
      g.appendChild(dia);
      svg.appendChild(g);
    });

    if (serie.length > 1) {
      var lm = document.createElementNS(NS, 'line');
      lm.setAttribute('x1', m.lados); lm.setAttribute('x2', ancho - m.lados);
      lm.setAttribute('y1', y(media)); lm.setAttribute('y2', y(media));
      lm.setAttribute('class', 'poc-evolucion__media');
      svg.appendChild(lm);
      var tm = document.createElementNS(NS, 'text');
      tm.setAttribute('x', m.lados); tm.setAttribute('y', y(media) - 5);
      tm.setAttribute('class', 'poc-evolucion__media-texto');
      tm.textContent = 'media ' + numero(media);
      svg.appendChild(tm);
    }
    caja.appendChild(svg);

    /* Vista de tabla para lector de pantalla */
    var tabla = document.createElement('table');
    tabla.className = 'poc-sr';
    tabla.innerHTML = '<caption>Puntos por tanda</caption><tr><th scope="col">Tanda</th><th scope="col">Puntos</th><th scope="col">Goles</th></tr>';
    serie.forEach(function (d) {
      var tr = document.createElement('tr');
      ['#' + d.numero + ', ' + fechaLarga(d.dia), numero(d.puntos), d.goles].forEach(function (v) {
        var td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      });
      tabla.appendChild(tr);
    });
    caja.appendChild(tabla);
  }

  function pintarResultado(yaJugada) {
    var c = contar(estado.tiros);
    $('poc-resultado-previo').hidden = !yaJugada;
    $('poc-tarjeta-antetitulo').textContent = 'Tanda #' + estado.tanda.numero;
    /* V3 · UI: marcador final «Tú 4 – 1 Portero». El texto accesible va aparte. */
    var titulo = $('poc-resultado-titulo');
    titulo.innerHTML = '';
    var sr = document.createElement('span');
    sr.className = 'poc-sr';
    sr.textContent = 'Has marcado ' + c.goles + ' de ' + TIROS_POR_TANDA + '.';
    titulo.appendChild(sr);
    var visual = document.createElement('span');
    visual.className = 'poc-tarjeta__resultado';
    visual.setAttribute('aria-hidden', 'true');
    [['equipo', 'Tú'], ['goles', c.goles], ['guion', '–'], ['goles', c.paradas], ['equipo', 'Portero']].forEach(function (par) {
      var e = document.createElement('span');
      e.className = 'poc-tarjeta__' + par[0];
      e.textContent = String(par[1]);
      visual.appendChild(e);
    });
    titulo.appendChild(visual);
    $('poc-resultado-frase').textContent = FRASES[c.goles];
    pintarTanda($('poc-resultado-tanda'), estado.tiros, -1);

    /* V4: tus números, contando la tanda en pantalla */
    var guardada = leer(claveTanda(estado.tanda.numero)) || {};
    /* V4.5: los puntos guardados ya incluyen el bonus de bloque perfecto */
    var bonus = estado.demoBonus || guardada.bonusBloque || 0;
    var puntosHoy = (typeof guardada.puntos === 'number' && guardada.completada ? guardada.puntos : puntosTanda(estado.tiros) + (estado.demoBonus || 0));
    var st = estadisticas({
      numero: estado.tanda.numero, fin: guardada.fin || Date.now(), dia: guardada.dia || hoyISO(),
      goles: c.goles, puntos: puntosHoy
    });
    $('poc-resultado-puntos').textContent = numero(puntosHoy) + ' pts' +
      (c.goles === TIROS_POR_TANDA ? ' · con +' + CONFIG.puntos.pleno + ' de pleno' + (bonus ? ' y el bonus' : '') : '');
    var insignia = $('poc-resultado-bonus');
    insignia.hidden = !bonus;
    insignia.textContent = bonus ? '🏆 Bloque perfecto · +' + numero(bonus) + ' pts' : '';
    estado.ultimoBonus = bonus;
    pintarCifras($('poc-resultado-cifras'), [
      [st.racha, st.racha === 1 ? 'día de racha' : 'días de racha', st.racha >= 2],
      [st.mejor, 'mejor racha'],
      [formatoMedia(st.media), 'goles de media']
    ]);
    var esRecord = st.jugadas > 1 && st.puesto === 1 && puntosHoy > 0 && !bonus;
    var nota = $('poc-resultado-nota');
    nota.textContent = esRecord ? 'Nuevo récord: tu mejor tanda con ' + numero(puntosHoy) + ' pts.' : '';
    nota.hidden = !esRecord;
    pintarRanking(st, puntosHoy);

    $('poc-compartir-salida').value = textoCompartir(st);
    $('poc-compartir-manual').hidden = true;
    $('poc-compartir-estado').textContent = '';
    $('poc-compartir').textContent = tactil && navigator.share ? 'Compartir resultado' : 'Copiar resultado';
    estado.ultimasCifras = st;

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
        r.appendChild(document.createTextNode(t.agotado || t.elegida === null
          ? ' Se te acabó el tiempo.'
          : ' Elegiste ' + ESQUINAS[t.elegida] + ', ' + p.opciones[t.elegida] + '.'));
      }
      li.appendChild(r);
      repaso.appendChild(li);
    });
    $('poc-repaso-resumen').textContent = plural(c.goles, 'gol', 'goles') + ', ' + plural(c.paradas, 'parada', 'paradas');

    /* V4.4: ¿se puede jugar otra? */
    pintarLimites('resultado');
    pintarPlenos('resultado', c.goles === TIROS_POR_TANDA, bonus);

    mostrar('resultado', 'poc-resultado-titulo');
  }

  /* ==========================================================
     V4.4 · LÍMITES EN PANTALLA
     En la entrada y en el resultado: o el CTA de jugar (con lo que te
     queda), o el panel de descanso con su cuenta atrás, o el aviso de
     que no quedan tandas. La cuenta atrás se refresca cada segundo y,
     al llegar a cero, vuelve a pintar la pantalla ya desbloqueada.
     ========================================================== */
  function textoQuedan(l) {
    var L = CONFIG.limites;
    return (l.quedanBloque === 1 ? 'Te queda 1 tanda' : 'Te quedan ' + l.quedanBloque + ' tandas') +
      ' antes del descanso (' + L.esperaMinutos + ' min) · ' + l.quedanHoy + ' de ' + L.maximoDiario + ' hoy';
  }

  function pintarLimites(donde) {
    var l = limites();
    var siguiente = donde === 'resultado' ? siguienteTanda() : estado.tanda;
    var aMedias = donde === 'entrada' && estado.aMedias;
    var panel = $('poc-descanso-' + donde);
    var info = $('poc-limite-' + donde);
    var cta = donde === 'resultado' ? $('poc-otra') : dom.empezar;
    var bloqueado = !aMedias && (!!l.motivo || !siguiente);
    if (estado.cuenta) { clearInterval(estado.cuenta); estado.cuenta = null; }

    cta.hidden = bloqueado;
    panel.hidden = !bloqueado;
    info.hidden = bloqueado;
    document.body.toggleAttribute('data-poc-bloqueado', bloqueado);
    if (!bloqueado) {
      info.textContent = aMedias ? 'Termina esta tanda: no cuenta hasta el último penalti.' : textoQuedan(l);
      return;
    }
    var titulo = panel.querySelector('[data-poc-descanso-titulo]');
    var texto = panel.querySelector('[data-poc-descanso-texto]');
    var cuenta = panel.querySelector('[data-poc-descanso-cuenta]');
    var barra = panel.querySelector('[data-poc-descanso-barra]');
    if (!siguiente && !l.motivo) {
      panel.setAttribute('data-poc-motivo', 'agotadas');
      titulo.textContent = 'No quedan tandas nuevas';
      texto.textContent = 'Has tirado todas las tandas publicadas. La redacción sube más pronto: vuelve en un rato.';
      cuenta.hidden = true;
      barra.parentNode.hidden = true;
      return;
    }
    panel.setAttribute('data-poc-motivo', l.motivo);
    cuenta.hidden = false;
    barra.parentNode.hidden = false;
    if (l.motivo === 'diario') {
      titulo.textContent = 'Hasta mañana';
      texto.textContent = 'Has llegado al máximo de ' + CONFIG.limites.maximoDiario + ' tandas por hoy. Nuevas tandas en';
    } else {
      titulo.textContent = 'Descanso en el vestuario';
      texto.textContent = 'Has tirado ' + CONFIG.limites.tandasSeguidas + ' tandas seguidas. Vuelves al campo en';
    }
    var total = l.motivo === 'diario' ? 24 * 3600000 : CONFIG.limites.esperaMinutos * 60000;
    var tick = function () {
      var falta = l.hasta - Date.now();
      if (falta <= 0) {
        clearInterval(estado.cuenta); estado.cuenta = null;
        if (donde === 'resultado') { pintarLimites('resultado'); } else { pintarEntrada(leer(claveTanda(estado.tanda.numero))); }
        return;
      }
      cuenta.textContent = formatoEspera(falta);
      barra.style.transform = 'scaleX(' + clamp01(1 - falta / total).toFixed(3) + ')';
    };
    tick();
    estado.cuenta = setInterval(tick, 1000);
  }

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  /* V4.5 · Progreso hacia el bloque perfecto: cinco huecos (uno por tanda
     del bloque), dorados los plenos. Solo se enseña mientras sea posible. */
  function pintarPlenos(donde, plenoAhora, bonus) {
    var caja = $('poc-plenos-' + donde);
    var N = CONFIG.limites.tandasSeguidas;
    var B = numero(CONFIG.puntos.bloquePerfecto);
    var e = estado.demoPlenos || estadoPlenos();
    var l = limites();
    var texto = '';
    var llenos = e.plenos;
    if (bonus) {
      texto = '¡' + N + ' plenos seguidos! Has cerrado un bloque perfecto: +' + B + ' pts.';
      llenos = N;
    } else if (l.motivo || !CONFIG.puntos.bloquePerfecto) {
      texto = '';
    } else if (e.jugadas === 0) {
      texto = 'Bloque perfecto: acierta las ' + (N * TIROS_POR_TANDA) + ' preguntas de ' + N + ' tandas seguidas y suma +' + B + ' pts.';
    } else if (e.vivo) {
      texto = (donde === 'resultado' && plenoAhora ? '¡Pleno! ' : '') + 'Llevas ' + e.plenos + ' de ' + N +
        ' plenos en este bloque. ' + (e.faltan === 1 ? 'Un pleno más' : e.faltan + ' plenos más') + ' y +' + B + ' pts.';
    } else {
      texto = '';
    }
    caja.hidden = !texto;
    if (!texto) { return; }
    caja.querySelector('[data-poc-plenos-texto]').textContent = texto;
    var lista = caja.querySelector('[data-poc-plenos-lista]');
    lista.innerHTML = '';
    for (var i = 0; i < N; i++) {
      var li = document.createElement('li');
      li.setAttribute('data-poc-pleno', i < llenos ? 'si' : 'no');
      lista.appendChild(li);
    }
    caja.toggleAttribute('data-poc-conseguido', !!bonus);
  }

  /* «Jugar otra tanda»: salta directo al primer penalti de la siguiente */
  function otraTanda() {
    var t = siguienteTanda();
    var l = limites();
    if (!t || l.motivo) { pintarLimites('resultado'); return; }
    estado.tanda = t;
    estado.aMedias = false;
    avisar('');
    empezar(true);
    global.scrollTo({ top: 0, behavior: 'auto' });
  }

  function copiaManual(mensaje) {
    var salida = $('poc-compartir-salida');
    $('poc-compartir-manual').hidden = false;
    salida.focus();
    salida.select();
    $('poc-compartir-estado').textContent = mensaje;
  }

  function compartir() {
    var texto = textoCompartir(estado.ultimasCifras);
    var estadoEl = $('poc-compartir-estado');
    var boton = $('poc-compartir');
    var copiar = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(function () {
          estadoEl.textContent = 'Resultado copiado. Pégalo donde quieras.';
          /* V4: confirmación también en el propio botón */
          var antes = boton.textContent;
          boton.textContent = '✓ Copiado';
          boton.setAttribute('data-poc-hecho', '');
          setTimeout(function () { boton.textContent = antes; boton.removeAttribute('data-poc-hecho'); }, 2000);
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
  /* V4.1: las tandas vienen de penaltis-barca.json. La config del JSON
     (tiempos, puntos, divisiones) pisa los valores por defecto si es válida. */
  function aplicarConfig(c) {
    if (!c) { return; }
    var s = c.segundosPorPenalti;
    if (Array.isArray(s) && s.length && s.every(function (n) { return typeof n === 'number' && n > 0; })) {
      CONFIG.segundosPorPenalti = s;
    }
    if (c.puntos) {
      ['gol', 'porSegundoSobrante', 'pleno', 'bloquePerfecto'].forEach(function (k) {
        if (typeof c.puntos[k] === 'number') { CONFIG.puntos[k] = c.puntos[k]; }
      });
    }
    if (c.limites) {
      ['tandasSeguidas', 'esperaMinutos', 'maximoDiario'].forEach(function (k) {
        var v = c.limites[k];
        if (typeof v === 'number' && v > 0) { CONFIG.limites[k] = v; }
      });
    }
    if (Array.isArray(c.divisiones) && c.divisiones.length) {
      CONFIG.divisiones = c.divisiones
        .filter(function (d) { return d && d.nombre && typeof d.desde === 'number'; })
        .sort(function (a, b) { return a.desde - b.desde; });
    }
  }

  var promesaDatos = null;
  function cargarDatos() {
    if (promesaDatos) { return promesaDatos; }
    promesaDatos = fetch(DATOS, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) { throw new Error('No se pudo leer ' + DATOS + ' (HTTP ' + r.status + ').'); }
      return r.json();
    }).then(function (json) {
      aplicarConfig(json.config);
      var tandas = (json.tandas || []).map(function (t) {
        return Object.assign({ equipaciones: json.equipaciones }, t);
      });
      global.pocPenaltisTandas = tandas;
      return tandas;
    });
    return promesaDatos;
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
    cargar3D();
  }

  /* V2: al volver a una tanda a medias se enseña cómo ibas.
     V4: quien ya ha jugado ve sus números en lugar de las reglas. */
  function pintarEntrada(guardado) {
    $('poc-entrada-numero').textContent = '#' + estado.tanda.numero;
    /* V4.4: ya no es «la tanda del día»: el antetítulo dice en qué punto del bloque vas */
    var lim = limites();
    $('poc-entrada-fecha').textContent = lim.motivo
      ? 'en pausa'
      : (CONFIG.limites.tandasSeguidas - lim.quedanBloque + 1) + ' de ' + CONFIG.limites.tandasSeguidas + ' seguidas';

    var st = estadisticas(null);
    var veterano = st.jugadas > 0;
    $('poc-reglas').hidden = veterano;
    var cifras = $('poc-entrada-cifras');
    cifras.hidden = !veterano;
    if (veterano) {
      pintarCifras(cifras, [
        [st.racha, st.racha === 1 ? 'día de racha' : 'días de racha', st.racha >= 2],
        [numero(st.puntos), 'pts · ' + divisionDe(st.puntos).actual.nombre],
        [numero(st.recordPuntos), 'pts, tu récord']
      ]);
    }
    /* V4.1: el tiempo del primer penalti sale de la config */
    $('poc-regla-segundos').textContent = CONFIG.segundosPorPenalti[0];
    var nota = $('poc-racha-nota');
    var enRiesgo = st.racha > 0 && !st.hoyJugada;
    nota.hidden = !enRiesgo;
    nota.textContent = enRiesgo
      ? 'Llevas ' + plural(st.racha, 'día', 'días') + ' seguidos. Tira hoy para no perder la racha.'
      : '';

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
        var l = limites();
        if (l.motivo) { pintarLimites('entrada'); return; }
        empezar(true);
      }
    };
    estado.aMedias = !!seguir;
    pintarLimites('entrada');
    pintarPlenos('entrada');
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
    dom.estadoTiro = $('poc-estado-tiro');
    dom.reloj = $('poc-reloj');
    dom.relojNum = $('poc-reloj-num');
    dom.relojBarra = $('poc-reloj-barra');
    dom.relojSr = $('poc-tiempo-sr');
    dom.veredictoPuntos = $('poc-veredicto-puntos');
    dom.veredictoLlevas = $('poc-veredicto-llevas');
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
    dom.escena = $('poc-escena');
    dom.escena3d = $('poc-escena3d');
    dom.sonidoBoton = $('poc-sonido');
    dom.sonidoBoton.setAttribute('aria-pressed', String(preferenciaSonido()));
    dom.sonidoBoton.addEventListener('click', alternarSonido);
    /* Precarga del 3D cuando el usuario se acerca a «Empezar» */
    ['pointerenter', 'focus', 'touchstart'].forEach(function (ev) {
      dom.empezar.addEventListener(ev, cargar3D, { once: true, passive: true });
    });

    dom.siguiente.addEventListener('click', siguiente);
    $('poc-compartir').addEventListener('click', compartir);
    document.addEventListener('keydown', teclaGlobal);
    /* V4: un movimiento real del ratón sobre las respuestas reactiva el
       apuntado por hover (y apunta a la opción bajo el cursor). */
    dom.opciones.addEventListener('pointermove', function (e) {
      if (estado.ratonReal || e.pointerType !== 'mouse') { return; }
      estado.ratonReal = true;
      var b = e.target.closest && e.target.closest('.poc-opcion');
      if (b) { apuntar(b.getAttribute('data-poc-esquina'), true); }
    });

    /* V4.1: con la pestaña oculta el reloj no corre */
    document.addEventListener('visibilitychange', function () {
      if (estado.reloj) { estado.reloj.ultimo = performance.now(); }
    });

    /* V4: entorno local sin DS */
    if (document.readyState === 'complete') { repararDS(); } else { global.addEventListener('load', repararDS); }

    var params = new URLSearchParams(global.location.search);
    var demo = params.get('estado');
    var forzada = Number(params.get('tanda')) || null;
    if (params.get('reiniciar')) { borrarTodo(); }
    estado.guardar = !demo;
    $('poc-otra').addEventListener('click', otraTanda);

    /* V4.4: demos de los límites */
    if (demo === 'descanso') {
      LIMITE_DEMO = function () { return { motivo: 'descanso', hasta: arranque + 42 * 60000 + 17000, quedanBloque: 0, quedanHoy: 10, jugadasHoy: 5, enBloque: 0 }; };
    } else if (demo === 'limite') {
      LIMITE_DEMO = function () { var d = new Date(); return { motivo: 'diario', hasta: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), quedanBloque: 0, quedanHoy: 0, jugadasHoy: CONFIG.limites.maximoDiario, enBloque: 0 }; };
    } else if (demo === 'agotadas') {
      LIMITE_DEMO = function () { return { motivo: null, hasta: 0, quedanBloque: 3, quedanHoy: 8, jugadasHoy: 7, enBloque: 2 }; };
    }
    var arranque = Date.now();

    if (demo === 'cargando') { return; }
    if (demo === 'vacio') { mostrar('vacio', $('poc-vista-vacio').querySelector('h2')); return; }

    cargarDatos().then(function (tandas) {
      if (!tandas.length) { mostrar('vacio', $('poc-vista-vacio').querySelector('h2')); return; }
      var porNumero = function (n) { return tandas.filter(function (t) { return t.numero === n; })[0]; };
      /* ?tanda=N fuerza una; las demos usan la primera; si no, la siguiente sin jugar */
      var tanda = (forzada && porNumero(forzada)) || (demo ? tandasOrdenadas()[0] : siguienteTanda());

      if (!tanda) {
        /* no quedan tandas nuevas: el resultado de la última, con el aviso */
        var hist = historial();
        var ultima = hist.length ? porNumero(hist[hist.length - 1].numero) : tandasOrdenadas()[0];
        estado.tanda = ultima;
        estado.tiros = (leer(claveTanda(ultima.numero)) || {}).tiros || [];
        if (estado.tiros.length === TIROS_POR_TANDA) { pintarResultado(true); } else { pintarEntrada(null); }
        return;
      }

      if (demo === 'error') {
        /* Tanda rota a propósito para enseñar el validador. */
        tanda = JSON.parse(JSON.stringify(tanda));
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

      var demoTiros = function (n) {
        return tanda.preguntas.slice(0, n).map(function (p, i) {
          var gol = i !== 2;
          var segundos = gol ? 6 - i : 0;
          return { elegida: gol ? p.correcta : (p.correcta + 1) % 4, correcta: p.correcta, gol: gol,
            segundos: segundos, puntos: puntosTiro(gol, segundos) };
        });
      };

      if (demo === 'entrada' || demo === 'descanso' || demo === 'limite') { pintarEntrada(null); return; }
      if (demo === 'seguir') { pintarEntrada({ tiros: demoTiros(3), completada: false }); return; }
      if (demo === 'juego') { empezar(true); return; }
      if (demo === 'gol' || demo === 'parada') {
        empezar(true);
        var correcta = tanda.preguntas[0].correcta;
        Promise.race([cargar3D(), esperar(6000)]).then(function () {
          responder(demo === 'gol' ? correcta : (correcta + 1) % 4, true);
        });
        return;
      }
      if (demo === 'tiempo') {
        /* V4.1: se agota el reloj del primer penalti */
        empezar(true);
        Promise.race([cargar3D(), esperar(6000)]).then(function () { responder(-1, true); });
        return;
      }
      if (demo === 'perfecto') {
        /* V4.5: quinto pleno seguido del bloque */
        estado.tiros = tanda.preguntas.map(function (p) { return { elegida: p.correcta, correcta: p.correcta, gol: true, segundos: 6, puntos: puntosTiro(true, 6) }; });
        estado.demoBonus = CONFIG.puntos.bloquePerfecto;
        pintarResultado(false);
        return;
      }
      if (demo === 'plenos') {
        estado.demoPlenos = { jugadas: 3, plenos: 3, vivo: true, faltan: 2 };
        pintarEntrada(null);
        return;
      }
      if (demo === 'resultado' || demo === 'jugado' || demo === 'agotadas') {
        estado.tiros = demoTiros(TIROS_POR_TANDA);
        if (demo === 'agotadas') { estado.sinMas = true; }
        pintarResultado(demo === 'jugado');
        return;
      }

      var guardado = leer(claveTanda(tanda.numero));
      if (guardado && guardado.completada && guardado.tiros.length === TIROS_POR_TANDA) {
        estado.tiros = guardado.tiros;
        pintarResultado(true);
        return;
      }
      pintarEntrada(guardado);
    }).catch(function (e) {
      /* V4.1: el JSON no se puede leer o está mal formado */
      if (global.console) { global.console.error(e); }
      var ul = $('poc-error-detalle');
      ul.innerHTML = '';
      var li = document.createElement('li');
      li.textContent = (e && e.message) || 'No se pudieron cargar las preguntas.';
      ul.appendChild(li);
      mostrar('error', $('poc-vista-error').querySelector('h2'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }

  /* Expuesto solo para pruebas automatizadas del POC. */
  global.pocPenaltis = { validar: validar, estado: estado, estadisticas: estadisticas, config: CONFIG };
}(window));
