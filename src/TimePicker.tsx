import { addDays, startOfDay } from './data';
import { Icon } from './icons';

const MINUTE = 60 * 1000;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const SHIFTS = [-30, -15, -5, 5, 10, 30];

export type Field = 'start' | 'end';

const pad = (n: number) => String(n).padStart(2, '0');

// The time of day as "HH:MM".
export function clock(time: number): string {
  const d = new Date(time);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The day of a time as "Today", "Yesterday" or a short date.
export function dayName(time: number, now: number): string {
  const day = startOfDay(time);
  if (day === startOfDay(now)) return 'Today';
  if (day === addDays(now, -1)) return 'Yesterday';
  if (day === addDays(now, 1)) return 'Tomorrow';
  return new Date(time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// The time with the hour and the minute of the day set. The seconds are zero.
function withClock(time: number, hour: number, minute: number): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime();
}

// The time of day of `time` on the day of `day`.
function onDay(time: number, day: number): number {
  const t = new Date(time);
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()).getTime();
}

interface TimePickerProps {
  start: number;
  // Null while the block runs.
  end: number | null;
  // The field that the controls change.
  field: Field;
  now: number;
  // The latest end of the other blocks, or null when no other block ended.
  lastEnd: number | null;
  // True when the end can be set back to running.
  canRun: boolean;
  onField: (field: Field) => void;
  onStart: (time: number) => void;
  onEnd: (time: number | null) => void;
}

// The start and the end of a block without the date and time inputs of the
// system. Two cards show the start and the end; a tap selects the field that
// the controls below change. A tap on an hour and a tap on a minute set the
// time, a tap on a day button sets the day, and the shortcut buttons set the
// time to the start, to now, or move it by some minutes. A minute on the
// start selects the end, so that a block needs few taps.
export function TimePicker(props: TimePickerProps) {
  const { start, end, field, now } = props;
  const value = field === 'start' ? start : (end ?? now);
  const set = (time: number) => (field === 'start' ? props.onStart(time) : props.onEnd(time));
  const date = new Date(value);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const today = startOfDay(now);

  const card = (f: Field, label: string, time: number | null) => (
    <button
      type="button"
      className="time-card"
      role="tab"
      aria-selected={field === f}
      onClick={() => props.onField(f)}
    >
      <span className="time-card-label">{label}</span>
      <span className="time-card-day">{time === null ? '' : dayName(time, now)}</span>
      <span className="time-card-clock">{time === null ? 'Running' : clock(time)}</span>
    </button>
  );

  return (
    <div className="time-picker">
      <div className="time-cards" role="tablist" aria-label="Time">
        {card('start', 'Start', start)}
        {card('end', 'End', end)}
      </div>

      <div className="time-days">
        <button
          type="button"
          className="time-step"
          onClick={() => set(onDay(value, addDays(value, -1)))}
          aria-label="Previous day"
          title="Previous day"
        >
          <Icon name="back" size={18} />
        </button>
        <span className="time-day">{dayName(value, now)}</span>
        <button
          type="button"
          className="time-step"
          onClick={() => set(onDay(value, addDays(value, 1)))}
          aria-label="Next day"
          title="Next day"
        >
          <Icon name="next" size={18} />
        </button>
        <button
          type="button"
          aria-pressed={startOfDay(value) === today}
          onClick={() => set(onDay(value, today))}
        >
          Today
        </button>
        <button
          type="button"
          aria-pressed={startOfDay(value) === addDays(now, -1)}
          onClick={() => set(onDay(value, addDays(now, -1)))}
        >
          Yesterday
        </button>
      </div>

      <div className="time-hours" role="group" aria-label="Hour">
        {HOURS.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={h === hour}
            aria-label={`Hour ${h}`}
            onClick={() => set(withClock(value, h, minute))}
          >
            {pad(h)}
          </button>
        ))}
      </div>

      <div className="time-minutes" role="group" aria-label="Minute">
        {MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={m === minute}
            aria-label={`Minute ${m}`}
            onClick={() => {
              set(withClock(value, hour, m));
              if (field === 'start') props.onField('end');
            }}
          >
            :{pad(m)}
          </button>
        ))}
      </div>

      <div className="time-shortcuts">
        {field === 'start' ? (
          <button
            type="button"
            disabled={props.lastEnd === null}
            onClick={() => props.lastEnd !== null && set(props.lastEnd)}
            title="The end of the last block"
          >
            Last end
          </button>
        ) : (
          <button type="button" onClick={() => set(start)} title="The start of this block">
            Start
          </button>
        )}
        <button type="button" onClick={() => set(now)}>
          Now
        </button>
        {SHIFTS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => set(value + n * MINUTE)}
            aria-label={`${n < 0 ? 'Minus' : 'Plus'} ${Math.abs(n)} minutes`}
          >
            {n < 0 ? `−${-n}` : `+${n}`}
          </button>
        ))}
      </div>

      {field === 'end' && props.canRun && end !== null && (
        <button type="button" className="time-run" onClick={() => props.onEnd(null)}>
          Keep running
        </button>
      )}
    </div>
  );
}
