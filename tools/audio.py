#!/usr/bin/env python3
"""La tanda · V4.20 · preparación de los sonidos grabados.

Convierte las grabaciones originales (assets/audio/_fuentes/, que NO se
publican) en los dos archivos que usa el juego:

  assets/audio/efectos.mp3 + efectos.json   sprite con los efectos cortos
  assets/audio/grada.mp3   + (en el json)   ambiente de grada en bucle

Todo sale mono, 44,1 kHz, MP3 64 kbps: suena igual en todos los
navegadores y pesa poco. Qué trozo se usa de cada grabación se decide en
assets/audio/fuentes.json; este script no inventa nada.

Uso (desde la carpeta tanda-de-penaltis):
  python3 tools/audio.py analizar assets/audio/_fuentes/1044.wav
      Duración, arranques de sonido (para elegir «inicio») y perfil de
      volumen cada 0,25 s (para encontrar el «¡gol!» o el «uyyy»).
  python3 tools/audio.py construir
      Genera efectos.mp3, efectos.json y grada.mp3 a partir de fuentes.json.

Requisitos: python3, numpy y ffmpeg con libmp3lame.
"""
import json
import os
import subprocess
import sys

import numpy as np

SR = 44100
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
AUDIO = os.path.join(RAIZ, 'assets', 'audio')
PREVIO = 0.05   # silencio delante de cada efecto: absorbe el retardo del codificador MP3
HUECO = 0.25    # silencio entre efectos dentro del sprite


def leer(ruta, inicio=0.0, duracion=None):
    """Devuelve la grabación (o un trozo) como float32 mono a 44,1 kHz."""
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(max(0.0, inicio))]
    if duracion:
        cmd += ['-t', str(duracion)]
    cmd += ['-i', ruta, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']
    datos = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(datos, dtype=np.float32).copy()


def db(x):
    return 20 * np.log10(max(float(x), 1e-9))


def arranques(x, umbral_db=-30.0, minimo=0.25):
    """Instantes donde el sonido supera el umbral tras un silencio."""
    ventana = int(SR * 0.01)
    n = len(x) // ventana
    if n == 0:
        return []
    env = np.sqrt(np.mean(x[:n * ventana].reshape(n, ventana) ** 2, axis=1))
    pico = env.max() or 1e-9
    activo = 20 * np.log10(np.maximum(env / pico, 1e-9)) > umbral_db
    salida, ultimo = [], -1e9
    for i in range(1, n):
        t = i * 0.01
        if activo[i] and not activo[i - 1] and t - ultimo >= minimo:
            salida.append(round(t, 2))
            ultimo = t
    return salida


def analizar(ruta):
    x = leer(ruta)
    dur = len(x) / SR
    print(f'{os.path.basename(ruta)} · {dur:.2f} s · pico {db(np.abs(x).max()):.1f} dBFS')
    print('Arranques (s):', ', '.join(f'{t:.2f}' for t in arranques(x)) or 'ninguno')
    paso = int(SR * 0.25)
    n = len(x) // paso
    if not n:
        return
    rms = np.sqrt(np.mean(x[:n * paso].reshape(n, paso) ** 2, axis=1))
    ref = rms.max() or 1e-9
    print('Volumen cada 0,25 s (0 dB = lo más fuerte):')
    for i, r in enumerate(rms):
        d = 20 * np.log10(max(r / ref, 1e-9))
        barra = '█' * max(0, int((d + 40) / 2))
        print(f'  {i * 0.25:7.2f}  {d:6.1f}  {barra}')


def fundidos(x, entrada, salida):
    x = x.copy()
    a, b = int(SR * entrada), int(SR * salida)
    if a:
        x[:a] *= np.linspace(0, 1, a, dtype=np.float32)
    if b:
        x[-b:] *= np.linspace(1, 0, b, dtype=np.float32)
    return x


def a_pico(x, pico_db):
    p = np.abs(x).max()
    return x if p == 0 else x * (10 ** (pico_db / 20) / p)


def a_rms(x, rms_db):
    r = np.sqrt(np.mean(x ** 2))
    return x if r == 0 else x * (10 ** (rms_db / 20) / r)


def resolver_inicio(e, ruta):
    """«inicio» admite segundos o "arranque:N" (el N-ésimo arranque, desde 1)."""
    ini = e.get('inicio', 0)
    if isinstance(ini, str) and ini.startswith('arranque:'):
        n = int(ini.split(':')[1])
        lista = arranques(leer(ruta), e.get('umbral_db', -30.0))
        if len(lista) < n:
            sys.exit(f'{e["nombre"]}: solo hay {len(lista)} arranques en {ruta}')
        return max(0.0, lista[n - 1] - 0.02)
    return float(ini)


def mp3(x, ruta, kbps):
    tmp = ruta + '.f32'
    x.astype(np.float32).tofile(tmp)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1',
                    '-i', tmp, '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', ruta], check=True)
    os.remove(tmp)


def construir():
    with open(os.path.join(AUDIO, 'fuentes.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    kbps = cfg.get('kbps', 64)
    partes, mapa, t = [], {}, 0.0
    silencio = lambda s: np.zeros(int(SR * s), dtype=np.float32)

    for e in cfg['efectos']:
        ruta = os.path.join(AUDIO, e['archivo'])
        if not os.path.exists(ruta):
            print(f'  · {e["nombre"]}: falta {e["archivo"]} → sonará el sintetizado')
            continue
        ini = resolver_inicio(e, ruta)
        x = leer(ruta, ini, e['duracion'])
        x = fundidos(x, e.get('fundido_entrada', 0.003), e.get('fundido_salida', 0.05))
        x = a_pico(x, e.get('pico_db', -3.0))
        partes += [silencio(PREVIO), x, silencio(HUECO)]
        mapa[e['nombre']] = {'inicio': round(t, 4), 'duracion': round(PREVIO + len(x) / SR, 4)}
        print(f'  ✓ {e["nombre"]:<13} {e["archivo"]} desde {ini:.2f} s, {len(x) / SR:.2f} s')
        t += PREVIO + len(x) / SR + HUECO

    salida = {'version': cfg.get('version', 1), 'efectos': mapa}
    if partes:
        mp3(np.concatenate(partes), os.path.join(AUDIO, 'efectos.mp3'), kbps)

    g = cfg.get('grada')
    if g and os.path.exists(os.path.join(AUDIO, g['archivo'])):
        cruce, dur = g.get('cruce', 1.5), g['duracion']
        x = leer(os.path.join(AUDIO, g['archivo']), float(g['inicio']), dur + cruce)
        dur_n, cr_n = int(SR * dur), int(SR * cruce)
        x = x[:dur_n + cr_n]
        # bucle sin salto: el final se funde con el principio (potencia constante)
        f = np.linspace(0, np.pi / 2, cr_n, dtype=np.float32)
        bucle = x[:dur_n].copy()
        bucle[:cr_n] = x[:cr_n] * np.sin(f) + x[dur_n:dur_n + cr_n] * np.cos(f)
        bucle = a_rms(bucle, g.get('rms_db', -24.0))
        # margen continuo antes y después: el navegador recorre [bucle] con
        # loopStart/loopEnd y el retardo del MP3 cae en el margen
        m = int(SR * 0.2)
        archivo = np.concatenate([bucle[-m:], bucle, bucle[:m]])
        mp3(archivo, os.path.join(AUDIO, 'grada.mp3'), kbps)
        salida['grada'] = {'bucle': [0.2, round(0.2 + dur, 4)]}
        print(f'  ✓ grada         {g["archivo"]} desde {g["inicio"]} s, bucle de {dur:.1f} s')
    elif g:
        print(f'  · grada: falta {g["archivo"]} → sonará la sintetizada')

    with open(os.path.join(AUDIO, 'efectos.json'), 'w', encoding='utf-8') as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)
    for nombre in ('efectos.mp3', 'grada.mp3', 'efectos.json'):
        ruta = os.path.join(AUDIO, nombre)
        if os.path.exists(ruta):
            print(f'  → {nombre}: {os.path.getsize(ruta) / 1024:.0f} KB')


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'analizar':
        for r in sys.argv[2:]:
            analizar(r)
            print()
    elif len(sys.argv) == 2 and sys.argv[1] == 'construir':
        construir()
    else:
        print(__doc__)
