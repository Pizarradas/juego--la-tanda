/* ==========================================================
   La tanda · V4.17 · SONIDO
   Motor de audio común a la escena 3D y a la ilustración 2D.

   - Web Audio: suena en el hilo de audio del navegador y no compite con
     la animación. En el hilo principal solo se crean unos pocos nodos por
     evento.
   - 0 KB: todo se sintetiza. No se crea nada hasta que el jugador activa
     el sonido (hace falta un toque para que el navegador lo permita).
   - Silenciado por defecto. La preferencia la guarda penaltis-V4.juego.js.
   - Batería: con la pestaña oculta o fuera de la tanda, el contexto de
     audio se suspende; el ambiente de grada solo suena durante el juego.
   - iPhone: sesión de audio «ambient»: respeta el interruptor de silencio
     y no corta la música o el pódcast que el lector ya esté escuchando.
   - Muestras grabadas (opcional): si MUESTRAS trae la URL de un sonido, se
     descarga al activar el sonido y sustituye al sintetizado. Si falla o no
     ha llegado todavía, suena el sintetizado. Formato recomendado: .m4a
     (AAC) o .mp3 mono, 32–64 kbps, menos de 60 KB por clip.

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

  /* Hueco para muestras grabadas. Vacío = todo sintetizado.
     Ej.: { grito_gol: 'assets/audio/gol.m4a', ambiente: 'assets/audio/grada.m4a' } */
  var MUESTRAS = {};

  var AC = global.AudioContext || global.webkitAudioContext;
  var ctx = null;
  var maestro = null;
  var ruidoBuf = null;
  var amb = null;          /* { src, gain } */
  var encendido = false;
  var enJuego = false;
  var buffers = {};        /* muestras decodificadas */
  var apagarTimer = 0;

  function ahora() { return ctx.currentTime; }

  function preparar() {
    if (ctx || !AC) { return !!ctx; }
    try {
      if (global.navigator && navigator.audioSession) { navigator.audioSession.type = 'ambient'; }
    } catch (e) { /* no disponible */ }
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    maestro = ctx.createGain();
    maestro.gain.value = 0;
    maestro.connect(ctx.destination);
    generarRuido();
    cargarMuestras();
    return true;
  }

  /* 2 s de ruido marrón compartido por grada, red y paradas. Se genera
     por trozos de 0,25 s en tiempo libre para no bloquear el toque que
     activa el sonido; hasta que está listo, los sonidos de ruido se
     omiten (los tonos suenan ya). */
  function generarRuido() {
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var paso = Math.floor(ctx.sampleRate / 4);
    var i = 0, ultimo = 0;
    var libre = global.requestIdleCallback || function (fn) { return setTimeout(fn, 0); };
    (function trozo() {
      var fin = Math.min(len, i + paso);
      for (; i < fin; i++) {
        ultimo = (ultimo + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = ultimo * 3.2;
      }
      if (i < len) { libre(trozo, { timeout: 200 }); return; }
      ruidoBuf = buf;
      if (enJuego && encendido) { ambienteOn(); }
    })();
  }

  function cargarMuestras() {
    Object.keys(MUESTRAS).forEach(function (k) {
      if (!MUESTRAS[k] || buffers[k]) { return; }
      buffers[k] = 'cargando';
      fetch(MUESTRAS[k]).then(function (r) {
        if (!r.ok) { throw new Error(r.status); }
        return r.arrayBuffer();
      }).then(function (ab) {
        return new Promise(function (ok, ko) { ctx.decodeAudioData(ab, ok, ko); });
      }).then(function (buf) { buffers[k] = buf; })
        .catch(function () { delete buffers[k]; });
    });
  }

  /* Reproduce una muestra si está lista; si no, devuelve false */
  function muestra(k, vol) {
    var b = buffers[k];
    if (!b || b === 'cargando') { return false; }
    var s = ctx.createBufferSource(); s.buffer = b;
    var g = ctx.createGain(); g.gain.value = vol == null ? 1 : vol;
    s.connect(g).connect(maestro); s.start();
    return true;
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
  function ambienteOn() {
    if (amb || !listo()) { return; }
    var grabado = buffers.ambiente && buffers.ambiente !== 'cargando';
    if (!grabado && !ruidoBuf) { return; } /* llegará al terminar generarRuido() */
    var src = ctx.createBufferSource();
    src.loop = true;
    var g = ctx.createGain(); g.gain.value = 0.0001;
    if (grabado) {
      src.buffer = buffers.ambiente;
      src.connect(g);
    } else {
      src.buffer = ruidoBuf;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      src.connect(lp).connect(g);
    }
    g.connect(maestro);
    src.start();
    g.gain.setTargetAtTime(0.3, ahora(), 0.4);
    amb = { src: src, gain: g };
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
    amb.gain.gain.setTargetAtTime(0.3, t0 + dur, 0.8);
  }

  /* ---------- energía: suspender cuando no hace falta ---------- */
  function revisar() {
    if (!ctx) { return; }
    clearTimeout(apagarTimer);
    var necesita = encendido && !document.hidden;
    if (necesita && ctx.state === 'suspended') { ctx.resume(); }
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

    activar: function (v) {
      encendido = !!v;
      if (encendido && !preparar()) { encendido = false; return false; }
      if (!ctx) { return false; }
      if (encendido) {
        if (ctx.state === 'suspended') { ctx.resume(); }
        maestro.gain.setTargetAtTime(0.9, ahora(), 0.08);
        if (enJuego) { ambienteOn(); }
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
        if (encendido && ctx.state === 'suspended' && !document.hidden) { ctx.resume(); }
        ambienteOn();
      } else {
        ambienteOff(true);
      }
      revisar();
    },

    silbato: function () { if (listo()) { pitido(0.42); } },

    golpeo: function () {
      if (!listo()) { return; }
      if (muestra('golpeo', 0.9)) { return; }
      tono(140, 0.18, 0.5, 'sine', 0, 45);
      ruido(0.08, 'highpass', 1800, 0.7, 0.25, 0.003);
    },

    red: function () {
      if (!listo()) { return; }
      if (muestra('red', 0.8)) { return; }
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
      subirGrada(gol ? 0.75 : 0.45, 2.2);
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
      /* pitido final: dos cortos y uno largo */
      pitido(0.22, 0);
      pitido(0.22, 0.32);
      pitido(0.7, 0.64);
      if (muestra(goles >= Math.ceil(total / 2) ? 'final_bien' : 'final_mal', 0.9)) { return; }
      var t = 1.5;
      if (goles === total) {
        /* pleno: arpegio mayor ascendente + ovación */
        [523, 659, 784, 1047].forEach(function (f, i) { tono(f, 0.35, 0.12, 'triangle', t + i * 0.11); });
        ruido(3, 'bandpass', 1000, 0.6, 0.45, 0.2, t);
      } else if (goles >= Math.ceil(total / 2)) {
        [523, 659, 784].forEach(function (f, i) { tono(f, 0.3, 0.1, 'triangle', t + i * 0.12); });
        ruido(1.8, 'bandpass', 900, 0.6, 0.3, 0.2, t);
      } else {
        [392, 330].forEach(function (f, i) { tono(f, 0.4, 0.09, 'triangle', t + i * 0.2); });
      }
    },

    perfecto: function () {
      if (!listo()) { return; }
      if (muestra('perfecto', 0.9)) { return; }
      [784, 988, 1175, 1568].forEach(function (f, i) { tono(f, 0.5, 0.1, 'triangle', 2.3 + i * 0.09); });
    }
  };

  global.pocSonido = api;
})(window);
