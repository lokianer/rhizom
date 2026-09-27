// Getting a WebGL2 context for the field, and living with its loss.

/**
 * No alpha (the ground is opaque, so the compositor need not blend the canvas), no multisample
 * buffer (every shape anti-aliases itself in its shader), no depth or stencil (draw order is the
 * depth), and no preserved buffer (each frame is drawn whole).
 */
export const CONTEXT_ATTRIBUTES: Readonly<WebGLContextAttributes> = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
};

/** null where WebGL2 is unavailable, blocklisted, or the context arrives already lost. */
export function createGlContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
    return gl === null || gl.isContextLost() ? null : gl;
  } catch {
    return null;
  }
}

/** Renderer names of WebGL implementations that draw on the CPU. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software rasterizer/i;

/**
 * Whether the context draws in software. There the Canvas 2D field is 5 to 13 times faster
 * (SwiftShader, measured 2026-09-27): every WebGL frame is a long task on the main thread.
 * WARP, Windows' software adapter, is left out on purpose: it ran the WebGL2 field at 37 fps
 * where the Canvas field before it managed 16.
 */
export function isSoftwareRenderer(gl: WebGL2RenderingContext): boolean {
  // Firefox names the renderer here and warns about the debug extension; Chrome and Safari
  // answer "WebKit WebGL" and name it only through the extension.
  const plain: unknown = gl.getParameter(gl.RENDERER);
  let name = plain;
  if (typeof plain !== 'string' || plain === 'WebKit WebGL') {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    name = info === null ? plain : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  }
  return typeof name === 'string' && SOFTWARE_RENDERER.test(name);
}

/**
 * Enables accumulation into a half-float colour buffer where the platform allows it. WebGL2
 * filters RGBA16F textures on its own, but rendering into one needs one of these extensions;
 * the caller still checks the framebuffer, since an extension is a promise, not a guarantee.
 */
export function enableHalfFloatTarget(gl: WebGL2RenderingContext): boolean {
  return (
    gl.getExtension('EXT_color_buffer_float') !== null ||
    gl.getExtension('EXT_color_buffer_half_float') !== null
  );
}

export interface ContextHandlers {
  lost: () => void;
  restored: () => void;
}

/**
 * Listens for the context being lost and restored. Cancelling the loss event is what tells the
 * browser we will rebuild, and so what makes it restore the context at all. Returns the detach.
 */
export function watchContext(target: EventTarget, handlers: ContextHandlers): () => void {
  const onLost = (event: Event): void => {
    event.preventDefault();
    handlers.lost();
  };
  const onRestored = (): void => {
    handlers.restored();
  };
  target.addEventListener('webglcontextlost', onLost);
  target.addEventListener('webglcontextrestored', onRestored);
  return () => {
    target.removeEventListener('webglcontextlost', onLost);
    target.removeEventListener('webglcontextrestored', onRestored);
  };
}

/**
 * Hands the context back at once. Without this the GPU memory waits for the canvas to be
 * garbage-collected, and a browser keeps only a handful of live contexts per page.
 */
export function releaseContext(gl: WebGL2RenderingContext): void {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}
