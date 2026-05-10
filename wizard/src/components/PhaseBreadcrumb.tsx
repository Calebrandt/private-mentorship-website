import { PHASES, type PhaseKey } from '../types/wizard';

interface Props {
  currentPhase: PhaseKey;
  completedPhases: PhaseKey[];
}

export default function PhaseBreadcrumb({ currentPhase, completedPhases }: Props) {
  return (
    <div className="hw-breadcrumb">
      <span className="hw-breadcrumb__label">Application</span>
      {PHASES.map((phase, i) => {
        const isCurrent = phase.key === currentPhase;
        const isDone = completedPhases.includes(phase.key);
        const cls = [
          'hw-breadcrumb__item',
          isCurrent ? 'is-current' : '',
          isDone ? 'is-done' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <span key={phase.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
            <span className={cls}>
              <span className="hw-breadcrumb__num">{i + 1}.</span> {phase.label}
            </span>
            {i < PHASES.length - 1 && <span className="hw-breadcrumb__sep">›</span>}
          </span>
        );
      })}
    </div>
  );
}
