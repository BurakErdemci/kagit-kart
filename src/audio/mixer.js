// Buses: music (with its reverb) → duck filter → music volume; sfx and engines → sfx volume;
// everything → master (mute) → glue compressor → peak limiter → destination.

// Mixes are authored to about −19 dBFS RMS per bus at volume 1; the makeup brings the sum up to game level.
const MAKEUP = 1.25;

// opts.bare skips the dynamics so offline level checks see the raw mix.
export function createMixer(ctx, bank, opts = {}) {
  const node = (g = 1) => { const n = ctx.createGain(); n.gain.value = g; return n; };

  const master = node(1);
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.005; glue.release.value = 0.2;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  if (opts.bare) master.connect(ctx.destination);
  else { master.connect(glue); glue.connect(limiter); limiter.connect(ctx.destination); }

  const musicIn = node(1);
  const reverbIn = node(1);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = bank.impulse;
  const reverbOut = node(0.55);
  const duckFilter = ctx.createBiquadFilter();
  duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
  const duck = node(1);
  const musicVol = node(0.49);
  musicIn.connect(duckFilter);
  reverbIn.connect(conv); conv.connect(reverbOut); reverbOut.connect(duckFilter);
  duckFilter.connect(duck); duck.connect(musicVol); musicVol.connect(master);

  const sfxVol = node(0.81);
  const sfxIn = node(0.85);
  const uiIn = node(0.8);
  const engineIn = node(0.42);
  sfxIn.connect(sfxVol); uiIn.connect(sfxVol); engineIn.connect(sfxVol);
  sfxVol.connect(master);

  let analyser = null;

  return {
    musicIn, reverbIn, sfxIn, uiIn, engineIn, master,
    // Perceptual taper: volume² (0.7 → −6 dB, 0.9 → −1.8 dB).
    setVolumes(music, sfx, muted) {
      const t = ctx.currentTime;
      musicVol.gain.setTargetAtTime(music * music, t, 0.05);
      sfxVol.gain.setTargetAtTime(sfx * sfx, t, 0.05);
      master.gain.setTargetAtTime(muted ? 0 : MAKEUP, t, 0.04);
    },
    duck(on) {
      const t = ctx.currentTime;
      duck.gain.setTargetAtTime(on ? 0.28 : 1, t, 0.12);
      duckFilter.frequency.setTargetAtTime(on ? 650 : 20000, t, on ? 0.1 : 0.25);
    },
    analyser() {
      if (!analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        limiter.connect(analyser);
      }
      return analyser;
    },
  };
}
