export type MemoryItem = {
  ts: number;
  type: 'thought'|'action'|'observation'|'milestone'|'error'|'summary';
  content: string;
};

export class Memory {
  private items: MemoryItem[] = [];

  add(item: MemoryItem) {
    this.items.push(item);
  }

  recent(n = 12) {
    return this.items.slice(-n);
  }

  summarize(): string {
    const last = this.items.slice(-40);
    const text = last.map(i => `[${new Date(i.ts).toISOString()}] ${i.type.toUpperCase()}: ${i.content}`).join('\n');
    return text.slice(-4000);
  }
}
