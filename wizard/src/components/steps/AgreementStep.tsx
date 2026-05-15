import { useEffect, useRef, useState } from 'react';
import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

const AGREEMENT_VERSION = '2026-05-12-v1';

interface ClauseDef {
  key: string;
  label: string;
  plainEnglish: string;
}

// The twelve clauses that require an initial. Each one is rendered inline
// inside the contract text below; clicking the stamp captures a timestamp.
const CLAUSES: ClauseDef[] = [
  {
    key: 'contractor-status',
    label: 'Independent contractor status',
    plainEnglish: 'You are self-employed. Not an employee. No CPP, EI, vacation, or sick pay from PM.',
  },
  {
    key: 'method-control',
    label: 'You control your own method and manner of work',
    plainEnglish: 'PM does not direct how you deliver care. You use your own skills and judgment.',
  },
  {
    key: 'per-engagement',
    label: 'Per-engagement structure and right to decline',
    plainEnglish: 'Each Engagement is a separate contract. You can decline any Engagement, any time.',
  },
  {
    key: 'substitution',
    label: 'Right of substitution and Backup Assistants',
    plainEnglish: 'If you cannot make a session, another qualified Assistant from the Platform can fill in (with the Client’s approval).',
  },
  {
    key: 'fee-split',
    label: 'Fee structure — 30% Platform Fee, 70% to the Assistant',
    plainEnglish: 'You keep 70% of each Engagement Fee. PM keeps 30% as a Platform Fee.',
  },
  {
    key: 'taxes',
    label: 'T4A, self-tax filing, no source deductions',
    plainEnglish: 'You receive a T4A (not a T4). You file your income on Form T2125 and remit your own taxes.',
  },
  {
    key: 'refund',
    label: 'Completion of Engagement and refund of unearned fees',
    plainEnglish: 'You must deliver the hours you were paid for. If you do not, you refund the unearned amount within 14 days.',
  },
  {
    key: 'abandonment',
    label: 'Abandonment Fee tier table',
    plainEnglish: 'If you abandon an Engagement (14+ days no contact), you owe an Abandonment Fee: $350 / $900 / $1,500 depending on Engagement size.',
  },
  {
    key: 'legal-recourse',
    label: 'Legal recourse — CRT, Small Claims, BC Supreme Court',
    plainEnglish: 'PM may sue in BC tribunals or courts to recover unearned fees or enforce this Agreement.',
  },
  {
    key: 'non-exclusive',
    label: 'Non-exclusivity — you are encouraged to work elsewhere',
    plainEnglish: 'PM expects you to have other clients, gigs, or jobs. Exclusivity is not required.',
  },
  {
    key: 'non-solicit',
    label: 'Non-solicitation — 12-month restriction and liquidated damages',
    plainEnglish: 'You may not take a PM-introduced Client off-Platform for 12 months after an Engagement ends.',
  },
  {
    key: 'vocabulary',
    label: 'Self-employment vocabulary',
    plainEnglish: 'We use “Assistant,” “engagement fee,” “Platform fee,” “end of engagement” — not “employee,” “wages,” “termination.”',
  },
];

// ─── Drawable signature pad (used for both initials and full signature) ──
interface PadProps {
  value: string | undefined;
  onChange: (dataUrl: string) => void;
  onClear: () => void;
  height?: number;
  placeholder?: string;
  ariaLabel: string;
}

function SignaturePad({ value, onChange, onClear, height = 120, placeholder, ariaLabel }: PadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasStrokesRef = useRef(false);
  const [resizeTick, setResizeTick] = useState(0);

  // Set up canvas size to match container width.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1d1d1f';
      ctx.lineWidth = 2.2;
    }
    // If we have an existing value, redraw it on resize.
    if (value) {
      const img = new Image();
      img.onload = () => {
        if (ctx) ctx.drawImage(img, 0, 0, rect.width, height);
      };
      img.src = value;
    }
    const onResize = () => setResizeTick(t => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, resizeTick]);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const last = lastPointRef.current;
    const next = getPoint(e);
    if (!last) {
      lastPointRef.current = next;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastPointRef.current = next;
    hasStrokesRef.current = true;
  }

  function end() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (hasStrokesRef.current) {
      const url = canvas.toDataURL('image/png');
      onChange(url);
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokesRef.current = false;
    onClear();
  }

  return (
    <div className="hw-sigpad" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="hw-sigpad__canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        aria-label={ariaLabel}
        role="img"
      />
      {!value && placeholder && (
        <div className="hw-sigpad__placeholder" aria-hidden="true">{placeholder}</div>
      )}
      <button type="button" className="hw-sigpad__clear" onClick={handleClear}>
        Clear
      </button>
    </div>
  );
}

// ─── Inline initial stamp button ──
interface StampProps {
  clauseKey: string;
  hasInitials: boolean;
  initialsDataUrl: string | undefined;
  isInitialed: boolean;
  onInitial: () => void;
}

function InitialStamp({ clauseKey, hasInitials, initialsDataUrl, isInitialed, onInitial }: StampProps) {
  return (
    <button
      type="button"
      className={'hw-stamp' + (isInitialed ? ' is-signed' : '') + (!hasInitials ? ' is-locked' : '')}
      onClick={hasInitials ? onInitial : undefined}
      aria-label={isInitialed ? `Initialed: ${clauseKey}` : `Tap to initial: ${clauseKey}`}
      disabled={!hasInitials || isInitialed}
    >
      {isInitialed && initialsDataUrl ? (
        <img src={initialsDataUrl} alt="" className="hw-stamp__img" />
      ) : (
        <span className="hw-stamp__label">
          {hasInitials ? 'Tap to initial' : 'Draw initials first'}
        </span>
      )}
    </button>
  );
}

// ─── Clause block — a contract clause that requires an initial ──
interface ClauseBlockProps {
  clause: ClauseDef;
  children: React.ReactNode;
  hasInitials: boolean;
  initialsDataUrl: string | undefined;
  isInitialed: boolean;
  onInitial: () => void;
}

function ClauseBlock({ clause, children, hasInitials, initialsDataUrl, isInitialed, onInitial }: ClauseBlockProps) {
  return (
    <div className={'hw-clause' + (isInitialed ? ' is-signed' : '')}>
      <div className="hw-clause__body">
        {children}
        <p className="hw-clause__plain">
          <strong>In plain English.</strong> {clause.plainEnglish}
        </p>
      </div>
      <div className="hw-clause__sign">
        <InitialStamp
          clauseKey={clause.key}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={isInitialed}
          onInitial={onInitial}
        />
      </div>
    </div>
  );
}

// ─── Main step component ──
export default function AgreementStep({ state, patch }: Props) {
  const bcAck = !!state.agreementBcFactSheetAck;
  const initialsDataUrl = (state.agreementInitialsDataUrl as string | undefined) || undefined;
  const signatureDataUrl = (state.agreementSignatureDataUrl as string | undefined) || undefined;
  const initialed = (state.agreementInitialedClauses as Record<string, string> | undefined) || {};
  const finalAck = !!state.agreementFinalAck;
  const signatureName = (state.agreementSignatureName as string | undefined) || '';

  const hasInitials = !!initialsDataUrl;
  const initialedCount = Object.keys(initialed).length;
  const allInitialed = initialedCount === CLAUSES.length;

  // Ensure the version is recorded on first interaction.
  useEffect(() => {
    if (!state.agreementVersion) {
      patch({ agreementVersion: AGREEMENT_VERSION });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setInitials(dataUrl: string) {
    patch({ agreementInitialsDataUrl: dataUrl });
  }
  function clearInitials() {
    patch({
      agreementInitialsDataUrl: undefined,
      agreementInitialedClauses: {},
    });
  }

  function stampClause(clauseKey: string) {
    if (!hasInitials) return;
    if (initialed[clauseKey]) return;
    const next = { ...initialed, [clauseKey]: new Date().toISOString() };
    patch({ agreementInitialedClauses: next });
  }

  function setSignature(dataUrl: string) {
    patch({
      agreementSignatureDataUrl: dataUrl,
      agreementSignatureTimestamp: new Date().toISOString(),
    });
  }
  function clearSignature() {
    patch({
      agreementSignatureDataUrl: undefined,
      agreementSignatureTimestamp: undefined,
    });
  }

  const today = new Date().toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 5 of 25 · Agreement</p>
      <h1 className="hw-step__title">Contract Worker Agreement</h1>
      <p className="hw-step__sub">
        This is the agreement between Private Mentorship and the Assistant. Three steps: (A) draw initials and apply them to each clause, (B) sign and complete, (C) confirm the required reading at the bottom. Twelve key clauses require an initial.
      </p>

      <p className="hw-ag-fulllink">
        <a
          href="/hiring-apply/contractor-agreement.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          View the full long-form Agreement (all sections and schedules)
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6, verticalAlign: 'middle' }}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </p>

      {/* ─── Initials setup card ─── */}
      <div className="hw-card hw-ag-initials">
        <h3 className="hw-card__title">Step A · Draw your initials</h3>
        <p className="hw-card__sub">
          Draw the initials you will use to sign each clause. Use a finger on touch screens, or the trackpad/mouse. Your drawn initials become the stamp applied to every initial point in the contract.
        </p>
        <SignaturePad
          value={initialsDataUrl}
          onChange={setInitials}
          onClear={clearInitials}
          height={120}
          placeholder="Sign initials here (e.g. CB)"
          ariaLabel="Draw your initials"
        />
        <p className="hw-ag-initials__status">
          {hasInitials ? (
            <span className="hw-ag-status hw-ag-status--ok">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 8 7 12 13 4" />
              </svg>
              Initials captured · ready to apply
            </span>
          ) : (
            <span className="hw-ag-status hw-ag-status--pending">Initials are required before any clause can be signed.</span>
          )}
        </p>
      </div>

      {/* ─── Contract body ─── */}
      <div className="hw-card hw-ag-contract">
        <div className="hw-ag-contract__head">
          <div className="hw-ag-contract__eyebrow">Private Mentorship Inc. · British Columbia</div>
          <h3 className="hw-ag-contract__title">Independent Contractor Agreement</h3>
          <div className="hw-ag-contract__sub">Assistant Engagement — Marketplace Platform Model</div>
        </div>

        <p className="hw-ag-contract__intro">
          This Agreement is between Private Mentorship Inc. (“PM”) and the Assistant identified at the foot of this document. Both Parties intend, in good faith, an independent contractor relationship — not employment.
        </p>

        {/* Clause 1 — Contractor status */}
        <ClauseBlock
          clause={CLAUSES[0]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['contractor-status']}
          onInitial={() => stampClause('contractor-status')}
        >
          <h4 className="hw-clause__heading">1 · Independent Contractor Status</h4>
          <p>
            The Assistant is engaged as an independent contractor. Nothing in this Agreement creates an employer-employee relationship. The Assistant is not an employee of PM under the <em>Employment Standards Act</em> (BC), the <em>Workers Compensation Act</em> (BC), the <em>Income Tax Act</em> (Canada), the <em>Canada Pension Plan</em>, or the <em>Employment Insurance Act</em>. The Assistant will not receive wages, salary, overtime, statutory holiday pay, vacation pay, sick leave, severance, group benefits, or any other employment entitlement from PM.
          </p>
        </ClauseBlock>

        {/* Clause 2 — Method and manner */}
        <ClauseBlock
          clause={CLAUSES[1]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['method-control']}
          onInitial={() => stampClause('method-control')}
        >
          <h4 className="hw-clause__heading">2 · Method and Manner of Work</h4>
          <p>
            The Assistant has full control over the method, manner, sequence, and pace of performing the Services. PM does not direct how the Services are delivered, does not supervise sessions in real time, and does not inspect or evaluate the Assistant’s work. PM does not train the Assistant in the delivery of the Services; the Services are delivered using skills, experience, and qualifications the Assistant already possesses.
          </p>
        </ClauseBlock>

        {/* Clause 3 — Per-engagement & right to decline */}
        <ClauseBlock
          clause={CLAUSES[2]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['per-engagement']}
          onInitial={() => stampClause('per-engagement')}
        >
          <h4 className="hw-clause__heading">3 · Per-Engagement Structure and Right to Decline</h4>
          <p>
            Each working relationship between the Assistant and a Client constitutes a discrete, term-limited Engagement. The end of one Engagement does not entitle the Assistant to a further Engagement, and any renewal with the same Client is a fresh commercial arrangement. The Assistant may accept or decline any Engagement offered through the Platform for any reason or no reason. Declining is not grounds for removal from the Platform. The Assistant may at any time pause availability, take time off, or work zero hours.
          </p>
        </ClauseBlock>

        {/* Clause 4 — Substitution */}
        <ClauseBlock
          clause={CLAUSES[3]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['substitution']}
          onInitial={() => stampClause('substitution')}
        >
          <h4 className="hw-clause__heading">4 · Right of Substitution and Backup Assistants</h4>
          <p>
            If the Assistant is unable to personally attend a scheduled session, the Assistant may arrange for another qualified Assistant from the PM Platform roster (a “Backup”) to attend in their place. The Backup must meet the same baseline qualifications. The Client’s prior approval is required for any substitution; the Client is entitled to meet the Backup before agreeing. The Assistant is encouraged to introduce a pre-cleared Backup to the Client at the start of each Engagement. PM may suggest Backup candidates on request but does not assign or dispatch Backups.
          </p>
        </ClauseBlock>

        {/* Clause 5 — Fee split */}
        <ClauseBlock
          clause={CLAUSES[4]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['fee-split']}
          onInitial={() => stampClause('fee-split')}
        >
          <h4 className="hw-clause__heading">5 · Fee Structure — 30% Platform Fee, 70% Assistant Share</h4>
          <p>
            Each Engagement has an Engagement Fee paid by the Client. PM retains a Platform Fee of <strong>thirty percent (30%)</strong> in consideration of marketing, Client introduction, payment processing, profile hosting, Platform infrastructure, ongoing referral, and access to the Platform. The Assistant retains <strong>seventy percent (70%)</strong>. Amounts paid to the Assistant are fees for services rendered as an independent contractor — not wages, salary, or commissions earned as an employee.
          </p>
        </ClauseBlock>

        {/* Clause 6 — Taxes */}
        <ClauseBlock
          clause={CLAUSES[5]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['taxes']}
          onInitial={() => stampClause('taxes')}
        >
          <h4 className="hw-clause__heading">6 · Taxes — T4A, T2125, No Source Deductions</h4>
          <p>
            PM does not deduct income tax, CPP, EI, or any other amount from payments to the Assistant. PM will issue a <strong>T4A</strong> for amounts exceeding the CRA reporting threshold in a calendar year. PM will not issue a T4 under any circumstances. The Assistant is solely responsible for reporting income on Form <strong>T2125</strong> and remitting income tax, CPP, and any elected EI premiums to the Canada Revenue Agency. If total revenue from all sources exceeds the CRA small-supplier threshold ($30,000 over four consecutive calendar quarters), the Assistant is responsible for registering for, charging, and remitting GST/HST.
          </p>
        </ClauseBlock>

        {/* Clause 7 — Refund of unearned fees */}
        <ClauseBlock
          clause={CLAUSES[6]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['refund']}
          onInitial={() => stampClause('refund')}
        >
          <h4 className="hw-clause__heading">7 · Completion of Engagement and Refund of Unearned Fees</h4>
          <p>
            Where the Assistant has accepted an Engagement and Engagement Fees have been paid or committed by a Client, the Assistant agrees to deliver the agreed number of hours within the agreed term. If the Assistant fails to deliver hours for which the Assistant has been paid (other than due to a Client-side cancellation or a permitted substitution), the Assistant will refund the unearned portion within <strong>fourteen (14) days</strong> of the end of the Engagement period.
          </p>
        </ClauseBlock>

        {/* Clause 8 — Abandonment fee */}
        <ClauseBlock
          clause={CLAUSES[7]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['abandonment']}
          onInitial={() => stampClause('abandonment')}
        >
          <h4 className="hw-clause__heading">8 · Abandonment Fee</h4>
          <p>
            If the Assistant ceases to deliver Services under an active Engagement for more than fourteen (14) consecutive days without notice, the Engagement is deemed abandoned. On abandonment, the Assistant will refund all unearned fees and pay PM the applicable Abandonment Fee below, as liquidated damages and not as a penalty:
          </p>
          <table className="hw-clause__table">
            <thead>
              <tr><th>Engagement Fee (total)</th><th>Abandonment Fee</th></tr>
            </thead>
            <tbody>
              <tr><td>Up to $1,500 (Standard 24h &amp; 40h)</td><td><strong>$350</strong></td></tr>
              <tr><td>$1,501 to $5,000 (Custom Plan I &amp; II)</td><td><strong>$900</strong></td></tr>
              <tr><td>Over $5,000 (Custom Plan III+)</td><td><strong>$1,500</strong></td></tr>
            </tbody>
          </table>
          <p>
            The Abandonment Fee represents a genuine pre-estimate of PM’s cost of replacing the Assistant, reassuring the affected Client, processing the refund, and recovering the amount.
          </p>
        </ClauseBlock>

        {/* Clause 9 — Legal recourse */}
        <ClauseBlock
          clause={CLAUSES[8]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['legal-recourse']}
          onInitial={() => stampClause('legal-recourse')}
        >
          <h4 className="hw-clause__heading">9 · Acknowledgment of Legal Recourse</h4>
          <p>
            The Assistant acknowledges that PM may enforce its rights under this Agreement by filing a claim in the <strong>Civil Resolution Tribunal of British Columbia</strong> (up to $5,000), the <strong>Provincial Court of British Columbia, Small Claims Division</strong> (up to $35,000), or the <strong>Supreme Court of British Columbia</strong> (above $35,000), at PM’s election. This kind of enforcement is a normal commercial remedy between independent contracting parties and reinforces the Assistant’s status as a self-employed independent contractor under this Agreement.
          </p>
        </ClauseBlock>

        {/* Clause 10 — Non-exclusive */}
        <ClauseBlock
          clause={CLAUSES[9]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['non-exclusive']}
          onInitial={() => stampClause('non-exclusive')}
        >
          <h4 className="hw-clause__heading">10 · Non-Exclusivity and Other Work Encouraged</h4>
          <p>
            This Agreement is non-exclusive. The Assistant is expressly free, and is encouraged, to engage with other families, individuals, agencies, or platforms; to operate their own independent business; and to accept Engagements from sources other than the PM Platform. PM may share external job postings or referrals with the Assistant from time to time. Over-reliance on a single source of income is inconsistent with an independent contractor relationship; PM <strong>expects</strong> the Assistant to maintain other clients, jobs, or revenue streams.
          </p>
        </ClauseBlock>

        {/* Clause 11 — Non-solicit */}
        <ClauseBlock
          clause={CLAUSES[10]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['non-solicit']}
          onInitial={() => stampClause('non-solicit')}
        >
          <h4 className="hw-clause__heading">11 · Non-Solicitation and Non-Circumvention</h4>
          <p>
            During this Agreement and for <strong>twelve (12) months</strong> after the end of each Engagement, the Assistant will not solicit, induce, or accept any direct off-Platform engagement from a Client introduced through the Platform; provide a Platform-introduced Client with personal contact information for the purpose of off-Platform business; or solicit any other Assistant on the Platform to leave the Platform. A breach entitles PM to recover liquidated damages equal to twelve (12) months of the Platform Fee that would have been earned had the Engagement continued through the Platform.
          </p>
        </ClauseBlock>

        {/* Clause 12 — Vocabulary */}
        <ClauseBlock
          clause={CLAUSES[11]}
          hasInitials={hasInitials}
          initialsDataUrl={initialsDataUrl}
          isInitialed={!!initialed['vocabulary']}
          onInitial={() => stampClause('vocabulary')}
        >
          <h4 className="hw-clause__heading">12 · Self-Employment Vocabulary</h4>
          <p>
            The Parties will not use the following terms in relation to the Assistant’s work for PM: <em>employee, employer, wages, salary, payroll, overtime, statutory holiday pay, vacation, sick leave, termination, dismissal, firing, discipline, write-up, suspension, supervisor, subordinate, manager, hire.</em> The correct vocabulary is: <em>Assistant, contractor, engagement fee, Platform fee, end of engagement, end of agreement, the Parties, Platform, Client.</em> The Assistant has read this Agreement, has had the opportunity to seek independent legal advice, and has either obtained such advice or waived the opportunity to do so.
          </p>
        </ClauseBlock>
      </div>

      {/* ─── Scope note (between contract body and final signature) ─── */}
      <div className="hw-ag-scope">
        <strong>About this Agreement.</strong> The twelve clauses above are the legally critical sections that require the Assistant’s initial. The complete Agreement also includes standard sections covering Platform conduct, professional standards, intellectual property, indemnification, governing law, and Schedules A–C (self-identification questionnaire, glossary of terms, per-engagement confirmation template). All of these sections will appear in the signed PDF copy of the Agreement that is emailed to the Assistant and stored in the Assistant’s record after the application is submitted.
      </div>

      {/* ─── Final signature card ─── */}
      <div className="hw-card hw-ag-final">
        <h3 className="hw-card__title">Step B · Sign the Agreement</h3>
        <p className="hw-card__sub">
          Once every clause above is initialed, type the Assistant’s full legal name and draw the full signature below.
        </p>

        <div className={'hw-ag-progress' + (allInitialed ? ' is-complete' : '')}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {allInitialed ? <polyline points="3 8 7 12 13 4" /> : <circle cx="8" cy="8" r="6" />}
          </svg>
          <span>
            <strong>{initialedCount} of {CLAUSES.length}</strong> clauses initialed
            {!allInitialed && initialedCount > 0 && ` · ${CLAUSES.length - initialedCount} remaining`}
          </span>
        </div>

        <label className="hw-field">
          <span className="hw-field__label">Full legal name</span>
          <input
            type="text"
            className="hw-field__input"
            value={signatureName}
            onChange={e => patch({ agreementSignatureName: e.target.value })}
            placeholder="As it appears on government ID"
            autoComplete="name"
          />
        </label>

        <div className="hw-field">
          <span className="hw-field__label">Signature</span>
          <SignaturePad
            value={signatureDataUrl}
            onChange={setSignature}
            onClear={clearSignature}
            height={160}
            placeholder="Sign here"
            ariaLabel="Draw your full signature"
          />
        </div>

        <div className="hw-ag-meta">
          <div className="hw-ag-meta__row">
            <span className="hw-ag-meta__k">Date signed</span>
            <span className="hw-ag-meta__v">{today}</span>
          </div>
          <div className="hw-ag-meta__row">
            <span className="hw-ag-meta__k">Agreement version</span>
            <span className="hw-ag-meta__v">{AGREEMENT_VERSION}</span>
          </div>
          <div className="hw-ag-meta__row">
            <span className="hw-ag-meta__k">Governing law</span>
            <span className="hw-ag-meta__v">Province of British Columbia, Canada</span>
          </div>
        </div>

        <button
          type="button"
          className={'hw-ack' + (finalAck ? ' is-active' : '')}
          onClick={() => patch({ agreementFinalAck: !finalAck })}
        >
          <span className="hw-ack__box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="hw-ack__text">
            <strong>Final acknowledgment.</strong>
            I have read this Agreement in full. My initials beside each highlighted clause confirm that I have read and agree to that clause. My signature above is my electronic signature on this Agreement.
          </span>
        </button>

        <p className="hw-ag-foot">
          A signed PDF copy of this Agreement will be emailed to the Assistant after the application is submitted and stored in the Assistant’s record.
        </p>
      </div>

      {/* ─── Step C · Required reading: BC Government fact sheet ─── */}
      <div className="hw-card hw-ag-readfirst">
        <h3 className="hw-card__title">Step C · Required reading</h3>
        <p className="hw-card__sub">
          Please read the British Columbia Employment Standards Branch fact sheet <em>“Employee or Contractor?”</em>. This is the authoritative source for understanding the distinction in BC and explains the four-factor test (Control, Tools, Profit/Loss, Integration) used by tribunals to classify a working relationship. Confirm below once you have read it.
        </p>
        <a
          href="https://www2.gov.bc.ca/assets/gov/employment-business-and-economic-development/employment-standards-workplace-safety/employment-standards/factsheets-pdfs/pdfs/employee_or_contractor.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="hw-ag-doclink"
        >
          <span className="hw-ag-doclink__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="15" y2="17" />
            </svg>
          </span>
          <span className="hw-ag-doclink__text">
            <strong>“Employee or Contractor?”</strong>
            <span className="hw-ag-doclink__sub">Province of British Columbia · Employment Standards Branch · PDF · opens in a new tab</span>
          </span>
          <span className="hw-ag-doclink__ext" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </span>
        </a>
        <button
          type="button"
          className={'hw-ack' + (bcAck ? ' is-active' : '')}
          onClick={() => patch({
            agreementBcFactSheetAck: !bcAck,
            agreementBcFactSheetTimestamp: !bcAck ? new Date().toISOString() : undefined,
          })}
        >
          <span className="hw-ack__box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className="hw-ack__text">
            <strong>I have read the BC fact sheet.</strong>
            I have read the British Columbia Employment Standards Branch fact sheet <em>“Employee or Contractor?”</em> and I understand the difference between an employee and an independent contractor under BC law.
          </span>
        </button>
      </div>
    </div>
  );
}
