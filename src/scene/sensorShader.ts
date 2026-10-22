// The "what the car sees" look: a shader patch for world materials. Inside a sensor's wedge the
// world keeps its colors; outside it fades to a dim blue outline-like tone, and the edge of each
// wedge glows on the ground. Driven by shared uniforms, updated once per frame.
import { Vector2, Vector3, Vector4, type Material } from 'three';
import type { Cone } from '../perception';

export const MAX_CONES = 6;

export const sensorUniforms = {
  uSensorCar: { value: new Vector3() },
  /** Unit direction of travel in scene x/z. */
  uSensorFwd: { value: new Vector2(0, -1) },
  /** Per cone: direction, half angle, range, on (1/0). */
  uSensorCones: { value: Array.from({ length: MAX_CONES }, () => new Vector4()) },
  /** 1 = sensor view, 0 = plain full-color world. */
  uSensorMix: { value: 1 },
};

export function setCones(cones: readonly Cone[]) {
  sensorUniforms.uSensorCones.value.forEach((v, i) => {
    const c = cones[i];
    if (c) v.set(c.dir, c.half, c.range, 1);
    else v.set(0, 0, 0, 0);
  });
}

const VERTEX_HEAD = 'varying vec3 vSensorPos;\n';
const VERTEX_BODY = `
  vec4 sensorWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    sensorWorld = instanceMatrix * sensorWorld;
  #endif
  vSensorPos = (modelMatrix * sensorWorld).xyz;
`;

const FRAGMENT_HEAD = `
varying vec3 vSensorPos;
uniform vec3 uSensorCar;
uniform vec2 uSensorFwd;
uniform vec4 uSensorCones[${MAX_CONES}];
uniform float uSensorMix;
`;

const FRAGMENT_BODY = `
  {
    vec2 rel = vSensorPos.xz - uSensorCar.xz;
    float ahead = dot(rel, uSensorFwd);
    float right = dot(rel, vec2(-uSensorFwd.y, uSensorFwd.x));
    float dist = length(rel);
    float ang = atan(right, ahead);
    float seen = 0.0;
    float edge = 0.0;
    float coverage[${MAX_CONES}];
    float rim[${MAX_CONES}];
    for (int i = 0; i < ${MAX_CONES}; i++) {
      vec4 c = uSensorCones[i];
      coverage[i] = 0.0;
      rim[i] = 0.0;
      if (c.w < 0.5) continue;
      float da = abs(atan(sin(ang - c.x), cos(ang - c.x)));
      float inAngle = c.y >= 3.14 ? 1.0 : 1.0 - smoothstep(c.y - 0.03, c.y + 0.03, da);
      coverage[i] = inAngle * (1.0 - smoothstep(c.z - 3.0, c.z + 1.0, dist));
      rim[i] = inAngle * (1.0 - smoothstep(0.0, 0.7, abs(dist - c.z)));
      seen = max(seen, coverage[i]);
    }
    // Only draw a wedge's edge where no other sensor sees past it.
    for (int i = 0; i < ${MAX_CONES}; i++) {
      float covered = 0.0;
      for (int j = 0; j < ${MAX_CONES}; j++) {
        if (j != i && uSensorCones[j].z > uSensorCones[i].z + 2.0) covered = max(covered, coverage[j]);
      }
      edge = max(edge, rim[i] * (1.0 - covered));
    }
    vec3 col = gl_FragColor.rgb;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 dim = vec3(0.05, 0.08, 0.13) + lum * vec3(0.22, 0.3, 0.42);
    vec3 sensed = mix(dim, col, seen) + edge * vec3(0.25, 0.75, 1.0) * 0.7;
    gl_FragColor.rgb = mix(col, sensed, uSensorMix);
  }
`;

/** Give a material the sensor look. Safe to call once per material. */
export function withSensorView<T extends Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sensorUniforms);
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader.replace('#include <dithering_fragment>', `${FRAGMENT_BODY}\n#include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => 'sensor-view';
  return m;
}
