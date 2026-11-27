import { usePreferences } from '../PreferencesProvider';
import { buttonColors, dyeColors, languageOptions } from '../preferences';
import { HeaderPicker } from './HeaderPicker';
import './header-controls.css';

export function HeaderAppearanceControls() {
  const { language, buttonColor, text, update } = usePreferences();
  return <>
    <HeaderPicker
      label={text.buttonColor}
      value={buttonColor}
      swatches
      options={buttonColors.map(color => ({ value: color, label: text.colors[color], swatchColor: dyeColors[color] }))}
      onChange={buttonColor => update({ buttonColor })}
    />
    <HeaderPicker label={text.language} value={language} options={languageOptions} onChange={language => update({ language })} />
  </>;
}
