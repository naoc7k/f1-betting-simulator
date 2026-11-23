# 🏎️ F1 Betting Simulator 3D · Multiplayer Real-Time (v2.0)

Simulador 3D de corridas de Fórmula 1 com **multiplayer sincronizado em tempo real**, **10 circuitos reais**, **monopostos F1 3D detalhados**, **sistema de apostas com cancelamento** e **Caixa de Fichas persistente**.

## ✨ Principais Funcionalidades (v2.0)
- **Multiplayer em Tempo Real (4 Camadas de Sincronização)**:
  - **Servidor Local Autoritativo** (`server.py` / `server.js` em `/api/room/<code>`)
  - **WebRTC P2P (`PeerJS`)** para jogar com amigos em redes/dispositivos diferentes (funciona em hospedagem estática como Netlify, Vercel e GitHub Pages)
  - **Relay WebSocket Público** como fallback automático contra firewalls
  - **BroadcastChannel + Storage Sync** para sincronização instantânea entre abas/janelas
  - Reconexão automática sem corromper o estado da corrida e validação obrigatória de **mínimo 2 jogadores conectados** para iniciar
- **Simulador de Corridas 3D (Three.js WebGL)**:
  - **10 circuitos reais** com traçados reconhecíveis, elevação 3D, zebras, pórtico de largada com 5 luzes, arquibancadas e pit lane (`Interlagos`, `Mônaco`, `Silverstone`, `Monza`, `Spa-Francorchamps`, `Suzuka`, `Nürburgring`, `Yas Marina`, `Red Bull Ring`, `Montreal`)
  - **Modelos 3D detalhados dos carros F1**: bico aerodinâmico, asas dianteira e traseira com DRS, sidepods, cockpit com Halo, capacete do piloto, luz traseira ERS e 4 rodas com faixa colorida do composto Pirelli (`S`, `M`, `H`, `I`, `W`)
  - **Tempo de volta realista (~30 segundos por volta)** com movimentação contínua a 60 FPS
  - **Seleção e destaque visual de corredor** durante a corrida + 4 modos de câmera 3D (`Panorâmica 3D`, `Perseguição`, `Helicóptero`, `Aérea`)
- **Sistema de Apostas & Cancelamento**:
  - Tabela de apostas limpa e intuitiva (sem exibir posições dos corredores na tabela de seleção)
  - Limite máximo de **10.000 fichas** por aposta e mínimo de **5 voltas** por corrida
  - **Cancelamento de apostas** com estorno imediato ao saldo enquanto a janela de apostas estiver aberta (bloqueado após encerramento da janela)
  - **Novas rodadas de apostas a cada 10 voltas concluídas** preservando apostas anteriores
- **Perfil Persistente & Caixa de Fichas**:
  - Saldo visível permanentemente no canto superior direito
  - Login persistente (nome, avatar, ID, saldo e histórico salvos automaticamente)
  - **Caixa de Fichas** com total apostado, total ganho, total perdido, lucro/prejuízo líquido e históricos completos sem duplicação

## 🚀 Como Executar Localmente
1. **Com Python 3 (recomendado — ativa API multiplayer local):**
   ```bash
   python server.py
   ```
   Abra `http://localhost:8080`
2. **Com Node.js:**
   ```bash
   npm start
   ```
   Abra `http://localhost:8080`
3. **Direto no navegador:**
   Abra `index.html` (sincroniza via WebRTC P2P + Relay WebSocket + BroadcastChannel).
