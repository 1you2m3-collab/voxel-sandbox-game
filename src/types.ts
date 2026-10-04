export type PlayerState = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  color: string;
};

export type RoomState = {
  code: string;
  players: PlayerState[];
  maxPlayers: number;
};
