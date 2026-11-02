import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'movie-stream-secret-change-me';

export function authenticateHost(options = {}) {
  const room = options.room || 'movie';
  return jwt.sign({ role: 'host', room }, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyHostToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.role === 'host';
  } catch {
    return false;
  }
}

export function verifyHostTokenForRoom(token, room) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.role === 'host' && decoded.room === room;
  } catch {
    return false;
  }
}
