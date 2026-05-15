import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

const FORMATS = [
  { key: 'IN_PERSON', title: 'In-person only', sub: 'Sessions take place at the homebase or in the community.' },
  { key: 'ONLINE', title: 'Online only', sub: 'Sessions take place over video. Limited contracts available.' },
  { key: 'HYBRID', title: 'Both — in-person and online', sub: "A mix of in-person and online sessions, depending on the family's needs." },
] as const;

const SERVICES = [
  { key: 'EDUCATION', title: 'Education', sub: 'One-on-one teaching of school subjects, ESL, post-secondary prep, and hard skills.' },
  { key: 'LIFE_SKILLS', title: 'Life Skills', sub: 'Communication, socialization, real-world outings, and confidence-building activities.' },
  { key: 'PERSONAL_SUPPORT', title: 'Personal Support', sub: 'Errands, meal prep, transportation, family coordination, and light home tasks.' },
];

export default function PositionStrategyStep({ state, patch }: Props) {
  const format = state.formatSelection;
  const services = (state.serviceTypes as string[]) || [];

  const toggleService = (key: string) => {
    const next = services.includes(key)
      ? services.filter(s => s !== key)
      : [...services, key];
    patch({ serviceTypes: next });
  };

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 3 of 25 · Role preferences</p>
      <h1 className="hw-step__title">Role and Work Preferences</h1>
      <p className="hw-step__sub">
        Your selections help us match you with the right family contracts. You can update these preferences any time after applying.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Work setting</h3>
        <p className="hw-card__sub">How would you prefer to work with families?</p>
        <div className="hw-choices">
          {FORMATS.map(f => (
            <button
              key={f.key}
              type="button"
              className={`hw-choice ${format === f.key ? 'is-active' : ''}`}
              onClick={() => patch({ formatSelection: f.key })}
            >
              <span className="hw-choice__bullet" aria-hidden="true" />
              <span className="hw-choice__body">
                <span className="hw-choice__title">{f.title}</span>
                <span className="hw-choice__sub">{f.sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="hw-card">
        <h3 className="hw-card__title">Areas of support</h3>
        <p className="hw-card__sub">Which areas of support are you comfortable providing? You will only be matched with contracts within the areas you select.</p>
        <div className="hw-multi">
          {SERVICES.map(s => {
            const active = services.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                className={`hw-multi__item ${active ? 'is-active' : ''}`}
                onClick={() => toggleService(s.key)}
              >
                <span className="hw-ack__box" aria-hidden="true" style={{ marginTop: 1 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="hw-multi__title">{s.title}</span>
                  <div className="hw-multi__sub">{s.sub}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
