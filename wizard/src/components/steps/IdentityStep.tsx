import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

export default function IdentityStep({ state, patch }: Props) {
  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 5 of 24 · About You</p>
      <h1 className="hw-step__title">Personal Information</h1>
      <p className="hw-step__sub">
        This information is used for identity verification and contract paperwork. It is not shared with families.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Your details</h3>
        <p className="hw-card__sub">All fields below are required.</p>

        <div className="hw-form-row">
          <label className="hw-label" htmlFor="legalName">Legal name</label>
          <input
            id="legalName"
            type="text"
            className="hw-input"
            placeholder="e.g. Vincent Brandt"
            value={(state.legalName as string) || ''}
            onChange={e => patch({ legalName: e.target.value })}
          />
          <span className="hw-helper">Must match the name on your photo ID.</span>
        </div>

        <div className="hw-form-row">
          <label className="hw-label" htmlFor="preferredName">Preferred name</label>
          <input
            id="preferredName"
            type="text"
            className="hw-input"
            placeholder="e.g. Vinny"
            value={(state.preferredName as string) || ''}
            onChange={e => patch({ preferredName: e.target.value })}
          />
          <span className="hw-helper">This is the name families will see if you are matched.</span>
        </div>

        <div className="hw-form-grid">
          <div className="hw-form-row">
            <label className="hw-label" htmlFor="phone">Phone number</label>
            <input
              id="phone"
              type="tel"
              className="hw-input"
              placeholder="(604) 555-0123"
              value={(state.phone as string) || ''}
              onChange={e => patch({ phone: e.target.value })}
            />
            <span className="hw-helper">Used for contract communication only.</span>
          </div>
          <div className="hw-form-row">
            <label className="hw-label" htmlFor="dob">Date of birth</label>
            <input
              id="dob"
              type="date"
              className="hw-input"
              value={(state.dob as string) || ''}
              onChange={e => patch({ dob: e.target.value })}
            />
            <span className="hw-helper">You must be at least 19 years of age.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
