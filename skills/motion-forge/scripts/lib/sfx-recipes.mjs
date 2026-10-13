// Procedural SFX recipes (ffmpeg lavfi): generated locally, so there are no licensing questions. Shared by sfx.mjs and providers.
export const RECIPES = {
  whoosh: ["-f", "lavfi", "-i", "anoisesrc=d=0.7:c=pink:a=0.9:r=48000", "-af", "bandpass=f=900:w=1400,afade=t=in:d=0.45:curve=exp,afade=t=out:st=0.45:d=0.25,volume=0.9,pan=stereo|c0=c0|c1=c0"],
  hit: ["-f", "lavfi", "-i", "aevalsrc='0.9*sin(2*PI*(55+70*exp(-30*t))*t)*exp(-6*t)+0.25*(random(0)-0.5)*exp(-60*t)':d=0.8:s=48000", "-af", "lowpass=f=4000,pan=stereo|c0=c0|c1=c0"],
  tick: ["-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*2200*t)*exp(-90*t)':d=0.08:s=48000", "-af", "pan=stereo|c0=c0|c1=c0"],
  rise: ["-f", "lavfi", "-i", "aevalsrc='0.35*sin(2*PI*(180*t+260*t*t))*(t/1.2)':d=1.2:s=48000", "-af", "afade=t=out:st=1.1:d=0.1,pan=stereo|c0=c0|c1=c0"],
  swell: ["-f", "lavfi", "-i", "anoisesrc=d=1.6:c=brown:a=0.8:r=48000", "-af", "lowpass=f=600,afade=t=in:d=1.3:curve=qsin,afade=t=out:st=1.3:d=0.3,pan=stereo|c0=c0|c1=c0"],
};
