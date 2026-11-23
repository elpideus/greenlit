import type { DepthNear } from '@greenlit/shared'
import { useEffect, useRef, useState } from 'react'

type Source = HTMLImageElement | HTMLVideoElement

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

/**
 * Before each new depth frame: nearness (1 = closest, whatever the file's convention) with near things grown by a
 * couple of pixels. Where a near object's edge meets the background, the 3D view then stretches the background
 * instead of smearing the object's outline.
 */
const PREPARE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform vec2 u_texel;
uniform float u_invert;
out vec4 color;

void main() {
  float m = 0.0;
  for (int y = -2; y <= 2; y++)
    for (int x = -2; x <= 2; x++) {
      if (x * x + y * y > 5) continue;
      float d = texture(u_source, v_uv + vec2(float(x), float(y)) * u_texel).r;
      m = max(m, mix(d, 1.0 - d, u_invert));
    }
  color = vec4(m, m, m, 1.0);
}`

/**
 * Parallax occlusion: for each pixel, walk from the near end of the scale to the far end along the camera's shift
 * and take the first surface the ray meets, so near things move more than far ones and cover what is behind them.
 */
const DRAW = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_picture;
uniform sampler2D u_nearness;
uniform vec2 u_shift;
uniform float u_focus;
uniform float u_zoom;
out vec4 color;

float nearness(vec2 p) {
  return texture(u_nearness, clamp(p, 0.0, 1.0)).r;
}

void main() {
  vec2 uv = (v_uv - 0.5) / u_zoom + 0.5;
  const int STEPS = 48;
  vec2 prevP = uv - u_shift * (1.0 - u_focus);
  float prevGap = nearness(prevP) - 1.0;
  vec2 hit = uv;
  for (int i = 1; i <= STEPS; i++) {
    float h = 1.0 - float(i) / float(STEPS);
    vec2 p = uv - u_shift * (h - u_focus);
    float gap = nearness(p) - h;
    if (gap >= 0.0) {
      float w = gap / max(gap - prevGap, 1e-5);
      hit = mix(p, prevP, w);
      break;
    }
    prevP = p;
    prevGap = gap;
    hit = p;
  }
  color = texture(u_picture, clamp(hit, 0.0, 1.0));
}`

/** Longest side of the prepared nearness texture: plenty for a few percent of parallax, cheap to redo per frame. */
const NEARNESS_MAX = 1024

let webgl2: boolean | null = null
/** Whether this browser can draw the 3D view (WebGL 2; off in some embedded browsers and remote desktops). */
export function canShow3d() {
  if (webgl2 === null) {
    try {
      webgl2 = !!document.createElement('canvas').getContext('webgl2')
    } catch {
      webgl2 = false
    }
  }
  return webgl2
}

/** How far the nearest plane moves, as a share of the frame. */
const STRENGTH = 0.028

/**
 * The picture in 3D from its depth map: it leans towards the pointer while the pointer is over it, and drifts in a
 * slow ellipse otherwise (still for people who ask for reduced motion). Videos are read frame by frame.
 */
export function Parallax({
  picture,
  depth,
  near,
  onFail,
}: {
  picture: Source | null
  depth: Source | null
  near: DepthNear
  onFail?: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const sources = useRef({ picture, depth, near })
  sources.current = { picture, depth, near }
  const fail = useRef(onFail)
  fail.current = onFail

  useEffect(() => {
    const cv = canvas.current
    const gl = cv?.getContext('webgl2', { premultipliedAlpha: false, antialias: false })
    const prepare = gl && link(gl, PREPARE)
    const draw = gl && link(gl, DRAW)
    if (!cv || !gl || !prepare || !draw) {
      fail.current?.()
      return
    }
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const at = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n)
    const up = {
      source: at(prepare, 'u_source'),
      texel: at(prepare, 'u_texel'),
      invert: at(prepare, 'u_invert'),
    }
    const ud = {
      picture: at(draw, 'u_picture'),
      nearness: at(draw, 'u_nearness'),
      shift: at(draw, 'u_shift'),
      focus: at(draw, 'u_focus'),
      zoom: at(draw, 'u_zoom'),
    }
    const texture = (unit: number) => {
      const t = gl.createTexture()
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    // 0 = the picture, 1 = the depth map as it comes, 2 = its nearness, prepared (see PREPARE)
    const textures = [texture(0), texture(1), texture(2)]
    const fbo = gl.createFramebuffer()
    let nearSize = { w: 0, h: 0 }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

    // Pictures upload once; videos whenever they show a new frame.
    const uploaded: { src: Source | null; time: number }[] = [
      { src: null, time: -1 },
      { src: null, time: -1 },
    ]
    /** Uploads `src` into `unit`; true when it is there, `changed` when this call brought something new. */
    const upload = (unit: number, src: Source | null) => {
      const last = uploaded[unit]!
      if (!src) return { ready: false, changed: false }
      const video = src instanceof HTMLVideoElement
      const ok = video ? src.readyState >= 2 : src.complete && src.naturalWidth > 0
      if (!ok) return { ready: last.src === src, changed: false }
      const time = video ? src.currentTime : 0
      if (last.src === src && (!video || (src.paused && last.time === time)))
        return { ready: true, changed: false }
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, textures[unit]!)
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
      } catch {
        return { ready: false, changed: false }
      }
      uploaded[unit] = { src, time }
      return { ready: true, changed: true }
    }
    const sizeOf = (src: Source) =>
      src instanceof HTMLVideoElement
        ? { w: src.videoWidth, h: src.videoHeight }
        : { w: src.naturalWidth, h: src.naturalHeight }
    let preparedNear: DepthNear | null = null
    const prepareNearness = (src: Source, near: DepthNear) => {
      const { w: sw, h: sh } = sizeOf(src)
      const k = Math.min(1, NEARNESS_MAX / Math.max(sw, sh, 1))
      const w = Math.max(1, Math.round(sw * k))
      const h = Math.max(1, Math.round(sh * k))
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, textures[2]!)
      if (w !== nearSize.w || h !== nearSize.h) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        nearSize = { w, h }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[2]!, 0)
      gl.viewport(0, 0, w, h)
      gl.useProgram(prepare)
      gl.uniform1i(up.source, 1)
      gl.uniform2f(up.texel, 1 / w, 1 / h)
      gl.uniform1f(up.invert, near === 'dark' ? 1 : 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      preparedNear = near
    }

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let pointer: { x: number; y: number } | null = null
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      pointer = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: x * 2 - 1, y: y * 2 - 1 } : null
    }
    const onLeave = () => {
      pointer = null
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)

    let raf = 0
    const shift = { x: 0, y: 0 }
    const t0 = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round(cv.clientWidth * dpr))
      const h = Math.max(1, Math.round(cv.clientHeight * dpr))
      if (cv.width !== w || cv.height !== h) {
        cv.width = w
        cv.height = h
      }
      const s = sources.current
      const picture = upload(0, s.picture)
      const depth = upload(1, s.depth)
      if (!picture.ready || !depth.ready || !s.depth) return
      if (depth.changed || preparedNear !== s.near) prepareNearness(s.depth, s.near)
      // Lean towards the pointer: things near the camera slide against it, as when you move your head.
      const t = (now - t0) / 1000
      const target = pointer
        ? { x: -pointer.x * STRENGTH, y: pointer.y * STRENGTH }
        : still
          ? { x: 0, y: 0 }
          : { x: Math.cos(t * 1.1) * STRENGTH * 0.8, y: Math.sin(t * 1.1) * STRENGTH * 0.45 }
      shift.x += (target.x - shift.x) * 0.09
      shift.y += (target.y - shift.y) * 0.09
      gl.viewport(0, 0, w, h)
      gl.useProgram(draw)
      gl.uniform1i(ud.picture, 0)
      gl.uniform1i(ud.nearness, 2)
      // Equal motion in both directions on any shape: the shift is in screen units, the texture is not.
      const aspect = cv.clientWidth / Math.max(1, cv.clientHeight)
      gl.uniform2f(ud.shift, shift.x, shift.y * aspect)
      gl.uniform1f(ud.focus, 0.5)
      gl.uniform1f(ud.zoom, 1 + STRENGTH * 1.4)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      for (const t of textures) gl.deleteTexture(t)
      gl.deleteFramebuffer(fbo)
      gl.deleteBuffer(buf)
      gl.deleteProgram(prepare)
      gl.deleteProgram(draw)
    }
  }, [])

  return <canvas ref={canvas} className="absolute inset-0 size-full" />
}

/** Compiles and links one fragment shader with the shared vertex shader (`a_pos` at location 0). */
function link(gl: WebGL2RenderingContext, fragment: string) {
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[depth] shader', gl.getShaderInfoLog(sh))
      return null
    }
    return sh
  }
  const vs = shader(gl.VERTEX_SHADER, VERTEX)
  const fs = shader(gl.FRAGMENT_SHADER, fragment)
  if (!vs || !fs) return null
  const p = gl.createProgram()!
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.bindAttribLocation(p, 0, 'a_pos')
  gl.linkProgram(p)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null
}

/** A picture loaded for the GPU (same origin, so it can be read), or null until it has loaded. */
export function useLoadedImage(url: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    setImg(null)
    if (!url) return
    const i = new Image()
    i.decoding = 'async'
    i.onload = () => setImg(i)
    i.src = url
    return () => {
      i.onload = null
    }
  }, [url])
  return img
}
