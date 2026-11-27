import { usePreferences } from '../PreferencesProvider';
import type { ServerSummary } from '../serverDirectoryTypes';
import { HeaderPicker } from './HeaderPicker';

export function ServerPicker({ label, value, servers, placeholder, disabled, onChange }: {
  label: string;
  value: string;
  servers: readonly Pick<ServerSummary, 'alias' | 'name' | 'logo' | 'status'>[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (alias: string) => void;
}) {
  const { text } = usePreferences();
  const options = servers.map(server => ({
    value: server.alias,
    label: server.name ?? server.alias,
    iconSrc: server.logo,
    status: { value: server.status, label: text.serverStatus[server.status] },
  }));
  return <HeaderPicker label={label} value={value} disabled={disabled} onChange={onChange}
    options={placeholder ? [{ value: '', label: placeholder, placeholder: true }, ...options] : options} />;
}
