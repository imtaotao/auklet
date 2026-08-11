import { Button, Card } from '@demo/ui';
import chipStyles from '@demo/ui/shared/chip.module.less';

export type DashboardProps = {
  title: string;
  actionLabel: string;
};

export function Dashboard({ title, actionLabel }: DashboardProps) {
  const action = Button({ label: actionLabel });
  const card = Card({ title });

  return `${card} ${action} <span class="${chipStyles.chip}">shared</span>`;
}
