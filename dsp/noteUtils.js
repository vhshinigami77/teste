const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function frequencyToNote(freq) {
  if (freq <= 0) return 'PAUSA';
  const A4 = 440;
  const n = Math.round(12 * Math.log2(freq / A4));
  const note = NOTES[(n + 9 + 120) % 12];
  const octave = 4 + Math.floor((n + 9) / 12);
  return `${note}${octave}`;
}
