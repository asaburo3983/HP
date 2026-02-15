
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { GameStatus, Player, Hunter, HidingSpot, Position, JankenHand } from './types';
import { 
  MAP_WIDTH, MAP_HEIGHT, INITIAL_HUNTER_COUNT,
  PLAYER_SPEED, HUNTER_SPEED, PLAYER_RADIUS, HUNTER_RADIUS, 
  HIDING_SPOT_RADIUS, COLORS, SWORD_DURABILITY 
} from './constants';
import JankenModal from './components/JankenModal';

// Audio decoding utilities
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const GAME_DURATION = 60; // 1 minute

const App: React.FC = () => {
  const [status, setStatus] = useState<GameStatus>(GameStatus.START);
  const [score, setScore] = useState(0);
  const [jankenMsg, setJankenMsg] = useState("");
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player>({
    pos: { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 },
    radius: PLAYER_RADIUS,
    speed: PLAYER_SPEED,
    angle: 0,
    hasSword: false,
    hasDualSwords: false,
    swordKills: 0,
    isDead: false,
    isHidden: false
  });
  const huntersRef = useRef<Hunter[]>([]);
  const spotsRef = useRef<HidingSpot[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const requestRef = useRef<number>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const moveSoundIntervalRef = useRef<number>(0);

  // Sound Synthesis Helpers
  const playSfx = (type: 'hit' | 'move' | 'zombie' | 'clash') => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (type === 'hit') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'clash') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.linearRampToValueAtTime(200, now + 0.2);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'move') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'zombie') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(40 + Math.random() * 20, now);
      osc.frequency.linearRampToValueAtTime(30, now + 0.3);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  };

  const playMammaMia = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: 'AAAAAAHHHHHH!!! MAMMA MIA!!! HELP ME!!!' }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Puck' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start();
      }
    } catch (error) {
      console.error("TTS Error:", error);
    }
  };

  const initGame = useCallback(() => {
    const spots: HidingSpot[] = [
      { pos: { x: 150, y: 150 }, radius: HIDING_SPOT_RADIUS, id: 1, hasSword: false },
      { pos: { x: MAP_WIDTH - 150, y: MAP_HEIGHT - 150 }, radius: HIDING_SPOT_RADIUS, id: 2, hasSword: false },
      { pos: { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 + 200 }, radius: HIDING_SPOT_RADIUS, id: 3, hasSword: false },
    ];
    spots[Math.floor(Math.random() * spots.length)].hasSword = true;
    spotsRef.current = spots;

    playerRef.current = {
      pos: { x: 100, y: MAP_HEIGHT / 2 },
      radius: PLAYER_RADIUS,
      speed: PLAYER_SPEED,
      angle: 0,
      hasSword: false,
      hasDualSwords: false,
      swordKills: 0,
      isDead: false,
      isHidden: false
    };

    const hunters: Hunter[] = [];
    for (let i = 0; i < INITIAL_HUNTER_COUNT; i++) {
      hunters.push({
        id: i,
        pos: { 
          x: MAP_WIDTH - 100 - Math.random() * 200, 
          y: Math.random() * MAP_HEIGHT 
        },
        radius: HUNTER_RADIUS,
        speed: HUNTER_SPEED,
        angle: Math.random() * Math.PI * 2,
        hasSword: false
      });
    }
    huntersRef.current = hunters;
    setScore(0);
    setTimeLeft(GAME_DURATION);
  }, []);

  const drawZombie = (ctx: CanvasRenderingContext2D, hunter: Hunter) => {
    const { pos, hasSword } = hunter;
    ctx.save();
    ctx.translate(pos.x, pos.y);

    ctx.fillStyle = hasSword ? '#1e1b4b' : '#4b5563'; 
    ctx.beginPath();
    ctx.ellipse(0, 4, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#86efac'; 
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(-3, -2, 1.5, 0, Math.PI * 2);
    ctx.arc(3, -2, 1.5, 0, Math.PI * 2);
    ctx.fill();

    if (hasSword) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(10, 5);
      ctx.lineTo(30, 20);
      ctx.stroke();
      ctx.shadowBlur = 15;
      ctx.shadowColor = 'red';
      ctx.stroke();
    }

    ctx.restore();
  };

  const drawBear = (ctx: CanvasRenderingContext2D, player: Player) => {
    const { pos, hasSword, hasDualSwords, isHidden } = player;
    ctx.save();
    ctx.translate(pos.x, pos.y);

    const color = isHidden ? '#78350f' : '#92400e'; 
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.arc(-8, -8, 6, 0, Math.PI * 2);
    ctx.arc(8, -8, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 4, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, -2, 10, 0, Math.PI * 2);
    ctx.fill();

    if (hasSword) {
      ctx.strokeStyle = hasDualSwords ? '#60a5fa' : '#fff';
      ctx.lineWidth = 3;
      ctx.shadowBlur = 10;
      ctx.shadowColor = hasDualSwords ? '#60a5fa' : '#fff';
      
      // Right sword
      ctx.beginPath();
      ctx.moveTo(12, -5);
      ctx.lineTo(28, -25);
      ctx.stroke();

      if (hasDualSwords) {
        // Left sword
        ctx.beginPath();
        ctx.moveTo(-12, -5);
        ctx.lineTo(-28, -25);
        ctx.stroke();
      }
    }

    ctx.restore();
  };

  const update = useCallback(() => {
    if (status !== GameStatus.PLAYING) return;

    const player = playerRef.current;
    
    let dx = 0;
    let dy = 0;
    if (keysRef.current['ArrowUp'] || keysRef.current['w']) dy -= 1;
    if (keysRef.current['ArrowDown'] || keysRef.current['s']) dy += 1;
    if (keysRef.current['ArrowLeft'] || keysRef.current['a']) dx -= 1;
    if (keysRef.current['ArrowRight'] || keysRef.current['d']) dx += 1;

    if (dx !== 0 || dy !== 0) {
      const mag = Math.sqrt(dx * dx + dy * dy);
      player.pos.x += (dx / mag) * player.speed;
      player.pos.y += (dy / mag) * player.speed;
      
      if (Date.now() - moveSoundIntervalRef.current > 250) {
        playSfx('move');
        moveSoundIntervalRef.current = Date.now();
      }
    }

    player.pos.x = Math.max(player.radius, Math.min(MAP_WIDTH - player.radius, player.pos.x));
    player.pos.y = Math.max(player.radius, Math.min(MAP_HEIGHT - player.radius, player.pos.y));

    let inSpot = false;
    spotsRef.current.forEach(spot => {
      const dist = Math.sqrt((player.pos.x - spot.pos.x) ** 2 + (player.pos.y - spot.pos.y) ** 2);
      if (dist < spot.radius) {
        inSpot = true;
        if (spot.hasSword && !player.hasSword) {
          player.hasSword = true;
          player.hasDualSwords = false; 
          spot.hasSword = false;
          playSfx('hit');
        }
      }
    });
    player.isHidden = inSpot;

    huntersRef.current.forEach(h => {
      const adx = player.pos.x - h.pos.x;
      const ady = player.pos.y - h.pos.y;
      const distToPlayer = Math.sqrt(adx * adx + ady * ady);

      if (distToPlayer < 150 && Math.random() < 0.01) {
        playSfx('zombie');
      }

      if (!player.isHidden) {
        // Armed zombies are slightly faster
        const currentHunterSpeed = h.hasSword ? HUNTER_SPEED * 1.5 : HUNTER_SPEED;
        h.pos.x += (adx / distToPlayer) * currentHunterSpeed;
        h.pos.y += (ady / distToPlayer) * currentHunterSpeed;
      } else {
        h.pos.x += Math.cos(h.angle) * h.speed;
        h.pos.y += Math.sin(h.angle) * h.speed;
        if (Math.random() < 0.02) h.angle += (Math.random() - 0.5);
        if (h.pos.x < 0 || h.pos.x > MAP_WIDTH) h.angle = Math.PI - h.angle;
        if (h.pos.y < 0 || h.pos.y > MAP_HEIGHT) h.angle = -h.angle;
      }

      if (distToPlayer < player.radius + h.radius) {
        if (h.hasSword) {
          if (player.hasDualSwords) {
            // Bear (2 swords) vs Zombie (1 sword) -> Bear wins duel
            huntersRef.current = huntersRef.current.filter(item => item.id !== h.id);
            player.swordKills += 2; // Dueling is hard on blades
            setScore(prev => prev + 5);
            playSfx('clash');
          } else {
            // Unarmed or 1-sword bear loses to Sword Zombie
            setStatus(GameStatus.GAMEOVER);
            playMammaMia();
          }
        } else if (player.hasSword) {
          huntersRef.current = huntersRef.current.filter(item => item.id !== h.id);
          player.swordKills += 1;
          setScore(prev => prev + 1);
          playSfx('hit');
          
          const maxDurability = player.hasDualSwords ? SWORD_DURABILITY * 2 : SWORD_DURABILITY;
          if (player.swordKills >= maxDurability) {
            player.hasSword = false;
            player.hasDualSwords = false;
            player.swordKills = 0;
            setStatus(GameStatus.JANKEN);
          }
        } else {
          setStatus(GameStatus.GAMEOVER);
          playMammaMia();
        }
      }
    });

    if (huntersRef.current.length === 0) {
      setStatus(GameStatus.WON);
    }

    render();
    requestRef.current = requestAnimationFrame(update);
  }, [status]);

  const render = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    spotsRef.current.forEach(spot => {
      ctx.beginPath();
      ctx.arc(spot.pos.x, spot.pos.y, spot.radius, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.HIDING_SPOT;
      ctx.fill();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (spot.hasSword) {
        ctx.fillStyle = '#fff';
        ctx.font = '24px Arial';
        ctx.fillText('🗡️', spot.pos.x - 12, spot.pos.y + 10);
      }
    });

    huntersRef.current.forEach(h => {
      drawZombie(ctx, h);
    });

    drawBear(ctx, playerRef.current);
    
    const player = playerRef.current;
    if (player.hasSword) {
      const maxD = player.hasDualSwords ? SWORD_DURABILITY * 2 : SWORD_DURABILITY;
      const durabilityPercent = Math.max(0, (maxD - player.swordKills) / maxD);
      ctx.fillStyle = '#333';
      ctx.fillRect(player.pos.x - 20, player.pos.y - 45, 40, 6);
      ctx.fillStyle = player.hasDualSwords ? '#60a5fa' : (durabilityPercent > 0.3 ? '#fff' : '#ef4444');
      ctx.fillRect(player.pos.x - 20, player.pos.y - 45, 40 * durabilityPercent, 6);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keysRef.current[e.key] = true;
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current[e.key] = false;
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (status === GameStatus.PLAYING) {
      requestRef.current = requestAnimationFrame(update);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [status, update]);

  useEffect(() => {
    let timer: number;
    if (status === GameStatus.PLAYING && timeLeft > 0) {
      timer = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setStatus(GameStatus.WON);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [status, timeLeft]);

  const startGame = () => {
    initGame();
    setStatus(GameStatus.PLAYING);
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  };

  const handleJanken = (userHand: JankenHand) => {
    const hands: JankenHand[] = ['ROCK', 'PAPER', 'SCISSORS'];
    const cpuHand = hands[Math.floor(Math.random() * 3)];
    
    if (userHand === cpuHand) {
      setJankenMsg(`あいこ！ ゾンビも ${cpuHand}`);
      return;
    }

    const win = (userHand === 'ROCK' && cpuHand === 'SCISSORS') ||
                (userHand === 'PAPER' && cpuHand === 'ROCK') ||
                (userHand === 'SCISSORS' && cpuHand === 'PAPER');

    if (win) {
      playerRef.current.hasSword = true;
      playerRef.current.hasDualSwords = true; // Player gets TWO swords
      playerRef.current.swordKills = 0;
      setJankenMsg("大成功！ 熊の二刀流だ！");
      playSfx('clash');
      setTimeout(() => {
        setJankenMsg("");
        setStatus(GameStatus.PLAYING);
      }, 1000);
    } else {
      // ONLY ONE zombie gets a sword
      if (huntersRef.current.length > 0) {
        const luckyZombie = huntersRef.current[Math.floor(Math.random() * huntersRef.current.length)];
        luckyZombie.hasSword = true;
      }
      setJankenMsg("失敗... ゾンビが一体、刀を構えた。");
      playSfx('zombie');
      setTimeout(() => {
        setJankenMsg("");
        setStatus(GameStatus.PLAYING);
      }, 1500);
    }
  };

  return (
    <div className="relative w-screen h-screen flex flex-col items-center justify-center bg-black overflow-hidden select-none">
      
      {status === GameStatus.PLAYING && (
        <>
          <div className="absolute top-4 left-4 z-10 text-white font-mono bg-black/60 p-4 rounded-lg border border-white/20">
            <div className="text-sm opacity-70 uppercase tracking-widest">Zombies</div>
            <div className="text-3xl font-bold text-red-500">{huntersRef.current.length}</div>
            <div className="text-sm mt-2 opacity-70 uppercase tracking-widest">Score</div>
            <div className="text-3xl font-bold text-blue-400">{score}</div>
            {playerRef.current.hasDualSwords && (
              <div className="text-xs text-blue-300 mt-2 font-black animate-pulse">DUAL WIELD MODE</div>
            )}
          </div>

          <div className="absolute top-4 right-4 z-10 text-white font-mono bg-black/60 p-4 rounded-lg border border-white/20 text-center min-w-[120px]">
            <div className="text-sm opacity-70 uppercase tracking-widest mb-1">Time Left</div>
            <div className={`text-4xl font-black ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-yellow-400'}`}>
              {timeLeft}s
            </div>
          </div>
        </>
      )}

      {status === GameStatus.START && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-slate-950">
          <div className="text-8xl mb-4 animate-bounce">🐻</div>
          <h1 className="text-8xl font-black text-white italic tracking-tighter mb-4 drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]">
            いかれた鬼ごっこ
          </h1>
          <p className="text-slate-400 max-w-lg text-center mb-10 leading-relaxed text-lg px-4">
            一頭の熊、20体のゾンビ。<br/>
            刃こぼれしたら、ゾンビと命がけのじゃんけん。<br/>
            勝てば二刀流（強敵ゾンビを撃破可能）、<br/>
            負ければ一体のゾンビが刀を握る強敵となる。
          </p>
          <button 
            onClick={startGame}
            className="px-12 py-5 bg-red-600 hover:bg-red-500 text-white text-3xl font-black rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(220,38,38,0.5)]"
          >
            逃亡開始
          </button>
        </div>
      )}

      {(status === GameStatus.GAMEOVER || status === GameStatus.WON) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-40 bg-black/95 backdrop-blur-md text-center">
          {status === GameStatus.GAMEOVER && (
            <div className="text-8xl font-black text-red-600 mb-8 animate-bounce uppercase italic drop-shadow-[0_0_40px_rgba(220,38,38,1)]">
              マンマミーヤ！！
            </div>
          )}
          <h2 className={`text-9xl font-black mb-8 italic ${status === GameStatus.WON ? 'text-green-500 animate-pulse' : 'text-white/10'}`}>
            {status === GameStatus.WON ? '生存成功' : '終了'}
          </h2>
          <div className="text-white text-3xl mb-12 flex flex-col items-center gap-4 bg-white/5 p-8 rounded-2xl border border-white/10">
            <div>最終スコア: <span className="text-yellow-400 font-bold">{score}</span></div>
            {status === GameStatus.WON && <div className="text-green-400 text-xl font-bold">1分間の猛攻を耐え抜いた伝説の熊</div>}
          </div>
          <button 
            onClick={startGame}
            className="px-10 py-4 bg-red-700 text-white text-2xl font-bold rounded-lg hover:bg-red-600 transition-all shadow-[0_0_20px_rgba(220,38,38,0.5)]"
          >
            リトライ
          </button>
        </div>
      )}

      {status === GameStatus.JANKEN && (
        <JankenModal onChoice={handleJanken} message={jankenMsg} />
      )}

      <div className="border-4 border-slate-800 shadow-2xl rounded-lg overflow-hidden bg-slate-900 relative">
        <canvas 
          ref={canvasRef} 
          width={MAP_WIDTH} 
          height={MAP_HEIGHT}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      <div className="absolute bottom-4 right-4 text-white/20 text-xs text-right">
        WASD to Move | Hidden in Green Areas<br/>
        Dual Wield beats Armed Zombie | © 2024 CRAZY TAG
      </div>
    </div>
  );
};

export default App;
