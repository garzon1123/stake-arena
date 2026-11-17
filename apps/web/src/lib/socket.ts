import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@stake-arena/shared';

export type ArenaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: ArenaSocket | null = null;

/** One authenticated socket per tab; the session cookie authenticates the handshake. */
export function getSocket(): ArenaSocket {
  if (!socket) {
    socket = io({ withCredentials: true, autoConnect: false, transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
}
