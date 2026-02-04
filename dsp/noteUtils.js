/* =====================================================
   Converte frequência (Hz) → nota musical (ex: C6)
   Retorna 'PAUSA' se a frequência for inválida ou instável
===================================================== */
export function frequencyToNote(freq) {

  // Frequência inválida ou silêncio
  if (!freq || freq < 20) return 'PAUSA';

  /* -----------------------------------------------
     Nomes das notas na escala temperada
     Índice 0 = C, 1 = C#, ..., 11 = B
  ----------------------------------------------- */
  const noteNames = [
    'C', 'C#', 'D', 'D#', 'E', 'F',
    'F#', 'G', 'G#', 'A', 'A#', 'B'
  ];

  /* -----------------------------------------------
     Conversão frequência → MIDI (valor contínuo)
     Ex: 440 Hz → 69
  ----------------------------------------------- */
  const midiFloat = 69 + 12 * Math.log2(freq / 440);

  /* -----------------------------------------------
     Arredondamento para nota mais próxima
  ----------------------------------------------- */
  const midi = Math.round(midiFloat);

  /* -----------------------------------------------
     Cálculo do desvio em cents
     Se for grande demais → nota instável
  ----------------------------------------------- */
  const cents = (midiFloat - midi) * 100;

  // zona morta (anti-piscada)
  if (Math.abs(cents) > 25) return 'PAUSA';

  /* -----------------------------------------------
     Nome da nota e oitava
  ----------------------------------------------- */
  const note = noteNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;

  return `${note}${octave}`;
}
