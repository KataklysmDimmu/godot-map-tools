// shader_vegetation.glsl
//
// Procedural overland vegetation + detail. Adds meaningful terrain detail to a
// generated landmass: trees (forests), rocky scrub, and snow clumps, all driven
// by the SAME elevation field the rest of the tool uses (vElev in 0..1, with
// u_waterLevel as the shoreline). The canopy is pure procedural noise per-fragment
// so tree density is resolution-INDEPENDENT: a given patch of land shows the same
// number of trees at any map size (just like the heightmap FBM).
//
// Conventions mirror shader_water.glsl exactly:
//   * GLSL ES 100 (WebGL1 / THREE.ShaderMaterial style) -> gl_FragColor + varying
//   * self-contained `random`/`noise`/`fbm`/`hash2` helpers (no external textures)
//   * THREE.ShaderMaterial injects `precision`, `uv`, `position`, `normal`,
//     `projectionMatrix`, `modelViewMatrix`, so the host supplies the vertex stage.
//
// This shader is rendered as an OVERLAY that SHARES the terrain geometry: the host
// provides a vertex stage that (a) lifts vElev = position.y / u_heightScale and
// (b) forwards the real surface normal as vNormal, so trees sit on hills and pick
// up slope shading. gl_FragColor.a is 0.0 on water and where no canopy grows,
// letting the terrain (and, at the seam, the animated water plane) show through.
precision mediump float;

// ---- Uniforms the host (WebUI / Godot) must supply ----
uniform float u_waterLevel;    // elevation threshold for land vs water
uniform float u_seed;          // scatters the canopy per-world (deterministic)
uniform float u_vegDensity;    // 0 = barren, 1 = lush (UI "Vegetation" slider)
uniform float u_aspect;        // width / height, keeps tree spacing round not stretched

varying vec2 vUv;
varying float vElev;           // elevation lifted out of vertex.y by the host
varying vec3 vNormal;          // real surface normal (for fake top-lighting)

// 1. Pseudo-random number generator (identical to shader_water.glsl)
float random(in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// 2. Value noise -> smooth blurry cloud
float noise(in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) +
           (c - a) * u.y * (1.0 - u.x) +
           (d - b) * u.x * u.y;
}

// 3. fBm (same 4-octave layering as the water shader, with the per-octave
//    rotation that kills axis-aligned banding).
float fbm(in vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(st);
        st = rot * st * 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// Hash for per-cell jitter (so each "tree block" gets its own offset).
vec2 hash2(vec2 p) {
    return vec2(
        random(p),
        random(p + vec2(37.13, 11.71))
    );
}

// A single soft round blob centered at uv `c` with radius `r` (aspect-corrected).
float blob(vec2 uv, vec2 c, float r) {
    vec2 d = (uv - c) * vec2(u_aspect, 1.0);
    float dist = length(d);
    return smoothstep(r, r * 0.35, dist); // soft-edged disc, 1 at center
}

// Latitude-based polar ice factor (mirrors the 3D UI's iceFactor):
// 1.0 at the poles, 0.0 near the equator band.
float iceFactor(float v) {
    float poleDist = min(v, 1.0 - v);
    // smoothstep(0.28, 0.08, poleDist) reimplemented (edge0 > edge1 -> descending)
    float t = clamp((poleDist - 0.28) / (0.08 - 0.28), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

void main() {
    float elev = vElev;
    vec2 uv = vUv;

    // Reject water outright (transparent -> terrain/water plane shows through).
    if (elev < u_waterLevel) {
        gl_FragColor = vec4(0.0);
        return;
    }

    // Normalized land height 0..1 (beach = 0, peaks = 1), matching the UI biomes.
    float landH = (elev - u_waterLevel) / max(0.001, (1.0 - u_waterLevel));
    float ice = iceFactor(uv.y);
    float snowLine = 0.75 - ice * 0.35;

    // --- Biome masks (smooth so the patches blend at edges) ---
    float grass = smoothstep(0.04, 0.10, landH) * (1.0 - smoothstep(0.30, 0.38, landH));
    float highland = smoothstep(0.34, 0.42, landH) * (1.0 - smoothstep(snowLine - 0.05, snowLine + 0.02, landH));
    float snow = smoothstep(snowLine - 0.04, snowLine + 0.03, landH);

    // --- Canopy scatter (resolution independent) ---
    // Two layered grids give organic clusters rather than a rigid lattice.
    float cellScale = 26.0;                       // trees per map tile
    vec2 seedOff = vec2(u_seed * 13.37, u_seed * 7.91);

    float canopy = 0.0;
    for (int layer = 0; layer < 2; layer++) {
        vec2 g = uv * cellScale * (layer == 0 ? 1.0 : 1.9);
        g += seedOff + float(layer) * 4.3;
        vec2 cell = floor(g);
        vec2 fpos = fract(g) - 0.5;               // -0.5..0.5 within cell
        vec2 jit = hash2(cell + float(layer) * 19.0) - 0.5; // per-cell jitter
        // Tree only lives if the per-cell random passes the density gate.
        float present = step(1.0 - u_vegDensity * 0.85, hash2(cell + 3.1).x);
        float r = 0.20 + 0.10 * hash2(cell + 5.7).y; // varied crown size
        float b = blob(fpos, jit * 0.6, r);
        canopy = max(canopy, b * present);
    }

    // --- Rock speckle for the highland (no trees up there, just rubble) ---
    float rock = fbm(uv * 140.0 + seedOff) * highland;
    rock = step(0.55, rock) * 0.6;

    // --- Snow clumps on the high snow band ---
    float snowClump = fbm(uv * 60.0 + seedOff * 1.7) * snow;
    snowClump = smoothstep(0.45, 0.75, snowClump);

    // --- Compose the overlay color ---
    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // Grassland/forest canopy (deep green, lighter on top via vNormal.y).
    vec3 leafDark = vec3(0.10, 0.30, 0.08);
    vec3 leafLite = vec3(0.22, 0.52, 0.16);
    float topLight = clamp(0.45 + 0.55 * vNormal.y, 0.0, 1.0);
    vec3 leaf = mix(leafDark, leafLite, topLight);
    float canopyAlpha = canopy * grass;
    col = mix(col, leaf, canopyAlpha);
    alpha = max(alpha, canopyAlpha);

    // Highland rock
    col = mix(col, vec3(0.34, 0.30, 0.26), rock);
    alpha = max(alpha, rock);

    // Snow clumps (override, brightest)
    col = mix(col, vec3(0.92, 0.94, 0.98), snowClump);
    alpha = max(alpha, snowClump);

    // Beach stays clear (no vegetation on sand) -> alpha already 0 there.

    // Hard guard: nothing on water (re-checked) and clamp.
    alpha *= step(u_waterLevel, elev);
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(col, alpha);
}
