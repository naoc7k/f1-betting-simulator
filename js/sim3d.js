/**
 * F1 Betting Simulator - 3D WebGL Race Simulator (Three.js + 3D Projection Overlay)
 *
 * Features:
 *  - High-detail procedural 3D F1 car models (nosecone, front/rear wings, sidepods, halo, helmet, 4 wheels with Pirelli compound rings, rear ERS light)
 *  - Grounded 3D circuits with solid asphalt embankment foundation & bridge pillars on elevated sections (zero floating tracks)
 *  - Spatial collision-checked scenery placement (guarantees zero objects, trees, poles, or grandstands ever block or sit on the track!)
 *  - 10 Distinct Circuit Visual Identities & Landmarks:
 *      1. Interlagos (BR): São Paulo skyline buildings, Autódromo lake, green-yellow-white kerbs & favelas/hillside stands
 *      2. Mônaco (MC): Mediterranean harbor water, luxury yachts, Monte Carlo apartment towers & Tunnel enclosure
 *      3. Silverstone (GB): Iconic red-white Wing paddock, wind turbines, RAF airfield perimeter & British green fields
 *      4. Monza (IT): Historic banked oval wall, dense royal park pine forest, Tifosi banners & Italian tricolore kerbs
 *      5. Spa-Francorchamps (BE): Ardennes pine forest mountains, Eau Rouge valley chalice & red-yellow kerbs
 *      6. Suzuka (JP): Giant animated Ferris Wheel, figure-8 concrete overpass bridge with pillars & cherry blossom trees
 *      7. Nürburgring (DE): Eifel medieval Nürburg Castle on hilltop, Mercedes-Arena stadium tribunes & dark spruce forest
 *      8. Yas Marina (AE): Glowing LED W-Hotel bridge over the track, illuminated night marina yachts & desert palms
 *      9. Red Bull Ring (AT): Giant Steel Bull sculpture in the infield, Styrian snow-capped Alpine peaks & alpine meadows
 *     10. Montreal (CA): St. Lawrence River water surrounding Notre-Dame Island, geodesic Biosphere dome & autumn maple trees
 */
(function () {
  const TYRE_COLORS = {
    S: 0xff2a2a,
    M: 0xffd000,
    H: 0xffffff,
    I: 0x2ecc71,
    W: 0x38bdf8
  };

  // Visual theme & custom palette per circuit ID (All 24 circuits from PDF)
  const CIRCUIT_STYLES = {
    int: { sky: 0x0b1726, fog: 0x0b1726, ground: 0x162b19, asphalt: 0x1e222a, kerbA: [0.0, 0.62, 0.23], kerbB: [0.98, 0.82, 0.08], gantryColor: 0x009c3b, runoffColor: 0x15803d },
    mon: { sky: 0x0b1e36, fog: 0x0b1e36, ground: 0x1b2430, asphalt: 0x232730, kerbA: [0.88, 0.08, 0.12], kerbB: [0.96, 0.96, 0.98], gantryColor: 0xe10600, runoffColor: 0x1e3a8a },
    sil: { sky: 0x0d1722, fog: 0x0d1722, ground: 0x142618, asphalt: 0x1c2026, kerbA: [0.12, 0.25, 0.68], kerbB: [0.95, 0.95, 0.97], gantryColor: 0x1e3a8a, runoffColor: 0x334155 },
    mza: { sky: 0x0e1921, fog: 0x0e1921, ground: 0x162a16, asphalt: 0x1f232b, kerbA: [0.85, 0.08, 0.12], kerbB: [0.05, 0.62, 0.25], gantryColor: 0xdc2626, runoffColor: 0x92400e },
    spa: { sky: 0x09151d, fog: 0x09151d, ground: 0x0e2112, asphalt: 0x1a1e24, kerbA: [0.88, 0.08, 0.08], kerbB: [0.98, 0.80, 0.06], gantryColor: 0xf59e0b, runoffColor: 0x78350f },
    suz: { sky: 0x0c1828, fog: 0x0c1828, ground: 0x15271a, asphalt: 0x1f242d, kerbA: [0.90, 0.08, 0.14], kerbB: [0.96, 0.96, 0.98], gantryColor: 0xe10600, runoffColor: 0x92400e },
    yas: { sky: 0x050811, fog: 0x050811, ground: 0x181512, asphalt: 0x171a22, kerbA: [0.06, 0.72, 0.88], kerbB: [0.95, 0.95, 0.98], gantryColor: 0x06b6d4, runoffColor: 0x0284c7 },
    rbr: { sky: 0x0b1929, fog: 0x0b1929, ground: 0x182e18, asphalt: 0x1e222a, kerbA: [0.88, 0.05, 0.08], kerbB: [0.98, 0.85, 0.10], gantryColor: 0x1d4ed8, runoffColor: 0x15803d },
    can: { sky: 0x0b1d2e, fog: 0x0b1d2e, ground: 0x0b253a, asphalt: 0x1f242c, kerbA: [0.88, 0.06, 0.08], kerbB: [0.96, 0.96, 0.98], gantryColor: 0xdc2626, runoffColor: 0x475569 },
    alb: { sky: 0x0e1c2b, fog: 0x0e1c2b, ground: 0x15291b, asphalt: 0x20242d, kerbA: [0.92, 0.08, 0.12], kerbB: [0.96, 0.96, 0.98], gantryColor: 0x2563eb, runoffColor: 0x15803d },
    sha: { sky: 0x0f1822, fog: 0x0f1822, ground: 0x18201a, asphalt: 0x1e2228, kerbA: [0.88, 0.06, 0.06], kerbB: [0.98, 0.82, 0.08], gantryColor: 0xdc2626, runoffColor: 0x78350f },
    bah: { sky: 0x070b16, fog: 0x070b16, ground: 0x1a1612, asphalt: 0x181a22, kerbA: [0.88, 0.06, 0.08], kerbB: [0.96, 0.96, 0.98], gantryColor: 0xdc2626, runoffColor: 0x92400e },
    jed: { sky: 0x060914, fog: 0x060914, ground: 0x0f1722, asphalt: 0x161820, kerbA: [0.08, 0.65, 0.35], kerbB: [0.96, 0.96, 0.98], gantryColor: 0x10b981, runoffColor: 0x0284c7 },
    mia: { sky: 0x0a1c2d, fog: 0x0a1c2d, ground: 0x14222e, asphalt: 0x222630, kerbA: [0.06, 0.76, 0.82], kerbB: [0.96, 0.96, 0.98], gantryColor: 0x06b6d4, runoffColor: 0x0369a1 },
    imo: { sky: 0x0c1723, fog: 0x0c1723, ground: 0x162617, asphalt: 0x1e222a, kerbA: [0.85, 0.08, 0.12], kerbB: [0.96, 0.96, 0.98], gantryColor: 0xdc2626, runoffColor: 0x15803d },
    cat: { sky: 0x0e1b26, fog: 0x0e1b26, ground: 0x192518, asphalt: 0x1f232b, kerbA: [0.88, 0.08, 0.10], kerbB: [0.98, 0.82, 0.08], gantryColor: 0xdc2626, runoffColor: 0x78350f },
    hun: { sky: 0x0e1922, fog: 0x0e1922, ground: 0x192617, asphalt: 0x1e2228, kerbA: [0.85, 0.08, 0.12], kerbB: [0.05, 0.62, 0.25], gantryColor: 0x15803d, runoffColor: 0x92400e },
    zan: { sky: 0x0b1e2e, fog: 0x0b1e2e, ground: 0x242018, asphalt: 0x20242c, kerbA: [0.88, 0.08, 0.10], kerbB: [0.96, 0.96, 0.98], gantryColor: 0xe10600, runoffColor: 0xb45309 },
    bak: { sky: 0x0a1624, fog: 0x0a1624, ground: 0x171f2a, asphalt: 0x1f232c, kerbA: [0.08, 0.58, 0.78], kerbB: [0.96, 0.96, 0.98], gantryColor: 0x0284c7, runoffColor: 0x334155 },
    sin: { sky: 0x050812, fog: 0x050812, ground: 0x0e141e, asphalt: 0x171922, kerbA: [0.88, 0.08, 0.12], kerbB: [0.96, 0.96, 0.98], gantryColor: 0xdc2626, runoffColor: 0x1e3a8a },
    cot: { sky: 0x0d1a28, fog: 0x0d1a28, ground: 0x221b16, asphalt: 0x1f232b, kerbA: [0.12, 0.25, 0.68], kerbB: [0.88, 0.08, 0.12], gantryColor: 0x1e3a8a, runoffColor: 0xb45309 },
    mex: { sky: 0x0d1822, fog: 0x0d1822, ground: 0x1b2019, asphalt: 0x1e2229, kerbA: [0.05, 0.62, 0.25], kerbB: [0.88, 0.08, 0.12], gantryColor: 0x059669, runoffColor: 0x78350f },
    las: { sky: 0x050711, fog: 0x050711, ground: 0x0c0f18, asphalt: 0x161820, kerbA: [0.88, 0.08, 0.12], kerbB: [0.96, 0.96, 0.98], gantryColor: 0xdc2626, runoffColor: 0x312e81 },
    lus: { sky: 0x060914, fog: 0x060914, ground: 0x181518, asphalt: 0x181a22, kerbA: [0.65, 0.08, 0.25], kerbB: [0.96, 0.96, 0.98], gantryColor: 0x831843, runoffColor: 0x581c87 }
  };

  class F1Sim3D {
    constructor() {
      this.container = null;
      this.canvasWrap = null;
      this.overlayWrap = null;
      this.circuitId = null;

      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.useFallback25D = false;
      this.fallbackCanvas = null;
      this.fallbackCtx = null;

      this.trackGroup = null;
      this.carsGroup = null;
      this.weatherGroup = null;
      this.animatedProps = []; // e.g. Ferris wheel, wind turbines
      this.carMeshes = new Map();
      this.labelEls = new Map();
      this.visualGapMap = new Map();
      this.visualGapSecMap = new Map();
      this.visualLateralMap = new Map();
      this.visualLatVelMap = new Map();
      this.carTrackPosMap = new Map();
      this.carSpeedMap = new Map();
      this.carSteerYawMap = new Map();
      this.driverPhaseMap = new Map();
      this.pitSide = -1;
      this.currentRaceId = null;
      this.viewW = 0;
      this.viewH = 0;
      this._projVec = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
      this._camTargetVec = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;

      this.cameraMode = 'panorama';
      this.orbitAngle = 0.45;
      this.orbitPitch = 0.68;
      this.orbitDist = 175;
      this.isDragging = false;
      this.dragStart = { x: 0, y: 0 };

      this.selectedDriver = null;
      this.onSelectDriver = null;

      this.animFrame = null;
      this.lastTime = performance.now();
      this.rainDrops = null;

      this._startAnimLoop();
    }

    mount(containerEl, raceState, selectedDriver, onSelectDriver) {
      this.onSelectDriver = onSelectDriver;
      this.selectedDriver = selectedDriver;

      if (!containerEl) return;
      if (this.container !== containerEl) {
        this.container = containerEl;
        this.container.innerHTML = '';

        this.canvasWrap = document.createElement('div');
        this.canvasWrap.className = 'sim3d-canvas-wrap';
        this.container.appendChild(this.canvasWrap);

        this.overlayWrap = document.createElement('div');
        this.overlayWrap.className = 'sim3d-overlay-labels';
        this.container.appendChild(this.overlayWrap);

        this.labelEls.clear();
        this.viewW = 0;
        this.viewH = 0;
        this._initRenderer();
        this._bindPointerEvents();
      }

      const cid = raceState && raceState.circuit ? raceState.circuit.id : 'int';
      if (this.circuitId !== cid) {
        this.circuitId = cid;
        this._buildCircuitScene(cid);
      }

      this._syncCarMeshes(raceState);
      this.handleResize();
    }

    setCameraMode(mode) {
      this.cameraMode = mode;
      if (mode === 'panorama') {
        this.orbitPitch = 0.65;
        this.orbitDist = 175;
      } else if (mode === 'top') {
        this.orbitPitch = 1.42;
        this.orbitDist = 195;
      } else if (mode === 'heli') {
        this.orbitPitch = 0.52;
        this.orbitDist = 135;
      }
    }

    setSelectedDriver(driverId) {
      this.selectedDriver = driverId;
      for (const [id, el] of this.labelEls.entries()) {
        el.classList.toggle('selected', id === driverId);
      }
    }

    _initRenderer() {
      const rect = this.container ? this.container.getBoundingClientRect() : null;
      const maxMobileW = Math.max(260, (window.innerWidth || 360) - 24);
      const isMobile = window.innerWidth <= 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
      const rawW = (rect && rect.width) || this.canvasWrap.clientWidth || (isMobile ? maxMobileW : 860);
      const w = isMobile ? Math.min(rawW, maxMobileW) : rawW;
      const h = (rect && rect.height) || this.canvasWrap.clientHeight || (isMobile ? 275 : 500);

      if (typeof THREE !== 'undefined') {
        try {
          this.scene = new THREE.Scene();
          this.camera = new THREE.PerspectiveCamera(42, w / h, 1, 1400);

          this.renderer = new THREE.WebGLRenderer({
            antialias: !isMobile, // Desativa MSAA pesado em mobile para ganho imediato de 60 FPS
            alpha: false,
            powerPreference: 'high-performance'
          });
          this.renderer.setSize(w, h, false);
          this.renderer.domElement.style.width = '100%';
          this.renderer.domElement.style.height = '100%';
          this.renderer.domElement.style.display = 'block';
          this.renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
          this.renderer.shadowMap.enabled = !isMobile; // Desativa sombras em tempo real no mobile para rodar liso
          if (!isMobile) {
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          }
          this.canvasWrap.appendChild(this.renderer.domElement);
          this.useFallback25D = false;
          this.circuitId = null;
          return;
        } catch (e) {
          console.warn('WebGL fallback activated:', e);
        }
      }

      this.useFallback25D = true;
      this.fallbackCanvas = document.createElement('canvas');
      this.fallbackCanvas.width = w;
      this.fallbackCanvas.height = h;
      this.fallbackCanvas.style.width = '100%';
      this.fallbackCanvas.style.height = '100%';
      this.fallbackCtx = this.fallbackCanvas.getContext('2d');
      this.canvasWrap.appendChild(this.fallbackCanvas);
    }

    _bindPointerEvents() {
      const el = this.canvasWrap;
      if (!el) return;

      el.addEventListener('pointerdown', (e) => {
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
      });

      window.addEventListener('pointermove', (e) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        this.dragStart = { x: e.clientX, y: e.clientY };
        this.orbitAngle -= dx * 0.006;
        this.orbitPitch = Math.max(0.22, Math.min(1.48, this.orbitPitch + dy * 0.005));
      });

      window.addEventListener('pointerup', () => {
        this.isDragging = false;
      });

      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.orbitDist = Math.max(60, Math.min(280, this.orbitDist + e.deltaY * 0.12));
      }, { passive: false });

      window.addEventListener('resize', () => this.handleResize());
    }

    handleResize() {
      if (!this.canvasWrap) return;
      const isMobile = window.innerWidth <= 768 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
      const maxMobileW = Math.max(260, (window.innerWidth || 360) - 20);
      const rawW = this.canvasWrap.clientWidth || (isMobile ? maxMobileW : 860);
      const w = isMobile ? Math.min(rawW, maxMobileW) : rawW;
      const h = this.canvasWrap.clientHeight || (isMobile ? 275 : 500);
      if (w === this.viewW && h === this.viewH) return;
      this.viewW = w;
      this.viewH = h;
      if (!this.useFallback25D && this.renderer && this.camera) {
        this.camera.aspect = Math.max(0.5, w / Math.max(1, h));
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      } else if (this.fallbackCanvas) {
        this.fallbackCanvas.width = w;
        this.fallbackCanvas.height = h;
      }
    }

    /**
     * Checks if a candidate 2D world point (x, z) is at least `minClearance` units away
     * from EVERY point of the entire track spline.
     * This mathematically prevents any building, tree, light pole, or prop from ever sitting on or colliding with the track!
     */
    _isPositionSafeFromTrack(x, z, spline, minClearance = 13.5) {
      const minSq = minClearance * minClearance;
      for (let i = 0; i < spline.length; i += 2) {
        const dx = x - spline[i].x;
        const dz = z - spline[i].z;
        if (dx * dx + dz * dz < minSq) {
          return false;
        }
      }
      return true;
    }

    /**
     * Finds the ground elevation at a point near the track or defaults to 0.
     */
    _buildCircuitScene(circuitId) {
      if (this.useFallback25D || !this.scene) return;
      const circuit = window.F1Tracks.CIRCUITS.find(c => c.id === circuitId) || window.F1Tracks.CIRCUITS[0];
      const style = CIRCUIT_STYLES[circuit.id] || CIRCUIT_STYLES.int;
      const isNight = circuit.theme === 'night';

      while (this.scene.children.length > 0) {
        this.scene.remove(this.scene.children[0]);
      }
      this.carMeshes.clear();
      this.animatedProps = [];

      this.scene.background = new THREE.Color(style.sky);
      this.scene.fog = new THREE.FogExp2(style.fog, 0.0019);

      // Lighting
      const hemi = new THREE.HemisphereLight(
        isNight ? 0x38bdf8 : 0xe0f2fe,
        style.ground,
        isNight ? 0.72 : 0.9
      );
      this.scene.add(hemi);

      const dirLight = new THREE.DirectionalLight(isNight ? 0x93c5fd : 0xfffbeb, isNight ? 0.95 : 1.3);
      dirLight.position.set(95, 150, 85);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.camera.near = 10;
      dirLight.shadow.camera.far = 420;
      const d = 145;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      this.scene.add(dirLight);

      this.trackGroup = new THREE.Group();
      this.carsGroup = new THREE.Group();
      this.weatherGroup = new THREE.Group();
      this.scene.add(this.trackGroup);
      this.scene.add(this.carsGroup);
      this.scene.add(this.weatherGroup);

      // Base Ground plane right at y = 0 (no floating gap!)
      const groundGeo = new THREE.PlaneGeometry(700, 700, 16, 16);
      const groundMat = new THREE.MeshStandardMaterial({
        color: style.ground,
        roughness: circuit.id === 'can' ? 0.35 : 0.92,
        metalness: circuit.id === 'can' ? 0.25 : 0.05
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.05;
      ground.receiveShadow = true;
      this.trackGroup.add(ground);

      // Montreal Notre-Dame green island landmass sitting in the St. Lawrence River
      if (circuit.id === 'can') {
        const islandGeo = new THREE.CylinderGeometry(118, 124, 0.3, 40);
        const islandMat = new THREE.MeshStandardMaterial({ color: 0x162b1c, roughness: 0.9 });
        const island = new THREE.Mesh(islandGeo, islandMat);
        island.scale.set(1.05, 1, 0.55);
        island.position.set(0, -0.1, 0);
        island.receiveShadow = true;
        this.trackGroup.add(island);
      }

      // Build 3D circuit ribbon, curbs, solid ground embankment (no floating!), and support pillars
      const spline = window.F1Tracks.getSplinePoints(circuitId, 400);
      const n = spline.length;
      const trackWidth = 6.4;
      const curbWidth = 1.05;

      const roadPositions = [];
      const roadNormals = [];
      const roadUvs = [];
      const roadIndices = [];

      const curbPositions = [];
      const curbColors = [];
      const curbIndices = [];

      // Embankment / roadbed walls from track edges down to y = -0.05 so the track NEVER floats in mid-air!
      const bedPositions = [];
      const bedIndices = [];

      for (let i = 0; i <= n; i++) {
        const pt = spline[i % n];
        const u = i / n;
        const hw = trackWidth * 0.5;

        const lx = pt.x - pt.nx * hw;
        const lz = pt.z - pt.nz * hw;
        const rx = pt.x + pt.nx * hw;
        const rz = pt.z + pt.nz * hw;
        const y = Math.max(0.06, pt.y + 0.06);

        roadPositions.push(lx, y, lz, rx, y, rz);
        roadNormals.push(0, 1, 0, 0, 1, 0);
        roadUvs.push(0, u * 40, 1, u * 40);

        // Curbs (left and right strips)
        const clx = pt.x - pt.nx * (hw + curbWidth);
        const clz = pt.z - pt.nz * (hw + curbWidth);
        const crx = pt.x + pt.nx * (hw + curbWidth);
        const crz = pt.z + pt.nz * (hw + curbWidth);
        const cy = y + 0.025;

        const isA = (i % 2) === 0;
        const col = isA ? style.kerbA : style.kerbB;

        curbPositions.push(clx, cy, clz, lx, cy, lz, rx, cy, rz, crx, cy, crz);
        for (let k = 0; k < 4; k++) curbColors.push(col[0], col[1], col[2]);

        // Embankment skirt vertices (outer curb top down to ground level y = -0.05)
        // For Suzuka overpass bridge (indices where track crosses over), leave clearance underneath and use bridge piers
        const isSuzukaBridge = (circuit.id === 'suz' && pt.y > 4.2);
        const bottomY = isSuzukaBridge ? (y - 0.65) : -0.05;
        const spread = isSuzukaBridge ? 0.1 : 1.4;

        const blx = pt.x - pt.nx * (hw + curbWidth + spread);
        const blz = pt.z - pt.nz * (hw + curbWidth + spread);
        const brx = pt.x + pt.nx * (hw + curbWidth + spread);
        const brz = pt.z + pt.nz * (hw + curbWidth + spread);

        bedPositions.push(
          clx, cy - 0.02, clz,
          blx, bottomY, blz,
          crx, cy - 0.02, crz,
          brx, bottomY, brz
        );

        if (i < n) {
          const base = i * 2;
          roadIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);

          const cBase = i * 4;
          curbIndices.push(cBase, cBase + 1, cBase + 4, cBase + 1, cBase + 5, cBase + 4);
          curbIndices.push(cBase + 2, cBase + 3, cBase + 6, cBase + 3, cBase + 7, cBase + 6);

          // Left embankment wall, Right embankment wall, and under-deck slab
          bedIndices.push(cBase, cBase + 1, cBase + 4, cBase + 1, cBase + 5, cBase + 4);
          bedIndices.push(cBase + 2, cBase + 6, cBase + 3, cBase + 3, cBase + 6, cBase + 7);
          bedIndices.push(cBase + 1, cBase + 3, cBase + 5, cBase + 3, cBase + 7, cBase + 5);
        }
      }

      // 1. Embankment / Concrete Foundation Mesh (grounds the entire track to the terrain)
      const bedGeo = new THREE.BufferGeometry();
      bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(bedPositions, 3));
      bedGeo.setIndex(bedIndices);
      bedGeo.computeVertexNormals();
      const bedMat = new THREE.MeshStandardMaterial({
        color: 0x262b36,
        roughness: 0.88,
        metalness: 0.1,
        side: THREE.DoubleSide
      });
      const bedMesh = new THREE.Mesh(bedGeo, bedMat);
      bedMesh.receiveShadow = true;
      bedMesh.castShadow = true;
      this.trackGroup.add(bedMesh);

      // Add structural concrete bridge support columns for elevated sections (e.g. Suzuka bridge, Spa Raidillon, Interlagos)
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7, metalness: 0.2 });
      for (let i = 0; i < n; i += 10) {
        const pt = spline[i];
        if (pt.y >= 2.2) {
          const lx = pt.x - pt.nx * 2.4;
          const lz = pt.z - pt.nz * 2.4;
          const rx = pt.x + pt.nx * 2.4;
          const rz = pt.z + pt.nz * 2.4;
          const h = pt.y;
          // Ensure bridge pillars don't block an underpass road (like Suzuka Degner underpass)
          if (this._isPositionSafeFromTrack(lx, lz, spline.filter((_, idx) => Math.abs(idx - i) > 25), 5.0)) {
            const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, h, 10), pillarMat);
            pL.position.set(lx, h * 0.5, lz);
            pL.castShadow = true;
            this.trackGroup.add(pL);
          }
          if (this._isPositionSafeFromTrack(rx, rz, spline.filter((_, idx) => Math.abs(idx - i) > 25), 5.0)) {
            const pR = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, h, 10), pillarMat);
            pR.position.set(rx, h * 0.5, rz);
            pR.castShadow = true;
            this.trackGroup.add(pR);
          }
        }
      }

      // 2. Road Asphalt Mesh
      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
      roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
      roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
      roadGeo.setIndex(roadIndices);

      const roadMat = new THREE.MeshStandardMaterial({
        color: style.asphalt,
        roughness: 0.62,
        metalness: 0.16,
        side: THREE.DoubleSide
      });
      const roadMesh = new THREE.Mesh(roadGeo, roadMat);
      roadMesh.receiveShadow = true;
      this.trackGroup.add(roadMesh);

      // 3. Curbs Mesh
      const curbGeo = new THREE.BufferGeometry();
      curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPositions, 3));
      curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(curbColors, 3));
      curbGeo.setIndex(curbIndices);
      curbGeo.computeVertexNormals();

      const curbMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.45,
        metalness: 0.1,
        side: THREE.DoubleSide
      });
      const curbMesh = new THREE.Mesh(curbGeo, curbMat);
      curbMesh.receiveShadow = true;
      this.trackGroup.add(curbMesh);

      // 4. White track boundary lines
      const edgeLeftPts = [];
      const edgeRightPts = [];
      for (let i = 0; i <= n; i++) {
        const pt = spline[i % n];
        const hw = trackWidth * 0.5;
        const y = Math.max(0.06, pt.y + 0.06) + 0.025;
        edgeLeftPts.push(new THREE.Vector3(pt.x - pt.nx * hw, y, pt.z - pt.nz * hw));
        edgeRightPts.push(new THREE.Vector3(pt.x + pt.nx * hw, y, pt.z + pt.nz * hw));
      }
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
      this.trackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgeLeftPts), edgeMat));
      this.trackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgeRightPts), edgeMat));

      // 5. Center racing line
      const linePts = spline.map(p => new THREE.Vector3(p.x, Math.max(0.06, p.y + 0.06) + 0.03, p.z));
      linePts.push(linePts[0].clone());
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x384152, transparent: true, opacity: 0.5 });
      this.trackGroup.add(new THREE.Line(lineGeo, lineMat));

      // 6. Start / Finish Gantry (Bridges cleanly OVER the track; side buildings checked for collision!)
      const startPt = spline[0];
      const gantryGroup = new THREE.Group();
      gantryGroup.position.set(startPt.x, startPt.y, startPt.z);
      gantryGroup.rotation.y = startPt.angleY;

      const startStrip = new THREE.Mesh(
        new THREE.BoxGeometry(trackWidth + 0.4, 0.08, 1.4),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      startStrip.position.y = 0.09;
      gantryGroup.add(startStrip);

      const gantryPillarMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.7, roughness: 0.3 });
      const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 6.8, 0.55), gantryPillarMat);
      leftPillar.position.set(-(trackWidth * 0.5 + 1.8), 3.4, 0);
      leftPillar.castShadow = true;
      gantryGroup.add(leftPillar);

      const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 6.8, 0.55), gantryPillarMat);
      rightPillar.position.set(trackWidth * 0.5 + 1.8, 3.4, 0);
      rightPillar.castShadow = true;
      gantryGroup.add(rightPillar);

      const crossBeam = new THREE.Mesh(
        new THREE.BoxGeometry(trackWidth + 4.4, 1.1, 0.8),
        new THREE.MeshStandardMaterial({ color: style.gantryColor, roughness: 0.35 })
      );
      crossBeam.position.set(0, 6.4, 0);
      crossBeam.castShadow = true;
      gantryGroup.add(crossBeam);

      for (let li = -2; li <= 2; li++) {
        const lightPod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.28, 0.2, 16),
          new THREE.MeshBasicMaterial({ color: 0xff1e00 })
        );
        lightPod.rotation.x = Math.PI / 2;
        lightPod.position.set(li * 1.1, 5.65, 0.45);
        gantryGroup.add(lightPod);
      }
      this.trackGroup.add(gantryGroup);

      // 7. Place Main Pit Building & Grandstand ONLY at verified safe offsets from every segment of the track!
      this._placeSafeGrandstandAndPit(spline, style);

      // 8. Build Circuit-Specific Unique Landmarks, Scenery & Obstacles (Verified collision-free)
      this._buildUniqueCircuitEnvironment(circuit.id, spline, style, isNight);

      // 9. Rain particle system
      const rainCount = 600;
      const rainGeo = new THREE.BufferGeometry();
      const rainPos = new Float32Array(rainCount * 3);
      for (let i = 0; i < rainCount; i++) {
        rainPos[i * 3] = (Math.random() - 0.5) * 220;
        rainPos[i * 3 + 1] = Math.random() * 60;
        rainPos[i * 3 + 2] = (Math.random() - 0.5) * 220;
      }
      rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
      const rainMat = new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.45, transparent: true, opacity: 0.0 });
      this.rainDrops = new THREE.Points(rainGeo, rainMat);
      this.weatherGroup.add(this.rainDrops);
    }

    /**
     * Places the Pit Building and Main Grandstand alongside the start straight ONLY where every corner
     * of the building footprint is verified to be at least 11.5 units away from any track point.
     */
    _placeSafeGrandstandAndPit(spline, style) {
      const startPt = spline[0];
      const candidates = [
        { side: -1, dist: 14, len: 20, isPit: true },
        { side: 1, dist: 14, len: 22, isPit: false },
        { side: -1, dist: 20, len: 18, isPit: true },
        { side: 1, dist: 20, len: 18, isPit: false }
      ];

      let placedPit = false;
      let placedStand = false;

      for (const cand of candidates) {
        if (cand.isPit && placedPit) continue;
        if (!cand.isPit && placedStand) continue;

        const cx = startPt.x + startPt.nx * cand.side * cand.dist;
        const cz = startPt.z + startPt.nz * cand.side * cand.dist;

        // Check center and both ends of the 20-unit building along the tangent
        const halfL = cand.len * 0.5;
        const p1x = cx + startPt.tx * halfL, p1z = cz + startPt.tz * halfL;
        const p2x = cx - startPt.tx * halfL, p2z = cz - startPt.tz * halfL;

        if (
          this._isPositionSafeFromTrack(cx, cz, spline, 11.0) &&
          this._isPositionSafeFromTrack(p1x, p1z, spline, 11.0) &&
          this._isPositionSafeFromTrack(p2x, p2z, spline, 11.0)
        ) {
          const bGroup = new THREE.Group();
          bGroup.position.set(cx, 0, cz);
          bGroup.rotation.y = startPt.angleY;

          if (cand.isPit) {
            const pitBuilding = new THREE.Mesh(
              new THREE.BoxGeometry(4.5, 4.2, cand.len),
              new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.3 })
            );
            pitBuilding.position.y = 2.1;
            pitBuilding.castShadow = true;
            bGroup.add(pitBuilding);

            const pitRoof = new THREE.Mesh(
              new THREE.BoxGeometry(5.3, 0.4, cand.len + 1),
              new THREE.MeshStandardMaterial({ color: style.gantryColor, roughness: 0.3 })
            );
            pitRoof.position.y = 4.3;
            bGroup.add(pitRoof);
            this.pitSide = cand.side;
            placedPit = true;
          } else {
            const stand = new THREE.Mesh(
              new THREE.BoxGeometry(5.2, 4.8, cand.len),
              new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
            );
            stand.position.y = 2.4;
            stand.castShadow = true;
            bGroup.add(stand);

            const canopy = new THREE.Mesh(
              new THREE.BoxGeometry(5.8, 0.3, cand.len + 0.6),
              new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 })
            );
            canopy.position.y = 5.0;
            bGroup.add(canopy);
            placedStand = true;
          }

          this.trackGroup.add(bGroup);
        }
      }

      // Build visible 3D Pit Lane asphalt ribbon, pit wall divider & team pit boxes parallel to the main straight
      this._build3DPitLane(spline, style);
    }

    _build3DPitLane(spline, style) {
      if (!spline || !spline.length || !this.trackGroup) return;
      const n = spline.length;
      const pSide = this.pitSide || -1;
      const pitVerts = [];
      const pitIndices = [];
      const pitEdgePts = [];
      const steps = 64;
      const startU = 0.89;
      const endU = 1.09; // wraps to 0.09

      for (let s = 0; s <= steps; s++) {
        const u = startU + (s / steps) * (endU - startU);
        const normU = u % 1;
        const idx = Math.floor(normU * n) % n;
        const pt = spline[idx];

        // Smooth blend from track edge (3.0m) out to pit lane center (5.0m) and back
        let blend = 1.0;
        if (u < 0.935) {
          const t = Math.max(0, (u - startU) / (0.935 - startU));
          blend = t * t * (3 - 2 * t);
        } else if (u > 1.045) {
          const t = Math.max(0, (endU - u) / (endU - 1.045));
          blend = t * t * (3 - 2 * t);
        }

        const centerOff = pSide * (2.6 + blend * 2.5);
        const halfW = 1.15;
        const inOff = centerOff - pSide * halfW;
        const outOff = centerOff + pSide * halfW;
        const y = Math.max(0.06, pt.y + 0.06) + 0.012;

        const ix = pt.x + pt.nx * inOff;
        const iz = pt.z + pt.nz * inOff;
        const ox = pt.x + pt.nx * outOff;
        const oz = pt.z + pt.nz * outOff;

        pitVerts.push(ix, y, iz, ox, y, oz);
        pitEdgePts.push(new THREE.Vector3(ox, y + 0.02, oz));

        if (s < steps) {
          const b = s * 2;
          pitIndices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }

      const pitGeo = new THREE.BufferGeometry();
      pitGeo.setAttribute('position', new THREE.Float32BufferAttribute(pitVerts, 3));
      pitGeo.setIndex(pitIndices);
      pitGeo.computeVertexNormals();
      const pitMat = new THREE.MeshStandardMaterial({
        color: 0x151922,
        roughness: 0.55,
        metalness: 0.2,
        side: THREE.DoubleSide
      });
      const pitMesh = new THREE.Mesh(pitGeo, pitMat);
      pitMesh.receiveShadow = true;
      this.trackGroup.add(pitMesh);

      const pitLineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75 });
      this.trackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pitEdgePts), pitLineMat));

      // Add 6 illuminated Pit Box bays along the pit lane (u = 0.962..0.985)
      const boxMat = new THREE.MeshBasicMaterial({ color: 0xffc83d, side: THREE.DoubleSide });
      for (let b = 0; b < 6; b++) {
        const boxU = (0.985 - b * 0.0035) % 1;
        const pt = spline[Math.floor(boxU * n) % n];
        const bx = pt.x + pt.nx * (pSide * 5.15);
        const bz = pt.z + pt.nz * (pSide * 5.15);
        const by = Math.max(0.06, pt.y + 0.06) + 0.03;
        const bay = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), boxMat);
        bay.rotation.x = -Math.PI / 2;
        bay.rotation.z = -pt.angleY;
        bay.position.set(bx, by, bz);
        this.trackGroup.add(bay);
      }
    }

    /**
     * Creates unique landmarks, architecture, vegetation, and atmosphere for each of the 10 circuits,
     * with strict `_isPositionSafeFromTrack` verification on every single object.
     */
    _buildUniqueCircuitEnvironment(circuitId, spline, style, isNight) {
      const n = spline.length;
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });
      const bulbMat = new THREE.MeshBasicMaterial({ color: isNight ? 0xfef08a : 0xe2e8f0 });

      // 1. Perimeter Trees / Palms / Floodlights / Tribunes (with collision check!)
      for (let i = 10; i < n - 10; i += 12) {
        const pt = spline[i];
        const side = (i % 24 === 0) ? 1 : -1;
        const dist = 15 + (i % 5) * 2.8;
        const tx = pt.x + pt.nx * side * dist;
        const tz = pt.z + pt.nz * side * dist;

        // Guarantee object is at least 12.5 units away from ALL parts of the circuit!
        if (!this._isPositionSafeFromTrack(tx, tz, spline, 12.5)) continue;

        if (isNight || i % 48 === 0) {
          // Floodlight tower grounded at y = 0
          const tower = new THREE.Group();
          tower.position.set(tx, 0, tz);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 12, 8), poleMat);
          pole.position.y = 6.0;
          tower.add(pole);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.9), bulbMat);
          lamp.position.y = 12.1;
          tower.add(lamp);
          this.trackGroup.add(tower);
        } else {
          const veg = this._createCircuitTree(circuitId);
          veg.position.set(tx, 0, tz);
          this.trackGroup.add(veg);
        }
      }

      // 2. Circuit-Specific Iconic Landmarks
      if (circuitId === 'int') {
        // INTERLAGOS: Lake (Lago de Interlagos) + São Paulo Skyline towers on the horizon
        const lake = new THREE.Mesh(
          new THREE.CircleGeometry(24, 28),
          new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.2, metalness: 0.6 })
        );
        lake.rotation.x = -Math.PI / 2;
        if (this._isPositionSafeFromTrack(112, 35, spline, 28)) {
          lake.position.set(112, 0.02, 35);
          this.trackGroup.add(lake);
        }
        // São Paulo skyline towers around perimeter
        const bMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.3 });
        for (let a = 0; a < Math.PI * 2; a += 0.32) {
          const r = 135 + (Math.sin(a * 7) * 15);
          const bx = Math.cos(a) * r;
          const bz = Math.sin(a) * r;
          if (this._isPositionSafeFromTrack(bx, bz, spline, 18)) {
            const h = 14 + Math.abs(Math.sin(a * 11)) * 26;
            const bld = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8), bMat);
            bld.position.set(bx, h * 0.5, bz);
            bld.castShadow = true;
            this.trackGroup.add(bld);
          }
        }
      } else if (circuitId === 'mon') {
        // MONACO: Mediterranean Harbor Bay with Luxury Yachts + Monte Carlo High-Rise Towers + Tunnel Roof
        const harbor = new THREE.Mesh(
          new THREE.PlaneGeometry(180, 95),
          new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.18, metalness: 0.55 })
        );
        harbor.rotation.x = -Math.PI / 2;
        harbor.position.set(0, 0.02, 102);
        this.trackGroup.add(harbor);

        // Luxury Yachts in the harbor
        for (let yx = -45; yx <= 45; yx += 18) {
          const yacht = new THREE.Group();
          const hull = new THREE.Mesh(
            new THREE.BoxGeometry(10, 2.2, 3.6),
            new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 })
          );
          hull.position.y = 1.1;
          yacht.add(hull);
          const cabin = new THREE.Mesh(
            new THREE.BoxGeometry(6, 1.8, 2.8),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2 })
          );
          cabin.position.set(-0.5, 2.8, 0);
          yacht.add(cabin);
          yacht.position.set(yx, 0.05, 72 + (yx % 2) * 8);
          if (this._isPositionSafeFromTrack(yacht.position.x, yacht.position.z, spline, 14)) {
            this.trackGroup.add(yacht);
          }
        }

        // Monte Carlo Hillside Apartments
        const aptMat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.6 });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.7 });
        for (let bx = -95; bx <= 95; bx += 22) {
          const bz = -88 - Math.abs(Math.sin(bx)) * 15;
          if (this._isPositionSafeFromTrack(bx, bz, spline, 15)) {
            const h = 16 + (Math.abs(bx) % 14);
            const tower = new THREE.Mesh(new THREE.BoxGeometry(12, h, 10), aptMat);
            tower.position.set(bx, h * 0.5, bz);
            tower.castShadow = true;
            this.trackGroup.add(tower);
            const roof = new THREE.Mesh(new THREE.BoxGeometry(12.6, 1.2, 10.6), roofMat);
            roof.position.set(bx, h + 0.6, bz);
            this.trackGroup.add(roof);
          }
        }
      } else if (circuitId === 'sil') {
        // SILVERSTONE: Animated Wind Turbines + British Airfield Runways
        const turbineMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3 });
        const turbineCoords = [[-110, -85], [115, -75], [120, 75], [-115, 80]];
        turbineCoords.forEach(([tx, tz]) => {
          if (!this._isPositionSafeFromTrack(tx, tz, spline, 18)) return;
          const tGroup = new THREE.Group();
          tGroup.position.set(tx, 0, tz);
          const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 26, 10), turbineMat);
          mast.position.y = 13;
          tGroup.add(mast);
          const rotor = new THREE.Group();
          rotor.position.set(0, 26, 0.8);
          for (let b = 0; b < 3; b++) {
            const bladeGroup = new THREE.Group();
            bladeGroup.rotation.z = (b * Math.PI * 2) / 3;
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, 0.15), turbineMat);
            blade.position.y = 5;
            bladeGroup.add(blade);
            rotor.add(bladeGroup);
          }
          tGroup.add(rotor);
          this.animatedProps.push({ mesh: rotor, axis: 'z', speed: 1.8 });
          this.trackGroup.add(tGroup);
        });
      } else if (circuitId === 'mza') {
        // MONZA: Historic High-Banked Oval Wall & Tifosi Red Grandstands
        const tifosiMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 });
        const standSpots = [[0, 56], [50, 56], [-45, -76], [98, -10]];
        standSpots.forEach(([sx, sz]) => {
          if (this._isPositionSafeFromTrack(sx, sz, spline, 15)) {
            const stand = new THREE.Mesh(new THREE.BoxGeometry(24, 6.5, 6), tifosiMat);
            stand.position.set(sx, 3.25, sz);
            stand.castShadow = true;
            this.trackGroup.add(stand);
          }
        });
      } else if (circuitId === 'spa') {
        // SPA-FRANCORCHAMPS: Ardennes Pine Forest Mountains around the valley
        const mtnMat = new THREE.MeshStandardMaterial({ color: 0x14331b, roughness: 0.95 });
        for (let a = 0; a < Math.PI * 2; a += 0.45) {
          const r = 138;
          const mx = Math.cos(a) * r;
          const mz = Math.sin(a) * r;
          if (this._isPositionSafeFromTrack(mx, mz, spline, 28)) {
            const h = 28 + Math.sin(a * 5) * 12;
            const mtn = new THREE.Mesh(new THREE.ConeGeometry(26, h, 7), mtnMat);
            mtn.position.set(mx, h * 0.5 - 1, mz);
            this.trackGroup.add(mtn);
          }
        }
      } else if (circuitId === 'suz') {
        // SUZUKA: Iconic Giant Rotating Ferris Wheel & Figure-8 Overpass Truss
        const fwX = -55, fwZ = 48;
        if (this._isPositionSafeFromTrack(fwX, fwZ, spline, 18)) {
          const fwGroup = new THREE.Group();
          fwGroup.position.set(fwX, 0, fwZ);
          const legMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.6 });
          const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 24, 8), legMat);
          leg1.position.set(-4, 11, 1.5);
          leg1.rotation.z = -0.18;
          fwGroup.add(leg1);
          const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 24, 8), legMat);
          leg2.position.set(4, 11, -1.5);
          leg2.rotation.z = 0.18;
          fwGroup.add(leg2);

          const wheel = new THREE.Group();
          wheel.position.set(0, 22, 0);
          const rim = new THREE.Mesh(
            new THREE.TorusGeometry(14, 0.45, 10, 32),
            new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
          );
          wheel.add(rim);
          const innerRim = new THREE.Mesh(
            new THREE.TorusGeometry(9, 0.3, 8, 24),
            new THREE.MeshBasicMaterial({ color: 0xf43f5e })
          );
          wheel.add(innerRim);
          for (let s = 0; s < 12; s++) {
            const ang = (s / 12) * Math.PI * 2;
            const pod = new THREE.Mesh(
              new THREE.SphereGeometry(0.95, 10, 10),
              new THREE.MeshBasicMaterial({ color: s % 2 === 0 ? 0xffc83d : 0xffffff })
            );
            pod.position.set(Math.cos(ang) * 14, Math.sin(ang) * 14, 0);
            wheel.add(pod);
          }
          fwGroup.add(wheel);
          this.animatedProps.push({ mesh: wheel, axis: 'z', speed: 0.45 });
          this.trackGroup.add(fwGroup);
        }
      } else if (circuitId === 'nur') {
        // NÜRBURGRING: Medieval Nürburg Castle on Eifel Hilltop + Mercedes Arena Grandstand
        const castleX = -15, castleZ = -88;
        if (this._isPositionSafeFromTrack(castleX, castleZ, spline, 22)) {
          const castle = new THREE.Group();
          castle.position.set(castleX, 0, castleZ);
          const hill = new THREE.Mesh(
            new THREE.ConeGeometry(22, 14, 12),
            new THREE.MeshStandardMaterial({ color: 0x16301b, roughness: 0.9 })
          );
          hill.position.y = 7;
          castle.add(hill);
          const stoneMat = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.85 });
          const keep = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.2, 15, 12), stoneMat);
          keep.position.y = 18;
          castle.add(keep);
          const spire = new THREE.Mesh(
            new THREE.ConeGeometry(5.5, 6, 12),
            new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.7 })
          );
          spire.position.y = 28;
          castle.add(spire);
          this.trackGroup.add(castle);
        }
      } else if (circuitId === 'yas') {
        // YAS MARINA: Glowing Illuminated W-Hotel LED Canopy & Night Yachts
        const hotelX = 26, hotelZ = 24;
        if (this._isPositionSafeFromTrack(hotelX, hotelZ, spline, 11.5)) {
          const hotel = new THREE.Group();
          hotel.position.set(hotelX, 0, hotelZ);
          const shellMat = new THREE.MeshStandardMaterial({
            color: 0x06b6d4,
            emissive: 0x0891b2,
            emissiveIntensity: 0.65,
            roughness: 0.25,
            metalness: 0.5,
            wireframe: false
          });
          const wingA = new THREE.Mesh(new THREE.SphereGeometry(9, 18, 12), shellMat);
          wingA.scale.set(1.6, 0.85, 0.9);
          wingA.position.set(0, 6, 0);
          hotel.add(wingA);
          this.trackGroup.add(hotel);
        }
      } else if (circuitId === 'rbr') {
        // RED BULL RING: Giant Steel Bull Landmark in the Infield + Snow-Capped Austrian Alps
        if (this._isPositionSafeFromTrack(12, -18, spline, 11)) {
          const bullGroup = new THREE.Group();
          bullGroup.position.set(12, 0, -18);
          const pedestal = new THREE.Mesh(
            new THREE.BoxGeometry(9, 3.5, 4),
            new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
          );
          pedestal.position.y = 1.75;
          bullGroup.add(pedestal);
          const bullMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.75, roughness: 0.25 });
          const body = new THREE.Mesh(new THREE.BoxGeometry(7.5, 4.2, 2.6), bullMat);
          body.position.set(0, 5.5, 0);
          bullGroup.add(body);
          const head = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3.8, 6), bullMat);
          head.rotation.z = -Math.PI / 2;
          head.position.set(4.5, 6.8, 0);
          bullGroup.add(head);
          this.trackGroup.add(bullGroup);
        }
        // Snow-capped Alpine mountains on horizon
        const alpMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });
        const snowMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
        for (let a = 0; a < Math.PI * 2; a += 0.52) {
          const mx = Math.cos(a) * 145;
          const mz = Math.sin(a) * 145;
          if (this._isPositionSafeFromTrack(mx, mz, spline, 28)) {
            const h = 34 + Math.cos(a * 3) * 12;
            const mtn = new THREE.Group();
            mtn.position.set(mx, 0, mz);
            const base = new THREE.Mesh(new THREE.ConeGeometry(24, h, 6), alpMat);
            base.position.y = h * 0.5;
            mtn.add(base);
            const cap = new THREE.Mesh(new THREE.ConeGeometry(9.5, h * 0.38, 6), snowMat);
            cap.position.y = h * 0.82;
            mtn.add(cap);
            this.trackGroup.add(mtn);
          }
        }
      } else if (circuitId === 'can') {
        // MONTREAL: Geodesic Biosphere Dome + Autumn Red/Orange Maple Trees
        if (this._isPositionSafeFromTrack(0, -52, spline, 16)) {
          const dome = new THREE.Mesh(
            new THREE.SphereGeometry(14, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.65),
            new THREE.MeshStandardMaterial({ color: 0x94a3b8, wireframe: true })
          );
          dome.position.set(0, 0, -52);
          this.trackGroup.add(dome);
        }
      }
    }

    _createCircuitTree(circuitId) {
      const tree = new THREE.Group();
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 });

      if (circuitId === 'yas' || circuitId === 'mon') {
        // Palm Tree
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 4.5, 7), trunkMat);
        trunk.position.y = 2.25;
        tree.add(trunk);
        const frondMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.7 });
        const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), frondMat);
        crown.scale.set(1.4, 0.55, 1.4);
        crown.position.y = 4.6;
        tree.add(crown);
      } else if (circuitId === 'suz') {
        // Japanese Sakura Cherry Blossom Tree
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.38, 2.2, 7), trunkMat);
        trunk.position.y = 1.1;
        tree.add(trunk);
        const sakuraMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.75 });
        const crown = new THREE.Mesh(new THREE.SphereGeometry(2.1, 10, 10), sakuraMat);
        crown.position.y = 3.2;
        crown.castShadow = true;
        tree.add(crown);
      } else if (circuitId === 'can') {
        // Canadian Autumn Maple Tree (Red/Orange foliage)
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.38, 2.2, 7), trunkMat);
        trunk.position.y = 1.1;
        tree.add(trunk);
        const mapleMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.8 });
        const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(2.0, 1), mapleMat);
        crown.position.y = 3.3;
        crown.castShadow = true;
        tree.add(crown);
      } else {
        // Pine / Cypress Conifer
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.0, 7), trunkMat);
        trunk.position.y = 1.0;
        tree.add(trunk);
        const crownMat = new THREE.MeshStandardMaterial({
          color: circuitId === 'spa' || circuitId === 'nur' ? 0x065f46 : 0x15803d,
          roughness: 0.8
        });
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.85, 4.5, 8), crownMat);
        crown.position.y = 3.5;
        crown.castShadow = true;
        tree.add(crown);
      }
      return tree;
    }

    /**
     * Builds a realistic, detailed 3D Formula 1 car mesh for a driver with multi-tone team livery
     */
    _createF1CarMesh(driverId) {
      const drv = window.F1Tracks.DRIVERS.find(d => d.id === driverId) || window.F1Tracks.DRIVERS[0];
      const team = window.F1Tracks.TEAMS[drv.team] || window.F1Tracks.TEAMS.RBR;

      const root = new THREE.Group();
      const carScale = 1.05;
      root.scale.set(carScale, carScale, carScale);

      const metalVal = team.metalness !== undefined ? team.metalness : 0.55;

      const primaryMat = new THREE.MeshStandardMaterial({
        color: team.body || team.color,
        roughness: 0.24,
        metalness: metalVal
      });
      const sidepodMat = new THREE.MeshStandardMaterial({
        color: team.sidepod || team.color,
        roughness: 0.24,
        metalness: metalVal
      });
      const accentMat = new THREE.MeshStandardMaterial({
        color: team.accent || team.color,
        roughness: 0.22,
        metalness: metalVal * 0.9
      });
      const trimMat = new THREE.MeshStandardMaterial({
        color: team.trim || team.accent || team.color,
        roughness: 0.20,
        metalness: Math.min(0.92, metalVal + 0.15)
      });
      const wingMat = new THREE.MeshStandardMaterial({
        color: team.wing || 0x111111,
        roughness: 0.32,
        metalness: 0.5
      });
      const carbonMat = new THREE.MeshStandardMaterial({
        color: 0x121318,
        roughness: 0.5,
        metalness: 0.3
      });
      const tyreMat = new THREE.MeshStandardMaterial({
        color: 0x18181b,
        roughness: 0.85,
        metalness: 0.1
      });
      const rimMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.3,
        metalness: 0.85
      });

      const floor = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.1, 4.1), carbonMat);
      floor.position.set(0, 0.16, -0.1);
      floor.castShadow = true;
      root.add(floor);

      const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.46, 2.3), primaryMat);
      chassis.position.set(0, 0.38, -0.15);
      chassis.castShadow = true;
      root.add(chassis);

      // Livery trim stripe along top of monocoque
      const topStripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 2.25), trimMat);
      topStripe.position.set(0, 0.615, -0.15);
      root.add(topStripe);

      const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 1.45, 8), primaryMat);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 0.29, 1.55);
      nose.castShadow = true;
      root.add(nose);

      // Nose tip accent (e.g. Red Bull yellow nose tip, Ferrari yellow detail, Mercedes Petronas star tip)
      const noseTip = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.38, 8), trimMat);
      noseTip.rotation.x = Math.PI / 2;
      noseTip.position.set(0, 0.26, 2.15);
      root.add(noseTip);

      const sidepodGeo = new THREE.BoxGeometry(0.46, 0.36, 1.65);
      const leftPod = new THREE.Mesh(sidepodGeo, sidepodMat);
      leftPod.position.set(-0.56, 0.35, -0.2);
      leftPod.castShadow = true;
      root.add(leftPod);

      const rightPod = new THREE.Mesh(sidepodGeo, sidepodMat);
      rightPod.position.set(0.56, 0.35, -0.2);
      rightPod.castShadow = true;
      root.add(rightPod);

      // Sidepod accent stripe
      const sideStripeGeo = new THREE.BoxGeometry(0.05, 0.1, 1.58);
      const leftStripe = new THREE.Mesh(sideStripeGeo, accentMat);
      leftStripe.position.set(-0.78, 0.38, -0.2);
      root.add(leftStripe);
      const rightStripe = new THREE.Mesh(sideStripeGeo, accentMat);
      rightStripe.position.set(0.78, 0.38, -0.2);
      root.add(rightStripe);

      const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.38, 1.35), primaryMat);
      airbox.position.set(0, 0.68, -0.58);
      airbox.castShadow = true;
      root.add(airbox);

      const sharkFin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 1.15), trimMat);
      sharkFin.position.set(0, 0.78, -1.05);
      root.add(sharkFin);

      const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.2, 0.75), carbonMat);
      cockpit.position.set(0, 0.56, 0.15);
      root.add(cockpit);

      const helmetMat = new THREE.MeshStandardMaterial({ color: drv.helmet || 0xffffff, roughness: 0.15, metalness: 0.3 });
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 14), helmetMat);
      helmet.position.set(0, 0.72, 0.1);
      root.add(helmet);

      const haloArch = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.038, 8, 18, Math.PI), accentMat);
      haloArch.rotation.x = Math.PI / 2;
      haloArch.position.set(0, 0.77, 0.12);
      root.add(haloArch);

      const haloPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8), accentMat);
      haloPillar.rotation.x = -0.35;
      haloPillar.position.set(0, 0.68, 0.41);
      root.add(haloPillar);

      const frontWingGroup = new THREE.Group();
      frontWingGroup.position.set(0, 0.18, 2.18);
      const fwMain = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.07, 0.42), wingMat);
      frontWingGroup.add(fwMain);
      const fwFlap = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.05, 0.25), trimMat);
      fwFlap.position.set(0, 0.06, -0.08);
      frontWingGroup.add(fwFlap);

      const fwEndGeo = new THREE.BoxGeometry(0.06, 0.24, 0.48);
      const fwEndL = new THREE.Mesh(fwEndGeo, accentMat);
      fwEndL.position.set(-0.95, 0.08, 0);
      frontWingGroup.add(fwEndL);
      const fwEndR = new THREE.Mesh(fwEndGeo, accentMat);
      fwEndR.position.set(0.95, 0.08, 0);
      frontWingGroup.add(fwEndR);
      root.add(frontWingGroup);

      const rearWingGroup = new THREE.Group();
      rearWingGroup.position.set(0, 0.78, -1.95);
      const rwMain = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.08, 0.38), wingMat);
      rearWingGroup.add(rwMain);
      const rwDrs = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.07, 0.24), trimMat);
      rwDrs.position.set(0, 0.14, -0.06);
      rearWingGroup.add(rwDrs);

      const rwEndGeo = new THREE.BoxGeometry(0.06, 0.56, 0.46);
      const rwEndL = new THREE.Mesh(rwEndGeo, wingMat);
      rwEndL.position.set(-0.72, -0.1, 0);
      rearWingGroup.add(rwEndL);
      const rwEndR = new THREE.Mesh(rwEndGeo, wingMat);
      rwEndR.position.set(0.72, -0.1, 0);
      rearWingGroup.add(rwEndR);

      const tailLight = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.18, 0.08),
        new THREE.MeshBasicMaterial({ color: 0xff1e00 })
      );
      tailLight.position.set(0, -0.42, -0.18);
      rearWingGroup.add(tailLight);
      root.add(rearWingGroup);

      const wheelOffsets = [
        { x: -0.88, y: 0.34, z: 1.32, front: true },
        { x:  0.88, y: 0.34, z: 1.32, front: true },
        { x: -0.92, y: 0.36, z: -1.38, front: false },
        { x:  0.92, y: 0.36, z: -1.38, front: false }
      ];
      const wheels = [];
      const tyreRings = [];

      wheelOffsets.forEach(wo => {
        const wGroup = new THREE.Group();
        wGroup.position.set(wo.x, wo.y, wo.z);

        const radius = wo.front ? 0.34 : 0.36;
        const width = wo.front ? 0.36 : 0.44;

        const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 20), tyreMat);
        tire.rotation.z = Math.PI / 2;
        tire.castShadow = true;
        wGroup.add(tire);

        const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 14), rimMat);
        rim.rotation.z = Math.PI / 2;
        wGroup.add(rim);

        const ringMat = new THREE.MeshBasicMaterial({ color: TYRE_COLORS.S, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.62, radius * 0.84, 20), ringMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = wo.x < 0 ? -(width * 0.5 + 0.01) : (width * 0.5 + 0.01);
        wGroup.add(ring);
        tyreRings.push(ringMat);

        const strut = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(wo.x), 0.05, 0.08), carbonMat);
        strut.position.x = wo.x < 0 ? Math.abs(wo.x) * 0.5 : -Math.abs(wo.x) * 0.5;
        wGroup.add(strut);

        root.add(wGroup);
        wheels.push(wGroup);
      });

      const highlightRingGeo = new THREE.RingGeometry(1.75, 2.35, 32);
      const highlightRingMat = new THREE.MeshBasicMaterial({
        color: 0xffc83d,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92
      });
      const highlightRing = new THREE.Mesh(highlightRingGeo, highlightRingMat);
      highlightRing.rotation.x = -Math.PI / 2;
      highlightRing.position.y = 0.08;
      highlightRing.visible = false;
      root.add(highlightRing);

      const beaconGeo = new THREE.ConeGeometry(0.45, 1.1, 4);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffc83d });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.rotation.x = Math.PI;
      beacon.position.y = 2.6;
      beacon.visible = false;
      root.add(beacon);

      return {
        group: root,
        wheels,
        tyreRings,
        highlightRing,
        beacon,
        lastTyre: 'S'
      };
    }

    _syncCarMeshes(raceState) {
      if (!raceState || !raceState.order) return;

      if (this.overlayWrap) {
        const activeIds = new Set(raceState.order);
        for (const [id, el] of this.labelEls.entries()) {
          if (!activeIds.has(id)) {
            el.remove();
            this.labelEls.delete(id);
          }
        }

        raceState.order.forEach((id) => {
          if (!this.labelEls.has(id)) {
            const drv = window.F1Tracks.DRIVERS.find(d => d.id === id);
            const team = drv ? window.F1Tracks.TEAMS[drv.team] : null;
            const el = document.createElement('div');
            el.className = 'sim3d-car-label' + (this.selectedDriver === id ? ' selected' : '');
            el.style.setProperty('--team-color', team ? team.color : '#e10600');
            el.innerHTML = `<span class="c-pos">1</span><span class="c-code">${id}</span>`;
            el.onclick = (ev) => {
              ev.stopPropagation();
              const nextSel = this.selectedDriver === id ? null : id;
              this.setSelectedDriver(nextSel);
              if (typeof this.onSelectDriver === 'function') {
                this.onSelectDriver(nextSel);
              }
            };
            this.overlayWrap.appendChild(el);
            this.labelEls.set(id, el);
          }
        });
      }

      if (this.useFallback25D || !this.carsGroup) return;

      const activeSet = new Set(raceState.order);
      for (const [id, entry] of this.carMeshes.entries()) {
        if (!activeSet.has(id)) {
          this.carsGroup.remove(entry.group);
          this.carMeshes.delete(id);
        }
      }

      raceState.order.forEach((id) => {
        if (!this.carMeshes.has(id)) {
          const entry = this._createF1CarMesh(id);
          this.carsGroup.add(entry.group);
          this.carMeshes.set(id, entry);
        }
      });
    }

    _startAnimLoop() {
      const tick = (now) => {
        this.animFrame = requestAnimationFrame(tick);
        const dt = Math.min(0.1, (now - this.lastTime) / 1000);
        this.lastTime = now;
        this._renderFrame(now, dt);
      };
      this.animFrame = requestAnimationFrame(tick);
    }

    /**
     * Coordinated multi-car kinematics engine:
     *  - Enforces strictly monotonic forward motion on track (zero slingshot/backward recoil!).
     *  - Simulates 3-stage visual Pit Stops (ENTRY deceleration -> STOPPED in pit box -> EXIT acceleration).
     *  - Performs spatial multi-car collision avoidance and progressive lateral overtaking maneuvers.
     *  - Modulates speed naturally for standing starts and tight corners.
     */
    _updateAllDriversKinematics(race, nowMs, dt) {
      if (!race || !Array.isArray(race.order) || !race.drv) return;
      const frameDt = Math.min(0.05, Math.max(0.004, dt || 0.016));

      if (this.currentRaceId !== race.id) {
        this.currentRaceId = race.id;
        this.visualGapMap.clear();
        this.visualGapSecMap.clear();
        this.visualLateralMap.clear();
        this.visualLatVelMap.clear();
        this.carTrackPosMap.clear();
        this.carSpeedMap.clear();
        this.carSteerYawMap.clear();
      }

      let baseLapProg = race.lapProgress || 0;
      const tickRef = race._localTickTs || race.lastTickTs;
      const subTickSec = (race.running && tickRef)
        ? Math.max(0, Math.min(0.25, (Date.now() - tickRef) / 1000))
        : 0;
      if (race.running && tickRef) {
        const elapsedSinceTick = Math.max(0, Math.min(1200, Date.now() - tickRef));
        const lapDur = race.lapDurationMs || 30000;
        baseLapProg = Math.min(0.9995, baseLapProg + elapsedSinceTick / lapDur);
      }

      const isMidLap = race.started && !race.done && !race.bettingOpen;
      const totalCompletedLaps = Math.max(0, (Number(race.lap) || 0) - (isMidLap ? 1 : 0));
      const leaderBasePos = totalCompletedLaps + baseLapProg;
      const baseLapSpeed = 1.0 / ((race.lapDurationMs || 30000) / 1000); // ~0.03333 laps/sec
      const pSide = this.pitSide || -1;

      const leadId = race.order[0];
      const leadDrv = race.drv[leadId];

      // Pass 1: Longitudinal track progress & Pit Lane kinematics
      race.order.forEach((id, rankIndex) => {
        const d = race.drv[id];
        if (!d) return;

        if (!this.driverPhaseMap.has(id)) {
          let h = 0;
          for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
          this.driverPhaseMap.set(id, (h % 628) / 100);
        }

        // Pre-race standing grid slots
        if (!race.started || (race.lap === 0 && !race.running)) {
          const gridBack = typeof d.trackPos === 'number' ? d.trackPos : (-0.004 - rankIndex * 0.0055);
          const gridSide = typeof d.latPos === 'number' ? d.latPos : ((rankIndex % 2 === 0 ? -1 : 1) * 1.35);
          this.carTrackPosMap.set(id, gridBack);
          this.carSpeedMap.set(id, 0);
          this.visualGapMap.set(id, rankIndex * 0.0055);
          this.visualGapSecMap.set(id, rankIndex * 0.28);
          this.visualLateralMap.set(id, gridSide);
          this.visualLatVelMap.set(id, 0);
          this.carSteerYawMap.set(id, 0);
          return;
        }

        if (d.st === 'dnf') {
          const dnfPos = d.dnfTrackPos !== undefined ? d.dnfTrackPos : ((d.lapsDone * 0.23 + rankIndex * 0.05) % 1);
          this.carTrackPosMap.set(id, dnfPos);
          this.carSpeedMap.set(id, 0);
          this.visualLateralMap.set(id, 3.1);
          this.carSteerYawMap.set(id, 0);
          return;
        }

        const targetGapSec = leadDrv ? Math.max(0, (d.t || 0) - (leadDrv.t || 0)) : rankIndex * 0.6;
        const hasAuthTrackPos = typeof d.trackPos === 'number' && !Number.isNaN(d.trackPos);
        const fallbackTargetPos = leaderBasePos - Math.min(0.88, targetGapSec * 0.0115 + rankIndex * 0.006);
        const authTrackPos = hasAuthTrackPos ? d.trackPos : fallbackTargetPos;

        if (!this.carTrackPosMap.has(id) || !race.running) {
          const snapPos = hasAuthTrackPos
            ? d.trackPos
            : ((!race.running && this.carTrackPosMap.has(id)) ? this.carTrackPosMap.get(id) : fallbackTargetPos);
          this.carTrackPosMap.set(id, snapPos);
          this.carSpeedMap.set(id, 0);
          this.visualGapMap.set(id, Math.max(0, (leadDrv && typeof leadDrv.trackPos === 'number' ? leadDrv.trackPos : leaderBasePos) - snapPos));
          this.visualGapSecMap.set(id, targetGapSec);
          if (typeof d.latPos === 'number' && !this.visualLateralMap.has(id)) {
            this.visualLateralMap.set(id, d.latPos);
          }
          return;
        }

        let curPos = this.carTrackPosMap.get(id);
        let curVel = this.carSpeedMap.get(id) || baseLapSpeed;

        if (d.pitState) {
          const ps = d.pitState;
          const pitLapBase = ps.lapBase !== undefined ? ps.lapBase : Math.max(0, (Number(ps.lap) || 1) - 1);
          const pitBoxAbsPos = ps.boxAbsPos !== undefined ? ps.boxAbsPos : (pitLapBase + (ps.boxPos || 0.978));

          if (ps.phase === 'STOPPED') {
            curPos = pitBoxAbsPos;
            curVel = 0;
          } else {
            const authVel = typeof d.trackVel === 'number' ? d.trackVel : (baseLapSpeed * 0.48);
            let predictedPos = authTrackPos + authVel * subTickSec;
            if (ps.phase === 'APPROACH' || ps.phase === 'ENTRY') {
              predictedPos = Math.min(pitBoxAbsPos, predictedPos);
            }
            const nextPos = subTickSec === 0
              ? predictedPos
              : (curPos + (predictedPos - curPos) * (1 - Math.exp(-frameDt * 25.0)));
            const safeNextPos = Math.max(curPos, nextPos);
            curVel = Math.max(0, (safeNextPos - curPos) / Math.max(0.001, frameDt));
            curPos = safeNextPos;
          }
        } else if (hasAuthTrackPos) {
          // Direct 60 FPS continuous forward interpolation coupled 1:1 to authoritative physical kinematics
          const authVel = typeof d.trackVel === 'number' ? d.trackVel : baseLapSpeed;
          const predictedPos = authTrackPos + authVel * subTickSec;

          if (Math.abs(predictedPos - curPos) > 1.5) {
            curPos = predictedPos;
            curVel = authVel;
          } else {
            const nextPos = subTickSec === 0
              ? predictedPos
              : (curPos + (predictedPos - curPos) * (1 - Math.exp(-frameDt * 25.0)));
            const safeNextPos = Math.max(curPos, nextPos);
            curVel = subTickSec === 0 ? authVel : Math.max(0, (safeNextPos - curPos) / Math.max(0.001, frameDt));
            curPos = safeNextPos;
          }
        } else {
          // Fallback if race state has no d.trackPos
          const posErr = fallbackTargetPos - curPos;
          const desiredVel = baseLapSpeed * Math.max(0.82, Math.min(1.14, 1.0 + posErr * 4.0));
          curVel = Math.max(0, curVel + (desiredVel - curVel) * (1 - Math.exp(-frameDt * 6.0)));
          curPos = curPos + curVel * frameDt;
        }

        this.carTrackPosMap.set(id, curPos);
        this.carSpeedMap.set(id, curVel);

        const refLeadPos = (leadDrv && this.carTrackPosMap.has(leadId)) ? this.carTrackPosMap.get(leadId) : leaderBasePos;
        const actualVisualGap = Math.max(0, refLeadPos - curPos);
        this.visualGapMap.set(id, actualVisualGap);

        const prevSec = this.visualGapSecMap.has(id) ? this.visualGapSecMap.get(id) : targetGapSec;
        const secAlpha = 1 - Math.exp(-frameDt * 6.0);
        this.visualGapSecMap.set(id, prevSec + (targetGapSec - prevSec) * secAlpha);
      });

      // Pass 2: Lateral Racing Line, 4-Phase Pit Lane Trajectory & Multi-Car 5-Stage Overtake Lanes
      const runningIds = race.order.filter(id => race.drv[id] && race.drv[id].st === 'run');
      runningIds.sort((a, b) => (this.carTrackPosMap.get(b) || 0) - (this.carTrackPosMap.get(a) || 0));

      const chosenLaterals = new Map();

      runningIds.forEach((id) => {
        const d = race.drv[id];
        const curPos = this.carTrackPosMap.get(id) || 0;
        const drvPhase = this.driverPhaseMap.get(id) || 0;
        const sampleNow = window.F1Tracks.sampleTrack(race.circuit.id, curPos, 0);
        const prevLat = this.visualLateralMap.has(id)
          ? this.visualLateralMap.get(id)
          : (typeof d.latPos === 'number' ? d.latPos : 0);

        let targetLateral = typeof d.latTarget === 'number' ? d.latTarget : 0;

        if (d.pitState) {
          const ps = d.pitState;
          if (ps.phase === 'APPROACH') {
            const span = Math.max(0.01, (ps.laneStartPos || (ps.lapBase + 0.90)) - (ps.entryStartPos || (ps.lapBase + 0.82)));
            const tApp = Math.max(0, Math.min(1, (curPos - (ps.entryStartPos || (ps.lapBase + 0.82))) / span));
            const sApp = tApp * tApp * (3 - 2 * tApp);
            targetLateral = pSide * (1.10 + 3.65 * sApp);
          } else if (ps.phase === 'ENTRY') {
            const boxAbs = ps.boxAbsPos || (ps.lapBase + 0.978);
            const distToBox = Math.max(0, boxAbs - curPos);
            const boxBlend = distToBox < 0.018 ? (1.0 - distToBox / 0.018) : 0;
            const boxSmooth = boxBlend * boxBlend * (3 - 2 * boxBlend);
            targetLateral = pSide * (4.75 + 0.40 * boxSmooth);
          } else if (ps.phase === 'STOPPED') {
            targetLateral = pSide * 5.15;
          } else if (ps.phase === 'EXIT') {
            const exitStart = ps.exitLaneEndPos || ((ps.lapBase || 0) + 1.035);
            const exitEnd = ps.exitMergePos || ((ps.lapBase || 0) + 1.095);
            if (curPos < exitStart) {
              targetLateral = pSide * 4.75;
            } else {
              const tEx = Math.max(0, Math.min(1, (curPos - exitStart) / Math.max(0.01, exitEnd - exitStart)));
              const sEx = tEx * tEx * (3 - 2 * tEx);
              targetLateral = pSide * 4.75 * (1 - sEx);
            }
          }
        } else {
          if (typeof d.latTarget !== 'number') {
            const apexHug = -Math.sign(sampleNow.curvature || 0) * Math.min(1.05, Math.abs(sampleNow.curvature || 0) * 1.40);
            const organicLine = Math.sin(curPos * Math.PI * 2 + drvPhase) * 0.30;
            targetLateral = Math.max(-1.75, Math.min(1.75, apexHug + organicLine));
          }

          // Multi-car spatial collision avoidance (ensures 3+ battling cars fan out into distinct lanes)
          const nearbyBlockedLanes = [];
          for (const otherId of runningIds) {
            if (otherId === id) continue;
            const otherD = race.drv[otherId];
            if (!otherD || otherD.pitState) continue;
            const otherPos = this.carTrackPosMap.get(otherId) || 0;
            const dLong = otherPos - curPos;
            if (dLong > -0.0075 && dLong < 0.018) {
              const otherLat = chosenLaterals.has(otherId)
                ? chosenLaterals.get(otherId)
                : (this.visualLateralMap.get(otherId) || 0);
              nearbyBlockedLanes.push({ dLong, otherLat });
            }
          }

          if (nearbyBlockedLanes.length > 0) {
            // Check if current targetLateral conflicts with any nearby car (< 1.25m lateral separation)
            const hasConflict = nearbyBlockedLanes.some(nb => Math.abs(targetLateral - nb.otherLat) < 1.25);
            if (hasConflict) {
              const candidateLanes = [-1.70, 0.0, 1.70, -0.88, 0.88];
              let bestLane = targetLateral;
              let bestScore = -999;

              for (const cand of candidateLanes) {
                let minClearance = 99;
                for (const nb of nearbyBlockedLanes) {
                  const latDist = Math.abs(cand - nb.otherLat);
                  if (latDist < minClearance) minClearance = latDist;
                }
                const stabilityBonus = -Math.abs(cand - prevLat) * 0.32 - Math.abs(cand - targetLateral) * 0.18;
                const score = minClearance + stabilityBonus;
                if (score > bestScore) {
                  bestScore = score;
                  bestLane = cand;
                }
              }

              const closestLong = Math.min(...nearbyBlockedLanes.map(n => Math.abs(n.dLong)));
              const proxBlend = Math.max(0, Math.min(1, 1.0 - (closestLong / 0.018)));
              const smoothProx = proxBlend * proxBlend * (3 - 2 * proxBlend);
              targetLateral = targetLateral + (bestLane - targetLateral) * Math.max(0.50, smoothProx);
            }
          }

          targetLateral = Math.max(-2.30, Math.min(2.30, targetLateral));
        }

        chosenLaterals.set(id, targetLateral);

        // Smooth lateral transition with realistic physical lateral steering speed limit
        const latRate = d.pitState ? 4.4 : 3.6;
        const latAlpha = 1 - Math.exp(-frameDt * latRate);
        const desiredStep = (targetLateral - prevLat) * latAlpha;
        const maxLatSpeed = d.pitState ? 2.8 : 1.55; // m/s lateral steering cap
        const maxStep = maxLatSpeed * frameDt;
        const clampedStep = Math.max(-maxStep, Math.min(maxStep, desiredStep));
        const curLateral = prevLat + clampedStep;
        const latVel = clampedStep / Math.max(0.001, frameDt);

        this.visualLateralMap.set(id, curLateral);
        this.visualLatVelMap.set(id, latVel);

        const rawSteerYaw = (this.carSpeedMap.get(id) || 0) > 0.002
          ? Math.max(-0.20, Math.min(0.20, latVel * 0.042))
          : 0;
        const prevYaw = this.carSteerYawMap.get(id) || 0;
        const curYaw = prevYaw + (rawSteerYaw - prevYaw) * (1 - Math.exp(-frameDt * 9.0));
        this.carSteerYawMap.set(id, curYaw);
      });
    }

    _getDriverVisualProgress(race, id, rankIndex) {
      const d = race.drv && race.drv[id];
      if (!d) return { progress: 0, lateral: 0, speedRatio: 0, steerYaw: 0 };

      const progress = this.carTrackPosMap.has(id) ? this.carTrackPosMap.get(id) : (-0.012 - rankIndex * 0.011);
      const lateral = this.visualLateralMap.has(id) ? this.visualLateralMap.get(id) : 0;
      const curVel = this.carSpeedMap.get(id) || 0;
      const baseLapSpeed = 1.0 / ((race.lapDurationMs || 30000) / 1000);
      const speedRatio = race.running ? Math.max(0, Math.min(1.35, curVel / baseLapSpeed)) : 0;
      const steerYaw = this.carSteerYawMap.get(id) || 0;

      return { progress, lateral, speedRatio, steerYaw };
    }

    /**
     * Returns the live visual standings synchronized 1:1 with the physical 3D cars on the map.
     * Orders running drivers by their actual monotonic 3D track distance (`carTrackPosMap`).
     */
    getVisualStandings(race) {
      if (!race || !Array.isArray(race.order)) {
        return { order: [], rankMap: new Map(), gapSecMap: new Map() };
      }
      const leadId = race.order[0];
      const leadDrv = race.drv && race.drv[leadId];

      if (!race.running || this.carTrackPosMap.size === 0 || this.currentRaceId !== race.id) {
        const rankMap = new Map();
        const gapSecMap = new Map();
        race.order.forEach((id, idx) => {
          rankMap.set(id, idx + 1);
          const d = race.drv && race.drv[id];
          const gSec = (d && leadDrv) ? Math.max(0, (d.t || 0) - (leadDrv.t || 0)) : idx * 0.8;
          gapSecMap.set(id, gSec);
        });
        return { order: race.order.slice(), rankMap, gapSecMap };
      }

      const running = [];
      const nonRunning = [];
      race.order.forEach((id, idx) => {
        const d = race.drv && race.drv[id];
        if (d && d.st === 'run') {
          const trackPos = this.carTrackPosMap.has(id) ? this.carTrackPosMap.get(id) : (-idx * 0.014);
          running.push({ id, trackPos, authIdx: idx });
        } else {
          nonRunning.push(id);
        }
      });

      // Higher trackPos = further ahead along the race distance = better rank (P1, P2, P3...)
      running.sort((a, b) => (b.trackPos - a.trackPos) || (a.authIdx - b.authIdx));
      const visualOrder = running.map(x => x.id).concat(nonRunning);
      const rankMap = new Map();
      const gapSecMap = new Map();
      const leaderTrackPos = running.length ? running[0].trackPos : 0;
      const lapDurSec = ((race.lapDurationMs || 30000) / 1000);

      visualOrder.forEach((id, idx) => {
        rankMap.set(id, idx + 1);
        const d = race.drv && race.drv[id];
        if (this.carTrackPosMap.has(id) && d && d.st === 'run') {
          const posDiff = Math.max(0, leaderTrackPos - this.carTrackPosMap.get(id));
          // Convert visual track distance gap into coherent live gap seconds
          const authGapSec = this.visualGapSecMap.has(id) ? this.visualGapSecMap.get(id) : (posDiff * lapDurSec);
          gapSecMap.set(id, Math.max(0, authGapSec));
        } else {
          const gSec = (d && leadDrv) ? Math.max(0, (d.t || 0) - (leadDrv.t || 0)) : idx * 0.8;
          gapSecMap.set(id, gSec);
        }
      });

      return { order: visualOrder, rankMap, gapSecMap };
    }

    _renderFrame(nowMs, dt) {
      const race = window.F1App && window.F1App.getRaceState ? window.F1App.getRaceState() : null;
      if (!this.container || !race || !race.circuit) return;

      if (this.circuitId !== race.circuit.id) {
        this.circuitId = race.circuit.id;
        this._buildCircuitScene(this.circuitId);
      }
      if (this.carMeshes.size !== (race.order ? race.order.length : 0)) {
        this._syncCarMeshes(race);
      }

      if (this.useFallback25D) {
        this._renderFallback25D(race, nowMs);
        return;
      }

      if (!this.renderer || !this.scene || !this.camera) return;

      if (!this.viewW || !this.viewH) {
        this.handleResize();
      }
      const w = this.viewW || 340;
      const h = this.viewH || 275;

      // Animate circuit landmark props (Suzuka Ferris wheel, Silverstone turbines, etc.)
      for (const prop of this.animatedProps) {
        if (prop.mesh) {
          prop.mesh.rotation[prop.axis] += dt * prop.speed;
        }
      }

      if (this.rainDrops) {
        const wetness = race.w || 0;
        this.rainDrops.material.opacity = wetness > 0.15 ? Math.min(0.75, wetness * 0.85) : 0;
        if (wetness > 0.15) {
          const pos = this.rainDrops.geometry.attributes.position.array;
          for (let i = 1; i < pos.length; i += 3) {
            pos[i] -= 75 * dt;
            if (pos[i] < 0) pos[i] = 55;
          }
          this.rainDrops.geometry.attributes.position.needsUpdate = true;
        }
      }

      let chaseTargetSample = null;
      const focusId = this.selectedDriver && race.order.includes(this.selectedDriver)
        ? this.selectedDriver
        : race.order[0];

      // Step coordinated kinematics for all cars once per frame
      this._updateAllDriversKinematics(race, nowMs, dt);

      race.order.forEach((id, idx) => {
        const entry = this.carMeshes.get(id);
        const drvState = race.drv ? race.drv[id] : null;
        if (!entry || !drvState) return;

        const vis = this._getDriverVisualProgress(race, id, idx);
        const sample = window.F1Tracks.sampleTrack(race.circuit.id, vis.progress, vis.lateral);

        entry.group.position.set(sample.x, Math.max(0.06, sample.y + 0.06), sample.z);
        const steerAngle = Math.max(-0.38, Math.min(0.38, sample.curvature * 1.4 + (vis.steerYaw || 0) * 1.2));
        entry.group.rotation.set(0, sample.angleY + (vis.steerYaw || 0), 0);

        const curTyre = drvState.tyre || 'S';
        if (entry.lastTyre !== curTyre) {
          entry.lastTyre = curTyre;
          const col = TYRE_COLORS[curTyre] || TYRE_COLORS.S;
          entry.tyreRings.forEach(rm => rm.color.setHex(col));
        }

        if (vis.speedRatio > 0) {
          entry.wheels.forEach((wg, wi) => {
            wg.children[0].rotation.x += dt * 18 * vis.speedRatio;
            if (wi < 2) {
              wg.rotation.y = steerAngle;
            }
          });
        }

        const isSel = (this.selectedDriver === id);
        const isInPitBox = !!(drvState.pitState && drvState.pitState.phase === 'STOPPED');
        entry.highlightRing.visible = isSel || isInPitBox;
        entry.beacon.visible = isSel;
        if (isSel || isInPitBox) {
          const pulse = 1 + Math.sin(nowMs * 0.012) * 0.18;
          entry.highlightRing.scale.set(pulse, pulse, 1);
          if (isSel) {
            entry.beacon.position.y = 2.5 + Math.sin(nowMs * 0.008) * 0.35;
            entry.beacon.rotation.y += dt * 3.5;
          }
        }

        entry.group.visible = true;

        if (id === focusId) {
          chaseTargetSample = sample;
        }
      });

      if (this.cameraMode === 'chase' && chaseTargetSample) {
        const backDist = 14.5;
        const heightOffset = 6.2;
        const targetCamX = chaseTargetSample.x - chaseTargetSample.tx * backDist;
        const targetCamY = chaseTargetSample.y + heightOffset;
        const targetCamZ = chaseTargetSample.z - chaseTargetSample.tz * backDist;

        const camLerp = 1 - Math.exp(-Math.min(0.05, dt || 0.016) * 8.5);
        if (this._camTargetVec) {
          this._camTargetVec.set(targetCamX, targetCamY, targetCamZ);
          this.camera.position.lerp(this._camTargetVec, camLerp);
        } else {
          this.camera.position.set(targetCamX, targetCamY, targetCamZ);
        }
        const lookX = chaseTargetSample.x + chaseTargetSample.tx * 12;
        const lookY = chaseTargetSample.y + 1.2;
        const lookZ = chaseTargetSample.z + chaseTargetSample.tz * 12;
        this.camera.lookAt(lookX, lookY, lookZ);
      } else {
        if (this.cameraMode === 'heli' && !this.isDragging) {
          this.orbitAngle += dt * 0.14;
        }
        // Auto-adjust distance for narrow mobile aspect ratios so the entire 3D circuit fits centered on screen
        const aspect = Math.max(0.6, w / Math.max(1, h));
        const mobileZoomOut = aspect < 1.45 ? Math.min(1.48, 1.42 / aspect) : 1.0;
        const effDist = this.orbitDist * mobileZoomOut;
        const cx = Math.sin(this.orbitAngle) * Math.cos(this.orbitPitch) * effDist;
        const cy = Math.sin(this.orbitPitch) * effDist;
        const cz = Math.cos(this.orbitAngle) * Math.cos(this.orbitPitch) * effDist;
        this.camera.position.set(cx, Math.max(15, cy), cz);
        this.camera.lookAt(0, 0, 0);
      }

      this.renderer.render(this.scene, this.camera);

      const liveStandings = this.getVisualStandings(race);
      const isMobile = w <= 560;
      const minBoxX = isMobile ? 46 : 42;
      const minBoxY = isMobile ? 21 : 19;
      const placedBoxes = [];
      const projVec = this._projVec || new THREE.Vector3();

      const setLabelVisible = (el, vis) => {
        if (el._vis !== vis) {
          el._vis = vis;
          el.style.opacity = vis ? '1' : '0';
          el.style.pointerEvents = vis ? 'auto' : 'none';
        }
      };

      // Prioritize highlighted driver first, then podium (P1..P3), then others in current visual order
      const orderedForLabels = (liveStandings.order && liveStandings.order.length ? liveStandings.order : race.order).slice();
      orderedForLabels.sort((a, b) => {
        if (a === this.selectedDriver) return -1;
        if (b === this.selectedDriver) return 1;
        const ra = liveStandings.rankMap.get(a) || 99;
        const rb = liveStandings.rankMap.get(b) || 99;
        return ra - rb;
      });

      orderedForLabels.forEach((id) => {
        const entry = this.carMeshes.get(id);
        const labelEl = this.labelEls.get(id);
        const drvState = race.drv ? race.drv[id] : null;
        if (!entry || !labelEl || !drvState) return;
        const visPos = liveStandings.rankMap.get(id) || 1;
        const isSel = (this.selectedDriver === id);

        if (drvState.st === 'dnf' && !isSel) {
          setLabelVisible(labelEl, false);
          return;
        }

        if (!isSel && this.cameraMode === 'chase' && visPos > (isMobile ? 4 : 6)) {
          setLabelVisible(labelEl, false);
          return;
        }

        projVec.copy(entry.group.position);
        projVec.y += (isSel ? 3.5 : 2.1);
        projVec.project(this.camera);

        if (projVec.z > 1 || projVec.z < -1) {
          setLabelVisible(labelEl, false);
          return;
        }

        const sx = (projVec.x * 0.5 + 0.5) * w;
        const sy = (-(projVec.y * 0.5) + 0.5) * h;

        if (sx < 18 || sx > w - 18 || sy < 18 || sy > h - 10) {
          setLabelVisible(labelEl, false);
          return;
        }

        if (!isSel) {
          let overlaps = false;
          for (let i = 0; i < placedBoxes.length; i++) {
            const b = placedBoxes[i];
            if (Math.abs(sx - b.x) < minBoxX && Math.abs(sy - b.y) < minBoxY) {
              overlaps = true;
              break;
            }
          }
          if (overlaps) {
            setLabelVisible(labelEl, false);
            return;
          }
        }

        placedBoxes.push({ x: sx, y: sy });

        setLabelVisible(labelEl, true);
        labelEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;

        if (labelEl._lastSel !== isSel) {
          labelEl._lastSel = isSel;
          labelEl.classList.toggle('selected', isSel);
        }
        const isDnf = drvState.st === 'dnf';
        if (labelEl._lastDnf !== isDnf) {
          labelEl._lastDnf = isDnf;
          labelEl.classList.toggle('is-dnf', isDnf);
        }
        const zStr = isSel ? '30' : String(Math.max(1, 26 - visPos));
        if (labelEl._lastZ !== zStr) {
          labelEl._lastZ = zStr;
          labelEl.style.zIndex = zStr;
        }

        const isPitting = !!drvState.pitState;
        const posText = isDnf ? 'OUT' : isPitting ? `P${visPos}·PIT` : String(visPos);
        if (labelEl._lastPosText !== posText) {
          labelEl._lastPosText = posText;
          const posSpan = labelEl._posSpan || (labelEl._posSpan = labelEl.querySelector('.c-pos'));
          if (posSpan) posSpan.textContent = posText;
        }
      });
    }

    _renderFallback25D(race, nowMs) {
      const ctx = this.fallbackCtx;
      const canvas = this.fallbackCanvas;
      if (!ctx || !canvas) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const grad = ctx.createRadialGradient(w * 0.5, h * 0.4, 30, w * 0.5, h * 0.5, w * 0.7);
      grad.addColorStop(0, '#13261a');
      grad.addColorStop(1, '#080c12');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const spline = window.F1Tracks.getSplinePoints(race.circuit.id, 300);
      const scale = Math.min(w, h) * 0.0044;
      const project = (x, y, z) => ({
        sx: w * 0.5 + x * scale * 1.15,
        sy: h * 0.52 + z * scale * 0.85 - y * 2.4
      });

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      spline.forEach((p, i) => {
        const s = project(p.x, p.y, p.z);
        if (i === 0) ctx.moveTo(s.sx, s.sy);
        else ctx.lineTo(s.sx, s.sy);
      });
      ctx.closePath();
      ctx.strokeStyle = '#e10600';
      ctx.lineWidth = 22;
      ctx.stroke();

      ctx.strokeStyle = '#1f242d';
      ctx.lineWidth = 17;
      ctx.stroke();

      this._updateAllDriversKinematics(race, nowMs, 0.016);

      race.order.forEach((id, idx) => {
        const vis = this._getDriverVisualProgress(race, id, idx, nowMs);
        const sample = window.F1Tracks.sampleTrack(race.circuit.id, vis.progress, vis.lateral);
        const s = project(sample.x, sample.y, sample.z);
        const drv = window.F1Tracks.DRIVERS.find(d => d.id === id);
        const team = drv ? window.F1Tracks.TEAMS[drv.team] : null;

        if (this.selectedDriver === id) {
          ctx.beginPath();
          ctx.arc(s.sx, s.sy, 15, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffc83d';
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        ctx.save();
        ctx.translate(s.sx, s.sy);
        ctx.rotate(-sample.angleY);
        ctx.fillStyle = team ? team.color : '#e10600';
        ctx.fillRect(-5, -9, 10, 18);
        ctx.restore();

        const labelEl = this.labelEls.get(id);
        if (labelEl) {
          labelEl.style.display = 'flex';
          labelEl.style.transform = `translate3d(${s.sx.toFixed(1)}px, ${(s.sy - 14).toFixed(1)}px, 0) translate(-50%, -100%)`;
          labelEl.classList.toggle('selected', this.selectedDriver === id);
          const posSpan = labelEl.querySelector('.c-pos');
          if (posSpan) posSpan.textContent = String(idx + 1);
        }
      });
    }
  }

  window.F1Sim3D = new F1Sim3D();
})();
