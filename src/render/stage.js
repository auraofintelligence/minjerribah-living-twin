// The Stage owns the Babylon engine, scene, camera rig and the render-layer registry.
// Simulation systems must never touch Babylon directly: they publish state, and a render
// layer registered here reads that state and draws it. That split is what lets the sim run headless.

const B = window.BABYLON;

export class Stage {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.layers = [];
    this._byId = new Map();
    this.ready = false;
  }

  async init() {
    this.engine = new B.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
      powerPreference: 'high-performance',
      adaptToDeviceRatio: true
    });
    this.engine.setHardwareScalingLevel(1 / Math.min(2, window.devicePixelRatio || 1));

    const scene = (this.scene = new B.Scene(this.engine));
    scene.clearColor = new B.Color4(0.02, 0.04, 0.06, 1);
    scene.ambientColor = new B.Color3(0.12, 0.14, 0.16);
    scene.blockMaterialDirtyMechanism = true;
    scene.skipPointerMovePicking = true;
    scene.autoClear = true;

    // Camera rig: an orbit/pan planner camera by default. Other modes (walk, drone, follow)
    // are registered by the camera layer and swap the active camera on this scene.
    const cam = (this.camera = new B.ArcRotateCamera('planner', -Math.PI / 2.2, 1.05, 2200, new B.Vector3(0, 0, 0), scene));
    cam.attachControl(this.canvas, true);
    cam.lowerRadiusLimit = 40;
    cam.upperRadiusLimit = 12000;
    cam.lowerBetaLimit = 0.08;
    cam.upperBetaLimit = Math.PI / 2.02;
    cam.wheelDeltaPercentage = 0.02;
    cam.pinchDeltaPercentage = 0.02;
    cam.panningSensibility = 12;
    cam.inertia = 0.86;
    cam.panningInertia = 0.86;
    cam.minZ = 0.6;
    cam.maxZ = 40000;
    cam.useAutoRotationBehavior = false;

    // Sun. Shadow setup is owned by the lighting layer; this is the fallback so a bare boot renders.
    this.sun = new B.DirectionalLight('sun', new B.Vector3(-0.4, -0.9, 0.35), scene);
    this.sun.intensity = 3.0;
    this.hemi = new B.HemisphericLight('sky', new B.Vector3(0, 1, 0), scene);
    this.hemi.intensity = 0.55;
    this.hemi.diffuse = new B.Color3(0.62, 0.76, 0.9);
    this.hemi.groundColor = new B.Color3(0.36, 0.32, 0.24);

    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.0;
    scene.imageProcessingConfiguration.contrast = 1.15;

    this.ready = true;
    return this;
  }

  /** @param {{id:string, order?:number, init?:Function, frame?:Function, dispose?:Function}} layer */
  addLayer(layer) {
    if (this._byId.has(layer.id)) throw new Error('duplicate render layer ' + layer.id);
    layer.order = layer.order ?? 100;
    this._byId.set(layer.id, layer);
    this.layers.push(layer);
    this.layers.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    if (this.ready && layer.init) layer.init(this, this.world);
    return layer;
  }
  layer(id) { return this._byId.get(id); }

  render(dt) {
    for (const l of this.layers) {
      if (!l.frame) continue;
      try { l.frame(this, this.world, dt); } catch (e) { console.error('[stage] layer frame failed', l.id, e); l.frame = null; }
    }
    this.scene.render();
  }

  /** World metres -> scene units. The island is modelled 1:1 in metres. */
  static M = 1;

  screenshot() {
    return B.Tools.CreateScreenshotAsync(this.engine, this.camera, { precision: 1 });
  }
}
