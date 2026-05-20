import { Button } from '../Button';

export type CardProps = {
  title: string;
};

export function Card({ title }: CardProps) {
  return Button({ label: title });
}
