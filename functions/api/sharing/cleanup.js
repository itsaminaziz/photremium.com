/**
 * Scheduled Cleanup Worker (Cron)
 * Runs every 20 minutes
 * - Deletes expired sessions
 * - Removes session metadata from KV
 * - Decrements global storage counter
 */

import { deleteSessionData } from '../../lib/sessionUtils';

export default {
  async scheduled(event, env) {
    console.log('Starting scheduled cleanup...');

    try {
      const now = Date.now();
      let deletedCount = 0;

      // Scan all sessions in KV
      let cursor = null;
      do {
        const listResult = await env.SESSIONS.list({ cursor, limit: 100 });

        for (const item of listResult.keys) {
          if (!item.name.startsWith('session:')) continue;

          const sessionRaw = await env.SESSIONS.get(item.name);
          if (!sessionRaw) continue;

          const session = JSON.parse(sessionRaw);
          if (now > session.expiresAt) {
            await deleteSessionData(env, session);
            deletedCount++;
          }
        }

        cursor = listResult.cursor;
      } while (cursor);

      console.log({
        deletedSessions: deletedCount,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        deletedSessions: deletedCount
      };
    } catch (err) {
      console.error('Cleanup error:', err);
      throw err;
    }
  }
};