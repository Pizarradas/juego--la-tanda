/* ==========================================================
   POC La tanda (V4) — escena 3D (Three.js r186)
   V4 · animación: clips propios con interpolación suave (Catmull-Rom
   horneado a 30 fps) en lugar de tramos lineales, pies planos y
   anclados al suelo, altura del cuerpo resuelta contra el césped
   (nada lo atraviesa), carrera sincronizada con la distancia (sin
   patinar) y coreografías nuevas: patada con armado y salto de
   continuación, estirada en fases (impulso, vuelo, caída, suelo),
   V4.6: tras la estirada el portero se levanta: si para, celebra;
   si encaja, se sienta, se lamenta y mira a la red. Nada flota.
   parada del centro, celebración y lamento con movimiento.
   ----------------------------------------------------------
   La escena SOLO representa: la lógica (penaltis-V3.juego.js)
   decide esquina, resultado y estirada y llama a tirar().

   Contrato con la lógica (mismo que la escena SVG de reserva):
     preparar({ indice, equipaciones })   deja la jugada lista
     apuntar(esquina | null)               trayectoria prevista
     tirar({ esquina, gol, estirada, instantaneo }) -> Promise al resolverse
     resultado({ correcta, elegida })      marca las esquinas tras el tiro
     cancelarRepeticion()
     sonido(activo)
     destruir()

   Todo es determinista: el estado de la jugada es una función
   pura del tiempo t (evaluar(t)). Eso permite repetir la jugada
   con otra cámara y a cámara lenta sin grabar nada.

   Assets: jugador.glb (Quaternius, CC0) con sus clips Idle y Run.
   La patada, la estirada, el portero preparado y las celebraciones
   son clips propios generados aquí sobre el mismo esqueleto.
   Portería, red, balón y estadio son geometría procedural.
========================================================== */
import * as T from './assets/vendor/three-penaltis.min.js';

const URL_JUGADOR = new URL('./assets/3d/jugador.glb', import.meta.url).href;

/* ---------- Medidas reales (metros) ---------- */
const ALTURA_JUGADOR = 1.8;
const ALTURA_MODELO = 4.84;
const ESCALA = ALTURA_JUGADOR / ALTURA_MODELO;
const PORTERIA = { ancho: 7.32, alto: 2.44, fondoSuelo: 2.0, fondoLarguero: 1.0, poste: 0.06 };
const PUNTO_PENALTI = new T.Vector3(0, 0.11, 11);
const RADIO_BALON = 0.11;

/* Centro de cada esquina en la línea de gol (x, y). A-B arriba, C-D abajo;
   izquierda/derecha vistas desde detrás del lanzador. */
const DIANAS = {
  A: new T.Vector2(-2.75, 1.85),
  B: new T.Vector2(2.75, 1.85),
  C: new T.Vector2(-2.75, 0.42),
  D: new T.Vector2(2.75, 0.42)
};

/* Guion de la jugada (segundos). */
const TL = {
  carrera: 0.35,     /* empieza la carrera */
  patada: 0.96,      /* arranca el clip de patada */
  contacto: 1.10,    /* el pie toca el balón */
  llegada: 1.45,     /* el balón llega a la línea / a las manos */
  resolucion: 1.62,  /* se puede anunciar el resultado */
  fin: 4.9           /* V4.6: la escena queda quieta cuando el portero ya se ha levantado */
};

const REPETICION = { desde: 0.8, hasta: 2.05, velocidad: 0.42 };

/* Equipaciones por defecto; la tanda puede traer las suyas. */
const EQUIPACION_BASE = {
  /* Inspirada en el Barça: rayas verticales azul y grana, pantalón azul marino
     y dorsal amarillo. Sin escudo ni marcas. */
  lanzador: { patron: 'rayas', rayas: ['#a50044', '#004d98'], mangas: '#004d98', camiseta: '#a50044', detalle: '#004d98', pantalon: '#0a2a66', medias: '#0a2a66', botas: '#111111', dorsal: '9', colorDorsal: '#f7d117', piel: '#e0ac86', pelo: '#2b1b12' },
  portero: { camiseta: '#f2c200', detalle: '#111111', pantalon: '#111111', medias: '#f2c200', botas: '#111111', dorsal: '1', colorDorsal: '#111111', piel: '#c68863', pelo: '#111111', guantes: '#ffffff' }
};

/* ==========================================================
   UTILIDADES
========================================================== */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, u) => a + (b - a) * u;
const tramo = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const suave = (u) => u * u * (3 - 2 * u);
const salida = (u) => 1 - Math.pow(1 - u, 3);
const entrada = (u) => u * u * u;
const enSalida = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const campana = (u) => Math.sin(clamp(u, 0, 1) * Math.PI);
const rad = (g) => g * Math.PI / 180;

function bezier(p0, p1, p2, u, dest) {
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return dest.set(
    a * p0.x + b * p1.x + c * p2.x,
    a * p0.y + b * p1.y + c * p2.y,
    a * p0.z + b * p1.z + c * p2.z
  );
}

function lienzo(ancho, alto, pintar) {
  const c = document.createElement('canvas');
  c.width = ancho; c.height = alto;
  pintar(c.getContext('2d'), ancho, alto);
  const tx = new T.CanvasTexture(c);
  tx.colorSpace = T.SRGBColorSpace;
  return tx;
}

function esMovil() {
  return Math.min(window.innerWidth, window.innerHeight) < 700 || /Mobi|Android/i.test(navigator.userAgent);
}

/* ==========================================================
   POSES: rotaciones en espacio del personaje
   (+X izquierda del jugador, +Y arriba, +Z hacia donde mira),
   relativas a la pose de reposo del GLB. Cada hueso gira en el
   marco de su padre EN REPOSO, así una rodilla dobla igual
   aunque el muslo esté levantado (FK clásica).
========================================================== */
const EJE = { x: new T.Vector3(1, 0, 0), y: new T.Vector3(0, 1, 0), z: new T.Vector3(0, 0, 1) };

function prepararPoser(modelo) {
  modelo.updateMatrixWorld(true);
  const reposo = {};
  modelo.traverse((o) => {
    if (o.isBone) {
      reposo[o.name] = {
        local: o.quaternion.clone(),
        padre: o.parent.getWorldQuaternion(new T.Quaternion())
      };
    }
  });
  const raiz = modelo.getWorldQuaternion(new T.Quaternion());
  const raizInv = raiz.clone().invert();

  function cuaternion(nombre, giros) {
    const r = reposo[nombre];
    if (!giros || !giros.length) { return r.local.clone(); }
    const P = raizInv.clone().multiply(r.padre); /* padre en espacio del personaje */
    let R = new T.Quaternion();
    giros.forEach(([eje, grados]) => {
      R = new T.Quaternion().setFromAxisAngle(EJE[eje], rad(grados)).multiply(R);
    });
    return P.clone().invert().multiply(R).multiply(P).multiply(r.local);
  }

  /* fotogramas: [{ t, pose: { Hueso: [['x', 30], ...] } }] */
  function clip(nombre, fotogramas) {
    const huesos = Object.keys(reposo);
    const tiempos = fotogramas.map((f) => f.t);
    const pistas = huesos.map((h) => {
      const valores = [];
      fotogramas.forEach((f) => { cuaternion(h, f.pose[h]).toArray(valores, valores.length); });
      return new T.QuaternionKeyframeTrack(h + '.quaternion', tiempos, valores);
    });
    return new T.AnimationClip(nombre, tiempos[tiempos.length - 1], pistas);
  }

  /* V4: clip suave. Las claves se interpolan con Catmull-Rom sobre el
     cuaternión de cada hueso y se hornean a 30 fps, así la velocidad es
     continua entre poses (nada de arrancar y frenar en seco en cada clave).
     claves: [{ t, pose, ease? }]; bucle: la última clave debe repetir la primera. */
  function clipSuave(nombre, claves, opc = {}) {
    const fps = opc.fps || 30;
    const bucle = !!opc.bucle;
    const huesos = Object.keys(reposo);
    const dur = claves[claves.length - 1].t;
    const n = Math.max(2, Math.round(dur * fps) + 1);
    const tiempos = [];
    for (let i = 0; i < n; i++) tiempos.push(dur * i / (n - 1));
    const pistas = huesos.map((h) => {
      const qs = claves.map((c) => cuaternion(h, c.pose[h]));
      const valores = [];
      tiempos.forEach((t) => { muestrear(qs, claves, t, bucle).toArray(valores, valores.length); });
      return new T.QuaternionKeyframeTrack(h + '.quaternion', tiempos, valores);
    });
    return new T.AnimationClip(nombre, dur, pistas);
  }

  function muestrear(qs, claves, t, bucle) {
    const n = qs.length;
    let i = 0;
    while (i < n - 2 && t > claves[i + 1].t) i++;
    const t0 = claves[i].t, t1 = claves[i + 1].t;
    let u = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 0;
    if (claves[i + 1].ease) u = claves[i + 1].ease(u);
    const idx = (k) => (bucle ? (((k % (n - 1)) + (n - 1)) % (n - 1)) : clamp(k, 0, n - 1));
    const ref = qs[i];
    const q = [qs[idx(i - 1)], qs[i], qs[i + 1], qs[idx(i + 2)]].map((a) => {
      const c = a.clone();
      if (c.dot(ref) < 0) c.set(-c.x, -c.y, -c.z, -c.w);
      return c;
    });
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    return new T.Quaternion(
      cr(q[0].x, q[1].x, q[2].x, q[3].x), cr(q[0].y, q[1].y, q[2].y, q[3].y),
      cr(q[0].z, q[1].z, q[2].z, q[3].z), cr(q[0].w, q[1].w, q[2].w, q[3].w)
    ).normalize();
  }

  return { clip, clipSuave };
}

/* ---------- Poses (V4) ----------
   Convención: UpperLeg x+ = pierna atrás, x- = adelante; LowerLeg x+ = doblar
   rodilla; UpperArm z+ (L) / z- (R) = levantar el brazo por el lado; x- = brazo
   adelante; LowerArm x- = doblar codo; Abdomen/Torso x+ = inclinarse adelante,
   y = girar el tronco, z = inclinarse de lado; Neck x- = mirar arriba. */
const POSE = {
  /* ---- Lanzador (diestro): la pierna de golpeo es la derecha ---- */
  armado: {
    UpperLegR: [['x', 42]], LowerLegR: [['x', 100]],
    UpperLegL: [['x', -28]], LowerLegL: [['x', 34]],
    Abdomen: [['x', 2], ['z', -6], ['y', 8]], Torso: [['y', 10]], Neck: [['x', 8]],
    UpperArmL: [['z', 68], ['x', -12]], LowerArmL: [['x', -30]],
    UpperArmR: [['z', -28], ['x', 30]], LowerArmR: [['x', -35]]
  },
  contacto: {
    UpperLegR: [['x', -12]], LowerLegR: [['x', 42]],
    UpperLegL: [['x', -30]], LowerLegL: [['x', 48]],
    Abdomen: [['x', 18], ['z', -10], ['y', -4]], Torso: [['x', 6], ['y', -6]], Neck: [['x', 14]],
    UpperArmL: [['z', 76], ['x', -26]], LowerArmL: [['x', -22]],
    UpperArmR: [['z', -32], ['x', 36]], LowerArmR: [['x', -30]]
  },
  continuacion: {
    UpperLegR: [['x', -86]], LowerLegR: [['x', 6]],
    UpperLegL: [['x', -4]], LowerLegL: [['x', 16]],
    Abdomen: [['x', -14], ['z', -4], ['y', -16]], Torso: [['x', -4], ['y', -10]], Neck: [['x', 6]],
    UpperArmL: [['z', 62], ['x', 30]], LowerArmL: [['x', -24]],
    UpperArmR: [['z', -22], ['x', -58]], LowerArmR: [['x', -40]]
  },
  aterrizaje: {
    UpperLegR: [['x', -24]], LowerLegR: [['x', 26]],
    UpperLegL: [['x', 14]], LowerLegL: [['x', 40]],
    Abdomen: [['x', 8], ['y', -6]], Torso: [['y', -4]], Neck: [['x', -4]],
    UpperArmL: [['z', 36], ['x', 6]], LowerArmL: [['x', -30]],
    UpperArmR: [['z', -30], ['x', -14]], LowerArmR: [['x', -35]]
  },
  recuperacion: {
    UpperLegR: [['x', -6]], LowerLegR: [['x', 10]],
    UpperLegL: [['x', 4]], LowerLegL: [['x', 10]],
    Abdomen: [['x', 3]], Neck: [['x', -6]],
    UpperArmL: [['z', 16], ['x', -6]], LowerArmL: [['x', -22]],
    UpperArmR: [['z', -16], ['x', -6]], LowerArmR: [['x', -22]]
  },
  /* Celebración: carga, salto con los dos puños, puño, «avión» */
  celCarga: {
    UpperLegL: [['x', -34]], LowerLegL: [['x', 62]], UpperLegR: [['x', -34]], LowerLegR: [['x', 62]],
    Abdomen: [['x', 18]], Neck: [['x', -10]],
    UpperArmL: [['z', 24], ['x', -30]], LowerArmL: [['x', -100]],
    UpperArmR: [['z', -24], ['x', -30]], LowerArmR: [['x', -100]]
  },
  celSalto: {
    UpperLegL: [['x', -8]], LowerLegL: [['x', 28]], UpperLegR: [['x', -2]], LowerLegR: [['x', 44]],
    Abdomen: [['x', -12]], Torso: [['x', -4]], Neck: [['x', -24]],
    UpperArmL: [['z', 150], ['x', -18]], LowerArmL: [['x', -38]],
    UpperArmR: [['z', -150], ['x', -18]], LowerArmR: [['x', -38]]
  },
  celPuno: {
    UpperLegL: [['x', -14]], LowerLegL: [['x', 24]], UpperLegR: [['x', -4]], LowerLegR: [['x', 16]],
    Abdomen: [['x', -6], ['y', -8]], Neck: [['x', -16]],
    UpperArmL: [['z', 30], ['x', -20]], LowerArmL: [['x', -110]],
    UpperArmR: [['z', -165], ['x', -10]], LowerArmR: [['x', -22]]
  },
  celAvion: {
    UpperLegL: [['x', -10], ['z', 6]], LowerLegL: [['x', 14]], UpperLegR: [['x', 6], ['z', -6]], LowerLegR: [['x', 18]],
    Abdomen: [['x', -12]], Torso: [['x', -4]], Neck: [['x', -18]],
    UpperArmL: [['z', 84], ['x', 18]], LowerArmL: [['x', -6]],
    UpperArmR: [['z', -84], ['x', 18]], LowerArmR: [['x', -6]]
  },
  /* Lamento: manos a la cabeza y cabeza gacha */
  lamSube: {
    UpperLegL: [['x', -6]], LowerLegL: [['x', 10]], UpperLegR: [['x', 2]], LowerLegR: [['x', 10]],
    Abdomen: [['x', -4]], Neck: [['x', -12]],
    UpperArmL: [['z', 80], ['x', -40]], LowerArmL: [['z', -70]],
    UpperArmR: [['z', -80], ['x', -40]], LowerArmR: [['z', 70]]
  },
  lamCabeza: {
    UpperLegL: [['x', -4]], LowerLegL: [['x', 8]], UpperLegR: [['x', 4]], LowerLegR: [['x', 8]],
    Abdomen: [['x', -8]], Torso: [['x', -4]], Neck: [['x', -22]],
    UpperArmL: [['z', 115], ['x', -20]], LowerArmL: [['z', -135]],
    UpperArmR: [['z', -115], ['x', -20]], LowerArmR: [['z', 135]]
  },
  lamGacha: {
    UpperLegL: [['x', -14]], LowerLegL: [['x', 22]], UpperLegR: [['x', -10]], LowerLegR: [['x', 20]],
    Abdomen: [['x', 18]], Torso: [['x', 6]], Neck: [['x', 28]],
    UpperArmL: [['z', 106], ['x', -34]], LowerArmL: [['z', -138]],
    UpperArmR: [['z', -106], ['x', -34]], LowerArmR: [['z', 138]]
  },

  /* ---- Portero ---- */
  preparado: {
    UpperLegL: [['x', -40], ['z', 16]], LowerLegL: [['x', 66]],
    UpperLegR: [['x', -40], ['z', -16]], LowerLegR: [['x', 66]],
    Abdomen: [['x', 22]], Torso: [['x', 8]], Neck: [['x', -28]],
    UpperArmL: [['z', 22], ['x', -56]], LowerArmL: [['x', -34]],
    UpperArmR: [['z', -22], ['x', -56]], LowerArmR: [['x', -34]]
  },
  preparadoL: { /* peso sobre la pierna izquierda */
    UpperLegL: [['x', -44], ['z', 12]], LowerLegL: [['x', 74]],
    UpperLegR: [['x', -34], ['z', -20]], LowerLegR: [['x', 56]],
    Abdomen: [['x', 20], ['z', 4]], Torso: [['x', 8]], Neck: [['x', -28], ['z', -4]],
    UpperArmL: [['z', 26], ['x', -52]], LowerArmL: [['x', -30]],
    UpperArmR: [['z', -20], ['x', -60]], LowerArmR: [['x', -38]]
  },
  carga: { /* aterrizaje del paso previo: más flexionado, listo para saltar */
    UpperLegL: [['x', -50], ['z', 18]], LowerLegL: [['x', 86]],
    UpperLegR: [['x', -50], ['z', -18]], LowerLegR: [['x', 86]],
    Abdomen: [['x', 28]], Torso: [['x', 8]], Neck: [['x', -34]],
    UpperArmL: [['z', 30], ['x', -50]], LowerArmL: [['x', -30]],
    UpperArmR: [['z', -30], ['x', -50]], LowerArmR: [['x', -30]]
  },
  /* Estirada hacia la derecha del portero (su -X). La izquierda es el espejo. */
  impulso: {
    UpperLegR: [['x', -46], ['z', -8]], LowerLegR: [['x', 84]],
    UpperLegL: [['x', -6], ['z', 26]], LowerLegL: [['x', 18]],
    Abdomen: [['x', 16], ['z', 10]], Torso: [['z', 6]], Neck: [['x', -24], ['z', 8]],
    UpperArmR: [['z', -100], ['x', -50]], LowerArmR: [['x', -15]],
    UpperArmL: [['x', -130], ['z', -45]], LowerArmL: [['x', -15]]
  },
  vuelo: {
    UpperLegR: [['x', -34]], LowerLegR: [['x', 58]],
    UpperLegL: [['x', 8], ['z', 14]], LowerLegL: [['x', 12]],
    Abdomen: [['x', 4], ['z', 8]], Torso: [['z', 6]], Neck: [['x', -12], ['z', 12]],
    UpperArmR: [['z', -166], ['x', -8]], LowerArmR: [['x', -6]],
    UpperArmL: [['z', 150], ['x', -22]], LowerArmL: [['x', -14]]
  },
  caida: {
    UpperLegR: [['x', -40]], LowerLegR: [['x', 64]],
    UpperLegL: [['x', -22], ['z', 8]], LowerLegL: [['x', 50]],
    Abdomen: [['x', 16], ['z', 4]], Neck: [['x', -18], ['z', 8]],
    UpperArmR: [['x', -100], ['z', -20]], LowerArmR: [['x', -30]],
    UpperArmL: [['z', 130], ['x', -40]], LowerArmL: [['x', -50]]
  },
  /* V4.6: en el suelo tras la estirada, tumbado de lado y SIN brazos que
     apunten al césped (antes un brazo hacía de puntal y el portero quedaba
     flotando). El brazo de abajo va estirado por encima de la cabeza. */
  sueloParada: { /* abraza el balón: brazos al frente, paralelos al césped */
    UpperLegR: [['x', -40]], LowerLegR: [['x', 64]],
    UpperLegL: [['x', -30]], LowerLegL: [['x', 50]],
    Abdomen: [['x', 12]], Neck: [['x', -10]],
    UpperArmR: [['x', -82], ['z', -4]], LowerArmR: [['x', -64]],
    UpperArmL: [['x', -78], ['z', 6]], LowerArmL: [['x', -60]]
  },
  sueloGol: { /* abatido: brazos sueltos al frente, cabeza gacha */
    UpperLegR: [['x', -16]], LowerLegR: [['x', 22]],
    UpperLegL: [['x', -8]], LowerLegL: [['x', 14]],
    Abdomen: [['x', 6]], Neck: [['x', 18]],
    UpperArmR: [['x', -60]], LowerArmR: [['x', -20]],
    UpperArmL: [['x', -40], ['z', 10]], LowerArmL: [['x', -30]]
  },
  /* V4.6: levantarse y reaccionar */
  rodillas: {
    UpperLegL: [['x', -2], ['z', 6]],
    LowerLegL: [['x', 100]],
    UpperLegR: [['x', -2], ['z', -6]],
    LowerLegR: [['x', 100]],
    Abdomen: [['x', 8]],
    Neck: [['x', -6]],
    UpperArmL: [['z', 20], ['x', -20]],
    LowerArmL: [['x', -30]],
    UpperArmR: [['z', -20], ['x', -20]],
    LowerArmR: [['x', -30]]
  },
  rodillaArriba: {
    UpperLegR: [['x', -85]],
    LowerLegR: [['x', 85]],
    UpperLegL: [['x', 8]],
    LowerLegL: [['x', 98]],
    Abdomen: [['x', 22]],
    Neck: [['x', -14]],
    UpperArmR: [['x', -45], ['z', -10]],
    LowerArmR: [['x', -45]],
    UpperArmL: [['z', 24], ['x', -10]],
    LowerArmL: [['x', -30]]
  },
  sentado: {
    UpperLegL: [['x', -120], ['z', 8]],
    LowerLegL: [['x', 125]],
    UpperLegR: [['x', -120], ['z', -8]],
    LowerLegR: [['x', 125]],
    Abdomen: [['x', -20]],
    Neck: [['x', 22]],
    UpperArmL: [['x', 50], ['z', 22]],
    LowerArmL: [['x', -8]],
    UpperArmR: [['x', 50], ['z', -22]],
    LowerArmR: [['x', -8]]
  },
  sentadoCabeza: {
    UpperLegL: [['x', -118], ['z', 10]],
    LowerLegL: [['x', 122]],
    UpperLegR: [['x', -118], ['z', -10]],
    LowerLegR: [['x', 122]],
    Abdomen: [['x', 24]],
    Torso: [['x', 6]],
    Neck: [['x', 26]],
    UpperArmL: [['z', 106], ['x', -34]],
    LowerArmL: [['z', -138]],
    UpperArmR: [['z', -106], ['x', -34]],
    LowerArmR: [['z', 138]]
  },
  triunfoCarga: {
    UpperLegL: [['x', -30], ['z', 10]],
    LowerLegL: [['x', 52]],
    UpperLegR: [['x', -30], ['z', -10]],
    LowerLegR: [['x', 52]],
    Abdomen: [['x', 16]],
    Neck: [['x', -24]],
    UpperArmL: [['z', 40], ['x', -40]],
    LowerArmL: [['x', -110]],
    UpperArmR: [['z', -40], ['x', -40]],
    LowerArmR: [['x', -110]]
  },
  triunfoV: {
    UpperLegL: [['x', -6], ['z', 8]],
    LowerLegL: [['x', 12]],
    UpperLegR: [['x', -6], ['z', -8]],
    LowerLegR: [['x', 12]],
    Abdomen: [['x', -12]],
    Torso: [['x', -4]],
    Neck: [['x', -30]],
    UpperArmL: [['z', 150], ['x', -12]],
    LowerArmL: [['x', -30]],
    UpperArmR: [['z', -150], ['x', -12]],
    LowerArmR: [['x', -30]]
  },
  triunfoPuno: {
    UpperLegL: [['x', -18], ['z', 8]],
    LowerLegL: [['x', 30]],
    UpperLegR: [['x', -10], ['z', -8]],
    LowerLegR: [['x', 22]],
    Abdomen: [['x', 10], ['y', 10]],
    Neck: [['x', -16]],
    UpperArmL: [['z', 30], ['x', -30]],
    LowerArmL: [['x', -110]],
    UpperArmR: [['z', -150], ['x', -30]],
    LowerArmR: [['x', -60]]
  },
  /* Portero que se queda en el centro (siempre es gol): bloquea y se lamenta */
  bloqueo: {
    UpperLegL: [['x', -16], ['z', 22]], LowerLegL: [['x', 34]],
    UpperLegR: [['x', -16], ['z', -22]], LowerLegR: [['x', 34]],
    Abdomen: [['x', 4]], Neck: [['x', -20]],
    UpperArmL: [['z', 128], ['x', -26]], LowerArmL: [['x', -14]],
    UpperArmR: [['z', -128], ['x', -26]], LowerArmR: [['x', -14]]
  },
  decepcion: {
    UpperLegL: [['x', -6], ['z', 8]], LowerLegL: [['x', 12]],
    UpperLegR: [['x', 2], ['z', -8]], LowerLegR: [['x', 10]],
    Abdomen: [['x', 10], ['y', 20]], Torso: [['y', 14]], Neck: [['x', 10], ['y', 24]],
    UpperArmL: [['z', 45], ['x', 10]], LowerArmL: [['z', -85]],
    UpperArmR: [['z', -45], ['x', 10]], LowerArmR: [['z', 85]]
  }
};

function espejo(pose) {
  /* Cambia L<->R y niega las rotaciones en y y z. */
  const out = {};
  Object.entries(pose).forEach(([h, giros]) => {
    const otro = h.endsWith('L') ? h.slice(0, -1) + 'R' : h.endsWith('R') ? h.slice(0, -1) + 'L' : h;
    out[otro] = giros.map(([e, g]) => [e, e === 'x' ? g : -g]);
  });
  return out;
}

/* ==========================================================
   ESCENARIO
========================================================== */
function crearCesped(calidad) {
  /* Textura: franjas de corte + líneas del área, en metros. */
  const X0 = -40, X1 = 40, Z0 = -24, Z1 = 46;
  const ppm = calidad === 'alta' ? 24 : 14;
  const W = (X1 - X0) * ppm, H = (Z1 - Z0) * ppm;
  const mapa = lienzo(W, H, (g) => {
    const px = (x) => (x - X0) * ppm;
    const pz = (z) => (z - Z0) * ppm;
    for (let z = Z0, i = 0; z < Z1; z += 5, i++) {
      g.fillStyle = i % 2 ? '#2f7d32' : '#378a3a';
      g.fillRect(0, pz(z), W, 5 * ppm);
    }
    /* grano */
    for (let n = 0; n < W * H / 90; n++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.035)';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    g.strokeStyle = 'rgba(245,245,240,0.92)';
    g.lineWidth = 0.12 * ppm;
    const linea = (pts) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z)))); g.stroke(); };
    linea([[X0, 0], [X1, 0]]);
    linea([[-9.16, 0], [-9.16, 5.5], [9.16, 5.5], [9.16, 0]]);
    linea([[-20.16, 0], [-20.16, 16.5], [20.16, 16.5], [20.16, 0]]);
    g.beginPath();
    const a = Math.acos(5.5 / 9.15);
    g.arc(px(0), pz(11), 9.15 * ppm, Math.PI / 2 - a, Math.PI / 2 + a);
    g.stroke();
    g.fillStyle = 'rgba(245,245,240,0.95)';
    g.beginPath(); g.arc(px(0), pz(11), 0.14 * ppm, 0, Math.PI * 2); g.fill();
  });
  mapa.anisotropy = 4;
  const geo = new T.PlaneGeometry(X1 - X0, Z1 - Z0);
  geo.rotateX(-Math.PI / 2);
  geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const suelo = new T.Mesh(geo, new T.MeshStandardMaterial({ map: mapa, roughness: 0.95, metalness: 0 }));
  suelo.receiveShadow = true;
  return suelo;
}

function crearPorteria() {
  const grupo = new T.Group();
  const blanco = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x333333 });
  const w = PORTERIA.ancho / 2, h = PORTERIA.alto, r = PORTERIA.poste;
  const poste = new T.CylinderGeometry(r, r, h + r, 12);
  [-w - r, w + r].forEach((x) => {
    const m = new T.Mesh(poste, blanco); m.position.set(x, (h + r) / 2, 0); m.castShadow = true; grupo.add(m);
  });
  const larguero = new T.Mesh(new T.CylinderGeometry(r, r, PORTERIA.ancho + 4 * r, 12), blanco);
  larguero.rotation.z = Math.PI / 2; larguero.position.set(0, h + r / 2, 0); larguero.castShadow = true;
  grupo.add(larguero);
  /* soportes traseros */
  const barra = new T.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.5 });
  [-w, w].forEach((x) => {
    const top = new T.Vector3(x, h, -PORTERIA.fondoLarguero), bot = new T.Vector3(x, 0, -PORTERIA.fondoSuelo);
    const dir = new T.Vector3().subVectors(top, bot);
    const b = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, dir.length(), 6), barra);
    b.position.copy(bot).addScaledVector(dir, 0.5);
    b.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    grupo.add(b);
  });
  return grupo;
}

/* Red: una malla de puntos (u, v) sobre tres superficies. La del fondo
   se deforma con el impacto del balón. */
function crearRed() {
  const paso = 0.16;
  const w = PORTERIA.ancho / 2, h = PORTERIA.alto;
  const puntos = [];   /* base de cada vértice */
  const indices = [];
  function superficie(nu, nv, f) {
    const base = puntos.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const p = f(i / nu, j / nv);
        puntos.push(p.x, p.y, p.z);
        if (i < nu) indices.push(base + j * (nu + 1) + i, base + j * (nu + 1) + i + 1);
        if (j < nv) indices.push(base + j * (nu + 1) + i, base + (j + 1) * (nu + 1) + i);
      }
    }
  }
  const nx = Math.round(PORTERIA.ancho / paso);
  const ny = Math.round(Math.hypot(h, PORTERIA.fondoSuelo - PORTERIA.fondoLarguero) / paso);
  const nz = Math.round(PORTERIA.fondoLarguero / paso);
  /* fondo: de suelo (z=-2) a larguero trasero (z=-1, y=h) */
  superficie(nx, ny, (u, v) => new T.Vector3(lerp(-w, w, u), v * h, lerp(-PORTERIA.fondoSuelo, -PORTERIA.fondoLarguero, v)));
  const finFondo = puntos.length / 3;
  /* techo */
  superficie(nx, nz, (u, v) => new T.Vector3(lerp(-w, w, u), h, -v * PORTERIA.fondoLarguero));
  /* laterales */
  [-w, w].forEach((x) => {
    superficie(Math.round(PORTERIA.fondoSuelo / paso), Math.round(h / paso), (u, v) => {
      const fondo = lerp(PORTERIA.fondoSuelo, PORTERIA.fondoLarguero, v);
      return new T.Vector3(x, v * h, -u * fondo);
    });
  });
  const base = new Float32Array(puntos);
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(new Float32Array(puntos), 3));
  geo.setIndex(indices);
  const mat = new T.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.5 });
  const red = new T.LineSegments(geo, mat);

  /* deformar(impacto: {x, y}, fuerza 0..1): hunde el fondo alrededor del impacto */
  function deformar(impacto, fuerza) {
    const pos = geo.attributes.position.array;
    const s2 = 2 * 0.75 * 0.75;
    for (let k = 0; k < finFondo; k++) {
      const bx = base[k * 3], by = base[k * 3 + 1], bz = base[k * 3 + 2];
      let dz = 0;
      if (fuerza > 0) {
        const d2 = (bx - impacto.x) * (bx - impacto.x) + (by - impacto.y) * (by - impacto.y);
        dz = -fuerza * 0.55 * Math.exp(-d2 / s2) * Math.min(1, by / 0.3 + 0.2);
      }
      pos[k * 3 + 2] = bz + dz;
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { objeto: red, deformar };
}

function crearBalon() {
  /* Icosaedro subdividido: caras negras donde la normal apunta a
     un vértice del icosaedro base (pentágonos). */
  const geo = new T.IcosahedronGeometry(RADIO_BALON, 2);
  const base = new T.IcosahedronGeometry(1, 0);
  const vs = [];
  const p = base.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(p, i).normalize();
    if (!vs.some((w) => w.distanceTo(v) < 0.01)) vs.push(v);
  }
  const col = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 3) {
    const c = new T.Vector3();
    for (let k = 0; k < 3; k++) c.add(new T.Vector3().fromBufferAttribute(pos, i + k));
    c.normalize();
    const negro = vs.some((v) => v.dot(c) > 0.93);
    const tono = negro ? 0.05 : 0.95;
    for (let k = 0; k < 3; k++) col.push(tono, tono, tono);
  }
  geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, flatShading: true }));
  m.castShadow = true;
  return m;
}

function crearSombraBlob() {
  const tx = lienzo(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const m = new T.Mesh(new T.PlaneGeometry(0.5, 0.5), new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.01;
  return m;
}

function texturaBrillo() {
  return lienzo(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,250,230,0.8)');
    gr.addColorStop(0.5, 'rgba(255,240,200,0.18)');
    gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

function crearEstadio(calidad) {
  const grupo = new T.Group();
  const brillo = texturaBrillo();

  /* Gradas detrás de la portería: escalones oscuros */
  const cemento = new T.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.9 });
  const filas = 10;
  for (let f = 0; f < filas; f++) {
    const m = new T.Mesh(new T.BoxGeometry(90, 0.55, 0.9), cemento);
    m.position.set(0, 1.4 + f * 0.55, -7.5 - f * 0.9);
    grupo.add(m);
  }
  /* laterales del fondo, en ángulo */
  [-1, 1].forEach((s) => {
    for (let f = 0; f < filas; f++) {
      const m = new T.Mesh(new T.BoxGeometry(40, 0.55, 0.9), cemento);
      m.position.set(s * (32 + f * 0.9), 1.4 + f * 0.55, 8);
      m.rotation.y = Math.PI / 2;
      grupo.add(m);
    }
  });

  /* Público: un InstancedMesh (fondo + laterales) */
  const porFila = calidad === 'alta' ? 150 : 90;
  const porLado = calidad === 'alta' ? 70 : 40;
  const asientos = [];
  for (let f = 0; f < filas; f++) {
    for (let i = 0; i < porFila; i++) asientos.push([-44 + (i + Math.random() * 0.5) * (88 / porFila), 1.4 + f * 0.55 + 0.27, -7.5 - f * 0.9, 0]);
    [-1, 1].forEach((sd) => {
      for (let i = 0; i < porLado; i++) asientos.push([sd * (32 + f * 0.9), 1.4 + f * 0.55 + 0.27, -12 + (i + Math.random() * 0.5) * (40 / porLado), sd]);
    });
  }
  const total = asientos.length;
  const cuerpo = new T.BoxGeometry(0.34, 0.48, 0.24);
  cuerpo.translate(0, 0.25, 0);
  const publico = new T.InstancedMesh(cuerpo, new T.MeshLambertMaterial({ color: 0xffffff }), total);
  const cabeza = new T.IcosahedronGeometry(0.12, 0);
  cabeza.translate(0, 0.62, 0);
  const cabezas = new T.InstancedMesh(cabeza, new T.MeshLambertMaterial({ color: 0x8a6a55 }), total);
  const paleta = ['#c8102e', '#f5f5f5', '#c8102e', '#1f3a93', '#f2c200', '#2b2b2b', '#6d6d6d', '#c8102e', '#ffffff', '#0b5d3b'];
  const datos = [];
  const m4 = new T.Matrix4();
  const color = new T.Color();
  let k = 0;
  for (const [x, y, z, lado] of asientos) {
    {
      const vacio = Math.random() < 0.08;
      const s = vacio ? 0.0001 : 0.85 + Math.random() * 0.3;
      datos.push({ x, y, z, s, fase: Math.random() * Math.PI * 2, ganas: Math.random() });
      m4.makeScale(s, s, s).setPosition(x, y, z);
      publico.setMatrixAt(k, m4);
      cabezas.setMatrixAt(k, m4);
      color.set(paleta[Math.floor(Math.random() * paleta.length)]).multiplyScalar(0.16 + Math.random() * 0.22);
      publico.setColorAt(k, color);
      k++;
    }
  }
  grupo.add(publico, cabezas);

  function animarPublico(t, euforia) {
    for (let i = 0; i < total; i++) {
      const d = datos[i];
      const salto = euforia > 0 ? Math.max(0, Math.sin(t * 9 + d.fase)) * 0.28 * euforia * d.ganas : Math.sin(t * 1.3 + d.fase) * 0.015;
      m4.makeScale(d.s, d.s, d.s).setPosition(d.x, d.y + salto, d.z);
      publico.setMatrixAt(i, m4);
      cabezas.setMatrixAt(i, m4);
    }
    publico.instanceMatrix.needsUpdate = true;
    cabezas.instanceMatrix.needsUpdate = true;
  }

  /* Vallas LED detrás de la línea de fondo */
  const led = lienzo(1024, 64, (g, W, H) => {
    /* V4.8: vallas de SPORT. Bloque rojo con la marca y mensajes del juego. */
    g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
    const textos = ['SPORT', 'LA TANDA', 'SPORT', 'JUEGOS'];
    const fuente = (m) => m ? 'italic 900 42px Arial Black, Arial, sans-serif' : 'bold 34px Arial Narrow, Arial, sans-serif';
    g.textBaseline = 'middle';
    const piezas = textos.map((t) => {
      g.font = fuente(t === 'SPORT');
      return { t, marca: t === 'SPORT', w: g.measureText(t).width + (t === 'SPORT' ? 40 : 0) };
    });
    /* Reparto el hueco para que el patrón case al repetirse */
    const hueco = Math.max(16, (W - piezas.reduce((a, p) => a + p.w, 0)) / piezas.length);
    let x = hueco / 2;
    piezas.forEach((p) => {
      g.font = fuente(p.marca);
      if (p.marca) {
        g.fillStyle = '#ec0918'; g.fillRect(x, 5, p.w, H - 10);
        g.fillStyle = '#ffffff'; g.fillText(p.t, x + 20, H / 2 + 2);
      } else {
        g.fillStyle = '#ffffff'; g.fillText(p.t, x, H / 2 + 2);
      }
      x += p.w + hueco;
    });
  });
  led.wrapS = T.RepeatWrapping; led.repeat.set(3, 1);
  const vallaMat = new T.MeshBasicMaterial({ map: led, toneMapped: false });
  vallaMat.color.setScalar(0.85);
  const valla = new T.Mesh(new T.PlaneGeometry(60, 0.75), vallaMat);
  valla.position.set(0, 0.38, -4.6);
  grupo.add(valla);

  /* Torres de focos con halo */
  const focos = [];
  [[-30, 26, -22], [30, 26, -22], [-44, 24, 14], [44, 24, 14]].forEach(([x, y, z]) => {
    const torre = new T.Mesh(new T.BoxGeometry(0.6, y, 0.6), new T.MeshStandardMaterial({ color: 0x151a24 }));
    torre.position.set(x, y / 2, z); grupo.add(torre);
    const panel = new T.Mesh(new T.BoxGeometry(5, 2.2, 0.4), new T.MeshBasicMaterial({ color: 0xfff6dc }));
    panel.position.set(x, y + 1, z); panel.lookAt(0, 0, 8); grupo.add(panel);
    const halo = new T.Sprite(new T.SpriteMaterial({ map: brillo, color: 0xfff1cc, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    halo.scale.set(22, 22, 1); halo.position.set(x, y + 1, z + 0.5); grupo.add(halo);
    focos.push(halo);
  });

  /* Flashes de cámaras en la grada */
  const nFlash = 40;
  const flashes = [];
  const flashMat = new T.SpriteMaterial({ map: brillo, color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
  for (let i = 0; i < nFlash; i++) {
    const s = new T.Sprite(flashMat.clone());
    const d = datos[Math.floor(Math.random() * total)];
    s.position.set(d.x, d.y + 0.6, d.z + 0.3);
    s.scale.setScalar(0.001);
    s.userData = { fase: Math.random() * 10, vel: 3 + Math.random() * 5 };
    grupo.add(s); flashes.push(s);
  }
  function animarFlashes(t, intensidad) {
    flashes.forEach((s) => {
      const u = (t * s.userData.vel + s.userData.fase) % 4;
      const on = intensidad > 0 && u < 0.12 ? (1 - u / 0.12) * intensidad : 0;
      s.scale.setScalar(0.001 + on * 2.2);
      s.material.opacity = on;
    });
  }

  return { objeto: grupo, animarPublico, animarFlashes };
}

/* ==========================================================
   PERSONAJES
========================================================== */
/* El GLB no tiene UV: rayas de la camiseta y guantes del portero se pintan
   en el shader a partir de la posición de reposo de cada vértice (antes del
   skinning), así siguen al cuerpo cuando se mueve.
   Geometría del modelo (en pose T): x lateral, z altura (0 pies … 0,048
   cabeza); los brazos se extienden en x hasta ±0,026. */
const PATRON = {
  anchoRaya: 0.0016,      /* cinco rayas en el torso */
  limiteTorso: 0.0047,    /* |x| mayor: mangas */
  inicioMano: 0.0198      /* |x| mayor en la piel: manos (guantes) */
};

function prepararPatron(material) {
  const u = {
    uPocModo: { value: 0 },
    uPocA: { value: new T.Color() },
    uPocB: { value: new T.Color() },
    uPocManga: { value: new T.Color() }
  };
  material.userData.patron = u;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vPocReposo;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  vPocReposo = position;');
    sh.fragmentShader = [
      'varying vec3 vPocReposo;',
      'uniform float uPocModo;',
      'uniform vec3 uPocA;',
      'uniform vec3 uPocB;',
      'uniform vec3 uPocManga;'
    ].join('\n') + '\n' + sh.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      [
        'vec3 pocColor = diffuse;',
        'if ( uPocModo > 0.5 && uPocModo < 1.5 ) {',
        '  if ( abs( vPocReposo.x ) > ' + PATRON.limiteTorso.toFixed(5) + ' ) { pocColor = uPocManga; }',
        '  else { float r = fract( vPocReposo.x / ' + (PATRON.anchoRaya * 2).toFixed(5) + ' + 0.25 ); pocColor = r < 0.5 ? uPocA : uPocB; }',
        '} else if ( uPocModo > 1.5 ) {',
        '  if ( abs( vPocReposo.x ) > ' + PATRON.inicioMano.toFixed(5) + ' ) { pocColor = uPocA; }',
        '}',
        'vec4 diffuseColor = vec4( pocColor, opacity );'
      ].join('\n'));
  };
  material.customProgramCacheKey = () => 'poc-patron';
  material.needsUpdate = true;
  return u;
}

function pintarMateriales(inst, eq) {
  const piezas = {
    Shirt: eq.camiseta, Shirt2: eq.detalle, Pants: eq.pantalon, Socks: eq.medias,
    Shoes: eq.botas, Skin: eq.piel, Hair: eq.pelo, Hair2: eq.pelo
  };
  inst.modelo.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    if (!o.userData.propio) { o.material = o.material.clone(); o.userData.propio = true; }
    const m = o.material;
    const c = piezas[m.name];
    if (c) m.color.set(c);
    m.roughness = 0.7;
    const esCamiseta = m.name === 'Shirt' || m.name === 'Shirt2';
    if ((esCamiseta && eq.patron === 'rayas') || (m.name === 'Skin' && eq.guantes)) {
      const u = m.userData.patron || prepararPatron(m);
      if (esCamiseta) {
        u.uPocModo.value = 1;
        u.uPocA.value.set(eq.rayas[0]); u.uPocB.value.set(eq.rayas[1]);
        u.uPocManga.value.set(eq.mangas || eq.rayas[1]);
      } else {
        u.uPocModo.value = 2;
        u.uPocA.value.set(eq.guantes);
      }
    } else if (m.userData.patron) {
      m.userData.patron.uPocModo.value = 0;
    }
  });
}

function texturaDorsal(texto, color) {
  return lienzo(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.font = 'bold 96px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.strokeText(texto, 64, 70);
    g.fillStyle = color;
    g.fillText(texto, 64, 70);
  });
}

function crearPersonaje(gltf, eq, esPortero) {
  const modelo = T.cloneSkinned(gltf.scene);
  modelo.scale.setScalar(ESCALA);
  const huesos = {};
  modelo.traverse((o) => { if (o.isBone) huesos[o.name] = o; });
  const raiz = new T.Group();     /* posición en el campo */
  const pivote = new T.Group();   /* a la altura de la cadera: giros de la estirada */
  const ALTURA_CADERA = 0.95;
  pivote.position.y = ALTURA_CADERA;
  modelo.position.y = -ALTURA_CADERA;
  raiz.add(pivote); pivote.add(modelo);
  const inst = { raiz, pivote, modelo, huesos, eq };
  pintarMateriales(inst, eq);

  /* Dorsal a la espalda y, en el portero, guantes. Se colocan en reposo
     y se "atan" al hueso manteniendo su transformación de mundo. */
  modelo.updateMatrixWorld(true);
  const torso = huesos.Torso;
  const pTorso = torso.getWorldPosition(new T.Vector3());
  const dorsal = new T.Mesh(new T.PlaneGeometry(0.26, 0.26),
    new T.MeshStandardMaterial({ map: texturaDorsal(eq.dorsal, eq.colorDorsal), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  dorsal.position.set(pTorso.x, pTorso.y + 0.02, pTorso.z - 0.135);
  dorsal.rotation.y = Math.PI;
  raiz.add(dorsal); raiz.updateMatrixWorld(true);
  torso.attach(dorsal);
  inst.dorsal = dorsal;
  /* Los guantes del portero se pintan en las manos (ver prepararPatron). */
  /* En este rig los pies (FootL/FootR) cuelgan de la raíz, no de la pierna:
     en Blender eran objetivos de IK y los clips del GLB ya traen su posición
     horneada. En nuestras poses (FK) hay que llevarlos al final de la tibia;
     si no, el pie se queda clavado y la pierna se estira. Se guarda aquí la
     relación de reposo tibia -> pie para reconstruirla en cada fotograma. */
  const qModeloInv = modelo.getWorldQuaternion(new T.Quaternion()).invert();
  inst.pies = ['L', 'R'].map((lado) => {
    const tibia = huesos['LowerLeg' + lado], pie = huesos['Foot' + lado];
    return {
      tibia, pie, rel: tibia.matrixWorld.clone().invert().multiply(pie.matrixWorld),
      /* V4: orientación del pie en reposo (plano en el suelo), en espacio del modelo */
      qPlano: qModeloInv.clone().multiply(pie.getWorldQuaternion(new T.Quaternion()))
    };
  });
  /* V4: mallas con piel, para medir el punto más bajo del cuerpo en cada fotograma */
  inst.mallas = [];
  modelo.traverse((o) => { if (o.isSkinnedMesh) inst.mallas.push(o); });
  inst.mixer = new T.AnimationMixer(modelo);
  inst.acciones = {};
  return inst;
}

function recolorear(inst, eq) {
  const clave = JSON.stringify(eq);
  if (inst.clave === clave) return;
  inst.clave = clave;
  inst.eq = eq;
  pintarMateriales(inst, eq);
  if (inst.dorsal) {
    const viejo = inst.dorsal.material.map;
    inst.dorsal.material.map = texturaDorsal(eq.dorsal, eq.colorDorsal);
    inst.dorsal.material.needsUpdate = true;
    if (viejo) viejo.dispose();
  }
}

/* Aplica una lista [accion, tiempo, peso] y evalúa el mixer. */
const CLIPS_DEL_GLB = { reposo: true, carrera: true };
const _m = new T.Matrix4(), _p = new T.Vector3(), _q = new T.Quaternion(), _s = new T.Vector3();

/* opc.planos: [pesoPieL, pesoPieR] 0..1 — el pie se orienta plano (solo con
   el rumbo del cuerpo), como apoyado; así la puntera no se clava ni flota. */
function mezclar(inst, lista, opc = {}) {
  Object.values(inst.acciones).forEach((a) => { a.setEffectiveWeight(0); });
  let total = 0;
  let propio = 0;
  lista.forEach(([, , w]) => { total += w; });
  lista.forEach(([nombre, tiempo, peso]) => {
    const a = inst.acciones[nombre];
    if (!a || peso <= 0) return;
    a.time = tiempo;
    a.setEffectiveWeight(peso / (total || 1));
    if (!CLIPS_DEL_GLB[nombre]) propio += peso / (total || 1);
  });
  inst.mixer.update(0);
  /* Pies pegados a la tibia en la parte de la mezcla que es pose propia */
  if (propio > 0.001) {
    inst.modelo.updateMatrixWorld(true);
    inst.pies.forEach(({ tibia, pie, rel }) => {
      _m.multiplyMatrices(tibia.matrixWorld, rel);
      _m.premultiply(_m.clone().copy(pie.parent.matrixWorld).invert());
      _m.decompose(_p, _q, _s);
      pie.position.lerp(_p, propio);
      pie.quaternion.slerp(_q, propio);
    });
  }
  if (opc.planos) {
    inst.modelo.updateMatrixWorld(true);
    inst.pies.forEach(({ pie, qPlano }, i) => {
      const w = opc.planos[i] || 0;
      if (w <= 0.001) return;
      /* mundo deseado = rumbo (solo giro vertical) · reposo; a local del padre */
      _q.setFromAxisAngle(EJE.y, inst.pivote.rotation.y).multiply(qPlano);
      const padre = pie.parent.getWorldQuaternion(new T.Quaternion()).invert();
      pie.quaternion.slerp(padre.multiply(_q), w);
    });
  }
}

/* V4: punto más bajo de la malla (en metros de mundo). soloPies = zapatos. */
const _v = new T.Vector3();
function puntoMasBajo(inst, soloPies) {
  inst.raiz.updateMatrixWorld(true);
  let m = Infinity;
  for (const o of inst.mallas) {
    if (soloPies && o.material.name !== 'Shoes') continue;
    const n = o.geometry.attributes.position.count;
    const paso = soloPies ? 2 : 3;
    for (let i = 0; i < n; i += paso) {
      o.getVertexPosition(i, _v);
      _v.applyMatrix4(o.matrixWorld);
      if (_v.y < m) m = _v.y;
    }
  }
  return m;
}

/* V4: apoya el cuerpo en el césped moviendo la raíz en vertical.
   modo 'pies': las suelas tocan el suelo (peso 0..1, 1 = exacto).
   modo 'cuerpo': la parte más baja del cuerpo toca el suelo (tumbado).
   Además, nunca deja que nada quede por debajo del césped. */
function apoyar(inst, modo, peso = 1) {
  if (modo && peso > 0) {
    const m = puntoMasBajo(inst, modo === 'pies');
    inst.raiz.position.y -= m * peso;
  }
  const m2 = puntoMasBajo(inst, false);
  if (m2 < 0) inst.raiz.position.y -= m2;
}

/* ==========================================================
   SONIDO (sintetizado, sin archivos). Silenciado por defecto.
========================================================== */
function crearSonido() {
  let ctx = null, maestro = null, ambiente = null, activo = false;
  function iniciar() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    maestro = ctx.createGain(); maestro.gain.value = 0; maestro.connect(ctx.destination);
    /* ruido marrón de grada en bucle */
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let ultimo = 0;
    for (let i = 0; i < len; i++) { const b = Math.random() * 2 - 1; ultimo = (ultimo + 0.02 * b) / 1.02; d[i] = ultimo * 3.2; }
    ambiente = { buf };
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(lp).connect(g).connect(maestro); src.start();
    ambiente.gain = g;
  }
  function ruido(dur, tipo, frec, q, vol, ataque) {
    if (!ctx || !activo) return;
    const src = ctx.createBufferSource(); src.buffer = ambiente.buf;
    const f = ctx.createBiquadFilter(); f.type = tipo; f.frequency.value = frec; f.Q.value = q;
    const g = ctx.createGain(); const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(maestro); src.start(t0, Math.random()); src.stop(t0 + dur + 0.1);
  }
  const api = {
    activar(v) {
      activo = v;
      if (v) { iniciar(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
      if (maestro) maestro.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.1);
    },
    silbato() {
      if (!ctx || !activo) return;
      const t0 = ctx.currentTime;
      [2850, 3050].forEach((fq) => {
        const o = ctx.createOscillator(); o.frequency.value = fq;
        const trem = ctx.createOscillator(); trem.frequency.value = 32;
        const tg = ctx.createGain(); tg.gain.value = 0.5;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02);
        g.gain.setValueAtTime(0.06, t0 + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
        trem.connect(tg).connect(g.gain);
        o.connect(g).connect(maestro); o.start(t0); trem.start(t0); o.stop(t0 + 0.45); trem.stop(t0 + 0.45);
      });
    },
    golpeo() {
      if (!ctx || !activo) return;
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.14);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g).connect(maestro); o.start(t0); o.stop(t0 + 0.2);
      ruido(0.08, 'highpass', 1800, 0.7, 0.25, 0.003);
    },
    red() { ruido(0.45, 'bandpass', 2600, 0.8, 0.18, 0.01); },
    parada() { ruido(0.12, 'lowpass', 500, 0.7, 0.5, 0.004); },
    grito(gol) {
      if (!ctx || !activo) return;
      ruido(gol ? 2.6 : 1.4, 'bandpass', gol ? 1100 : 450, 0.6, gol ? 0.55 : 0.28, gol ? 0.18 : 0.3);
      if (ambiente && ambiente.gain) {
        const t0 = ctx.currentTime;
        ambiente.gain.gain.setTargetAtTime(gol ? 0.8 : 0.5, t0, 0.1);
        ambiente.gain.gain.setTargetAtTime(0.35, t0 + 2.2, 0.8);
      }
    },
    destruir() { if (ctx) ctx.close(); ctx = null; }
  };
  return api;
}

/* ==========================================================
   ESCENA
========================================================== */
export async function crearEscena(contenedor, opciones = {}) {
  const reducido = !!opciones.reducido;
  const calidad = opciones.calidad || (esMovil() ? 'media' : 'alta');

  /* --- render --- */
  const lienzoGL = document.createElement('canvas');
  lienzoGL.className = 'poc-escena3d__lienzo';
  lienzoGL.setAttribute('aria-hidden', 'true');
  const render = new T.WebGLRenderer({ canvas: lienzoGL, antialias: calidad === 'alta', powerPreference: 'high-performance', preserveDrawingBuffer: !!opciones.captura });
  render.setPixelRatio(Math.min(window.devicePixelRatio || 1, calidad === 'alta' ? 2 : 1.5));
  render.outputColorSpace = T.SRGBColorSpace;
  render.toneMapping = T.ACESFilmicToneMapping;
  render.toneMappingExposure = 1.05;
  render.shadowMap.enabled = true;
  render.shadowMap.type = T.PCFShadowMap;
  contenedor.appendChild(lienzoGL);

  const escena = new T.Scene();
  escena.background = lienzo(4, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#02040a'); gr.addColorStop(0.55, '#0b1630'); gr.addColorStop(1, '#1b2c4a');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  });
  escena.fog = new T.Fog(0x0b1426, 40, 110);

  /* --- luz nocturna: ambiente frío + focos cálidos --- */
  escena.add(new T.HemisphereLight(0x7f9cff, 0x0d2412, 0.55));
  const foco = new T.DirectionalLight(0xfff2da, 2.4);
  foco.position.set(-14, 26, 22);
  foco.target.position.set(0, 0, 5);
  foco.castShadow = true;
  const ts = calidad === 'alta' ? 2048 : 1024;
  foco.shadow.mapSize.set(ts, ts);
  Object.assign(foco.shadow.camera, { left: -9, right: 9, top: 16, bottom: -6, near: 5, far: 70 });
  foco.shadow.bias = -0.0004;
  foco.shadow.normalBias = 0.02;
  escena.add(foco, foco.target);
  const contra = new T.DirectionalLight(0xbfd4ff, 0.9);
  contra.position.set(18, 20, -20);
  escena.add(contra);
  const cenital = new T.SpotLight(0xfff4e0, 60, 45, rad(24), 0.6, 1.2);
  cenital.position.set(0, 24, 8);
  cenital.target.position.set(0, 0, 6);
  escena.add(cenital, cenital.target);

  /* --- escenario --- */
  escena.add(crearCesped(calidad));
  escena.add(crearPorteria());
  const red = crearRed();
  escena.add(red.objeto);
  const estadio = crearEstadio(calidad);
  escena.add(estadio.objeto);

  const balon = crearBalon();
  escena.add(balon);
  const sombraBalon = crearSombraBalon();
  escena.add(sombraBalon);
  function crearSombraBalon() { return crearSombraBlob(); }

  /* estela: esferas pequeñas que siguen al balón */
  const estela = [];
  const estelaMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const m = new T.Mesh(new T.SphereGeometry(RADIO_BALON * (0.9 - i * 0.1), 10, 8), estelaMat.clone());
    m.visible = false; escena.add(m); estela.push(m);
  }

  /* dianas A-D en la portería y trayectoria prevista.
     V4: disco oscuro con aro amarillo, más grandes y opacas; al apuntar,
     la elegida crece y las demás se apagan. */
  const dianas = {};
  Object.entries(DIANAS).forEach(([k, v]) => {
    const tx = lienzo(128, 128, (g) => {
      g.fillStyle = 'rgba(10,16,32,0.62)'; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#f7c948'; g.lineWidth = 7; g.setLineDash([10, 8]);
      g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.font = 'bold 54px Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k, 64, 68);
    });
    const s = new T.Sprite(new T.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, opacity: 0.92 }));
    s.scale.set(0.95, 0.95, 1);
    s.position.set(v.x, v.y, -0.05);
    escena.add(s); dianas[k] = s;
  });
  const puntosTray = 34;
  const trayGeo = new T.BufferGeometry();
  trayGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(puntosTray * 3), 3));
  const trayectoria = new T.Points(trayGeo, new T.PointsMaterial({ color: 0xffffff, size: 0.2, transparent: true, opacity: 0, depthWrite: false }));
  escena.add(trayectoria);

  /* --- cámara --- */
  const camara = new T.PerspectiveCamera(17.5, 1, 0.1, 200);
  const CAM = {
    base: new T.Vector3(2.4, 4.9, 26.0),
    cerca: new T.Vector3(2.0, 4.55, 24.1),
    mira: new T.Vector3(-0.25, 1.0, 3.2)
  };

  /* --- personajes --- */
  const gltf = await new Promise((ok, ko) => new T.GLTFLoader().load(URL_JUGADOR, ok, undefined, ko));
  const eqs = Object.assign({}, EQUIPACION_BASE);
  const lanzador = crearPersonaje(gltf, eqs.lanzador, false);
  const portero = crearPersonaje(gltf, eqs.portero, true);
  escena.add(lanzador.raiz, portero.raiz);
  lanzador.raiz.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  /* clips: los del GLB + los nuestros */
  const clipGLB = (n) => gltf.animations.find((a) => a.name.endsWith(n));
  const referencia = T.cloneSkinned(gltf.scene);
  const poser = prepararPoser(referencia);
  const PE = (n) => espejo(POSE[n]);
  const CLIPS = {
    reposo: clipGLB('Man_Idle'),
    carrera: clipGLB('Man_Run'),
    /* V4: patada en cinco claves suaves (armado, contacto, continuación alta,
       aterrizaje sobre la pierna de golpeo y recuperación) */
    patada: poser.clipSuave('Patada', [
      { t: 0, pose: POSE.armado },
      { t: 0.14, pose: POSE.contacto, ease: entrada },
      { t: 0.32, pose: POSE.continuacion, ease: salida },
      { t: 0.54, pose: POSE.aterrizaje },
      { t: 0.95, pose: POSE.recuperacion }
    ]),
    celebrar: poser.clipSuave('Celebrar', [
      { t: 0, pose: POSE.recuperacion },
      { t: 0.15, pose: POSE.celCarga },
      { t: 0.33, pose: POSE.celSalto, ease: salida },
      { t: 0.5, pose: POSE.celCarga },
      { t: 0.66, pose: POSE.celPuno, ease: salida },
      { t: 0.95, pose: POSE.celAvion },
      { t: 1.4, pose: POSE.celAvion }
    ]),
    lamento: poser.clipSuave('Lamento', [
      { t: 0, pose: POSE.recuperacion },
      { t: 0.2, pose: POSE.lamSube },
      { t: 0.38, pose: POSE.lamCabeza, ease: salida },
      { t: 0.62, pose: POSE.lamCabeza },
      { t: 0.95, pose: POSE.lamGacha },
      { t: 1.4, pose: POSE.lamGacha }
    ]),
    /* Portero en espera: cambia el peso de una pierna a otra (bucle de 2,4 s) */
    espera: poser.clipSuave('Espera', [
      { t: 0, pose: POSE.preparado },
      { t: 0.6, pose: POSE.preparadoL },
      { t: 1.2, pose: POSE.preparado },
      { t: 1.8, pose: PE('preparadoL') },
      { t: 2.4, pose: POSE.preparado }
    ], { bucle: true }),
    carga: poser.clip('Carga', [{ t: 0, pose: POSE.carga }, { t: 1, pose: POSE.carga }]),
    centro: poser.clipSuave('Centro', [
      { t: 0, pose: POSE.carga },
      { t: 0.16, pose: POSE.bloqueo, ease: salida },
      { t: 0.42, pose: POSE.bloqueo },
      { t: 0.6, pose: POSE.carga },
      { t: 1.05, pose: POSE.decepcion },
      { t: 1.5, pose: POSE.decepcion }
    ])
  };
  /* Estiradas: impulso, vuelo, caída y suelo. Derecha = hacia el -X del portero. */
  /* V4.6: la estirada sigue hasta el final: el portero no se queda en el suelo.
     Si para: se incorpora de rodillas, se levanta y celebra (puños, brazos en V).
     Si encaja: se queda un momento, se sienta con las manos en la cabeza, se
     levanta y se lamenta con las manos en la cintura mirando a la red. */
  const ESTIRADA_T = {
    parada: { suelo: 1.2, rodillas: 1.6, levantado: 2.25, saltos: [[2.33, 2.62, 0.26], [2.85, 3.05, 0.12]], fin: 3.7 },
    gol: { suelo: 1.4, sentado: 1.8, levantado: 3.25, giro: [3.25, 3.7], fin: 3.8 }
  };
  const claveEstirada = (gol, esp) => {
    const q = (n) => (esp ? PE(n) : POSE[n]);
    const vuelo = [
      { t: 0, pose: q('carga') },
      { t: 0.1, pose: q('impulso'), ease: salida },
      { t: 0.3, pose: q('vuelo') },
      { t: 0.44, pose: q('vuelo') },
      { t: 0.64, pose: q('caida') }
    ];
    if (!gol) {
      return vuelo.concat([
        { t: 0.95, pose: q('sueloParada') },
        { t: 1.2, pose: q('sueloParada') },
        { t: 1.6, pose: q('rodillas') },
        { t: 1.95, pose: q('rodillaArriba') },
        { t: 2.25, pose: POSE.triunfoCarga },
        { t: 2.5, pose: POSE.triunfoV, ease: salida },
        { t: 2.75, pose: POSE.triunfoCarga },
        { t: 2.95, pose: POSE.triunfoPuno, ease: salida },
        { t: 3.3, pose: POSE.triunfoV },
        { t: 3.7, pose: POSE.triunfoV }
      ]);
    }
    return vuelo.concat([
      { t: 0.95, pose: q('sueloGol') },
      { t: 1.4, pose: q('sueloGol') },
      { t: 1.8, pose: POSE.sentado },
      { t: 2.1, pose: POSE.sentadoCabeza },
      { t: 2.55, pose: POSE.sentadoCabeza },
      { t: 2.95, pose: q('rodillaArriba') },
      { t: 3.25, pose: POSE.recuperacion },
      { t: 3.55, pose: POSE.decepcion },
      { t: 3.8, pose: POSE.decepcion }
    ]);
  };
  CLIPS.estiradaDerecha = poser.clipSuave('EstiradaDerecha', claveEstirada(false, false));
  CLIPS.estiradaIzquierda = poser.clipSuave('EstiradaIzquierda', claveEstirada(false, true));
  CLIPS.estiradaDerechaGol = poser.clipSuave('EstiradaDerechaGol', claveEstirada(true, false));
  CLIPS.estiradaIzquierdaGol = poser.clipSuave('EstiradaIzquierdaGol', claveEstirada(true, true));
  [lanzador, portero].forEach((p) => {
    Object.entries(CLIPS).forEach(([n, c]) => {
      if (!c) return;
      const a = p.mixer.clipAction(c);
      a.play(); a.setEffectiveWeight(0);
      a.clampWhenFinished = true;
      p.acciones[n] = a;
    });
  });

  const sonido = crearSonido();

  /* ==========================================================
     JUGADA: estado = f(t, plan)
  ========================================================== */
  const PORTERO_Z = 0.35;
  const INICIO = new T.Vector3(-1.3, 0, 13.75);
  const APOYO = new T.Vector3(-0.26, 0, 11.22);    /* raíz al plantar el pie de apoyo */
  const RUMBO_CARRERA = Math.atan2(APOYO.x - INICIO.x, APOYO.z - INICIO.z);
  const DIST_CARRERA = INICIO.distanceTo(APOYO);
  /* Carrera del GLB: ~4,2 m/s a velocidad 1. El clip avanza con la distancia
     recorrida (no con el reloj), así los pies no patinan; y llega a la
     pisada del pie izquierdo justo al empezar la patada. */
  const CARRERA = { velocidad: 4.2, pisadaIzquierda: 0.583, dur: CLIPS.carrera ? CLIPS.carrera.duration : 0.875 };

  /* Estiradas: cadera (pivote) al llegar al balón y al caer. */
  const ESTIRADA = {
    A: { alcance: { x: -1.7, y: 1.3, giro: 62 }, caida: { x: -1.98, y: 0.3, giro: 92 } },
    C: { alcance: { x: -1.62, y: 0.5, giro: 78 }, caida: { x: -1.78, y: 0.28, giro: 92 } },
    centro: { alcance: { x: 0, y: 1.38, giro: 0 }, caida: { x: 0, y: 0.95, giro: 0 } }
  };
  ESTIRADA.B = { alcance: { ...ESTIRADA.A.alcance, x: -ESTIRADA.A.alcance.x, giro: -ESTIRADA.A.alcance.giro }, caida: { ...ESTIRADA.A.caida, x: -ESTIRADA.A.caida.x, giro: -ESTIRADA.A.caida.giro } };
  ESTIRADA.D = { alcance: { ...ESTIRADA.C.alcance, x: -ESTIRADA.C.alcance.x, giro: -ESTIRADA.C.alcance.giro }, caida: { ...ESTIRADA.C.caida, x: -ESTIRADA.C.caida.x, giro: -ESTIRADA.C.caida.giro } };

  /* Curva escalar suave por claves [[t, v], ...] (Catmull-Rom, extremos fijos) */
  function curva(claves, t) {
    const n = claves.length;
    if (t <= claves[0][0]) return claves[0][1];
    if (t >= claves[n - 1][0]) return claves[n - 1][1];
    let i = 0;
    while (i < n - 2 && t > claves[i + 1][0]) i++;
    const u = (t - claves[i][0]) / (claves[i + 1][0] - claves[i][0]);
    const v = (k) => claves[clamp(k, 0, n - 1)][1];
    const a = v(i - 1), b = v(i), c = v(i + 1), d = v(i + 2);
    return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  }

  let plan = null;          /* { esquina, gol, estirada } */
  const tmp = new T.Vector3();
  const tmp2 = new T.Vector3();

  function rutaBalon(t, p) {
    const d = DIANAS[p.esquina];
    const P0 = PUNTO_PENALTI;
    if (t <= TL.contacto) return tmp.copy(P0);
    if (p.gol) {
      const G = tmp2.set(d.x, d.y, -0.15);
      if (t <= TL.llegada) {
        const x = tramo(t, TL.contacto, TL.llegada);
        const u = 1 - Math.pow(1 - x, 1.5);
        const C = new T.Vector3(d.x * 0.45, Math.max(d.y, 0.5) + 0.45, 5.5);
        return bezier(P0, C, G, u, tmp);
      }
      /* dentro de la portería: frena contra la red y cae */
      const u1 = tramo(t, TL.llegada, TL.llegada + 0.12);
      const fondo = new T.Vector3(d.x * 0.96, d.y * 0.92, -1.25 - (d.y / PORTERIA.alto) * -0.4);
      if (u1 < 1) return tmp.copy(G).lerp(fondo, salida(u1));
      const u2 = tramo(t, TL.llegada + 0.12, TL.llegada + 0.75);
      const y = Math.max(RADIO_BALON, lerp(fondo.y, RADIO_BALON, entrada(u2)) + Math.abs(Math.sin(u2 * Math.PI * 2)) * 0.18 * (1 - u2));
      return tmp.set(fondo.x, y, lerp(fondo.z, -1.0, u2));
    }
    /* parada: llega a las manos y sale despejado */
    const H = tmp2.set(d.x * 0.9, d.y * 0.97 + (d.y < 1 ? 0.12 : 0), 0.45);
    if (t <= TL.llegada) {
      const x = tramo(t, TL.contacto, TL.llegada);
      const u = 1 - Math.pow(1 - x, 1.5);
      const C = new T.Vector3(d.x * 0.45, Math.max(d.y, 0.5) + 0.45, 5.5);
      return bezier(P0, C, H, u, tmp);
    }
    const s = Math.sign(d.x);
    const u = tramo(t, TL.llegada, TL.llegada + 0.9);
    const R = new T.Vector3(d.x + s * 2.2, RADIO_BALON, 3.8);
    const C = new T.Vector3(d.x + s * 1.4, H.y + 1.1, 2.0);
    if (u < 1) return bezier(H, C, R, salida(u), tmp);
    const u2 = tramo(t, TL.llegada + 0.9, TL.llegada + 1.8);
    return tmp.set(R.x + s * 1.2 * salida(u2), RADIO_BALON, R.z + 1.4 * salida(u2));
  }

  const modCarrera = (x) => ((x % CARRERA.dur) + CARRERA.dur) % CARRERA.dur;
  const _dirCarrera = new T.Vector3().subVectors(APOYO, INICIO).normalize();

  function evaluarLanzador(t, p) {
    const raiz = lanzador.raiz;
    const pos = tmp.set(0, 0, 0);
    let rumbo = RUMBO_CARRERA;
    let acciones;
    let planos = [1, 1];
    let modo = 'pies';
    let salto = 0;
    if (!p || t < TL.carrera) {
      pos.copy(INICIO);
      acciones = [['reposo', t % CLIPS.reposo.duration, 1]];
      planos = [0, 0];
    } else if (t < TL.patada) {
      /* Carrera: arranca desde parado y llega lanzada a la pisada */
      const u = tramo(t, TL.carrera, TL.patada);
      const s = u * u * (2 - u);
      pos.copy(INICIO).lerp(APOYO, s);
      const recorrido = DIST_CARRERA * s;
      const fase = modCarrera(CARRERA.pisadaIzquierda - DIST_CARRERA / CARRERA.velocidad + recorrido / CARRERA.velocidad);
      const w = suave(tramo(t, TL.carrera, TL.carrera + 0.16));
      acciones = [['reposo', t % CLIPS.reposo.duration, 1 - w], ['carrera', fase, w]];
      planos = [0, 0];
      modo = null; /* la carrera tiene fases de vuelo propias */
    } else {
      const k = t - TL.patada;
      /* sigue avanzando un poco por inercia y frena */
      const avance = 0.34 * salida(tramo(t, TL.patada, TL.contacto + 0.42));
      pos.copy(APOYO).addScaledVector(_dirCarrera, avance);
      rumbo = lerp(RUMBO_CARRERA, Math.PI, enSalida(tramo(t, TL.patada - 0.04, TL.contacto + 0.1)));
      const w = suave(tramo(t, TL.patada - 0.02, TL.patada + 0.07));
      acciones = [['carrera', CARRERA.pisadaIzquierda, 1 - w], ['patada', k, w]];
      /* pie de apoyo plano hasta el despegue; al aterrizar, los dos */
      planos = [1 - suave(tramo(k, 0.26, 0.34)) * 0.7, suave(tramo(k, 0.46, 0.6))];
      /* saltito de continuación sobre el pie de apoyo */
      salto = 0.06 * campana(tramo(k, 0.22, 0.52));
      if (t > TL.resolucion) {
        const kr = t - TL.resolucion;
        const wr = suave(tramo(kr, 0, 0.3));
        acciones[1][2] *= 1 - wr;
        planos = [1, 1];
        if (p.gol) {
          acciones.push(['celebrar', kr, wr]);
          /* se gira hacia la cámara y da dos saltos */
          rumbo = lerp(Math.PI, 0.5, enSalida(tramo(kr, 0.12, 0.85)));
          pos.x += 0.45 * suave(tramo(kr, 0.1, 0.95));
          pos.z += 0.35 * suave(tramo(kr, 0.1, 0.95));
          salto = 0.3 * campana(tramo(kr, 0.2, 0.46)) + 0.12 * campana(tramo(kr, 0.56, 0.74));
          planos = [1 - campana(tramo(kr, 0.2, 0.46)), 1 - campana(tramo(kr, 0.2, 0.46))];
        } else {
          acciones.push(['lamento', kr, wr]);
          pos.z += 0.3 * suave(tramo(kr, 0.1, 0.8));
          rumbo = lerp(Math.PI, Math.PI - 0.35, suave(tramo(kr, 0.2, 0.95)));
        }
      }
    }
    raiz.position.copy(pos);
    lanzador.pivote.rotation.set(0, rumbo, 0);
    mezclar(lanzador, acciones, { planos });
    apoyar(lanzador, modo, 1);
    raiz.position.y += salto;
  }

  function evaluarPortero(t, p) {
    const pv = portero.pivote;
    const raiz = portero.raiz;
    raiz.position.set(0, 0, PORTERO_Z);
    const i0 = TL.contacto - 0.04;
    if (!p || t < i0) {
      /* espera: cambia el peso de pierna y se balancea con él */
      const fase = t % CLIPS.espera.duration;
      pv.position.set(-Math.sin((fase / CLIPS.espera.duration) * Math.PI * 2) * 0.1, 0.95, 0);
      pv.rotation.set(0, 0, 0);
      let acciones = [['espera', fase, 1]];
      let salto = 0;
      if (p) {
        /* paso previo (split step): saltito y cae más flexionado */
        salto = 0.07 * campana(tramo(t, TL.contacto - 0.32, TL.contacto - 0.14));
        const wc = suave(tramo(t, TL.contacto - 0.2, TL.contacto - 0.08));
        acciones = [['espera', fase, 1 - wc], ['carga', 0, wc]];
        pv.position.x *= 1 - wc;
      }
      mezclar(portero, acciones, { planos: [1, 1] });
      apoyar(portero, 'pies', 1);
      raiz.position.y += salto;
      return;
    }
    const e = ESTIRADA[p.estirada] || ESTIRADA.centro;
    const k = t - i0;
    const kL = TL.llegada - i0;
    const w = suave(tramo(k, 0, 0.08));
    if (p.estirada === 'centro') {
      /* se queda en el centro: salta a bloquear, cae y se gira hacia la red */
      pv.position.set(0, 0.95, 0);
      const d = DIANAS[p.esquina];
      pv.rotation.set(0, Math.atan2(d.x, -1.2) * enSalida(tramo(k, 0.75, 1.35)), 0);
      mezclar(portero, [['carga', 0, 1 - w], ['centro', k, w]], { planos: [1, 1] });
      apoyar(portero, 'pies', 1);
      raiz.position.y += 0.36 * campana(tramo(k, 0.06, 0.58));
      return;
    }
    const dir = Math.sign(e.alcance.x);
    const bajo = p.estirada === 'C' || p.estirada === 'D';
    const x = curva([[0, 0], [0.1, dir * 0.28], [kL, e.alcance.x], [kL + 0.24, e.caida.x], [kL + 0.7, e.caida.x * 1.04]], k);
    const y = curva([[0, 0.95], [0.1, 0.84], [kL * 0.7, e.alcance.y + (bajo ? 0.06 : 0.12)], [kL, e.alcance.y], [kL + 0.24, 0.32], [kL + 0.7, 0.3]], k);
    const et = p.gol ? ESTIRADA_T.gol : ESTIRADA_T.parada;
    /* rueda de estar tumbado de lado a incorporado (de rodillas o sentado) */
    const tIncorporado = p.gol ? et.sentado : et.rodillas;
    const giro = curva([[0, 0], [0.1, e.alcance.giro * 0.22], [kL, e.alcance.giro], [kL + 0.24, e.caida.giro], [et.suelo, e.caida.giro], [tIncorporado, 0]], k);
    pv.position.set(x, y, 0);
    /* al levantarse tras un gol, se gira a mirar la red */
    let rumbo = 0;
    if (p.gol) {
      const d = DIANAS[p.esquina];
      rumbo = Math.atan2(d.x - x, -1.3) * enSalida(tramo(k, et.giro[0], et.giro[1]));
    }
    pv.rotation.set(0, rumbo, rad(giro));
    const clip = (dir < 0 ? 'estiradaDerecha' : 'estiradaIzquierda') + (p.gol ? 'Gol' : '');
    /* pies en el suelo en el impulso; en el aire, libre; al caer, el cuerpo apoyado */
    const enSuelo = 1 - suave(tramo(k, 0.05, 0.13));
    const tumbado = suave(tramo(k, kL + 0.1, kL + 0.3));
    const dePie = suave(tramo(k, (p.gol ? et.levantado : ESTIRADA_T.parada.levantado) - 0.25, p.gol ? et.levantado : ESTIRADA_T.parada.levantado));
    const planos = Math.max(enSuelo, dePie);
    mezclar(portero, [['carga', 0, 1 - w], [clip, k, w]], { planos: [planos, planos] });
    raiz.position.y = 0;
    if (enSuelo > 0.001) apoyar(portero, 'pies', enSuelo);
    else if (tumbado > 0.001) apoyar(portero, 'cuerpo', tumbado);
    else apoyar(portero, null);
    /* saltos de celebración tras la parada */
    if (!p.gol) {
      et.saltos.forEach(([a, b, h]) => { raiz.position.y += h * campana(tramo(k, a, b)); });
    }
  }

  function evaluar(t) {
    const p = plan;
    evaluarLanzador(t, p);
    evaluarPortero(t, p);
    const b = p ? rutaBalon(t, p) : tmp.copy(PUNTO_PENALTI);
    balon.position.copy(b);
    const vuelo = p && t > TL.contacto ? t - TL.contacto : 0;
    balon.rotation.set(-vuelo * 26, vuelo * 7, 0);
    sombraBalon.position.set(b.x, 0.012, b.z);
    const alt = b.y - RADIO_BALON;
    sombraBalon.scale.setScalar(1 + alt * 0.6);
    sombraBalon.material.opacity = clamp(1 - alt / 3, 0.15, 1);

    /* estela durante el vuelo */
    const enVuelo = p && t > TL.contacto && t < TL.llegada + 0.1;
    estela.forEach((m, i) => {
      if (!enVuelo) { m.visible = false; return; }
      const ti = t - (i + 1) * 0.022;
      if (ti < TL.contacto) { m.visible = false; return; }
      m.visible = true;
      m.position.copy(rutaBalon(ti, p));
      m.material.opacity = 0.32 * (1 - i / estela.length);
    });

    /* red */
    if (p && p.gol) {
      const d = DIANAS[p.esquina];
      const f = t < TL.llegada + 0.05 ? 0 : Math.exp(-(t - TL.llegada - 0.12) * 5) * Math.min(1, (t - TL.llegada - 0.05) / 0.07);
      red.deformar(d, clamp(f, 0, 1));
    } else {
      red.deformar(DIANAS.A, 0);
    }

    /* grada */
    const euforia = p && p.gol ? suave(tramo(t, TL.llegada + 0.05, TL.llegada + 0.35)) * (1 - tramo(t, 3.2, 5)) : 0;
    estadio.animarPublico(t, euforia);
    estadio.animarFlashes(t, p && p.gol ? euforia : (p && t > TL.llegada ? 0.15 : 0.05));
  }

  function camaraRetransmision(t, p) {
    const u = suave(tramo(t, 0, TL.contacto));
    camara.position.copy(CAM.base).lerp(CAM.cerca, u);
    const mira = tmp2.copy(CAM.mira);
    if (p && t > TL.contacto) {
      const d = DIANAS[p.esquina];
      const k = suave(tramo(t, TL.contacto, TL.llegada + 0.3)) * 0.22;
      mira.x += d.x * k; mira.y += (d.y - 1.1) * k * 0.5;
      /* sacudida corta al golpeo */
      const sac = Math.exp(-(t - TL.contacto) * 18) * 0.03;
      camara.position.x += Math.sin(t * 90) * sac; camara.position.y += Math.cos(t * 77) * sac;
    }
    camara.fov = lerp(17.5, 15.5, suave(tramo(t, TL.contacto, TL.llegada + 0.2)));
    camara.updateProjectionMatrix();
    camara.lookAt(mira);
  }

  function camaraLateral(t, p) {
    const d = DIANAS[p.esquina];
    const s = Math.sign(d.x) || 1;
    const avance = suave(tramo(t, REPETICION.desde, REPETICION.hasta));
    camara.position.set(-s * lerp(8.6, 7.4, avance), lerp(1.75, 1.35, avance), lerp(8.4, 5.8, avance));
    const u = suave(tramo(t, TL.contacto - 0.12, TL.llegada + 0.12));
    const mira = tmp2.set(lerp(-0.3, d.x * 0.7, u), lerp(0.95, Math.max(0.9, d.y * 0.8), u), lerp(11, 0.4, u));
    camara.fov = 44;
    camara.updateProjectionMatrix();
    camara.lookAt(mira);
  }

  /* ==========================================================
     BUCLE: solo corre mientras la escena es visible, y a
     menos fotogramas cuando no hay jugada.
  ========================================================== */
  let reloj = { modo: 'espera', t0: performance.now(), t: 0, resolver: null, repeticion: null };
  let visible = true;
  let raf = 0;
  let ultimoCuadro = 0;
  let ancho = 0, alto = 0;
  /* V4.14: medir el contenedor solo cuando cambia (antes, cada fotograma
     forzaba un layout con getBoundingClientRect) */
  let medir = true;
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { medir = true; }) : null;
  if (ro) ro.observe(contenedor);

  /* V4.14: calidad adaptativa. Si durante la jugada los fotogramas van
     lentos (mediana > 25 ms), baja un escalón y lo recuerda para la
     próxima visita: 1) resolución 1x, 2) sin sombras. */
  const CLAVE_NIVEL = 'penaltis:v4:nivel3d';
  let nivel = 0;
  try { nivel = Math.min(2, Number(localStorage.getItem(CLAVE_NIVEL)) || 0); } catch (e) { /* sin almacenamiento */ }
  const muestras = [];
  function aplicarNivel() {
    if (nivel >= 1) { render.setPixelRatio(1); ancho = 0; medir = true; }
    if (nivel >= 2 && foco.castShadow) { foco.castShadow = false; escena.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); }); }
  }
  function vigilar(dt) {
    if (opciones.calidad || nivel >= 2 || dt <= 0 || dt > 250) return;
    muestras.push(dt);
    if (muestras.length < 40) return;
    const orden = muestras.slice().sort((a, b) => a - b);
    muestras.length = 0;
    if (orden[20] > 25) {
      nivel += 1;
      try { localStorage.setItem(CLAVE_NIVEL, String(nivel)); } catch (e) { /* sin almacenamiento */ }
      aplicarNivel();
    }
  }

  function ajustar() {
    if (!medir) return;
    medir = false;
    const r = contenedor.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === ancho && h === alto) return;
    ancho = w; alto = h;
    render.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }

  function cuadro(ahora) {
    raf = 0;
    if (!visible) return;
    ajustar();
    const dt = ahora - ultimoCuadro;
    if (reloj.modo === 'espera' && dt < 1000 / 30) { pedir(); return; }
    if (reloj.modo !== 'espera' && ultimoCuadro) vigilar(dt);
    ultimoCuadro = ahora;
    const tr = (ahora - reloj.t0) / 1000;
    if (reloj.modo === 'espera') {
      evaluar(plan ? TL.fin : (reducido ? 0 : tr));
      camaraRetransmision(plan ? TL.fin : 0, plan);
      if (plan || reducido) { render.render(escena, camara); return; } /* quieta: sin bucle */
    } else if (reloj.modo === 'tiro') {
      const t = (reducido || reloj.instantaneo) ? TL.fin : tr;
      evaluar(t);
      camaraRetransmision(t, plan);
      disparos(t);
      if (t >= TL.resolucion && reloj.resolver) { const r = reloj.resolver; reloj.resolver = null; r(); }
      if (t >= TL.fin) {
        if (!reducido && !reloj.instantaneo && opciones.repeticion !== false) empezarRepeticion();
        else reloj.modo = 'espera';
      }
    } else if (reloj.modo === 'repeticion') {
      const t = REPETICION.desde + tr * REPETICION.velocidad;
      evaluar(Math.min(t, REPETICION.hasta));
      camaraLateral(t, plan);
      if (t >= REPETICION.hasta) terminarRepeticion();
    }
    render.render(escena, camara);
    pedir();
  }
  function pedir() { if (!raf && visible) raf = requestAnimationFrame(cuadro); }

  /* sonidos disparados una vez por jugada */
  let hechos = {};
  function disparos(t) {
    const una = (k, cond, fn) => { if (cond && !hechos[k]) { hechos[k] = true; fn(); } };
    una('silbato', t > 0.05, () => sonido.silbato());
    una('golpeo', t >= TL.contacto, () => sonido.golpeo());
    una('llegada', t >= TL.llegada, () => { if (plan.gol) sonido.red(); else sonido.parada(); sonido.grito(plan.gol); });
  }

  function empezarRepeticion() {
    reloj.modo = 'repeticion';
    reloj.t0 = performance.now();
    contenedor.classList.add('is-repeticion');
    if (opciones.alRepetir) opciones.alRepetir(true);
  }
  function terminarRepeticion() {
    reloj.modo = 'espera';
    pedir();
    contenedor.classList.remove('is-repeticion');
    if (opciones.alRepetir) opciones.alRepetir(false);
  }

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
    visible = ents.some((e) => e.isIntersecting) && !document.hidden;
    if (visible) { ultimoCuadro = 0; pedir(); }
  }) : null;
  if (io) io.observe(contenedor);
  const alCambiarVisibilidad = () => { visible = !document.hidden; if (visible) pedir(); };
  document.addEventListener('visibilitychange', alCambiarVisibilidad);

  /* ==========================================================
     API
  ========================================================== */
  function trazarTrayectoria(esquina) {
    const d = DIANAS[esquina];
    const P = trayGeo.attributes.position.array;
    const G = new T.Vector3(d.x, d.y, -0.1);
    const C = new T.Vector3(d.x * 0.45, Math.max(d.y, 0.5) + 0.45, 5.5);
    for (let i = 0; i < puntosTray; i++) {
      bezier(PUNTO_PENALTI, C, G, i / (puntosTray - 1), tmp);
      P[i * 3] = tmp.x; P[i * 3 + 1] = tmp.y; P[i * 3 + 2] = tmp.z;
    }
    trayGeo.attributes.position.needsUpdate = true;
  }

  const api = {
    lista: true,
    preparar({ equipaciones } = {}) {
      if (equipaciones) {
        if (equipaciones.lanzador) recolorear(lanzador, Object.assign({}, EQUIPACION_BASE.lanzador, equipaciones.lanzador));
        if (equipaciones.portero) recolorear(portero, Object.assign({}, EQUIPACION_BASE.portero, equipaciones.portero));
      }
      plan = null;
      hechos = {};
      if (reloj.modo === 'repeticion') terminarRepeticion();
      reloj = { modo: 'espera', t0: performance.now(), resolver: null };
      Object.values(dianas).forEach((s) => { s.material.opacity = 0.92; s.visible = true; s.material.color.set('#ffffff'); s.scale.setScalar(0.95); });
      trayectoria.material.opacity = 0;
      pedir();
    },
    apuntar(esquina) {
      Object.entries(dianas).forEach(([k, s]) => { s.material.opacity = !esquina ? 0.92 : (k === esquina ? 1 : 0.3); s.scale.setScalar(!esquina ? 0.95 : (k === esquina ? 1.2 : 0.8)); });
      if (esquina) { trazarTrayectoria(esquina); trayectoria.material.opacity = 0.85; } else { trayectoria.material.opacity = 0; }
      pedir();
    },
    tirar(p) {
      plan = { esquina: p.esquina, gol: !!p.gol, estirada: p.estirada || 'centro' };
      hechos = p.instantaneo ? { silbato: true, golpeo: true, llegada: true } : {};
      trayectoria.material.opacity = 0;
      Object.values(dianas).forEach((s) => { s.visible = false; });
      reloj = { modo: 'tiro', t0: performance.now(), resolver: null, instantaneo: !!p.instantaneo };
      ultimoCuadro = 0;
      return new Promise((ok) => { reloj.resolver = ok; pedir(); });
    },
    /* Tras el tiro: la correcta en verde y, si falló, la elegida en rojo */
    resultado({ correcta, elegida }) {
      Object.entries(dianas).forEach(([k, s]) => {
        const es = k === correcta || k === elegida;
        s.visible = es;
        s.material.opacity = 1;
        s.scale.setScalar(0.85);
        s.material.color.set(k === correcta ? '#35e06b' : '#ff5a36');
      });
      pedir();
    },
    cancelarRepeticion() { if (reloj.modo === 'repeticion') { terminarRepeticion(); plan && evaluar(TL.fin); pedir(); } },
    sonido(activo) { sonido.activar(!!activo); },
    /* Solo pruebas: congela la jugada en t con una cámara */
    fotograma(t, p, vista) {
      plan = p ? { esquina: p.esquina, gol: !!p.gol, estirada: p.estirada || 'centro' } : null;
      reloj.modo = 'congelado';
      ajustar();
      evaluar(t);
      if (vista === 'lateral' && plan) camaraLateral(t, plan);
      else if (vista && vista.startsWith('cerca:')) {
        /* cerca:<portero|lanzador>:<angulo en grados> — primer plano para revisar poses */
        const [, quien, ang] = vista.split(':');
        const obj = quien === 'portero' ? portero : lanzador;
        const c = obj.pivote.getWorldPosition(new T.Vector3());
        const a = rad(Number(ang) || 0);
        camara.position.set(c.x + Math.sin(a) * 4.2, c.y + 0.4, c.z + Math.cos(a) * 4.2);
        camara.fov = 35; camara.updateProjectionMatrix();
        camara.lookAt(c.x, c.y - 0.1, c.z);
      } else camaraRetransmision(t, plan);
      render.render(escena, camara);
    },
    /* Solo pruebas: coste de dibujo (llamadas, triángulos, texturas) */
    rendimiento() {
      const i = render.info;
      return { calidad, nivel, pixelRatio: render.getPixelRatio(), lienzo: [lienzoGL.width, lienzoGL.height], llamadas: i.render.calls, triangulos: i.render.triangles, geometrias: i.memory.geometries, texturas: i.memory.textures, sombra: foco.shadow.mapSize.x };
    },
    /* Solo pruebas: una pose suelta, para ajustarla (quien, pose, raiz, pivote, modo, vista) */
    laboratorio({ quien = 'portero', pose = {}, pivote = {}, modo = 'pies', vista = 'cerca:portero:0' } = {}) {
      const inst = quien === 'portero' ? portero : lanzador;
      const c = poser.clip('Lab', [{ t: 0, pose }, { t: 1, pose }]);
      const a = inst.mixer.clipAction(c); a.play();
      inst.acciones.__lab = a;
      inst.raiz.position.set(pivote.x || 0, 0, pivote.z != null ? pivote.z : (quien === 'portero' ? PORTERO_Z : 11.5));
      inst.pivote.position.set(0, pivote.y != null ? pivote.y : 0.95, 0);
      inst.pivote.rotation.set(0, rad(pivote.ry || 0), rad(pivote.rz || 0));
      mezclar(inst, [['__lab', 0, 1]], { planos: modo === 'pies' ? [1, 1] : [0, 0] });
      apoyar(inst, modo, 1);
      const r = { min: +puntoMasBajo(inst, false).toFixed(3), cadera: +inst.huesos.Hips.getWorldPosition(new T.Vector3()).y.toFixed(3), pecho: +inst.huesos.Torso.getWorldPosition(new T.Vector3()).y.toFixed(3) };
      const [, , ang] = vista.split(':');
      const cc = inst.pivote.getWorldPosition(new T.Vector3());
      const an = rad(Number(ang) || 0);
      camara.position.set(cc.x + Math.sin(an) * 4.2, cc.y + 0.3, cc.z + Math.cos(an) * 4.2);
      camara.fov = 35; camara.updateProjectionMatrix(); camara.lookAt(cc.x, cc.y - 0.15, cc.z);
      reloj.modo = 'congelado';
      render.render(escena, camara);
      a.stop(); delete inst.acciones.__lab; inst.mixer.uncacheClip(c);
      return r;
    },
    /* Solo pruebas: medidas de la pose en t (altura mínima de la malla,
       pies, manos y distancia del pie de golpeo al balón). */
    inspeccion(t, p) {
      plan = p ? { esquina: p.esquina, gol: !!p.gol, estirada: p.estirada || 'centro' } : null;
      reloj.modo = 'congelado';
      evaluar(t);
      const v = new T.Vector3();
      const medir = (inst, mats) => {
        let m = Infinity;
        inst.raiz.updateMatrixWorld(true);
        inst.modelo.traverse((o) => {
          if (!o.isSkinnedMesh) return;
          if (mats && !mats.includes(o.material.name)) return;
          const n = o.geometry.attributes.position.count;
          for (let i = 0; i < n; i += 2) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (v.y < m) m = v.y; }
        });
        return +m.toFixed(3);
      };
      const hueso = (inst, n) => inst.huesos[n].getWorldPosition(new T.Vector3());
      const pieR = hueso(lanzador, 'FootR');
      /* qué parte del portero toca el suelo */
      let bajo = { y: Infinity };
      portero.raiz.updateMatrixWorld(true);
      portero.mallas.forEach((o) => {
        const n = o.geometry.attributes.position.count;
        for (let i = 0; i < n; i += 3) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (v.y < bajo.y) bajo = { y: +v.y.toFixed(3), mat: o.material.name, x: +v.x.toFixed(2), z: +v.z.toFixed(2) }; }
      });
      const alt = (n) => +hueso(portero, n).y.toFixed(2);
      const partes = { cabeza: alt('Head'), torso: alt('Torso'), cadera: alt('Hips'), manoR: alt('PalmR'), manoL: alt('PalmL'), codoR: alt('LowerArmR'), codoL: alt('LowerArmL'), rodR: alt('LowerLegR'), rodL: alt('LowerLegL'), pieR: alt('FootR'), pieL: alt('FootL') };
      return {
        lanzador: { min: medir(lanzador), zapatos: medir(lanzador, ['Shoes']), pieR: pieR.toArray().map((x) => +x.toFixed(3)), pieL: hueso(lanzador, 'FootL').toArray().map((x) => +x.toFixed(3)) },
        portero: { min: medir(portero), zapatos: medir(portero, ['Shoes']), cadera: portero.huesos.Hips.getWorldPosition(new T.Vector3()).toArray().map((x) => +x.toFixed(3)), manoR: hueso(portero, 'PalmR').toArray().map((x) => +x.toFixed(3)), manoL: hueso(portero, 'PalmL').toArray().map((x) => +x.toFixed(3)) },
        bajo, partes,
        balon: balon.position.toArray().map((x) => +x.toFixed(3)),
        distPieBalon: +pieR.distanceTo(balon.position).toFixed(3)
      };
    },
    destruir() {
      cancelAnimationFrame(raf); visible = false;
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      if (ro) ro.disconnect();
      sonido.destruir();
      render.dispose();
      lienzoGL.remove();
    }
  };

  aplicarNivel();
  ajustar();
  evaluar(0);
  camaraRetransmision(0, null);
  /* V4.14: compila los shaders sin bloquear (KHR_parallel_shader_compile)
     antes del primer dibujo: el reloj de la pregunta no se congela. */
  if (render.compileAsync) { try { await render.compileAsync(escena, camara); } catch (e) { /* se compila al dibujar */ } }
  render.render(escena, camara);
  pedir();
  return api;
}
