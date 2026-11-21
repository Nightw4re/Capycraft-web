import { usePreferences } from '../PreferencesProvider';
import { buttonColors, dyeColors, languageOptions } from '../preferences';
import { HeaderPicker } from './HeaderPicker';
import { HeaderSignIn } from './HeaderSignIn';
import './header-controls.css';

export function HeaderControls() {
  const { language, buttonColor, introAnimation, text, update } = usePreferences();

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
      <HeaderPicker
        label={text.buttonColor}
        value={buttonColor}
        swatches
        options={buttonColors.map(color => ({ value: color, label: text.colors[color], swatchColor: dyeColors[color] }))}
        onChange={buttonColor => update({ buttonColor })}
      />
      <HeaderPicker label={text.language} value={language} options={languageOptions} onChange={language => update({ language })} />
      <HeaderSignIn />
    </div>
  );
}
