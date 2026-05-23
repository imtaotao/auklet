import '@demo/single-package/style.css';
import '@demo/single-package/components/Panel.css';
import { Panel } from '../src';

const app = document.querySelector<HTMLDivElement>('#app');

document.body.classList.add('single-package-demo');

if (app) {
  app.innerHTML = Panel({
    title: 'Single package demo',
    actionLabel: 'Open dev server',
  });
}
