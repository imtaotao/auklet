import { Button } from '../Button';

export type PanelProps = {
  title: string;
  actionLabel: string;
};

export function Panel({ title, actionLabel }: PanelProps) {
  return `
    <section class="single-panel">
      <h1>${title}</h1>
      ${Button({ label: actionLabel })}
    </section>
  `;
}
