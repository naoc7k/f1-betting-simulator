/**
 * F1 Betting Simulator - 3D WebGL Race Simulator (Three.js + 3D Projection Overlay)
 *
 * Features:
 *  - High-detail procedural 3D F1 car models (nosecone, front/rear wings, sidepods, halo, helmet, 4 wheels with Pirelli compound rings, rear ERS light)
 *  - Real-world 3D circuit geometry with elevation, asphalt surface, red/white kerbs, pit lane, start/finish gantry with 5 lights, grandstands & trees/lights
 *  - 60 FPS continuous spline interpolation synchronized across all players (~30s per lap)
 *  - Interactive camera modes: Panorama TV, Chase Cam (follows selected driver or leader), Helicopter Orbit, Top-Down 3D
 *  - Visual driver selection & highlighting (3D neon ring + floating telemetry tag)
 */
(function () {
  const TYRE_COLORS = {
    S: 0xff2a2a,
    M: 0xffd000,
    H: 0xffffff,
    I: 0x2ecc71,
    W: 0x38bdf8
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
      this.carMeshes = new Map(); // driverId -> { group, wheels, highlightRing, beacon, tyreRings, lastTyre }
      this.labelEls = new Map();  // driverId -> HTMLElement

      this.cameraMode = 'panorama'; // 'panorama' | 'chase' | 'heli' | 'top'
      this.orbitAngle = 0.45;
      this.orbitPitch = 0.68;
      this.orbitDist = 175;
      this.isDragging = false;
      this.dragStart = { x: 0, y: 0 };

      this.selectedDriver = null;
      this.onSelectDriver = null; // (driverId) => void

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
      const w = this.canvasWrap.clientWidth || 860;
      const h = this.canvasWrap.clientHeight || 500;

      if (typeof THREE !== 'undefined') {
        try {
          this.scene = new THREE.Scene();
          this.camera = new THREE.PerspectiveCamera(42, w / h, 1, 1200);
          this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
          this.renderer.setSize(w, h);
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          this.renderer.shadowMap.enabled = true;
          this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          this.canvasWrap.appendChild(this.renderer.domElement);
          this.useFallback25D = false;
          this.circuitId = null;
          return;
        } catch (e) {
          console.warn('WebGL fallback activated:', e);
        }
      }

      // Fallback 3D perspective canvas if Three.js/WebGL unavailable
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
      const w = this.canvasWrap.clientWidth || 860;
      const h = this.canvasWrap.clientHeight || 500;
      if (!this.useFallback25D && this.renderer && this.camera) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      } else if (this.fallbackCanvas) {
        this.fallbackCanvas.width = w;
        this.fallbackCanvas.height = h;
      }
    }

    _buildCircuitScene(circuitId) {
      if (this.useFallback25D || !this.scene) return;
      const circuit = window.F1Tracks.CIRCUITS.find(c => c.id === circuitId) || window.F1Tracks.CIRCUITS[0];
      const isNight = circuit.theme === 'night';

      // Clear previous scene
      while (this.scene.children.length > 0) {
        this.scene.remove(this.scene.children[0]);
      }
      this.carMeshes.clear();

      this.scene.background = new THREE.Color(isNight ? 0x060913 : 0x0b131e);
      this.scene.fog = new THREE.FogExp2(isNight ? 0x060913 : 0x0b131e, 0.0022);

      // Lighting
      const hemi = new THREE.HemisphereLight(isNight ? 0x3b82f6 : 0xdbeafe, isNight ? 0x090d16 : 0x142618, isNight ? 0.65 : 0.85);
      this.scene.add(hemi);

      const dirLight = new THREE.DirectionalLight(isNight ? 0x93c5fd : 0xfffbeb, isNight ? 0.9 : 1.25);
      dirLight.position.set(90, 140, 80);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 2048;
      dirLight.shadow.mapSize.height = 2048;
      dirLight.shadow.camera.near = 10;
      dirLight.shadow.camera.far = 400;
      const d = 140;
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

      // Ground terrain plane
      const groundGeo = new THREE.PlaneGeometry(600, 600, 32, 32);
      const groundMat = new THREE.MeshStandardMaterial({
        color: circuit.groundColor || '#132417',
        roughness: 0.92,
        metalness: 0.05
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.6;
      ground.receiveShadow = true;
      this.trackGroup.add(ground);

      // Subtle telemetry grid on ground
      const grid = new THREE.GridHelper(360, 36, 0x1e293b, 0x141e2b);
      grid.position.y = -0.55;
      this.trackGroup.add(grid);

      // Build 3D circuit ribbon, curbs, barriers, and scenery
      const spline = window.F1Tracks.getSplinePoints(circuitId, 400);
      const n = spline.length;
      const trackWidth = 6.2;
      const curbWidth = 1.05;

      const roadPositions = [];
      const roadNormals = [];
      const roadUvs = [];
      const roadIndices = [];

      const curbPositions = [];
      const curbColors = [];
      const curbIndices = [];

      for (let i = 0; i <= n; i++) {
        const pt = spline[i % n];
        const u = i / n;
        const hw = trackWidth * 0.5;

        const lx = pt.x - pt.nx * hw;
        const lz = pt.z - pt.nz * hw;
        const rx = pt.x + pt.nx * hw;
        const rz = pt.z + pt.nz * hw;
        const y = pt.y + 0.05;

        roadPositions.push(lx, y, lz, rx, y, rz);
        roadNormals.push(0, 1, 0, 0, 1, 0);
        roadUvs.push(0, u * 40, 1, u * 40);

        // Curbs (left and right strips)
        const clx = pt.x - pt.nx * (hw + curbWidth);
        const clz = pt.z - pt.nz * (hw + curbWidth);
        const crx = pt.x + pt.nx * (hw + curbWidth);
        const crz = pt.z + pt.nz * (hw + curbWidth);
        const cy = pt.y + 0.08;

        const isRed = (i % 2) === 0;
        const cR = isRed ? 0.88 : 0.95;
        const cG = isRed ? 0.06 : 0.95;
        const cB = isRed ? 0.06 : 0.97;

        // Left curb (2 vertices) + Right curb (2 vertices)
        curbPositions.push(clx, cy, clz, lx, cy, lz, rx, cy, rz, crx, cy, crz);
        for (let k = 0; k < 4; k++) curbColors.push(cR, cG, cB);

        if (i < n) {
          const base = i * 2;
          roadIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);

          const cBase = i * 4;
          // Left curb quad
          curbIndices.push(cBase, cBase + 1, cBase + 4, cBase + 1, cBase + 5, cBase + 4);
          // Right curb quad
          curbIndices.push(cBase + 2, cBase + 3, cBase + 6, cBase + 3, cBase + 7, cBase + 6);
        }
      }

      // Road Mesh
      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
      roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
      roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
      roadGeo.setIndex(roadIndices);

      const roadMat = new THREE.MeshStandardMaterial({
        color: 0x1e222a,
        roughness: 0.65,
        metalness: 0.15,
        side: THREE.DoubleSide
      });
      const roadMesh = new THREE.Mesh(roadGeo, roadMat);
      roadMesh.receiveShadow = true;
      this.trackGroup.add(roadMesh);

      // Curbs Mesh
      const curbGeo = new THREE.BufferGeometry();
      curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPositions, 3));
      curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(curbColors, 3));
      curbGeo.setIndex(curbIndices);
      curbGeo.computeVertexNormals();

      const curbMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        side: THREE.DoubleSide
      });
      const curbMesh = new THREE.Mesh(curbGeo, curbMat);
      curbMesh.receiveShadow = true;
      this.trackGroup.add(curbMesh);

      // Center racing line / dashed telemetry groove
      const linePts = spline.map(p => new THREE.Vector3(p.x, p.y + 0.11, p.z));
      linePts.push(linePts[0].clone());
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.55 });
      this.trackGroup.add(new THREE.Line(lineGeo, lineMat));

      // Start / Finish Checkered Line & Overhead Gantry with 5 Red Lights
      const startPt = spline[0];
      const gantryGroup = new THREE.Group();
      gantryGroup.position.set(startPt.x, startPt.y, startPt.z);
      gantryGroup.rotation.y = startPt.angleY;

      // Start line white/checkered strip
      const startStrip = new THREE.Mesh(
        new THREE.BoxGeometry(trackWidth + 0.4, 0.08, 1.4),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      startStrip.position.y = 0.09;
      gantryGroup.add(startStrip);

      // Gantry pillars & bridge
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.7, roughness: 0.3 });
      const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6.5, 0.6), pillarMat);
      leftPillar.position.set(-(trackWidth * 0.5 + 1.6), 3.25, 0);
      leftPillar.castShadow = true;
      gantryGroup.add(leftPillar);

      const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6.5, 0.6), pillarMat);
      rightPillar.position.set(trackWidth * 0.5 + 1.6, 3.25, 0);
      rightPillar.castShadow = true;
      gantryGroup.add(rightPillar);

      const crossBeam = new THREE.Mesh(
        new THREE.BoxGeometry(trackWidth + 4.2, 1.1, 0.8),
        new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.35 })
      );
      crossBeam.position.set(0, 6.2, 0);
      crossBeam.castShadow = true;
      gantryGroup.add(crossBeam);

      // 5 Start Lights on the gantry
      for (let li = -2; li <= 2; li++) {
        const lightPod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.28, 0.2, 16),
          new THREE.MeshBasicMaterial({ color: 0xff1e00 })
        );
        lightPod.rotation.x = Math.PI / 2;
        lightPod.position.set(li * 1.1, 5.45, 0.45);
        gantryGroup.add(lightPod);
      }

      // Pit building & Main Grandstand alongside the main straight
      const pitBuilding = new THREE.Mesh(
        new THREE.BoxGeometry(4.5, 4.2, 26),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.3 })
      );
      pitBuilding.position.set(-(trackWidth * 0.5 + 6.5), 2.1, -6);
      pitBuilding.castShadow = true;
      pitBuilding.receiveShadow = true;
      gantryGroup.add(pitBuilding);

      const pitRoof = new THREE.Mesh(
        new THREE.BoxGeometry(5.5, 0.4, 27),
        new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.3 })
      );
      pitRoof.position.set(-(trackWidth * 0.5 + 6.5), 4.3, -6);
      gantryGroup.add(pitRoof);

      const grandstand = new THREE.Mesh(
        new THREE.BoxGeometry(5.5, 5.0, 28),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
      );
      grandstand.position.set(trackWidth * 0.5 + 7.5, 2.5, -6);
      grandstand.castShadow = true;
      gantryGroup.add(grandstand);

      this.trackGroup.add(gantryGroup);

      // Add trees, floodlights, and corner grandstands around the circuit
      const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 });
      const treeCrownMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x064e3b : 0x15803d, roughness: 0.8 });
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });
      const bulbMat = new THREE.MeshBasicMaterial({ color: isNight ? 0xfef08a : 0xe2e8f0 });

      for (let i = 15; i < n - 15; i += 14) {
        const pt = spline[i];
        const side = (i % 28 === 0) ? 1 : -1;
        const dist = 13 + (i % 7) * 2.5;
        const tx = pt.x + pt.nx * side * dist;
        const tz = pt.z + pt.nz * side * dist;

        if (isNight || i % 42 === 0) {
          // Stadium floodlight tower
          const tower = new THREE.Group();
          tower.position.set(tx, pt.y, tz);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 11, 8), poleMat);
          pole.position.y = 5.5;
          tower.add(pole);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.8), bulbMat);
          lamp.position.y = 11.1;
          tower.add(lamp);
          this.trackGroup.add(tower);
        } else {
          // Low-poly stylized F1 circuit tree
          const tree = new THREE.Group();
          tree.position.set(tx, pt.y, tz);
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.0, 7), treeTrunkMat);
          trunk.position.y = 1.0;
          tree.add(trunk);
          const crown = new THREE.Mesh(new THREE.ConeGeometry(1.8, 4.2, 8), treeCrownMat);
          crown.position.y = 3.4;
          crown.castShadow = true;
          tree.add(crown);
          this.trackGroup.add(tree);
        }
      }

      // Rain particle system
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
     * Builds a realistic, detailed 3D Formula 1 car mesh for a driver
     */
    _createF1CarMesh(driverId) {
      const drv = window.F1Tracks.DRIVERS.find(d => d.id === driverId) || window.F1Tracks.DRIVERS[0];
      const team = window.F1Tracks.TEAMS[drv.team] || window.F1Tracks.TEAMS.RBR;

      const root = new THREE.Group();
      const carScale = 1.05;
      root.scale.set(carScale, carScale, carScale);

      const primaryMat = new THREE.MeshStandardMaterial({
        color: team.body || team.color,
        roughness: 0.25,
        metalness: 0.55
      });
      const accentMat = new THREE.MeshStandardMaterial({
        color: team.color,
        roughness: 0.22,
        metalness: 0.45
      });
      const wingMat = new THREE.MeshStandardMaterial({
        color: team.wing || 0x111111,
        roughness: 0.35,
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

      // 1. Carbon Underfloor & Diffuser
      const floor = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.1, 4.1), carbonMat);
      floor.position.set(0, 0.16, -0.1);
      floor.castShadow = true;
      root.add(floor);

      // 2. Main Monocoque Chassis
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.46, 2.3), primaryMat);
      chassis.position.set(0, 0.38, -0.15);
      chassis.castShadow = true;
      root.add(chassis);

      // 3. Sculpted Nosecone (tapered towards front wing)
      const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.36, 1.45, 8), accentMat);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 0.29, 1.55);
      nose.castShadow = true;
      root.add(nose);

      // 4. Aerodynamic Sidepods (Left & Right)
      const sidepodGeo = new THREE.BoxGeometry(0.46, 0.36, 1.65);
      const leftPod = new THREE.Mesh(sidepodGeo, accentMat);
      leftPod.position.set(-0.56, 0.35, -0.2);
      leftPod.castShadow = true;
      root.add(leftPod);

      const rightPod = new THREE.Mesh(sidepodGeo, accentMat);
      rightPod.position.set(0.56, 0.35, -0.2);
      rightPod.castShadow = true;
      root.add(rightPod);

      // 5. Engine Cover & Airbox / Shark Fin
      const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.38, 1.35), primaryMat);
      airbox.position.set(0, 0.68, -0.58);
      airbox.castShadow = true;
      root.add(airbox);

      const sharkFin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 1.15), accentMat);
      sharkFin.position.set(0, 0.78, -1.05);
      root.add(sharkFin);

      // 6. Cockpit & Driver Helmet + Titanium Halo
      const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.2, 0.75), carbonMat);
      cockpit.position.set(0, 0.56, 0.15);
      root.add(cockpit);

      const helmetMat = new THREE.MeshStandardMaterial({ color: drv.helmet || 0xffffff, roughness: 0.15, metalness: 0.3 });
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 14), helmetMat);
      helmet.position.set(0, 0.72, 0.1);
      root.add(helmet);

      // Halo bar
      const haloArch = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.038, 8, 18, Math.PI), carbonMat);
      haloArch.rotation.x = Math.PI / 2;
      haloArch.position.set(0, 0.77, 0.12);
      root.add(haloArch);

      const haloPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8), carbonMat);
      haloPillar.rotation.x = -0.35;
      haloPillar.position.set(0, 0.68, 0.41);
      root.add(haloPillar);

      // 7. Multi-Element Front Wing + Endplates
      const frontWingGroup = new THREE.Group();
      frontWingGroup.position.set(0, 0.18, 2.18);
      const fwMain = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.07, 0.42), wingMat);
      frontWingGroup.add(fwMain);
      const fwFlap = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.05, 0.25), accentMat);
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

      // 8. Rear Wing with DRS Flap & Glowing ERS Rain Tail Light
      const rearWingGroup = new THREE.Group();
      rearWingGroup.position.set(0, 0.78, -1.95);
      const rwMain = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.08, 0.38), wingMat);
      rearWingGroup.add(rwMain);
      const rwDrs = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.07, 0.24), accentMat);
      rwDrs.position.set(0, 0.14, -0.06);
      rearWingGroup.add(rwDrs);

      const rwEndGeo = new THREE.BoxGeometry(0.06, 0.56, 0.46);
      const rwEndL = new THREE.Mesh(rwEndGeo, primaryMat);
      rwEndL.position.set(-0.72, -0.1, 0);
      rearWingGroup.add(rwEndL);
      const rwEndR = new THREE.Mesh(rwEndGeo, primaryMat);
      rwEndR.position.set(0.72, -0.1, 0);
      rearWingGroup.add(rwEndR);

      const tailLight = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.18, 0.08),
        new THREE.MeshBasicMaterial({ color: 0xff1e00 })
      );
      tailLight.position.set(0, -0.42, -0.18);
      rearWingGroup.add(tailLight);
      root.add(rearWingGroup);

      // 9. Four Detailed 3D Wheels + Coloured Pirelli Sidewall Compound Rings
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

        // Pirelli sidewall compound color ring on outside face
        const ringMat = new THREE.MeshBasicMaterial({ color: TYRE_COLORS.S, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.62, radius * 0.84, 20), ringMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = wo.x < 0 ? -(width * 0.5 + 0.01) : (width * 0.5 + 0.01);
        wGroup.add(ring);
        tyreRings.push(ringMat);

        // Suspension wishbone strut
        const strut = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(wo.x), 0.05, 0.08), carbonMat);
        strut.position.x = wo.x < 0 ? Math.abs(wo.x) * 0.5 : -Math.abs(wo.x) * 0.5;
        wGroup.add(strut);

        root.add(wGroup);
        wheels.push(wGroup);
      });

      // 10. Visual Selection Highlight Halo Ring & Overhead Beacon (visible when selected)
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

      // Ensure HTML overlay labels exist for every driver in the race
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

    _getDriverVisualProgress(race, id, rankIndex, nowMs) {
      const d = race.drv && race.drv[id];
      if (!d) return { progress: 0, lateral: 0, speedRatio: 0 };

      if (!race.started || race.lap === 0 && !race.running) {
        // Starting grid formation before lights out
        const gridBack = -0.012 - rankIndex * 0.011;
        const gridSide = (rankIndex % 2 === 0 ? -1 : 1) * 1.35;
        return { progress: gridBack, lateral: gridSide, speedRatio: 0 };
      }

      if (d.st === 'dnf') {
        return {
          progress: (d.dnfTrackPos !== undefined ? d.dnfTrackPos : ((d.lapsDone * 0.23 + rankIndex * 0.05) % 1)),
          lateral: 3.6,
          speedRatio: 0
        };
      }

      // Continuous lap progress based on authoritative race.lapProgress (0..1 over 30s per lap)
      let baseLapProg = race.lapProgress || 0;
      if (race.running && race.lastTickTs) {
        const elapsedSinceTick = Math.max(0, Math.min(2000, Date.now() - race.lastTickTs));
        const lapDur = race.lapDurationMs || 30000;
        baseLapProg = Math.min(0.999, baseLapProg + elapsedSinceTick / lapDur);
      }

      // Compute individual car progress along the circuit so leader is ahead and gaps are visually proportional
      const leadId = race.order[0];
      const leadDrv = race.drv[leadId];
      const gapSeconds = leadDrv ? Math.max(0, (d.t || 0) - (leadDrv.t || 0)) : rankIndex * 0.8;
      // Convert gap seconds into track fraction (approx 30s full lap visually scaled so all cars stay visible and spread naturally)
      const gapFraction = Math.min(0.88, gapSeconds * 0.012 + rankIndex * 0.014);

      const prevRank = d.prevRank !== undefined ? d.prevRank : rankIndex;
      const prevGapFraction = Math.min(0.88, (d.prevGapSec !== undefined ? d.prevGapSec : gapSeconds) * 0.012 + prevRank * 0.014);
      const interpGap = prevGapFraction + (gapFraction - prevGapFraction) * baseLapProg;

      const totalCompletedLaps = Math.max(0, race.lap - (race.running ? 1 : 0));
      const rawProgress = totalCompletedLaps + baseLapProg - interpGap;

      // Lateral racing line + smooth overtaking weave when changing positions
      let lateral = Math.sin(rawProgress * Math.PI * 4 + rankIndex * 1.7) * 0.65;
      if (prevRank !== rankIndex && race.running) {
        const overtakeWeave = Math.sin(baseLapProg * Math.PI) * (rankIndex < prevRank ? -1.55 : 1.55);
        lateral += overtakeWeave;
      }
      if (d.pitLap === race.lap && baseLapProg < 0.22) {
        lateral = -3.2; // Pit lane entry/exit
      }

      return {
        progress: rawProgress,
        lateral,
        speedRatio: race.running ? (race.sc && race.sc.type ? 0.55 : 1.0) : 0
      };
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

      const w = this.canvasWrap.clientWidth || 860;
      const h = this.canvasWrap.clientHeight || 500;

      // Update weather particles
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

      // Update every 3D car position, orientation, wheel spin & selection highlight
      let chaseTargetSample = null;
      const focusId = this.selectedDriver && race.order.includes(this.selectedDriver)
        ? this.selectedDriver
        : race.order[0];

      race.order.forEach((id, idx) => {
        const entry = this.carMeshes.get(id);
        const drvState = race.drv ? race.drv[id] : null;
        if (!entry || !drvState) return;

        const vis = this._getDriverVisualProgress(race, id, idx, nowMs);
        const sample = window.F1Tracks.sampleTrack(race.circuit.id, vis.progress, vis.lateral);

        entry.group.position.set(sample.x, sample.y, sample.z);
        // Smooth yaw orientation along track tangent + slight slip angle in corners
        const steerAngle = Math.max(-0.35, Math.min(0.35, sample.curvature * 1.4));
        entry.group.rotation.set(0, sample.angleY, 0);

        // Update tyre compound color ring if changed
        const curTyre = drvState.tyre || 'S';
        if (entry.lastTyre !== curTyre) {
          entry.lastTyre = curTyre;
          const col = TYRE_COLORS[curTyre] || TYRE_COLORS.S;
          entry.tyreRings.forEach(rm => rm.color.setHex(col));
        }

        // Spin wheels & turn front wheels into corners
        if (vis.speedRatio > 0) {
          entry.wheels.forEach((wg, wi) => {
            wg.children[0].rotation.x += dt * 18 * vis.speedRatio;
            if (wi < 2) {
              wg.rotation.y = steerAngle;
            }
          });
        }

        // Highlight selected driver
        const isSel = (this.selectedDriver === id);
        entry.highlightRing.visible = isSel;
        entry.beacon.visible = isSel;
        if (isSel) {
          const pulse = 1 + Math.sin(nowMs * 0.008) * 0.15;
          entry.highlightRing.scale.set(pulse, pulse, 1);
          entry.beacon.position.y = 2.5 + Math.sin(nowMs * 0.008) * 0.35;
          entry.beacon.rotation.y += dt * 3.5;
        }

        // Dim DNF cars
        entry.group.visible = true;

        if (id === focusId) {
          chaseTargetSample = sample;
        }
      });

      // Update 3D Camera Position & Target
      if (this.cameraMode === 'chase' && chaseTargetSample) {
        const backDist = 14.5;
        const heightOffset = 6.2;
        const targetCamX = chaseTargetSample.x - chaseTargetSample.tx * backDist;
        const targetCamY = chaseTargetSample.y + heightOffset;
        const targetCamZ = chaseTargetSample.z - chaseTargetSample.tz * backDist;

        this.camera.position.lerp(new THREE.Vector3(targetCamX, targetCamY, targetCamZ), 0.12);
        const lookX = chaseTargetSample.x + chaseTargetSample.tx * 12;
        const lookY = chaseTargetSample.y + 1.2;
        const lookZ = chaseTargetSample.z + chaseTargetSample.tz * 12;
        this.camera.lookAt(lookX, lookY, lookZ);
      } else {
        if (this.cameraMode === 'heli' && !this.isDragging) {
          this.orbitAngle += dt * 0.14;
        }
        const cx = Math.sin(this.orbitAngle) * Math.cos(this.orbitPitch) * this.orbitDist;
        const cy = Math.sin(this.orbitPitch) * this.orbitDist;
        const cz = Math.cos(this.orbitAngle) * Math.cos(this.orbitPitch) * this.orbitDist;
        this.camera.position.set(cx, Math.max(15, cy), cz);
        this.camera.lookAt(0, 0, 0);
      }

      this.renderer.render(this.scene, this.camera);

      // Project 3D positions to 2D floating HUD tags
      race.order.forEach((id, idx) => {
        const entry = this.carMeshes.get(id);
        const labelEl = this.labelEls.get(id);
        const drvState = race.drv ? race.drv[id] : null;
        if (!entry || !labelEl || !drvState) return;

        const worldPos = entry.group.position.clone();
        worldPos.y += (this.selectedDriver === id ? 3.5 : 2.1);
        worldPos.project(this.camera);

        if (worldPos.z > 1) {
          labelEl.style.display = 'none';
          return;
        }

        const sx = (worldPos.x * 0.5 + 0.5) * w;
        const sy = (-(worldPos.y * 0.5) + 0.5) * h;

        labelEl.style.display = 'flex';
        labelEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
        labelEl.classList.toggle('selected', this.selectedDriver === id);
        labelEl.classList.toggle('is-dnf', drvState.st === 'dnf');
        labelEl.style.zIndex = this.selectedDriver === id ? '30' : String(25 - idx);

        const posSpan = labelEl.querySelector('.c-pos');
        if (posSpan) posSpan.textContent = drvState.st === 'dnf' ? 'OUT' : String(idx + 1);
      });
    }

    _renderFallback25D(race, nowMs) {
      const ctx = this.fallbackCtx;
      const canvas = this.fallbackCanvas;
      if (!ctx || !canvas) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background
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

      // Draw kerbs & asphalt
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

      // Cars & labels
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
