import type { Meta, StoryObj } from '@storybook/react-vite';
import { SceneBackground, SceneIslands } from './SceneBackground';

const meta = {
  title: 'Winter Scene/Background',
  component: SceneBackground,
} satisfies Meta<typeof SceneBackground>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Landscape: Story = {
  render: () => (
    <div style={{ position: 'relative', height: '100svh' }}>
      <SceneBackground />
      <SceneIslands />
    </div>
  ),
};
