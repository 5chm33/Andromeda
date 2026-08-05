/**
 * gameStateManager.ts — v87.0.0 "Simulation & Game Theory"
 * Manages game states, player turns, and win condition evaluation.
 */
export type GamePhase = "setup" | "playing" | "ended";

export interface Player {
  playerId: string;
  name: string;
  score: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
}

export interface GameState {
  gameId: string;
  name: string;
  phase: GamePhase;
  players: Player[];
  currentPlayerIndex: number;
  turnNumber: number;
  board: Record<string, unknown>;
  history: Array<{ turn: number; playerId: string; action: string; result: unknown }>;
  winner: string | null;
  createdAt: number;
}

const games = new Map<string, GameState>();
let gameCounter = 0;

export function createGame(name: string, playerNames: string[]): GameState {
  const players: Player[] = playerNames.map((n, i) => ({ playerId: `player-${i + 1}`, name: n, score: 0, isActive: true, metadata: {} }));
  const game: GameState = {
    gameId: `game-${++gameCounter}`,
    name, players,
    phase: "setup",
    currentPlayerIndex: 0,
    turnNumber: 0,
    board: {},
    history: [],
    winner: null,
    createdAt: Date.now(),
  };
  games.set(game.gameId, game);
  return game;
}

export function startGame(gameId: string): boolean {
  const game = games.get(gameId);
  if (!game || game.phase !== "setup") return false;
  game.phase = "playing";
  return true;
}

export function applyAction(gameId: string, playerId: string, action: string, result: unknown = null): boolean {
  const game = games.get(gameId);
  if (!game || game.phase !== "playing") return false;
  const currentPlayer = game.players[game.currentPlayerIndex];
  if (currentPlayer.playerId !== playerId) return false;

  game.history.push({ turn: game.turnNumber, playerId, action, result });
  game.turnNumber++;
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.filter(p => p.isActive).length;
  return true;
}

export function updateScore(gameId: string, playerId: string, delta: number): boolean {
  const game = games.get(gameId);
  if (!game) return false;
  const player = game.players.find(p => p.playerId === playerId);
  if (!player) return false;
  player.score += delta;
  return true;
}

export function endGame(gameId: string, winnerId: string | null = null): boolean {
  const game = games.get(gameId);
  if (!game) return false;
  game.phase = "ended";
  game.winner = winnerId ?? game.players.reduce((best, p) => p.score > best.score ? p : best).playerId;
  return true;
}

export function getGame(gameId: string): GameState | undefined { return games.get(gameId); }
export function getCurrentPlayer(gameId: string): Player | null {
  const game = games.get(gameId);
  if (!game) return null;
  return game.players[game.currentPlayerIndex] ?? null;
}
export function _resetGameStateManagerForTest(): void { games.clear(); gameCounter = 0; }
