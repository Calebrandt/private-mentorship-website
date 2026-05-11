import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

const VALUES = [
  { key: 'valPatience', title: 'Patience', sub: 'Meeting clients where they are without pushing.' },
  { key: 'valStructure', title: 'Structure', sub: 'Clear routines and consistent follow-through.' },
  { key: 'valAccountability', title: 'Accountability', sub: 'Owning outcomes and reporting honestly.' },
  { key: 'valSafety', title: 'Safety', sub: 'Protecting clients in every setting.' },
  { key: 'valAcademic', title: 'Academic focus', sub: 'Strong commitment to learning outcomes.' },
  { key: 'valIndependence', title: 'Independence', sub: 'Building skills the client can carry forward.' },
] as const;

export default function ValuesStep({ state, patch }: Props) {
  const summary = (state.valSummary as string) || '';
  const toggle = (key: string) => patch({ [key]: !(state[key] as boolean) });

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 12 of 24 · About You</p>
      <h1 className="hw-step__title">Values and Approach</h1>
      <p className="hw-step__sub">
        Select the values that best reflect how you work with families and clients. Choose only those that genuinely apply.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Core values</h3>
        <p className="hw-card__sub">Select all that apply.</p>
        <div className="hw-multi">
          {VALUES.map(v => {
            const active = !!state[v.key];
            return (
              <button
                key={v.key}
                type="button"
                className={`hw-multi__item ${active ? 'is-active' : ''}`}
                onClick={() => toggle(v.key)}
              >
                <span className="hw-ack__box" aria-hidden="true" style={{ marginTop: 1 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="hw-multi__title">{v.title}</span>
                  <div className="hw-multi__sub">{v.sub}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hw-card">
        <h3 className="hw-card__title">In your own words</h3>
        <p className="hw-card__sub">How would you describe your approach to working with families?</p>
        <div className="hw-form-row">
          <textarea
            className="hw-textarea"
            placeholder="e.g. I focus on building trust first, then quietly pushing growth through small consistent wins."
            value={summary}
            onChange={e => patch({ valSummary: e.target.value })}
          />
          <span className="hw-helper hw-helper--count">
            {summary.length} / minimum 20 characters
          </span>
        </div>
      </div>
    </div>
  );
}
