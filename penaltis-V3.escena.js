/* ==========================================================
   POC Tanda de penaltis V3 — escena 3D (Three.js r186)
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
  fin: 2.6           /* la escena queda quieta */
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

  return { clip };
}

/* ---------- Poses ---------- */
const POSE = {
  /* Lanzador: armado, contacto, continuación y recuperación */
  armado: {
    UpperLegR: [['x', 36]], LowerLegR: [['x', 82]],
    UpperLegL: [['x', -26]], LowerLegL: [['x', 36]],
    Abdomen: [['x', 10], ['y', 10]], Torso: [['y', 6]],
    UpperArmL: [['z', 40], ['x', -20]], LowerArmL: [['x', -30]],
    UpperArmR: [['z', -22], ['x', 24]], LowerArmR: [['x', -30]]
  },
  contacto: {
    UpperLegR: [['x', -34]], LowerLegR: [['x', 28]],
    UpperLegL: [['x', -28]], LowerLegL: [['x', 38]],
    Abdomen: [['x', 6], ['y', -6]], Torso: [['y', -4]],
    UpperArmL: [['z', 52], ['x', -10]], LowerArmL: [['x', -25]],
    UpperArmR: [['z', -18], ['x', -28]], LowerArmR: [['x', -40]]
  },
  continuacion: {
    UpperLegR: [['x', -68]], LowerLegR: [['x', 16]],
    UpperLegL: [['x', -14]], LowerLegL: [['x', 20]],
    Abdomen: [['x', -8], ['y', -12]], Torso: [['y', -8]],
    UpperArmL: [['z', 46], ['x', 10]], LowerArmL: [['x', -30]],
    UpperArmR: [['z', -22], ['x', -38]], LowerArmR: [['x', -40]]
  },
  recuperacion: {
    UpperLegR: [['x', -18]], LowerLegR: [['x', 26]],
    UpperLegL: [['x', -6]], LowerLegL: [['x', 10]],
    Abdomen: [['x', 2]],
    UpperArmL: [['z', 28]], LowerArmL: [['x', -20]],
    UpperArmR: [['z', -26]], LowerArmR: [['x', -20]]
  },
  celebrar: {
    UpperArmL: [['z', 150], ['x', -10]], LowerArmL: [['x', -15]],
    UpperArmR: [['z', -150], ['x', -10]], LowerArmR: [['x', -15]],
    Abdomen: [['x', -12]], Neck: [['x', -18]],
    UpperLegL: [['x', -10]], LowerLegL: [['x', 14]], UpperLegR: [['x', -4]], LowerLegR: [['x', 10]]
  },
  lamento: {
    UpperArmL: [['z', 118], ['x', -40]], LowerArmL: [['x', -110]],
    UpperArmR: [['z', -118], ['x', -40]], LowerArmR: [['x', -110]],
    Abdomen: [['x', 14]], Neck: [['x', 18]],
    UpperLegL: [['x', -8]], LowerLegL: [['x', 12]], UpperLegR: [['x', -8]], LowerLegR: [['x', 12]]
  },
  /* Portero */
  preparado: {
    UpperLegL: [['x', -40], ['z', 12]], LowerLegL: [['x', 68]],
    UpperLegR: [['x', -40], ['z', -12]], LowerLegR: [['x', 68]],
    Abdomen: [['x', 16]], Torso: [['x', 6]], Neck: [['x', -18]],
    UpperArmL: [['z', 38], ['x', -34]], LowerArmL: [['x', -50]],
    UpperArmR: [['z', -38], ['x', -34]], LowerArmR: [['x', -50]]
  },
  /* Estirada hacia la derecha del portero (su -X). La izquierda es el espejo. */
  estiradaDerecha: {
    UpperArmR: [['z', -170]], LowerArmR: [['x', -6]],
    UpperArmL: [['z', 162], ['x', -8]], LowerArmL: [['x', -10]],
    Abdomen: [['z', 8]], Torso: [['z', 5]], Neck: [['z', 8]],
    UpperLegL: [['z', 6], ['x', -8]], LowerLegL: [['x', 12]],
    UpperLegR: [['x', -20]], LowerLegR: [['x', 34]]
  },
  salto: {
    UpperArmR: [['z', -158]], LowerArmR: [['x', -8]],
    UpperArmL: [['z', 158]], LowerArmL: [['x', -8]],
    UpperLegL: [['x', -20], ['z', 8]], LowerLegL: [['x', 40]],
    UpperLegR: [['x', -20], ['z', -8]], LowerLegR: [['x', 40]]
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
    g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
    const textos = ['TANDA DE PENALTIS', '42DS', 'CINCO PREGUNTAS', 'TANDA DE PENALTIS', '42DS'];
    let x = 20;
    g.font = 'bold 40px Arial, sans-serif';
    g.textBaseline = 'middle';
    textos.forEach((t, i) => {
      g.fillStyle = i % 2 ? '#f2c200' : '#ffffff';
      g.fillText(t, x, H / 2 + 2);
      x += g.measureText(t).width + 60;
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
  inst.pies = ['L', 'R'].map((lado) => {
    const tibia = huesos['LowerLeg' + lado], pie = huesos['Foot' + lado];
    return { tibia, pie, rel: tibia.matrixWorld.clone().invert().multiply(pie.matrixWorld) };
  });
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

function mezclar(inst, lista) {
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

  /* dianas A-D en la portería y trayectoria prevista */
  const dianas = {};
  Object.entries(DIANAS).forEach(([k, v]) => {
    const tx = lienzo(128, 128, (g) => {
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 6; g.setLineDash([10, 8]);
      g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.font = 'bold 54px Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k, 64, 68);
    });
    const s = new T.Sprite(new T.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, opacity: 0.55 }));
    s.scale.set(0.8, 0.8, 1);
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
  const CLIPS = {
    reposo: clipGLB('Man_Idle'),
    carrera: clipGLB('Man_Run'),
    patada: poser.clip('Patada', [
      { t: 0, pose: POSE.armado },
      { t: 0.14, pose: POSE.contacto },
      { t: 0.34, pose: POSE.continuacion },
      { t: 0.7, pose: POSE.recuperacion }
    ]),
    celebrar: poser.clip('Celebrar', [{ t: 0, pose: POSE.celebrar }, { t: 1, pose: POSE.celebrar }]),
    lamento: poser.clip('Lamento', [{ t: 0, pose: POSE.lamento }, { t: 1, pose: POSE.lamento }]),
    preparado: poser.clip('Preparado', [{ t: 0, pose: POSE.preparado }, { t: 1, pose: POSE.preparado }]),
    estiradaDerecha: poser.clip('EstiradaDerecha', [{ t: 0, pose: POSE.estiradaDerecha }, { t: 1, pose: POSE.estiradaDerecha }]),
    estiradaIzquierda: poser.clip('EstiradaIzquierda', [{ t: 0, pose: espejo(POSE.estiradaDerecha) }, { t: 1, pose: espejo(POSE.estiradaDerecha) }]),
    salto: poser.clip('Salto', [{ t: 0, pose: POSE.salto }, { t: 1, pose: POSE.salto }])
  };
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
  const INICIO = new T.Vector3(-1.05, 0, 13.5);
  const APOYO = new T.Vector3(-0.2, 0, 11.3);   /* pie de apoyo junto al balón */

  /* Estiradas: pivote (cadera) en el momento de llegar al balón y al caer. */
  const ESTIRADA = {
    A: { alcance: { x: -1.72, y: 1.28, giro: 58 }, caida: { x: -1.95, y: 0.3, giro: 86 } },
    C: { alcance: { x: -1.62, y: 0.42, giro: 80 }, caida: { x: -1.72, y: 0.28, giro: 88 } },
    centro: { alcance: { x: 0, y: 1.38, giro: 0 }, caida: { x: 0, y: 0.95, giro: 0 } }
  };
  ESTIRADA.B = { alcance: { ...ESTIRADA.A.alcance, x: -ESTIRADA.A.alcance.x, giro: -ESTIRADA.A.alcance.giro }, caida: { ...ESTIRADA.A.caida, x: -ESTIRADA.A.caida.x, giro: -ESTIRADA.A.caida.giro } };
  ESTIRADA.D = { alcance: { ...ESTIRADA.C.alcance, x: -ESTIRADA.C.alcance.x, giro: -ESTIRADA.C.alcance.giro }, caida: { ...ESTIRADA.C.caida, x: -ESTIRADA.C.caida.x, giro: -ESTIRADA.C.caida.giro } };

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

  function evaluarLanzador(t, p) {
    const raiz = lanzador.raiz;
    let pos, rumbo;
    const acciones = [];
    if (!p || t < TL.carrera) {
      pos = INICIO; rumbo = Math.atan2(APOYO.x - INICIO.x, APOYO.z - INICIO.z);
      acciones.push(['reposo', t % 4.1, 1]);
    } else if (t < TL.patada) {
      const u = tramo(t, TL.carrera, TL.patada);
      pos = tmp.copy(INICIO).lerp(APOYO, suave(u) * 0.86);
      rumbo = Math.atan2(APOYO.x - INICIO.x, APOYO.z - INICIO.z);
      const w = tramo(t, TL.carrera, TL.carrera + 0.12);
      acciones.push(['reposo', t % 4.1, 1 - w], ['carrera', (t - TL.carrera) * 1.15, w]);
    } else {
      const u = tramo(t, TL.patada, TL.contacto);
      pos = tmp.copy(INICIO).lerp(APOYO, 0.86 + 0.14 * salida(u));
      if (t > TL.contacto) pos.z -= 0.25 * salida(tramo(t, TL.contacto, TL.contacto + 0.4));
      const r0 = Math.atan2(APOYO.x - INICIO.x, APOYO.z - INICIO.z);
      rumbo = lerp(r0, Math.PI, salida(tramo(t, TL.patada, TL.contacto)));
      const w = tramo(t, TL.patada - 0.04, TL.patada + 0.05);
      acciones.push(['carrera', (t - TL.carrera) * 1.15, 1 - w], ['patada', Math.max(0, t - TL.patada), w]);
      /* reacción */
      if (p && t > TL.resolucion) {
        const wr = suave(tramo(t, TL.resolucion, TL.resolucion + 0.35));
        acciones[1][2] *= 1 - wr;
        acciones.push([p.gol ? 'celebrar' : 'lamento', 0.5, wr]);
        if (p.gol) {
          rumbo = lerp(Math.PI, Math.PI * 0.2, suave(tramo(t, TL.resolucion + 0.1, TL.resolucion + 0.9)));
          pos.y = Math.abs(Math.sin((t - TL.resolucion) * 7)) * 0.16 * wr;
          pos.x += 0.6 * suave(tramo(t, TL.resolucion, TL.fin));
        }
      }
    }
    raiz.position.copy(pos);
    lanzador.pivote.rotation.set(0, rumbo, 0);
    mezclar(lanzador, acciones);
  }

  function evaluarPortero(t, p) {
    const pv = portero.pivote;
    const raiz = portero.raiz;
    raiz.position.set(0, 0, PORTERO_Z);
    const inicioEstirada = TL.contacto + 0.05;
    if (!p || t < inicioEstirada) {
      /* preparado, con balanceo lateral y botes cortos */
      const bal = Math.sin(t * 2 * Math.PI * 0.8) * 0.14;
      pv.position.set(bal, 0.95 - 0.16 + Math.abs(Math.sin(t * 5)) * 0.015, 0);
      pv.rotation.set(0, 0, 0);
      const salto = t > TL.contacto - 0.12 ? suave(tramo(t, TL.contacto - 0.12, TL.contacto)) : 0;
      pv.position.y -= salto * 0.08;
      mezclar(portero, [['preparado', 0, 1]]);
      return;
    }
    const e = ESTIRADA[p.estirada] || ESTIRADA.centro;
    const u = tramo(t, inicioEstirada, TL.llegada);
    const uc = tramo(t, TL.llegada, TL.llegada + 0.5);
    let x, y, giro;
    const x0 = 0, y0 = 0.79;
    if (uc <= 0) {
      const s = salida(u);
      x = lerp(x0, e.alcance.x, s);
      y = lerp(y0, e.alcance.y, s) + Math.sin(u * Math.PI) * (p.estirada === 'C' || p.estirada === 'D' ? 0.1 : 0.2);
      giro = lerp(0, e.alcance.giro, salida(u));
    } else {
      const s = entrada(uc) * 0.6 + suave(uc) * 0.4;
      x = lerp(e.alcance.x, e.caida.x, s);
      y = lerp(e.alcance.y, e.caida.y, s);
      giro = lerp(e.alcance.giro, e.caida.giro, suave(uc));
      if (p.estirada === 'centro') y = lerp(e.alcance.y, 0.79, suave(uc));
    }
    pv.position.set(x, y, 0);
    pv.rotation.set(0, 0, rad(giro));
    const clip = p.estirada === 'centro' ? 'salto' : (e.alcance.x < 0 ? 'estiradaDerecha' : 'estiradaIzquierda');
    const w = suave(tramo(t, inicioEstirada, inicioEstirada + 0.14));
    mezclar(portero, [['preparado', 0, 1 - w], [clip, 0, w]]);
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

  function ajustar() {
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
      Object.values(dianas).forEach((s) => { s.material.opacity = 0.55; s.visible = true; s.material.color.set('#ffffff'); s.scale.setScalar(0.8); });
      trayectoria.material.opacity = 0;
      pedir();
    },
    apuntar(esquina) {
      Object.entries(dianas).forEach(([k, s]) => { s.material.opacity = esquina && k === esquina ? 1 : 0.55; s.scale.setScalar(esquina && k === esquina ? 0.95 : 0.8); });
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
    destruir() {
      cancelAnimationFrame(raf); visible = false;
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      sonido.destruir();
      render.dispose();
      lienzoGL.remove();
    }
  };

  ajustar();
  evaluar(0);
  camaraRetransmision(0, null);
  render.render(escena, camara);
  pedir();
  return api;
}
