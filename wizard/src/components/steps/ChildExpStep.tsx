import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

const AGE_GROUPS = [
  { key: 'childAges_0_5', title: '0–5 years', sub: 'Early childhood.' },
  { key: 'childAges_6_12', title: '6–12 years', sub: 'School age.' },
  { key: 'childAges_13_18', title: '13–18 years', sub: 'Teen and young adult.' },
] as const;

export default function ChildExpStep({ state, patch }: Props) {
  const summary = (state.childExpSummary as string) || '';
  const toggle = (key: string) => patch({ [key]: !(state[key] as boolean) });

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 12 of 25 · About You</p>
      <h1 className="hw-step__title">Child and Family Experience</h1>
      <p className="hw-step__sub">
        Most contracts involve children or young adults. Tell us about your direct experience working with younger people.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Age groups you've worked with</h3>
        <p className="hw-card__sub">Select all that apply.</p>
        <div className="hw-multi">
          {AGE_GROUPS.map(g => {
            const active = !!state[g.key];
            return (
              <button
                key={g.key}
                type="button"
                className={`hw-multi__item ${active ? 'is-active' : ''}`}
                onClick={() => toggle(g.key)}
              >
                <span className="hw-ack__box" aria-hidden="true" style={{ marginTop: 1 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="hw-multi__title">{g.title}</span>
                  <div className="hw-multi__sub">{g.sub}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hw-card">
        <h3 className="hw-card__title">Your experience</h3>
        <p className="hw-card__sub">A short paragraph is enough. Concrete examples are welcome.</p>
        <div className="hw-form-row">
          <textarea
            className="hw-textarea"
            placeholder="e.g. Three years tutoring an after-school program for ages 6–12; led group activities for siblings ages 4–14 in an extended-family setting."
            value={summary}
            onChange={e => patch({ childExpSummary: e.target.value })}
          />
          <span className="hw-helper hw-helper--count">
            {summary.length} / minimum 30 characters
          </span>
        </div>
      </div>
    </div>
  );
}
