import type { Meta, StoryObj } from '@storybook/react-vite';
import { InfoPanel } from './InfoPanel';

const meta = {
  title: 'Layout/Info Panel',
  component: InfoPanel,
  parameters: { layout: 'padded' },
  args: {
    title: 'About the server',
    children: <p>Capycraft is a Minecraft server.</p>,
  },
} satisfies Meta<typeof InfoPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args, { globals }) => {
    if (globals.language === 'cs') {
      return <InfoPanel {...args} title="O serveru"><p>Capycraft je český Minecraft server.</p></InfoPanel>;
    }
    return <InfoPanel {...args} />;
  },
};
