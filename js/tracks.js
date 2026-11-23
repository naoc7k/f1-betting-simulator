/**
 * F1 Betting Simulator - Real-World Circuits, Teams, Drivers & Avatars
 * Accurate recognizable track layouts with 3D elevation & Catmull-Rom spline sampler.
 */
(function () {
  const TEAMS = {
    RBR: { id: 'RBR', name: 'Red Bull Racing', color: '#3671c6', accent: '#ff1e00', body: '#121f45', wing: '#fbbf24' },
    FER: { id: 'FER', name: 'Scuderia Ferrari', color: '#e8002d', accent: '#fff200', body: '#c4001a', wing: '#111111' },
    MER: { id: 'MER', name: 'Mercedes-AMG', color: '#27f4d2', accent: '#00a19c', body: '#1c2329', wing: '#27f4d2' },
    MCL: { id: 'MCL', name: 'McLaren F1', color: '#ff8000', accent: '#47c7fc', body: '#ff7300', wing: '#181a20' },
    AST: { id: 'AST', name: 'Aston Martin', color: '#229971', accent: '#cedc00', body: '#00594f', wing: '#cedc00' },
    ALP: { id: 'ALP', name: 'Alpine F1', color: '#ff87bc', accent: '#0093cc', body: '#005ba9', wing: '#ff87bc' },
    WIL: { id: 'WIL', name: 'Williams Racing', color: '#64c4ff', accent: '#005aff', body: '#003278', wing: '#64c4ff' },
    HAA: { id: 'HAA', name: 'Haas F1 Team', color: '#b6babd', accent: '#e6002b', body: '#24272c', wing: '#e6002b' },
    SAU: { id: 'SAU', name: 'Kick Sauber', color: '#52e252', accent: '#00e701', body: '#141915', wing: '#00e701' },
    RB:  { id: 'RB',  name: 'Racing Bulls', color: '#6692ff', accent: '#ffffff', body: '#1c39bb', wing: '#e10600' }
  };

  const DRIVERS = [
    { id: 'VER', name: 'Max Verstappen',    team: 'RBR', num: 1,  skill: -0.32, ov: 0.92, helmet: '#ff4500' },
    { id: 'LAW', name: 'Liam Lawson',       team: 'RBR', num: 30, skill:  0.04, ov: 0.78, helmet: '#ffffff' },
    { id: 'LEC', name: 'Charles Leclerc',   team: 'FER', num: 16, skill: -0.18, ov: 0.89, helmet: '#ff1801' },
    { id: 'HAM', name: 'Lewis Hamilton',    team: 'FER', num: 44, skill: -0.17, ov: 0.90, helmet: '#f5d000' },
    { id: 'RUS', name: 'George Russell',    team: 'MER', num: 63, skill: -0.12, ov: 0.85, helmet: '#00d2be' },
    { id: 'ANT', name: 'Kimi Antonelli',    team: 'MER', num: 12, skill: -0.01, ov: 0.82, helmet: '#39ff14' },
    { id: 'NOR', name: 'Lando Norris',      team: 'MCL', num: 4,  skill: -0.20, ov: 0.88, helmet: '#ccff00' },
    { id: 'PIA', name: 'Oscar Piastri',     team: 'MCL', num: 81, skill: -0.16, ov: 0.87, helmet: '#ff5500' },
    { id: 'ALO', name: 'Fernando Alonso',   team: 'AST', num: 14, skill: -0.14, ov: 0.89, helmet: '#00bfff' },
    { id: 'STR', name: 'Lance Stroll',      team: 'AST', num: 18, skill:  0.09, ov: 0.72, helmet: '#006644' },
    { id: 'GAS', name: 'Pierre Gasly',      team: 'ALP', num: 10, skill: -0.03, ov: 0.81, helmet: '#ff66b2' },
    { id: 'COL', name: 'Franco Colapinto',  team: 'ALP', num: 43, skill:  0.08, ov: 0.77, helmet: '#74acdf' },
    { id: 'ALB', name: 'Alex Albon',        team: 'WIL', num: 23, skill: -0.04, ov: 0.82, helmet: '#ff3366' },
    { id: 'SAI', name: 'Carlos Sainz',      team: 'WIL', num: 55, skill: -0.09, ov: 0.85, helmet: '#ffcc00' },
    { id: 'OCO', name: 'Esteban Ocon',      team: 'HAA', num: 31, skill:  0.02, ov: 0.79, helmet: '#e6002b' },
    { id: 'BEA', name: 'Oliver Bearman',    team: 'HAA', num: 87, skill:  0.06, ov: 0.78, helmet: '#4aa3ff' },
    { id: 'HUL', name: 'Nico Hülkenberg',   team: 'SAU', num: 27, skill: -0.01, ov: 0.80, helmet: '#52e252' },
    { id: 'BOR', name: 'Gabriel Bortoleto', team: 'SAU', num: 5,  skill:  0.05, ov: 0.81, helmet: '#009c3b' },
    { id: 'TSU', name: 'Yuki Tsunoda',      team: 'RB',  num: 22, skill:  0.01, ov: 0.80, helmet: '#ff6b35' },
    { id: 'HAD', name: 'Isack Hadjar',      team: 'RB',  num: 6,  skill:  0.07, ov: 0.77, helmet: '#6692ff' }
  ];

  const TEAM_PACE = {
    RBR: 0.0,
    MCL: -0.06,
    FER: 0.08,
    MER: 0.16,
    AST: 0.55,
    WIL: 0.50,
    RB:  0.58,
    ALP: 0.72,
    HAA: 0.75,
    SAU: 0.85
  };

  const AVATARS = [
    { id: 'av1', icon: '🏎️', label: 'Piloto F1',     color: '#e10600' },
    { id: 'av2', icon: '🏆', label: 'Campeão',       color: '#ffc83d' },
    { id: 'av3', icon: '⚡', label: 'Relâmpago',     color: '#ff8000' },
    { id: 'av4', icon: '🔥', label: 'Turbo Flame',   color: '#ff3b30' },
    { id: 'av5', icon: '🦅', label: 'Águia Apex',    color: '#3671c6' },
    { id: 'av6', icon: '🦈', label: 'Tubarão',       color: '#27f4d2' },
    { id: 'av7', icon: '🦁', label: 'Leão do Grid',  color: '#f59e0b' },
    { id: 'av8', icon: '🐺', label: 'Lobo Noturno',  color: '#a855f7' },
    { id: 'av9', icon: '🎯', label: 'Sniper Apex',   color: '#2ecc71' },
    { id: 'av10', icon: '💎', label: 'VIP Diamond',  color: '#38bdf8' },
    { id: 'av11', icon: '🚀', label: 'Rocket DRS',   color: '#ec4899' },
    { id: 'av12', icon: '👑', label: 'Rei da Pista', color: '#eab308' }
  ];

  /**
   * 10 Real-World F1 Circuits with faithful geometric control points [x, z, y(elevation)]
   * Coordinates in [-100..100] world space.
   */
  const CIRCUITS = [
    {
      id: 'int',
      name: 'Interlagos',
      fullName: 'Autódromo José Carlos Pace',
      c: 'Brasil',
      flag: '🇧🇷',
      laps: 15,
      realLaps: 71,
      km: 4.309,
      ot: 0.52,
      rn: 0.06,
      cr: 0.0014,
      pl: 20,
      theme: 'day',
      groundColor: '#132417',
      desc: 'S do Senna, Reta Oposta e Subida dos Boxes com desnível clássico.',
      // Faithful Interlagos outline: main straight -> Senna S -> Curva do Sol -> Reta Oposta -> Descida do Lago -> Infield (Ferradura/Laranjinha/Pinheirinho/Bico de Pato) -> Junção -> Subida
      pts: [
        [62, -45, 4], [25, -52, 5], [-25, -58, 6], [-62, -55, 5], // Main straight
        [-75, -45, 3], [-66, -32, 1], [-74, -20, 0], // S do Senna
        [-84, 5, 0], [-76, 32, 0], [-48, 48, 1], // Curva do Sol
        [5, 52, 1], [58, 50, 2], [78, 38, 0], // Reta Oposta -> Descida do Lago
        [72, 14, 1], [42, 10, 2], [10, 18, 3], [-25, 25, 3], // Ferradura & Laranjinha
        [-42, 12, 2], [-28, -5, 2], [2, -8, 3], [28, 4, 2], // Pinheirinho
        [45, -10, 1], [22, -24, 1], [-18, -26, 0], // Bico de Pato & Mergulho
        [-38, -36, 0], [5, -40, 2], [42, -42, 3] // Junção -> Subida dos Boxes
      ]
    },
    {
      id: 'mon',
      name: 'Mônaco',
      fullName: 'Circuit de Monaco',
      c: 'Mônaco',
      flag: '🇲🇨',
      laps: 15,
      realLaps: 78,
      km: 3.337,
      ot: 0.16,
      rn: 0.02,
      cr: 0.0022,
      pl: 19,
      theme: 'harbor',
      groundColor: '#131d29',
      desc: 'Circuito de rua estreito com Fairmont Hairpin, Túnel e Piscina.',
      pts: [
        [-40, 15, 1], [-65, -10, 1], [-72, -32, 2], // Sainte Devote
        [-45, -45, 5], [-10, -55, 8], [18, -56, 9], // Beau Rivage -> Massenet -> Casino
        [32, -40, 7], [22, -26, 5], [40, -18, 3], [20, -8, 2], // Mirabeau -> Fairmont Hairpin
        [48, -4, 1], [72, 8, 1], [82, 26, 0], [55, 34, 0], // Portier -> Tunnel
        [25, 32, 0], [12, 40, 0], [-5, 36, 0], // Nouvelle Chicane -> Tabac
        [-24, 42, 0], [-38, 36, 0], [-52, 42, 0], // Piscina (Swimming Pool)
        [-64, 34, 0], [-54, 22, 1] // Rascasse -> Antony Noghès
      ]
    },
    {
      id: 'sil',
      name: 'Silverstone',
      fullName: 'Silverstone Circuit',
      c: 'Reino Unido',
      flag: '🇬🇧',
      laps: 15,
      realLaps: 52,
      km: 5.891,
      ot: 0.56,
      rn: 0.05,
      cr: 0.0012,
      pl: 21,
      theme: 'day',
      groundColor: '#142416',
      desc: 'Curvas de alta velocidade: Copse, Maggotts, Becketts e Hangar Straight.',
      pts: [
        [-35, 42, 1], [-10, 52, 1], [15, 48, 1], // Hamilton Straight -> Abbey
        [28, 30, 1], [12, 15, 1], [-5, 22, 1], [-22, 12, 1], // Village & The Loop
        [-48, -5, 1], [-68, -22, 1], [-80, -10, 1], [-65, 10, 1], // Wellington Straight -> Brooklands -> Luffield
        [-50, -35, 1], [-30, -58, 2], [5, -60, 2], // Woodcote -> Copse
        [25, -45, 2], [35, -30, 2], [52, -22, 2], [65, -8, 2], // Maggotts & Becketts & Chapel
        [78, 25, 1], [72, 52, 1], // Hangar Straight -> Stowe
        [42, 55, 1], [28, 42, 1], [5, 46, 1] // Vale -> Club
      ]
    },
    {
      id: 'mza',
      name: 'Monza',
      fullName: 'Autodromo Nazionale Monza',
      c: 'Itália',
      flag: '🇮🇹',
      laps: 15,
      realLaps: 53,
      km: 5.793,
      ot: 0.68,
      rn: 0.02,
      cr: 0.0012,
      pl: 23,
      theme: 'day',
      groundColor: '#152617',
      desc: 'O Templo da Velocidade: longas retas, Variante Ascari e Parabólica.',
      pts: [
        [-75, 32, 1], [-20, 34, 1], [35, 35, 1], [68, 33, 1], // Main Straight
        [75, 26, 1], [72, 18, 1], // Variante del Rettifilo
        [82, -10, 2], [70, -38, 2], [40, -48, 3], // Curva Grande -> Roggia
        [32, -42, 3], [15, -55, 4], [-10, -58, 4], [-25, -42, 3], // Lesmo 1 & 2
        [-30, -12, 2], [-38, 12, 1], // Serraglio
        [-48, 8, 1], [-58, 16, 1], [-72, 12, 1], // Variante Ascari
        [-84, 14, 1], [-90, 24, 1], [-85, 31, 1] // Retta Centrale -> Parabolica
      ]
    },
    {
      id: 'spa',
      name: 'Spa-Francorchamps',
      fullName: 'Circuit de Spa-Francorchamps',
      c: 'Bélgica',
      flag: '🇧🇪',
      laps: 15,
      realLaps: 44,
      km: 7.004,
      ot: 0.58,
      rn: 0.08,
      cr: 0.0015,
      pl: 19,
      theme: 'forest',
      groundColor: '#0f2114',
      desc: 'Lendária subida da Eau Rouge / Raidillon, Kemmel Straight e Pouhon.',
      pts: [
        [-55, -25, 1], [-78, -38, 1], [-82, -24, 0], // Main straight -> La Source Hairpin
        [-62, -10, 0], [-48, 4, 3], [-38, 16, 8], // Eau Rouge & Raidillon Climb!
        [10, 48, 9], [58, 56, 9], [76, 46, 8], // Kemmel Straight -> Les Combes
        [68, 26, 7], [48, 20, 6], [56, 4, 5], // Malmedy -> Rivage / Bruxelles
        [30, -10, 4], [12, -26, 3], [32, -44, 2], // Pouhon double-apex
        [62, -46, 2], [75, -30, 1], [45, -18, 1], // Campus / Stavelot
        [5, -20, 1], [-25, -22, 1], [-42, -30, 1], [-48, -22, 1] // Blanchimont -> Bus Stop Chicane
      ]
    },
    {
      id: 'suz',
      name: 'Suzuka',
      fullName: 'Suzuka International Racing Course',
      c: 'Japão',
      flag: '🇯🇵',
      laps: 15,
      realLaps: 53,
      km: 5.807,
      ot: 0.38,
      rn: 0.04,
      cr: 0.0015,
      pl: 22,
      theme: 'day',
      groundColor: '#142418',
      desc: 'Traçado único em formato de 8 com S-Curves, Spoon e 130R.',
      pts: [
        [-45, -35, 1], [-78, -32, 1], [-84, -12, 2], // First Curve
        [-65, 5, 3], [-52, -8, 3], [-38, 12, 4], [-22, -2, 4], // S-Curves -> Dunlop
        [0, 18, 3], [14, 32, 1], [6, 10, 0], // Degner 1 & 2 (underpass)
        [-10, -14, 0], [-24, -22, 0], [-8, -28, 1], // Hairpin
        [25, -22, 2], [65, -26, 3], [84, -12, 3], [76, 12, 3], // 200R -> Spoon Curve
        [40, 14, 5], [4, 6, 6], [-18, -12, 4], // Back straight OVERPASS bridge -> 130R
        [-28, -36, 2], [-36, -30, 1] // Casio Triangle Chicane
      ]
    },
    {
      id: 'nur',
      name: 'Nürburgring',
      fullName: 'Nürburgring GP-Strecke',
      c: 'Alemanha',
      flag: '🇩🇪',
      laps: 15,
      realLaps: 60,
      km: 5.148,
      ot: 0.50,
      rn: 0.06,
      cr: 0.0013,
      pl: 21,
      theme: 'forest',
      groundColor: '#112215',
      desc: 'Mercedes Arena, grampo Dunlop-Kehre, Schumacher-S e chicane Veedol.',
      pts: [
        [-50, 30, 2], [-78, 35, 1], [-80, 15, 1], [-58, 12, 2], [-66, -2, 2], // Mercedes Arena
        [-45, -18, 1], [-10, -42, 0], [35, -55, 0], [68, -50, 0], // Descent to Dunlop-Kehre
        [75, -34, 1], [45, -24, 2], [25, -10, 3], [12, -22, 4], // Schumacher-S
        [-5, -10, 4], [15, 12, 5], [45, 25, 4], [62, 14, 3], // Bit-Kurve -> Back stretch
        [35, 36, 3], [5, 32, 3], [-8, 40, 2], [-25, 32, 2] // Veedol Chicane -> Coca-Cola Kurve
      ]
    },
    {
      id: 'yas',
      name: 'Yas Marina',
      fullName: 'Yas Marina Circuit',
      c: 'Abu Dhabi',
      flag: '🇦🇪',
      laps: 15,
      realLaps: 58,
      km: 5.281,
      ot: 0.50,
      rn: 0.005,
      cr: 0.0011,
      pl: 21,
      theme: 'night',
      groundColor: '#0e131f',
      desc: 'Corrida noturna iluminada com grampo norte, longa reta da Marina e Hotel.',
      pts: [
        [-25, 42, 1], [-58, 40, 1], [-68, 22, 1], [-55, 4, 2], // Main Straight -> Turn 1-3
        [-72, -25, 2], [-84, -44, 1], [-72, -52, 1], // North Hairpin
        [-20, -45, 1], [45, -38, 1], [82, -32, 1], // Long Back Straight
        [78, -18, 1], [85, -5, 1], [68, 15, 1], // Chicane & Marsa Corner
        [40, 12, 1], [35, 32, 1], [15, 35, 1], // Marina & W Hotel section
        [10, 18, 1], [-10, 20, 1], [-8, 40, 1] // Final corners
      ]
    },
    {
      id: 'rbr',
      name: 'Red Bull Ring',
      fullName: 'Red Bull Ring Spielberg',
      c: 'Áustria',
      flag: '🇦🇹',
      laps: 15,
      realLaps: 71,
      km: 4.318,
      ot: 0.62,
      rn: 0.05,
      cr: 0.0013,
      pl: 20,
      theme: 'day',
      groundColor: '#152817',
      desc: 'Três zonas de DRS nas montanhas da Estíria com curvas rápidas.',
      pts: [
        [-65, 35, 1], [-75, -15, 4], [-72, -45, 6], // Start -> Niki Lauda Kurve
        [-20, -55, 8], [35, -58, 9], [48, -46, 9], // Climb to Remus Hairpin
        [20, -25, 6], [-10, -15, 5], [-25, 5, 4], // Rauch -> Infield
        [5, 15, 3], [35, 5, 4], [68, -10, 4], // Rindt curve
        [75, 20, 2], [55, 38, 1], [0, 38, 1] // Red Bull Mobile -> Main Straight
      ]
    },
    {
      id: 'can',
      name: 'Montreal',
      fullName: 'Circuit Gilles Villeneuve',
      c: 'Canadá',
      flag: '🇨🇦',
      laps: 15,
      realLaps: 70,
      km: 4.361,
      ot: 0.58,
      rn: 0.05,
      cr: 0.0018,
      pl: 20,
      theme: 'day',
      groundColor: '#13221c',
      desc: 'Ilha de Notre-Dame com o famoso grampo L’Épingle e o Muro dos Campeões.',
      pts: [
        [-50, 22, 1], [-78, 18, 1], [-84, 5, 1], [-68, -8, 1], // Senna Virage
        [-40, -18, 1], [-15, -12, 1], [15, -24, 1], [45, -20, 1], // Chicane turns 3-7
        [72, -22, 1], [86, -8, 1], [78, 12, 1], // L'Epingle Hairpin
        [35, 16, 1], [-10, 20, 1], [-28, 26, 1], [-36, 20, 1] // Casino Straight -> Wall of Champions
      ]
    }
  ];

  // Add base lap calculation properties
  CIRCUITS.forEach(c => {
    c.bl = c.km * 16.5 + 4;
  });

  // Cache of sampled splines per circuit
  const SPLINE_CACHE = {};

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  function getSplinePoints(circuitId, numSamples = 400) {
    const key = circuitId + '_' + numSamples;
    if (SPLINE_CACHE[key]) return SPLINE_CACHE[key];
    const circuit = CIRCUITS.find(c => c.id === circuitId) || CIRCUITS[0];
    const pts = circuit.pts;
    const n = pts.length;
    const raw = [];

    for (let i = 0; i < numSamples; i++) {
      const u = (i / numSamples) * n;
      const seg = Math.floor(u) % n;
      const t = u - Math.floor(u);
      const p0 = pts[(seg - 1 + n) % n];
      const p1 = pts[seg];
      const p2 = pts[(seg + 1) % n];
      const p3 = pts[(seg + 2) % n];

      const x = catmullRom(p0[0], p1[0], p2[0], p3[0], t);
      const z = catmullRom(p0[1], p1[1], p2[1], p3[1], t);
      const y = catmullRom(p0[2] || 0, p1[2] || 0, p2[2] || 0, p3[2] || 0, t);
      raw.push({ x, y, z });
    }

    // Compute tangents, normals, and curvature
    for (let i = 0; i < numSamples; i++) {
      const prev = raw[(i - 1 + numSamples) % numSamples];
      const curr = raw[i];
      const next = raw[(i + 1) % numSamples];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      curr.tx = dx / len;
      curr.ty = dy / len;
      curr.tz = dz / len;
      // 2D XZ normal for track width & lateral car offset
      const lenXZ = Math.hypot(dx, dz) || 1;
      curr.nx = -dz / lenXZ;
      curr.nz = dx / lenXZ;
      curr.angleY = Math.atan2(dx, dz);
    }

    for (let i = 0; i < numSamples; i++) {
      const prev = raw[(i - 4 + numSamples) % numSamples];
      const next = raw[(i + 4) % numSamples];
      const curr = raw[i];
      let da = next.angleY - prev.angleY;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      curr.curvature = da;
    }

    SPLINE_CACHE[key] = raw;
    return raw;
  }

  function sampleTrack(circuitId, progress, lateralOffset = 0) {
    const pts = getSplinePoints(circuitId, 400);
    const n = pts.length;
    let p = progress % 1;
    if (p < 0) p += 1;
    const f = p * n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const t = f - Math.floor(f);
    const a = pts[i0];
    const b = pts[i1];

    const x = a.x + (b.x - a.x) * t + (a.nx + (b.nx - a.nx) * t) * lateralOffset;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t + (a.nz + (b.nz - a.nz) * t) * lateralOffset;

    const tx = a.tx + (b.tx - a.tx) * t;
    const ty = a.ty + (b.ty - a.ty) * t;
    const tz = a.tz + (b.tz - a.tz) * t;
    const angleY = Math.atan2(tx, tz);
    const curvature = a.curvature + (b.curvature - a.curvature) * t;

    return { x, y, z, tx, ty, tz, angleY, curvature };
  }

  window.F1Tracks = {
    TEAMS,
    DRIVERS,
    TEAM_PACE,
    AVATARS,
    CIRCUITS,
    getSplinePoints,
    sampleTrack
  };
})();
