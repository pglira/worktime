import {
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type Backup, exportBackup, readBackup, restoreBackup } from './backup';
import {
  APP_ID,
  COLORS,
  type Block,
  type Data,
  type Label,
  type Period,
  addDays,
  days,
  formatDuration,
  formatHours,
  fromInputTime,
  isDataKey,
  loadData,
  nextColor,
  overlap,
  periodOf,
  removeBlock,
  removeLabel,
  runningBlock,
  saveBlock,
  saveData,
  saveLabel,
  sortedBlocks,
  startBlock,
  startOfDay,
  stopBlock,
  toInputTime,
  total,
} from './data';
import { Icon, type IconName } from './icons';
import { type Theme, useTheme } from './theme';

const THEME_ICONS: Record<Theme, IconName> = { auto: 'auto', light: 'sun', dark: 'moon' };
const THEME_LABELS: Record<Theme, string> = {
  auto: 'Theme: system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

// The open sheet. A block id of null makes a new block. A block sheet with
// stopped set opens right after the stop of the block, with the focus on the
// notes.
type Sheet =
  | { kind: 'block'; id: string | null; stopped?: boolean }
  | { kind: 'labels' }
  | { kind: 'backup' }
  | null;

type Route = 'overview' | null;

// The URL hash '#/overview' shows the overview, so that the back button of
// the browser returns to the start page.
function useRoute(): [Route, (route: Route) => void] {
  const read = (): Route => (location.hash.replace(/^#\/?/, '') === 'overview' ? 'overview' : null);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  const go = (next: Route) => {
    if (next === null && history.state?.page) history.back();
    else if (next === null) location.hash = '';
    else {
      history.pushState({ page: true }, '', `#/${next}`);
      setRoute(next);
    }
  };
  return [route, go];
}

// The current time, updated each second while a block runs and each minute
// otherwise.
function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), running ? 1000 : 60 * 1000);
    // A page that comes back from the background shows the time at once.
    const onVisible = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [running]);
  return now;
}

export default function App() {
  const [data, setData] = useState<Data>(loadData);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [route, go] = useRoute();
  const [theme, nextTheme] = useTheme();
  const running = runningBlock(data);
  const now = useNow(running !== undefined);

  useEffect(() => saveData(data), [data]);

  const close = () => setSheet(null);
  const sheetBlock = sheet?.kind === 'block' && sheet.id !== null ? data.blocks.find((b) => b.id === sheet.id) : undefined;

  const start = () => {
    setData((d) => startBlock(d, Date.now()));
  };
  const stop = () => {
    if (!running) return;
    setData((d) => stopBlock(d, running.id, Date.now()));
    setSheet({ kind: 'block', id: running.id, stopped: true });
  };

  const themeButton = (
    <button className="icon" onClick={nextTheme} aria-label={THEME_LABELS[theme]} title={THEME_LABELS[theme]}>
      <Icon name={THEME_ICONS[theme]} />
    </button>
  );

  return (
    <main>
      {route === 'overview' ? (
        <OverviewPage
          data={data}
          now={now}
          themeButton={themeButton}
          onBack={() => go(null)}
          onBackup={() => setSheet({ kind: 'backup' })}
        />
      ) : (
        <StartPage
          data={data}
          now={now}
          themeButton={themeButton}
          onStart={start}
          onStop={stop}
          onOverview={() => go('overview')}
          onLabels={() => setSheet({ kind: 'labels' })}
          onNew={() => setSheet({ kind: 'block', id: null })}
          onEdit={(id) => setSheet({ kind: 'block', id })}
          onDelete={(id) => setData((d) => removeBlock(d, id))}
          onToggleLabel={(block, labelId) =>
            setData((d) => saveBlock(d, { ...block, labelIds: toggle(block.labelIds, labelId) }, block.id))
          }
        />
      )}

      {sheet?.kind === 'block' && (sheet.id === null || sheetBlock) && (
        <BlockForm
          key={sheet.id ?? 'new'}
          block={sheetBlock}
          labels={data.labels}
          stopped={sheet.stopped ?? false}
          now={now}
          onAddLabel={(name) => {
            const id = crypto.randomUUID();
            setData((d) => saveLabel(d, { id, name, color: nextColor(d.labels) }));
            return id;
          }}
          onCancel={close}
          onSave={(block) => {
            setData((d) => saveBlock(d, block, sheet.id));
            close();
          }}
          onDelete={
            sheetBlock
              ? () => {
                  setData((d) => removeBlock(d, sheetBlock.id));
                  close();
                }
              : undefined
          }
        />
      )}

      {sheet?.kind === 'backup' && <BackupSheet onClose={close} />}

      {sheet?.kind === 'labels' && (
        <LabelsSheet
          labels={data.labels}
          onSave={(label) => setData((d) => saveLabel(d, label))}
          onDelete={(id) => setData((d) => removeLabel(d, id))}
          onClose={close}
        />
      )}
    </main>
  );
}

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
}

const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const weekdayDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// "Today", "Yesterday" or the weekday and the date.
function dayName(day: number, now: number): string {
  const today = startOfDay(now);
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return weekdayDate.format(day);
}

// The number of days of the recent past that the start page shows.
const RECENT_DAYS = 7;

interface StartPageProps {
  data: Data;
  now: number;
  themeButton: ReactNode;
  onStart: () => void;
  onStop: () => void;
  onOverview: () => void;
  onLabels: () => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleLabel: (block: Block, labelId: string) => void;
}

// The timer with the Start or Stop button, the totals of today, this week
// and this month, and the blocks of the recent days.
function StartPage(props: StartPageProps) {
  const { data, now } = props;
  const [swiped, setSwiped] = useState<string | null>(null);
  const running = runningBlock(data);
  const blocks = sortedBlocks(data);
  const today = startOfDay(now);
  const [weekFrom, weekTo] = periodOf('week', now, 0);
  const [monthFrom, monthTo] = periodOf('month', now, 0);
  const todayTotal = total(blocks, today, addDays(today, 1), now);
  const recent = days(addDays(today, 1 - RECENT_DAYS), addDays(today, 1))
    .reverse()
    .map((day) => ({ day, blocks: blocks.filter((b) => overlap(b, day, addDays(day, 1), now) > 0).reverse() }))
    .filter((d) => d.blocks.length > 0);

  return (
    <>
      <header>
        <h1>Worktime</h1>
        <div className="header-buttons">
          {props.themeButton}
          <button className="icon" onClick={props.onLabels} aria-label="Labels" title="Labels">
            <Icon name="tag" />
          </button>
          <button className="icon" onClick={props.onOverview} aria-label="Overview" title="Overview">
            <Icon name="bar" />
          </button>
          <button className="add" onClick={props.onNew} aria-label="Add a time block" title="Add a time block">
            <Icon name="plus" size={24} />
          </button>
        </div>
      </header>

      <section className={running ? 'timer running' : 'timer'}>
        {running ? (
          <>
            <div className="timer-head muted">Since {time.format(running.start)}</div>
            <div className="clock">{formatDuration(now - running.start, true)}</div>
            <LabelChips
              labels={data.labels}
              selected={running.labelIds}
              onToggle={(id) => props.onToggleLabel(running, id)}
            />
            <button className="link" onClick={() => props.onEdit(running.id)}>
              <Icon name="notes" />
              {running.notes.length > 0 ? `${running.notes.length} notes` : 'Add notes'}
            </button>
            <button className="big stop" onClick={props.onStop}>
              <Icon name="stop" size={24} />
              Stop
            </button>
          </>
        ) : (
          <>
            <div className="timer-head muted">Today</div>
            <div className="clock">{formatDuration(todayTotal)}</div>
            <button className="big start" onClick={props.onStart}>
              <Icon name="play" size={24} />
              Start
            </button>
          </>
        )}
      </section>

      <dl className="stats">
        <div>
          <dt>Today</dt>
          <dd>{formatDuration(todayTotal)}</dd>
        </div>
        <div>
          <dt>This week</dt>
          <dd>{formatDuration(total(blocks, weekFrom, weekTo, now))}</dd>
        </div>
        <div>
          <dt>This month</dt>
          <dd>{formatDuration(total(blocks, monthFrom, monthTo, now))}</dd>
        </div>
      </dl>

      {blocks.length === 0 && <p className="empty">No time blocks. Tap Start when you start to work.</p>}

      {recent.map(({ day, blocks }) => (
        <div key={day}>
          <h2 className="section day-head">
            <span>{dayName(day, now)}</span>
            <span>{formatDuration(total(blocks, day, addDays(day, 1), now))}</span>
          </h2>
          <ul className="entries">
            {blocks.map((block) => (
              <SwipeRow
                key={block.id}
                className="entry"
                open={swiped === `${day}/${block.id}`}
                onOpen={() => setSwiped(`${day}/${block.id}`)}
                onClose={() => setSwiped(null)}
                onEdit={() => {
                  setSwiped(null);
                  props.onEdit(block.id);
                }}
                onDelete={() => {
                  setSwiped(null);
                  props.onDelete(block.id);
                }}
              >
                <BlockRow block={block} labels={data.labels} now={now} onClick={() => props.onEdit(block.id)} />
              </SwipeRow>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

// One block in a list: the time range, the duration, the labels and the notes.
function BlockRow({ block, labels, now, onClick }: { block: Block; labels: Label[]; now: number; onClick: () => void }) {
  const blockLabels = labels.filter((l) => block.labelIds.includes(l.id));
  return (
    <button className="block-button" onClick={onClick}>
      <span className="block-line">
        <span className="entry-time">
          {time.format(block.start)} – {block.end === null ? 'now' : time.format(block.end)}
        </span>
        <span className="entry-value">{formatDuration((block.end ?? now) - block.start)}</span>
      </span>
      {blockLabels.length > 0 && (
        <span className="tags">
          {blockLabels.map((l) => (
            <span key={l.id} className="tag" style={{ '--color': l.color } as CSSProperties}>
              {l.name}
            </span>
          ))}
        </span>
      )}
      {block.notes.length > 0 && (
        <ul className="notes">
          {block.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
    </button>
  );
}

function LabelChips(props: { labels: Label[]; selected: string[]; onToggle: (id: string) => void }) {
  if (props.labels.length === 0) return null;
  return (
    <div className="chips" role="group" aria-label="Labels">
      {props.labels.map((l) => (
        <button
          key={l.id}
          type="button"
          className="chip"
          role="checkbox"
          aria-checked={props.selected.includes(l.id)}
          style={{ '--color': l.color } as CSSProperties}
          onClick={() => props.onToggle(l.id)}
        >
          {l.name}
        </button>
      ))}
    </div>
  );
}

const PERIOD_KEY = 'worktime.period';

function loadPeriod(): Period {
  try {
    return localStorage.getItem(PERIOD_KEY) === 'month' ? 'month' : 'week';
  } catch {
    return 'week';
  }
}

const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

// The ISO week number: the week with the first Thursday of the year is week 1.
function weekNumber(time: number): number {
  const d = new Date(time);
  // The Thursday of the week, in UTC so that no daylight saving shift applies.
  const thursday = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7)));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.floor((thursday.getTime() - yearStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function periodTitle(period: Period, from: number, to: number): string {
  if (period === 'month') return monthYear.format(from);
  return `Week ${weekNumber(from)} · ${shortDate.format(from)} – ${shortDate.format(addDays(to, -1))}`;
}

// The time of one week or one month: totals, a bar per day, the time per
// label and the blocks of each day with their notes.
function OverviewPage({
  data,
  now,
  themeButton,
  onBack,
  onBackup,
}: {
  data: Data;
  now: number;
  themeButton: ReactNode;
  onBack: () => void;
  onBackup: () => void;
}) {
  const [period, setPeriod] = useState<Period>(loadPeriod);
  const [shift, setShift] = useState(0);
  const [copied, setCopied] = useState(false);
  const [from, to] = periodOf(period, now, shift);
  const blocks = sortedBlocks(data).filter((b) => overlap(b, from, to, now) > 0);
  const perDay = days(from, to).map((day) => ({
    day,
    blocks: blocks.filter((b) => overlap(b, day, addDays(day, 1), now) > 0),
    ms: total(blocks, day, addDays(day, 1), now),
  }));
  const sum = total(blocks, from, to, now);
  const worked = perDay.filter((d) => d.ms > 0).length;
  const perLabel = [...data.labels, null]
    .map((label) => ({
      label,
      ms: total(
        blocks.filter((b) => (label ? b.labelIds.includes(label.id) : b.labelIds.length === 0)),
        from,
        to,
        now,
      ),
    }))
    .filter((l) => l.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  const labelNames = (b: Block) =>
    data.labels
      .filter((l) => b.labelIds.includes(l.id))
      .map((l) => l.name)
      .join(', ');

  useEffect(() => {
    try {
      localStorage.setItem(PERIOD_KEY, period);
    } catch {
      // The period stays for this session only.
    }
  }, [period]);

  // A plain text report of the period, for a time sheet or a mail.
  const copy = async () => {
    const lines = [`${periodTitle(period, from, to)}: ${formatDuration(sum)} (${formatHours(sum)})`];
    for (const d of perDay.filter((d) => d.ms > 0)) {
      lines.push('', `${weekdayDate.format(d.day)}: ${formatDuration(d.ms)}`);
      for (const b of d.blocks) {
        const names = labelNames(b);
        const end = b.end === null ? 'now' : time.format(b.end);
        lines.push(`  ${time.format(b.start)} – ${end}${names ? ` [${names}]` : ''}`);
        for (const note of b.notes) lines.push(`    - ${note}`);
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard is not available; the button shows no confirmation.
    }
  };

  return (
    <>
      <header>
        <div className="title">
          <button className="icon" onClick={onBack} aria-label="Back" title="Back">
            <Icon name="back" />
          </button>
          <h1>Overview</h1>
        </div>
        <div className="header-buttons">
          <button className="icon" onClick={onBackup} aria-label="Backup" title="Backup">
            <Icon name="backup" />
          </button>
          {themeButton}
        </div>
      </header>

      <div className="ranges" role="radiogroup" aria-label="Period">
        {(['week', 'month'] as const).map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={p === period}
            onClick={() => {
              setPeriod(p);
              setShift(0);
            }}
          >
            {p === 'week' ? 'Week' : 'Month'}
          </button>
        ))}
      </div>

      <div className="period-nav">
        <button className="icon" onClick={() => setShift((s) => s - 1)} aria-label="Previous" title="Previous">
          <Icon name="back" />
        </button>
        <button className="period-title" onClick={() => setShift(0)} title="Current period">
          {periodTitle(period, from, to)}
        </button>
        <button className="icon" onClick={() => setShift((s) => s + 1)} aria-label="Next" title="Next" disabled={shift >= 0}>
          <Icon name="next" />
        </button>
      </div>

      <dl className="stats">
        <div>
          <dt>Total</dt>
          <dd>{formatDuration(sum)}</dd>
        </div>
        <div>
          <dt>Days</dt>
          <dd>{worked}</dd>
        </div>
        <div>
          <dt>Per day</dt>
          <dd>{formatDuration(worked > 0 ? sum / worked : 0)}</dd>
        </div>
      </dl>

      <div className="panel">
        <DayBars perDay={perDay} period={period} now={now} />
      </div>

      {perLabel.length > 0 && (
        <>
          <h2 className="section">Labels</h2>
          <ul className="label-totals">
            {perLabel.map(({ label, ms }) => (
              <li key={label?.id ?? 'none'} style={{ '--color': label?.color ?? 'var(--muted)' } as CSSProperties}>
                <div className="label-line">
                  <span>{label?.name ?? 'No label'}</span>
                  <span className="entry-value">{formatDuration(ms)}</span>
                </div>
                <div className="meter">
                  <div style={{ width: `${(100 * ms) / sum}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="section day-head">
        <span>Days</span>
        {sum > 0 && (
          <button className="link" onClick={copy}>
            {copied ? 'Copied' : 'Copy as text'}
          </button>
        )}
      </h2>
      {sum === 0 && <p className="empty">No time in this period.</p>}
      {perDay
        .filter((d) => d.ms > 0)
        .map((d) => (
          <div key={d.day} className="day">
            <div className="day-line">
              <span>{weekdayDate.format(d.day)}</span>
              <span className="entry-value">{formatDuration(d.ms)}</span>
            </div>
            {d.blocks.map((b) => (
              <div key={b.id} className="day-block">
                <span className="muted">
                  {time.format(b.start)} – {b.end === null ? 'now' : time.format(b.end)}
                  {labelNames(b) && ` · ${labelNames(b)}`}
                </span>
                {b.notes.length > 0 && (
                  <ul className="notes">
                    {b.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}
    </>
  );
}

const weekdayLetter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

// A month chart labels the 1st, each 5th day and today, so that the labels fit.
function monthDayLabel(day: number, today: number): string {
  const date = new Date(day).getDate();
  return date === 1 || date % 5 === 0 || day === today ? String(date) : '';
}

// A bar per day. The scale has a full hour as its top, at least 8 h.
function DayBars({ perDay, period, now }: { perDay: { day: number; ms: number }[]; period: Period; now: number }) {
  const HOUR = 60 * 60 * 1000;
  const top = Math.max(8, Math.ceil(Math.max(...perDay.map((d) => d.ms)) / HOUR)) * HOUR;
  const today = startOfDay(now);
  return (
    <div className={`bars ${period}`}>
      {perDay.map((d) => (
        <div key={d.day} className={d.day === today ? 'bar today' : 'bar'} title={`${weekdayDate.format(d.day)}: ${formatDuration(d.ms)}`}>
          {period === 'week' && <span className="bar-value">{d.ms > 0 ? formatDuration(d.ms) : ''}</span>}
          <div className="bar-track">
            <div className="bar-fill" style={{ height: `${(100 * d.ms) / top}%` }} />
          </div>
          <span className="bar-label">
            {period === 'week' ? weekdayLetter.format(d.day) : monthDayLabel(d.day, today)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Width of the swipe actions in pixels, and the distance a pointer must move
// before a row starts to follow it.
const SWIPE_WIDTH = 160;
const SWIPE_SLOP = 10;

interface SwipeRowProps {
  className: string;
  style?: CSSProperties;
  // Ask for a second tap before the delete.
  confirmDelete?: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  children: ReactNode;
}

// A list row that shows the Edit and Delete actions when the user swipes it
// to the left. A swipe to the right, a tap on the row or a tap outside the row
// hides the actions. A tap that ends a swipe does not reach the row content.
function SwipeRow(props: SwipeRowProps) {
  const { className, style, open, onOpen, onClose, children } = props;
  const row = useRef<HTMLLIElement>(null);
  const gesture = useRef<{ x: number; y: number; swiping: boolean } | null>(null);
  const swiped = useRef(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const base = open ? -SWIPE_WIDTH : 0;
  const offset = drag ?? base;

  useEffect(() => {
    if (!open) {
      setArmed(false);
      return;
    }
    const onDown = (e: globalThis.PointerEvent) => {
      if (!row.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, onClose]);

  const position = (e: PointerEvent) =>
    Math.min(0, Math.max(-SWIPE_WIDTH, base + e.clientX - gesture.current!.x));

  const onPointerDown = (e: PointerEvent) => {
    gesture.current = { x: e.clientX, y: e.clientY, swiping: false };
    swiped.current = false;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (!g.swiping) {
      const dx = Math.abs(e.clientX - g.x);
      const dy = Math.abs(e.clientY - g.y);
      if (dy > SWIPE_SLOP && dy > dx) gesture.current = null;
      if (dx <= SWIPE_SLOP || dx <= dy) return;
      g.swiping = true;
      swiped.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDrag(position(e));
  };

  const onPointerUp = (e: PointerEvent) => {
    if (gesture.current?.swiping) {
      if (position(e) < -SWIPE_WIDTH / 2) onOpen();
      else onClose();
    }
    gesture.current = null;
    setDrag(null);
  };

  return (
    <li ref={row} className="swipe">
      <div className="swipe-actions" style={{ width: SWIPE_WIDTH }} aria-hidden={!open}>
        <button className="swipe-edit" tabIndex={open ? 0 : -1} onClick={props.onEdit}>
          <Icon name="edit" />
          Edit
        </button>
        <button
          className="swipe-delete"
          tabIndex={open ? 0 : -1}
          onClick={() => (props.confirmDelete && !armed ? setArmed(true) : props.onDelete())}
        >
          <Icon name="trash" />
          {armed ? 'Confirm' : 'Delete'}
        </button>
      </div>
      <div
        className={drag === null ? `${className} settle` : className}
        style={{ ...style, transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(null);
        }}
        onClickCapture={(e) => {
          if (!swiped.current && !open) return;
          e.preventDefault();
          e.stopPropagation();
          if (!swiped.current) onClose();
          swiped.current = false;
        }}
      >
        {children}
      </div>
    </li>
  );
}

function SheetFrame(props: {
  title: string;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onCancel]);

  return (
    <div className="backdrop" onClick={props.onCancel}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <h2>{props.title}</h2>
        {props.children}
      </form>
    </div>
  );
}

// A Delete button that asks for a second tap.
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className="delete" onClick={() => (armed ? onDelete() : setArmed(true))}>
      {armed ? 'Tap to delete' : 'Delete'}
    </button>
  );
}

// Edit a list of notes. Enter in the last field adds the text as a new item;
// Enter in an empty last field submits the form.
function NotesEditor(props: {
  notes: string[];
  draft: string;
  autoFocus: boolean;
  onNotes: (notes: string[]) => void;
  onDraft: (draft: string) => void;
}) {
  const { notes, draft } = props;
  return (
    <div className="notes-editor">
      {notes.map((note, i) => (
        <div key={i} className="note-row">
          <input
            value={note}
            onChange={(e) => props.onNotes(notes.map((n, j) => (j === i ? e.target.value : n)))}
            aria-label={`Note ${i + 1}`}
          />
          <button
            type="button"
            className="icon"
            onClick={() => props.onNotes(notes.filter((_, j) => j !== i))}
            aria-label={`Remove note ${i + 1}`}
            title="Remove"
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      <div className="note-row">
        <input
          autoFocus={props.autoFocus}
          value={draft}
          enterKeyHint="enter"
          placeholder={notes.length === 0 ? 'What did you do?' : 'Next item'}
          aria-label="New note"
          onChange={(e) => props.onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || draft.trim() === '') return;
            e.preventDefault();
            props.onNotes([...notes, draft.trim()]);
            props.onDraft('');
          }}
        />
        <button
          type="button"
          className="icon"
          disabled={draft.trim() === ''}
          onClick={() => {
            props.onNotes([...notes, draft.trim()]);
            props.onDraft('');
          }}
          aria-label="Add note"
          title="Add"
        >
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

interface BlockFormProps {
  block?: Block;
  labels: Label[];
  stopped: boolean;
  now: number;
  onAddLabel: (name: string) => string;
  onSave: (block: Omit<Block, 'id'>) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

// Edit the notes, the labels and the times of a block. A new block ends now
// and starts one hour earlier.
function BlockForm({ block, labels, stopped, now, onAddLabel, onSave, onCancel, onDelete }: BlockFormProps) {
  const [notes, setNotes] = useState(block?.notes ?? []);
  const [draft, setDraft] = useState('');
  const [labelIds, setLabelIds] = useState(block?.labelIds ?? []);
  const [newLabel, setNewLabel] = useState('');
  const [initialStart] = useState(() => block?.start ?? now - 60 * 60 * 1000);
  const [initialEnd] = useState(() => (block ? block.end : now));
  const [start, setStart] = useState(() => toInputTime(initialStart));
  const [end, setEnd] = useState(() => (initialEnd === null ? null : toInputTime(initialEnd)));
  // The inputs show minutes only; an unchanged input keeps the exact time.
  const startTime = start === toInputTime(initialStart) ? initialStart : fromInputTime(start);
  const endTime = end === null ? null : initialEnd !== null && end === toInputTime(initialEnd) ? initialEnd : fromInputTime(end);
  const valid = startTime !== null && (end === null || (endTime !== null && endTime >= startTime));
  const duration = valid ? (endTime ?? now) - startTime : 0;

  const addLabel = () => {
    const name = newLabel.trim();
    if (!name) return;
    const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    const id = existing?.id ?? onAddLabel(name);
    setLabelIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setNewLabel('');
  };

  const title = stopped ? `Stopped · ${formatDuration(duration)}` : block ? `Time block · ${formatDuration(duration)}` : 'New time block';

  const save = () =>
    valid &&
    onSave({
      start: startTime,
      end: endTime,
      labelIds,
      notes: [...notes, draft].map((n) => n.trim()).filter(Boolean),
    });

  // After a stop, every way to close the sheet keeps the input. An invalid
  // input closes the sheet and leaves the stopped block as it is.
  return (
    <SheetFrame title={title} onCancel={stopped ? () => save() || onCancel() : onCancel} onSubmit={save}>
      <div className="field">
        <span className="field-label">Notes</span>
        <NotesEditor notes={notes} draft={draft} autoFocus={stopped} onNotes={setNotes} onDraft={setDraft} />
      </div>
      <div className="field">
        <span className="field-label">Labels</span>
        <LabelChips labels={labels} selected={labelIds} onToggle={(id) => setLabelIds((ids) => toggle(ids, id))} />
        <div className="note-row">
          <input
            value={newLabel}
            placeholder="New label"
            aria-label="New label"
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              addLabel();
            }}
          />
          <button type="button" className="icon" disabled={newLabel.trim() === ''} onClick={addLabel} aria-label="Add label" title="Add label">
            <Icon name="plus" />
          </button>
        </div>
      </div>
      <div className="row">
        <label className="grow">
          Start
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="grow">
          End
          {end === null ? (
            <input value="Running" disabled />
          ) : (
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          )}
        </label>
      </div>
      {end !== null && endTime !== null && startTime !== null && endTime < startTime && (
        <p className="error">The end is before the start.</p>
      )}
      <div className="buttons">
        {onDelete && <DeleteButton onDelete={onDelete} />}
        {!stopped && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={!valid}>
          {stopped ? 'Done' : 'Save'}
        </button>
      </div>
    </SheetFrame>
  );
}

// Rename, recolor and delete labels. Each change applies at once.
function LabelsSheet(props: {
  labels: Label[];
  onSave: (label: Label) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const add = () => {
    if (!name.trim()) return;
    props.onSave({ id: crypto.randomUUID(), name: name.trim(), color: nextColor(props.labels) });
    setName('');
  };
  const recolor = (label: Label) => {
    const next = COLORS[(COLORS.indexOf(label.color) + 1) % COLORS.length];
    props.onSave({ ...label, color: next });
  };

  return (
    <SheetFrame title="Labels" onCancel={props.onClose} onSubmit={add}>
      {props.labels.length === 0 && <p className="muted">No labels. Use labels for projects or tasks.</p>}
      {props.labels.map((label) => (
        <div key={label.id} className="note-row">
          <button
            type="button"
            className="swatch-button"
            style={{ background: label.color }}
            onClick={() => recolor(label)}
            aria-label={`Change the color of ${label.name}`}
            title="Change color"
          />
          <input
            value={label.name}
            aria-label="Label name"
            onChange={(e) => props.onSave({ ...label, name: e.target.value })}
          />
          <button
            type="button"
            className={armed === label.id ? 'icon armed' : 'icon'}
            onClick={() => (armed === label.id ? props.onDelete(label.id) : setArmed(label.id))}
            aria-label={armed === label.id ? `Tap to delete ${label.name}` : `Delete ${label.name}`}
            title={armed === label.id ? 'Tap to delete' : 'Delete'}
          >
            <Icon name="trash" />
          </button>
        </div>
      ))}
      <div className="note-row">
        <input value={name} placeholder="New label" aria-label="New label" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="icon" disabled={name.trim() === ''} aria-label="Add label" title="Add label">
          <Icon name="plus" />
        </button>
      </div>
      <div className="buttons">
        <button type="button" className="primary" onClick={props.onClose}>
          Done
        </button>
      </div>
    </SheetFrame>
  );
}

const backupDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Export all data to a backup file, or replace all data with the data of a
// backup file. The replacement needs a second tap and reloads the app.
function BackupSheet({ onClose }: { onClose: () => void }) {
  const [backup, setBackup] = useState<Backup | null>(null);
  const [error, setError] = useState('');

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input so that the same file can be selected again.
    e.target.value = '';
    if (!file) return;
    try {
      setBackup(readBackup(await file.text(), APP_ID));
      setError('');
    } catch (err) {
      setBackup(null);
      setError(err instanceof Error ? err.message : 'The file cannot be read.');
    }
  };

  return (
    <SheetFrame title="Backup" onCancel={onClose} onSubmit={onClose}>
      <p className="muted">Export all data to a file. Import the file on the new phone.</p>
      <div className="file-buttons">
        <button type="button" className="file-button" onClick={() => exportBackup(APP_ID, isDataKey)}>
          <Icon name="backup" size={18} />
          Export
        </button>
        <label className="file-button">
          <Icon name="upload" size={18} />
          Import
          <input type="file" accept="application/json,.json" hidden onChange={importFile} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {backup && (
        <>
          <p className="muted">Backup of {backupDate.format(new Date(backup.exported))}</p>
          <button
            type="button"
            className="replace"
            onClick={() => {
              restoreBackup(backup, isDataKey);
              location.reload();
            }}
          >
            Tap to replace all data
          </button>
        </>
      )}
      <div className="buttons">
        <button type="submit" className="primary">
          Close
        </button>
      </div>
    </SheetFrame>
  );
}
