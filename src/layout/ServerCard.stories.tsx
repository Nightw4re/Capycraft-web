import type { Meta, StoryObj } from '@storybook/react-vite';
import { ServerCard } from './ServerCard';
import { serverExamples } from './serverExamples';

const meta = {
  title: 'Layout/Server card',
  component: ServerCard,
  parameters: { layout: 'padded' },
  decorators: [Story => <div style={{ maxWidth: '28rem' }}><Story /></div>],
  args: { server: serverExamples('cs')[0] },
} satisfies Meta<typeof ServerCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StaticExample: Story = {};
