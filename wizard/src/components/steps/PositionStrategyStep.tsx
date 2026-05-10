import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

const FORMATS = [
  { key: 'IN_PERSON', title: 'In-person only', sub: 'You meet families face-to-face. Most contracts.' },
  { key: 'ONLINE', title: 'Online only', sub: 'You work over video. Limited availability.' },
  { key: 'HYBRID', title: 'Both — in-person and online', sub: 'Best match rate. Most flexible.' },
] as const;

const SERVICES = [
  { key: 'EDUCATION', title: 'Education', sub: '1-on-1 lessons, homework help, school re-teach, ESL, study strategies.' },
  { key: 'LIFE_SKILLS', title: 'Life Skills', sub: 'Communication, social practice, daily routines, transit, independence.' },
  { key: 'PERSONAL_SUPPORT', title: 'Personal Support', sub: 'Appointments, errands, transportation, paperwork, advocacy.' },
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
      <p className="hw-step__eyebrow">Step 3 of 24 · The work</p>
      <h1 className="hw-step__title">What kind of work are you open to?</h1>
      <p className="hw-step__sub">
        These answers help us match you with the right contracts. Choose what you are genuinely comfortable with.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Format</h3>
        <p className="hw-card__sub">Pick one — you can change this later if your situation changes.</p>
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
        <h3 className="hw-card__title">Service types</h3>
        <p className="hw-card__sub">Pick every type you'd be comfortable with. You'll only get matched within these.</p>
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
