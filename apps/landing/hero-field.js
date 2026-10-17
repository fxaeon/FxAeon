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

    void main() {
      vec2 uv = gl_FragCoord.xy / resolution;
      float phase = time * 0.045;
      float center = 0.44 + 0.15 * sin((uv.x - 0.08) * 2.8 + phase * 0.55)
                          - 0.07 * cos(uv.x * 5.1 - phase * 0.3);
      float slope = 0.42 * cos((uv.x - 0.08) * 2.8 + phase * 0.55)
                    + 0.357 * sin(uv.x * 5.1 - phase * 0.3);
      float normal = sqrt(1.0 + slope * slope);
      float pixel = 1.25 / resolution.y;
      float lines = 0.0;
      for (int i = 0; i < 9; i++) {
        float offset = (float(i) - 4.0) * 0.028;
        float distanceToCurve = abs(uv.y - center - offset) / normal;
        float stroke = 1.0 - smoothstep(pixel * 0.35, pixel * 1.5, distanceToCurve);
        float emphasis = 1.0 - abs(float(i) - 4.0) * 0.13;
        lines = max(lines, stroke * emphasis);
      }
      float distanceToCenter = abs(uv.y - center);
      float light = exp(-pow(distanceToCenter / 0.13, 2.0)) * 0.035;
      float edge = smoothstep(0.02, 0.24, uv.x) * (1.0 - smoothstep(0.84, 1.0, uv.x))
                   * smoothstep(0.04, 0.2, uv.y) * (1.0 - smoothstep(0.8, 0.98, uv.y));
      float alpha = (light + lines * 0.24) * edge;
      vec3 blue = vec3(0.23, 0.49, 0.94);
      color = vec4(blue * alpha, alpha);
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
