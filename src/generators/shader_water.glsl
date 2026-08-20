precision mediump float;

uniform float u_time;
varying vec2 vUv;

// 1. A standard pseudo-random number generator
float random(in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// 2. Value Noise: Smooths out the randomness into a blurry cloud shape
float noise(in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    // Get random values for the four corners of a tile
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));

    // Smooth cubic interpolation
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) +
           (c - a) * u.y * (1.0 - u.x) +
           (d - b) * u.x * u.y;
}

// 3. Fractional Brownian Motion (fBm): Layers multiple passes of noise
// to create complex, fractal-like details (like continents or ocean depths)
float fbm(in vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    
    // Loop 4 times (octaves) to add smaller and smaller details
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(st);
        st *= 2.0;       // Double the frequency (zoom out)
        amplitude *= 0.5; // Halve the influence
    }
    return value;
}

void main() {
    // Zoom out the coordinates so we cover a massive area
    vec2 st = vUv * 4.0; 
    
    // Time must move very slowly. At 1km/px, visible fast movement 
    // would mean water moving at thousands of kilometers per hour!
    float slowTime = u_time * 0.05;

    // 4. Domain Warping: We generate noise, and use it to offset the coordinates 
    // of our *second* noise pass. This creates swirling, fluid-like currents.
    vec2 flow = vec2(
        fbm(st + vec2(slowTime, 0.0)),
        fbm(st + vec2(0.0, slowTime))
    );
    
    // Get the final ocean depth topography map
    float depth = fbm(st + flow * 2.0);

    // 5. Colors: Map the depth values to ocean colors
    vec3 deepOcean = vec3(0.02, 0.05, 0.15);   // Dark, almost black-blue navy
    vec3 shallowOcean = vec3(0.05, 0.35, 0.45); // Lighter teal/cyan for shallow shelves

    // Mix the colors based on the depth map
    vec3 waterColor = mix(deepOcean, shallowOcean, smoothstep(0.1, 0.8, depth));
    
    // Optional: Add a very subtle lighter highlight where currents push together
    vec3 currentHighlight = vec3(0.1, 0.45, 0.55);
    waterColor = mix(waterColor, currentHighlight, smoothstep(0.7, 1.0, depth) * 0.3);

    gl_FragColor = vec4(waterColor, 1.0);
}
