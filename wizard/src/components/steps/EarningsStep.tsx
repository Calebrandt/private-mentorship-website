import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

export default function EarningsStep({ state, patch }: Props) {
  const a1 = !!state.contractorAck1;
  const a2 = !!state.contractorAck2;
  const a3 = !!state.contractorAck3;

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 4 of 24 · Pay &amp; contractor terms</p>
      <h1 className="hw-step__title">How pay works.</h1>
      <p className="hw-step__sub">
        Assistants are paid as independent contractors. Read the rates and confirm you understand the terms.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Sample rates</h3>
        <p className="hw-card__sub">
          A blended starting point. Specific contracts may pay more for specialized skills.
        </p>
        <div className="hw-rates">
          <div className="hw-rates__row hw-rates__row--head">
            <span>Activity</span>
            <span>Per hour</span>
          </div>
          <div className="hw-rates__row">
            <span className="hw-rates__label">Standard sessions</span>
            <span className="hw-rates__value">$22 – $28</span>
          </div>
          <div className="hw-rates__row">
            <span className="hw-rates__label">Specialized (ESL, post-secondary, complex needs)</span>
            <span className="hw-rates__value">$28 – $38</span>
          </div>
          <div className="hw-rates__row">
            <span className="hw-rates__label">Travel time between client locations</span>
            <span className="hw-rates__value">Reimbursed</span>
          </div>
          <div className="hw-rates__row hw-rates__row--total">
            <span>Typical bi-weekly payout window</span>
            <span>14 days</span>
          </div>
        </div>

        <p className="hw-card__sub" style={{ marginTop: 18, marginBottom: 12 }}>
          Acknowledge all three:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            className={`hw-ack ${a1 ? 'is-active' : ''}`}
            onClick={() => patch({ contractorAck1: !a1 })}
          >
            <span className="hw-ack__box" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="hw-ack__text">
              <strong>Contractor status.</strong> I work as an independent contractor — not an employee. I'm responsible for my own taxes (CRA T2125 / GST as applicable).
            </span>
          </button>

          <button
            type="button"
            className={`hw-ack ${a2 ? 'is-active' : ''}`}
            onClick={() => patch({ contractorAck2: !a2 })}
          >
            <span className="hw-ack__box" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="hw-ack__text">
              <strong>Pay cycle.</strong> I'm paid every two weeks via e-transfer or direct deposit, based on completed sessions logged in the Private Mentorship system.
            </span>
          </button>

          <button
            type="button"
            className={`hw-ack ${a3 ? 'is-active' : ''}`}
            onClick={() => patch({ contractorAck3: !a3 })}
          >
            <span className="hw-ack__box" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="hw-ack__text">
              <strong>No guarantees.</strong> Hours vary by demand and matching. I'll only be paid for sessions I actually run; nothing is guaranteed week-to-week.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
