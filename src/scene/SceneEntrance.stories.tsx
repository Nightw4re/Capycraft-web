import type { Meta, StoryObj } from '@storybook/react-vite';
import { SceneEntrance } from './SceneEntrance';

const meta = {
  title: 'Winter Scene/Entrance Animation',
  component: SceneEntrance,
  args: { animate: true },
} satisfies Meta<typeof SceneEntrance>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LogoAndPanelEntrance: Story = {
};
