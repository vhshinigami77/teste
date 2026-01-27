export function frequencyToNote(freq) {
  if (!freq || freq < 20) return 'PAUSA';

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F',
                     'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const note = noteNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;

  return `${note}${octave}`;
}
