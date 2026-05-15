import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

interface ContractCardProps {
  badge: string;
  amount: string;
  hours: string;
}

function ContractCard({ badge, amount, hours }: ContractCardProps) {
  return (
    <div className="hw-contract">
      <span className="hw-contract__badge">{badge}</span>
      <div className="hw-contract__amount">{amount}</div>
      <div className="hw-contract__meta">take-home per contract</div>
      <div className="hw-contract__divider" />
      <div className="hw-contract__feature">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" />
          <polyline points="5.5 8.2 7.2 9.8 10.5 6.5" />
        </svg>
        <span>{hours}</span>
      </div>
    </div>
  );
}

interface StackingCardProps {
  count: string;
  amount: string;
  hours: string;
}

function StackingCard({ count, amount, hours }: StackingCardProps) {
  return (
    <div className="hw-stack">
      <div className="hw-stack__count">{count}</div>
      <div className="hw-stack__amount">{amount}</div>
      <div className="hw-stack__period">per month</div>
      <div className="hw-stack__divider" />
      <div className="hw-stack__hours">{hours}</div>
    </div>
  );
}

export default function EarningsStep({ state, patch }: Props) {
  const a1 = !!state.contractorAck1;
  const a2 = !!state.contractorAck2;
  const a3 = !!state.contractorAck3;

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 4 of 25 · Compensation</p>
      <h1 className="hw-step__title">Compensation and Contract Structure</h1>
      <p className="hw-step__sub">
        Private Family Assistants are engaged as independent contractors. Compensation is built around the type of contract you take on. Below are the standard take-home amounts per contract.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Contract earnings</h3>
        <p className="hw-card__sub">
          Each contract is either one or two months long, with 24 or 40 total hours.
        </p>

        <div className="hw-contracts">
          <ContractCard badge="1-Month" amount="$504" hours="24 total hours" />
          <ContractCard badge="1-Month" amount="$840" hours="40 total hours" />
          <ContractCard badge="2-Month" amount="$756" hours="24 total hours" />
          <ContractCard badge="2-Month" amount="$1,260" hours="40 total hours" />
        </div>

        <p className="hw-contract-note">
          <strong>Pay cycle.</strong> Payments are issued bi-weekly after the initial probationary period. Long-term assistants in good standing may qualify for upfront payment per contract.
        </p>
      </div>

      <div className="hw-card">
        <h3 className="hw-card__title">Sample monthly earnings</h3>
        <p className="hw-card__sub">
          Most assistants run 2–5 contracts at a time. Below is what common stacking levels translate to per month for each contract type.
        </p>

        <div className="hw-stacking-group">
          <div className="hw-stacking-label">1-Month contracts</div>
          <div className="hw-stacking">
            <StackingCard count="2 contracts" amount="$1,008" hours="~12 hours per week" />
            <StackingCard count="3 contracts" amount="$1,512" hours="~18 hours per week" />
            <StackingCard count="5 contracts" amount="$2,520" hours="~30 hours per week" />
          </div>
        </div>

        <div className="hw-stacking-group">
          <div className="hw-stacking-label">2-Month contracts</div>
          <div className="hw-stacking">
            <StackingCard count="2 contracts" amount="$1,260" hours="~10 hours per week" />
            <StackingCard count="3 contracts" amount="$1,890" hours="~15 hours per week" />
            <StackingCard count="5 contracts" amount="$3,150" hours="~25 hours per week" />
          </div>
        </div>

        <p className="hw-contract-note" style={{ marginTop: 22 }}>
          <strong>Please note:</strong> <span className="hw-underline">these are only estimates.</span> Each family designs their own session schedule (2-hour minimum per session, no 30-minute or 1-hour sessions). Some families use their contract hours quickly across longer sessions and renew within weeks; others spread the hours across the full term. Faster usage means earlier renewals — and a higher monthly take-home.
        </p>
      </div>

      <div className="hw-card">
        <h3 className="hw-card__title">Acknowledgments</h3>
        <p className="hw-card__sub">
          Please review and confirm each of the following:
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
              <strong>Contractor status.</strong> I understand that I am engaged as an independent contractor and not an employee of Private Mentorship. I am responsible for my own taxes and reporting (CRA T2125 / GST as applicable).
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
              <strong>Pay cycle.</strong> I understand that payments are issued bi-weekly after the initial probationary period, based on completed sessions logged in the Private Mentorship system.
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
              <strong>Variable hours.</strong> I understand that hours vary based on demand and contract availability. Compensation is earned per completed session; weekly hours are not guaranteed.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
