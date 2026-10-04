import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { PlayerState, RoomState } from '../src/types';

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

app.use(express.static('dist'));

const rooms = new Map<string, { code: string; players: Map<string, PlayerState> }>();

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms.set(code, { code, players: new Map() });
    const room = rooms.get(code)!;
    room.players.set(socket.id, { id: socket.id, name, x: 0, y: 4, z: 0, color: randomColor() });
    socket.join(code);
    socket.data.room = code;
    io.to(code).emit('roomState', { code, players: Array.from(room.players.values()), maxPlayers: 50 });
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    if (room.players.size >= 50) {
      socket.emit('error', 'Room full');
      return;
    }
    room.players.set(socket.id, { id: socket.id, name, x: room.players.size * 2, y: 4, z: 0, color: randomColor() });
    socket.join(code);
    socket.data.room = code;
    io.to(code).emit('roomState', { code, players: Array.from(room.players.values()), maxPlayers: 50 });
  });

  socket.on('move', ({ x, y, z }) => {
    const room = socket.data.room as string | undefined;
    if (!room) return;
    const r = rooms.get(room);
    if (!r) return;
    const p = r.players.get(socket.id);
    if (!p) return;
    p.x = x;
    p.y = y;
    p.z = z;
    io.to(room).emit('playerUpdate', p);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room as string | undefined;
    if (room) {
      const r = rooms.get(room);
      if (r) {
        r.players.delete(socket.id);
        io.to(room).emit('playerLeave', socket.id);
        if (r.players.size === 0) rooms.delete(room);
      }
    }
  });
});

function randomColor() {
  const colors = ['#fca5a5', '#7dd3fc', '#f9a8d4', '#86efac', '#fcd34d', '#c4b5fd'];
  return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 3030;
http.listen(PORT, () => {
  console.log(`VoxelCraft server running on port ${PORT}`);
});
