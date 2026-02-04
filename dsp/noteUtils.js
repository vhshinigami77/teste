export function frequencyToNote(freq) {
  if (!freq || freq < 20) return 'PAUSA';

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F',
                     'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);

  // margem de segurança ±25 cents
  const cents = (midiFloat - midi) * 100;
  if (Math.abs(cents) > 25) return 'PAUSA';

  const note = noteNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;

  return `${note}${octave}`;
}
