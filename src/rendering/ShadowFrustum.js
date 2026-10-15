import * as THREE from 'three';

// Shadow rig tuning. Rendering owns its look, so it lives here (never config.json).
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_HALF_EXTENT = 250;  // Half-width of the square the sun covers, in metres
const SCENE_HEIGHT_SPAN = 90;     // World height the frustum must swallow, in metres
const SHADOW_DEPTH_MARGIN = 50;   // Slack against the frustum's far plane, in metres

const _toLight = new THREE.Vector3();

/**
 * Depth span a directional shadow camera needs (either side of its focus plane)
 * to cover a `halfExtent` square plus the whole world height, for light arriving
 * along `direction` (unit, pointing away from the sun). Shared with
 * BeachEnvironment, which fits its own fixed sun rig.
 */
export function shadowDepthRadius(halfExtent, direction) {
  return (
    halfExtent * Math.SQRT2 * Math.hypot(direction.x, direction.z) +
    SCENE_HEIGHT_SPAN * Math.abs(direction.y) +
    SHADOW_DEPTH_MARGIN
  );
}

/**
 * ShadowFrustum
 * A focus-following, texel-snapped shadow rig for a directional light. The sun
 * keeps its fixed offset and angle; the orthographic shadow camera only slides
 * with its focus, in whole shadow-map texels, so the map around the player stays
 * sharp and shadow edges stop crawling as the camera moves.
 */
export class ShadowFrustum {
  constructor(light, { halfExtent = DEFAULT_HALF_EXTENT, height = 0 } = {}) {
    this.light = light;
    this.halfExtent = halfExtent;
    this.height = height;

    const camera = light.shadow.camera;
    camera.left = -halfExtent;
    camera.right = halfExtent;
    camera.top = halfExtent;
    camera.bottom = -halfExtent;

    // The sun's fixed offset from its target: its direction and travel distance.
    _toLight.subVectors(light.position, light.target.position);
    this.distance = _toLight.length();
    this._toLight = _toLight.clone().normalize();

    // Light-plane basis used for texel snapping (right stays horizontal).
    this._right = new THREE.Vector3().crossVectors(WORLD_UP, this._toLight).normalize();
    this._up = new THREE.Vector3().crossVectors(this._toLight, this._right);
    this._centre = new THREE.Vector3();

    this._fitDepth();
  }

  /**
   * Slides the rig onto `focus`: a Vector3, an entity exposing `position`, or an
   * object exposing its `mesh`. A null focus leaves the rig where it was.
   */
  update(focus) {
    const position = this._resolvePosition(focus);
    if (!position) return;

    const centre = this._centre.set(position.x, this.height, position.z);
    const texel = (this.halfExtent * 2) / this.light.shadow.mapSize.x;
    const u = Math.round(centre.dot(this._right) / texel) * texel;
    const v = Math.round(centre.dot(this._up) / texel) * texel;
    const w = centre.dot(this._toLight);
    centre
      .copy(this._right).multiplyScalar(u)
      .addScaledVector(this._up, v)
      .addScaledVector(this._toLight, w);

    this.light.target.position.copy(centre);
    this.light.position.copy(centre).addScaledVector(this._toLight, this.distance);
    // Legacy lights keep their target outside the scene graph, so nothing else
    // will refresh its world matrix after this move.
    this.light.target.updateMatrixWorld();
  }

  _resolvePosition(focus) {
    if (!focus) return null;
    if (focus.isVector3) return focus;
    if (focus.position && focus.position.isVector3) return focus.position;
    if (focus.mesh && focus.mesh.position) return focus.mesh.position;
    return null;
  }

  /** Fits near/far around the light so nothing inside the square clips. */
  _fitDepth() {
    const camera = this.light.shadow.camera;
    const radius = shadowDepthRadius(this.halfExtent, this._toLight);
    camera.near = Math.max(1, this.distance - radius);
    camera.far = this.distance + radius;
    // DirectionalLightShadow only refreshes its projection when the map is
    // first built, so a runtime refit must push it explicitly or it is ignored.
    camera.updateProjectionMatrix();
  }
}
