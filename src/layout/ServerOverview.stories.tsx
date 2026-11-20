import type { Meta, StoryObj } from '@storybook/react-vite';
import { usePreferences } from '../PreferencesProvider';
import { ServerOverview } from './ServerOverview';
import { serverExamples } from './serverExamples';

const meta = {
  title: 'Layout/Server overview',
  component: ServerOverview,
  parameters: { layout: 'padded' },
  decorators: [Story => <div style={{ maxWidth: '31rem' }}><Story /></div>],
} satisfies Meta<typeof ServerOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { servers: [] } };

export const StaticExamples: Story = {
  render: function StaticExamples() {
    const { language } = usePreferences();
    return <ServerOverview servers={serverExamples(language)} />;
  },
};
