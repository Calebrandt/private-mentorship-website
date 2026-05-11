import { useEffect, useRef, useState } from 'react';
import type { PhaseDef } from '../types/wizard';

interface Props {
  phase: PhaseDef;
}

const PHASE_HINT: Record<string, string> = {
  ONBOARDING: 'welcome / pana',
  ABOUT_YOU: 'online-resume / pana',
  VERIFICATION: 'personal-data / pana',
  SCENARIOS: 'job-interview / pana',
  AGREEMENTS: 'agreement / pana',
};

export default function IllustrationPanel({ phase }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Prefix illustration paths with the configured Astro base path so assets
  // resolve correctly when the wizard is deployed under a subpath
  // (e.g. /hiring-apply/illustrations/welcome.svg).
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const illustrationSrc = baseUrl + phase.illustration;

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [illustrationSrc]);

  const showPlaceholder = errored || !loaded;

  return (
    <div className="hw-stage__art">
      <img
        ref={imgRef}
        key={illustrationSrc}
        src={illustrationSrc}
        alt={`${phase.label} illustration`}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        style={{ display: loaded && !errored ? 'block' : 'none' }}
      />
      {showPlaceholder && (
        <div className="hw-stage__art-placeholder">
          <strong>{phase.label}</strong>
          <p style={{ margin: 0 }}>Drop your Pana illustration here.</p>
          <code>{illustrationSrc}</code>
          <p style={{ marginTop: 14, fontSize: 11.5, color: 'var(--ink-tert)' }}>
            Source: storyset.com/illustration/{PHASE_HINT[phase.key]}
          </p>
        </div>
      )}
    </div>
  );
}
