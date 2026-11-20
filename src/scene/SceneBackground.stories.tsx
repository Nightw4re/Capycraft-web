import type { Meta, StoryObj } from '@storybook/react-vite';
import { SceneBackground, SceneIslands } from './SceneBackground';

const meta = {
  title: 'Zimní scéna/Pozadí',
  component: SceneBackground,
} satisfies Meta<typeof SceneBackground>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Krajina: Story = {
  render: () => (
    <div style={{ position: 'relative', height: '100svh' }}>
      <SceneBackground />
      <SceneIslands />
    </div>
  ),
};
