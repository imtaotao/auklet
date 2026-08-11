import 'single-package/style.css';
import 'single-package/components/Panel.css';
import { Badge, Chip, Panel, Tag } from '../src';

const app = document.querySelector<HTMLDivElement>('#app');

document.body.classList.add('single-package-demo');

if (app) {
  app.innerHTML = `
    ${Panel({
      title: 'Single package demo',
      actionLabel: 'Open dev server',
    })}
    <div class="single-package-demo__modules">
      ${Badge({ label: 'CSS Modules' })}
      ${Chip({ label: 'Global Less' })}
      ${Tag({ label: 'Less Modules' })}
    </div>
  `;
}
