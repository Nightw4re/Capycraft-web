import islands from '../../assets/capybara-snow-islands.png';
import { homeHash } from '../navigation';
import { usePreferences } from '../PreferencesProvider';
import { PageLayout } from './PageLayout';
import './page-error.css';

export function PageError({ code }: { code: 401 | 403 | 404 }) {
  const { text } = usePreferences();
  const { title, message } = text.pageErrors[code];

  return (
    <PageLayout>
      <div className="page-error">
        <div className="page-error-copy">
          <h1><span>{code}</span>{title}</h1>
          <p>{message}</p>
          <a href={homeHash}>{text.backHome}</a>
        </div>
        {code === 404 && (
          <div className="page-error-art" aria-hidden="true">
            <img src={islands} alt="" />
          </div>
        )}
      </div>
    </PageLayout>
  );
}
