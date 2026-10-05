import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as stories from './stories';
import '../../src/styles.css';
import '../../src/ui/workspace.css';

declare global {
  interface Window {
    mount: (params: { story: string }) => void;
    unmount: () => void;
  }
}

let root: Root | undefined;
window.mount = ({ story }) => {
  const Story = stories[story as keyof typeof stories];
  if (!Story) throw new Error(`Unknown component story: ${story}`);
  root ??= createRoot(document.getElementById('root')!);
  flushSync(() => root!.render(<Story />));
};
window.unmount = () => { root?.unmount(); root = undefined; };
