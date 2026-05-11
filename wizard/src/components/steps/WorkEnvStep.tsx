import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

const LOCATIONS = [
  { key: 'locClientHome', title: "Client's home (most common)", sub: 'Sessions take place at the family’s residence.' },
  { key: 'locAssistantHome', title: "Assistant's home (most common)", sub: 'Sessions take place at your residence (a few details required below).' },
  { key: 'locOnline', title: 'Online sessions (popular)', sub: 'Sessions delivered over video.' },
  { key: 'locCommunity', title: 'Community settings', sub: 'Parks, gyms, libraries, and other public spaces.' },
] as const;

interface YesNoProps {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
}

function YesNo({ label, value, onChange }: YesNoProps) {
  return (
    <div className="hw-yesno">
      <span className="hw-yesno__label">{label}</span>
      <div className="hw-yesno__buttons" role="radiogroup">
        <button
          type="button"
          className={`hw-yesno__btn is-yes ${value === true ? 'is-active' : ''}`}
          onClick={() => onChange(true)}
        >
          Yes
        </button>
        <button
          type="button"
          className={`hw-yesno__btn ${value === false ? 'is-active' : ''}`}
          onClick={() => onChange(false)}
        >
          No
        </button>
      </div>
    </div>
  );
}

export default function WorkEnvStep({ state, patch }: Props) {
  const hostsAtHome = !!state.locAssistantHome;
  const desc = (state.homeEnvDescription as string) || '';

  const toggle = (key: string) => patch({ [key]: !(state[key] as boolean) });

  const allSelected = LOCATIONS.every(l => !!state[l.key]);
  const toggleAll = () => {
    const next: Partial<WizardState> = {};
    const target = !allSelected;
    LOCATIONS.forEach(l => { (next as Record<string, boolean>)[l.key] = target; });
    patch(next);
  };

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 8 of 24 · About You</p>
      <h1 className="hw-step__title">Session Locations</h1>
      <p className="hw-step__sub">
        Sessions are delivered at the client's home, the assistant's home, in the community, or online. Please confirm where you are comfortable delivering sessions.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Where you're comfortable delivering sessions</h3>
        <p className="hw-card__sub">Select all that apply.</p>
        <div className="hw-multi">
          <button
            type="button"
            className={`hw-multi__item ${allSelected ? 'is-active' : ''}`}
            onClick={toggleAll}
          >
            <span className="hw-ack__box" aria-hidden="true" style={{ marginTop: 1 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="hw-multi__title">Anywhere is fine</span>
              <div className="hw-multi__sub">I'm comfortable delivering sessions in any of the locations below.</div>
            </span>
          </button>
          {LOCATIONS.map(loc => {
            const active = !!state[loc.key];
            return (
              <button
                key={loc.key}
                type="button"
                className={`hw-multi__item ${active ? 'is-active' : ''}`}
                onClick={() => toggle(loc.key)}
              >
                <span className="hw-ack__box" aria-hidden="true" style={{ marginTop: 1 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="hw-multi__title">{loc.title}</span>
                  <div className="hw-multi__sub">{loc.sub}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {hostsAtHome && (
        <div className="hw-card">
          <h3 className="hw-card__title">Hosting sessions at your home</h3>
          <p className="hw-card__sub">Required only if you selected the assistant's home above.</p>
          <div className="hw-yesno-stack">
            <YesNo
              label="Do you share your home with others (roommates, family, partner)?"
              value={state.homeShareStatus as boolean | undefined}
              onChange={v => patch({ homeShareStatus: v })}
            />
            <YesNo
              label="Is your home substance-free during working hours?"
              value={state.homeSubstanceFree as boolean | undefined}
              onChange={v => patch({ homeSubstanceFree: v })}
            />
          </div>

          <div className="hw-form-row">
            <label className="hw-label" htmlFor="homeEnvDescription">Brief description of your work setup at home</label>
            <textarea
              id="homeEnvDescription"
              className="hw-textarea"
              placeholder="e.g. quiet study room, separate from living areas, well-lit, with a desk and small whiteboard"
              value={desc}
              onChange={e => patch({ homeEnvDescription: e.target.value })}
            />
            <span className="hw-helper hw-helper--count">
              {desc.length} / minimum 20 characters
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
