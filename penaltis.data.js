/* ==========================================================
   POC Tanda de penaltis — datos de demostración
   ----------------------------------------------------------
   Contrato de una tanda (lo que publicaría la redacción):

   {
     fecha: 'YYYY-MM-DD',
     numero: 12,                 // número de tanda, para compartir
     preguntas: [                // exactamente 5
       {
         pregunta: '…',
         opciones: ['A', 'B', 'C', 'D'],   // exactamente 4, en orden
         correcta: 0,            // índice 0-3 → esquina A, B, C o D
         dato: '…'               // explicación breve tras el tiro
       }
     ]
   }

   Opcional (V3, escena 3D): equipaciones del lanzador y del
   portero. Si falta, la escena usa las suyas por defecto. V1 y V2
   ignoran este campo.

     equipaciones: {
       lanzador: { camiseta, detalle, pantalon, medias, botas, dorsal, colorDorsal,
                   patron: 'rayas', rayas: [colorA, colorB], mangas },  // patron opcional
       portero:  { camiseta, detalle, pantalon, medias, botas, dorsal, colorDorsal, guantes }
     }

   Esquinas: A arriba izquierda, B arriba derecha,
             C abajo izquierda,  D abajo derecha.
   La redacción reparte las correctas entre las cuatro esquinas
   para que no haya una esquina «buena».
========================================================== */
(function (global) {
  'use strict';

  global.pocPenaltisTandas = [
    {
      fecha: '2026-09-25',
      numero: 12,
      equipaciones: {
        lanzador: { patron: 'rayas', rayas: ['#a50044', '#004d98'], mangas: '#004d98', camiseta: '#a50044', detalle: '#004d98', pantalon: '#0a2a66', medias: '#0a2a66', dorsal: '9', colorDorsal: '#f7d117' },
        portero: { camiseta: '#f2c200', detalle: '#111111', pantalon: '#111111', medias: '#f2c200', dorsal: '1', colorDorsal: '#111111', guantes: '#ffffff' }
      },
      preguntas: [
        {
          pregunta: '¿Qué selección ganó el Mundial de 2010?',
          opciones: ['Países Bajos', 'Alemania', 'España', 'Uruguay'],
          correcta: 2,
          dato: 'España ganó 1-0 a Países Bajos en Johannesburgo con gol de Iniesta en la prórroga.'
        },
        {
          pregunta: '¿A cuántos metros de la línea de gol está el punto de penalti?',
          opciones: ['9,15 metros', '11 metros', '12 metros', '16,5 metros'],
          correcta: 1,
          dato: 'Son 11 metros (12 yardas). Los 9,15 son la distancia de la barrera y los 16,5, el borde del área.'
        },
        {
          pregunta: '¿Qué club tiene más Copas de Europa?',
          opciones: ['Real Madrid', 'AC Milan', 'Bayern de Múnich', 'Liverpool'],
          correcta: 0,
          dato: 'El Real Madrid suma quince, más del doble que el AC Milan, segundo con siete.'
        },
        {
          pregunta: '¿Cómo se llama el estadio del Athletic Club?',
          opciones: ['Anoeta', 'El Sadar', 'Ipurua', 'San Mamés'],
          correcta: 3,
          dato: 'El nuevo San Mamés se inauguró en 2013, junto al solar del antiguo, «La Catedral».'
        },
        {
          pregunta: '¿Qué portero paró dos penaltis en la tanda de cuartos de la Eurocopa 2008 ante Italia?',
          opciones: ['Víctor Valdés', 'Iker Casillas', 'Pepe Reina', 'Santiago Cañizares'],
          correcta: 1,
          dato: 'Casillas detuvo los lanzamientos de De Rossi y Di Natale, y Cesc marcó el último.'
        }
      ]
    },
    {
      fecha: '2026-09-24',
      numero: 11,
      equipaciones: {
        lanzador: { patron: 'rayas', rayas: ['#a50044', '#004d98'], mangas: '#004d98', camiseta: '#a50044', detalle: '#004d98', pantalon: '#0a2a66', medias: '#0a2a66', dorsal: '10', colorDorsal: '#f7d117' },
        portero: { camiseta: '#2ecc71', detalle: '#0b3d20', pantalon: '#0b3d20', medias: '#2ecc71', dorsal: '13', colorDorsal: '#0b3d20', guantes: '#f2c200' }
      },
      preguntas: [
        {
          pregunta: '¿Cuántos jugadores tiene cada equipo sobre el campo al empezar un partido?',
          opciones: ['9', '10', '11', '12'],
          correcta: 2,
          dato: 'Once por equipo, portero incluido. Por debajo de siete, el partido no puede seguir.'
        },
        {
          pregunta: '¿En qué país se jugó el primer Mundial, en 1930?',
          opciones: ['Uruguay', 'Italia', 'Brasil', 'Francia'],
          correcta: 0,
          dato: 'Uruguay organizó y ganó el primer Mundial, con victoria 4-2 sobre Argentina en la final.'
        },
        {
          pregunta: '¿Qué significa VAR?',
          opciones: ['Vídeo de Arbitraje Rápido', 'Vista Asistida en Repetición', 'Validación Arbitral Remota', 'Video Assistant Referee'],
          correcta: 3,
          dato: 'Video Assistant Referee: árbitro asistente de vídeo. Llegó a LaLiga en la temporada 2018-19.'
        },
        {
          pregunta: '¿Cuánto dura cada parte de la prórroga?',
          opciones: ['10 minutos', '15 minutos', '20 minutos', '30 minutos'],
          correcta: 1,
          dato: 'Dos partes de 15 minutos. Si sigue el empate, se decide en la tanda de penaltis.'
        },
        {
          pregunta: '¿Qué jugador tiene más Balones de Oro?',
          opciones: ['Cristiano Ronaldo', 'Michel Platini', 'Lionel Messi', 'Johan Cruyff'],
          correcta: 2,
          dato: 'Messi tiene ocho. Cristiano Ronaldo, cinco; Platini y Cruyff, tres cada uno.'
        }
      ]
    }
  ];
}(window));
