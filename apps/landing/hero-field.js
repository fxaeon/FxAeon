/*
 * FxAeon hero field. Original WebGL2 implementation for this page.
 * Visual reference: React Bits Aurora, https://reactbits.dev/backgrounds/aurora.
 * No React Bits source code or runtime is bundled here.
 */
(() => {
  const root = document.documentElement;
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  let started = false;
  let waitingForEnable = false;
  let preferenceObserver = null;
  const eligible = () => !motionPreference.matches && !connection?.saveData && root.dataset.motion !== "off";
  const stopWaiting = () => {
    preferenceObserver?.disconnect();
    preferenceObserver = null;
    motionPreference.removeEventListener("change", retryWhenEnabled);
    connection?.removeEventListener?.("change", retryWhenEnabled);
    waitingForEnable = false;
  };
  const retryWhenEnabled = () => {
    if (!eligible()) return;
    stopWaiting();
    init();
  };
  const init = () => {
  if (started) return;
  const canvas = document.querySelector(".hero-shader");
  const host = document.querySelector(".hero-field");
  if (!canvas || !host || !("IntersectionObserver" in window) || !("ResizeObserver" in window)) return;

  if (!eligible()) {
    if (!waitingForEnable) {
      waitingForEnable = true;
      preferenceObserver = new MutationObserver(retryWhenEnabled);
      preferenceObserver.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
      motionPreference.addEventListener("change", retryWhenEnabled);
      connection?.addEventListener?.("change", retryWhenEnabled);
    }
    return;
  }
  started = true;
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    premultipliedAlpha: true,
  });
  if (!gl) return;

  const vertexSource = `#version 300 es
    in vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }
  `;
  const fragmentSource = `#version 300 es
    precision highp float;
    uniform vec2 resolution;
    uniform float time;
    out vec4 color;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float field(vec2 p) {
      float v = 0.0;
      float a = 0.55;
      mat2 turn = mat2(0.82, 0.57, -0.57, 0.82);
      for (int i = 0; i < 4; i++) {
        v += noise(p) * a;
        p = turn * p * 1.94 + vec2(2.7, -1.8);
        a *= 0.48;
      }
      return v;
    }
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution;
      vec2 p = vec2((uv.x - 0.5) * resolution.x / resolution.y, uv.y);
      float t = time * 0.075;
      float terrain = field(p * 2.25 + vec2(t, -t * 0.42));
      float ridge = 0.36 + 0.055 * sin(p.x * 1.35 + t * 1.4)
                    + 0.115 * (terrain - 0.5);
      float distanceToRidge = abs(p.y - ridge);
      float veil = 1.0 - smoothstep(0.035, 0.48, distanceToRidge);
      float contours = abs(fract((terrain * 0.82 + p.y * 0.16) * 11.0) - 0.5);
      float line = 1.0 - smoothstep(0.405, 0.48, contours);
      float edge = smoothstep(0.0, 0.2, uv.y) * (1.0 - smoothstep(0.66, 0.98, uv.y));
      float alpha = veil * edge * (0.16 + line * 0.34);
      vec3 deep = vec3(0.10, 0.20, 0.38);
      vec3 blue = vec3(0.26, 0.46, 0.82);
      vec3 tint = mix(deep, blue, smoothstep(0.12, 0.44, terrain));
      color = vec4(tint * alpha, alpha);
    }
  `;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "position");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return;
  }

  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  if (!buffer || !vao) {
    if (buffer) gl.deleteBuffer(buffer);
    if (vao) gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return;
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const timeLocation = gl.getUniformLocation(program, "time");
  const resolutionLocation = gl.getUniformLocation(program, "resolution");
  let frameId = 0;
  let lastFrame = 0;
  let visible = false;
  let failed = false;
  let disposed = false;

  const shouldAnimate = () => !failed
    && visible
    && !document.hidden
    && !motionPreference.matches
    && document.documentElement.dataset.motion !== "off"
    && !connection?.saveData;
  const paint = (now) => {
    frameId = 0;
    if (!shouldAnimate()) return;
    if (now - lastFrame < 1000 / 30) {
      frameId = requestAnimationFrame(paint);
      return;
    }
    lastFrame = now;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform1f(timeLocation, now * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frameId = requestAnimationFrame(paint);
  };
  const wake = () => {
    if (shouldAnimate() && !frameId) frameId = requestAnimationFrame(paint);
    if (!shouldAnimate() && frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  };
  const resize = () => {
    const rect = host.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    wake();
  }, { rootMargin: "0px" });
  intersection.observe(host);
  const onVisibility = () => wake();
  const onMotion = () => wake();
  const settingsObserver = new MutationObserver(wake);
  settingsObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  const dispose = (contextLost = false) => {
    if (disposed) return;
    disposed = true;
    failed = true;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    resizeObserver.disconnect();
    intersection.disconnect();
    settingsObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    motionPreference.removeEventListener("change", onMotion);
    connection?.removeEventListener?.("change", onMotion);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    if (!contextLost) {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    canvas.hidden = true;
  };
  const onContextLost = (event) => {
    failed = true;
    dispose(true);
  };
  document.addEventListener("visibilitychange", onVisibility);
  motionPreference.addEventListener("change", onMotion);
  connection?.addEventListener?.("change", onMotion);
  canvas.addEventListener("webglcontextlost", onContextLost, { once: true });
  resize();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
