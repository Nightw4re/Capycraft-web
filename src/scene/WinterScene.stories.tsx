import type { Meta, StoryObj } from '@storybook/react-vite';
import { WinterScene } from './WinterScene';

const meta = {
  title: 'Winter Scene/Full Scene',
  component: WinterScene,
} satisfies Meta<typeof WinterScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Animated: Story = {
  args: { animate: true },
};

export const Static: Story = {
  args: { animate: false },
};
