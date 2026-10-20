/**
 * Grade preview: LightMap's real grade shader (packages/renderer/src/shaders/grade.frag.ts) run
 * on synthetic frames - a sky gradient, a star field, a Milky Way band, a Moon or Sun, a ridge
 * with depth - in headless Chromium, one PNG per scene, beside the input it was given. No Cesium
 * and no install beyond the root's playwright: for judging what the grade does to the sky (the
 * stars through the twilight, the planets, the Moon's glow, the setting Sun) by eye.
 *
 *   node --experimental-strip-types tools/grade-preview/run.mjs [scene]
 *
 * Writes tools/grade-preview/out/<scene>.png and <scene>-input.png. CHROMIUM_PATH picks a
 * browser binary; otherwise playwright's own.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { GRADE_FRAGMENT_SHADER } from '../../packages/renderer/src/shaders/grade.frag.ts';

const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
// Cesium's automatic uniforms and functions the grade uses, stubbed: a post-process stage gets
// them from the scene; here the page sets the projection and viewport itself.
const fs = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform mat4 czm_inverseProjection, czm_projection, czm_view, czm_inverseView;
uniform vec4 czm_viewport;
uniform float czm_pixelRatio;
uniform vec3 czm_sunDirectionEC, czm_lightDirectionEC, czm_lightColor;
float czm_readDepth(sampler2D t, vec2 uv) { return texture(t, uv).r; }
vec4 czm_windowToEyeCoordinates(vec2 xy, float d) { return vec4(0.0, 0.0, -20000.0, 1.0); }
out vec4 out_FragColor;
${GRADE_FRAGMENT_SHADER}`;
const W = 960;
const H = 540;
const FOVY = 50;

// Scenes: sun elevation, haze, clouds, star field, planets (yaw/elev deg, peak, sigma), moon.
const scenes = {
  'twilight-minus6': {
    sunEl: -6,
    night: 0.55,
    stars: true,
    starField: 1,
    planets: [
      [-12, 14, 1, 1.9],
      [-8, 18, 0.6, 1.2],
    ],
  },
  'twilight-minus10': {
    sunEl: -10,
    night: 0.8,
    stars: true,
    starField: 1,
    planets: [
      [-12, 14, 1, 1.9],
      [-8, 18, 0.6, 1.2],
      [15, 25, 0.3, 0.9],
    ],
  },
  'astro-night-milkyway': { sunEl: -25, night: 1, stars: true, starField: 1, milkyWay: true },
  'twilight-minus16-milkyway': {
    sunEl: -16,
    night: 0.89,
    stars: true,
    starField: 1,
    milkyWay: true,
  },
  'night-moon-clear': {
    sunEl: -25,
    night: 1,
    stars: true,
    starField: 1,
    moon: [10, 20, 1.0],
    haze: 0.1,
  },
  'night-moon-cirrus': {
    sunEl: -25,
    night: 1,
    stars: true,
    starField: 1,
    moon: [10, 20, 1.0],
    haze: 0.3,
    cloudHigh: 0.6,
  },
  'sunset-sun-1deg': { sunEl: 1, night: 0, sun: [0, 1], sunTint: [1, 0.5, 0.18] },
  'day-sun-30deg-untinted': { sunEl: 30, night: 0, sun: [0, 14], sunTint: [1, 1, 1] },
};

const page = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
const FS = ${JSON.stringify(fs)};
const W=${W},H=${H},FOVY=${FOVY};
window.renderScene = (sc) => {
  const deg = Math.PI/180;
  const f = 1/Math.tan(FOVY*deg/2), aspect = W/H, n = 1, fa = 1e7;
  const P = [f/aspect,0,0,0, 0,f,0,0, 0,0,(fa+n)/(n-fa),-1, 0,0,2*fa*n/(n-fa),0];
  const Pi = invert(P);
  const dir = (yaw, el) => [Math.sin(yaw*deg)*Math.cos(el*deg), Math.sin(el*deg), -Math.cos(yaw*deg)*Math.cos(el*deg)];
  const toUv = (d) => [ (P[0]*d[0]/(-d[2]))*0.5+0.5, (P[5]*d[1]/(-d[2]))*0.5+0.5 ];
  // --- the synthetic frame Cesium would hand the grade ---
  const cv = document.createElement('canvas'); cv.width=W; cv.height=H;
  const g = cv.getContext('2d');
  const top = sc.night >= 1 ? [4,6,14] : sc.night > 0.5 ? [12,20,48] : sc.night > 0 ? [40,60,110] : sc.sunEl > 5 ? [70,120,200] : [90,110,170];
  const hor = sc.night >= 1 ? [12,14,24] : sc.night > 0.5 ? [60,60,90] : sc.night > 0 ? [170,120,110] : sc.sunEl > 5 ? [170,200,235] : [240,170,110];
  const gr = g.createLinearGradient(0,0,0,H/2);
  gr.addColorStop(0,'rgb('+top+')'); gr.addColorStop(1,'rgb('+hor+')');
  g.fillStyle=gr; g.fillRect(0,0,W,H/2+2);
  let seed = 7; const rnd = () => (seed = (seed*16807)%2147483647)/2147483647;
  if (sc.milkyWay) { g.save(); g.translate(W*0.35,H*0.25); g.rotate(-0.9); const mw=g.createLinearGradient(0,-60,0,60); mw.addColorStop(0,'rgba(200,190,170,0)'); mw.addColorStop(0.5,'rgba(200,190,170,0.13)'); mw.addColorStop(1,'rgba(200,190,170,0)'); g.fillStyle=mw; g.fillRect(-600,-60,1200,120); g.restore(); }
  if (sc.stars) for (let i=0;i<500;i++) {
    const x=Math.floor(rnd()*W)+0.5, y=Math.floor(rnd()*H*0.5)+0.5, b=Math.pow(rnd(),3), r=0.7+0.9*b;
    const rg=g.createRadialGradient(x,y,0,x,y,r*1.4); const a=0.35+0.65*b;
    rg.addColorStop(0,'rgba(255,255,255,'+a+')'); rg.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=rg; g.fillRect(x-r*2,y-r*2,r*4,r*4);
  }
  if (sc.moon) { const [u,v]=toUv(dir(sc.moon[0],sc.moon[1])); g.fillStyle='rgb(235,235,225)'; g.beginPath(); g.arc(u*W,(1-v)*H,9,0,7); g.fill(); }
  if (sc.sun) { const [u,v]=toUv(dir(sc.sun[0],sc.sun[1])); const x=u*W,y=(1-v)*H;
    const rg=g.createRadialGradient(x,y,0,x,y,40); rg.addColorStop(0,'rgba(255,255,240,1)'); rg.addColorStop(0.12,'rgba(255,255,230,1)'); rg.addColorStop(1,'rgba(255,250,220,0)');
    g.fillStyle=rg; g.fillRect(x-40,y-40,80,80); }
  // ground and a ridge on the right (depth < 1 there)
  g.fillStyle='rgb(30,34,28)'; g.beginPath(); g.moveTo(0,H/2+2); g.lineTo(W*0.6,H/2+2); g.lineTo(W*0.75,H/2-60); g.lineTo(W*0.9,H/2-25); g.lineTo(W,H/2-40); g.lineTo(W,H); g.lineTo(0,H); g.fill();
  const img = g.getImageData(0,0,W,H);
  const depth = new Float32Array(W*H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const i=(y*W+x)*4; const ground = img.data[i]===30 && img.data[i+1]===34 && img.data[i+2]===28;
    depth[(H-1-y)*W+x] = ground ? 0.5 : 1.0;
  }
  // --- WebGL2 pass ---
  const c = document.getElementById('c'); const gl = c.getContext('webgl2', {preserveDrawingBuffer:true});
  const vs = '#version 300 es\\nin vec2 p; out vec2 v_textureCoordinates; void main(){ v_textureCoordinates=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }';
  const prog = gl.createProgram();
  for (const [t,src] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,FS]]) { const s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); gl.attachShader(prog,s); }
  gl.linkProgram(prog); if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  const tex=(unit, setup)=>{ const t=gl.createTexture(); gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); setup(); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); };
  tex(0, ()=>{ gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,cv); });
  tex(1, ()=>{ gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false); gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,W,H,0,gl.RED,gl.FLOAT,depth); });
  const U=(n)=>gl.getUniformLocation(prog,n);
  gl.uniform1i(U('colorTexture'),0); gl.uniform1i(U('depthTexture'),1);
  gl.uniformMatrix4fv(U('czm_projection'),false,P); gl.uniformMatrix4fv(U('czm_inverseProjection'),false,Pi);
  gl.uniform4f(U('czm_viewport'),0,0,W,H); gl.uniform1f(U('czm_pixelRatio'),1);
  const sd = dir(sc.sun ? sc.sun[0] : 0, sc.sunEl);
  gl.uniform3f(U('czm_sunDirectionEC'),...sd); gl.uniform3f(U('u_sunDirEC'),...sd);
  gl.uniform3f(U('u_sunTint'),...(sc.sunTint ?? [1,1,1]));
  const f1=(n,v)=>gl.uniform1f(U(n),v);
  f1('u_saturation',1); f1('u_contrast',1); f1('u_warmth',0.5); gl.uniform3f(U('u_tint'),1,1,1);
  f1('u_haze',sc.haze ?? 0.1); f1('u_cloudCoverage',0); f1('u_cloudDensity',0.5); f1('u_cloudOpacity',0);
  f1('u_cloudLow',0); f1('u_cloudMid',0); f1('u_cloudHigh',sc.cloudHigh ?? 0);
  f1('u_skyLuminance',1); f1('u_nightFactor',sc.night); f1('u_precipitation',0); f1('u_horizonHaze',0.1);
  f1('u_sunElevation',sc.sunEl); f1('u_time',30); gl.uniform2f(U('u_sunScreen'),-1,-1); f1('u_sunVisible',0);
  gl.uniform3f(U('u_eyeUpEC'),0,1,0); f1('u_eyeHeightM',2); f1('u_starField',sc.starField ?? 0);
  for (let i=0;i<5;i++) { const p=(sc.planets??[])[i]; if(p){ const [u,v]=toUv(dir(p[0],p[1])); gl.uniform4f(U('u_planet'+i),u,v,p[2],p[3]); } else gl.uniform4f(U('u_planet'+i),-10,-10,0,1); }
  if (sc.moon) { gl.uniform3f(U('u_moonDirEC'),...dir(sc.moon[0],sc.moon[1])); f1('u_moonGlow',sc.moon[2]); f1('u_moonRadiusDeg', 9*0.0991); } else { f1('u_moonGlow',0); f1('u_moonRadiusDeg',0); }
  gl.viewport(0,0,W,H); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  return { err: gl.getError(), input: cv.toDataURL() };
};
function invert(m){ const inv=new Array(16); const a=m;
 inv[0]=a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
 inv[4]=-a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
 inv[8]=a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
 inv[12]=-a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
 inv[1]=-a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
 inv[5]=a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
 inv[9]=-a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
 inv[13]=a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
 inv[2]=a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
 inv[6]=-a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
 inv[10]=a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
 inv[14]=-a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
 inv[3]=-a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
 inv[7]=a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
 inv[11]=-a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
 inv[15]=a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
 let det=a[0]*inv[0]+a[1]*inv[4]+a[2]*inv[8]+a[3]*inv[12]; det=1/det; return inv.map(v=>v*det); }
</script></body></html>`;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const p = await browser.newPage({ viewport: { width: W, height: H } });
p.on('console', (m) => console.log('console:', m.text()));
await p.setContent(page);
const only = process.argv[2];
for (const [name, sc] of Object.entries(scenes)) {
  if (only && name !== only) continue;
  const r = await p.evaluate((s) => window.renderScene(s), sc);
  await p.locator('#c').screenshot({ path: `${out}${name}.png` });
  const b64 = r.input.split(',')[1];
  writeFileSync(`${out}${name}-input.png`, Buffer.from(b64, 'base64'));
  console.log(name, 'gl error', r.err);
}
await browser.close();
