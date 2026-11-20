import type { Meta, StoryObj } from '@storybook/react-vite';
import { InfoPanel } from './InfoPanel';
import { PageLayout } from './PageLayout';

const meta = {
  title: 'Rozložení/Stránka',
  component: PageLayout,
  decorators: [(Story) => <div style={{ minHeight: '100svh', background: '#221a35' }}><Story /></div>],
  argTypes: { children: { control: false } },
  args: {
    title: 'Informace',
    children: [
      <InfoPanel key="server" title="O serveru"><p>Capycraft je Minecraft server.</p></InfoPanel>,
      <InfoPanel key="overview" title="Hráčský přehled"><p>Hráčský přehled připravujeme.</p></InfoPanel>,
    ],
  },
} satisfies Meta<typeof PageLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sloupec: Story = {
  name: 'Jeden sloupec',
  args: { layout: 'stack' },
};

export const Mrizka: Story = {
  name: 'Responzivní mřížka',
  args: { layout: 'grid' },
};
