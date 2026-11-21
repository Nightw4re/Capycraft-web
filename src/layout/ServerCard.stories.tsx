import type { Meta, StoryObj } from '@storybook/react-vite';
import { ServerCard } from './ServerCard';
import { serverExamples } from './serverExamples';

const meta = {
  title: 'Layout/Server card',
  component: ServerCard,
  parameters: { layout: 'padded' },
  decorators: [Story => <div style={{ maxWidth: '28rem' }}><Story /></div>],
  args: { server: serverExamples('en')[0] },
} satisfies Meta<typeof ServerCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StaticExample: Story = {};

const formattedMotd = [
  'Plain text with 日本語, & and <br>',
  '\u00a70Black \u00a71Dark blue \u00a72Dark green \u00a73Dark aqua',
  '\u00a74Dark red \u00a75Dark purple \u00a76Gold \u00a77Gray',
  '\u00a78Dark gray \u00a79Blue \u00a7aGreen \u00a7bAqua',
  '\u00a7cRed \u00a7dLight purple \u00a7eYellow \u00a7fWhite',
  '\u00a7r\u00a7lBold\u00a7r · \u00a7oItalic\u00a7r · \u00a7nUnderline\u00a7r · \u00a7mStrikethrough\u00a7r',
  '\u00a7kObfuscated stays readable\u00a7r',
  '\u00a76\u00a7l\u00a7oGold, bold and italic \u00a7bAqua with styles cleared \u00a7rDefault',
  '\u00a7n\u00a7mUnderline and strikethrough\u00a7r',
  '\u00a7#f4a261Adventure RGB \u00a7x\u00a77\u00a78\u00a7b\u00a76\u00a7f\u00a7fBungeeCord RGB \u00a7#101820Dark RGB\u00a7r',
  'Color code with uppercase A: \u00a7Agreen\u00a7r · Unknown code: \u00a7z · Trailing sign: \u00a7',
].join('\n');

export const MotdFormatting: Story = {
  name: 'MOTD formatting',
  args: { server: { ...serverExamples('en')[0], motd: formattedMotd } },
};

export const MotdWithoutVisibleText: Story = {
  name: 'MOTD with no visible text',
  args: { server: { ...serverExamples('en')[0], motd: '\u00a76 \u00a7l\u00a7r' } },
};
