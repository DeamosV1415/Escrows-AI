/**
 * Tiny Server-Sent Events (SSE) hub for pushing live inbox updates to the
 * browser. Keyed by userId; a user may have several open tabs (multiple
 * response streams). Used to deliver new messages in real time without polling
 * or page refreshes.
 */

const clients = new Map(); // userId(string) -> Set<res>

export function addClient(userId, res) {
  const key = String(userId);
  if (!clients.has(key)) clients.set(key, new Set());
  clients.get(key).add(res);
}

export function removeClient(userId, res) {
  const key = String(userId);
  const set = clients.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(key);
}

/**
 * Push an event to every open stream for a user. Safe to call when the user has
 * no open streams (no-op).
 */
export function publish(userId, event) {
  const set = clients.get(String(userId));
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // Broken pipe — drop it; the 'close' handler will clean up.
    }
  }
}
