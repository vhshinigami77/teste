import { parentPort } from 'worker_threads';
import fftPkg from 'fft-js';
import { frequencyToNote } from './dsp/noteUtils.js';

const { fft, util } = fftPkg;

parentPort.on('message', ({ samples, sampleRate }) => {

  const N = 2048;
  if (samples.length < N) {
    parentPort.postMessage({ note:'PAUSA', frequency:0, intensity:0 });
    return;
  }

  const windowed = new Array(N);
  for (let i=0;i<N;i++) {
    const w = 0.5 - 0.5*Math.cos(2*Math.PI*i/(N-1));
    windowed[i] = samples[i]*w;
  }

  const mags = util.fftMag(fft(windowed));
  const freqRes = sampleRate / N;

  let bestI=0, bestScore=0;
  for (let i=1;i<mags.length/2;i++) {
    const f = i*freqRes;
    if (f<50 || f>1200) continue;
    let s = mags[i];
    if (mags[2*i]) s -= 0.6*mags[2*i];
    if (mags[3*i]) s -= 0.3*mags[3*i];
    if (s>bestScore) { bestScore=s; bestI=i; }
  }

  let freq = bestI*freqRes;
  if (bestI>0 && bestI<mags.length-1) {
    const a=mags[bestI-1], b=mags[bestI], c=mags[bestI+1];
    const p = 0.5*(a-c)/(a-2*b+c);
    freq = (bestI+p)*freqRes;
  }

  let sum=0;
  for (let i=0;i<N;i++) sum+=samples[i]*samples[i];
  const rms = Math.sqrt(sum/N);
  const dB = 20*Math.log10(rms/32768);
  const intensity = Math.max(0, Math.min(1,(dB+60)/55));

  parentPort.postMessage({
    frequency:Number(freq.toFixed(2)),
    note:frequencyToNote(freq),
    intensity:Number(intensity.toFixed(3))
  });
});
