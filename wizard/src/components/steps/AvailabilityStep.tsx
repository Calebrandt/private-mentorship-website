import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

const WINDOWS = [
  { key: 'availWeekdays', title: 'Weekdays', sub: 'Monday–Friday, during the daytime.' },
  { key: 'availEvenings', title: 'Evenings', sub: 'Sessions after 5pm.' },
  { key: 'availWeekends', title: 'Weekends', sub: 'Saturday and Sunday.' },
] as const;

export default function AvailabilityStep({ state, patch }: Props) {
  const toggle = (key: string) => patch({ [key]: !(state[key] as boolean) });
  const minHours = (state.minHoursPerWeek as number | undefined) ?? '';

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 10 of 25 · About You</p>
      <h1 className="hw-step__title">Availability</h1>
      <p className="hw-step__sub">
        When you're typically free for sessions. Each contract's exact schedule is co-created with the family at orientation.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">General availability</h3>
        <p className="hw-card__sub">Select all that apply.</p>
        <div className="hw-multi">
          {WINDOWS.map(w => {
            const active = !!state[w.key];
            return (
              <button
                key={w.key}
                type="button"
                className={`hw-multi__item ${active ? 'is-active' : ''}`}
                onClick={() => toggle(w.key)}
              >
                <span className="hw-ack__box" aria-hidden="true" style={{ marginTop: 1 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="hw-multi__title">{w.title}</span>
                  <div className="hw-multi__sub">{w.sub}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hw-card">
        <h3 className="hw-card__title">Weekly capacity</h3>
        <p className="hw-card__sub">A rough minimum we can plan around. You can always take on more.</p>
        <div className="hw-form-row">
          <label className="hw-label" htmlFor="minHoursPerWeek">Minimum hours per week available</label>
          <input
            id="minHoursPerWeek"
            type="number"
            className="hw-input"
            placeholder="e.g. 12"
            min={0}
            max={60}
            value={minHours}
            onChange={e => {
              const v = e.target.value;
              patch({ minHoursPerWeek: v === '' ? undefined : Number(v) });
            }}
            style={{ maxWidth: 180 }}
          />
          <span className="hw-helper">Used for matching only. Not a binding minimum.</span>
        </div>
      </div>
    </div>
  );
}
