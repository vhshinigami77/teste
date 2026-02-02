const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function frequencyToNote(freq) {
  if (!freq || freq <= 0) return 'PAUSA';

  const A4 = 440;
  const midi = Math.round(12 * Math.log2(freq / A4) + 69);

  const note = NOTES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;

  // 🎯 flauta doce soprano → foco em 5ª e 6ª oitavas
  if (octave < 5 || octave > 6) return 'PAUSA';

  return `${note}${octave}`;
}
