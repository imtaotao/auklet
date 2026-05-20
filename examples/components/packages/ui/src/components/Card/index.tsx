import { Button } from '../Button';

export type CardProps = {
  title: string;
};

export const Card = ({ title }: CardProps) => {
  return Button({ label: title });
};
