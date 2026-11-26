export const MAX_CHAT_HISTORY = 200;

export const rooms = {
  movie: { users: new Map(), chatHistory: [], hostSocketId: null, reactionsEnabled: true },
  dj: { users: new Map(), chatHistory: [], hostSocketId: null, reactionsEnabled: true },
};

export function getRoomState(room) {
  return rooms[room] || rooms.movie;
}
