import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());

const upload = multer({ dest: 'uploads/' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================
// Utils
// ========================
function frequencyToNoteCStyle(freq) {
  if (!freq || freq <= 0 || isNaN(freq)) return 'PAUSA';
  const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const n = 12 * Math.log2(freq / 440);
  const q = Math.floor(Math.round(n + 9) / 12);
  const r = Math.round(n + 9) % 12;
  return `${NOTES[r]}${4 + q}`;
}

function hannWindowingRemoveDC(int16Array) {
  const N = int16Array.length;
  const out = new Float32Array(N);
  let mean = int16Array.reduce((a,b)=>a+b,0)/N;
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos((2*Math.PI*i)/(N-1)));
    out[i] = (int16Array[i] - mean) * w;
  }
  return out;
}

function magnitudeAtFrequencies(signal, sampleRate, fStart, fEnd, stepHz) {
  const N = signal.length;
  const freqs = [];
  const mags = [];
  for (let f = fStart; f <= fEnd; f += stepHz) {
    const w = 2*Math.PI*f/sampleRate;
    let cosPrev=1, sinPrev=0, real=0, imag=0;
    const cosStep = Math.cos(w), sinStep=Math.sin(w);
    for (let n=0;n<N;n++){
      const x = signal[n];
      real += x*cosPrev;
      imag -= x*sinPrev;
      const cosNew = cosPrev*cosStep - sinPrev*sinStep;
      const sinNew = sinPrev*cosStep + cosPrev*sinStep;
      cosPrev=cosNew; sinPrev=sinNew;
    }
    freqs.push(f);
    mags.push(Math.hypot(real, imag));
  }
  return { freqs, mags };
}

function hps(mags,harmonics=3){
  const L = mags.length;
  const out = new Float32Array(L);
  for(let i=0;i<L;i++){
    let prod = mags[i];
    for(let h=2;h<=harmonics;h++){
      const j=Math.floor(i*h);
      if(j>=L) break;
      prod*=mags[j];
    }
    out[i]=prod;
  }
  return out;
}

function refineParabolic(arr, idx, stepHz){
  const y1=arr[idx-1]??arr[idx];
  const y2=arr[idx];
  const y3=arr[idx+1]??arr[idx];
  const denom=(y1-2*y2+y3);
  if(!isFinite(denom)||Math.abs(denom)<1e-12) return idx*stepHz;
  const delta=0.5*(y1-y3)/denom;
  return (idx+delta)*stepHz;
}

// ========================
// Rota
// ========================
app.post('/upload', upload.single('audio'), async (req,res)=>{
  try{
    const inputPath = req.file.path;
    const outputPath = `${inputPath}.wav`;

    execSync(`ffmpeg -y -i "${inputPath}" -ar 44100 -ac 1 "${outputPath}"`);

    const buffer = fs.readFileSync(outputPath);
    const headerSize = 44;
    const sampleRate = 44100;
    const int16Samples = [];
    for(let i=headerSize;i+1<buffer.length;i+=2){
      int16Samples.push(buffer.readInt16LE(i));
    }

    const N = Math.min(int16Samples.length,sampleRate); // 1 s
    if(N<2048){
      fs.unlinkSync(inputPath); fs.unlinkSync(outputPath);
      return res.json({ dominantFrequency:0, dominantNote:'PAUSA', magnitude:0 });
    }

    const x = hannWindowingRemoveDC(int16Samples.slice(0,N));

    // Parâmetros
    const fMin = 240; // C4
    const fMax = 1200; // D6
    const stepHz = 0.5; // resolução mais fina

    const { freqs, mags } = magnitudeAtFrequencies(x, sampleRate, fMin, fMax, stepHz);
    const hpsArr = hps(mags,3);

    // Pico
    let peakIdx=0, peakVal=-Infinity;
    for(let i=0;i<hpsArr.length;i++){
      if(hpsArr[i]>peakVal){
        peakVal=hpsArr[i];
        peakIdx=i;
      }
    }

    const fGrid = freqs[peakIdx];
    let fRefined = refineParabolic(mags, peakIdx, stepHz);
    fRefined = Math.max(fMin, Math.min(fMax,fRefined));

    // Anti-oitava
    const halfF = fRefined/2;
    if(halfF>=fMin){
      const halfIdx=Math.round((halfF-fMin)/stepHz);
      const safeIdx = Math.max(0,Math.min(mags.length-1,halfIdx));
      const ratio = mags[peakIdx]/(mags[safeIdx]+1e-9);
      if(ratio<1.25) fRefined=halfF;
    }

    // Limiar relativo
    const maxMag = Math.max(...mags);
    const limiarRel = 0.12*maxMag;
    let note;
    if(mags[peakIdx]<limiarRel || !isFinite(fRefined)){
      note='PAUSA';
      fRefined=fGrid; 
    }else{
      note=frequencyToNoteCStyle(fRefined);
    }

    // Intensidade
    const rms=Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);
    let dB = 20*Math.log10(rms/32768);
    if(!isFinite(dB)) dB=-100;
    const minDb=-60, maxDb=-5;
    let intensity = (dB-minDb)/(maxDb-minDb);
    intensity=Math.max(0,Math.min(1,intensity));

    console.log('============================');
    console.log(`grid candidate: ${fGrid.toFixed(1)} Hz`);
    console.log(`refined frequency: ${fRefined.toFixed(2)} Hz`);
    console.log(`dominantNote: ${note}`);
    console.log(`RMS dB: ${dB.toFixed(2)} dB`);
    console.log(`intensity (0~1): ${intensity.toFixed(2)}`);
    console.log('============================');

    res.json({
      dominantFrequency: fRefined,
      dominantNote: note,
      magnitude: intensity
    });

    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);
  }catch(err){
    console.error('Erro:',err);
    res.status(500).json({ error:'Erro na análise do áudio.' });
  }
});

const PORT = process.env.PORT||3000;
app.listen(PORT,()=>console.log(`Servidor rodando na porta ${PORT}`));
