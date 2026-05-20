import { Button, Card } from '@demo/ui';

export type DashboardProps = {
  title: string;
  actionLabel: string;
};

export function Dashboard({ title, actionLabel }: DashboardProps) {
  const action = Button({ label: actionLabel });
  const card = Card({ title });

  return `${card} ${action}`;
}
