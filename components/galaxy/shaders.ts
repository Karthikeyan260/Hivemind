// GLSL for the galaxy. Kept separate so scene.ts stays readable.

export const NOISE = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 17.1; a *= 0.5; } return v; }
`;

/** Deep-space sky: layered nebula clouds, dust lanes and a faint galactic band. */
export const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const SKY_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vDir;
  ${NOISE}
  void main() {
    vec3 d = normalize(vDir);
    float t = uTime * 0.006;
    float n1 = fbm(d * 2.2 + vec3(t, 0.0, -t));
    float n2 = fbm(d * 4.5 - vec3(0.0, t * 1.3, 0.0) + n1);
    float dust = smoothstep(0.45, 0.75, fbm(d * 7.0 + n2 * 0.6));
    float band = exp(-pow(d.y * 3.2 + (n1 - 0.5) * 0.9, 2.0));
    vec3 base = vec3(0.028, 0.038, 0.058);
    vec3 teal = vec3(0.05, 0.17, 0.23) * smoothstep(0.4, 0.88, n2) * 0.7;
    vec3 amber = vec3(0.34, 0.18, 0.06) * smoothstep(0.55, 0.95, n1) * (0.4 + band * 0.8);
    vec3 violet = vec3(0.16, 0.09, 0.26) * smoothstep(0.5, 0.9, fbm(d * 3.1 + 5.0)) * 0.8;
    vec3 col = base + (teal + amber + violet) * (1.0 - dust * 0.65) + band * vec3(0.05, 0.055, 0.07);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Plasma reactor: churning noise, hot white center, cool fresnel rim. */
export const PLASMA_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vP = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
export const PLASMA_FRAG = /* glsl */ `
  uniform float uTime; uniform float uEnergy;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  ${NOISE}
  void main() {
    float speed = 0.35 + uEnergy * 1.6;
    float n = fbm(vP * 0.9 + vec3(0.0, uTime * speed, uTime * speed * 0.6));
    float n2 = fbm(vP * 2.1 - vec3(uTime * speed * 0.8) + n * 2.0);
    float fres = pow(1.0 - max(dot(vN, vV), 0.0), 2.2);
    vec3 hot = vec3(1.0, 0.96, 0.85);
    vec3 amber = vec3(1.0, 0.62, 0.22);
    vec3 col = mix(amber, hot, smoothstep(0.35, 0.8, n2));
    col += vec3(0.55, 0.85, 1.0) * fres * (0.6 + uEnergy * 0.8);
    gl_FragColor = vec4(col * (1.5 + uEnergy * 0.6), 1.0);
  }
`;

/** Fresnel halo shell (atmospheres, reactor corona). */
export const HALO_VERT = PLASMA_VERT;
export const HALO_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uPower; uniform float uIntensity;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), uPower);
    gl_FragColor = vec4(uColor * f * uIntensity, f);
  }
`;

/** Project planets: banded surface, lit by the core (day/night side) with city-light speckle on the night side. */
export const PLANET_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vWorld;
  void main() {
    vP = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mv = viewMatrix * w;
    vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
export const PLANET_FRAG = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB; uniform float uSeed; uniform float uTime; uniform float uLit;
  varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vWorld;
  ${NOISE}
  void main() {
    vec3 p = normalize(vP);
    float bands = fbm(vec3(p.y * 6.0 + uSeed, p.x * 1.5 + uTime * 0.02, p.z * 1.5));
    vec3 surf = mix(uA, uB, smoothstep(0.3, 0.75, bands));
    vec3 L = normalize(-vWorld);
    float day = max(dot(vN, L), 0.0);
    float night = smoothstep(0.15, -0.2, dot(vN, L));
    float cities = step(0.78, noise(p * 40.0 + uSeed)) * night;
    float rim = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
    vec3 col = surf * (0.06 + day * 1.25) + vec3(1.0, 0.75, 0.4) * cities * 0.9 + uB * rim * 0.6;
    col *= 1.0 + uLit * 1.2;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Point stars (knowledge nodes): per-point size, tint, twinkle and lock-on glow. */
export const STAR_VERT = /* glsl */ `
  attribute float size; attribute float lit; attribute vec3 tint;
  uniform float uTime; uniform float uPixel;
  varying vec3 vColor; varying float vLit; varying float vTw;
  void main() {
    vColor = tint; vLit = lit;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.82 + 0.18 * sin(uTime * 2.1 + position.x * 0.37 + position.y * 0.21);
    vTw = tw;
    gl_PointSize = size * uPixel * (320.0 / -mv.z) * (1.0 + lit * 1.8) * tw;
    gl_Position = projectionMatrix * mv;
  }
`;
export const STAR_FRAG = /* glsl */ `
  uniform sampler2D uTex; uniform float uDim; uniform vec3 uLitColor;
  varying vec3 vColor; varying float vLit; varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float core = texture2D(uTex, gl_PointCoord).a;
    float spikes = max(0.0, 1.0 - abs(c.x) * 28.0) * max(0.0, 1.0 - abs(c.y) * 2.2) + max(0.0, 1.0 - abs(c.y) * 28.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
    vec3 col = mix(vColor, uLitColor, vLit);
    float a = (core + spikes * (0.25 + vLit * 0.6)) * mix(uDim, 1.0, vLit) * vTw;
    gl_FragColor = vec4(col * (1.0 + vLit * 1.8), a);
  }
`;

/** Energy lines: light pulses travelling from start (aT=0) to end (aT=1). */
export const FLOW_VERT = /* glsl */ `
  attribute float aT; varying float vT;
  void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const FLOW_FRAG = /* glsl */ `
  uniform float uTime; uniform vec3 uColor; uniform float uBase; uniform float uPulse; uniform float uSpeed; uniform float uDensity;
  varying float vT;
  void main() {
    float p = fract(vT * uDensity - uTime * uSpeed);
    float glow = exp(-pow((p - 0.5) * 9.0, 2.0));
    gl_FragColor = vec4(uColor, uBase + glow * uPulse);
  }
`;

/** Film pass: radial chromatic aberration, grain, vignette. */
export const CINEMA = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAberration: { value: 0.0016 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAberration;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      vec2 off = dir * d * uAberration * 6.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= smoothstep(0.95, 0.25, d * 1.05);
      col += (rand(vUv * 900.0 + fract(uTime) * 37.0) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
