import type { Meta, StoryObj } from '@storybook/react-vite';
import { WinterScene } from './WinterScene';

const meta = {
  title: 'Zimní scéna/Celá scéna',
  component: WinterScene,
} satisfies Meta<typeof WinterScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Animovana: Story = {
  name: 'Animovaná',
  args: { animate: true },
};

export const Staticka: Story = {
  name: 'Statická',
  args: { animate: false },
};
