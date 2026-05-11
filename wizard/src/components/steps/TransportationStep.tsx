import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

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

export default function TransportationStep({ state, patch }: Props) {
  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 7 of 24 · About You</p>
      <h1 className="hw-step__title">Transportation</h1>
      <p className="hw-step__sub">
        Your transportation options affect which contracts you can accept, especially for in-person sessions and community outings.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">How you get around</h3>
        <div className="hw-yesno-stack">
          <YesNo
            label="Do you have access to a personal vehicle?"
            value={state.hasCar as boolean | undefined}
            onChange={v => patch({ hasCar: v })}
          />
          <YesNo
            label="Are you willing to use public transit between sessions?"
            value={state.willingTransit as boolean | undefined}
            onChange={v => patch({ willingTransit: v })}
          />
          <YesNo
            label="Are you comfortable driving clients in a family vehicle when needed?"
            value={state.canDriveClients as boolean | undefined}
            onChange={v => patch({ canDriveClients: v })}
          />
          <YesNo
            label="Do you hold a valid Class 4 or 5 BC driver's license?"
            value={state.validLicense as boolean | undefined}
            onChange={v => patch({ validLicense: v })}
          />
        </div>
      </div>
    </div>
  );
}
