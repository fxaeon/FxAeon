/* Original FxAeon mark sculpture, rendered locally without dependencies. */
(() => {
  const stage = document.querySelector('.capital-art');
  const canvas = stage?.querySelector('canvas');
  if (!canvas || navigator.connection?.saveData) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) return;

  const vertex = `
    precision mediump float;
    attribute vec3 position;
    attribute vec3 normal;
    uniform mat4 model;
    uniform mat4 projection;
    uniform float tone;
    uniform float peel;
    varying vec3 vPosition;
    varying vec3 vNormal;
    void main() {
      // A continuous bow and torsion make both broad faces carry the light.
      // The inverse-transpose Jacobian keeps the lighting on the curved surface.
      float x = position.x;
      float y = position.y - 0.55;
      float bend = mix(0.18, -0.12, tone);
      float twist = mix(0.26, -0.24, tone) + peel * 0.08;
      float slopeX = 2.0 * bend * x + twist * y;
      float slopeY = twist * x;
      vec3 curved = position + vec3(0.0, 0.0, bend*x*x + twist*x*y);
      vec3 curvedNormal = vec3(normal.x - slopeX*normal.z, normal.y - slopeY*normal.z, normal.z);
      vec4 world = model * vec4(curved, 1.0);
      vPosition = world.xyz;
      vNormal = mat3(model) * curvedNormal;
      gl_Position = projection * vec4(world.xyz - vec3(0.0, 0.0, 30.0), 1.0);
    }
  `;
  const fragment = `
    precision mediump float;
    uniform float tone;
    varying vec3 vPosition;
    varying vec3 vNormal;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 eye = normalize(vec3(0.0, 0.0, 30.0) - vPosition);
      vec3 reflection = reflect(-eye, n);
      vec3 key = normalize(vec3(-1.7, -1.0, 3.0));
      float diffuse = max(dot(n, key), 0.0);
      float fresnel = pow(1.0 - max(dot(n, eye), 0.0), 3.0);
      float softbox = pow(max(dot(reflection, normalize(vec3(-0.5, -1.2, 1.4))), 0.0), 6.0);
      float rim = pow(max(dot(reflection, normalize(vec3(2.8, 0.2, 0.8))), 0.0), 11.0);
      float lowerLight = pow(max(dot(reflection, normalize(vec3(-1.3, -2.5, 1.0))), 0.0), 16.0);
      vec3 cobalt = mix(vec3(0.22, 0.49, 0.86), vec3(0.035, 0.22, 0.79), tone);
      vec3 color = cobalt * (0.35 + diffuse * 0.80);
      color += vec3(0.16, 0.39, 0.98) * fresnel * 0.58;
      color += vec3(0.58, 0.76, 1.0) * softbox * 0.63;
      color += vec3(0.27, 0.51, 1.0) * rim * 0.72;
      color += vec3(0.10, 0.26, 0.78) * lowerLight * 0.4;
      color = pow(color, vec3(0.88));
      gl_FragColor = vec4(color, 1.0);
    }
  `;
  function shader(type, source) {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('Sculpture shader unavailable');
    return result;
  }
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  } catch { return; }
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 0);

  // The brand's paired ribbons become two continuous soft-edged bands.
  const contour = [[8, 26.5]];
  const line = (to, count = 12) => {
    const from = contour.at(-1);
    for (let index = 1; index <= count; index++) {
      const t = index / count;
      contour.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    }
  };
  const curve = (a, b, c, count = 18) => {
    const from = contour.at(-1);
    for (let index = 1; index <= count; index++) {
      const t = index / count, u = 1 - t;
      contour.push([u*u*u*from[0] + 3*u*u*t*a[0] + 3*u*t*t*b[0] + t*t*t*c[0], u*u*u*from[1] + 3*u*u*t*a[1] + 3*u*t*t*b[1] + t*t*t*c[1]]);
    }
  };
  curve([8, 15.7], [16.6, 7], [27.3, 7]);
  line([48, 7]);
  curve([51.6, 7], [53.6, 11.1], [51.4, 14], 10);
  line([40.7, 28.2]);
  curve([37.7, 31.9], [32.8, 34], [27.9, 34], 14);
  line([15.5, 34]);
  curve([11.36, 34], [8, 30.64], [8, 26.5], 14);
  contour.pop();
  const outline = contour.map(([x, y]) => [(x - 32) / 20, (32 - y) / 20]);
  const center = outline.reduce((sum, point) => [sum[0] + point[0] / outline.length, sum[1] + point[1] / outline.length], [0, 0]);
  const normals = outline.map((point, index) => {
    const previous = outline[(index + outline.length - 1) % outline.length];
    const next = outline[(index + 1) % outline.length];
    const tangent = [next[0] - previous[0], next[1] - previous[1]];
    const length = Math.hypot(...tangent);
    return [-tangent[1] / length, tangent[0] / length];
  });
  const positions = [], normalData = [];
  const add = (point, normal) => { positions.push(...point); normalData.push(...normal); };
  const triangle = (a, b, c, na, nb, nc) => { add(a, na); add(b, nb); add(c, nc); };
  const ring = (scale, z) => outline.map(point => [center[0] + (point[0] - center[0]) * scale, center[1] + (point[1] - center[1]) * scale, z]);
  // Six bevel bands turn a flat glyph into a continuous soft material edge.
  const bands = [];
  for (let index = 0; index <= 6; index++) {
    const angle = index / 6 * Math.PI / 2;
    bands.push({ points: ring(.96 + .04 * Math.sin(angle), .10 - .055 * (1 - Math.cos(angle))), side: Math.sin(angle), front: Math.cos(angle) });
  }
  bands.push({ points: ring(1, -.10), side: 1, front: 0 });
  for (let band = 0; band < bands.length - 1; band++) {
    const a = bands[band], b = bands[band + 1];
    for (let index = 0; index < outline.length; index++) {
      const next = (index + 1) % outline.length;
      const n = (level, i) => [normals[i][0] * level.side, normals[i][1] * level.side, level.front];
      triangle(a.points[index], b.points[index], a.points[next], n(a,index), n(b,index), n(a,next));
      triangle(a.points[next], b.points[index], b.points[next], n(a,next), n(b,index), n(b,next));
    }
  }
  // Tessellate both faces so the bow remains continuous through their interiors.
  for (const [faceScale, z, direction] of [[.96, .10, 1], [1, -.10, -1]]) {
    const normal = [0, 0, direction];
    for (let band = 0; band < 14; band++) {
      const inner = ring(faceScale * band / 14, z);
      const outer = ring(faceScale * (band + 1) / 14, z);
      for (let index = 0; index < outline.length; index++) {
        const next = (index + 1) % outline.length;
        triangle(inner[index], outer[index], outer[next], normal, normal, normal);
        if (band) triangle(inner[index], outer[next], inner[next], normal, normal, normal);
      }
    }
  }
  for (const [name, values] of [['position', positions], ['normal', normalData]]) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  }
  const modelLocation = gl.getUniformLocation(program, 'model');
  const projectionLocation = gl.getUniformLocation(program, 'projection');
  const toneLocation = gl.getUniformLocation(program, 'tone');
  const peelLocation = gl.getUniformLocation(program, 'peel');
  const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const multiply = (a, b) => {
    const out = Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c*4+r] += a[k*4+r] * b[c*4+k];
    return out;
  };
  const rotation = (axis, angle) => {
    const m = identity(), c = Math.cos(angle), s = Math.sin(angle);
    if (axis === 'x') { m[5]=c; m[6]=s; m[9]=-s; m[10]=c; }
    if (axis === 'y') { m[0]=c; m[2]=-s; m[8]=s; m[10]=c; }
    if (axis === 'z') { m[0]=c; m[1]=s; m[4]=-s; m[5]=c; }
    return m;
  };
  const translation = (x,y,z) => { const m = identity(); m[12]=x; m[13]=y; m[14]=z; return m; };
  let visible = true, contextLost = false, frame = 0, last = 0, origin = 0;
  let pointerX = 0, pointerY = 0, easedX = 0, easedY = 0;
  function resize() {
    if (contextLost) return;
    const bounds = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    const aspect = canvas.width / canvas.height, f = 1 / Math.tan(10.2 * Math.PI / 360), near = .1, far = 100;
    gl.uniformMatrix4fv(projectionLocation, false, [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0]);
    draw(performance.now(), true);
  }
  function draw(now, still = false) {
    if (contextLost) return;
    if (!origin) origin = now;
    const time = reduced.matches || still ? 0 : (now - origin) / 1000;
    easedX += (pointerX - easedX) * .05;
    easedY += (pointerY - easedY) * .05;
    const phase = time % 8;
    const ease = value => .5 - .5 * Math.cos(Math.PI * Math.max(0, Math.min(1, value)));
    const peel = phase < 1 ? 0 : phase < 3 ? ease((phase - 1) / 2) : phase < 4 ? 1 : phase < 6 ? 1 - ease((phase - 4) / 2) : 0;
    const portrait = window.matchMedia('(max-width: 760px)').matches;
    const scale = identity(); scale[0] = scale[5] = scale[10] = portrait ? 1.42 : 1.94;
    const orientation = portrait
      ? multiply(rotation('z', -.20), multiply(rotation('y', -.38 + easedX), rotation('x', .24 + easedY)))
      : multiply(rotation('z', -.24), multiply(rotation('y', -.20 + easedX), rotation('x', .65 + easedY)));
    const base = multiply(scale, orientation);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (let half = 0; half < 2; half++) {
      const move = portrait
        ? translation(half ? .045 + peel*.10 : -.045 - peel*.10, half ? -.04 - peel*.035 : .04 + peel*.035, half ? .16 + peel*.26 : -.16 - peel*.26)
        : translation(half ? .045 : -.045, half ? -.04 : .04, half ? .16 : -.16);
      const turn = multiply(rotation('z', half ? Math.PI - peel*.075 : -.08 + peel*.075), rotation('y', half ? peel*.18 : -peel*.18));
      const local = multiply(move, turn);
      const depth = portrait ? identity() : translation((half ? .65 : -.65) * peel, (half ? .12 : -.12) * peel, (half ? 1.2 : -1.2) * peel);
      const matrix = multiply(depth, multiply(base, local));
      gl.uniformMatrix4fv(modelLocation, false, matrix);
      gl.uniform1f(toneLocation, half);
      gl.uniform1f(peelLocation, peel);
      gl.drawArrays(gl.TRIANGLES, 0, positions.length / 3);
    }
    stage.dataset.rendered = 'true';
  }
  function tick(now) {
    frame = 0;
    if (contextLost || !visible || document.hidden || reduced.matches) return;
    if (now - last >= 1000 / 30) { last = now; draw(now); }
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (contextLost) return;
    if (reduced.matches) { pointerX = pointerY = easedX = easedY = 0; draw(performance.now(), true); }
    else if (visible && !document.hidden) frame = requestAnimationFrame(tick);
  }
  stage.addEventListener('pointermove', event => {
    if (reduced.matches || !finePointer.matches) return;
    const rect = stage.getBoundingClientRect();
    pointerX = ((event.clientX - rect.left) / rect.width - .5) * .25;
    pointerY = ((event.clientY - rect.top) / rect.height - .5) * .15;
  });
  stage.addEventListener('pointerleave', () => { pointerX = pointerY = 0; });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frame);
    stage.removeAttribute('data-rendered');
  });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume(); }, { threshold: 0 }).observe(stage);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize, { passive: true });
  reduced.addEventListener('change', resume);
  document.addEventListener('visibilitychange', resume);
  resize();
  resume();
})();
