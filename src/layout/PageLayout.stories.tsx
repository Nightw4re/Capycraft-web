import type { Meta, StoryObj } from '@storybook/react-vite';
import { InfoPanel } from './InfoPanel';
import { PageLayout } from './PageLayout';

const meta = {
  title: 'Layout/Page',
  component: PageLayout,
  decorators: [(Story) => <div style={{ minHeight: '100svh', background: '#221a35' }}><Story /></div>],
  argTypes: { children: { control: false } },
  args: {
    title: 'Information',
    children: [
      <InfoPanel key="server" title="About the server"><p>Capycraft is a Minecraft server.</p></InfoPanel>,
      <InfoPanel key="overview" title="Player overview"><p>The player overview is in development.</p></InfoPanel>,
    ],
  },
} satisfies Meta<typeof PageLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleColumn: Story = {
  args: { layout: 'stack' },
};

export const ResponsiveGrid: Story = {
  args: { layout: 'grid' },
};
