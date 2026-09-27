import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import "./grainient.css";

type GrainientProps = {
  className?: string;
  color1: string;
  color2: string;
  color3: string;
  fps?: number;
  timeSpeed?: number;
};

type GrainientRuntime = {
  renderer: Renderer;
  program: Program;
  mesh: Mesh;
  lastTime: number;
  updateColors: () => void;
  render: (time: number) => void;
};

const vertex = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;

#define S(a,b,t) smoothstep(a,b,t)
mat2 rotate2d(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}
vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37)));
  return fract(sin(p) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(dot(-1.0 + 2.0 * hash(i), f), dot(-1.0 + 2.0 * hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(-1.0 + 2.0 * hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(-1.0 + 2.0 * hash(i + vec2(1.0)), f - vec2(1.0)), u.x),
    u.y
  );
  return 0.5 + 0.5 * n;
}
void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float ratio = iResolution.x / iResolution.y;
  float t = iTime * uTimeSpeed;
  vec2 p = uv - 0.5;
  float degree = noise(vec2(t * 0.1, p.x * p.y) * 2.0);
  p.y /= ratio;
  p *= rotate2d(radians((degree - 0.5) * 420.0 + 180.0));
  p.y *= ratio;
  p.x += sin(p.y * 4.2 + t * 1.2) / 44.0;
  p.y += sin(p.x * 6.3 + t * 1.2) / 22.0;

  vec3 lower = mix(uColor3, uColor2, S(-0.34, 0.23, p.x));
  vec3 upper = mix(uColor2, uColor1, S(-0.32, 0.25, p.x));
  // GLSL requires smoothstep's lower edge first; reversed edges are undefined
  // and can produce dark/black patches depending on the GPU driver.
  vec3 color = mix(lower, upper, S(-0.36, 0.47, p.y));
  color = (color - 0.5) * 1.08 + 0.5;
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function resolveColor(value: string, element: HTMLElement) {
  const variable = value.match(/^var\((--[^,)]+)/)?.[1];
  const resolved = variable
    ? getComputedStyle(element).getPropertyValue(variable).trim()
    : value.trim();
  const hex = resolved.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
    return new Float32Array([
      Number.parseInt(expanded.slice(0, 2), 16) / 255,
      Number.parseInt(expanded.slice(2, 4), 16) / 255,
      Number.parseInt(expanded.slice(4, 6), 16) / 255,
    ]);
  }
  return new Float32Array([1, 1, 1]);
}

export function Grainient({
  className = "",
  color1,
  color2,
  color3,
  fps = 15,
  timeSpeed = 0.25,
}: GrainientProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GrainientRuntime | null>(null);
  const settingsRef = useRef({ color1, color2, color3, fps, timeSpeed });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: Renderer;
    let program: Program;
    let mesh: Mesh;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: false,
        antialias: false,
        dpr: 1,
      });
      const gl = renderer.gl;
      const geometry = new Triangle(gl);
      const settings = settingsRef.current;
      program = new Program(gl, {
        vertex,
        fragment,
        uniforms: {
          iTime: { value: 0 },
          iResolution: { value: new Float32Array([1, 1]) },
          uTimeSpeed: { value: settings.timeSpeed },
          uColor1: { value: resolveColor(settings.color1, container) },
          uColor2: { value: resolveColor(settings.color2, container) },
          uColor3: { value: resolveColor(settings.color3, container) },
        },
      });
      mesh = new Mesh(gl, { geometry, program });
    } catch {
      container.dataset.status = "fallback";
      return;
    }

    const canvas = renderer.gl.canvas;
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    container.dataset.status = "ready";

    const runtime: GrainientRuntime = {
      renderer,
      program,
      mesh,
      lastTime: performance.now(),
      updateColors: () => {
        const next = settingsRef.current;
        program.uniforms.uColor1.value = resolveColor(next.color1, container);
        program.uniforms.uColor2.value = resolveColor(next.color2, container);
        program.uniforms.uColor3.value = resolveColor(next.color3, container);
      },
      render: (time) => {
        const next = settingsRef.current;
        runtime.lastTime = time;
        program.uniforms.uTimeSpeed.value = next.timeSpeed;
        program.uniforms.iTime.value = time * 0.001;
        renderer.render({ scene: mesh });
      },
    };
    runtimeRef.current = runtime;
    const render = (time: number) => {
      runtime.render(time);
    };
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(
        Math.max(1, Math.round(width)),
        Math.max(1, Math.round(height)),
      );
      program.uniforms.iResolution.value[0] = renderer.gl.drawingBufferWidth;
      program.uniforms.iResolution.value[1] = renderer.gl.drawingBufferHeight;
      render(performance.now());
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastPaint = 0;
    let inViewport = true;

    const loop = (time: number) => {
      const frameInterval =
        1000 / Math.max(1, settingsRef.current.fps ?? 15);
      if (time - lastPaint >= frameInterval) {
        lastPaint = time - ((time - lastPaint) % frameInterval);
        render(time);
      }
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const reconcile = () => {
      const shouldAnimate =
        inViewport && !document.hidden && !reducedMotion.matches;
      if (shouldAnimate && !frame) frame = requestAnimationFrame(loop);
      if (!shouldAnimate) {
        stop();
        render(performance.now());
      }
    };

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry?.isIntersecting ?? true;
      reconcile();
    });
    const onContextLost = () => {
      stop();
      container.dataset.status = "fallback";
    };
    const onVisibilityChange = () => reconcile();
    const onMotionChange = () => reconcile();

    resizeObserver.observe(container);
    intersectionObserver.observe(container);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onMotionChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    resize();
    reconcile();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onMotionChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.remove();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    settingsRef.current = { color1, color2, color3, fps, timeSpeed };
    const runtime = runtimeRef.current;
    if (runtime) {
      runtime.updateColors();
      runtime.render(runtime.lastTime);
    }
  }, [color1, color2, color3, fps, timeSpeed]);

  return (
    <div
      ref={containerRef}
      className={`grainient-container ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
