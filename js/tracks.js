/**
 * F1 Betting Simulator - Real-World Circuits, Teams, Drivers & Avatars
 * Accurate recognizable track layouts with 3D elevation & Catmull-Rom spline sampler.
 */
(function () {
  const TEAMS = {
    // 1. Mercedes: Verde turquesa (Petronas), preto e prata
    MER: { id: 'MER', name: 'Mercedes',        color: '#00d2be', body: '#121519', sidepod: '#c0c6cf', accent: '#00d2be', wing: '#121519', trim: '#d8dee9', metalness: 0.72 },
    // 2. Ferrari: Vermelho, preto e detalhes amarelos
    FER: { id: 'FER', name: 'Ferrari',         color: '#e8002d', body: '#d4001c', sidepod: '#e8002d', accent: '#fff200', wing: '#111317', trim: '#fff200', metalness: 0.48 },
    // 3. McLaren: Laranja-papaia e preto
    MCL: { id: 'MCL', name: 'McLaren',         color: '#ff8000', body: '#ff8000', sidepod: '#14161b', accent: '#ff8000', wing: '#14161b', trim: '#ff8000', metalness: 0.45 },
    // 4. Red Bull Racing: Azul-marinho, vermelho e amarelo
    RBR: { id: 'RBR', name: 'Red Bull Racing', color: '#1b2b5a', body: '#0f1838', sidepod: '#16244f', accent: '#ff1e00', wing: '#0f1838', trim: '#ffd000', metalness: 0.50 },
    // 5. Alpine: Azul-ciano e rosa
    ALP: { id: 'ALP', name: 'Alpine',          color: '#0093cc', body: '#0077b6', sidepod: '#ff66b2', accent: '#ff66b2', wing: '#0093cc', trim: '#ff66b2', metalness: 0.55 },
    // 6. Racing Bulls: Azul-claro, branco e detalhes vermelhos
    RB:  { id: 'RB',  name: 'Racing Bulls',    color: '#4ea8ff', body: '#f4f6fb', sidepod: '#3b82f6', accent: '#e10600', wing: '#3b82f6', trim: '#e10600', metalness: 0.52 },
    // 7. Haas: Cinza-claro, branco, preto e vermelho
    HAA: { id: 'HAA', name: 'Haas',            color: '#d1d5db', body: '#f8fafc', sidepod: '#9ca3af', accent: '#e10600', wing: '#111318', trim: '#e10600', metalness: 0.48 },
    // 8. Audi: Cinza, preto e vermelho
    AUD: { id: 'AUD', name: 'Audi',            color: '#f50537', body: '#6b7280', sidepod: '#14161b', accent: '#f50537', wing: '#14161b', trim: '#f50537', metalness: 0.68 },
    // 9. Williams: Azul e preto
    WIL: { id: 'WIL', name: 'Williams',        color: '#005aff', body: '#0046cc', sidepod: '#10131a', accent: '#005aff', wing: '#10131a', trim: '#38bdf8', metalness: 0.55 },
    // 10. Aston Martin: Verde-britânico e detalhes em verde-limão
    AST: { id: 'AST', name: 'Aston Martin',    color: '#00665e', body: '#00594f', sidepod: '#004840', accent: '#cedc00', wing: '#00594f', trim: '#cedc00', metalness: 0.62 },
    // 11. Cadillac: Preto, branco e detalhes metálicos
    CAD: { id: 'CAD', name: 'Cadillac',        color: '#e2e8f0', body: '#111318', sidepod: '#f8fafc', accent: '#cbd5e1', wing: '#111318', trim: '#e2e8f0', metalness: 0.85 }
  };

  const DRIVERS = [
    // McLaren
    { id: 'NOR', name: 'Lando Norris',      flag: '🇬🇧', team: 'MCL', num: 4,  skill: -0.22, ov: 0.89, helmet: '#ccff00' },
    { id: 'PIA', name: 'Oscar Piastri',     flag: '🇦🇺', team: 'MCL', num: 81, skill: -0.18, ov: 0.88, helmet: '#ff5500' },
    // Mercedes
    { id: 'RUS', name: 'George Russell',    flag: '🇬🇧', team: 'MER', num: 63, skill: -0.15, ov: 0.86, helmet: '#00d2be' },
    { id: 'ANT', name: 'Kimi Antonelli',    flag: '🇮🇹', team: 'MER', num: 12, skill: -0.04, ov: 0.83, helmet: '#39ff14' },
    // Red Bull Racing
    { id: 'VER', name: 'Max Verstappen',    flag: '🇳🇱', team: 'RBR', num: 1,  skill: -0.32, ov: 0.92, helmet: '#ff4500' },
    { id: 'HAD', name: 'Isack Hadjar',      flag: '🇫🇷', team: 'RBR', num: 6,  skill:  0.03, ov: 0.80, helmet: '#6692ff' },
    // Ferrari
    { id: 'LEC', name: 'Charles Leclerc',   flag: '🇲🇨', team: 'FER', num: 16, skill: -0.19, ov: 0.89, helmet: '#ff1801' },
    { id: 'HAM', name: 'Lewis Hamilton',    flag: '🇬🇧', team: 'FER', num: 44, skill: -0.18, ov: 0.90, helmet: '#f5d000' },
    // Williams
    { id: 'SAI', name: 'Carlos Sainz',      flag: '🇪🇸', team: 'WIL', num: 55, skill: -0.10, ov: 0.85, helmet: '#ffcc00' },
    { id: 'ALB', name: 'Alexander Albon',   flag: '🇹🇭', team: 'WIL', num: 23, skill: -0.05, ov: 0.83, helmet: '#ff3366' },
    // Racing Bulls
    { id: 'LAW', name: 'Liam Lawson',       flag: '🇳🇿', team: 'RB',  num: 30, skill:  0.02, ov: 0.80, helmet: '#ffffff' },
    { id: 'LIN', name: 'Arvid Lindblad',    flag: '🇬🇧', team: 'RB',  num: 40, skill:  0.07, ov: 0.78, helmet: '#38bdf8' },
    // Aston Martin
    { id: 'ALO', name: 'Fernando Alonso',   flag: '🇪🇸', team: 'AST', num: 14, skill: -0.14, ov: 0.89, helmet: '#00bfff' },
    { id: 'STR', name: 'Lance Stroll',      flag: '🇨🇦', team: 'AST', num: 18, skill:  0.08, ov: 0.74, helmet: '#006644' },
    // Haas
    { id: 'CAM', name: 'Rafael Câmara',     flag: '🇧🇷', team: 'HAA', num: 88, skill:  0.03, ov: 0.81, helmet: '#009c3b' },
    { id: 'BEA', name: 'Oliver Bearman',    flag: '🇬🇧', team: 'HAA', num: 87, skill:  0.04, ov: 0.79, helmet: '#4aa3ff' },
    // Audi
    { id: 'HUL', name: 'Nico Hülkenberg',   flag: '🇩🇪', team: 'AUD', num: 27, skill: -0.02, ov: 0.81, helmet: '#f50537' },
    { id: 'BOR', name: 'Gabriel Bortoleto', flag: '🇧🇷', team: 'AUD', num: 5,  skill:  0.02, ov: 0.82, helmet: '#009c3b' },
    // Alpine
    { id: 'GAS', name: 'Pierre Gasly',      flag: '🇫🇷', team: 'ALP', num: 10, skill: -0.03, ov: 0.81, helmet: '#ff66b2' },
    { id: 'COL', name: 'Franco Colapinto',  flag: '🇦🇷', team: 'ALP', num: 43, skill:  0.05, ov: 0.79, helmet: '#74acdf' },
    // Cadillac
    { id: 'BOT', name: 'Valtteri Bottas',   flag: '🇫🇮', team: 'CAD', num: 77, skill: -0.02, ov: 0.81, helmet: '#3b82f6' },
    { id: 'PER', name: 'Sergio Pérez',      flag: '🇲🇽', team: 'CAD', num: 11, skill: -0.04, ov: 0.83, helmet: '#eab308' }
  ];

  const TEAM_PACE = {
    MCL: -0.06,
    RBR: 0.0,
    FER: 0.06,
    MER: 0.14,
    WIL: 0.45,
    AST: 0.52,
    RB:  0.56,
    AUD: 0.65,
    ALP: 0.68,
    HAA: 0.70,
    CAD: 0.72
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
      desc: 'S do Senna, Reta Oposta, Ferradura, Laranjinha, Bico de Pato e Subida dos Boxes.',
      // Traçado oficial de Interlagos fiel com 15 curvas reais
      pts: [
        [50, -48, 5], [20, -52, 6], [-20, -55, 6], [-55, -53, 5], // Reta dos Boxes (Ladeira abaixo)
        [-70, -42, 3], [-66, -30, 2], // Curva 1 & 2 (S do Senna)
        [-76, -18, 0], [-82, 0, 0], [-72, 22, 0], // Curva 3 (Curva do Sol)
        [-40, 38, 1], [0, 48, 1], [45, 52, 2], [72, 45, 1], // Reta Oposta
        [82, 30, 0], [70, 16, 0], // Curva 4 & 5 (Descida do Lago)
        [46, 12, 1], [22, 16, 2], [5, 20, 2], // Curva 6 & 7 (Ferradura)
        [-15, 22, 2], [-32, 16, 2], [-38, 5, 2], // Curva 8 (Laranjinha)
        [-24, -4, 2], [-4, -8, 2], [18, -4, 2], [32, 2, 2], // Curva 9 (Pinheirinho)
        [44, -8, 1], [30, -20, 1], // Curva 10 (Bico de Pato)
        [8, -25, 0], [-14, -28, 0], // Curva 11 (Mergulho)
        [-32, -34, 1], [-10, -39, 3], [22, -43, 4] // Curva 12 (Junção) -> Curva 13/14/15 (Subida dos Boxes)
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
      desc: 'Sainte-Dévote, Beau Rivage, Casino, Grampo Fairmont, Túnel e Piscina.',
      // Traçado oficial de Mônaco com curvas e grampos característicos
      pts: [
        [-42, 25, 1], [-62, 5, 1], [-70, -18, 2], // Sainte-Dévote (Curva 1)
        [-52, -38, 5], [-24, -54, 8], [8, -58, 9], [28, -54, 9], // Beau Rivage -> Massenet -> Casino (Curvas 2-4)
        [36, -42, 7], [26, -30, 5], // Mirabeau Haute (Curva 5)
        [38, -20, 3], [16, -12, 2], // Fairmont Hairpin (Grampo mais lento da F1 - Curva 6)
        [42, -5, 1], [68, 6, 1], [80, 22, 0], [60, 32, 0], // Mirabeau Bas -> Portier -> Entrada do Túnel (Curvas 7-8)
        [30, 34, 0], [14, 42, 0], [-2, 38, 0], // Saída do Túnel -> Nouvelle Chicane (Curvas 10-11)
        [-20, 42, 0], [-34, 38, 0], // Tabac (Curva 12)
        [-48, 44, 0], [-56, 38, 0], // Louis Chiron & Piscine (Curvas 13-16)
        [-65, 30, 0], [-52, 22, 1] // La Rascasse & Antony Noghès (Curvas 17-19)
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
      desc: 'Copse, complexo veloz Maggotts & Becketts, Hangar Straight e Stowe.',
      // Traçado oficial moderno de Silverstone
      pts: [
        [-30, 45, 1], [-5, 52, 1], [18, 48, 1], // Hamilton Straight -> Abbey (T1)
        [32, 34, 1], [18, 16, 1], [-2, 20, 1], [-20, 10, 1], // Farm -> Village -> The Loop -> Aintree (T2-T5)
        [-45, -5, 1], [-65, -20, 1], [-82, -12, 1], [-68, 8, 1], // Wellington Straight -> Brooklands -> Luffield (T6-T8)
        [-52, -32, 1], [-32, -56, 2], [5, -62, 2], // Woodcote -> Copse Corner (T9)
        [26, -48, 2], [36, -34, 2], [52, -22, 2], [66, -10, 2], // Maggotts, Becketts & Chapel (T10-T14)
        [78, 20, 1], [74, 50, 1], // Hangar Straight -> Stowe Corner (T15)
        [44, 56, 1], [28, 44, 1], [2, 48, 1] // Vale & Club (T16-T18)
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
      desc: 'O Templo da Velocidade: Variante del Rettifilo, Curva Grande, Lesmo, Ascari e Parabólica.',
      pts: [
        [-70, 32, 1], [-20, 34, 1], [35, 35, 1], [68, 33, 1], // Rettifilo Tribune
        [76, 25, 1], [70, 16, 1], // Prima Variante / Rettifilo Chicane
        [80, -12, 2], [68, -38, 2], [38, -48, 3], // Curva Grande (Curva Biassono)
        [30, -42, 3], [14, -56, 4], [-12, -58, 4], [-26, -42, 3], // Variante della Roggia & Curve di Lesmo 1 e 2
        [-32, -14, 2], [-40, 10, 1], // Curva del Serraglio
        [-50, 8, 1], [-60, 16, 1], [-72, 12, 1], // Variante Ascari
        [-84, 14, 1], [-90, 25, 1], [-84, 32, 1] // Curva Parabolica (Curva Alboreto)
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
      desc: 'La Source, lendária subida de Eau Rouge / Raidillon, Kemmel Straight e Pouhon.',
      pts: [
        [-52, -26, 1], [-76, -40, 1], [-82, -24, 0], // Reta principal -> Grampo La Source (T1)
        [-62, -10, 0], [-48, 4, 3], [-36, 18, 9], // Subida épica da Eau Rouge & Raidillon (T2-T4)
        [12, 48, 9], [60, 56, 9], [78, 46, 8], // Reta Kemmel -> Chicane Les Combes (T5-T6)
        [68, 24, 7], [48, 18, 6], [56, 4, 5], // Malmedy & Bruxelles (Rivage) (T7-T8)
        [30, -10, 4], [10, -28, 3], [32, -45, 2], // Speaker's Corner & Pouhon duplo ápice (T9-T11)
        [62, -46, 2], [76, -30, 1], [45, -18, 1], // Campus, Stavelot & Courbe Paul Frère (T12-T15)
        [4, -20, 1], [-26, -22, 1], [-44, -32, 1], [-48, -22, 1] // Blanchimont -> Chicane Bus Stop (T16-T19)
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
      desc: 'Traçado lendário em formato de 8 com as S-Curves, Spoon Curve e a temida 130R.',
      pts: [
        [-45, -35, 1], [-78, -32, 1], [-84, -12, 2], // Reta principal -> Curvas 1 & 2
        [-65, 5, 3], [-52, -8, 3], [-38, 12, 4], [-22, -2, 4], // Complexo das S-Curves -> Dunlop Curve (T3-T7)
        [0, 18, 3], [14, 32, 1], [6, 10, 0], // Degner 1 & 2 passando por baixo do viaduto (T8-T9)
        [-10, -14, 0], [-24, -22, 0], [-8, -28, 1], // Grampo Hairpin (T11)
        [25, -22, 2], [65, -26, 3], [84, -12, 3], [76, 12, 3], // Curva 200R -> Spoon Curve (T13-T14)
        [40, 14, 6], [4, 6, 6], [-18, -12, 4], // Reta de trás passando POR CIMA DO VIADUTO -> Curva 130R (T15)
        [-28, -36, 2], [-36, -30, 1] // Chicane Casio Triangle (T16-T18)
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
      desc: 'Mercedes Arena, descida para o grampo Dunlop-Kehre, Michael-Schumacher-S e chicane NGK/Veedol.',
      // Desenho exato e fiel ao circuito de GP do Nürburgring da foto de referência
      pts: [
        // Reta dos Boxes e Castrol-S
        [-48, 30, 2], [-76, 32, 1], [-84, 18, 1],
        // Mercedes Arena (loop técnico das curvas 2, 3 e 4)
        [-70, 4, 1], [-56, 12, 2], [-66, -4, 2],
        // Descida em alta velocidade para o grampo Dunlop-Kehre (Curva 5-7)
        [-46, -18, 1], [-18, -38, 0], [22, -54, 0], [64, -52, 0],
        // Grampo Dunlop-Kehre (Curva 7)
        [74, -36, 1], [58, -26, 1],
        // Michael-Schumacher-S (Curvas 8 e 9)
        [38, -18, 2], [22, -8, 3], [12, -20, 3],
        // Curva Kumho e Bit-Kurve (Curvas 10 e 11)
        [-2, -10, 4], [16, 10, 5],
        // Reta oposta e subida (Kurve 12)
        [44, 24, 4], [64, 16, 3],
        // Chicane NGK / Veedol (Curvas 13 e 14)
        [40, 36, 3], [12, 34, 3], [-4, 40, 2],
        // Coca-Cola-Kurve (Curva 15 - entrada da reta principal)
        [-24, 32, 2]
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
      desc: 'Corrida noturna com grampo norte remodelado, a gigantesca reta da Marina e o setor do Hotel W.',
      pts: [
        [-25, 42, 1], [-58, 40, 1], [-68, 22, 1], [-55, 4, 2], // Reta principal -> Curvas 1-3
        [-72, -25, 2], [-84, -44, 1], [-72, -52, 1], // Novo Grampo Norte
        [-20, -45, 1], [45, -38, 1], [82, -32, 1], // Maior reta do calendário
        [78, -18, 1], [85, -5, 1], [68, 15, 1], // Chicane & Curva Marsa
        [40, 12, 1], [35, 32, 1], [15, 35, 1], // Passagem pelo W Hotel iluminado
        [10, 18, 1], [-10, 20, 1], [-8, 40, 1] // Curvas finais de volta à reta
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
      desc: 'Montanhas da Estíria com subida para a Curva Remus, curvas de altíssima velocidade Rindt e Red Bull Mobile.',
      pts: [
        [-65, 35, 1], [-75, -15, 4], [-72, -45, 6], // Reta -> Niki Lauda Kurve (T1)
        [-20, -55, 8], [35, -58, 9], [48, -46, 9], // Subida íngreme para o grampo Remus (T3)
        [20, -25, 6], [-10, -15, 5], [-25, 5, 4], // Descida para a curva Rauch (T4)
        [5, 15, 3], [35, 5, 4], [68, -10, 4], // Curvas Würth & Rindt (T6-T7)
        [75, 20, 2], [55, 38, 1], [0, 38, 1] // Red Bull Mobile & reta dos boxes (T9-T10)
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
      desc: 'Ilha de Notre-Dame com Virage Senna, o emblemático grampo L’Épingle e a chicane do Muro dos Campeões.',
      pts: [
        [-50, 22, 1], [-78, 18, 1], [-84, 5, 1], [-68, -8, 1], // Virage Senna & Curva 2
        [-40, -18, 1], [-15, -12, 1], [15, -24, 1], [45, -20, 1], // Chicanes velozes 3-7
        [72, -22, 1], [86, -8, 1], [78, 12, 1], // Grampo L’Épingle (T10)
        [35, 16, 1], [-10, 20, 1], [-28, 26, 1], [-36, 20, 1] // Reta Droit du Casino -> Chicane do Muro dos Campeões
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
