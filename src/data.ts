// A label that the user attaches to time blocks, for example a project.
export interface Label {
  id: string;
  name: string;
  color: string;
}

// One period of work (milliseconds since the epoch). A block with an end of
// null runs now. The notes are a list of short items.
export interface Block {
  id: string;
  start: number;
  end: number | null;
  labelIds: string[];
  notes: string[];
}

export interface Data {
  labels: Label[];
  blocks: Block[];
}

const STORAGE_KEY = 'worktime.v1';

// Colors that the user can select for a label.
export const COLORS = [
  '#43a047',
  '#1e88e5',
  '#8e24aa',
  '#d81b60',
  '#f4511e',
  '#fb8c00',
  '#00897b',
  '#6d4c41',
];

const EMPTY: Data = { labels: [], blocks: [] };

export function loadData(): Data {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Data>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveData(data: Data): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage is full or blocked; the data stays in memory only.
  }
}

// Return the first color that no label uses, or cycle through COLORS when all
// colors are in use.
export function nextColor(labels: Label[]): string {
  const used = new Set(labels.map((l) => l.color));
  return COLORS.find((c) => !used.has(c)) ?? COLORS[labels.length % COLORS.length];
}

// Add a label with the given id, or replace the label that has this id.
export function saveLabel(data: Data, label: Label): Data {
  if (!data.labels.some((l) => l.id === label.id)) return { ...data, labels: [...data.labels, label] };
  return { ...data, labels: data.labels.map((l) => (l.id === label.id ? label : l)) };
}

// Remove a label and its references from all blocks.
export function removeLabel(data: Data, id: string): Data {
  return {
    labels: data.labels.filter((l) => l.id !== id),
    blocks: data.blocks.map((b) => ({ ...b, labelIds: b.labelIds.filter((l) => l !== id) })),
  };
}

export function saveBlock(data: Data, block: Omit<Block, 'id'>, id: string | null): Data {
  if (id === null) {
    return { ...data, blocks: [...data.blocks, { ...block, id: crypto.randomUUID() }] };
  }
  return { ...data, blocks: data.blocks.map((b) => (b.id === id ? { ...block, id } : b)) };
}

export function removeBlock(data: Data, id: string): Data {
  return { ...data, blocks: data.blocks.filter((b) => b.id !== id) };
}

export function runningBlock(data: Data): Block | undefined {
  return data.blocks.find((b) => b.end === null);
}

// Start a new block with the labels of the last block, so that a series of
// blocks on one project needs no new label selection.
export function startBlock(data: Data, now: number): Data {
  const last = sortedBlocks(data).at(-1);
  const block: Block = { id: crypto.randomUUID(), start: now, end: null, labelIds: last?.labelIds ?? [], notes: [] };
  return { ...data, blocks: [...data.blocks, block] };
}

export function stopBlock(data: Data, id: string, now: number): Data {
  return { ...data, blocks: data.blocks.map((b) => (b.id === id ? { ...b, end: Math.max(now, b.start) } : b)) };
}

// All blocks, oldest first.
export function sortedBlocks(data: Data): Block[] {
  return data.blocks.slice().sort((a, b) => a.start - b.start);
}

// The duration of the part of a block that is between from and to. A running
// block ends now.
export function overlap(block: Block, from: number, to: number, now: number): number {
  const end = block.end ?? now;
  return Math.max(0, Math.min(end, to) - Math.max(block.start, from));
}

export function total(blocks: Block[], from: number, to: number, now: number): number {
  return blocks.reduce((sum, b) => sum + overlap(b, from, to, now), 0);
}

export function startOfDay(time: number): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Local days are not always 24 h long, so the calendar fields define the step.
export function addDays(time: number, days: number): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

// A week starts on Monday.
export function startOfWeek(time: number): number {
  const d = new Date(startOfDay(time));
  return addDays(d.getTime(), -((d.getDay() + 6) % 7));
}

export function startOfMonth(time: number): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addMonths(time: number, months: number): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime();
}

export type Period = 'week' | 'month';

// The start and the end of the week or month that contains the time, moved by
// a number of periods.
export function periodOf(period: Period, time: number, shift: number): [number, number] {
  if (period === 'week') {
    const from = addDays(startOfWeek(time), 7 * shift);
    return [from, addDays(from, 7)];
  }
  const from = addMonths(startOfMonth(time), shift);
  return [from, addMonths(from, 1)];
}

// The start of each day from from to to.
export function days(from: number, to: number): number[] {
  const result: number[] = [];
  for (let day = from; day < to; day = addDays(day, 1)) result.push(day);
  return result;
}

const MINUTE = 60 * 1000;

// A duration as hours and minutes, for example "7:05". With seconds, also the
// seconds, for example "7:05:12".
export function formatDuration(ms: number, seconds = false): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return seconds ? `${h}:${pad(m)}:${pad(s)}` : `${h}:${pad(m)}`;
}

// A duration as decimal hours, for example "7.08 h".
export function formatHours(ms: number): string {
  return `${(ms / (60 * MINUTE)).toFixed(2)} h`;
}

const pad = (n: number) => String(n).padStart(2, '0');

// The local time in the format of an <input type="datetime-local">.
export function toInputTime(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputTime(text: string): number | null {
  const time = new Date(text).getTime();
  return Number.isNaN(time) ? null : time;
}
