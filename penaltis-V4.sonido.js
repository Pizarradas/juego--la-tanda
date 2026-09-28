/* ==========================================================
   La tanda · V4.17–V4.20 · SONIDO
   Motor de audio común a la escena 3D y a la ilustración 2D.

   - Web Audio: suena en el hilo de audio del navegador y no compite con
     la animación. En el hilo principal solo se crean unos pocos nodos por
     evento.
   - 0 KB: todo se sintetiza. No se crea nada hasta que el jugador activa
     el sonido (hace falta un toque para que el navegador lo permita).
   - Silenciado por defecto. La preferencia la guarda penaltis-V4.juego.js.
   - Batería: con la pestaña oculta o fuera de la tanda, el contexto de
     audio se suspende; el ambiente de grada solo suena durante el juego.
   - iPhone: sesión de audio «playback» (V4.18). Como el sonido solo se
     enciende a petición del jugador, suena aunque el interruptor de
     silencio esté puesto. Contrapartida: pausa la música o el pódcast que
     sonara de fondo, como cualquier vídeo.
   - V4.20 · HÍBRIDO: los sonidos donde la síntesis se nota (golpeo,
     silbato, parada, gritos, aplauso y grada) son grabaciones con licencia
     abierta, en dos archivos: assets/audio/efectos.mp3 (sprite de efectos
     cortos, mapa en efectos.json) y assets/audio/grada.mp3 (bucle). Los
     genera tools/audio.py y su procedencia está en assets/PROCEDENCIA.md.
     Se descargan solo al activar el sonido. Los de interfaz (toque, tic,
     confirmación, sintonía) y la red siguen sintetizados. Si un archivo
     falta, falla o aún no ha llegado, suena el sintetizado: nunca mudo.

   API (window.pocSonido):
     activar(bool) · activo()
     ambiente(bool)                 grada en bucle (solo durante el juego)
     silbato() golpeo() red() parada() grito(gol)
     toque()                        al elegir respuesta
     tic(segundo)                   últimos segundos del reloj
     final(goles, total)            pitido final + sintonía según el marcador
     perfecto()                     bonus de bloque perfecto
   ========================================================== */
(function (global) {
  'use strict';

  /* V4.20: grabaciones. La versión evita que la caché sirva un sprite
     viejo con un mapa nuevo (subirla al regenerar con tools/audio.py). */
  var VERSION_AUDIO = '1';
  var RUTA = 'assets/audio/';

  var AC = global.AudioContext || global.webkitAudioContext;
  var ctx = null;
  var maestro = null;
  var ruidoBuf = null;
  var amb = null;          /* { src, gain } */
  var encendido = false;
  var enJuego = false;
  var sprite = null;       /* { buf, mapa } cuando efectos.mp3 está listo */
  var gradaGrabada = null; /* { buf, bucle: [ini, fin] } */
  var cargando = false;
  var apagarTimer = 0;

  function ahora() { return ctx.currentTime; }

  function preparar() {
    if (ctx || !AC) { return !!ctx; }
    /* V4.18: sesión «playback». El jugador ha pedido el sonido tocando el
       altavoz: en iPhone debe oírse aunque el interruptor de silencio esté
       puesto (con «ambient» quedaba mudo y parecía roto). */
    try {
      if (global.navigator && navigator.audioSession) { navigator.audioSession.type = 'playback'; }
    } catch (e) { /* no disponible */ }
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    maestro = ctx.createGain();
    maestro.gain.value = 0;
    /* V4.18: limitador para que grito + red + grada no saturen */
    var limitador = ctx.createDynamicsCompressor();
    limitador.threshold.value = -8;
    limitador.knee.value = 6;
    limitador.ratio.value = 12;
    limitador.attack.value = 0.003;
    limitador.release.value = 0.2;
    maestro.connect(limitador).connect(ctx.destination);
    generarRuido();
    cargarMuestras();
    return true;
  }

  /* 2 s de ruido marrón compartido por grada, red y paradas. Se genera
     por trozos de 0,25 s para no bloquear el toque que
     activa el sonido; hasta que está listo, los sonidos de ruido se
     omiten (los tonos suenan ya). */
  function generarRuido() {
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var paso = Math.floor(ctx.sampleRate / 4);
    var i = 0, ultimo = 0;
    /* V4.18: setTimeout y no requestIdleCallback: con el 3D animando casi
       no hay tiempo libre y la grada tardaba segundos en arrancar. Cada
       trozo cuesta 1–3 ms. */
    var libre = function (fn) { return setTimeout(fn, 0); };
    (function trozo() {
      var fin = Math.min(len, i + paso);
      for (; i < fin; i++) {
        ultimo = (ultimo + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = ultimo * 3.2;
      }
      if (i < len) { libre(trozo); return; }
      ruidoBuf = buf;
      if (enJuego && encendido) { ambienteOn(); }
    })();
  }

  function descargar(nombre) {
    return fetch(RUTA + nombre + '?v=' + VERSION_AUDIO).then(function (r) {
      if (!r.ok) { throw new Error(nombre + ' ' + r.status); }
      return r;
    });
  }

  function decodificar(ab) {
    /* forma con callbacks: Safari antiguo no devuelve promesa */
    return new Promise(function (ok, ko) { ctx.decodeAudioData(ab, ok, ko); });
  }

  /* V4.20: una vez, al activar el sonido. Primero el mapa, luego los dos
     MP3 en paralelo. El decodificado ocurre fuera del hilo principal. */
  function cargarMuestras() {
    if (cargando) { return; }
    cargando = true;
    descargar('efectos.json').then(function (r) { return r.json(); }).then(function (mapa) {
      var efectos = mapa.efectos && Object.keys(mapa.efectos).length
        ? descargar('efectos.mp3').then(function (r) { return r.arrayBuffer(); }).then(decodificar)
          .then(function (buf) { sprite = { buf: buf, mapa: mapa.efectos }; })
        : null;
      var grada = mapa.grada
        ? descargar('grada.mp3').then(function (r) { return r.arrayBuffer(); }).then(decodificar)
          .then(function (buf) {
            gradaGrabada = { buf: buf, bucle: mapa.grada.bucle };
            /* si ya sonaba la sintetizada, se cambia por la grabada */
            if (amb && amb.sintetica) { ambienteOff(false); ambienteOn(); }
          })
        : null;
      return Promise.all([efectos, grada].map(function (p) {
        return p && p.catch(function (e) { if (global.console) { console.warn('[sonido]', e); } });
      }));
    }).catch(function (e) {
      /* sin grabaciones: todo sintetizado */
      if (global.console) { console.warn('[sonido] sin grabaciones:', e); }
    });
  }

  function tiene(k) { return !!(sprite && sprite.mapa[k]); }

  /* Reproduce un efecto del sprite. Devuelve false si no está (y entonces
     el llamante sintetiza). corte: segundos máximos (para el pitido final). */
  function muestra(k, vol, retraso, corte) {
    if (!tiene(k)) { return false; }
    var m = sprite.mapa[k];
    var t0 = ahora() + (retraso || 0);
    var dur = corte ? Math.min(corte, m.duracion) : m.duracion;
    var s = ctx.createBufferSource(); s.buffer = sprite.buf;
    var g = ctx.createGain();
    var v = vol == null ? 1 : vol;
    g.gain.setValueAtTime(v, t0);
    if (corte) {
      /* cortar sin chasquido */
      g.gain.setValueAtTime(v, t0 + dur - 0.04);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    }
    s.connect(g).connect(maestro);
    s.start(t0, m.inicio, dur);
    return true;
  }

  /* V4.18: desbloqueo en el mismo toque (Safari antiguo solo «abre» el
     audio si algo suena dentro del gesto) y reanudar también el estado
     «interrupted» de iOS (llamada, otra app, bloqueo de pantalla). */
  function despertar() {
    if (!ctx) { return; }
    if (ctx.state !== 'running' && ctx.state !== 'closed') { try { ctx.resume(); } catch (e) { /* nada */ } }
    try {
      var b = ctx.createBuffer(1, 1, ctx.sampleRate);
      var s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    } catch (e) { /* nada */ }
  }

  function listo() { return ctx && encendido && ctx.state !== 'closed'; }

  function ruido(dur, tipo, frec, q, vol, ataque, retraso) {
    if (!ruidoBuf) { return; }
    var t0 = ahora() + (retraso || 0);
    var src = ctx.createBufferSource(); src.buffer = ruidoBuf;
    var f = ctx.createBiquadFilter(); f.type = tipo; f.frequency.value = frec; f.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(maestro);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  function tono(frec, dur, vol, tipo, retraso, frecFin) {
    var t0 = ahora() + (retraso || 0);
    var o = ctx.createOscillator(); o.type = tipo || 'sine';
    o.frequency.setValueAtTime(frec, t0);
    if (frecFin) { o.frequency.exponentialRampToValueAtTime(frecFin, t0 + dur); }
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(maestro);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function pitido(dur, retraso) {
    var t0 = ahora() + (retraso || 0);
    [2850, 3050].forEach(function (fq) {
      var o = ctx.createOscillator(); o.frequency.value = fq;
      var trem = ctx.createOscillator(); trem.frequency.value = 32;
      var tg = ctx.createGain(); tg.gain.value = 0.5;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
      g.gain.setValueAtTime(0.05, t0 + dur - 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      trem.connect(tg).connect(g.gain);
      o.connect(g).connect(maestro);
      o.start(t0); trem.start(t0); o.stop(t0 + dur + 0.02); trem.stop(t0 + dur + 0.02);
    });
  }

  /* ---------- ambiente de grada ---------- */
  /* V4.21: la grada grabada viene normalizada a -24 dB RMS; con 0,5 queda
     de fondo (unos -30 dB RMS) sin tapar golpeo ni gritos */
  var NIVEL_GRADA = 0.3;
  var NIVEL_GRADA_GRABADA = 0.5;
  function nivelGrada() { return amb && !amb.sintetica ? NIVEL_GRADA_GRABADA : NIVEL_GRADA; }

  function ambienteOn() {
    if (amb || !listo()) { return; }
    var grabado = !!gradaGrabada;
    if (!grabado && !ruidoBuf) { return; } /* llegará al terminar generarRuido() */
    var src = ctx.createBufferSource();
    src.loop = true;
    var g = ctx.createGain(); g.gain.value = 0.0001;
    if (grabado) {
      src.buffer = gradaGrabada.buf;
      src.loopStart = gradaGrabada.bucle[0];
      src.loopEnd = gradaGrabada.bucle[1];
      src.connect(g);
    } else {
      src.buffer = ruidoBuf;
      /* V4.18: rumor grave + banda media. Los altavoces del móvil apenas
         dan graves: solo con el paso bajo, la grada no se oía. */
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
      var gm = ctx.createGain(); gm.gain.value = 2.2;
      src.connect(lp).connect(g);
      src.connect(bp).connect(gm).connect(g);
    }
    g.connect(maestro);
    if (grabado) { src.start(0, gradaGrabada.bucle[0]); } else { src.start(); }
    amb = { src: src, gain: g, sintetica: !grabado };
    g.gain.setTargetAtTime(nivelGrada(), ahora(), 0.4);
  }

  function ambienteOff(lento) {
    if (!amb) { return; }
    var a = amb; amb = null;
    a.gain.gain.setTargetAtTime(0.0001, ahora(), lento ? 0.6 : 0.1);
    try { a.src.stop(ahora() + (lento ? 3 : 0.6)); } catch (e) { /* ya parado */ }
  }

  function subirGrada(nivel, dur) {
    if (!amb) { return; }
    var t0 = ahora();
    amb.gain.gain.setTargetAtTime(nivel, t0, 0.1);
    amb.gain.gain.setTargetAtTime(nivelGrada(), t0 + dur, 0.8);
  }

  /* ---------- energía: suspender cuando no hace falta ---------- */
  function revisar() {
    if (!ctx) { return; }
    clearTimeout(apagarTimer);
    var necesita = encendido && !document.hidden;
    if (necesita && ctx.state !== 'running' && ctx.state !== 'closed') { ctx.resume(); }
    if (!necesita && ctx.state === 'running') {
      /* se deja terminar el fundido antes de suspender */
      apagarTimer = setTimeout(function () { if (ctx.state === 'running') { ctx.suspend(); } }, 400);
    }
    if (encendido && !enJuego && !amb) {
      /* fuera del juego y sin grada: tras la última cola, a dormir */
      apagarTimer = setTimeout(function () { if (!enJuego && ctx.state === 'running') { ctx.suspend(); } }, 6000);
    }
  }

  document.addEventListener('visibilitychange', revisar);
  global.addEventListener('pagehide', function () { if (ctx && ctx.state === 'running') { ctx.suspend(); } });

  var api = {
    disponible: !!AC,
    activo: function () { return encendido; },
    /* solo pruebas: 'sin-crear' | 'running' | 'suspended' */
    estado: function () { return ctx ? ctx.state : 'sin-crear'; },
    /* solo pruebas: qué grabaciones están cargadas */
    grabaciones: function () { return { efectos: sprite ? Object.keys(sprite.mapa) : [], grada: !!gradaGrabada }; },

    activar: function (v) {
      encendido = !!v;
      if (encendido && !preparar()) { encendido = false; return false; }
      if (!ctx) { return false; }
      if (encendido) {
        despertar();
        maestro.gain.setTargetAtTime(0.9, ahora(), 0.08);
        if (enJuego) { ambienteOn(); }
        /* confirmación inmediata: «ya suena» (antes no se oía nada hasta el tiro) */
        tono(660, 0.09, 0.14, 'triangle', 0.05);
        tono(990, 0.14, 0.14, 'triangle', 0.14);
      } else {
        maestro.gain.setTargetAtTime(0, ahora(), 0.08);
        ambienteOff(false);
      }
      revisar();
      return encendido;
    },

    ambiente: function (v) {
      enJuego = !!v;
      if (!ctx) { return; }
      if (enJuego) {
        if (encendido && ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) { ctx.resume(); }
        ambienteOn();
      } else {
        ambienteOff(true);
      }
      revisar();
    },

    silbato: function () {
      if (!listo()) { return; }
      if (!muestra('silbato', 0.8, 0, 0.5)) { pitido(0.42); }
    },

    golpeo: function () {
      if (!listo()) { return; }
      if (muestra('golpeo', 1)) { return; }
      tono(140, 0.18, 0.5, 'sine', 0, 45);
      ruido(0.08, 'highpass', 1800, 0.7, 0.25, 0.003);
    },

    red: function () {
      if (!listo()) { return; }
      /* la red sigue sintetizada: no hay grabación abierta que convenza */
      ruido(0.45, 'bandpass', 2600, 0.8, 0.18, 0.01);
    },

    parada: function () {
      if (!listo()) { return; }
      if (muestra('parada', 0.9)) { return; }
      ruido(0.12, 'lowpass', 500, 0.7, 0.5, 0.004);
    },

    grito: function (gol) {
      if (!listo()) { return; }
      if (!muestra(gol ? 'grito_gol' : 'grito_parada', 0.9)) {
        /* dos capas: rugido grave + «¡ahhh!» medio */
        ruido(gol ? 2.6 : 1.4, 'bandpass', gol ? 1100 : 450, 0.6, gol ? 0.5 : 0.26, gol ? 0.18 : 0.3);
        ruido(gol ? 2.2 : 1.1, 'bandpass', gol ? 520 : 300, 0.9, gol ? 0.35 : 0.18, 0.12);
      }
      subirGrada(nivelGrada() * (gol ? 1.6 : 1.15), 2.2);
    },

    toque: function () {
      if (!listo()) { return; }
      tono(880, 0.06, 0.08, 'triangle');
    },

    tic: function (segundo) {
      if (!listo()) { return; }
      /* 3, 2, 1: más agudo cuanto menos queda */
      tono(segundo <= 1 ? 1320 : 990, 0.07, 0.1, 'square');
    },

    final: function (goles, total) {
      if (!listo()) { return; }
      /* pitido final: dos cortos y uno largo (grabado si está) */
      if (tiene('silbato')) {
        muestra('silbato', 0.8, 0, 0.2);
        muestra('silbato', 0.8, 0.32, 0.2);
        muestra('silbato', 0.8, 0.64, 0.8);
      } else {
        pitido(0.22, 0);
        pitido(0.22, 0.32);
        pitido(0.7, 0.64);
      }
      var t = 1.5;
      /* V4.20: con buen resultado, aplauso grabado bajo la sintonía */
      var aplauso = goles >= Math.ceil(total / 2) && muestra('aplauso', goles === total ? 0.9 : 0.6, t - 0.2);
      if (goles === total) {
        /* pleno: arpegio mayor ascendente + ovación */
        [523, 659, 784, 1047].forEach(function (f, i) { tono(f, 0.35, 0.12, 'triangle', t + i * 0.11); });
        if (!aplauso) { ruido(3, 'bandpass', 1000, 0.6, 0.45, 0.2, t); }
      } else if (goles >= Math.ceil(total / 2)) {
        [523, 659, 784].forEach(function (f, i) { tono(f, 0.3, 0.1, 'triangle', t + i * 0.12); });
        if (!aplauso) { ruido(1.8, 'bandpass', 900, 0.6, 0.3, 0.2, t); }
      } else {
        [392, 330].forEach(function (f, i) { tono(f, 0.4, 0.09, 'triangle', t + i * 0.2); });
      }
    },

    perfecto: function () {
      if (!listo()) { return; }
      [784, 988, 1175, 1568].forEach(function (f, i) { tono(f, 0.5, 0.1, 'triangle', 2.3 + i * 0.09); });
    }
  };

  global.pocSonido = api;
})(window);
