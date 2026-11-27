import { usePreferences } from '../PreferencesProvider';
import { HeaderAppearanceControls } from './HeaderAppearanceControls';
import { HeaderSignIn } from './HeaderSignIn';

export function HeaderControls() {
  const { introAnimation, text, update } = usePreferences();

  return (
    <div className="header-controls">
      <button
        className="header-intro-switch"
        type="button"
        role="switch"
        aria-checked={introAnimation}
        aria-label={text.introAnimation}
        title={text.introAnimation}
        onClick={() => update({ introAnimation: !introAnimation })}
      >
        <span className="header-intro-label">{text.intro}</span>
        <span className="header-intro-track" aria-hidden="true" />
      </button>
      <HeaderAppearanceControls />
      <HeaderSignIn />
    </div>
  );
}
