// Compiling and linking a shader program, with its uniform locations looked up once: a lookup
// per frame is a string hash in the driver for every uniform of every draw.

export type UniformLocations<U extends string> = Readonly<Record<U, WebGLUniformLocation | null>>;

export interface GlProgram<U extends string> {
  readonly program: WebGLProgram;
  /** null for a uniform the compiler optimised away; setting it is then a harmless no-op. */
  readonly uniforms: UniformLocations<U>;
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error('WebGL gave no shader object (the context is lost)');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`The ${kind} shader did not compile: ${log}`);
  }
  return shader;
}

/** Throws with the driver's log when a stage does not compile or the program does not link. */
export function createProgram<U extends string>(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  uniformNames: readonly U[],
): GlProgram<U> {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  let fragment: WebGLShader;
  try {
    fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // The linked program keeps what it needs; the shader objects would only hold memory.
  gl.detachShader(program, vertex);
  gl.detachShader(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`The shader program did not link: ${log}`);
  }
  const uniforms = {} as Record<U, WebGLUniformLocation | null>;
  for (const name of uniformNames) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}
