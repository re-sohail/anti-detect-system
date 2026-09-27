// Custom server: the ONLY place the observed peer address is derived (brief §7, R3).
// Next's route handlers cannot see the socket, and a client-supplied X-Forwarded-For
// must never be believed, so we stamp a trusted internal header here and strip any
// copy the client sent.
import { createServer } from 'node:http';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 4100);
const host = process.env.HOST ?? '0.0.0.0';
// Comma-separated IPs of reverse proxies we operate. Only their X-Forwarded-For is trusted.
const trustedProxies = new Set(
  (process.env.TRUSTED_PROXIES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);

const INTERNAL = ['x-lvd-peer', 'x-lvd-peer-source', 'x-lvd-socket'];
const norm = (ip) => (ip && ip.startsWith('::ffff:') ? ip.slice(7) : ip ?? '');

export function derivePeer(socketAddr, xff) {
  const socket = norm(socketAddr);
  if (trustedProxies.has(socket) && xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    // Walk from the right, skipping our own proxies; the first untrusted hop is the client.
    for (let i = parts.length - 1; i >= 0; i--) {
      const ip = norm(parts[i]);
      if (!trustedProxies.has(ip)) return { ip, source: 'x-forwarded-for-via-trusted-proxy' };
    }
  }
  return { ip: socket, source: 'socket' };
}

const app = next({ dev, hostname: host, port });
const handle = app.getRequestHandler();
await app.prepare();

createServer((req, res) => {
  for (const h of INTERNAL) delete req.headers[h];
  const peer = derivePeer(req.socket.remoteAddress, req.headers['x-forwarded-for']);
  req.headers['x-lvd-peer'] = peer.ip;
  req.headers['x-lvd-peer-source'] = peer.source;
  req.headers['x-lvd-socket'] = norm(req.socket.remoteAddress);
  handle(req, res);
}).listen(port, host, () => {
  console.log(`> collector ready on http://${host}:${port} (${dev ? 'dev' : 'production'})`);
});
