import type { Meta, StoryObj } from '@storybook/react-vite';
import { SceneHeader } from './SceneHeader';

const meta = {
  title: 'Zimní scéna/Horní panel',
  component: SceneHeader,
} satisfies Meta<typeof SceneHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vychozi: Story = {
  name: 'Výchozí',
};
