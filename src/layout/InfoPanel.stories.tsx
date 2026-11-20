import type { Meta, StoryObj } from '@storybook/react-vite';
import { InfoPanel } from './InfoPanel';

const meta = {
  title: 'Rozložení/Informační blok',
  component: InfoPanel,
  parameters: { layout: 'padded' },
  args: {
    title: 'O serveru',
    children: <p>Capycraft je Minecraft server.</p>,
  },
} satisfies Meta<typeof InfoPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vychozi: Story = {
  name: 'Výchozí',
};
