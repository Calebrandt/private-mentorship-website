import type { WizardState } from '../../types/wizard';

interface Props {
  state: WizardState;
  patch: (next: Partial<WizardState>) => void;
}

export default function WorkHistoryStep({ state, patch }: Props) {
  const summary = (state.workSummary as string) || '';
  const years = (state.workYears as string | number | undefined) ?? '';

  return (
    <div className="hw-step-enter">
      <p className="hw-step__eyebrow">Step 11 of 25 · About You</p>
      <h1 className="hw-step__title">Work History</h1>
      <p className="hw-step__sub">
        A brief overview of your most relevant role. A full résumé is uploaded in the next phase.
      </p>

      <div className="hw-card">
        <h3 className="hw-card__title">Most relevant experience</h3>
        <p className="hw-card__sub">Focus on the role most relevant to working with families.</p>

        <div className="hw-form-grid">
          <div className="hw-form-row">
            <label className="hw-label" htmlFor="workRole">Role or position</label>
            <input
              id="workRole"
              type="text"
              className="hw-input"
              placeholder="e.g. ESL Tutor, Childcare Provider, Personal Assistant"
              value={(state.workRole as string) || ''}
              onChange={e => patch({ workRole: e.target.value })}
            />
          </div>
          <div className="hw-form-row">
            <label className="hw-label" htmlFor="workYears">Years in this role</label>
            <input
              id="workYears"
              type="number"
              className="hw-input"
              placeholder="e.g. 3"
              min={0}
              max={50}
              value={years}
              onChange={e => {
                const v = e.target.value;
                patch({ workYears: v === '' ? undefined : Number(v) });
              }}
            />
          </div>
        </div>

        <div className="hw-form-row">
          <label className="hw-label" htmlFor="workSummary">Brief summary</label>
          <textarea
            id="workSummary"
            className="hw-textarea"
            placeholder="e.g. Tutored grade 6–10 students in math and English over three years; built lesson plans tailored to each student."
            value={summary}
            onChange={e => patch({ workSummary: e.target.value })}
          />
          <span className="hw-helper hw-helper--count">
            {summary.length} / minimum 20 characters
          </span>
        </div>
      </div>
    </div>
  );
}
