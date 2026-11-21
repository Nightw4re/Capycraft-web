import type { Meta, StoryObj } from '@storybook/react-vite';
import { SceneHeader } from './SceneHeader';

const meta = {
  title: 'Winter Scene/Header',
  component: SceneHeader,
} satisfies Meta<typeof SceneHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
};
