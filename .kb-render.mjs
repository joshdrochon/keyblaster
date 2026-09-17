import { chromium } from '@playwright/test';
const page = await (await (await chromium.launch()).newContext()).newPage();
await page.goto('http://localhost:5183/');
const out = await page.evaluate(async () => {
  function seededRandom(seed){let a=Math.floor(seed)>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  const clamp=(v,mn,mx)=>Math.min(mx,Math.max(mn,v));
  const SR=48000, SECS=13;
  async function render(withDrone){
  const ctx = new OfflineAudioContext(1, SR*SECS, SR); const now=0;
  const spec={droneHz:55,partials:[1,1.5,2,2.75],filterHz:620,windLevel:0.42,windFilterHz:480,level:0.48};
  const gain=ctx.createGain(); gain.gain.value=spec.level; gain.connect(ctx.destination);
  const filter=ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.setValueAtTime(spec.filterHz,now); filter.connect(gain);
  if(withDrone) for(const r of spec.partials){const o=ctx.createOscillator();o.type='sine';o.frequency.setValueAtTime(spec.droneHz*r,now);o.detune.setValueAtTime((r%2)*7-3,now);const p=ctx.createGain();p.gain.value=1/(spec.partials.length*r);o.connect(p);p.connect(filter);o.start(now);}
  const len=Math.floor(SR*4); const buf=ctx.createBuffer(1,len,SR); const d=buf.getChannelData(0);
  const rng=seededRandom(0x2b7c19); let last=0;
  for(let i=0;i<len;i++){const w=rng()*2-1; last=clamp((last+0.02*w)/1.02,-1,1); d[i]=last*3.5;}
  const wind=ctx.createBufferSource(); wind.buffer=buf; wind.loop=true;
  const wf=ctx.createBiquadFilter(); wf.type='lowpass'; wf.frequency.setValueAtTime(spec.windFilterHz,now);
  const wg=ctx.createGain(); wg.gain.value=spec.windLevel;
  wind.connect(wf); wf.connect(wg); wg.connect(gain); wind.start(now);
  return (await ctx.startRendering()).getChannelData(0);
  }
  function analyse(x){
    const n=x.length; const acc=new Float64Array(n);
    for(let i=2;i<n;i++) acc[i]=Math.abs(x[i]-2*x[i-1]+x[i-2]);
    const win=(t0,t1)=>{let m=0,at=0;for(let i=Math.floor(t0*SR);i<Math.floor(t1*SR)&&i<n;i++)if(acc[i]>m){m=acc[i];at=i/SR;}return{peak:+m.toExponential(3),at:+at.toFixed(5)};};
    // global excluding +-10ms around each multiple of 4
    let bg=0,bgAt=0; const near=(i)=>{const t=i/SR; const k=Math.round(t/4); return k>0 && Math.abs(t-k*4)<0.02;};
    for(let i=Math.floor(0.5*SR);i<n;i++) if(!near(i)&&acc[i]>bg){bg=acc[i];bgAt=i/SR;}
    return {seam4:win(3.99,4.01), seam8:win(7.99,8.01), seam12:win(11.99,12.01), backgroundPeak:{peak:+bg.toExponential(3),at:+bgAt.toFixed(5)}};
  }
  const windOnly=analyse(await render(false));
  const full=analyse(await render(true));
  return {windOnly, full};
});
console.log(JSON.stringify(out,null,2));
process.exit(0);
