
export enum GameStatus {
  START = 'START',
  PLAYING = 'PLAYING',
  JANKEN = 'JANKEN',
  GAMEOVER = 'GAMEOVER',
  WON = 'WON'
}

export type Position = {
  x: number;
  y: number;
};

export interface Character {
  pos: Position;
  radius: number;
  speed: number;
  angle: number;
}

export interface Player extends Character {
  hasSword: boolean;
  hasDualSwords: boolean;
  swordKills: number;
  isDead: boolean;
  isHidden: boolean;
}

export interface Hunter extends Character {
  id: number;
  hasSword: boolean;
}

export interface HidingSpot {
  pos: Position;
  radius: number;
  id: number;
  hasSword: boolean;
}

export type JankenHand = 'ROCK' | 'PAPER' | 'SCISSORS';
