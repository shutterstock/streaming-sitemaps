import http from 'http';

export interface ISocketStat {
  total: number;
  free: number;
  inUse: number;
}

export interface ISocketStats {
  readonly all: ISocketStat;
  [host: string]: ISocketStat;
}

export function getSocketStats(agent: http.Agent): ISocketStats {
  const stats: ISocketStats = { all: { total: 0, free: 0, inUse: 0 } };

  // Count free sockets
  let socketSet = agent.freeSockets;
  for (const handle of Object.keys(socketSet)) {
    const host = handle.split(':')[0];
    const sockets = socketSet[handle];
    if (sockets !== undefined) {
      const count = sockets.length;
      if (stats[host] === undefined) {
        stats[host] = { total: count, free: count, inUse: 0 };
      } else {
        const hostStats = stats[host];
        hostStats.free += count;
        hostStats.total += count;
      }
      stats.all.free += count;
      stats.all.total += count;
    }
  }

  // Count in-use sockets
  socketSet = agent.sockets;
  for (const handle of Object.keys(socketSet)) {
    const host = handle.split(':')[0];
    const sockets = socketSet[handle];
    if (sockets !== undefined) {
      const count = sockets.length;
      if (stats[host] === undefined) {
        stats[host] = { total: count, free: 0, inUse: count };
      } else {
        const hostStats = stats[host];
        hostStats.inUse += count;
        hostStats.total += count;
      }
      stats.all.inUse += count;
      stats.all.total += count;
    }
  }

  return stats;
}
