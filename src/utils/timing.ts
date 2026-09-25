export interface TimingEntry {
  id: string;
  name: string;
  startTime: number;
  durationMs?: number;
  error?: string;
  timestamp: string;
}

const listeners: Array<(entries: TimingEntry[]) => void> = [];
const timingLogs: TimingEntry[] = [];

export function startTiming(name: string): (error?: unknown) => number {
  const start = performance.now();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: TimingEntry = {
    id,
    name,
    startTime: start,
    timestamp: new Date().toLocaleTimeString(),
  };
  timingLogs.unshift(entry);
  if (timingLogs.length > 50) timingLogs.pop();
  notify();

  console.log(`[Firestore Timing] START: ${name}`);

  return (err?: unknown) => {
    const duration = Math.round(performance.now() - start);
    entry.durationMs = duration;
    if (err) {
      entry.error = err instanceof Error ? err.message : String(err);
      console.warn(`[Firestore Timing] FAIL: ${name} (${duration}ms) - ${entry.error}`);
    } else {
      console.log(`[Firestore Timing] DONE: ${name} in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    }
    notify();
    return duration;
  };
}

export function getTimingLogs(): TimingEntry[] {
  return [...timingLogs];
}

export function clearTimingLogs(): void {
  timingLogs.length = 0;
  notify();
}

export function subscribeTiming(listener: (entries: TimingEntry[]) => void): () => void {
  listeners.push(listener);
  listener(getTimingLogs());
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function notify() {
  const copy = [...timingLogs];
  for (const l of listeners) l(copy);
}
