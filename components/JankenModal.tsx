
import React from 'react';
import { JankenHand } from '../types';

interface JankenModalProps {
  onChoice: (hand: JankenHand) => void;
  message: string;
}

const JankenModal: React.FC<JankenModalProps> = ({ onChoice, message }) => {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border-4 border-green-600 rounded-2xl p-8 max-w-md w-full text-center shadow-[0_0_50px_rgba(34,197,94,0.3)]">
        <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter italic">
          刃こぼれ！
        </h2>
        <p className="text-green-400 font-bold mb-8">
          ゾンビとじゃんけんをして刀を研ぎ直せ。
        </p>
        
        {message && (
          <p className="text-2xl text-yellow-400 mb-6 font-bold animate-pulse">{message}</p>
        )}

        <div className="flex justify-around gap-4">
          <button
            onClick={() => onChoice('ROCK')}
            className="flex-1 bg-slate-800 hover:bg-slate-700 border-2 border-white text-5xl p-6 rounded-xl transition-all hover:scale-110 active:scale-95"
          >
            ✊
          </button>
          <button
            onClick={() => onChoice('PAPER')}
            className="flex-1 bg-slate-800 hover:bg-slate-700 border-2 border-white text-5xl p-6 rounded-xl transition-all hover:scale-110 active:scale-95"
          >
            ✋
          </button>
          <button
            onClick={() => onChoice('SCISSORS')}
            className="flex-1 bg-slate-800 hover:bg-slate-700 border-2 border-white text-5xl p-6 rounded-xl transition-all hover:scale-110 active:scale-95"
          >
            ✌️
          </button>
        </div>
        
        <p className="mt-8 text-slate-500 text-sm">勝てば二刀流へ成功。負ければゾンビの餌食...</p>
      </div>
    </div>
  );
};

export default JankenModal;
