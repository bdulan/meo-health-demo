// LOG: in-memory event array wrapping all three modules. Export = JSON dump.

import { LogEvent, LogEventType } from './types';

export class SessionLog {
  private events: LogEvent[] = [];
  private listeners: ((e: LogEvent) => void)[] = [];

  append(type: LogEventType, payload: Record<string, unknown>, tSec?: number): LogEvent {
    const event: LogEvent = { ts: new Date().toISOString(), tSec, type, payload };
    this.events.push(event);
    for (const l of this.listeners) l(event);
    return event;
  }

  onEvent(listener: (e: LogEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  all(): LogEvent[] {
    return this.events;
  }

  count(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }

  toJSON(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        eventCount: this.events.length,
        events: this.events,
      },
      null,
      2
    );
  }
}
